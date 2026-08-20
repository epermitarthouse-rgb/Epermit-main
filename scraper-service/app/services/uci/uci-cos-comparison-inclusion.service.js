"use strict";

/**
 * Stage 6 comparison-row inclusion toggles.
 * Operators may exclude noisy/non-core parser rows from blocker logic while
 * keeping utility evidence immutable on each row.
 */

const { COS_COMPARE_FIELDS } = require("./uci-cos-constants.js");

/** Core COS fields — require explicit confirmation before exclusion. */
const COS_CORE_COMPARE_FIELD_KEYS = Object.freeze([
  "service_amperage",
  "service_voltage",
  "phase",
  "wire_configuration",
  "meter_count",
]);

const STRUCTURAL_DISCREPANCY_CODES = Object.freeze([
  "REVISION_REQUIRED",
  "PARSE_OR_EXTRACTION_UNCERTAIN",
  "LOAD_PROFILE_MISSING",
  "APPLICATION_PACKAGE_MISSING",
  "INSUFFICIENT_COMPARISON",
  "AUTO_COMPLETE_GATED",
]);

/**
 * @param {Record<string, unknown> | null | undefined} row
 */
function isIncludedInComparison(row) {
  return row == null || row.included_in_comparison !== false;
}

/**
 * @param {string} fieldKey
 */
function isCoreCompareField(fieldKey) {
  return COS_CORE_COMPARE_FIELD_KEYS.includes(String(fieldKey || ""));
}

/**
 * @param {Array<Record<string, unknown>>} comparisonRows
 */
function normalizeComparisonRowInclusion(comparisonRows) {
  return (Array.isArray(comparisonRows) ? comparisonRows : []).map((row) => ({
    ...row,
    included_in_comparison: row.included_in_comparison !== false,
  }));
}

/**
 * @param {Record<string, unknown>} row
 */
function deriveDiscrepancyFromComparisonRow(row) {
  const field = String(row.field || "");
  const def = COS_COMPARE_FIELDS.find((f) => f.key === field);
  const label = String(row.label || def?.label || field);
  const submitted = row.submitted ?? null;
  const issued = row.utility_issued ?? null;
  const result = String(row.result || "");

  if (result === "match" || result === "insufficient_data") return null;

  if (result === "utility_value_missing") {
    if (!def?.material) return null;
    return {
      code: `${field.toUpperCase()}_MISSING_UTILITY`,
      field,
      severity: "high",
      material: true,
      message: `Utility-issued ${label} not found in COS/design document`,
      submitted,
      utility_issued: null,
    };
  }

  if (result === "baseline_missing") {
    return {
      code: `${field.toUpperCase()}_BASELINE_MISSING`,
      field,
      severity: "medium",
      message: `Utility issued ${label} but verified baseline is missing`,
      submitted: null,
      utility_issued: issued,
    };
  }

  if (result === "document_conflict" || row.utility_conflict === true) {
    return {
      code: `${field.toUpperCase()}_DOCUMENT_CONFLICT`,
      field,
      severity: def?.material ? "high" : "medium",
      material: def?.material === true,
      message: `${label}: conflicting utility values across documents — operator must choose accepted value`,
      submitted,
      utility_issued: issued,
    };
  }

  if (
    result === "mismatch" ||
    result === "undersized" ||
    result === "oversized" ||
    result === "utility_value_missing"
  ) {
    return {
      code: `${field.toUpperCase()}_${result.toUpperCase()}`,
      field,
      severity: def?.material ? "high" : "medium",
      message: `${label}: submitted ${submitted} vs utility-issued ${issued} (${result})`,
      submitted,
      utility_issued: issued,
      material: def?.material === true,
    };
  }

  if (result && result !== "match") {
    return {
      code: `${field.toUpperCase()}_${result.toUpperCase()}`,
      field,
      severity: def?.material ? "high" : "medium",
      message: `${label}: ${result}`,
      submitted,
      utility_issued: issued,
      material: def?.material === true,
    };
  }

  return null;
}

/**
 * @param {unknown} discrepancy
 */
function isStructuralDiscrepancy(discrepancy) {
  if (!discrepancy || typeof discrepancy !== "object") return false;
  const code = String(/** @type {any} */ (discrepancy).code || "");
  if (STRUCTURAL_DISCREPANCY_CODES.includes(code)) return true;
  if (code.endsWith("_DOCUMENT_CONFLICT")) return true;
  return false;
}

/**
 * Recompute review / blocker state from comparison rows + structural discrepancies.
 *
 * @param {object} params
 * @param {Array<Record<string, unknown>>} params.comparisonRows
 * @param {Array<Record<string, unknown>>} [params.structuralDiscrepancies]
 * @param {boolean} [params.revisionRequired]
 * @param {number} [params.documentCount]
 * @param {Array<Record<string, unknown>>} [params.documentConflicts]
 */
