"""Stage 1: PyMuPDF extraction and high-resolution tiling.

For one PDF page: page geometry, the embedded text layer (words and lines with page-frame boxes),
a 300 DPI overlapping tile grid and one full-sheet overview. Every image carries the frame that
maps its pixels back to page points, so later stages never lose provenance.
"""
from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path

import numpy as np
import pymupdf

from .geometry import fitz_rect_to_page_box, round_box

STAGE1_VERSION = "qsa.stage1.v1"
DEFAULT_DPI = 300
# Qwen2.5-VL works on 28 px patches; DashScope's default max_pixels is 1,003,520 (1280 * 28 * 28).
# A 980 x 980 tile is a multiple of 28 and stays under that cap, so no server-side resize changes
# the pixel frame the model's coordinates refer to.
TILE_PX = 980
OVERLAP_PX = 140
OVERVIEW_MAX_PIXELS = 1_003_520
INK_LEVEL = 160
BLANK_INK_RATIO = 0.003


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def tile_starts(total: int, tile: int, overlap: int) -> list[int]:
    if total <= tile:
        return [0]
    stride = tile - overlap
    n = math.ceil((total - tile) / stride) + 1
    starts = [min(i * stride, total - tile) for i in range(n)]
    return sorted(set(starts))


def render_gray(page, clip_rect, scale: float) -> np.ndarray:
    pix = page.get_pixmap(matrix=pymupdf.Matrix(scale, scale), clip=pymupdf.Rect(*clip_rect), colorspace=pymupdf.csGRAY, alpha=False)
    return np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width).copy()


def save_png(arr: np.ndarray, path: Path) -> None:
    pix = pymupdf.Pixmap(pymupdf.csGRAY, arr.shape[1], arr.shape[0], arr.tobytes(), False)
    pix.save(str(path))


def pad_to(arr: np.ndarray, w: int, h: int) -> np.ndarray:
    if arr.shape[0] == h and arr.shape[1] == w:
        return arr
    out = np.full((h, w), 255, dtype=np.uint8)
    out[: min(h, arr.shape[0]), : min(w, arr.shape[1])] = arr[:h, :w]
    return out


def text_layer(page, page_h: float) -> dict:
    words = [
        {"text": w[4], "box": round_box(fitz_rect_to_page_box(w[:4], page_h)), "block": w[5], "line": w[6]}
        for w in page.get_text("words")
        if str(w[4]).strip()
    ]
    lines = []
    for block in page.get_text("dict").get("blocks", []):
        for line in block.get("lines", []):
            spans = [s for s in line.get("spans", []) if s.get("text", "").strip()]
            if not spans:
                continue
            text = " ".join(s["text"].strip() for s in spans)
            lines.append({
                "text": text,
                "box": round_box(fitz_rect_to_page_box(line["bbox"], page_h)),
                "fontSize": round(max(s.get("size", 0) for s in spans), 2),
                "dir": [round(v, 3) for v in line.get("dir", (1, 0))],
            })
    return {"words": words, "lines": lines}


