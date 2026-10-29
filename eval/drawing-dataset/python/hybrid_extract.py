#!/usr/bin/env python3
"""PyMuPDF (+ optional Docling) extract for the Phase 2A.2 hybrid pilot.

Native PDF strings are machine_extracted. Docling layout items are recorded with
the engine that produced them. This script does not invent missing lettering.
"""
from __future__ import annotations

import argparse
import json
import os
import resource
import time
import traceback
from collections import defaultdict

os.environ.setdefault(
    "HF_HOME",
    os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".cache", "hf")),
)
os.environ.setdefault(
    "DOCLING_CACHE_DIR",
    os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".cache", "docling")),
)

GRID_COLS = 8
GRID_ROWS = 6


def round1(value):
    return round(float(value), 1)


def top_left_to_pdf(bbox, page_height):
    x0, y0, x1, y1 = bbox
    width = max(0.0, x1 - x0)
    height = max(0.0, y1 - y0)
    return {
        "x": round1(x0),
        "y": round1(page_height - y1),
        "width": round1(width),
        "height": round1(height),
        "unit": "pdf-point",
        "origin": "bottom-left",
    }


def cell_index(x, y, page_width, page_height, top_left=True):
    col = min(GRID_COLS - 1, max(0, int((x / page_width) * GRID_COLS)))
    if top_left:
        row = min(GRID_ROWS - 1, max(0, int((y / page_height) * GRID_ROWS)))
    else:
        row_from_bottom = min(GRID_ROWS - 1, max(0, int((y / page_height) * GRID_ROWS)))
        row = GRID_ROWS - 1 - row_from_bottom
    return row, col


def pymupdf_page(page):
    rect = page.rect
    page_width = float(rect.width)
    page_height = float(rect.height)
    t0 = time.perf_counter()
    text_dict = page.get_text("dict")
    spans = []
    for block in text_dict.get("blocks", []):
        if block.get("type") not in (0, None) and "lines" not in block:
            continue
        for line in block.get("lines", []):
            for span in line.get("spans", []):
                text = (span.get("text") or "").replace("\u0000", "")
                if not text.strip():
                    continue
                bbox = span.get("bbox") or [0, 0, 0, 0]
                box = top_left_to_pdf(bbox, page_height)
                box["pageWidth"] = round1(page_width)
                box["pageHeight"] = round1(page_height)
                spans.append({
                    "text": text,
                    "fontName": span.get("font"),
                    "size": round1(span.get("size") or 0),
                    "bbox": box,
                    "extractionMethod": "pymupdf-text",
                    "origin": "machine_extracted",
                    "independentlyVerified": False,
                })
    native_text = page.get_text("text") or ""
    t_text = time.perf_counter()

    drawings = page.get_drawings()
    drawing_cells = defaultdict(lambda: {"count": 0, "tinyFill": 0, "large": 0})
    fill = 0
    stroke = 0
    tiny_fill = 0
    large_rects = []
    for drawing in drawings:
        if drawing.get("fill"):
            fill += 1
        if drawing.get("color") or drawing.get("stroke"):
            stroke += 1
        shape = drawing.get("rect")
        if shape is None:
            continue
        width = abs(float(shape.x1) - float(shape.x0))
        height = abs(float(shape.y1) - float(shape.y0))
        area = width * height
        cx = (float(shape.x0) + float(shape.x1)) / 2
        cy = (float(shape.y0) + float(shape.y1)) / 2
        row, col = cell_index(cx, cy, page_width, page_height, top_left=True)
        key = f"r{row}c{col}"
        drawing_cells[key]["count"] += 1
        if area < 40 and drawing.get("fill"):
            tiny_fill += 1
            drawing_cells[key]["tinyFill"] += 1
        if area >= 8000:
            drawing_cells[key]["large"] += 1
            if len(large_rects) < 40:
                large_rects.append({
                    "bbox": top_left_to_pdf(
                        [shape.x0, shape.y0, shape.x1, shape.y1],
                        page_height,
                    ),
                    "area": round1(area),
                    "origin": "machine_extracted",
                    "kind": "vector_region",
                    "extractionMethod": "pymupdf-drawings",
                    "independentlyVerified": False,
                })
    t_draw = time.perf_counter()

    images = []
    seen_images = set()
    for info in page.get_image_info() or []:
        bbox = info.get("bbox")
        if not bbox:
            continue
        key = tuple(round(float(v), 1) for v in bbox[:4]) + (info.get("width"), info.get("height"))
        if key in seen_images:
            continue
        seen_images.add(key)
        images.append({
            "bbox": top_left_to_pdf(bbox, page_height),
            "widthPx": info.get("width"),
            "heightPx": info.get("height"),
            "colorspace": info.get("cs-name"),
            "kind": "image",
            "extractionMethod": "pymupdf-image",
            "origin": "machine_extracted",
            "independentlyVerified": False,
        })
        if len(images) >= 80:
            break

    annots = []
    for annot in page.annots() or []:
        contents = (annot.info or {}).get("content") or ""
        annots.append({
            "subtype": annot.type[1] if annot.type else None,
            "contents": contents,
            "bbox": top_left_to_pdf(annot.rect, page_height) if annot.rect else None,
            "extractionMethod": "pymupdf-annot",
            "origin": "machine_extracted",
            "independentlyVerified": False,
        })

    fonts = []
    for font in page.get_fonts(full=True) or []:
        fonts.append({
            "xref": font[0],
            "ext": font[1],
            "type": font[2],
            "name": font[3],
        })

    return {
        "pageWidth": round1(page_width),
        "pageHeight": round1(page_height),
        "rotation": page.rotation,
        "spans": spans,
        "text": native_text,
        "textChars": len(native_text.replace("\n", "")),
        "spanCount": len(spans),
        "drawings": {
            "count": len(drawings),
            "fill": fill,
            "stroke": stroke,
            "tinyFill": tiny_fill,
            "cells": dict(drawing_cells),
            "largeRegions": large_rects,
        },
        "images": images,
        "annotations": annots,
        "fonts": fonts,
        "timingMs": {
            "text": round((t_text - t0) * 1000),
            "drawings": round((t_draw - t_text) * 1000),
        },
    }


