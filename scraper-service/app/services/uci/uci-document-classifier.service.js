"use strict";

const {
  classifyDocumentType,
  buildRoleClassificationHaystack,
  matchDocumentTypeFromHaystack,
} = require("./uci-document-classification.service.js");
const {
  normalizeDocumentTypeToRole,
  resolveClassificationReview,
} = require("./uci-document-role-stages.js");

/** High-confidence filename patterns → normalized role. */
const HIGH_CONFIDENCE_ROLE_RULES = [
  { role: "single_line_diagram", test: /\b(ONE[\s-]*LINE|SINGLE[\s-]*LINE)\b/i },
  { role: "site_plan", test: /\b(SITE[\s-]*PLAN|SITE[\s_-]*UTILITY[\s_-]*PLAN|CIVIL[\s-]*PLAN|PLOT[\s-]*PLAN)\b/i },
  { role: "equipment_schedule", test: /\bEQUIPMENT[\s-]*(UTILITY[\s-]*)?SCHEDULE\b/i },
  { role: "construction_schedule", test: /\bCONSTRUCTION[\s-]*(SERVICE[\s-]*)?SCHEDULE\b/i },
  { role: "equipment_cut_sheet", test: /\b(CUT[\s-]*SHEETS?|CUTSHEET|APPLIANCE[\s-]*CUT)\b/i },
  { role: "letter_of_authorization", test: /\b(LETTER[\s-]*OF[\s-]*AUTHORIZATION|\bLOA\b)\b/i },
  { role: "load_letter", test: /\b(LOAD[\s-]*LETTER|ELECTRIC(?:AL)?[\s-]*LOAD[\s-]*LETTER)\b/i },
  { role: "load_calculation_worksheet", test: /\b(LOAD[\s-]*CALC(?:ULATION)?[\s-]*WORKSHEET|LOAD[\s-]*WORKSHEET)\b/i },
  { role: "class_of_service", test: /\b(CLASS[\s-]*OF[\s-]*SERVICE|\bCOS\b|C\.O\.S\.)\b/i },
  { role: "meter_regulator", test: /\bMETER[\s-]*REGULATOR\b/i },
  { role: "load_letter", test: /\bLOAD[\s-]*PROFILE\b/i },
];

/** Medium-confidence patterns. */
const MEDIUM_CONFIDENCE_ROLE_RULES = [
  { role: "single_line_diagram", test: /\bELECTRICAL[\s-]*ONE[\s-]*LINE\b/i },
  { role: "site_plan", test: /\bCIVIL\b/i },
  { role: "equipment_evidence", test: /\bELECTRICAL[\s-]*SPEC(?:IFICATION)?S?\b/i },
  { role: "panel_schedule", test: /\bPANEL[\s-]*SCHEDULES?\b/i },
  { role: "comcheck", test: /\bCOM[\s-]*CHECK\b/i },
  { role: "closeout", test: /\bCLOSE[\s-]*OUT\b/i },
  { role: "ciac", test: /\bCIAC\b/i },
];

/**
 * @param {Record<string, unknown>} doc
 * @returns {string}
 */
function buildClassifierHaystack(doc) {
  return buildRoleClassificationHaystack({
    fileName: String(doc.file_name || doc.fileName || ""),
    portalDocumentName: String(doc.portal_document_name || doc.portalDocumentName || ""),
    portalDocumentType: String(doc.portal_document_type || doc.pepco_document_type || ""),
    documentType:
      String(doc.document_type || doc.documentType || "").toLowerCase() !== "other"
        ? String(doc.document_type || doc.documentType || "")
        : "",
    description: String(doc.description || ""),
    text: String(doc.text || "").slice(0, 4000),
  });
}

/**
 * @param {string} haystack
 * @returns {{ role: string, confidence: "high" | "medium" | "low", reason: string } | null}
 */
