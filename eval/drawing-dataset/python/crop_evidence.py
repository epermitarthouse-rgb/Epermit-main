#!/usr/bin/env python3
"""Render a PDF page crop for adjudication (evidence region only).

Does not invent content. Writes a PNG clip from coordinates in PDF user space
(bottom-left origin) or skips with an error record when the box is invalid.
"""
from __future__ import annotations

import argparse
import json
import os

import pymupdf


def crop(pdf_path: str, out_path: str, bbox: dict, page_number: int = 1, pad: float = 12.0, scale: float = 2.0):
    doc = pymupdf.open(pdf_path)
    page = doc[page_number - 1]
    page_height = float(page.rect.height)
    x = float(bbox["x"]) - pad
    y_bl = float(bbox["y"]) - pad
    w = float(bbox["width"]) + 2 * pad
    h = float(bbox["height"]) + 2 * pad
    # PDF bottom-left → PyMuPDF top-left
    y0 = page_height - (y_bl + h)
    y1 = page_height - y_bl
    clip = pymupdf.Rect(x, y0, x + w, y1)
    clip = clip & page.rect
    if clip.is_empty or clip.width < 2 or clip.height < 2:
        raise ValueError("crop rectangle is empty or too small")
    pix = page.get_pixmap(matrix=pymupdf.Matrix(scale, scale), clip=clip, alpha=False)
    os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)
    pix.save(out_path)
    doc.close()
    return {
        "status": "ok",
        "outPath": out_path,
        "clip": {"x": clip.x0, "y": clip.y0, "width": clip.width, "height": clip.height},
        "scale": scale,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--pdf", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--bbox-json", required=True)
    parser.add_argument("--page", type=int, default=1)
    parser.add_argument("--pad", type=float, default=12.0)
    parser.add_argument("--scale", type=float, default=2.0)
    args = parser.parse_args()
    bbox = json.loads(args.bbox_json)
    try:
        result = crop(args.pdf, args.out, bbox, page_number=args.page, pad=args.pad, scale=args.scale)
        print(json.dumps(result))
    except Exception as exc:  # noqa: BLE001 — CLI boundary
        print(json.dumps({"status": "failed", "message": str(exc)[:800]}))
        raise SystemExit(1)


if __name__ == "__main__":
    main()
