#!/usr/bin/env python3
"""Qwen spatial audit, stages 1-2 (and the crop renderer used by stage 3).

  python run.py stage1   [--sheets A-3.06-00,...]                 PyMuPDF extraction + 300 DPI tiles (offline)
  python run.py estimate --backend openrouter-72b [--scope gt]    token and USD estimate, no calls
  python run.py stage2   --backend local-3b [--scope gt|full]     Qwen2.5-VL extraction + sheet index
  python run.py index82                                           text-layer index of every PDF in the set (offline)
  python run.py crops    --pairs <pairs.json>                     render source/target crops for cross-sheet pairs

Paid backends need --approve-paid and --max-usd. Outputs: eval/drawing-dataset/out/qwen-spatial-audit/.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from pathlib import Path

import pymupdf

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from qsa.geometry import overlap_smaller  # noqa: E402
from qsa.qwen_client import BACKENDS, QwenClient, estimate_cost  # noqa: E402
from qsa.stage1 import render_crop, run_stage1, text_layer  # noqa: E402
from qsa.stage2 import run_stage2  # noqa: E402

DATASET = HERE.parent
OUT = DATASET / "out" / "qwen-spatial-audit"
RESEARCH = DATASET / "out" / "gpt-5.4-audit-3364698b" / "ocr-research-final"
GT_DIR = RESEARCH / "implementation" / "data" / "gt"
PDF_DIR = Path(os.environ.get("QSA_PDF_DIR", "/Users/javerianaveed/Desktop/008-0003 New York Ave Wash DC_PERMIT REV5 SET_2026-10-15_Individual"))
PRIMARY = ["A-3.06-00", "A-4.00-00", "A-1.01-00", "A-6.00-00", "S-201.00"]
# Output-token assumption for estimates: measured mean of the local run when available, else this.
DEFAULT_OUT_TOKENS = 900


def sheets_arg(v: str | None) -> list[str]:
    return [s.strip() for s in v.split(",")] if v else PRIMARY


def gt_scope_boxes(sheet: str) -> list[dict] | None:
    p = GT_DIR / f"{sheet}.ground-truth.json"
    if not p.exists():
        return None
    gt = json.loads(p.read_text())
    if gt.get("scope") == "windows":
        return [{"x": w["x"], "y": w["y"], "width": w["width"], "height": w["height"]} for w in gt["windows"]]
    return None


def tiles_in_scope(stage1: dict, scope: str) -> list[str] | None:
    if scope == "full":
        return None
    boxes = gt_scope_boxes(stage1["sheetId"])
    if boxes is None:
        return None
    return [t["id"] for t in stage1["tiles"] if not t["skipped"] and any(overlap_smaller(t["pageBox"], b) > 0 for b in boxes)]


def cmd_stage1(a):
    for s in sheets_arg(a.sheets):
        t0 = time.time()
        m = run_stage1(PDF_DIR / f"{s}.pdf", s, OUT / "sheets" / s / "stage1", force=a.force)
        read = sum(not t["skipped"] for t in m["tiles"])
        print(f"{s}: tiles={len(m['tiles'])} nonblank={read} textLayerWords={len(m['textLayer']['words'])} {time.time() - t0:.1f}s")


def cmd_estimate(a):
    rows, total = [], {"calls": 0, "inputTokens": 0, "outputTokens": 0, "usd": 0.0}
    for s in sheets_arg(a.sheets):
        m = json.loads((OUT / "sheets" / s / "stage1" / "stage1.json").read_text())
        ids = tiles_in_scope(m, a.scope)
        tiles = [t for t in m["tiles"] if not t["skipped"] and (ids is None or t["id"] in ids)]
        imgs = [(t["frame"]["width"], t["frame"]["height"]) for t in tiles] + [(m["overview"]["frame"]["width"], m["overview"]["frame"]["height"])]
        e = estimate_cost(a.backend, imgs, a.out_tokens)
        rows.append({"sheet": s, **e})
        for k in total:
            total[k] += e[k]
    total["usd"] = round(total["usd"], 4)
    print(json.dumps({"backend": a.backend, "model": BACKENDS[a.backend]["model"], "scope": a.scope, "outTokensPerCall": a.out_tokens, "sheets": rows, "total": total}, indent=1))


def ledger_path(backend: str) -> Path:
    return OUT / "budget" / f"{backend}.ledger.jsonl"


def cmd_bench(a):
    """Fill the raw-reply cache for a paid or local backend under one spend cap, then rebuild sheet indexes from cache.

    Order: ground-truth tiles of every sheet, then overviews, then the remaining non-blank tiles. Cached
    tiles are never re-requested. Stops submitting at the first budget refusal; results so far stay valid.
    """
    import concurrent.futures as cf
    import threading

    from qsa.qwen_client import BudgetExceeded
    from qsa.stage2 import fetch_tile

    client = QwenClient(a.backend, approve_paid=a.approve_paid, max_usd=a.max_usd, max_tokens=a.max_tokens, timeout_s=a.timeout,
                        ledger_path=ledger_path(a.backend))
    sheets = sheets_arg(a.sheets)
    stage1s = {s: json.loads((OUT / "sheets" / s / "stage1" / "stage1.json").read_text()) for s in sheets}
    jobs = []
    for prio in (0, 1, 2):
        for s in sheets:
            m = stage1s[s]
            gt = set(tiles_in_scope(m, "gt") or [t["id"] for t in m["tiles"] if not t["skipped"]])
            if a.tiles:
                ids = [t for t in a.tiles.split(",")] if prio == 0 else []
            elif prio == 0:
                ids = [t["id"] for t in m["tiles"] if t["id"] in gt]
            elif prio == 1:
                ids = [] if a.no_overview else ["overview"]
            else:
                ids = [] if a.scope == "gt" else [t["id"] for t in m["tiles"] if not t["skipped"] and t["id"] not in gt]
            jobs += [(prio, s, i) for i in ids]
    raw = {s: OUT / "sheets" / s / "stage2" / "raw" / a.backend for s in sheets}
    cached = [j for j in jobs if (raw[j[1]] / f"{j[2]}.json").exists()]
    todo = [j for j in jobs if j not in cached]
    prog_path = OUT / "budget" / f"{a.backend}.progress.json"
    state = {"completed": [], "failed": [], "skipped": [], "cachedBefore": [f"{s}/{i}" for _, s, i in cached]}
    lock, stop = threading.Lock(), threading.Event()
    t0 = time.time()
    if client.ledger:
        print(f"key usage at start: {client.key_usage()}; ledger settled ${client.ledger.settled:.4f}; cap ${a.max_usd:.2f}")
    print(f"jobs={len(jobs)} cached={len(cached)} to_request={len(todo)} workers={a.workers}")

    def write_progress():
        done = [c for c in state["completed"]]
        mean_cost = sum(c["usd"] for c in done) / len(done) if done else None
        left = len(todo) - len(done) - len(state["failed"]) - len(state["skipped"])
        out = {"backend": a.backend, "capUsd": a.max_usd, "elapsedS": round(time.time() - t0, 1),
               "ledgerSettledUsd": round(client.spent_usd, 6), "providerUsageUsd": client.ledger.provider_usage if client.ledger else None,
               "meanUsdPerCall": mean_cost, "remainingCalls": left, "estimatedRemainingUsd": round(mean_cost * left, 4) if mean_cost else None,
               "counts": {k: len(v) for k, v in state.items()}, **state}
        prog_path.parent.mkdir(parents=True, exist_ok=True)
        prog_path.write_text(json.dumps(out, indent=1))

    def work(job):
        prio, s, tid = job
        if stop.is_set():
            with lock:
                state["skipped"].append({"tile": f"{s}/{tid}", "priority": prio, "reason": "budget stop"})
            return
        try:
            resp, _ = fetch_tile(client, stage1s[s], OUT / "sheets" / s / "stage1", raw[s], tid)
        except BudgetExceeded as e:
            stop.set()
            with lock:
                state["skipped"].append({"tile": f"{s}/{tid}", "priority": prio, "reason": str(e)})
            return
        except Exception as e:  # noqa: BLE001 - recorded per tile; the run continues
            with lock:
                state["failed"].append({"tile": f"{s}/{tid}", "priority": prio, "error": str(e)[:300]})
            return
        with lock:
            state["completed"].append({"tile": f"{s}/{tid}", "priority": prio, "usd": resp["costUsd"], "reportedUsd": resp.get("reportedCostUsd"),
                                       "in": resp["promptTokens"], "out": resp["completionTokens"], "latencyS": resp["latencyS"], "finish": resp["finishReason"]})
            n = len(state["completed"])
            if n % 10 == 0 or n == len(todo):
                if client.ledger and n % 40 == 0:
                    try:
                        client.key_usage()
                    except Exception:  # noqa: BLE001 - the local ledger still bounds spend
                        pass
                write_progress()
                print(f"  {n}/{len(todo)} done, failed={len(state['failed'])}, ledger ${client.spent_usd:.4f}, {time.time() - t0:.0f}s", flush=True)

    with cf.ThreadPoolExecutor(max_workers=a.workers) as ex:
        list(ex.map(work, todo))
    if client.ledger:
        try:
            print(f"key usage at end: {client.key_usage()}")
        except Exception as e:  # noqa: BLE001
            print(f"key usage check failed: {e}")
    write_progress()
    for s in sheets:
        d = OUT / "sheets" / s
        r = run_stage2(stage1s[s], d / "stage1", d / "stage2", client, tile_ids=[t["id"] for t in stage1s[s]["tiles"]], overview=True, cache_only=True)
        print(f"{s}: tilesRead={r['coverage']['tilesRead']} lines={r['totals']['linesKept']} rejected={r['totals']['readsRejected']}")
    print(json.dumps({k: len(v) for k, v in state.items()}), f"ledger ${client.spent_usd:.4f} of ${a.max_usd:.2f}")


class CacheOnlyClient:
    """Rebuilds sheet indexes from cached replies; any request is an error (no spend)."""

    def __init__(self, backend: str):
        self.backend, self.cfg, self.ledger = backend, BACKENDS[backend], None

    def chat_image(self, *_, **__):
        raise RuntimeError("cache-only rebuild: reply not cached")


def cmd_rebuild(a):
    from qsa.validate import validate_lines

    client = CacheOnlyClient(a.backend)
    snap = {"always": True, "auto": "auto", "off": False}[a.snap]
    for s in sheets_arg(a.sheets):
        d = OUT / "sheets" / s
        m = json.loads((d / "stage1" / "stage1.json").read_text())
        ids = a.tiles.split(",") if a.tiles else None
        r = run_stage2(m, d / "stage1", d / "stage2", client, tile_ids=ids, overview=True, cache_only=True, snap=snap,
                       variant=a.variant, postprocess=validate_lines if a.validate else None)
        snapped = sum(t.get("snapped", False) for t in r["tileReports"])
        print(f"{s}: tiles={r['coverage']['tilesRead']} snappedTiles={snapped} lines={r['totals']['linesKept']} validation={r['build']['validation']}")


def cmd_stage2(a):
    client = QwenClient(a.backend, approve_paid=a.approve_paid, max_usd=a.max_usd, max_tokens=a.max_tokens, ledger_path=ledger_path(a.backend))
    for s in sheets_arg(a.sheets):
        d = OUT / "sheets" / s
        m = json.loads((d / "stage1" / "stage1.json").read_text())
        ids = tiles_in_scope(m, a.scope)
        if a.tiles:
            ids = a.tiles.split(",")
        print(f"{s}: {len(ids) if ids is not None else 'all'} tiles, backend={a.backend}")
        r = run_stage2(m, d / "stage1", d / "stage2", client, tile_ids=ids, overview=not a.no_overview)
        print(f"{s}: lines={r['totals']['linesKept']} rejected={r['totals']['readsRejected']} calls={r['totals']['calls']} {r['totals']['latencyS']}s ${r['totals']['costUsd']}")


SHEET_RE = re.compile(r"\b([A-Z]{1,2})-?(\d{1,3})(?:\.(\d{1,2}))?\b")


def canonical_sheet(label: str) -> str | None:
    """`A-6.00-00.pdf`, `A-6.00`, `A600`, `FP200 .pdf` -> canonical key (`A-6.00`, `FP-200`)."""
    s = label.upper().replace(".PDF", "").strip()
    m = re.match(r"^([A-Z]{1,2})-?(\d{1,3})(?:\.(\d{1,2}))?", s)
    if not m:
        return None
    pre, num, dec = m.groups()
    if pre == "S" and len(num) == 3:
        return f"S-{num}"
    if dec is None and len(num) == 3 and pre in {"A", "E", "M", "P"}:
        num, dec = num[0], num[1:]
    return f"{pre}-{int(num)}.{dec}" if dec is not None else f"{pre}-{num}"


SCALE_VALUE = re.compile(r"(N\.?T\.?S\.?|NO SCALE|\d[\d\-/ ]*\"\s*=?\s*\d+'-\d+\")", re.I)


def detail_titles(lines: list[dict]) -> list[dict]:
    """Detail title groups from the text layer: `SCALE:` then an optional number, the title and the scale.

    Lines are taken in content-stream order; every member must lie within 400 pt of the `SCALE:` label.
    """
    out = []
    for i, l in enumerate(lines):
        if l["text"].strip().upper() != "SCALE:":
            continue
        near = [m for m in lines[i + 1:i + 5] if abs(m["box"]["x"] - l["box"]["x"]) < 400 and abs(m["box"]["y"] - l["box"]["y"]) < 400]
        number = next((m for m in near[:2] if re.fullmatch(r"\d{1,2}[A-Z]?", m["text"].strip())), None)
        rest = [m for m in near if m is not number]
        scale = next((m for m in rest if SCALE_VALUE.fullmatch(m["text"].strip())), None)
        title = next((m for m in rest if m is not scale and m["text"].strip().upper() != "SCALE:" and re.search(r"[A-Z]{3}", m["text"])), None)
        if not title:
            continue
        members = [b for b in (l, number, title, scale) if b]
        x0 = min(b["box"]["x"] for b in members); y0 = min(b["box"]["y"] for b in members)
        x1 = max(b["box"]["x"] + b["box"]["width"] for b in members); y1 = max(b["box"]["y"] + b["box"]["height"] for b in members)
        out.append({"detail": number["text"].strip() if number else None, "title": title["text"].strip(), "scale": scale["text"].strip() if scale else None,
                    "titleBox": {"x": round(x0, 2), "y": round(y0, 2), "width": round(x1 - x0, 2), "height": round(y1 - y0, 2)}, "source": "pdf_text_layer"})
    return out


def cmd_index82(a):
    sheets = []
    for f in sorted(PDF_DIR.iterdir()):
        if f.suffix.lower() != ".pdf" or f.name.startswith("._"):
            if f.is_file():
                sheets.append({"fileName": f.name, "status": "not_a_pdf_drawing"})
            continue
        doc = pymupdf.open(f)
        page = doc[0]
        tl = text_layer(page, page.rect.height)
        w = page.rect.width
        tb = [l for l in tl["lines"] if l["box"]["x"] > 0.85 * w]
        tokens = sorted({canonical_sheet(m.group(0)) for l in tb for m in SHEET_RE.finditer(l["text"]) if canonical_sheet(m.group(0))})
        details = detail_titles(tl["lines"])
        sheets.append({
            "fileName": f.name, "sheetKey": canonical_sheet(f.name), "details": details,
            "titleBlockSheetTokens": tokens, "pages": len(doc), "page": [page.rect.width, page.rect.height],
            "textLayerLines": len(tl["lines"]), "status": "indexed",
        })
    out = {"source": str(PDF_DIR), "files": len(sheets), "pdfs": sum(s["status"] == "indexed" for s in sheets),
           "pdfsWithDetailTitles": sum(bool(s.get("details")) for s in sheets), "sheets": sheets,
           "note": "Sheet keys from filenames (canonical_sheet). Detail titles are text-layer groups (SCALE: / number / title / scale); "
                   "the sheet title in the title block is outlined geometry on this set and is not read here."}
    (OUT / "index82.json").write_text(json.dumps(out, indent=1))
    print(f"indexed {out['pdfs']} PDFs of {out['files']} files -> {OUT / 'index82.json'}")


def cmd_crops(a):
    pairs = json.loads(Path(a.pairs).read_text())
    crop_dir = OUT / "crops"
    for p in pairs["pairs"]:
        for side in ("source", "target"):
            s = p.get(side) or {}
            if not s.get("cropBox") or not s.get("fileName"):
                continue
            name = f"{p['pairId']}.{side}.png"
            s["crop"] = render_crop(PDF_DIR / s["fileName"], s["cropBox"], crop_dir / name, dpi=a.dpi)
            s["crop"]["file"] = f"crops/{name}"
    Path(a.pairs).write_text(json.dumps(pairs, indent=1))
    print(f"rendered crops for {len(pairs['pairs'])} pairs -> {crop_dir}")


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("stage1"); p.add_argument("--sheets"); p.add_argument("--force", action="store_true"); p.set_defaults(fn=cmd_stage1)
    p = sub.add_parser("estimate"); p.add_argument("--sheets"); p.add_argument("--backend", default="openrouter-72b", choices=BACKENDS)
    p.add_argument("--scope", default="full", choices=["full", "gt"]); p.add_argument("--out-tokens", type=int, default=DEFAULT_OUT_TOKENS); p.set_defaults(fn=cmd_estimate)
    p = sub.add_parser("stage2"); p.add_argument("--sheets"); p.add_argument("--backend", default="local-3b", choices=BACKENDS)
    p.add_argument("--scope", default="gt", choices=["full", "gt"]); p.add_argument("--tiles"); p.add_argument("--no-overview", action="store_true")
    p.add_argument("--approve-paid", action="store_true"); p.add_argument("--max-usd", type=float, default=0.0); p.add_argument("--max-tokens", type=int, default=2048)
    p.set_defaults(fn=cmd_stage2)
    p = sub.add_parser("bench"); p.add_argument("--sheets"); p.add_argument("--backend", required=True, choices=BACKENDS)
    p.add_argument("--scope", default="full", choices=["full", "gt"]); p.add_argument("--tiles"); p.add_argument("--no-overview", action="store_true")
    p.add_argument("--approve-paid", action="store_true"); p.add_argument("--max-usd", type=float, default=0.0); p.add_argument("--max-tokens", type=int, default=4096)
    p.add_argument("--workers", type=int, default=4); p.add_argument("--timeout", type=int, default=300)
    p.set_defaults(fn=cmd_bench)
    p = sub.add_parser("rebuild"); p.add_argument("--sheets"); p.add_argument("--backend", required=True, choices=BACKENDS); p.add_argument("--tiles")
    p.add_argument("--snap", default="always", choices=["always", "auto", "off"]); p.add_argument("--validate", action="store_true")
    p.add_argument("--variant", default=""); p.set_defaults(fn=cmd_rebuild)
    p = sub.add_parser("index82"); p.set_defaults(fn=cmd_index82)
    p = sub.add_parser("crops"); p.add_argument("--pairs", required=True); p.add_argument("--dpi", type=int, default=200); p.set_defaults(fn=cmd_crops)
    a = ap.parse_args()
    a.fn(a)


if __name__ == "__main__":
    main()
