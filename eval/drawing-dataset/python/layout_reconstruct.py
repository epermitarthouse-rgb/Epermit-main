#!/usr/bin/env python3
"""Phase 2A.3 layout reconstruction for a single PDF page.

Uses PyMuPDF render + OpenCV projections/contours + optional Shapely containment.
Does not invent text, dimensions, or relationships. Outputs machine-detected
region candidates only.
"""
from __future__ import annotations

import argparse
import json
import os
import time
from collections import defaultdict

import numpy as np
import pymupdf


def round1(value):
    return round(float(value), 1)


def top_left_px_to_pdf(x, y, w, h, page_height, scale):
    return {
        "x": round1(x / scale),
        "y": round1(page_height - (y + h) / scale),
        "width": round1(w / scale),
        "height": round1(h / scale),
        "unit": "pdf-point",
        "origin": "bottom-left",
    }


def projection_splits(mask, axis, min_gap_frac=0.02, min_run_frac=0.04):
    """Find low-ink gaps along an axis to propose band splits."""
    projection = mask.mean(axis=axis)
    length = len(projection)
    gap = max(2, int(length * min_gap_frac))
    run = max(4, int(length * min_run_frac))
    threshold = max(0.01, float(np.percentile(projection, 20)))
    low = projection <= threshold
    splits = []
    i = 0
    while i < length:
        if not low[i]:
            i += 1
            continue
        j = i
        while j < length and low[j]:
            j += 1
        if j - i >= gap:
            mid = (i + j) // 2
            # keep only interior gaps
            if run < mid < length - run:
                splits.append(mid)
        i = j
    return splits