def _bbox_from_rect(rect):
    xs = [rect.r_x0, rect.r_x1, rect.r_x2, rect.r_x3]
    ys = [rect.r_y0, rect.r_y1, rect.r_y2, rect.r_y3]
    return {
        "x": round1(min(xs)),
        "y": round1(min(ys)),
        "width": round1(max(xs) - min(xs)),
        "height": round1(max(ys) - min(ys)),
        "unit": "pdf-point",
        "origin": "bottom-left",
    }


def docling_parse_page(pdf_path, page_number):
    """Native PDF cells from docling-parse. Does not OCR outlined lettering."""
    from docling_parse.pdf_parser import DoclingPdfParser
    parser = DoclingPdfParser()
    document = parser.load(pdf_path)
    page = document.get_page(page_number)
    items = []
    for line in page.textline_cells or []:
        text = (getattr(line, "text", None) or "").strip()
        if not text:
            continue
        items.append({
            "label": "textline",
            "text": text[:2000],
            "bbox": _bbox_from_rect(line.rect),
            "extractionMethod": "docling-parse",
            "origin": "machine_extracted",
            "independentlyVerified": False,
        })
        if len(items) >= 800:
            break
    return {
        "status": "ok",
        "mode": "parse",
        "labels": {"textline": len(items)},
        "itemCount": len(items),
        "items": items,
        "tables": [],
        "wordCells": len(page.word_cells or []),
        "textLines": len(page.textline_cells or []),
        "note": "Full Docling layout model was unavailable. docling-parse read native PDF cells only.",
    }


