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

/**
 * Page format from the PDF page view (CropBox intersected with MediaBox), in inches.
 * Short side >= ~17" is a drawing sheet (ANSI C / ARCH C and larger).
 * Short side <= 11.5" is letter, legal, or A4, except 11x17 which is tabloid.
 * Tabloid and other in-between sizes are ambiguous and use text density.
 */
const LARGE_FORMAT_MIN_SHORT_SIDE_IN = 16.5;
const SMALL_FORMAT_MAX_SHORT_SIDE_IN = 11.5;
const TABLOID_LONG_SIDE_MIN_IN = 16;
const TABLOID_LONG_SIDE_MAX_IN = 19.5;
const TABLOID_SHORT_SIDE_MIN_IN = 10;
/** Letter/A4 only. Must not treat long title-block text on large sheets as a spec. */
const SMALL_FORMAT_TEXT_HEAVY_CHARS = 500;
/** 11x17 title blocks stay drawings; a full spec page is much longer. */
const AMBIGUOUS_TEXT_DENSE_CHARS = 2000;
const AMBIGUOUS_CSI_TEXT_DENSE_CHARS = 800;

function pageFormatFromInches(widthInches, heightInches) {
  const width = Number(widthInches);
  const height = Number(heightInches);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }
  const shortSide = Math.min(width, height);
  const longSide = Math.max(width, height);
  if (shortSide >= LARGE_FORMAT_MIN_SHORT_SIDE_IN) return "large";
  const tabloid =
    longSide >= TABLOID_LONG_SIDE_MIN_IN &&
    longSide <= TABLOID_LONG_SIDE_MAX_IN &&
    shortSide >= TABLOID_SHORT_SIDE_MIN_IN &&
    shortSide < LARGE_FORMAT_MIN_SHORT_SIDE_IN;
  if (tabloid) return "ambiguous";
  if (shortSide <= SMALL_FORMAT_MAX_SHORT_SIDE_IN) return "small";
  return "ambiguous";
}

function isSmallFormatTextHeavy(text) {
  const body = String(text || "");
  if (body.length >= SMALL_FORMAT_TEXT_HEAVY_CHARS) return true;
  return countCsiSpecificationSignals(body) >= 2 && body.length > 200;
}

function isAmbiguousFormatTextDense(text) {
  const body = String(text || "");
  if (body.length >= AMBIGUOUS_TEXT_DENSE_CHARS) return true;
  return countCsiSpecificationSignals(body) >= 2 && body.length >= AMBIGUOUS_CSI_TEXT_DENSE_CHARS;
}

const SHEET_CONTENT_CLASSES = [
  "floor_plan",
  "egress_plan",
  "enlarged_plan",
  "elevation",
  "section",
  "schedule",
  "form",
  "mep",
  "drawing",
];

/**
 * Certificates and inspection forms, matched from page text for any file name.
 * Phrases are specific so a plan note that merely mentions a certificate does not
 * reclass the sheet when the title zone is already a plan, elevation, or section.
 */
const FORM_CONTENT_RE =
  /\b(?:com[\s-]*check|energy(?:\s+code)?\s+compliance\s+certificate|certificate\s+of\s+energy(?:\s+code)?\s+compliance|statement\s+of\s+special\s+inspections|schedule\s+of\s+special\s+inspections|special\s+inspections?\s+statement)\b/i;
const SCHEDULE_TITLE_RE =
  /\b(?:door|hardware|window|finish|room(?:\s+finish)?|equipment|panel|fixture|lighting)\s+schedules?\b|\bhardware\s+sets?\b|\bdoor\s+and\s+hardware\b/i;
const MEP_TITLE_RE =
  /\b(?:electrical|mechanical|plumbing|equipment)\s+(?:power\s+|lighting\s+|floor\s+)?plans?\b|\b(?:electrical|mechanical|plumbing)\s+(?:drawing|riser|layout|sheet)s?\b|\b(?:power|lighting|hvac|piping|duct)\s+plans?\b|\bequipment\s+plan\b/i;

function normalizeClassifierText(text) {
  return String(text || "").replace(/[\u00ad\u200b\u200c\u200d\ufeff]/g, "");
}