function recomputeCosReviewFromComparisonRows(params) {
  const {
    comparisonRows = [],
    structuralDiscrepancies = [],
    revisionRequired = false,
    documentCount = 0,
    documentConflicts = [],
  } = params;

  const rows = normalizeComparisonRowInclusion(comparisonRows);
  const includedRows = rows.filter(isIncludedInComparison);
  const includedFields = new Set(includedRows.map((r) => String(r.field || "")).filter(Boolean));

  /** @type {Array<Record<string, unknown>>} */
  const rowDiscrepancies = [];
  for (const row of includedRows) {
    const d = deriveDiscrepancyFromComparisonRow(row);
    if (d) rowDiscrepancies.push(d);
  }

  const structural = (Array.isArray(structuralDiscrepancies) ? structuralDiscrepancies : []).filter(
    (d) => {
      if (!d || typeof d !== "object") return false;
      const field = d.field != null ? String(d.field) : null;
      if (!field) return isStructuralDiscrepancy(d);
      if (!isStructuralDiscrepancy(d)) return false;
      return includedFields.has(field);
    },
  );

  const discrepancies = [...structural, ...rowDiscrepancies];

  const materialDiscrepancies = discrepancies.filter(
    (d) => d && (d.severity === "high" || d.material === true || d.code === "REVISION_REQUIRED"),
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
  } else if (includedRows.length === 0) {
    analysis_status = "needs_attention";
    evidence_status = "UTILITY_ISSUED";
    review_status = "needs_attention";
    discrepancies.push({
      code: "INSUFFICIENT_COMPARISON",
      severity: "high",
      message: "No comparison rows included — include at least one field or upload COS evidence",
    });
  } else if (discrepancies.length > 0) {
    analysis_status = "needs_attention";
    evidence_status = "DISCREPANCY";
    review_status = "needs_attention";
  }

  const cleanMatch =
    !revisionRequired &&
    discrepancies.length === 0 &&
    includedRows.length > 0 &&
    review_status === "ready_for_approval";

  const matchCount = includedRows.filter((r) => r.result === "match").length;
  const reviewSummary = {
    headline: `${documentCount} document${documentCount === 1 ? "" : "s"} analyzed · ${matchCount} match${matchCount === 1 ? "" : "es"}`,
    document_count: documentCount,
    match_count: matchCount,
    discrepancy_count: rowDiscrepancies.length,
    material_count: materialDiscrepancies.length,
    next_action:
      cleanMatch
        ? "Review values, then Approve COS"
        : revisionRequired
          ? "Request revision / await revised plans"
          : "Resolve discrepancies or exclude parser-noise rows from comparison",
    auto_completed: false,
    workflow_step: cleanMatch
      ? "review_values"
      : revisionRequired
        ? "resolve_differences"
        : materialDiscrepancies.length > 0
          ? "resolve_differences"
          : "review_values",
  };

  return {
    comparison_rows: rows,
    discrepancies,
    material_discrepancy_count: materialDiscrepancies.length,
    has_material_discrepancy: materialDiscrepancies.length > 0,
    analysis_status,
    evidence_status,
    review_status,
    requires_human_review: !cleanMatch,
    clean_match: cleanMatch,
    review_summary: reviewSummary,
    needs_human_attention: !cleanMatch,
    attention_reasons: discrepancies.map((d) => d.code || d.message).filter(Boolean),
  };
}

/**
 * Apply operator inclusion toggles to comparison rows.
 *
 * @param {object} cos
 * @param {Array<{ field: string, included_in_comparison: boolean }>} toggles
 * @param {{ confirmCoreExclusion?: boolean }} [opts]
 */
function applyComparisonInclusionToggles(cos, toggles, opts = {}) {
  const { confirmCoreExclusion = false } = opts;
  const rows = normalizeComparisonRowInclusion(
    Array.isArray(cos.comparison_rows) ? cos.comparison_rows : [],
  );
  const byField = new Map(rows.map((r) => [String(r.field || ""), r]));

  for (const toggle of Array.isArray(toggles) ? toggles : []) {
    const field = String(toggle.field || "").trim();
    if (!field || !byField.has(field)) {
      const err = new Error(`Unknown comparison row field: ${field || "(empty)"}`);
      err.statusCode = 400;
      err.code = "COS_COMPARISON_FIELD_UNKNOWN";
      throw err;
    }
    const included = toggle.included_in_comparison !== false;
    if (!included && isCoreCompareField(field) && !confirmCoreExclusion) {
      const err = new Error(
        `Core field "${field}" requires confirmation before excluding from comparison`,
      );
      err.statusCode = 409;
      err.code = "CORE_FIELD_EXCLUSION_REQUIRES_CONFIRMATION";
      throw err;
    }
    const row = byField.get(field);
    if (row) row.included_in_comparison = included;
  }

  return rows;
}

/**
 * Included rows only — for approve / conflict guards.
 * @param {Array<Record<string, unknown>>} comparisonRows
 */
function filterIncludedComparisonRows(comparisonRows) {
  return normalizeComparisonRowInclusion(comparisonRows).filter(isIncludedInComparison);
}

/**
 * Whether any included row still blocks Stage 6 completion.
 * @param {Array<Record<string, unknown>>} comparisonRows
 */
function includedRowsHaveBlockers(comparisonRows) {
  const included = filterIncludedComparisonRows(comparisonRows);
  return included.some((row) => {
    const result = String(row.result || "");
    if (result === "match" || result === "insufficient_data") return false;
    if (row.utility_conflict === true || result === "document_conflict") {
      return row.accepted == null || row.accepted === "";
    }
    return true;
  });
}

module.exports = {
  COS_CORE_COMPARE_FIELD_KEYS,
  isIncludedInComparison,
  isCoreCompareField,
  normalizeComparisonRowInclusion,
  deriveDiscrepancyFromComparisonRow,
  recomputeCosReviewFromComparisonRows,
  applyComparisonInclusionToggles,
  filterIncludedComparisonRows,
  includedRowsHaveBlockers,
};