def docling_page(pdf_path, page_height, mode, page_number=1):
    """Run Docling. layout = no OCR; ocr = Docling's own OCR. Failures are recorded."""
    started = time.perf_counter()
    try:
        from docling.document_converter import DocumentConverter, PdfFormatOption
        from docling.datamodel.base_models import InputFormat
        from docling.datamodel.pipeline_options import PdfPipelineOptions
    except Exception as error:
        try:
            parsed = docling_parse_page(pdf_path, page_number)
            parsed["layoutErrorClass"] = type(error).__name__
            parsed["layoutMessage"] = str(error)[:400]
            parsed["timingMs"] = round((time.perf_counter() - started) * 1000)
            return parsed
        except Exception as parse_error:
            return {
                "status": "unavailable",
                "mode": mode,
                "errorClass": type(error).__name__,
                "message": str(error)[:400],
                "parseErrorClass": type(parse_error).__name__,
                "parseMessage": str(parse_error)[:240],
                "timingMs": round((time.perf_counter() - started) * 1000),
            }

    opts = PdfPipelineOptions()
    opts.do_ocr = mode == "ocr"
    opts.do_table_structure = True
    opts.generate_page_images = False
    def parse_fallback(error, extra=None):
        try:
            parsed = docling_parse_page(pdf_path, page_number)
            parsed["layoutErrorClass"] = type(error).__name__ if not isinstance(error, str) else "ConversionStatus"
            parsed["layoutMessage"] = (str(error)[:400] if error is not None else "")
            if extra:
                parsed["layoutErrors"] = extra
            parsed["timingMs"] = round((time.perf_counter() - started) * 1000)
            return parsed
        except Exception as parse_error:
            return {
                "status": "failed",
                "mode": mode,
                "errorClass": type(error).__name__ if not isinstance(error, str) else "ConversionStatus",
                "message": str(error)[:400],
                "parseErrorClass": type(parse_error).__name__,
                "parseMessage": str(parse_error)[:240],
                "timingMs": round((time.perf_counter() - started) * 1000),
            }

    try:
        converter = DocumentConverter(
            format_options={InputFormat.PDF: PdfFormatOption(pipeline_options=opts)}
        )
        result = converter.convert(pdf_path)
    except Exception as error:
        return parse_fallback(error)

    status = str(getattr(result, "status", "") or "")
    if "FAILURE" in status.upper():
        errors = []
        for item in getattr(result, "errors", None) or []:
            errors.append(str(item)[:240])
        return parse_fallback(status, errors[:8])

    document = result.document
    labels = defaultdict(int)
    items = []
    for element, _level in document.iterate_items():
        label = getattr(element, "label", None)
        label = getattr(label, "value", None) or str(label or "unknown")
        labels[label] += 1
        text = (getattr(element, "text", None) or "").strip()
        bbox = None
        for prov in getattr(element, "prov", None) or []:
            box = getattr(prov, "bbox", None)
            if box is None:
                continue
            coord = str(getattr(box, "coord_origin", "") or "")
            left = float(getattr(box, "l", 0))
            right = float(getattr(box, "r", 0))
            top = float(getattr(box, "t", 0))
            bottom = float(getattr(box, "b", 0))
            if "BOTTOMLEFT" in coord.upper():
                bbox = {
                    "x": round1(left),
                    "y": round1(bottom if bottom < top else top),
                    "width": round1(abs(right - left)),
                    "height": round1(abs(top - bottom)),
                    "unit": "pdf-point",
                    "origin": "bottom-left",
                }
            else:
                bbox = top_left_to_pdf([left, min(top, bottom), right, max(top, bottom)], page_height)
            break
        if not text and label not in {"table", "picture"}:
            continue
        if len(items) >= 800:
            continue
        origin = "visual_interpretation" if mode == "ocr" else "machine_extracted"
        items.append({
            "label": label,
            "text": text[:2000],
            "bbox": bbox,
            "extractionMethod": f"docling-{mode}",
            "origin": origin,
            "independentlyVerified": False,
        })

    tables = []
    for table in getattr(document, "tables", None) or []:
        export = None
        try:
            export = table.export_to_markdown()
        except Exception:
            export = None
        tables.append({
            "text": (export or "")[:4000],
            "extractionMethod": f"docling-{mode}",
            "origin": "machine_extracted" if mode != "ocr" else "visual_interpretation",
            "independentlyVerified": False,
        })
        if len(tables) >= 20:
            break

    markdown = ""
    try:
        markdown = document.export_to_markdown() or ""
    except Exception:
        markdown = ""

    return {
        "status": "ok",
        "mode": mode,
        "labels": dict(labels),
        "itemCount": len(items),
        "items": items,
        "tables": tables,
        "markdownChars": len(markdown),
        "markdownPreview": markdown[:500],
        "timingMs": round((time.perf_counter() - started) * 1000),
    }


def extract_file(pdf_path, docling_mode):
    import pymupdf

    started = time.perf_counter()
    document = pymupdf.open(pdf_path)
    try:
        pages = []
        for index, page in enumerate(document):
            record = pymupdf_page(page)
            record["pageNumber"] = index + 1
            if docling_mode == "parse":
                parse_started = time.perf_counter()
                try:
                    parsed = docling_parse_page(pdf_path, index + 1)
                    parsed["timingMs"] = round((time.perf_counter() - parse_started) * 1000)
                    record["docling"] = parsed
                except Exception as error:
                    record["docling"] = {
                        "status": "failed",
                        "mode": "parse",
                        "errorClass": type(error).__name__,
                        "message": str(error)[:400],
                    }
            elif docling_mode and docling_mode != "off":
                record["docling"] = docling_page(pdf_path, record["pageHeight"], docling_mode, page_number=index + 1)
            else:
                record["docling"] = {"status": "skipped", "mode": "off"}
            pages.append(record)
        usage = resource.getrusage(resource.RUSAGE_SELF)
        return {
            "engine": "pymupdf",
            "pymupdfVersion": getattr(pymupdf, "VersionBind", None) or getattr(pymupdf, "version", None),
            "pageCount": document.page_count,
            "pages": pages,
            "timingMs": round((time.perf_counter() - started) * 1000),
            "maxRssKb": getattr(usage, "ru_maxrss", None),
        }
    finally:
        document.close()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--pdf", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--docling", choices=["off", "layout", "ocr", "parse"], default="layout")
    args = parser.parse_args()
    result = extract_file(args.pdf, args.docling)
    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
    with open(args.out, "w", encoding="utf8") as handle:
        json.dump(result, handle)
    print(json.dumps({
        "out": args.out,
        "pageCount": result["pageCount"],
        "timingMs": result["timingMs"],
        "docling": [page.get("docling", {}).get("status") for page in result["pages"]],
    }))


if __name__ == "__main__":
    main()
