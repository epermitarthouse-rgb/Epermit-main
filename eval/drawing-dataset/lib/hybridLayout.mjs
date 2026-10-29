/**
 * Layout-aware page merge for the hybrid pilot.
 * Machine-extracted, visually interpreted, and professionally verified stay separate.
 */
import { classifyPageCells, GRID_COLS, GRID_ROWS } from "./cellClassify.mjs";
import { structurePage } from "./buildDataset.mjs";

export function topLeftToPdfBox(bbox, pageHeight) {
  const x0 = Number(bbox.x0 ?? bbox.x ?? bbox[0]);
  const y0 = Number(bbox.y0 ?? bbox.y ?? bbox[1]);
  const x1 = Number(bbox.x1 ?? (x0 + (bbox.width ?? bbox.w ?? 0)));
  const y1 = Number(bbox.y1 ?? (y0 + (bbox.height ?? bbox.h ?? 0)));
  const width = Math.max(0, x1 - x0);
  const height = Math.max(0, y1 - y0);
  return {
    x: round1(x0),
    y: round1(Number(pageHeight) - y1),
    width: round1(width),
    height: round1(height),
    unit: "pdf-point",
    origin: "bottom-left",
  };
}

export function cellBox(row, col, pageWidth, pageHeight, overlap = 0.04) {
  const width = pageWidth / GRID_COLS;
  const height = pageHeight / GRID_ROWS;
  const overlapX = width * overlap;
  const overlapY = height * overlap;
  const x = Math.max(0, col * width - overlapX);
  const y = Math.max(0, (GRID_ROWS - 1 - row) * height - overlapY);
  return {
    id: `r${row}c${col}`,
    row,
    col,
    x,
    y,
    width: Math.min(pageWidth - x, width + overlapX * 2),
    height: Math.min(pageHeight - y, height + overlapY * 2),
  };
}

export function shouldOcrCell(cell, drawingCell) {
  if (!cell) return false;
  if (cell.hypothesizedGraphicKind === "empty") return false;
  if (cell.hypothesizedGraphicKind === "dense_fill") return false;
  if (cell.hypothesizedGraphicKind === "mixed_graphics") return true;
  return cell.hypothesizedGraphicKind === "linework" && (drawingCell?.tinyFill || 0) >= 12;
}

export function normalizeTokens(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter((token) => token.length > 2);
}

export function novelTokens(baseText, extraText) {
  const base = new Set(normalizeTokens(baseText));
  const extra = normalizeTokens(extraText);
  return extra.filter((token) => !base.has(token));
}

export function vectorHintForCell(drawingCell) {
  if (!drawingCell) return "none";
  if ((drawingCell.tinyFill || 0) >= 12) return "outlined_lettering_candidate";
  if ((drawingCell.count || 0) >= 80 && (drawingCell.tinyFill || 0) < 8) return "path_linework";
  if ((drawingCell.large || 0) > 0 && (drawingCell.count || 0) < 20) return "large_region";
  return "none";
}

function block(partial) {
  return {
    independentlyVerified: false,
    ...partial,
  };
}

