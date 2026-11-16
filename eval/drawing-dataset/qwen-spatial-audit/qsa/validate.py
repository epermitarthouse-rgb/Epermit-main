"""Technical-value validation of merged Qwen lines (stage 2 post-processing, offline).

Vision models swap look-alike glyphs inside numbers (1/I/l, 0/O, 9/q). For every token where such a
glyph sits in a numeric context (dimension, fraction, sheet reference, number before a unit, room or
door number, coefficient label before a value, list number), the digit reading is a *candidate* only.
It replaces the printed reading when independent evidence supports it:

  text_layer   the PDF vector text under the line contains the candidate token
  overlap_tile another tile's reading of the same line contains the candidate token

Otherwise the line is marked uncertain and the candidate is recorded internally; the text is not
changed. Lines that the text layer contradicts on a technical token are flagged the same way. The
original reading is kept in `ocrText`, every decision in `valueChecks`.
"""
from __future__ import annotations

import re

from .geometry import overlap_smaller

AMBIG = {"I": "1", "l": "1", "|": "1", "O": "0", "o": "0", "q": "9"}
UNITS = {"HR", "HR.", "HRS", "HRS.", "HOUR", "PSF", "PSI", "MPH", "LB", "LBS", "LBS.", "MIL", "MM", "GA", "GA.", "DEG", "DEG.", "°", "SF", "CFM", "KSI"}
PUNCT = "()[],;:"
SHEET = re.compile(r"^([A-Z]{1,2}-)(.+)$")
SHAPES = [
    re.compile(r"^\d+'-?\d*(\s?\d/\d+)?\"?$"),          # 3'-6", 0'-0"
    re.compile(r"^\d+(-\d+)?/\d+\"?$"),                 # 1-1/4", 1/2"
    re.compile(r"^\d+\"$"),                             # 12"
    re.compile(r"^\d*\.\d+$"),                          # 0.43
]
SHEET_TAIL = re.compile(r"^\d{1,3}(\.\d{1,2})?$")
ROOM = re.compile(r"^\d{2,4}[A-Z]?$")
DECIMAL = re.compile(r"^\d*\.\d+$")
FRACTION_OR_DIM = re.compile(r"^\d+(-\d+)?/\d+\"?$|^\d+'-?\d*\"?$|^\d+\"$")


def to_digits(s: str) -> str:
    return "".join(AMBIG.get(c, c) for c in s)


def strip(tok: str) -> tuple[str, str, str]:
    a = len(tok) - len(tok.lstrip(PUNCT))
    b = len(tok.rstrip(PUNCT))
    return tok[:a], tok[a:b], tok[b:]


def candidate(tokens: list[str], i: int) -> tuple[str, str] | None:
    """(candidate token, reason) when token i has a look-alike glyph in a numeric context."""
    pre, core, post = strip(tokens[i])
    if not core or not any(c in AMBIG for c in core):
        return None
    nxt = tokens[i + 1].upper().strip(PUNCT) if i + 1 < len(tokens) else ""
    m = SHEET.match(core)
    if m:
        tail = to_digits(m.group(2))
        if tail != m.group(2) and SHEET_TAIL.match(tail) and any(c.isdigit() for c in m.group(2)):
            return pre + m.group(1) + tail + post, "sheet_reference"
    mapped = to_digits(core)
    if mapped == core:
        return None
    has_digit = any(c.isdigit() for c in core)
    if any(s.match(mapped) for s in SHAPES) and (has_digit or any(c in core for c in "'\"/.")):
        return pre + mapped + post, "dimension_or_number"
    if ROOM.match(mapped) and sum(c.isdigit() for c in mapped) >= 2 and (has_digit or len(core) >= 3):
        return pre + mapped + post, "room_or_door_number"
    if mapped.isdigit() and nxt in UNITS:
        return pre + mapped + post, "number_before_unit"
    if i == 0 and re.match(r"^\d{1,2}\.$", mapped) and len(tokens) > 1:
        return pre + mapped + post, "list_number"
    if re.match(r"^[A-Z][a-z]?[Il]$", core) and DECIMAL.match(nxt):
        return pre + core[:-1] + "1" + post, "coefficient_label"
    if core == "q" and FRACTION_OR_DIM.match(nxt):
        return pre + "9" + post, "digit_before_fraction"
    return None


