"use strict";

const {
  COS_COMPARE_FIELDS,
  isRequiredForCosAcceptance,
} = require("./uci-cos-constants.js");

/**
 * @param {unknown} value
 */
function unwrapComparisonScalar(value) {
  if (value == null || value === "") return null;
  if (typeof value === "object" && !Array.isArray(value)) {
    const obj = /** @type {Record<string, unknown>} */ (value);
    if ("value" in obj) {
      const inner = obj.value;
      if (
        inner != null &&
        typeof inner === "object" &&
        !Array.isArray(inner) &&
        "value" in /** @type {Record<string, unknown>} */ (inner)
      ) {
        return /** @type {Record<string, unknown>} */ (inner).value ?? null;
      }
      return inner ?? null;
    }
  }
  return value;
}

/**
 * @param {unknown} value
 */
function normalizeComparable(value) {
  if (value == null) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  let s = String(value).trim().toLowerCase().replace(/\s+/g, " ");
  if (!s) return null;

  // Voltage forms: keep slash structure (do not collapse to a single number)
  if (/[\/y]/.test(s) && /\d/.test(s) && /v(?:olts?)?$/.test(s.replace(/\s+/g, ""))) {
    return s.replace(/\s*v(?:olts?)?\s*$/i, "").replace(/\s+/g, "");
  }
  if (/^\d{2,4}\s*\/\s*\d{2,4}$/.test(s) || /^\d{2,4}y\/\d{2,4}$/.test(s)) {
    return s.replace(/\s+/g, "");
  }

  // Phase / wire shorthand
  const wire = s.match(/^([34])(?:[\s-]?wire)?$/);
  if (wire) return wire[1];
  const phase = s.match(/^([123])(?:[\s-]?ph(?:ase)?)?$/) || s.match(/^(single|three)[\s-]?phase$/);
  if (phase) {
    if (phase[1] === "three") return "3";
    if (phase[1] === "single") return "1";
    return phase[1];
  }

  // Amperage / pure numeric (avoid voltage-like strings)
  if (!s.includes("/")) {
    const amp = s.match(/^([0-9]+(?:\.[0-9]+)?)\s*a(?:mps?)?$/);
    if (amp) return Number(amp[1]);
    if (/^\d+(\.\d+)?$/.test(s.replace(/,/g, ""))) return Number(s.replace(/,/g, ""));
  }
  return s;
}

/**
 * @param {unknown} a
 * @param {unknown} b
 */
function valuesMatch(a, b) {
  const left = normalizeComparable(a);
  const right = normalizeComparable(b);
  if (left == null || right == null) return null;
  if (typeof left === "number" && typeof right === "number") {
    return Math.abs(left - right) < 0.01;
  }
  return String(left) === String(right);
}

/**
 * @param {string} key
 * @param {unknown} submitted
 * @param {unknown} issued
 */
function classifyNumericDiscrepancy(key, submitted, issued) {
  if (key !== "service_amperage" && key !== "demand_load_kw") return "mismatch";
  const s = Number(submitted);
  const i = Number(issued);
  if (!Number.isFinite(s) || !Number.isFinite(i)) return "mismatch";
  if (i < s) return "undersized";
  if (i > s) return "oversized";
  return "match";
}

/**
 * Field-level discrepancy engine: submitted/verified baseline vs utility-issued extraction.
 *
 * @param {object} params
 * @param {Record<string, unknown>} params.baselineFields
 * @param {Record<string, unknown>} params.extractedFields
 */
