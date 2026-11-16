"""Stage 2: Qwen2.5-VL extraction, coordinate validation and sheet indexing.

Per tile: one Qwen2.5-VL call returns line-level text with pixel boxes. Boxes are validated
against the rendered tile (bounds, ink under the box, coordinate convention) and mapped to the
page frame. Overlapping tiles are merged: readings of one place are clustered, the reading
farthest from a tile edge is kept, and a different full reading is kept as a conflict rather
than resolved. Text is never corrected; text-layer agreement is recorded next to it.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

import numpy as np
import pymupdf

from .geometry import overlap_smaller, px_to_page, round_box, union
from .qwen_client import QwenClient

STAGE2_VERSION = "qsa.stage2.v1"
PROMPT_VERSION = "qsa.tile-prompt.v1"
INK_LEVEL = 160
MIN_INK = 0.01
EDGE_PX = 6

CATEGORIES = [
    "note", "dimension", "elevation", "schedule_title", "schedule_cell", "title_block", "detail_title",
    "detail_reference", "sheet_reference", "gridline", "room_or_tag", "label", "other",
]

TILE_PROMPT = (
    "This image is one {w}x{h} pixel crop of a construction drawing sheet rendered at 300 DPI.\n"
    "Spotting all the text in the image with line-level, and output in JSON format.\n"
    "Return a JSON list. Each element: {{\"bbox_2d\": [x1, y1, x2, y2], \"text_content\": \"...\", "
    "\"category\": one of " + json.dumps(CATEGORIES) + ", \"group\": integer shared by the lines of one note, callout, "
    "bubble or table row, \"uncertain\": true or false, \"alternatives\": [other possible readings]}}.\n"
    "Rules:\n"
    "- bbox_2d is in absolute pixel coordinates of this image.\n"
    "- Copy characters exactly as printed: feet and inch marks, fractions, degree signs, punctuation, abbreviations and "
    "spelling errors. Never correct, normalize, complete or translate text.\n"
    "- Text cut by the image edge: copy only the visible characters.\n"
    "- If a character is ambiguous (1/I, 0/O, 5/S, 7/1, 8/B), keep the most likely reading, set uncertain true and give "
    "the full alternative readings.\n"
    "- One element per printed line. Read vertical text in its reading direction.\n"
    "- Output only the JSON list."
)

OVERVIEW_PROMPT = (
    "This image is a whole construction drawing sheet ({w}x{h} pixels). Locate the layout, not the small text.\n"
    "Return JSON: {{\"title_block\": [x1,y1,x2,y2], \"sheet_number\": \"...\", \"sheet_title\": \"...\", "
    "\"details\": [{{\"bbox_2d\": [x1,y1,x2,y2], \"detail_number\": \"...\", \"title\": \"...\"}}], "
    "\"schedules\": [{{\"bbox_2d\": [x1,y1,x2,y2], \"title\": \"...\"}}], \"gridlines\": [\"...\"]}}.\n"
    "bbox_2d values are absolute pixel coordinates of this image. Copy printed text exactly; use \"\" when unreadable. "
    "Output only the JSON."
)


def parse_json_list(text: str) -> tuple[list[dict], str]:
    """JSON list from a model reply; recovers complete objects from a truncated reply."""
    body = re.sub(r"^```(?:json)?\s*|\s*```\s*$", "", text.strip(), flags=re.S)
    try:
        val = json.loads(body)
        if isinstance(val, dict):
            val = next((v for v in val.values() if isinstance(v, list)), [val])
        return [v for v in val if isinstance(v, dict)], "ok"
    except (json.JSONDecodeError, TypeError):
        pass
    objs = []
    for m in re.finditer(r"\{[^{}]*\}", body):
        try:
            objs.append(json.loads(m.group(0)))
        except json.JSONDecodeError:
            continue
    return objs, "recovered" if objs else "unparsed"


def parse_json_object(text: str) -> dict | None:
    body = re.sub(r"^```(?:json)?\s*|\s*```\s*$", "", text.strip(), flags=re.S)
    try:
        val = json.loads(body)
        return val if isinstance(val, dict) else None
    except json.JSONDecodeError:
        m = re.search(r"\{.*\}", body, re.S)
        if m:
            try:
                return json.loads(m.group(0))
            except json.JSONDecodeError:
                return None
    return None


def load_gray(path: Path) -> np.ndarray:
    pix = pymupdf.Pixmap(str(path))
    if pix.n != 1:
        pix = pymupdf.Pixmap(pymupdf.csGRAY, pix)
    return np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width)


def bbox_of(item: dict):
    b = item.get("bbox_2d") or item.get("bbox")
    if isinstance(b, (list, tuple)) and len(b) == 4 and all(isinstance(v, (int, float)) for v in b):
        return [float(v) for v in b]
    return None


def ink_ratio(img: np.ndarray, x0, y0, x1, y1) -> float:
    h, w = img.shape
    xa, xb = max(0, int(x0)), min(w, int(np.ceil(x1)))
    ya, yb = max(0, int(y0)), min(h, int(np.ceil(y1)))
    if xb <= xa or yb <= ya:
        return 0.0
    return float((img[ya:yb, xa:xb] < INK_LEVEL).mean())


def choose_convention(items: list[dict], img: np.ndarray) -> tuple[str, dict]:
    """Absolute pixels (Qwen2.5-VL) or 0-1000 normalized (other VLM habits), by ink under the boxes."""
    h, w = img.shape
    boxes = [b for b in (bbox_of(i) for i in items) if b]
    if not boxes:
        return "absolute", {"absolute": None, "norm1000": None}

    def score(conv):
        hits = 0
        for b in boxes:
            x0, y0, x1, y1 = b if conv == "absolute" else (b[0] * w / 1000, b[1] * h / 1000, b[2] * w / 1000, b[3] * h / 1000)
            hits += ink_ratio(img, x0, y0, x1, y1) >= MIN_INK
        return hits / len(boxes)

    a, n = score("absolute"), score("norm1000")
    return ("norm1000" if n > a + 0.1 else "absolute"), {"absolute": round(a, 3), "norm1000": round(n, 3)}


def tighten(img: np.ndarray, x0, y0, x1, y1, pad=2):
    h, w = img.shape
    xa, xb = max(0, int(x0)), min(w, int(np.ceil(x1)))
    ya, yb = max(0, int(y0)), min(h, int(np.ceil(y1)))
    if xb <= xa or yb <= ya:
        return None
    ys, xs = np.nonzero(img[ya:yb, xa:xb] < INK_LEVEL)
    if not len(xs):
        return None
    return (max(0, xa + xs.min() - pad), max(0, ya + ys.min() - pad), min(w, xa + xs.max() + 1 + pad), min(h, ya + ys.max() + 1 + pad))


def ink_bands(img: np.ndarray, x0: float, x1: float, min_frac: float = 0.004, gap: int = 2) -> list[tuple[int, int]]:
    """Horizontal runs of inked pixel rows inside one column range (printed text lines and rules)."""
    xa, xb = max(0, int(x0)), min(img.shape[1], int(np.ceil(x1)))
    if xb - xa < 4:
        return []
    profile = (img[:, xa:xb] < INK_LEVEL).mean(axis=1)
    inked = profile > min_frac
    runs, start, last = [], None, -10
    for y, v in enumerate(inked):
        if v:
            if start is None or y - last > gap + 1:
                if start is not None:
                    runs.append((start, last + 1))
                start = y
            last = y
    if start is not None:
        runs.append((start, last + 1))

    def split(s, e):
        # Touching rows of text form one run; cut it at the emptiest pixel row between them.
        if e - s <= max_h:
            return [(s, e)]
        lo, hi = s + min_h, e - min_h
        if hi <= lo:
            return [(s, e)]
        cut = lo + int(np.argmin(profile[lo:hi]))
        return split(s, cut) + split(cut, e)

    max_h, min_h = 56, 14
    bands = [b for r in runs for b in split(*r)]
    return [b for b in bands if 6 <= b[1] - b[0] <= 90]


def columns_of(boxes: list[list[float]]) -> list[list[int]]:
    """Boxes whose x ranges overlap by half the narrower one share a column (single linkage)."""
    cols: list[list[int]] = []
    for i in sorted(range(len(boxes)), key=lambda i: boxes[i][0]):
        a = boxes[i]
        for c in cols:
            if any(min(a[2], boxes[j][2]) - max(a[0], boxes[j][0]) >= 0.5 * min(a[2] - a[0], boxes[j][2] - boxes[j][0]) for j in c):
                c.append(i)
                break
        else:
            cols.append([i])
    return cols


def align(model_c: list[float], band_c: list[float], a: float, b: float, window: float) -> list[int | None]:
    """Monotone alignment of model line centres to band centres (both top to bottom); skips cost `window`."""
    n, m = len(model_c), len(band_c)
    INF = float("inf")
    cost = [[INF] * (m + 1) for _ in range(n + 1)]
    move = [[None] * (m + 1) for _ in range(n + 1)]
    cost[0] = [0.0] * (m + 1)
    for i in range(1, n + 1):
        cost[i][0] = i * window
        move[i][0] = "skip_model"
        for j in range(1, m + 1):
            d = abs(band_c[j - 1] - (a * model_c[i - 1] + b))
            opts = [(cost[i - 1][j - 1] + d if d <= window else INF, "match"), (cost[i - 1][j] + window, "skip_model"), (cost[i][j - 1], "skip_band")]
            cost[i][j], move[i][j] = min(opts, key=lambda o: o[0])
    out: list[int | None] = [None] * n
    i, j = n, min(range(m + 1), key=lambda jj: cost[n][jj])
    while i > 0:
        mv = move[i][j]
        if mv == "match":
            out[i - 1] = j - 1
            i, j = i - 1, j - 1
        elif mv == "skip_model":
            i -= 1
        else:
            j -= 1
    return out


def snap_to_bands(boxes: list[list[float]], img: np.ndarray) -> list[dict | None]:
    """Move each model box onto the printed text band it most plausibly reads.

    Per column, model lines and the column's ink bands are aligned in reading order; the model's
    vertical scale and offset are re-fitted on the matches (the 3B model draws lines at a regular
    pitch that drifts from the printed one) and the alignment repeated. A line without a band in
    reach keeps its model box. Returns, per box, the band it was snapped to or None.
    """
    result: list[dict | None] = [None] * len(boxes)
    for col in columns_of(boxes):
        col.sort(key=lambda i: (boxes[i][1] + boxes[i][3]) / 2)
        x0 = min(boxes[i][0] for i in col)
        x1 = max(boxes[i][2] for i in col)
        bands = ink_bands(img, x0, x1)
        if not bands:
            continue
        mc = [(boxes[i][1] + boxes[i][3]) / 2 for i in col]
        bc = [(b0 + b1) / 2 for b0, b1 in bands]
        h = float(np.median([boxes[i][3] - boxes[i][1] for i in col]))
        window = max(40.0, 2.0 * h)
        top = mc[0]

        def total(a, b):
            m = align(mc, bc, a, b, window)
            return sum(abs(bc[j] - (a * mc[k] + b)) if j is not None else window for k, j in enumerate(m)), m

        best = None
        for a in np.linspace(0.8, 1.4, 13):
            for off in np.arange(-60, 61, 10):
                b = top + off - a * top
                c, m = total(a, b)
                if best is None or c < best[0]:
                    best = (c, a, b, m)
        _, a, b, match = best
        for _ in range(3):
            pairs = [(mc[k], bc[j]) for k, j in enumerate(match) if j is not None]
            if len(pairs) < 3:
                break
            xs, ys = np.array([p[0] for p in pairs]), np.array([p[1] for p in pairs])
            a2, b2 = np.polyfit(xs, ys, 1)
            if not 0.6 <= a2 <= 1.6:
                break
            a, b = float(a2), float(b2)
            match = align(mc, bc, a, b, window)
        for k, j in enumerate(match):
            if j is None:
                continue
            i = col[k]
            b0, b1 = bands[j]
            result[i] = {"y0": float(b0), "y1": float(b1), "shiftPx": round(bc[j] - mc[k], 1)}
    return result


def band_alignment(boxes: list[list[float]], img: np.ndarray) -> float | None:
    """Share of model boxes whose vertical extent already sits on a printed ink band of their column."""
    hits, n = 0, 0
    for col in columns_of(boxes):
        x0, x1 = min(boxes[i][0] for i in col), max(boxes[i][2] for i in col)
        bands = ink_bands(img, x0, x1)
        for i in col:
            b = boxes[i]
            n += 1
            best = max((min(b[3], e) - max(b[1], s)) / max(1.0, min(b[3] - b[1], e - s)) for s, e in bands) if bands else 0
            hits += best >= 0.6
    return hits / n if n else None


SNAP_ALIGNED_SHARE = 0.75


def validate_tile_items(raw_items: list[dict], img: np.ndarray, tile: dict, page_h: float, snap: bool | str = True) -> tuple[list[dict], dict]:
    h, w = img.shape
    conv, conv_scores = choose_convention(raw_items, img)
    out, rejected = [], []
    model_boxes = []
    for it in raw_items:
        b = bbox_of(it)
        if b and conv == "norm1000":
            b = [b[0] * w / 1000, b[1] * h / 1000, b[2] * w / 1000, b[3] * h / 1000]
        model_boxes.append([min(b[0], b[2]), min(b[1], b[3]), max(b[0], b[2]), max(b[1], b[3])] if b else None)
    valid_idx = [k for k, b in enumerate(model_boxes) if b and b[2] - b[0] >= 2 and b[3] - b[1] >= 2]
    alignment = band_alignment([model_boxes[k] for k in valid_idx], img) if valid_idx else None
    if snap == "auto":
        # Snap only a tile whose model boxes miss the printed bands (the 3B pitch drift); an aligned
        # tile keeps its model boxes, because snapping dense rows can move a box onto a neighbour.
        snap = alignment is not None and alignment < SNAP_ALIGNED_SHARE
    snaps = dict(zip(valid_idx, snap_to_bands([model_boxes[k] for k in valid_idx], img))) if snap else {}
    for k, it in enumerate(raw_items):
        text = str(it.get("text_content", it.get("text", "")) or "")
        b = bbox_of(it)
        flags = []
        if not text.strip():
            rejected.append({"k": k, "reason": "empty_text"})
            continue
        if not b:
            rejected.append({"k": k, "reason": "no_bbox", "text": text})
            continue
        if conv == "norm1000":
            b = [b[0] * w / 1000, b[1] * h / 1000, b[2] * w / 1000, b[3] * h / 1000]
        x0, y0, x1, y1 = min(b[0], b[2]), min(b[1], b[3]), max(b[0], b[2]), max(b[1], b[3])
        outside = max(0, -x0) + max(0, -y0) + max(0, x1 - w) + max(0, y1 - h)
        if outside > 0.05 * max(w, h):
            flags.append("out_of_bounds")
        x0, y0, x1, y1 = max(0, x0), max(0, y0), min(w, x1), min(h, y1)
        if x1 - x0 < 2 or y1 - y0 < 2:
            rejected.append({"k": k, "reason": "degenerate_box", "text": text})
            continue
        model_px = (x0, y0, x1, y1)
        sn = snaps.get(k)
        if sn:
            pad = 0.1 * (x1 - x0)
            x0, x1 = max(0, x0 - pad), min(w, x1 + pad)
            y0, y1 = sn["y0"], sn["y1"]
            flags.append("snapped_to_ink_band")
        ink = ink_ratio(img, x0, y0, x1, y1)
        if ink < MIN_INK:
            rejected.append({"k": k, "reason": "no_ink_under_box", "text": text, "bbox": [x0, y0, x1, y1]})
            continue
        t = tighten(img, x0, y0, x1, y1) or (x0, y0, x1, y1)
        edge = min(t[0], t[1], w - t[2], h - t[3]) <= EDGE_PX
        if edge:
            flags.append("tile_edge")
        px = {"x": t[0], "y": t[1], "w": t[2] - t[0], "h": t[3] - t[1]}
        page_box = px_to_page(px, tile["frame"], page_h)
        cat = it.get("category") if it.get("category") in CATEGORIES else "other"
        alts = [str(a) for a in (it.get("alternatives") or []) if isinstance(a, (str, int, float)) and str(a).strip() and str(a) != text]
        out.append({
            "tileId": tile["id"], "k": k, "text": text, "category": cat,
            "group": it.get("group") if isinstance(it.get("group"), int) else None,
            "uncertain": bool(it.get("uncertain")) or bool(alts), "alternatives": alts,
            "pxRaw": [round(v, 1) for v in b], "px": {kk: round(float(v), 1) for kk, v in px.items()},
            "box": round_box(page_box), "inkRatio": round(ink, 4),
            "modelBox": round_box(px_to_page({"x": model_px[0], "y": model_px[1], "w": model_px[2] - model_px[0], "h": model_px[3] - model_px[1]}, tile["frame"], page_h)),
            "snapShiftPx": sn["shiftPx"] if sn else None, "edgeDistancePx": round(float(min(t[0], t[1], w - t[2], h - t[3])), 1),
            "flags": flags,
        })
    return out, {"convention": conv, "conventionScores": conv_scores, "rejected": rejected, "kept": len(out), "returned": len(raw_items),
                 "bandAlignment": None if alignment is None else round(alignment, 3), "snapped": bool(snap)}


ROW_JOIN_MAX_GAP_H = 6.0


def join_row_cells(items: list[dict], tile: dict, page_h: float) -> list[dict]:
    """Join cells the model put in one group and on one printed row (label + value, list number + text).

    Text is concatenated left to right with one space and never otherwise changed; the pieces stay in
    `cells` for provenance. Items without a group, on different rows or far apart stay separate.
    """
    def row_match(a, b):
        pa, pb = a["px"], b["px"]
        h = min(pa["h"], pb["h"])
        overlap = min(pa["y"] + pa["h"], pb["y"] + pb["h"]) - max(pa["y"], pb["y"])
        gap = pb["x"] - (pa["x"] + pa["w"])
        return overlap >= 0.5 * h and -0.5 * h <= gap <= ROW_JOIN_MAX_GAP_H * max(pa["h"], pb["h"])

    out, used = [], set()
    by_group: dict[int, list[dict]] = {}
    for it in items:
        if it["group"] is not None and not it.get("vertical"):
            by_group.setdefault(it["group"], []).append(it)
    for it in items:
        if id(it) in used:
            continue
        if it["group"] is None:
            out.append(it)
            continue
        chain = [it]
        used.add(id(it))
        for cand in sorted(by_group.get(it["group"], []), key=lambda c: c["px"]["x"]):
            if id(cand) in used or cand["px"]["x"] < chain[-1]["px"]["x"]:
                continue
            if row_match(chain[-1], cand):
                chain.append(cand)
                used.add(id(cand))
        if len(chain) == 1:
            out.append(it)
            continue
        x0 = min(c["px"]["x"] for c in chain); y0 = min(c["px"]["y"] for c in chain)
        x1 = max(c["px"]["x"] + c["px"]["w"] for c in chain); y1 = max(c["px"]["y"] + c["px"]["h"] for c in chain)
        px = {"x": x0, "y": y0, "w": x1 - x0, "h": y1 - y0}
        mb = [c["modelBox"] for c in chain]
        mx0, my0 = min(b["x"] for b in mb), min(b["y"] for b in mb)
        mx1, my1 = max(b["x"] + b["width"] for b in mb), max(b["y"] + b["height"] for b in mb)
        texts = [c["text"] for c in chain]
        alts = [" ".join(texts[:i] + [a] + texts[i + 1:]) for i, c in enumerate(chain) for a in c["alternatives"]]
        out.append({
            **chain[0], "text": " ".join(texts), "uncertain": any(c["uncertain"] for c in chain), "alternatives": alts,
            "px": {k: round(float(v), 1) for k, v in px.items()}, "box": round_box(px_to_page(px, tile["frame"], page_h)),
            "modelBox": round_box({"x": mx0, "y": my0, "width": mx1 - mx0, "height": my1 - my0}),
            "inkRatio": min(c["inkRatio"] for c in chain), "edgeDistancePx": min(c["edgeDistancePx"] for c in chain),
            "flags": sorted({f for c in chain for f in c["flags"]} | {"joined_row_cells"}),
            "cells": [{"k": c["k"], "text": c["text"], "px": c["px"]} for c in chain],
        })
    return out


def norm_text(s: str) -> str:
    s = s.upper().replace("″", '"').replace("“", '"').replace("”", '"').replace("’", "'").replace("‘", "'").replace("–", "-").replace("—", "-")
    return re.sub(r"\s+", "", s)


def is_vertical(b: dict, text: str) -> bool:
    return len(text.replace(" ", "")) >= 2 and b["height"] > 1.6 * b["width"]


def merge_tiles(items: list[dict]) -> list[dict]:
    """Cluster readings of one printed line across overlapping tiles."""
    order = sorted(items, key=lambda i: (-i["edgeDistancePx"], i["tileId"], i["k"]))
    clusters: list[dict] = []
    for it in order:
        v = is_vertical(it["box"], it["text"])
        home = None
        for c in clusters:
            if c["vertical"] != v or it["tileId"] in c["tiles"]:
                continue
            if overlap_smaller(c["box"], it["box"]) >= 0.6:
                home = c
                break
        if home is None:
            clusters.append({"vertical": v, "box": it["box"], "members": [it], "tiles": {it["tileId"]}})
        else:
            home["members"].append(it)
            home["tiles"].add(it["tileId"])
    lines = []
    for n, c in enumerate(clusters):
        rep = c["members"][0]
        rk = norm_text(rep["text"])
        agree, cut, conflicts = 1, [], []
        for m in c["members"][1:]:
            mk = norm_text(m["text"])
            if mk == rk:
                agree += 1
            elif "tile_edge" in m["flags"] and (mk in rk or rk.startswith(mk[:-1]) or mk[:-1] in rk):
                cut.append(m["text"])
            elif "tile_edge" in rep["flags"] and "tile_edge" not in m["flags"]:
                conflicts.append(m["text"])
            else:
                conflicts.append(m["text"])
        alternatives = list(dict.fromkeys(rep["alternatives"] + [t for t in conflicts if norm_text(t) != rk]))
        conf = 0.6 + (0.2 if agree >= 2 else 0) - (0.3 if rep["uncertain"] else 0) - (0.3 if conflicts else 0) - (0.15 if rep["flags"] else 0)
        lines.append({
            "lid": f"L{n:04d}", "text": rep["text"], "category": rep["category"], "box": rep["box"], "modelBox": rep["modelBox"],
            "snapShiftPx": rep["snapShiftPx"], "vertical": c["vertical"],
            "uncertain": rep["uncertain"] or bool(conflicts), "alternatives": alternatives, "conflict": bool(conflicts),
            "confidence": round(min(0.99, max(0.05, conf)), 2),
            "confidenceBasis": {"tileReads": len(c["members"]), "agreeingReads": agree, "selfReportedUncertain": rep["uncertain"], "conflictingReads": len(conflicts), "flags": rep["flags"]},
            "provenance": [{"tileId": m["tileId"], "k": m["k"], "text": m["text"], "px": m["px"], "group": m["group"]} for m in c["members"]],
            "cutReadings": cut,
        })
    lines.sort(key=lambda l: (-round(l["box"]["y"] + l["box"]["height"], 0), l["box"]["x"]))
    for n, l in enumerate(lines):
        l["lid"] = f"L{n:04d}"
    return lines


def group_annotations(lines: list[dict]) -> list[dict]:
    """Lines sharing a Qwen group id in any tile form one annotation (union-find across tiles)."""
    parent = {l["lid"]: l["lid"] for l in lines}

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    by_group: dict = {}
    for l in lines:
        for p in l["provenance"]:
            if p["group"] is not None:
                by_group.setdefault((p["tileId"], p["group"]), []).append(l["lid"])
    for members in by_group.values():
        for m in members[1:]:
            parent[find(m)] = find(members[0])
    groups: dict = {}
    for l in lines:
        groups.setdefault(find(l["lid"]), []).append(l)
    anns = []
    for n, ls in enumerate(groups.values()):
        ls.sort(key=lambda l: (-(l["box"]["y"] + l["box"]["height"]), l["box"]["x"]))
        anns.append({"aid": f"N{n:04d}", "lines": [l["lid"] for l in ls], "box": round_box(union([l["box"] for l in ls])),
                     "categories": sorted({l["category"] for l in ls})})
    return anns


def attach_text_layer(lines: list[dict], text_layer: dict) -> None:
    tl = text_layer.get("lines", [])
    for l in lines:
        hits = [t for t in tl if overlap_smaller(t["box"], l["box"]) >= 0.5]
        if hits:
            joined = " ".join(t["text"] for t in sorted(hits, key=lambda t: t["box"]["x"]))
            l["textLayer"] = {"text": joined, "agrees": norm_text(joined) == norm_text(l["text"])}


DISCIPLINES = {"A": "Architectural", "S": "Structural", "M": "Mechanical", "E": "Electrical", "P": "Plumbing", "FP": "Fire Protection",
               "G": "General", "CV": "Civil", "DM": "Demolition", "MD": "Mechanical Demolition", "EN": "Energy", "EQ": "Equipment"}


def sheet_metadata(sheet_id: str, text_layer: dict, page_w: float) -> dict:
    prefix = re.match(r"[A-Z]+", sheet_id).group(0) if re.match(r"[A-Z]+", sheet_id) else ""
    tb = [l for l in text_layer.get("lines", []) if l["box"]["x"] > 0.85 * page_w]
    dates = [m.group(0) for l in tb for m in re.finditer(r"\b\d{1,2}/\d{1,2}/\d{2,4}\b", l["text"])]
    rev_rows = [l["text"] for l in tb if re.match(r"^\s*(\d{1,2}|[A-Z])\s+\S.*\d{1,2}/\d{1,2}/\d{2,4}", l["text"])]
    return {
        "sheetId": sheet_id, "discipline": DISCIPLINES.get(prefix, prefix or "unknown"),
        "revision": {"rows": rev_rows, "dates": sorted(set(dates)), "basis": "text layer, title-block band x > 85% of width (heuristic)",
                     "status": "found" if rev_rows else "not determined"},
    }


def fetch_tile(client: QwenClient, stage1: dict, stage1_dir: Path, raw_dir: Path, tile_id: str) -> tuple[dict, bool]:
    """Raw model reply for one tile (or 'overview'), from cache when present. Returns (reply, from_cache)."""
    cache = raw_dir / f"{tile_id}.json"
    if cache.exists():
        return json.loads(cache.read_text()), True
    if tile_id == "overview":
        f = stage1["overview"]["frame"]
        file, prompt = stage1["overview"]["file"], OVERVIEW_PROMPT.format(w=f["width"], h=f["height"])
    else:
        t = next(t for t in stage1["tiles"] if t["id"] == tile_id)
        f, file = t["frame"], t["file"]
        prompt = TILE_PROMPT.format(w=f["width"], h=f["height"])
    resp = client.chat_image(stage1_dir / file, f["width"], f["height"], prompt, tag=f"{stage1['sheetId']}/{tile_id}")
    resp["promptVersion"] = PROMPT_VERSION
    raw_dir.mkdir(parents=True, exist_ok=True)
    cache.write_text(json.dumps(resp, indent=1))
    return resp, False


def run_stage2(stage1: dict, stage1_dir: Path, out_dir: Path, client: QwenClient, tile_ids: list[str] | None = None,
               overview: bool = True, log=print, cache_only: bool = False, snap: bool | str = True, variant: str = "",
               postprocess=None) -> dict:
    out_dir.mkdir(parents=True, exist_ok=True)
    raw_dir = out_dir / "raw" / client.backend
    raw_dir.mkdir(parents=True, exist_ok=True)
    page_h, page_w = stage1["page"]["height"], stage1["page"]["width"]
    tiles = [t for t in stage1["tiles"] if not t["skipped"] and (tile_ids is None or t["id"] in tile_ids)]
    if cache_only:
        tiles = [t for t in tiles if (raw_dir / f"{t['id']}.json").exists()]
        overview = overview and (raw_dir / "overview.json").exists()
    items, tile_reports, calls = [], [], []
    for t in tiles:
        resp, cached = fetch_tile(client, stage1, stage1_dir, raw_dir, t["id"])
        if not cached:
            log(f"  {stage1['sheetId']} {t['id']} {resp['latencyS']}s in={resp['promptTokens']} out={resp['completionTokens']} finish={resp['finishReason']}")
        calls.append({k: resp.get(k) for k in ("latencyS", "promptTokens", "completionTokens", "costUsd", "finishReason")} | {"tileId": t["id"]})
        raw, parse = parse_json_list(resp["text"])
        img = load_gray(stage1_dir / t["file"])
        kept, rep = validate_tile_items(raw, img, t, page_h, snap=snap)
        kept = join_row_cells(kept, t, page_h)
        rep["joinedRows"] = sum("joined_row_cells" in k["flags"] for k in kept)
        items.extend(kept)
        tile_reports.append({"tileId": t["id"], "parse": parse, "truncated": resp.get("finishReason") == "length", **rep})

    ov = None
    if overview:
        ov, _ = fetch_tile(client, stage1, stage1_dir, raw_dir, "overview")
        calls.append({k: ov.get(k) for k in ("latencyS", "promptTokens", "completionTokens", "costUsd", "finishReason")} | {"tileId": "overview"})

    lines = merge_tiles(items)
    attach_text_layer(lines, stage1["textLayer"])
    validation = postprocess(lines, stage1) if postprocess else None
    anns = group_annotations(lines)
    layout = None
    if ov:
        obj = parse_json_object(ov["text"]) or {}
        f = stage1["overview"]["frame"]

        def to_page(b):
            if not (isinstance(b, list) and len(b) == 4 and all(isinstance(v, (int, float)) for v in b)):
                return None
            x0, y0, x1, y1 = b
            return round_box(px_to_page({"x": min(x0, x1), "y": min(y0, y1), "w": abs(x1 - x0), "h": abs(y1 - y0)}, f, page_h))

        layout = {
            "titleBlock": to_page(obj.get("title_block")), "sheetNumber": obj.get("sheet_number"), "sheetTitle": obj.get("sheet_title"),
            "details": [{"detailNumber": str(d.get("detail_number", "")), "title": d.get("title", ""), "box": to_page(d.get("bbox_2d"))} for d in obj.get("details", []) if isinstance(d, dict)],
            "schedules": [{"title": s.get("title", ""), "box": to_page(s.get("bbox_2d"))} for s in obj.get("schedules", []) if isinstance(s, dict)],
            "gridlines": [str(g) for g in obj.get("gridlines", [])][:60],
            "source": "qwen overview pass (low resolution; layout only)",
        }

    result = {
        "version": STAGE2_VERSION, "promptVersion": PROMPT_VERSION, "backend": client.backend, "model": client.cfg["model"], "runtime": client.cfg["runtime"],
        **sheet_metadata(stage1["sheetId"], stage1["textLayer"], page_w),
        "pdfName": stage1["pdfName"], "sha256": stage1["sha256"], "page": stage1["page"],
        "coverage": {"tilesTotal": len(stage1["tiles"]), "tilesBlank": sum(t["skipped"] for t in stage1["tiles"]), "tilesRead": len(tiles),
                     "tileIds": None if tile_ids is None else tile_ids},
        "lines": lines, "annotations": anns, "layout": layout, "tileReports": tile_reports, "calls": calls,
        "totals": {"calls": len(calls), "latencyS": round(sum(c["latencyS"] or 0 for c in calls), 1),
                   "promptTokens": sum(c["promptTokens"] or 0 for c in calls), "completionTokens": sum(c["completionTokens"] or 0 for c in calls),
                   "costUsd": round(sum(c["costUsd"] or 0 for c in calls), 4),
                   "linesKept": len(lines), "readsKept": len(items), "readsRejected": sum(len(r["rejected"]) for r in tile_reports)},
        "build": {"snap": snap, "variant": variant or None, "validation": validation},
    }
    suffix = ("" if len(tiles) == sum(not t["skipped"] for t in stage1["tiles"]) else ".subset") + (f".{variant}" if variant else "")
    (out_dir / f"sheet-index.{client.backend}{suffix}.json").write_text(json.dumps(result, indent=1))
    return result
