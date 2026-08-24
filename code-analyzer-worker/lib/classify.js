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
const DRAWING_SHEET_RE = /\b([A-Z]{1,4}-\d+(?:\.\d+)*)\b/;

function classifyDocument({ fileName, documentType, samplePageTexts = [] }) {
  const name = String(fileName || "");
  const docType = String(documentType || "").toLowerCase();

  if (docType === "code_modification_application" || FORM_FILENAME_RE.test(name)) {
    return { analyzerClass: "code_modification_form", source: "filename", confidence: 0.95 };
  }
  if (docType === "specification" || SPEC_FILENAME_RE.test(name)) {
    return { analyzerClass: "specification", source: "filename", confidence: 0.9 };
  }
  if (SCHEDULE_FILENAME_RE.test(name)) {
    return { analyzerClass: "schedule", source: "filename", confidence: 0.85 };
  }
  if (
    docType === "permit_drawing" ||
    docType === "floor_plan" ||
    docType === "elevation" ||
    docType === "site_plan" ||
    DRAWING_FILENAME_RE.test(name)
  ) {
    return { analyzerClass: "drawing_set", source: "filename", confidence: 0.85 };
  }

  const combined = samplePageTexts.join("\n").slice(0, 8000);
  const specHits = (combined.match(SPEC_TEXT_RE) || []).length;
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

  return { analyzerClass: "unknown", source: "auto", confidence: 0.3 };
}

function shouldRasterizePage(analyzerClass) {
  return analyzerClass === "drawing_set" || analyzerClass === "schedule" || analyzerClass === "mixed";
}

function shouldCreateAnalyzerSheets(analyzerClass) {
  return analyzerClass === "drawing_set" || analyzerClass === "mixed";
}

module.exports = { classifyDocument, shouldRasterizePage, shouldCreateAnalyzerSheets };