function buildCosDiscrepancyReport(params) {
  const { baselineFields = {}, extractedFields = {} } = params;

  /** @type {Array<Record<string, unknown>>} */
  const comparison_rows = [];
  /** @type {Array<Record<string, unknown>>} */
  const discrepancies = [];

  for (const def of COS_COMPARE_FIELDS) {
    const baseline = baselineFields[def.key];
    const issuedEntry = extractedFields[def.key];
    const submittedValue = unwrapComparisonScalar(
      baseline && typeof baseline === "object" && "value" in /** @type {any} */ (baseline)
        ? /** @type {any} */ (baseline).value
        : baseline ?? null,
    );
    const issuedValue = unwrapComparisonScalar(
      issuedEntry && typeof issuedEntry === "object" && "value" in /** @type {any} */ (issuedEntry)
        ? /** @type {any} */ (issuedEntry).value
        : issuedEntry ?? null,
    );

    if (submittedValue == null && issuedValue == null) continue;

    const match = valuesMatch(submittedValue, issuedValue);
    let result = "insufficient_data";
    let requiredAction = "Review";

    if (submittedValue != null && issuedValue == null) {
      const requiredForAcceptance = isRequiredForCosAcceptance(def.key);
      if (requiredForAcceptance) {
        result = "utility_value_missing";
        requiredAction = "Needs Attention — utility value not extracted";
        discrepancies.push({
          code: `${def.key.toUpperCase()}_MISSING_UTILITY`,
          field: def.key,
          severity: "high",
          material: true,
          blocking: true,
          message: `Utility-issued ${def.label} not found in COS/design document`,
          submitted: submittedValue,
          utility_issued: null,
        });
      } else {
        result = "utility_not_provided";
        requiredAction = "Not provided by utility — informational";
      }
    } else if (submittedValue == null && issuedValue != null) {
      result = "baseline_missing";
      requiredAction = "Needs Attention — no verified baseline to compare";
      discrepancies.push({
        code: `${def.key.toUpperCase()}_BASELINE_MISSING`,
        field: def.key,
        severity: "medium",
        message: `Utility issued ${def.label} but verified baseline is missing`,
        submitted: null,
        utility_issued: issuedValue,
      });
    } else if (match === true) {
      result = "match";
      requiredAction = "None";
    } else {
      result = classifyNumericDiscrepancy(def.key, submittedValue, issuedValue);
      requiredAction =
        result === "undersized"
          ? "Needs Attention — undersized service / design basis"
          : "Needs Attention — material discrepancy";
      discrepancies.push({
        code: `${def.key.toUpperCase()}_${String(result).toUpperCase()}`,
        field: def.key,
        severity: def.material ? "high" : "medium",
        message: `${def.label}: submitted ${submittedValue} vs utility-issued ${issuedValue} (${result})`,
        submitted: submittedValue,
        utility_issued: issuedValue,
        material: def.material,
      });
    }

    comparison_rows.push({
      field: def.key,
      label: def.label,
      submitted: submittedValue,
      utility_issued: issuedValue,
      // Operator accepted defaults to utility-issued; edits never overwrite this column
      accepted: issuedValue,
      operator_override: false,
      override_reason: null,
      included_in_comparison: true,
      result,
      required_action: requiredAction,
      material: def.material,
      required_for_acceptance: isRequiredForCosAcceptance(def.key),
      blocking: isRequiredForCosAcceptance(def.key) && result === "utility_value_missing",
      baseline_provenance:
        baseline && typeof baseline === "object"
          ? /** @type {any} */ (baseline).provenance ||
            /** @type {any} */ (baseline).baseline_source
          : null,
      utility_provenance:
        issuedEntry && typeof issuedEntry === "object"
          ? /** @type {any} */ (issuedEntry).provenance || "utility_document"
          : null,
    });
  }

  const revisionRequired =
    extractedFields.revision_required &&
    typeof extractedFields.revision_required === "object" &&
    /** @type {any} */ (extractedFields.revision_required).value === true;

  if (revisionRequired) {
    discrepancies.push({
      code: "REVISION_REQUIRED",
      field: "design_conditions",
      severity: "high",
      message: "Utility design comments require revised plans or additional documents",
      submitted: null,
      utility_issued:
        extractedFields.required_next_documents &&
        typeof extractedFields.required_next_documents === "object"
          ? /** @type {any} */ (extractedFields.required_next_documents).value
          : true,
    });
  }

  const materialDiscrepancies = discrepancies.filter(
    (d) =>
      d &&
      d.blocking !== false &&
      (d.severity === "high" || d.material === true || d.code === "REVISION_REQUIRED"),
  );

  let analysis_status = "ready_for_approval";
  let evidence_status = "UTILITY_ISSUED";
  let review_status = "ready_for_approval";

  if (revisionRequired) {
    analysis_status = "revision_required";
    evidence_status = "DISCREPANCY";
    review_status = "revision_required";
  } else if (materialDiscrepancies.length > 0) {
    analysis_status = "needs_attention";
    evidence_status = "DISCREPANCY";
    review_status = "needs_attention";
  } else if (comparison_rows.length === 0) {
    analysis_status = "needs_attention";
    evidence_status = "UTILITY_ISSUED";
    review_status = "needs_attention";
    discrepancies.push({
      code: "INSUFFICIENT_COMPARISON",
      severity: "high",
      message: "Insufficient extracted or baseline fields for COS comparison",
    });
  } else if (discrepancies.length > 0) {
    const blockingDiscrepancies = discrepancies.filter(
      (d) => d && d.blocking !== false && d.severity !== "informational",
    );
    if (blockingDiscrepancies.length > 0) {
      analysis_status = "needs_attention";
      evidence_status = "DISCREPANCY";
      review_status = "needs_attention";
    }
  }

  const cleanMatch =
    !revisionRequired &&
    materialDiscrepancies.length === 0 &&
    comparison_rows.length > 0 &&
    review_status === "ready_for_approval";

  return {
    analysis_status,
    evidence_status,
    review_status,
    comparison_rows,
    discrepancies,
    material_discrepancy_count: materialDiscrepancies.length,
    has_material_discrepancy: materialDiscrepancies.length > 0,
    revision_required: revisionRequired,
    // Client Agent 6 §A6.10: no discrepancy → auto-complete (no manual Approve COS)
    requires_human_review: !cleanMatch,
    clean_match: cleanMatch,
  };
}

module.exports = {
  buildCosDiscrepancyReport,
  valuesMatch,
  normalizeComparable,
  unwrapComparisonScalar,
};
