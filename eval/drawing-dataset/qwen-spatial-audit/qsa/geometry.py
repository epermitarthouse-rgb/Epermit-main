"""Coordinate frames shared by every stage.

Page frame: PDF points, bottom-left origin, box = {x, y, width, height} with y the lower edge.
This is the frame of the saved Apple Vision recovery and of the visual ground truth.
Pixel frame: top-left origin of one rendered image (tile, overview or crop) at `scale` px/pt,
whose top-left corner sits at page point (originX, originYTop) in top-left page coordinates.
"""
from __future__ import annotations


def px_to_page(px: dict, frame: dict, page_height: float) -> dict:
    """Pixel box {x, y, w, h} inside `frame` -> page box (bottom-left origin)."""
    s = frame["scale"]
    x0 = frame["originX"] + px["x"] / s
    y0_top = frame["originYTop"] + px["y"] / s
    w = px["w"] / s
    h = px["h"] / s
    return {"x": x0, "y": page_height - (y0_top + h), "width": w, "height": h}


def page_to_px(box: dict, frame: dict, page_height: float) -> dict:
    s = frame["scale"]
    y_top = page_height - (box["y"] + box["height"])
    return {
        "x": (box["x"] - frame["originX"]) * s,
        "y": (y_top - frame["originYTop"]) * s,
        "w": box["width"] * s,
        "h": box["height"] * s,
    }


def page_box_to_fitz_rect(box: dict, page_height: float):
    """Page box -> (x0, y0, x1, y1) in PyMuPDF top-left page coordinates."""
    y_top = page_height - (box["y"] + box["height"])
    return (box["x"], y_top, box["x"] + box["width"], y_top + box["height"])


def fitz_rect_to_page_box(rect, page_height: float) -> dict:
    x0, y0, x1, y1 = rect
    return {"x": x0, "y": page_height - y1, "width": x1 - x0, "height": y1 - y0}


def area(b: dict) -> float:
    return max(0.0, b["width"]) * max(0.0, b["height"])


def intersection(a: dict, b: dict) -> float:
    w = min(a["x"] + a["width"], b["x"] + b["width"]) - max(a["x"], b["x"])
    h = min(a["y"] + a["height"], b["y"] + b["height"]) - max(a["y"], b["y"])
    return w * h if w > 0 and h > 0 else 0.0


def iou(a: dict, b: dict) -> float:
    i = intersection(a, b)
    u = area(a) + area(b) - i
    return i / u if u > 0 else 0.0


def overlap_smaller(a: dict, b: dict) -> float:
    i = intersection(a, b)
    m = min(area(a), area(b))
    return i / m if m > 0 else 0.0


def union(boxes: list[dict]) -> dict:
    x0 = min(b["x"] for b in boxes)
    y0 = min(b["y"] for b in boxes)
    x1 = max(b["x"] + b["width"] for b in boxes)
    y1 = max(b["y"] + b["height"] for b in boxes)
    return {"x": x0, "y": y0, "width": x1 - x0, "height": y1 - y0}


def expand(b: dict, margin: float, page_w: float, page_h: float) -> dict:
    x0 = max(0.0, b["x"] - margin)
    y0 = max(0.0, b["y"] - margin)
    x1 = min(page_w, b["x"] + b["width"] + margin)
    y1 = min(page_h, b["y"] + b["height"] + margin)
    return {"x": x0, "y": y0, "width": x1 - x0, "height": y1 - y0}


def round_box(b: dict, nd: int = 2) -> dict:
    return {k: round(float(b[k]), nd) for k in ("x", "y", "width", "height")}
