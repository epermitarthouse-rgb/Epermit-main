"use strict";

/**
 * Multi-document Stage 6 extraction merge.
 * Each document is extracted independently; conflicting field values are surfaced
 * for operator review — never silently resolved to a single winner.
 */

const { extractCosDesignFields } = require("./uci-cos-extract.service.js");
const { COS_COMPARE_FIELDS } = require("./uci-cos-constants.js");
const { valuesMatch } = require("./uci-cos-discrepancy.service.js");

function isIncludedInComparison(row) {
  return row == null || row.included_in_comparison !== false;
}

/**
 * @param {unknown} entry
 */
function fieldValue(entry) {
  if (entry == null) return null;
  if (typeof entry === "object" && !Array.isArray(entry) && "value" in /** @type {any} */ (entry)) {
    return /** @type {any} */ (entry).value;
  }
  return entry;
}

/**
 * @param {Array<Record<string, unknown>>} perDocument
 * @param {{ utilityType?: string }} [opts]
 */
function extractPerDocumentFields(perDocument, opts = {}) {
  /** @type {Array<Record<string, unknown>>} */
  const docs = [];
  for (const doc of Array.isArray(perDocument) ? perDocument : []) {
    const text = String(doc.text || "").trim();
    if (!text) {
      docs.push({
        name: doc.name || doc.kind || "document",
        project_document_id: doc.project_document_id || null,
        content_hash: doc.content_hash || null,
        page_count: doc.page_count ?? null,
        fields: {},
        field_count: 0,
        empty: true,
      });
      continue;
    }
    const extraction = extractCosDesignFields(text, opts);
    docs.push({
      name: doc.name || doc.kind || "document",
      project_document_id: doc.project_document_id || null,
      content_hash: doc.content_hash || null,
      page_count: doc.page_count ?? null,
      kind: doc.kind || null,
      fields: extraction.fields,
      field_count: extraction.field_count,
      extraction_confidence: extraction.extraction_confidence,
      uncertain: extraction.uncertain,
      empty: false,
    });
  }
  return docs;
}

/**
 * Merge per-document extractions. Conflicts → no silent pick.
 *
 * @param {Array<Record<string, unknown>>} docExtractions
 */
function mergeDocumentExtractions(docExtractions) {
  /** @type {Record<string, unknown>} */
  const mergedFields = {};
  /** @type {Array<Record<string, unknown>>} */
  const conflicts = [];
  /** @type {Record<string, Array<Record<string, unknown>>>} */
  const fieldSources = {};

  const nonEmpty = (Array.isArray(docExtractions) ? docExtractions : []).filter(
    (d) => !d.empty && d.fields,
  );

  for (const def of COS_COMPARE_FIELDS) {
    /** @type {Array<Record<string, unknown>>} */
    const sources = [];
    for (const doc of nonEmpty) {
      const entry = /** @type {any} */ (doc.fields)[def.key];
      if (!entry) continue;
      const value = fieldValue(entry);
      if (value == null || value === "") continue;
      sources.push({
        field: def.key,
        value,
        document_name: doc.name,
        project_document_id: doc.project_document_id || null,
        content_hash: doc.content_hash || null,
        page_count: doc.page_count ?? null,
        provenance: entry.provenance || "utility_document",
        source: entry.source || null,
        confidence: entry.confidence ?? null,
      });
    }
    if (!sources.length) continue;
    fieldSources[def.key] = sources;

    const first = sources[0];
    const allMatch = sources.every((s) => valuesMatch(s.value, first.value) === true);
    if (allMatch) {
      mergedFields[def.key] = {
        value: first.value,
        provenance: "utility_document",
        source: sources.length > 1 ? "multi_document_agree" : first.source,
        confidence: first.confidence,
        document_sources: sources.map((s) => ({
          document_name: s.document_name,
          project_document_id: s.project_document_id,
          content_hash: s.content_hash,
          page_count: s.page_count,
        })),
      };
    } else {
      conflicts.push({
        code: `${def.key.toUpperCase()}_DOCUMENT_CONFLICT`,
        field: def.key,
        label: def.label,
        severity: def.material ? "high" : "medium",
        material: def.material === true,
        message: `${def.label}: conflicting utility values across documents — operator must choose accepted value`,
        candidates: sources.map((s) => ({
          value: s.value,
          document_name: s.document_name,
          project_document_id: s.project_document_id,
        })),
      });
      mergedFields[def.key] = {
        value: null,
        conflict: true,
        candidates: sources.map((s) => ({
          value: s.value,
          document_name: s.document_name,
          project_document_id: s.project_document_id,
          content_hash: s.content_hash,
          page_count: s.page_count,
        })),
        provenance: "document_conflict",
        source: "multi_document_conflict",
        confidence: 0.3,
        document_sources: sources.map((s) => ({
          document_name: s.document_name,
          project_document_id: s.project_document_id,
          content_hash: s.content_hash,
          page_count: s.page_count,
        })),
      };
    }
  }

  // Carry non-compare extracted keys from first non-conflicting occurrence (e.g. issued date)
  for (const doc of nonEmpty) {
    for (const [key, entry] of Object.entries(/** @type {Record<string, unknown>} */ (doc.fields) || {})) {
      if (mergedFields[key]) continue;
      if (COS_COMPARE_FIELDS.some((f) => f.key === key)) continue;
      mergedFields[key] = entry;
    }
  }

  return {
    fields: mergedFields,
    conflicts,
    field_sources: fieldSources,
    document_count: nonEmpty.length,
    documents: (docExtractions || []).map((d) => ({
      name: d.name,
      project_document_id: d.project_document_id || null,
      field_count: d.field_count || 0,
      empty: d.empty === true,
      uncertain: d.uncertain === true,
    })),
  };
}