def norm(s: str) -> str:
    return re.sub(r"[^A-Z0-9'\"/.\-]", "", s.upper())


def local_text_layer(line: dict, words: list[dict]) -> list[str]:
    b = line["box"]
    out = []
    for w in words:
        wb = w["box"]
        cy = wb["y"] + wb["height"] / 2
        if b["y"] <= cy <= b["y"] + b["height"] and overlap_smaller(wb, b) >= 0.5:
            out.append(w["text"])
    return out


def other_readings(line: dict) -> list[str]:
    reps = [p["text"] for p in line.get("provenance", [])[1:]] + list(line.get("alternatives") or [])
    return [r for r in reps if r and r != line["text"]]


def validate_lines(lines: list[dict], stage1: dict) -> dict:
    words = stage1["textLayer"].get("words", [])
    tally = {"tokensChecked": 0, "corrected_text_layer": 0, "corrected_overlap_tile": 0, "flagged_ambiguous": 0,
             "confirmed_text_layer": 0, "flagged_text_layer_disagrees": 0, "conflicts_resolved": 0, "linesFlagged": 0, "linesCorrected": 0}
    for l in lines:
        checks = []
        tl_tokens = [norm(t) for t in local_text_layer(l, words)]
        tl_set = set(tl_tokens)
        others = [[norm(t) for t in r.split()] for r in other_readings(l)]
        tokens = l["text"].split()
        new = list(tokens)
        for i in range(len(tokens)):
            c = candidate(tokens, i)
            if not c:
                continue
            cand, reason = c
            tally["tokensChecked"] += 1
            nc, no = norm(cand), norm(tokens[i])
            if tl_set and nc in tl_set:
                status = "corrected_text_layer"
                new[i] = cand
            elif tl_set and no in tl_set:
                status = "confirmed_text_layer"
            elif any(nc in r for r in others):
                status = "corrected_overlap_tile"
                new[i] = cand
            else:
                status = "flagged_ambiguous"
            tally[status] += 1
            checks.append({"token": tokens[i], "candidate": cand, "reason": reason, "status": status})
        # Technical tokens the text layer under the line reads differently (no look-alike explanation).
        if tl_set:
            for i, t in enumerate(new):
                k = norm(t)
                if not any(ch.isdigit() for ch in k) or k in tl_set or any(k in x for x in tl_set):
                    continue
                similar = [x for x in tl_set if any(ch.isdigit() for ch in x) and abs(len(x) - len(k)) <= 1 and sum(a != b for a, b in zip(x, k)) <= 2]
                if similar:
                    tally["flagged_text_layer_disagrees"] += 1
                    checks.append({"token": t, "candidate": None, "textLayer": similar[0], "reason": "text_layer_disagrees", "status": "flagged_text_layer_disagrees"})
        if new != tokens:
            l["ocrText"] = l["text"]
            l["text"] = " ".join(new)
            tally["linesCorrected"] += 1
        # A cross-tile conflict whose readings differ only by look-alike glyphs is one reading.
        if l.get("conflict"):
            keep = [a for a in l["alternatives"] if to_digits(norm(a)) != to_digits(norm(l["text"]))]
            if len(keep) < len(l["alternatives"]):
                digit_reading = next((a for a in [l["text"], *l["alternatives"]] if norm(a) == to_digits(norm(a)) and to_digits(norm(a)) == to_digits(norm(l["text"]))), None)
                if digit_reading and digit_reading != l["text"]:
                    l.setdefault("ocrText", l["text"])
                    l["text"] = digit_reading
                l["alternatives"] = keep
                l["conflict"] = bool(keep)
                tally["conflicts_resolved"] += 1
                checks.append({"token": None, "candidate": None, "reason": "conflict_differs_only_by_lookalike_glyphs", "status": "conflict_resolved"})
        if any(c["status"].startswith("flagged") for c in checks):
            l["uncertain"] = True
            tally["linesFlagged"] += 1
        elif l.get("conflict") is False and not l.get("alternatives") and any(c["status"] == "conflict_resolved" for c in checks):
            l["uncertain"] = bool(l.get("confidenceBasis", {}).get("selfReportedUncertain"))
        if checks:
            l["valueChecks"] = checks
    return tally
