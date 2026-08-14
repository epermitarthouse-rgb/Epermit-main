"use strict";

const LOW_TEXT_THRESHOLD = 50;
const BLANK_TEXT_THRESHOLD = 0;
const DRAWING_SIGNAL_PATTERN =
  /\b(SHEET|SCALE|DIAGRAM|ONE[\s-]*LINE|SINGLE[\s-]*LINE|PANEL\s+SCHEDULE|EQUIPMENT\s+SCHEDULE|SITE\s+PLAN|ELECTRICAL\s+PLAN|DRAWN\s+BY|CHECKED\s+BY|REVISION|TITLE\s+BLOCK)\b/i;
const SCANNED_FORM_PATTERN =
  /\b(APPLICATION|FORM|SUBMITTED|DATE|SIGNATURE|APPLICANT|CUSTOMER|AUTHORIZED)\b/i;
const TABLE_SIGNAL_PATTERN = /[\t|]/;

/**
 * @param {number} textLength
 * @param {number} threshold
 */
function textQualityScore(textLength, threshold = LOW_TEXT_THRESHOLD) {
  if (textLength <= 0) return 0;
  return Math.min(1, textLength / Math.max(threshold, 1));
}

/**
 * @param {Array<{ str?: string, transform?: number[], width?: number }>} items
 * @param {{ width: number, height: number }} viewport
 */
function computeLayoutDependency(items, viewport) {
  const strings = items
    .filter((it) => typeof it.str === "string" && it.str.trim().length > 0)
    .map((it) => ({
      str: it.str.trim(),
      x: Number(it.transform?.[4] ?? 0),
      y: Number(it.transform?.[5] ?? 0),
      width: Number(it.width ?? 0),
    }));

  if (strings.length === 0) return { score: 0, level: "low" };

  const shortLabels = strings.filter((s) => s.str.length <= 12).length;
  const xSpread =
    Math.max(...strings.map((s) => s.x)) - Math.min(...strings.map((s) => s.x));
  const ySpread =
    Math.max(...strings.map((s) => s.y)) - Math.min(...strings.map((s) => s.y));
  const area = Math.max(viewport.width * viewport.height, 1);
  const density = strings.length / area;

  let score = 0;
  if (shortLabels / strings.length >= 0.45) score += 0.35;
  if (xSpread > viewport.width * 0.35) score += 0.25;
  if (ySpread > viewport.height * 0.35) score += 0.25;
  if (density < 0.00005 && strings.length >= 3) score += 0.15;

  const level = score >= 0.55 ? "high" : score >= 0.3 ? "medium" : "low";
  return { score: Math.min(1, score), level };
}

/**
 * @param {string} text
 * @param {Array<{ str?: string }>} items
 */
function detectTableLikeAlignment(text, items) {
  if (TABLE_SIGNAL_PATTERN.test(text)) return true;
  const rows = new Map();
  for (const it of items) {
    if (!it.str || !it.transform) continue;
    const y = Math.round(Number(it.transform[5] ?? 0) / 2) * 2;
    if (!rows.has(y)) rows.set(y, 0);
    rows.set(y, rows.get(y) + 1);
  }
  const multiColumnRows = [...rows.values()].filter((c) => c >= 4).length;
  return multiColumnRows >= 3;
}

/**
 * Preserve physical PDF rows so deterministic table parsers do not join
 * unrelated title-block, plumbing, and electrical columns into false rows.
 *
 * @param {Array<{ str?: string, transform?: number[] }>} items
 */
