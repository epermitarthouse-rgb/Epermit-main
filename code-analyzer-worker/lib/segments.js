"use strict";

const { classifyDocument } = require("./classify");

const FORM_PAGE_RE =
  /\b(applicant request|code modification|for official use only|dob reviewer|requests? a modification)\b/i;
const SPEC_PAGE_RE =
  /\b(DIVISION|SECTION|PART\s+[12]|GENERAL REQUIREMENTS|TECHNICAL SPECIFICATIONS|CSI|MasterFormat)\b/i;
const DRAWING_PAGE_RE = /\b([A-Z]{1,4}-\d+(?:\.\d+)*)\b/;

/**
 * Classify a single PDF page from its text content.
 */
function classifyPage({ pageNumber, text, fileName, documentType }) {
  const body = String(text || "");
  if (FORM_PAGE_RE.test(body)) {
    return { analyzerClass: "code_modification_form", source: "auto", confidence: 0.8, pageNumber };
  }
  const specHits = (body.match(SPEC_PAGE_RE) || []).length;
  const sheetHits = (body.match(DRAWING_PAGE_RE) || []).length;
  if (specHits >= 2 && body.length > 200) {
    return { analyzerClass: "specification", source: "auto", confidence: 0.75, pageNumber };
  }
  if (sheetHits >= 1 && body.length < 500) {
    return { analyzerClass: "drawing_set", source: "auto", confidence: 0.7, pageNumber };
  }
  if (body.length > 600 && specHits >= 1) {
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

module.exports = {
  classifyPage,
  buildSegmentsFromPageClasses,
  getPageClass,
  isMixedSegments,
  shouldCreateSheetsForPage,
  shouldRasterizeForPage,
  shouldIndexSpecForPage,
};
