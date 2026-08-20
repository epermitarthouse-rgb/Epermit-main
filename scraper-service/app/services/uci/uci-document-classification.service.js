"use strict";

/**
 * Normalize filename/metadata text for role classification.
 * JavaScript \\b treats underscore as a word character, so tokens like
 * `_ONE-LINE_` and `_COMcheck_` fail standard boundary-based rules.
 *
 * @param {string} text
 * @returns {string}
 */
function normalizeRoleClassificationText(text) {
  return String(text ?? "")
    .replace(/[_]+/g, " ")
    .replace(/-/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * @param {{ fileName?: string, portalDocumentName?: string, portalDocumentType?: string, documentType?: string, description?: string, text?: string }} input
 * @returns {string}
 */
function buildRoleClassificationHaystack(input) {
  return normalizeRoleClassificationText(
    [
      input.fileName,
      input.portalDocumentName,
      input.portalDocumentType,
      input.documentType,
      input.description,
      input.text,
    ]
      .filter(Boolean)
      .join(" "),
  );
}

/**
 * Content/filename document types. Independent of utility_type.
 * Stored project `document_type = other` is ignored as a classification source.
 */
const DOCUMENT_TYPE_RULES = [
  { type: "load_profile", test: /\b(LOAD[\s-]*PROFILE|GAS[\s-]*LOAD[\s-]*(LETTER|CALC|PROFILE)|LOAD[\s-]*LETTER)\b/i },
  { type: "equipment_schedule", test: /\bEQUIPMENT[\s-]*(UTILITY[\s-]*)?SCHEDULE\b/i },
  { type: "service_plan", test: /\b(PIPING[\s-]*AND[\s-]*SERVICE[\s-]*PLAN|GAS[\s-]*PIPING|SERVICE[\s-]*PLAN)\b/i },
  { type: "meter_regulator", test: /\bMETER[\s-]*REGULATOR\b/i },
  { type: "cut_sheet", test: /\b(CUT[\s-]*SHEETS?|CUTSHEET|APPLIANCE[\s-]*CUT)\b/i },
  { type: "construction_schedule", test: /\bCONSTRUCTION[\s-]*(SERVICE[\s-]*)?SCHEDULE\b/i },
  { type: "class_of_service", test: /\b(CLASS[\s-]*OF[\s-]*SERVICE|\bCOS\b|C\.O\.S\.)\b/i },
  { type: "one_line_diagram", test: /\b(ONE[\s-]*LINE|SINGLE[\s-]*LINE)\b/i },
  { type: "panel_schedule", test: /\bPANEL[\s-]*SCHEDULES?\b/i },
  { type: "electric_load_calc", test: /\b(ELECTRIC(?:AL)?[\s-]*LOAD[\s-]*CALC|LOAD[\s-]*CALC(?:ULATION)?)\b/i },
  { type: "electrical_specification", test: /\bELECTRICAL[\s-]*SPEC(?:IFICATION)?S?\b/i },
  { type: "electrical_plan", test: /\b(ELECTRICAL|POWER)[\s-]*PLAN\b/i },
  { type: "comcheck", test: /\bCOM[\s-]*CHECK\b/i },
  { type: "site_plan", test: /\bSITE[\s-]*PLAN\b/i },
  { type: "civil_plan", test: /\bCIVIL[\s-]*PLAN\b/i },
  { type: "letter_of_authorization", test: /\b(LETTER[\s-]*OF[\s-]*AUTHORIZATION|\bLOA\b)\b/i },
];

/**
 * @param {string} haystack
 * @returns {string | null}
 */
function matchDocumentTypeFromHaystack(haystack) {
  for (const rule of DOCUMENT_TYPE_RULES) {
    if (rule.test.test(haystack)) return rule.type;
  }
  return null;
}

/**
 * Classify a document's type from filename/content. Does not use generic
 * stored `document_type = other` as the answer.
 *
 * @param {Record<string, unknown> | { fileName?: string, file_name?: string, documentType?: string, document_type?: string, description?: string, text?: string }} doc
 * @returns {string}
 */
function classifyDocumentType(doc) {
  const storedType = String(doc.document_type || doc.documentType || "")
    .trim()
    .toLowerCase();
  const fileName = String(doc.file_name || doc.fileName || "");
  const portalDocumentName = String(doc.portal_document_name || doc.portalDocumentName || "");
  const portalDocumentType = String(doc.portal_document_type || doc.pepco_document_type || "");
  const description = String(doc.description || "");

  // Filename/metadata first — a shared stored `load_profile` type must not
  // override distinct synthetic gas filenames such as EQUIPMENT_SCHEDULE.
  const filenameHaystack = buildRoleClassificationHaystack({
    fileName,
    portalDocumentName,
    portalDocumentType,
    description,
  });
  const fromFilename = matchDocumentTypeFromHaystack(filenameHaystack);
  if (fromFilename) return fromFilename;

  const haystack = buildRoleClassificationHaystack({
    fileName,
    portalDocumentName,
    portalDocumentType,
    documentType: storedType && storedType !== "other" ? storedType : "",
    description,
    text: String(doc.text || "").slice(0, 4000),
  });
  const fromContent = matchDocumentTypeFromHaystack(haystack);
  if (fromContent) return fromContent;

  if (storedType && storedType !== "other" && storedType !== "unknown") return storedType;
  return "supporting_document";
}

function isConstructionScheduleDocument(doc) {
  return classifyDocumentType(doc) === "construction_schedule";
}

module.exports = {
  normalizeRoleClassificationText,
  buildRoleClassificationHaystack,
  DOCUMENT_TYPE_RULES,
  matchDocumentTypeFromHaystack,
  classifyDocumentType,
  isConstructionScheduleDocument,
};