def contour_boxes(ink, min_area_frac=0.01, max_area_frac=0.55):
    import cv2

    h, w = ink.shape
    page_area = h * w
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (7, 7))
    opened = cv2.morphologyEx(ink, cv2.MORPH_OPEN, kernel)
    contours, _ = cv2.findContours(opened, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    boxes = []
    for contour in contours:
        x, y, bw, bh = cv2.boundingRect(contour)
        area = bw * bh
        frac = area / page_area
        if frac < min_area_frac or frac > max_area_frac:
            continue
        boxes.append({"x": int(x), "y": int(y), "w": int(bw), "h": int(bh), "areaFrac": round(frac, 4)})
    boxes.sort(key=lambda item: -item["areaFrac"])
    return boxes[:40]


def line_segments(gray):
    import cv2

    edges = cv2.Canny(gray, 50, 150)
    detected = cv2.HoughLinesP(
        edges,
        1,
        np.pi / 180,
        threshold=80,
        minLineLength=max(40, gray.shape[1] // 20),
        maxLineGap=8,
    )
    horizontal = 0
    vertical = 0
    long_h = []
    if detected is None:
        return {"horizontal": 0, "vertical": 0, "longHorizontal": []}
    for entry in detected:
        # OpenCV 4 returns shape (N,1,4); some builds yield (N,4).
        coords = entry[0] if getattr(entry, "ndim", 1) > 1 or len(entry) == 1 else entry
        if len(coords) != 4:
            coords = np.asarray(entry).reshape(-1)[:4]
        x1, y1, x2, y2 = [int(value) for value in coords]
        dx = abs(x2 - x1)
        dy = abs(y2 - y1)
        if dx >= dy * 4:
            horizontal += 1
            if dx >= gray.shape[1] * 0.15:
                long_h.append({"x1": x1, "y1": y1, "x2": x2, "y2": y2})
        elif dy >= dx * 4:
            vertical += 1
    long_h.sort(key=lambda item: item["y1"])
    return {"horizontal": horizontal, "vertical": vertical, "longHorizontal": long_h[:40]}


def band_regions(page_width, page_height):
    """Stable drawing-sheet bands. Machine-detected structure, not verified content."""
    return [
        {
            "id": "band-title-block",
            "kind": "title_block",
            "bbox": {
                "x": round1(page_width * 0.72),
                "y": 0,
                "width": round1(page_width * 0.28),
                "height": round1(page_height),
                "unit": "pdf-point",
                "origin": "bottom-left",
            },
            "method": "sheet-band-heuristic",
            "confidence": "structural_prior",
            "origin": "machine_detected",
            "independentlyVerified": False,
        },
        {
            "id": "band-bottom-notes",
            "kind": "notes_band",
            "bbox": {
                "x": 0,
                "y": 0,
                "width": round1(page_width * 0.72),
                "height": round1(page_height * 0.22),
                "unit": "pdf-point",
                "origin": "bottom-left",
            },
            "method": "sheet-band-heuristic",
            "confidence": "structural_prior",
            "origin": "machine_detected",
            "independentlyVerified": False,
        },
        {
            "id": "band-drawing-field",
            "kind": "drawing_field",
            "bbox": {
                "x": 0,
                "y": round1(page_height * 0.22),
                "width": round1(page_width * 0.72),
                "height": round1(page_height * 0.78),
                "unit": "pdf-point",
                "origin": "bottom-left",
            },
            "method": "sheet-band-heuristic",
            "confidence": "structural_prior",
            "origin": "machine_detected",
            "independentlyVerified": False,
        },
    ]


def reconstruct_page(pdf_path, page_number=1, scale=0.5, overlay_path=None):
    import cv2
    from PIL import Image, ImageDraw

    started = time.perf_counter()
    document = pymupdf.open(pdf_path)
    try:
        page = document[page_number - 1]
        page_width = float(page.rect.width)
        page_height = float(page.rect.height)
        pix = page.get_pixmap(matrix=pymupdf.Matrix(scale, scale), alpha=False)
        img = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, 3).copy()
        gray = cv2.cvtColor(img, cv2.COLOR_RGB2GRAY)
        ink = ((gray < 245).astype(np.uint8)) * 255
        h, w = gray.shape

        v_splits = projection_splits(ink > 0, axis=0)
        h_splits = projection_splits(ink > 0, axis=1)
        boxes = contour_boxes(ink)
        lines = line_segments(gray)

        regions = band_regions(page_width, page_height)
        for index, box in enumerate(boxes):
            regions.append({
                "id": f"contour-{index}",
                "kind": "graphical_component",
                "bbox": top_left_px_to_pdf(box["x"], box["y"], box["w"], box["h"], page_height, scale),
                "areaFrac": box["areaFrac"],
                "method": "opencv-contour",
                "confidence": "hypothesis",
                "origin": "machine_detected",
                "independentlyVerified": False,
            })

        # Projection-derived interior bands as candidate plan/notes splits.
        for index, split in enumerate(h_splits[:4]):
            y_pdf = page_height - split / scale
            regions.append({
                "id": f"hsplit-{index}",
                "kind": "projection_split",
                "bbox": {
                    "x": 0,
                    "y": round1(max(0, y_pdf - 8)),
                    "width": round1(page_width),
                    "height": 16,
                    "unit": "pdf-point",
                    "origin": "bottom-left",
                },
                "method": "opencv-projection",
                "confidence": "hypothesis",
                "origin": "machine_detected",
                "independentlyVerified": False,
                "note": "Low-ink horizontal gap. Not a verified region boundary.",
            })
        for index, split in enumerate(v_splits[:4]):
            x_pdf = split / scale
            regions.append({
                "id": f"vsplit-{index}",
                "kind": "projection_split",
                "bbox": {
                    "x": round1(max(0, x_pdf - 8)),
                    "y": 0,
                    "width": 16,
                    "height": round1(page_height),
                    "unit": "pdf-point",
                    "origin": "bottom-left",
                },
                "method": "opencv-projection",
                "confidence": "hypothesis",
                "origin": "machine_detected",
                "independentlyVerified": False,
                "note": "Low-ink vertical gap. Not a verified region boundary.",
            })

        # Schedule-grid hypothesis: many long horizontal rulings in a compact vertical stack.
        schedule_candidates = []
        if len(lines["longHorizontal"]) >= 5:
            ys = [item["y1"] for item in lines["longHorizontal"]]
            # cluster by y proximity
            ys_sorted = sorted(ys)
            cluster = [ys_sorted[0]]
            clusters = []
            for y in ys_sorted[1:]:
                if y - cluster[-1] <= max(8, h * 0.02):
                    cluster.append(y)
                else:
                    clusters.append(cluster)
                    cluster = [y]
            clusters.append(cluster)
            for index, cluster in enumerate(clusters):
                # CAD plans have many dimension/grid lines. Require a denser stack
                # before calling a region a schedule-grid hypothesis.
                if len(cluster) < 8:
                    continue
                y0 = min(cluster) - 4
                y1 = max(cluster) + 4
                height = y1 - y0
                if height < max(24, h * 0.04) or height > h * 0.45:
                    continue
                xs = []
                for item in lines["longHorizontal"]:
                    if y0 - 6 <= item["y1"] <= y1 + 6:
                        xs.extend([item["x1"], item["x2"]])
                if not xs:
                    continue
                x0, x1 = min(xs), max(xs)
                width = x1 - x0
                if width < w * 0.18:
                    continue
                schedule_candidates.append({
                    "id": f"schedule-grid-{index}",
                    "kind": "schedule_candidate",
                    "bbox": top_left_px_to_pdf(x0, y0, max(8, width), max(8, height), page_height, scale),
                    "rulingCount": len(cluster),
                    "method": "opencv-hough-grid",
                    "confidence": "hypothesis",
                    "origin": "machine_detected",
                    "independentlyVerified": False,
                    "note": "Aligned horizontal rulings only. Not verified schedule content.",
                })
        regions.extend(schedule_candidates)

        shapely_stats = {"available": False, "pairOverlaps": 0}
        try:
            from shapely.geometry import box as shapely_box

            shapely_stats["available"] = True
            polys = []
            for region in regions:
                if region["kind"] in {"projection_split"}:
                    continue
                bbox = region["bbox"]
                polys.append((region["id"], shapely_box(
                    bbox["x"],
                    bbox["y"],
                    bbox["x"] + bbox["width"],
                    bbox["y"] + bbox["height"],
                )))
            overlaps = 0
            for index, (left_id, left) in enumerate(polys):
                for right_id, right in polys[index + 1:]:
                    if left.intersects(right) and not left.touches(right):
                        overlaps += 1
            shapely_stats["pairOverlaps"] = overlaps
            shapely_stats["note"] = "Overlap count among region hypotheses. Overlap is expected for nested bands."
        except Exception as error:
            shapely_stats = {
                "available": False,
                "errorClass": type(error).__name__,
                "message": str(error)[:200],
            }

        overlay = None
        if overlay_path:
            canvas = Image.fromarray(img)
            draw = ImageDraw.Draw(canvas)
            colors = {
                "title_block": (220, 40, 40),
                "notes_band": (40, 120, 220),
                "drawing_field": (40, 180, 80),
                "graphical_component": (180, 120, 20),
                "schedule_candidate": (160, 40, 180),
                "projection_split": (120, 120, 120),
            }
            for region in regions:
                kind = region["kind"]
                if kind == "projection_split":
                    continue
                bbox = region["bbox"]
                # pdf bottom-left -> top-left px
                x0 = bbox["x"] * scale
                y_top = (page_height - bbox["y"] - bbox["height"]) * scale
                x1 = (bbox["x"] + bbox["width"]) * scale
                y_bottom = (page_height - bbox["y"]) * scale
                color = colors.get(kind, (255, 255, 0))
                draw.rectangle([x0, y_top, x1, y_bottom], outline=color, width=2)
            os.makedirs(os.path.dirname(overlay_path) or ".", exist_ok=True)
            canvas.save(overlay_path)
            overlay = overlay_path

        return {
            "engine": "pymupdf+opencv",
            "pageNumber": page_number,
            "pageWidth": round1(page_width),
            "pageHeight": round1(page_height),
            "renderScale": scale,
            "inkRatio": round(float((ink > 0).mean()), 4),
            "projection": {
                "horizontalSplitsPx": h_splits,
                "verticalSplitsPx": v_splits,
                "lineCounts": {"horizontal": lines["horizontal"], "vertical": lines["vertical"]},
            },
            "regions": regions,
            "shapely": shapely_stats,
            "overlayPath": overlay,
            "timingMs": round((time.perf_counter() - started) * 1000),
            "provenance": {
                "origin": "machine_detected",
                "independentlyVerified": False,
                "note": "Regions are geometric hypotheses. They are not professionally verified drawing parts.",
            },
        }
    finally:
        document.close()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--pdf", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--page", type=int, default=1)
    parser.add_argument("--scale", type=float, default=0.5)
    parser.add_argument("--overlay")
    args = parser.parse_args()
    result = reconstruct_page(args.pdf, args.page, args.scale, args.overlay)
    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
    with open(args.out, "w", encoding="utf8") as handle:
        json.dump(result, handle)
    print(json.dumps({
        "out": args.out,
        "regions": len(result["regions"]),
        "timingMs": result["timingMs"],
        "overlay": result.get("overlayPath"),
    }))


if __name__ == "__main__":
    main()
