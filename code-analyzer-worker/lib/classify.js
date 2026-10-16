"use strict";

const SPEC_FILENAME_RE =
  /\b(spec|specification|manual|project manual|division|div[\s_-]?\d|technical spec|procurement)\b/i;
const DRAWING_FILENAME_RE =
  /\b(drawing|drawings|plan|plans|sheet|arch|struct|mechanical|electrical|mep|civil|site plan|floor plan|elevation|section)\b/i;
const FORM_FILENAME_RE =
  /\b(code mod|modification|dc\s*mod|application for modification)\b/i;
const SCHEDULE_FILENAME_RE = /\b(schedule|door schedule|window schedule|equipment schedule)\b/i;
const SPEC_TEXT_RE =
  /\b(DIVISION|SECTION|PART\s+[12]|GENERAL REQUIREMENTS|TECHNICAL SPECIFICATIONS|CSI|MasterFormat)\b/i;
/** CSI/MasterFormat section headings — not architectural "SECTION DETAIL(S)" titles. */
const CSI_SECTION_HEADING_RE =
  /\bSECTION\s+(?:\d{2}\s+\d{2}\s+\d{2}|\d{5,6})(?:\s|[-–—]|$)/i;
const CSI_SPEC_SIGNAL_RES = [
  /\bDIVISION\s+\d+/gi,
  /\bSECTION\s+(?:\d{2}\s+\d{2}\s+\d{2}|\d{5,6})(?:\s|[-–—]|$)/gi,
  /\bPART\s+[12]\b/gi,
  /\bGENERAL REQUIREMENTS\b/gi,
  /\bTECHNICAL SPECIFICATIONS\b/gi,
  /\bMasterFormat\b/gi,
  /\bCSI\b/gi,
];
/** Architectural/engineering section *detail* sheets (wall/building sections, not CSI divisions). */
const ARCH_SECTION_DETAIL_TITLE_RE = /\bsection\s+details?\b/i;
const ARCH_DRAWING_SECTION_PHRASE_RE =
  /\b(wall|building|typical|interior|exterior|fa[cç]ade|curtain|storefront)\s+section\b|\bsection\s+(?:at|through|detail)\b|\bdetail\s+sections?\b/i;
const DRAWING_TITLE_BLOCK_RE =
  /\b(scale|drawn by|checked|project no|sheet\s+of|date:|revision|copyright)\b/i;
const DRAWING_SHEET_RE = /\b([A-Z]{1,4}-\d+(?:\.\d+)*)\b/;
/** Permit sheet index prefix (e.g. ASK04 - SECTION DETAILS.pdf, A101 - FLOOR PLAN.pdf). */
const PERMIT_SHEET_INDEX_FILENAME_RE = /^[A-Z]{1,4}\s*\d{2,4}\s*[-–—_\s]/i;
/** Architectural sheet IDs at file start (e.g. A001-SITE PLAN.pdf) — common permit set naming. */
const ARCH_SHEET_FILENAME_RE = /^[A-Z]{1,4}\d{2,4}[-_.\s]/i;
/**
 * Whole-file sheet numbers used by permit sets (A-1.03-00.pdf, A-1.04.00.pdf, M-1.1.pdf).
 * These are drawings even when extracted title-block text is long.
 * Keep in sync with src/lib/codeAnalyzer/sheetFileName.ts.
 */
const ARCHITECTURAL_SHEET_FILE_RE = /^[A-Z]{1,4}(?:[-.]?\d+){1,6}$/i;

function architecturalSheetFileStem(fileName) {
  const base = String(fileName || "").split(/[/\\]/).pop() || "";
  return base.replace(/\.[^.]+$/, "").replace(/-page\d+$/i, "").trim();
}

function isArchitecturalSheetFileName(fileName) {
  const stem = architecturalSheetFileStem(fileName);
  if (!stem || SPEC_FILENAME_RE.test(stem)) return false;
  return ARCHITECTURAL_SHEET_FILE_RE.test(stem);
}

function countCsiSpecificationSignals(body) {
  const text = String(body || "");
  let count = 0;
  for (const re of CSI_SPEC_SIGNAL_RES) {
    count += (text.match(re) || []).length;
  }
  return count;
}

/**
 * True when page/file cues indicate a drawing section/detail sheet rather than CSI spec prose.
 */