function matchRoleFromHaystack(haystack) {
  if (!haystack) return null;
  for (const rule of HIGH_CONFIDENCE_ROLE_RULES) {
    if (rule.test.test(haystack)) {
      return { role: rule.role, confidence: "high", reason: "Filename/metadata high-confidence match" };
    }
  }
  for (const rule of MEDIUM_CONFIDENCE_ROLE_RULES) {
    if (rule.test.test(haystack)) {
      return { role: rule.role, confidence: "medium", reason: "Filename/metadata medium-confidence match" };
    }
  }
  return null;
}

/**
 * Classify a project document into a normalized registry role with confidence.
 *
 * @param {Record<string, unknown>} doc
 * @param {{ hintRole?: string, provenance?: string }} [options]
 * @returns {{
 *   detected_role: string,
 *   role_confidence: "high" | "medium" | "low",
 *   classification_review: "auto_accepted" | "review_recommended" | "needs_classification",
 *   classification_reason: string,
 * }}
 */
function classifyDocumentRole(doc, options = {}) {
  const hintRole = options.hintRole ? normalizeDocumentTypeToRole(options.hintRole) : null;
  if (hintRole && hintRole !== "other") {
    return {
      detected_role: hintRole,
      role_confidence: "high",
      classification_review: "auto_accepted",
      classification_reason: "Explicit role hint from upload context",
    };
  }

  const storedType = String(doc.document_type || doc.documentType || "")
    .trim()
    .toLowerCase();
  if (storedType && storedType !== "other" && storedType !== "unknown") {
    const role = normalizeDocumentTypeToRole(storedType);
    if (role !== "other" && role !== "supporting_document") {
      const confidence =
        storedType === "load_calculation_worksheet" || storedType === "letter_of_authorization"
          ? "high"
          : "medium";
      return {
        detected_role: role,
        role_confidence: confidence,
        classification_review: resolveClassificationReview(confidence, role),
        classification_reason: `Stored document_type: ${storedType}`,
      };
    }
  }

  const haystack = buildClassifierHaystack(doc);
  const directMatch = matchRoleFromHaystack(haystack);
  if (directMatch) {
    return {
      detected_role: directMatch.role,
      role_confidence: directMatch.confidence,
      classification_review: resolveClassificationReview(directMatch.confidence, directMatch.role),
      classification_reason: directMatch.reason,
    };
  }

  const classifiedType = classifyDocumentType(doc);
  const fromType = normalizeDocumentTypeToRole(classifiedType);
  if (fromType !== "other" && fromType !== "supporting_document") {
    const fromHaystack = matchDocumentTypeFromHaystack(haystack);
    const confidence = fromHaystack ? "high" : "medium";
    return {
      detected_role: fromType,
      role_confidence: confidence,
      classification_review: resolveClassificationReview(confidence, fromType),
      classification_reason: fromHaystack
        ? "Content/filename classification rule match"
        : `Derived from document type classifier: ${classifiedType}`,
    };
  }

  if (options.provenance === "uci_generated") {
    return {
      detected_role: "load_calculation_worksheet",
      role_confidence: "high",
      classification_review: "auto_accepted",
      classification_reason: "UCI-generated document",
    };
  }

  return {
    detected_role: "other",
    role_confidence: "low",
    classification_review: "needs_classification",
    classification_reason: "No confident role match",
  };
}

/**
 * Infer signature status from filename for LOA documents.
 *
 * @param {string | null | undefined} role
 * @param {Record<string, unknown>} doc
 * @returns {"unknown" | "unsigned" | "signed" | null}
 */
function inferSignatureStatus(role, doc) {
  if (role !== "letter_of_authorization") return null;
  const haystack = buildClassifierHaystack(doc).toUpperCase();
  if (/\bUNSIGNED\b/.test(haystack)) return "unsigned";
  if (/\bSIGNED\b/.test(haystack)) return "signed";
  return "unknown";
}

module.exports = {
  buildClassifierHaystack,
  classifyDocumentRole,
  inferSignatureStatus,
};