/**
 * Compact operator-facing review summary after analysis.
 *
 * @param {object} params
 */
function buildCosReviewSummary(params) {
  const {
    documentCount = 0,
    comparisonRows = [],
    discrepancies = [],
    conflicts = [],
    reviewStatus = "pending",
    evidenceStatus = "UTILITY_ISSUED",
    autoCompleted = false,
  } = params;

  const rows = Array.isArray(comparisonRows) ? comparisonRows : [];
  const includedRows = rows.filter(isIncludedInComparison);
  const matchCount = includedRows.filter((r) => r.result === "match").length;
  const discrepancyCount = includedRows.filter(
    (r) =>
      r.result &&
      r.result !== "match" &&
      r.result !== "insufficient_data" &&
      r.result !== "document_conflict" &&
      r.result !== "baseline_missing" &&
      r.result !== "utility_value_missing" &&
      r.result !== "utility_not_provided",
  ).length;
  const conflictCount =
    (Array.isArray(conflicts) ? conflicts.length : 0) ||
    includedRows.filter((r) => r.result === "document_conflict" || r.utility_conflict === true)
      .length;

  // New utility conditions: utility issued a value where baseline was missing
  const newUtilityConditions = includedRows.filter(
    (r) => r.result === "baseline_missing" || (r.submitted == null && r.utility_issued != null),
  ).length;

  const materialCount = (Array.isArray(discrepancies) ? discrepancies : []).filter(
    (d) => d && (d.severity === "high" || d.material === true),
  ).length;

  /** @type {string} */
  let nextAction = "Review values, then Approve COS";
  if (autoCompleted === true || String(reviewStatus) === "approved") {
    nextAction = autoCompleted
      ? "Auto-completed — clean match (Flag / Reopen / Correct if needed)"
      : "Approved — Stage 6 complete";
  } else if (String(reviewStatus) === "revision_required") {
    nextAction = "Request revision / await revised plans";
  } else if (conflictCount > 0) {
    nextAction = "Resolve document conflicts — choose Accepted value with reason";
  } else if (materialCount > 0 || String(evidenceStatus) === "DISCREPANCY") {
    nextAction = "Resolve discrepancies — edit Accepted or Accept deviation, then Approve";
  } else if (rows.length === 0) {
    nextAction = "Upload or receive a utility COS / design document";
  } else if (String(reviewStatus) === "ready_for_approval") {
    nextAction = "Review values, then Approve COS";
  } else {
    nextAction = "Review values and resolve open items";
  }

  const parts = [
    `${documentCount} document${documentCount === 1 ? "" : "s"} analyzed`,
    `${matchCount} match${matchCount === 1 ? "" : "es"}`,
  ];
  if (newUtilityConditions > 0) {
    parts.push(
      `${newUtilityConditions} new utility condition${newUtilityConditions === 1 ? "" : "s"}`,
    );
  }
  if (discrepancyCount > 0) {
    parts.push(`${discrepancyCount} discrepanc${discrepancyCount === 1 ? "y" : "ies"}`);
  }
  if (conflictCount > 0) {
    parts.push(`${conflictCount} document conflict${conflictCount === 1 ? "" : "s"}`);
  }

  return {
    headline: parts.join(" · "),
    document_count: documentCount,
    match_count: matchCount,
    discrepancy_count: discrepancyCount,
    conflict_count: conflictCount,
    new_utility_condition_count: newUtilityConditions,
    material_count: materialCount,
    next_action: nextAction,
    auto_completed: autoCompleted === true,
    workflow_step:
      autoCompleted === true || String(reviewStatus) === "approved"
        ? "approved"
        : rows.length === 0
          ? "awaiting_documents"
          : conflictCount > 0 || materialCount > 0
            ? "resolve_differences"
            : "review_values",
  };
}

/**
 * Annotate comparison rows with document-conflict status when extraction flagged conflict.
 *
 * @param {Array<Record<string, unknown>>} comparisonRows
 * @param {Record<string, unknown>} mergedFields
 * @param {Array<Record<string, unknown>>} conflicts
 */
function annotateComparisonRowsWithConflicts(comparisonRows, mergedFields, conflicts) {
  const conflictByField = new Map(
    (conflicts || []).map((c) => [String(c.field), c]),
  );
  return (comparisonRows || []).map((row) => {
    const key = String(row.field || "");
    const merged = mergedFields[key];
    const conflict = conflictByField.get(key);
    if (!conflict && !(merged && typeof merged === "object" && /** @type {any} */ (merged).conflict)) {
      return row;
    }
    const candidates =
      (conflict && conflict.candidates) ||
      (merged && typeof merged === "object" ? /** @type {any} */ (merged).candidates : []) ||
      [];
    const display =
      candidates.length > 0
        ? candidates.map((c) => `${c.value} (${c.document_name || "doc"})`).join(" vs ")
        : "Conflict";
    return {
      ...row,
      utility_issued: null,
      utility_issued_display: display,
      utility_conflict: true,
      utility_candidates: candidates,
      accepted: row.accepted != null ? row.accepted : null,
      operator_override: row.operator_override === true,
      result: "document_conflict",
      required_action: "Choose Accepted value — conflicting documents",
    };
  });
}

module.exports = {
  extractPerDocumentFields,
  mergeDocumentExtractions,
  buildCosReviewSummary,
  annotateComparisonRowsWithConflicts,
};