function buildLayoutAwarePageText(items) {
  const rows = new Map();
  for (const item of items) {
    if (!item || typeof item.str !== "string" || !item.str.trim()) continue;
    const y = Math.round(Number(item.transform?.[5] ?? 0));
    if (!rows.has(y)) rows.set(y, []);
    rows.get(y).push({
      x: Number(item.transform?.[4] ?? 0),
      str: item.str.trim(),
    });
  }
  return [...rows.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([, rowItems]) =>
      rowItems
        .sort((a, b) => a.x - b.x)
        .map((item) => item.str)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter(Boolean)
    .join("\n");
}

/**
 * @param {object} params
 */
function classifyPdfPage(params) {
  const {
    page_number,
    native_text_length,
    native_text = "",
    text_items = [],
    viewport = { width: 612, height: 792 },
    native_extraction_error = null,
  } = params;

  const trimmed = String(native_text ?? "").trim();
  const textLen = native_text_length ?? trimmed.length;
  const layout = computeLayoutDependency(text_items, viewport);
  const tableLike = detectTableLikeAlignment(trimmed, text_items);
  const drawingSignal = DRAWING_SIGNAL_PATTERN.test(trimmed);
  const scannedSignal = SCANNED_FORM_PATTERN.test(trimmed);

  /** @type {"text"|"table"|"drawing"|"scanned_text"|"mixed"|"blank"} */
  let page_type = "text";
  /** @type {"native_text"|"table"|"vision"|"ocr"|"none"} */
  let recommended_method = "native_text";
  let reason = "Sufficient native PDF text";
  /** @type {string} */
  let status = "pending";

  if (native_extraction_error) {
    page_type = "mixed";
    recommended_method = "vision";
    reason = "Native text extraction error — vision fallback recommended";
    status = "vision_required";
  } else if (textLen <= BLANK_TEXT_THRESHOLD) {
    page_type = "blank";
    recommended_method = "ocr";
    reason = "No embedded text — likely scanned or image-only page";
    status = "ocr_required";
    if (viewport.width > 0 && viewport.height > 0) {
      page_type = "scanned_text";
    }
  } else if (textLen < LOW_TEXT_THRESHOLD) {
    if (drawingSignal || layout.level === "high") {
      page_type = "drawing";
      recommended_method = "vision";
      reason = "Low text with drawing/layout signals — vision required";
      status = "vision_required";
    } else if (scannedSignal) {
      page_type = "scanned_text";
      recommended_method = "ocr";
      reason = "Sparse form-like text — OCR required";
      status = "ocr_required";
    } else {
      page_type = "mixed";
      recommended_method = "vision";
      reason = "Low text density — vision processing required";
      status = "vision_required";
    }
  } else if (tableLike && /\b(connected|demand|load|amperage|voltage|panel)\b/i.test(trimmed)) {
    page_type = "table";
    recommended_method = "table";
    reason = "Tabular native text detected";
    status = "table_extracted";
  } else if (layout.level === "high" && (drawingSignal || tableLike)) {
    page_type = "drawing";
    recommended_method = "vision";
    reason = "Native text present but spatial layout matters";
    status = "vision_required";
  } else {
    page_type = "text";
    recommended_method = "native_text";
    reason = "Native PDF text is sufficient";
    status = "text_extracted";
  }

  return {
    page_number,
    page_type,
    native_text_length: textLen,
    text_quality_score: textQualityScore(textLen),
    layout_dependency: layout.level,
    layout_dependency_score: layout.score,
    table_like: tableLike,
    recommended_method,
    reason,
    status,
    image_coverage_estimate: textLen <= BLANK_TEXT_THRESHOLD ? 0.95 : layout.level === "high" ? 0.4 : 0.1,
  };
}

/**
 * @param {Buffer} buffer
 * @param {object} [deps]
 * @returns {Promise<Array<{ pageNumber: number, text: string, analysis: Record<string, unknown> }>>}
 */
async function extractPdfPagesWithAnalysis(buffer, deps = {}) {
  const pdfjs =
    deps.pdfjs ||
    (() => {
      try {
        return require("pdfjs-dist/legacy/build/pdf.js");
      } catch {
        return null;
      }
    })();

  if (!pdfjs) {
    const parsePdf =
      deps.parsePdf ||
      (async (buf) => {
        const pdfParseModule = require("pdf-parse");
        const pdfParseFn =
          typeof pdfParseModule === "function"
            ? pdfParseModule
            : typeof pdfParseModule?.default === "function"
              ? pdfParseModule.default
              : null;
        if (!pdfParseFn) throw new Error("pdf-parse unavailable");
        const result = await pdfParseFn(buf);
        return { text: result.text || "" };
      });
    const { text } = await parsePdf(buffer);
    const pages = String(text).split("\f");
    const list =
      pages.length <= 1 && text
        ? [{ pageNumber: 1, text }]
        : pages.map((pageText, idx) => ({ pageNumber: idx + 1, text: pageText }));
    return list.map((p) => ({
      ...p,
      text: String(p.text ?? ""),
      analysis: classifyPdfPage({
        page_number: p.pageNumber,
        native_text: String(p.text ?? ""),
        native_text_length: String(p.text ?? "").trim().length,
      }),
    }));
  }

  const uint8 = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const pdf = await pdfjs.getDocument({ data: uint8, disableFontFace: true, verbosity: 0 }).promise;
  /** @type {Array<{ pageNumber: number, text: string, analysis: Record<string, unknown> }>} */
  const out = [];

  try {
    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      let page;
      try {
        page = await pdf.getPage(pageNum);
        const viewport = page.getViewport({ scale: 1 });
        const textContent = await page.getTextContent();
        const text = buildLayoutAwarePageText(textContent.items);
        const analysis = classifyPdfPage({
          page_number: pageNum,
          native_text: text,
          native_text_length: text.length,
          text_items: textContent.items,
          viewport: { width: viewport.width, height: viewport.height },
        });
        out.push({ pageNumber: pageNum, text, analysis });
      } catch (err) {
        out.push({
          pageNumber: pageNum,
          text: "",
          analysis: classifyPdfPage({
            page_number: pageNum,
            native_text: "",
            native_text_length: 0,
            native_extraction_error: err instanceof Error ? err.message : "page_extract_failed",
          }),
        });
      } finally {
        if (page && typeof page.cleanup === "function") page.cleanup();
      }
    }
  } finally {
    if (typeof pdf.destroy === "function") await pdf.destroy();
  }

  return out;
}