def run_stage1(pdf_path: Path, sheet_id: str, out_dir: Path, dpi: int = DEFAULT_DPI,
               tile_px: int = TILE_PX, overlap_px: int = OVERLAP_PX, force: bool = False) -> dict:
    out_dir.mkdir(parents=True, exist_ok=True)
    manifest_path = out_dir / "stage1.json"
    if manifest_path.exists() and not force:
        return json.loads(manifest_path.read_text())
    tiles_dir = out_dir / "tiles"
    tiles_dir.mkdir(exist_ok=True)

    doc = pymupdf.open(pdf_path)
    page = doc[0]
    page_w, page_h = float(page.rect.width), float(page.rect.height)
    scale = dpi / 72.0
    full_w, full_h = round(page_w * scale), round(page_h * scale)
    tl = text_layer(page, page_h)

    tiles = []
    for r, ty in enumerate(tile_starts(full_h, tile_px, overlap_px)):
        for c, tx in enumerate(tile_starts(full_w, tile_px, overlap_px)):
            tid = f"r{r:02d}c{c:02d}"
            clip = (tx / scale, ty / scale, (tx + tile_px) / scale, (ty + tile_px) / scale)
            arr = pad_to(render_gray(page, clip, scale), tile_px, tile_px)
            ink = float((arr < INK_LEVEL).mean())
            frame = {"scale": scale, "originX": tx / scale, "originYTop": ty / scale, "width": tile_px, "height": tile_px}
            page_box = fitz_rect_to_page_box(clip, page_h)
            has_text = any(
                w["box"]["x"] < page_box["x"] + page_box["width"] and w["box"]["x"] + w["box"]["width"] > page_box["x"]
                and w["box"]["y"] < page_box["y"] + page_box["height"] and w["box"]["y"] + w["box"]["height"] > page_box["y"]
                for w in tl["words"]
            )
            skipped = ink < BLANK_INK_RATIO and not has_text
            fname = f"{tid}.png"
            if not skipped:
                save_png(arr, tiles_dir / fname)
            tiles.append({
                "id": tid, "row": r, "col": c, "px": {"x": tx, "y": ty, "w": tile_px, "h": tile_px},
                "frame": frame, "pageBox": round_box(page_box), "inkRatio": round(ink, 5),
                "skipped": skipped, "file": None if skipped else f"tiles/{fname}",
            })

    ov_scale = math.sqrt(OVERVIEW_MAX_PIXELS / (page_w * page_h))
    ov_w = int(page_w * ov_scale) // 28 * 28
    ov_h = int(page_h * ov_scale) // 28 * 28
    ov_scale = min(ov_w / page_w, ov_h / page_h)
    ov = pad_to(render_gray(page, (0, 0, page_w, page_h), ov_scale), ov_w, ov_h)
    save_png(ov, out_dir / "overview.png")

    manifest = {
        "version": STAGE1_VERSION,
        "sheetId": sheet_id,
        "pdf": str(pdf_path),
        "pdfName": pdf_path.name,
        "sha256": sha256_file(pdf_path),
        "page": {
            "width": page_w, "height": page_h, "rotation": page.rotation,
            "mediabox": list(page.mediabox), "cropbox": list(page.cropbox), "frame": "pdf-point, bottom-left origin",
        },
        "render": {"dpi": dpi, "scale": scale, "width": full_w, "height": full_h, "tilePx": tile_px, "overlapPx": overlap_px, "colorspace": "gray"},
        "textLayer": tl,
        "tiles": tiles,
        "overview": {"file": "overview.png", "frame": {"scale": ov_scale, "originX": 0.0, "originYTop": 0.0, "width": ov_w, "height": ov_h}},
    }
    manifest_path.write_text(json.dumps(manifest, indent=1))
    return manifest


def render_crop(pdf_path: Path, page_box: dict, out_path: Path, dpi: int = DEFAULT_DPI,
                max_pixels: int = OVERVIEW_MAX_PIXELS) -> dict:
    """Render one page-frame region, lowering resolution only if it would exceed max_pixels."""
    doc = pymupdf.open(pdf_path)
    page = doc[0]
    page_h = float(page.rect.height)
    scale = dpi / 72.0
    px_area = page_box["width"] * page_box["height"] * scale * scale
    if px_area > max_pixels:
        scale = math.sqrt(max_pixels / (page_box["width"] * page_box["height"]))
    y_top = page_h - (page_box["y"] + page_box["height"])
    clip = (page_box["x"], y_top, page_box["x"] + page_box["width"], y_top + page_box["height"])
    arr = render_gray(page, clip, scale)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    save_png(arr, out_path)
    return {"file": str(out_path), "pageBox": round_box(page_box), "frame": {"scale": scale, "originX": clip[0], "originYTop": clip[1], "width": arr.shape[1], "height": arr.shape[0]}, "dpi": round(scale * 72, 1)}