function hasArchitecturalPlanTitle(text) {
  return (
    (/\benlarged\b/i.test(text) && /\bplan\b/i.test(text)) ||
    /\b(?:egress|life\s+safety|exit)\s+plan\b/i.test(text) ||
    /\b(?:building|exterior|interior)\s+elevations?\b/i.test(text) ||
    (/\b(?:building|wall|typical)\s+sections?\b/i.test(text) || /\bsection\s+details?\b/i.test(text)) ||
    /\b(?:floor|level|plaza|roof|site)\s+plans?\b/i.test(text)
  );
}

/**
 * Content class is context for the model. It does not decide whether a sheet is reviewed.
 * Page size still decides raster vs spec.
 * Classification uses page text and simple drawing-title signals, never the file name.
 * @param {{ text?: string | null }} input
 * @returns {"floor_plan"|"egress_plan"|"enlarged_plan"|"elevation"|"section"|"schedule"|"form"|"mep"|"drawing"}
 */
function classifySheetContent({ text }) {
  const body = normalizeClassifierText(text);
  const header = body.slice(0, 4000);
  const titleZone = body.slice(0, 700);
  if (!header.trim()) return "drawing";

  if (
    FORM_CONTENT_RE.test(header) &&
    !hasArchitecturalPlanTitle(titleZone) &&
    !MEP_TITLE_RE.test(titleZone)
  ) {
    return "form";
  }

  const schedule = SCHEDULE_TITLE_RE.test(header);
  if (/\benlarged\b/i.test(header) && /\bplan\b/i.test(header)) return "enlarged_plan";
  if (/\b(?:egress|life\s+safety|exit)\s+plan\b/i.test(header)) return "egress_plan";
  if (/\b(?:building|exterior|interior)\s+elevations?\b/i.test(header)) return "elevation";
  if (
    (/\b(?:building|wall|typical)\s+sections?\b/i.test(header) || /\bsection\s+details?\b/i.test(header)) &&
    countCsiSpecificationSignals(header) < 2
  ) {
    return "section";
  }
  if (MEP_TITLE_RE.test(header) && !SCHEDULE_TITLE_RE.test(titleZone)) return "mep";
  if (/\b(?:floor|level|plaza|roof|site)\s+plans?\b/i.test(header)) return "floor_plan";
  if (schedule) return "schedule";
  if (/\belevations?\b/i.test(header) && !/\bplan\b/i.test(header)) return "elevation";
  return "drawing";
}

/**
 * Every content class is reviewed, including schedule, form, certificate, and MEP.
 * The class is prompt context. It must not skip the model call.
 * @param {string | null | undefined} _contentClass
 */
function shouldRunVisualDefectChecks(_contentClass) {
  return true;
}

function pageFormats(pageSizes) {
  return (pageSizes || [])
    .map((size) => pageFormatFromInches(size?.widthInches, size?.heightInches))
    .filter(Boolean);
}

function classifyDocument({ fileName, documentType, samplePageTexts = [], pageSizes = [] }) {
  const name = String(fileName || "");
  const docType = String(documentType || "").toLowerCase();
  const formats = pageFormats(pageSizes);
  const combined = samplePageTexts.join("\n").slice(0, 8000);

  // Measured page size outranks the file name. A 24x36 sheet named like a manual is a drawing.
  if (formats.length > 0 && formats.every((format) => format === "large")) {
    return { analyzerClass: "drawing_set", source: "page_size", confidence: 0.95 };
  }
  // A letter-size spec stays a spec even when the file name looks like a sheet.
  if (formats.length > 0 && formats.every((format) => format === "small") && isSmallFormatTextHeavy(combined)) {
    return { analyzerClass: "specification", source: "page_size", confidence: 0.85 };
  }

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
  // Long extracted text is a spec signal only when no sampled page is large-format.
  if (avgTextLen > 500 && !formats.includes("large")) {
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
  classifySheetContent,
  shouldRunVisualDefectChecks,
  shouldRasterizePage,
  shouldCreateAnalyzerSheets,
  countCsiSpecificationSignals,
  isArchitecturalSectionDetailDrawing,
  isArchitecturalSheetFileName,
  pageFormatFromInches,
  isSmallFormatTextHeavy,
  isAmbiguousFormatTextDense,
  LARGE_FORMAT_MIN_SHORT_SIDE_IN,
  SMALL_FORMAT_MAX_SHORT_SIDE_IN,
  SMALL_FORMAT_TEXT_HEAVY_CHARS,
  AMBIGUOUS_TEXT_DENSE_CHARS,
  CSI_SECTION_HEADING_RE,
  ARCH_SECTION_DETAIL_TITLE_RE,
  SHEET_CONTENT_CLASSES,
};