/**
 * @param {Array<{ pageNumber: number, text: string, analysis?: Record<string, unknown> }>} pages
 * @param {object} [opts]
 */
function processDocumentPagesFromAnalysis(pages, opts = {}) {
  /** @type {Array<Record<string, unknown>>} */
  const pageRecords = [];

  for (const page of pages) {
    const analysis =
      page.analysis && typeof page.analysis === "object"
        ? page.analysis
        : classifyPdfPage({
            page_number: page.pageNumber,
            native_text: String(page.text ?? ""),
            native_text_length: String(page.text ?? "").trim().length,
          });

    pageRecords.push({
      page_number: page.pageNumber,
      status: String(analysis.status ?? "pending"),
      text_length: Number(analysis.native_text_length ?? 0),
      failure_reason:
        analysis.status === "vision_required" || analysis.status === "ocr_required"
          ? String(analysis.reason ?? null)
          : null,
      page_analysis: analysis,
      extraction_methods: [
        analysis.recommended_method === "table"
          ? "table"
          : analysis.recommended_method === "native_text"
            ? "pdf_text"
            : analysis.recommended_method,
      ],
    });
  }

  const totalPages = pages.length;
  const visionPages = pageRecords.filter((p) =>
    ["vision_required", "vision_processing", "vision_failed", "human_required"].includes(
      String(p.status),
    ) && String(p.page_analysis?.recommended_method) === "vision",
  ).length;
  const ocrPages = pageRecords.filter((p) =>
    ["ocr_required", "ocr_processing", "ocr_failed"].includes(String(p.status)),
  ).length;
  const textPages = pageRecords.filter((p) =>
    ["text_extracted", "vision_processed", "ocr_processed"].includes(String(p.status)),
  ).length;
  const tablePages = pageRecords.filter((p) => String(p.status) === "table_extracted").length;
  const blankPages = pageRecords.filter((p) => String(p.status) === "blank").length;
  const failedPages = pageRecords.filter((p) => String(p.status) === "failed");
  const terminalStatuses = new Set([
    "text_extracted",
    "table_extracted",
    "blank",
    "vision_processed",
    "ocr_processed",
    "vision_failed",
    "ocr_failed",
    "human_required",
    "failed",
  ]);
  const fullyAccounted = pageRecords.filter((p) => terminalStatuses.has(String(p.status))).length;
  const fallbackPending = pageRecords.filter((p) =>
    ["vision_required", "ocr_required"].includes(String(p.status)),
  ).length;

  let documentStatus = "complete";
  let failureReason = null;

  if (failedPages.length > 0) {
    documentStatus = "partial";
    failureReason = "One or more pages failed extraction";
  } else if (fallbackPending > 0) {
    documentStatus = "partial";
    failureReason = "One or more pages require Vision or OCR fallback processing";
  } else if (totalPages === 0) {
    documentStatus = "partial";
    failureReason = "No pages discovered in document";
  } else if (fullyAccounted < totalPages) {
    documentStatus = "partial";
    failureReason = "Not all pages reached a terminal processing status";
  }

  return {
    page_records: pageRecords,
    page_coverage: {
      total_pages: totalPages,
      pages_discovered: totalPages,
      pages_processed: fullyAccounted,
      pages_with_text: textPages + tablePages,
      pages_with_tables: tablePages,
      pages_sent_to_vision: visionPages,
      pages_sent_to_ocr: ocrPages,
      pages_vision_processed: pageRecords.filter((p) => p.status === "vision_processed").length,
      pages_ocr_processed: pageRecords.filter((p) => p.status === "ocr_processed").length,
      blank_pages: blankPages,
      failed_pages: failedPages.length,
      fallback_pending: fallbackPending,
      skipped_duplicate_pages: 0,
    },
    processing_status: documentStatus,
    failure_reason: failureReason,
    pages_processed: fullyAccounted,
    extraction_methods_used: [
      ...(textPages > 0 ? ["pdf_text"] : []),
      ...(tablePages > 0 ? ["table"] : []),
      ...(visionPages > 0 ? ["vision_required"] : []),
      ...(ocrPages > 0 ? ["ocr_required"] : []),
      ...(pageRecords.some((p) => p.status === "vision_processed") ? ["vision"] : []),
      ...(pageRecords.some((p) => p.status === "ocr_processed") ? ["ocr"] : []),
    ],
  };
}

module.exports = {
  LOW_TEXT_THRESHOLD,
  classifyPdfPage,
  extractPdfPagesWithAnalysis,
  processDocumentPagesFromAnalysis,
  computeLayoutDependency,
  buildLayoutAwarePageText,
};
