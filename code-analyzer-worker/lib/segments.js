"use strict";

const {
  classifyDocument,
  countCsiSpecificationSignals,
  isAmbiguousFormatTextDense,
  isArchitecturalSectionDetailDrawing,
  isArchitecturalSheetFileName,
  isSmallFormatTextHeavy,
  pageFormatFromInches,
} = require("./classify");

const FORM_PAGE_RE =
  /\b(applicant request|code modification|for official use only|dob reviewer|requests? a modification)\b/i;
const DRAWING_PAGE_RE = /\b([A-Z]{1,4}-\d+(?:\.\d+)*)\b/;

/**
 * Classify a single PDF page from its MediaBox/CropBox size and text.
 * File name is not allowed to turn a large sheet into a spec, or a letter-size spec into a drawing.
 */
function classifyPage({ pageNumber, text, fileName, documentType, widthInches, heightInches }) {
  const body = String(text || "");
  const format = pageFormatFromInches(widthInches, heightInches);

  if (format === "large") {
    return { analyzerClass: "drawing_set", source: "page_size", confidence: 0.95, pageNumber };
  }

  if (FORM_PAGE_RE.test(body)) {
    return { analyzerClass: "code_modification_form", source: "auto", confidence: 0.8, pageNumber };
  }

  if (format === "small" && isSmallFormatTextHeavy(body)) {
    return { analyzerClass: "specification", source: "page_size", confidence: 0.85, pageNumber };
  }

  if (format === "ambiguous") {
    if (isAmbiguousFormatTextDense(body)) {
      return { analyzerClass: "specification", source: "page_size", confidence: 0.8, pageNumber };
    }
    return { analyzerClass: "drawing_set", source: "page_size", confidence: 0.8, pageNumber };
  }

  if (isArchitecturalSectionDetailDrawing({ fileName, text: body })) {
    return { analyzerClass: "drawing_set", source: "auto", confidence: 0.82, pageNumber };
  }

  if (isArchitecturalSheetFileName(fileName) && countCsiSpecificationSignals(body) < 2) {
    return { analyzerClass: "drawing_set", source: "filename", confidence: 0.9, pageNumber };
  }

  const csiSpecSignals = countCsiSpecificationSignals(body);
  const sheetHits = (body.match(DRAWING_PAGE_RE) || []).length;
  if (csiSpecSignals >= 2 && body.length > 200) {
    return { analyzerClass: "specification", source: "auto", confidence: 0.75, pageNumber };
  }
  if (sheetHits >= 1 && body.length < 500) {
    return { analyzerClass: "drawing_set", source: "auto", confidence: 0.7, pageNumber };
  }
  if (body.length > 600 && csiSpecSignals >= 1) {
    return { analyzerClass: "specification", source: "auto", confidence: 0.6, pageNumber };
  }

  const docLevel = classifyDocument({
    fileName,
    documentType,
    samplePageTexts: body ? [body] : [],
  });
  return { ...docLevel, pageNumber };
}

/**
 * Group consecutive pages with the same class into segments.
 */
function buildSegmentsFromPageClasses(pageClasses) {
  const pages = Object.entries(pageClasses)
    .map(([page, analyzerClass]) => ({ page: Number(page), analyzerClass }))
    .sort((a, b) => a.page - b.page);

  if (pages.length === 0) return [];

  const segments = [];
  let current = {
    page_start: pages[0].page,
    page_end: pages[0].page,
    analyzer_class: pages[0].analyzerClass,
  };

  for (let i = 1; i < pages.length; i++) {
    const row = pages[i];
    if (row.analyzerClass === current.analyzer_class && row.page === current.page_end + 1) {
      current.page_end = row.page;
      continue;
    }
    segments.push({ ...current });
    current = {
      page_start: row.page,
      page_end: row.page,
      analyzer_class: row.analyzerClass,
    };
  }
  segments.push(current);
  return segments;
}

function getPageClass(pageNumber, segments, fallbackClass) {
  for (const seg of segments || []) {
    if (pageNumber >= seg.page_start && pageNumber <= seg.page_end) {
      return seg.analyzer_class;
    }
  }
  return fallbackClass || "unknown";
}

function isMixedSegments(segments) {
  if (!segments || segments.length <= 1) return false;
  const classes = new Set(segments.map((s) => s.analyzer_class));
  return classes.size > 1;
}

function shouldCreateSheetsForPage(pageClass) {
  return pageClass === "drawing_set" || pageClass === "schedule";
}

function shouldRasterizeForPage(pageClass) {
  return pageClass === "drawing_set" || pageClass === "schedule";
}

function shouldIndexSpecForPage(pageClass) {
  return pageClass === "specification" || pageClass === "supporting" || pageClass === "report";
}

/**
 * Auto document class follows per-page results so a file name cannot override page size.
 * User-selected classes are applied by the caller before this runs.
 */
function resolveAutoAnalyzerClass({
  segments,
  fileName,
  documentType,
  samplePageTexts = [],
  pageSizes = [],
}) {
  if (isMixedSegments(segments)) return "mixed";
  const uniform = segments?.length === 1 ? segments[0].analyzer_class : null;
  if (uniform && uniform !== "unknown") return uniform;
  return classifyDocument({
    fileName,
    documentType,
    samplePageTexts,
    pageSizes,
  }).analyzerClass;
}

module.exports = {
  classifyPage,
  buildSegmentsFromPageClasses,
  getPageClass,
  isMixedSegments,
  resolveAutoAnalyzerClass,
  shouldCreateSheetsForPage,
  shouldRasterizeForPage,
  shouldIndexSpecForPage,
};