function isArchitecturalSectionDetailDrawing({ fileName, text }) {
  const name = String(fileName || "");
  const body = String(text || "");
  const header = body.slice(0, 1500);
  const csiSignals = countCsiSpecificationSignals(body);

  const sectionDetailTitle =
    ARCH_SECTION_DETAIL_TITLE_RE.test(name) || ARCH_SECTION_DETAIL_TITLE_RE.test(header);
  const drawingSectionPhrase = ARCH_DRAWING_SECTION_PHRASE_RE.test(header);
  const drawingFileHint = isDrawingDocumentHint({ fileName: name, documentType: "" });
  const sheetIndexHint = PERMIT_SHEET_INDEX_FILENAME_RE.test(name) || ARCH_SHEET_FILENAME_RE.test(name);
  const titleBlockHint = DRAWING_TITLE_BLOCK_RE.test(header);
  const sheetIdInText = DRAWING_SHEET_RE.test(header);

  if (csiSignals >= 2 && !sectionDetailTitle) {
    return false;
  }

  if (sectionDetailTitle && (drawingFileHint || sheetIndexHint || titleBlockHint || sheetIdInText)) {
    return true;
  }
  if (drawingSectionPhrase && csiSignals < 2 && (drawingFileHint || sheetIndexHint || titleBlockHint)) {
    return true;
  }
  if (sectionDetailTitle && csiSignals === 0 && body.length > 0 && body.length < 4000) {
    return drawingFileHint || sheetIndexHint || titleBlockHint;
  }
  return false;
}

function isDrawingDocumentHint({ fileName, documentType }) {
  const name = String(fileName || "");
  const docType = String(documentType || "").toLowerCase();
  return (
    docType === "permit_drawing" ||
    docType === "floor_plan" ||
    docType === "elevation" ||
    docType === "site_plan" ||
    DRAWING_FILENAME_RE.test(name) ||
    ARCH_SHEET_FILENAME_RE.test(name) ||
    isArchitecturalSheetFileName(name)
  );
}

function classifyDocument({ fileName, documentType, samplePageTexts = [] }) {
  const name = String(fileName || "");
  const docType = String(documentType || "").toLowerCase();

  if (docType === "code_modification_application" || FORM_FILENAME_RE.test(name)) {
    return { analyzerClass: "code_modification_form", source: "filename", confidence: 0.95 };
  }
  if (isDrawingDocumentHint({ fileName: name, documentType: docType })) {
    return { analyzerClass: "drawing_set", source: "filename", confidence: 0.85 };
  }
  if (SCHEDULE_FILENAME_RE.test(name)) {
    return { analyzerClass: "schedule", source: "filename", confidence: 0.85 };
  }
  if (SPEC_FILENAME_RE.test(name)) {
    return { analyzerClass: "specification", source: "filename", confidence: 0.9 };
  }

  const combined = samplePageTexts.join("\n").slice(0, 8000);
  const specHits = countCsiSpecificationSignals(combined);
  const sheetHits = (combined.match(DRAWING_SHEET_RE) || []).length;
  const avgTextLen =
    samplePageTexts.length > 0
      ? samplePageTexts.reduce((n, t) => n + t.length, 0) / samplePageTexts.length
      : 0;

  if (specHits >= 2 && avgTextLen > 200) {
    return { analyzerClass: "specification", source: "auto", confidence: 0.75 };
  }
  if (sheetHits >= 2 && avgTextLen < 400) {
    return { analyzerClass: "drawing_set", source: "auto", confidence: 0.7 };
  }
  if (avgTextLen > 500) {
    return { analyzerClass: "specification", source: "auto", confidence: 0.55 };
  }

  // V2 PDF uploads use document_type "specification" as a storage label, not CSI content class.
  if (docType === "specification") {
    return { analyzerClass: "unknown", source: "auto", confidence: 0.35 };
  }

  return { analyzerClass: "unknown", source: "auto", confidence: 0.3 };
}

function shouldRasterizePage(analyzerClass) {
  return analyzerClass === "drawing_set" || analyzerClass === "schedule" || analyzerClass === "mixed";
}

function shouldCreateAnalyzerSheets(analyzerClass) {
  return analyzerClass === "drawing_set" || analyzerClass === "mixed";
}

module.exports = {
  classifyDocument,
  shouldRasterizePage,
  shouldCreateAnalyzerSheets,
  countCsiSpecificationSignals,
  isArchitecturalSectionDetailDrawing,
  isArchitecturalSheetFileName,
  CSI_SECTION_HEADING_RE,
  ARCH_SECTION_DETAIL_TITLE_RE,
};