export function mergePageLayout({
  baselinePage,
  pymupdfPage,
  ocrPage,
  classified,
  relativePath,
  sha256,
}) {
  const pageWidth = baselinePage?.pageWidth || pymupdfPage?.pageWidth || 0;
  const pageHeight = baselinePage?.pageHeight || pymupdfPage?.pageHeight || 0;
  const blocks = [];
  for (const item of baselinePage?.items || []) {
    blocks.push(block({
      kind: "text_span",
      text: item.text,
      bbox: {
        x: item.x, y: item.y, width: item.w, height: item.h,
        unit: "pdf-point", origin: "bottom-left", pageWidth, pageHeight,
      },
      extractionMethod: "pdfjs-text-layer",
      origin: "machine_extracted",
    }));
  }
  for (const span of pymupdfPage?.spans || []) {
    blocks.push(block({
      kind: "text_span",
      text: span.text,
      bbox: span.bbox,
      fontName: span.fontName || null,
      extractionMethod: "pymupdf-text",
      origin: "machine_extracted",
    }));
  }
  for (const image of pymupdfPage?.images || []) {
    blocks.push(block({
      kind: "image",
      text: "",
      bbox: image.bbox,
      extractionMethod: "pymupdf-image",
      origin: "machine_extracted",
    }));
  }
  for (const region of pymupdfPage?.drawings?.largeRegions || []) {
    blocks.push(block({
      kind: "graphical_region",
      text: "",
      bbox: region.bbox,
      extractionMethod: "pymupdf-drawings",
      origin: "machine_extracted",
    }));
  }
  for (const annot of pymupdfPage?.annotations || []) {
    if (!annot.contents) continue;
    blocks.push(block({
      kind: "annotation",
      text: annot.contents,
      bbox: annot.bbox,
      extractionMethod: "pymupdf-annot",
      origin: "machine_extracted",
    }));
  }
  for (const item of pymupdfPage?.docling?.items || []) {
    blocks.push(block({
      kind: item.label === "table" ? "schedule_region" : "layout_item",
      text: item.text,
      bbox: item.bbox,
      label: item.label,
      extractionMethod: item.extractionMethod,
      origin: item.origin,
    }));
  }
  for (const table of pymupdfPage?.docling?.tables || []) {
    blocks.push(block({
      kind: "schedule_region",
      text: table.text,
      bbox: null,
      extractionMethod: table.extractionMethod,
      origin: table.origin,
    }));
  }
  for (const line of ocrPage?.lines || []) {
    blocks.push(block({
      kind: "ocr_line",
      text: line.text,
      bbox: line.box,
      confidence: line.confidence,
      extractionMethod: ocrPage.engine || "macos-vision",
      origin: "visual_interpretation",
    }));
  }

  const cells = (classified || []).map((cell) => {
    const drawing = pymupdfPage?.drawings?.cells?.[`r${cell.row}c${cell.col}`] || null;
    const hint = vectorHintForCell(drawing);
    const remainingUnread = Boolean(cell.remainingUnread)
      || (cell.letteringStatus === "none_read" && hint === "outlined_lettering_candidate");
    return {
      ...cell,
      vectorHint: hint,
      drawingCount: drawing?.count || 0,
      tinyFillCount: drawing?.tinyFill || 0,
      remainingUnread,
    };
  });

  const ocrText = (ocrPage?.lines || []).map((line) => line.text).join("\n");
  const pymupdfText = pymupdfPage?.text || "";
  const baselineText = baselinePage?.pageText || "";
  const combinedText = [baselineText, pymupdfText, ocrText].filter(Boolean).join("\n");
  const structured = structurePage({
    sourceFingerprint: sha256,
    documentId: sha256,
    fileName: relativePath,
    sheetNumber: String(relativePath || "").replace(/\.pdf$/i, ""),
    pageNumber: baselinePage?.pageNumber || 1,
    pageText: combinedText,
    graphicalReadStatus: ocrPage?.ocrAttempted ? "hybrid-ocr" : "hybrid-text",
    evidenceItems: [
      ...(baselinePage?.items || []).map((item) => ({
        str: item.text,
        extractionMethod: "pdfjs-text-layer",
        region: { x: item.x, y: item.y, width: item.w, height: item.h, unit: "pdf-point", origin: "bottom-left" },
      })),
      ...(ocrPage?.words || []).map((word) => ({
        str: word.text,
        extractionMethod: ocrPage.engine || "macos-vision",
        region: word.box,
      })),
    ],
    words: (ocrPage?.words || []).map((word) => ({
      text: word.text,
      confidence: word.confidence,
      box: word.box,
    })),
    regions: cells.filter((cell) => cell.remainingUnread).map((cell) => ({
      readable: false,
      limitations: "lettering_not_read",
      x: cell.col,
      y: cell.row,
      width: 1,
      height: 1,
      unit: "ink-cell",
    })),
  });
  if (structured.document?.extraction) delete structured.document.extraction.last_attempt_at;

  const unread = cells.filter((cell) => cell.remainingUnread);
  const kindCounts = {};
  const letteringCounts = {};
  const hintCounts = {};
  for (const cell of cells) {
    kindCounts[cell.hypothesizedGraphicKind] = (kindCounts[cell.hypothesizedGraphicKind] || 0) + 1;
    letteringCounts[cell.letteringStatus] = (letteringCounts[cell.letteringStatus] || 0) + 1;
    hintCounts[cell.vectorHint] = (hintCounts[cell.vectorHint] || 0) + 1;
  }

  return {
    schemaVersion: "phase2a2.hybrid.page.v1",
    independentlyVerified: false,
    relativePath,
    sha256,
    pageNumber: baselinePage?.pageNumber || 1,
    pageWidth,
    pageHeight,
    provenancePolicy: "machine_extracted, visual_interpretation, and professionally verified are separate. Nothing here is professionally verified.",
    methods: {
      pdfjs: Boolean(baselinePage),
      pymupdf: Boolean(pymupdfPage),
      docling: pymupdfPage?.docling?.status || "skipped",
      ocr: ocrPage?.engine || null,
    },
    texts: {
      baselineChars: (baselineText || "").length,
      pymupdfChars: (pymupdfText || "").replace(/\n/g, "").length,
      ocrChars: (ocrText || "").length,
      novelOcrTokens: novelTokens(baselineText, ocrText),
      novelPymupdfTokens: novelTokens(baselineText, pymupdfText),
    },
    blocks,
    cells,
    unresolvedRegions: unread,
    classification: {
      hypothesizedGraphicKind: kindCounts,
      letteringStatus: letteringCounts,
      vectorHint: hintCounts,
    },
    drawings: pymupdfPage?.drawings
      ? { count: pymupdfPage.drawings.count, fill: pymupdfPage.drawings.fill, tinyFill: pymupdfPage.drawings.tinyFill }
      : null,
    images: (pymupdfPage?.images || []).length,
    annotations: (pymupdfPage?.annotations || []).length,
    structured: {
      origin: structured.origin,
      independentlyVerified: false,
      validationOk: structured.validationOk,
      factCounts: structured.document ? {
        elements: (structured.document.elements || []).length,
        dimensions: (structured.document.dimensions || []).length,
        notes: (structured.document.notes || []).length,
        schedules: (structured.document.schedules || []).length,
      } : null,
    },
    combinedText,
  };
}

export function classifyWithOcr({ rasterCells, textItems, ocrWords, pageWidth, pageHeight, ocrAttempted }) {
  return classifyPageCells({ rasterCells, textItems, ocrWords, pageWidth, pageHeight, ocrAttempted });
}

function round1(value) {
  return Math.round(Number(value) * 10) / 10;
}

export { GRID_COLS, GRID_ROWS };
