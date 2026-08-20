"use strict";

/**
 * Stage 6 accepted-value layer helpers.
 * Utility-issued extraction stays immutable; operator accepted values are editable.
 */

const { COS_COMPARE_FIELDS } = require("./uci-cos-constants.js");

/**
 * @param {unknown} entry
 */
function unwrapValue(entry) {
  if (entry == null) return null;
  if (typeof entry === "object" && !Array.isArray(entry) && "value" in /** @type {any} */ (entry)) {
    return /** @type {any} */ (entry).value;
  }
  return entry;
}

/**
 * Lightweight equality for accepted vs utility (avoids circular import with discrepancy).
 * @param {unknown} a
 * @param {unknown} b
 */
function sameAccepted(a, b) {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  if (typeof a === "number" && typeof b === "number") {
    return Math.abs(a - b) < 0.01;
  }
  const left = String(a).trim().toLowerCase().replace(/\s+/g, " ");
  const right = String(b).trim().toLowerCase().replace(/\s+/g, " ");
  if (/^\d+(\.\d+)?$/.test(left) && /^\d+(\.\d+)?$/.test(right)) {
    return Math.abs(Number(left) - Number(right)) < 0.01;
  }
  // Amp shorthand
  const ampL = left.match(/^([0-9]+(?:\.[0-9]+)?)\s*a(?:mps?)?$/);
  const ampR = right.match(/^([0-9]+(?:\.[0-9]+)?)\s*a(?:mps?)?$/);
  if (ampL && ampR) return Math.abs(Number(ampL[1]) - Number(ampR[1])) < 0.01;
  return left === right;
}

/**
 * Resolve source document / page evidence for a field from COS record context.
 * @param {object} cos
 * @param {string} fieldKey
 * @param {Record<string, unknown> | null} [comparisonRow]
 */
function resolveSourceEvidence(cos, fieldKey, comparisonRow = null) {
  const refs = Array.isArray(cos?.document_refs) ? cos.document_refs : [];
  const primaryRef =
    refs.find((r) => r && typeof r === "object" && (r.project_document_id || r.name || r.id)) ||
    refs[0] ||
    null;

  const extracted =
    cos?.extracted_fields && typeof cos.extracted_fields === "object"
      ? cos.extracted_fields[fieldKey]
      : null;
  const extractedProv =
    extracted && typeof extracted === "object"
      ? /** @type {any} */ (extracted).provenance ||
        /** @type {any} */ (extracted).source ||
        null
      : null;

  const rowProv =
    comparisonRow && typeof comparisonRow === "object"
      ? comparisonRow.utility_provenance || null
      : null;

  return {
    source_document:
      primaryRef && typeof primaryRef === "object"
        ? {
            project_document_id: primaryRef.project_document_id || primaryRef.id || null,
            name: primaryRef.name || primaryRef.file_name || primaryRef.filename || null,
            mime_type: primaryRef.mime_type || primaryRef.content_type || null,
            content_hash: primaryRef.content_hash || null,
            communication_id: cos.source_communication_id || primaryRef.communication_id || null,
          }
        : cos?.source_communication_id
          ? { communication_id: cos.source_communication_id, name: null, project_document_id: null }
          : null,
    evidence_page:
      (extracted && typeof extracted === "object" && /** @type {any} */ (extracted).page) ||
      (primaryRef && typeof primaryRef === "object" && primaryRef.page) ||
      null,
    utility_provenance: rowProv || extractedProv || "utility_document",
  };
}

/**
 * Seed accepted_fields from comparison rows (defaults to utility-issued).
 * @param {Array<Record<string, unknown>>} comparisonRows
 * @param {Record<string, unknown>} [existingAccepted]
 */
function seedAcceptedFields(comparisonRows, existingAccepted = {}) {
  /** @type {Record<string, Record<string, unknown>>} */
  const out = {};
  for (const row of comparisonRows || []) {
    const key = String(row.field || "");
    if (!key) continue;
    const prior = existingAccepted[key];
    if (prior && typeof prior === "object" && "value" in prior) {
      out[key] = {
        value: /** @type {any} */ (prior).value,
        source:
          /** @type {any} */ (prior).source ||
          (/** @type {any} */ (prior).overridden ? "operator_accepted" : "utility_default"),
        overridden: /** @type {any} */ (prior).overridden === true,
        reason: /** @type {any} */ (prior).reason || null,
        updated_at: /** @type {any} */ (prior).updated_at || null,
        updated_by: /** @type {any} */ (prior).updated_by || null,
      };
      continue;
    }
    out[key] = {
      value: row.utility_issued ?? null,
      source: "utility_default",
      overridden: false,
      reason: null,
      updated_at: null,
      updated_by: null,
    };
  }
  return out;
}

/**
 * Enrich comparison rows with accepted layer without mutating utility_issued.
 * @param {Array<Record<string, unknown>>} comparisonRows
 * @param {Record<string, unknown>} acceptedFields
 */
function applyAcceptedToComparisonRows(comparisonRows, acceptedFields = {}) {
  return (comparisonRows || []).map((row) => {
    const key = String(row.field || "");
    const acceptedEntry = acceptedFields[key];
    const acceptedValue =
      acceptedEntry && typeof acceptedEntry === "object" && "value" in /** @type {any} */ (acceptedEntry)
        ? /** @type {any} */ (acceptedEntry).value
        : row.accepted != null
          ? row.accepted
          : row.utility_issued ?? null;
    const overridden =
      (acceptedEntry && typeof acceptedEntry === "object" && /** @type {any} */ (acceptedEntry).overridden === true) ||
      !sameAccepted(acceptedValue, row.utility_issued);
    return {
      ...row,
      // Immutable utility source — never overwrite from accepted
      utility_issued: row.utility_issued ?? null,
      accepted: acceptedValue,
      operator_override: overridden,
      override_reason:
        acceptedEntry && typeof acceptedEntry === "object"
          ? /** @type {any} */ (acceptedEntry).reason || null
          : row.override_reason || null,
    };
  });
}

/**
 * @param {string} fieldKey
 */
function isEditableCosField(fieldKey) {
  return COS_COMPARE_FIELDS.some((f) => f.key === fieldKey);
}

/**
 * @param {string} fieldKey
 */
function fieldLabel(fieldKey) {
  const def = COS_COMPARE_FIELDS.find((f) => f.key === fieldKey);
  return def ? def.label : fieldKey;
}

/**
 * @param {object} cos
 * @param {Array<{ field: string, accepted_value: unknown, reason?: string | null }>} updates
 * @param {object} params
 * @param {string} params.userId
 * @param {boolean} [params.reset]
 */
function buildAcceptedFieldUpdate(cos, updates, params) {
  const { userId, reset = false } = params;
  const now = new Date().toISOString();
  const reviewVersion = Number(cos.review_version || 1) + 1;

  /** @type {Record<string, unknown>} */
  const acceptedFields = {
    ...(cos.accepted_fields && typeof cos.accepted_fields === "object" && !Array.isArray(cos.accepted_fields)
      ? cos.accepted_fields
      : {}),
  };

  /** @type {Array<Record<string, unknown>>} */
  const priorOverrides = Array.isArray(cos.field_overrides) ? [...cos.field_overrides] : [];
  /** @type {Array<Record<string, unknown>>} */
  const newOverrides = [];

  const comparisonByField = new Map(
    (Array.isArray(cos.comparison_rows) ? cos.comparison_rows : []).map((r) => [
      String(r.field),
      r,
    ]),
  );

  for (const upd of updates) {
    const field = String(upd.field || "").trim();
    if (!field || !isEditableCosField(field)) {
      const err = new Error(`Field is not editable in Stage 6 review: ${field || "(empty)"}`);
      err.statusCode = 400;
      err.code = "COS_FIELD_NOT_EDITABLE";
      throw err;
    }

    const row = comparisonByField.get(field) || {};
    const utilityIssued = row.utility_issued ?? null;
    const submitted = row.submitted ?? null;
    const priorAcceptedEntry = acceptedFields[field];
    const previousAccepted =
      priorAcceptedEntry && typeof priorAcceptedEntry === "object" && "value" in /** @type {any} */ (priorAcceptedEntry)
        ? /** @type {any} */ (priorAcceptedEntry).value
        : row.accepted != null
          ? row.accepted
          : utilityIssued;

    const nextAccepted = reset ? utilityIssued : upd.accepted_value;
    const differsFromUtility = !sameAccepted(nextAccepted, utilityIssued);
    const reasonText = String(upd.reason || "").trim();

    if (differsFromUtility && !reasonText) {
      const err = new Error(
        `Reason/note is required when accepted value differs from utility-issued (${fieldLabel(field)})`,
      );
      err.statusCode = 400;
      err.code = "OVERRIDE_REASON_REQUIRED";
      throw err;
    }

    if (sameAccepted(nextAccepted, previousAccepted) && !reset) {
      // no-op for this field
      continue;
    }

    const evidence = resolveSourceEvidence(cos, field, row);

    acceptedFields[field] = {
      value: nextAccepted,
      source: differsFromUtility ? "operator_accepted" : "utility_default",
      overridden: differsFromUtility,
      reason: differsFromUtility ? reasonText : reset ? "Reset to utility-issued" : null,
      updated_at: now,
      updated_by: userId,
    };

    const audit = {
      field,
      label: fieldLabel(field),
      submitted_value: submitted,
      utility_issued_value: utilityIssued,
      previous_accepted_value: previousAccepted,
      accepted_value: nextAccepted,
      source_document: evidence.source_document,
      evidence_page: evidence.evidence_page,
      utility_provenance: evidence.utility_provenance,
      reason: differsFromUtility
        ? reasonText
        : reset
          ? "Reset to utility-issued"
          : reasonText || null,
      changed_by: userId,
      changed_at: now,
      review_version: reviewVersion,
      action: reset ? "reset_to_utility" : differsFromUtility ? "override" : "align_to_utility",
    };
    newOverrides.push(audit);
  }

  if (newOverrides.length === 0) {
    return {
      changed: false,
      accepted_fields: acceptedFields,
      field_overrides: priorOverrides,
      comparison_rows: applyAcceptedToComparisonRows(
        Array.isArray(cos.comparison_rows) ? cos.comparison_rows : [],
        acceptedFields,
      ),
      review_version: Number(cos.review_version || 1),
      new_overrides: [],
    };
  }

  const fieldOverrides = [...priorOverrides, ...newOverrides];
  const comparisonRows = applyAcceptedToComparisonRows(
    Array.isArray(cos.comparison_rows) ? cos.comparison_rows : [],
    acceptedFields,
  );

  return {
    changed: true,
    accepted_fields: acceptedFields,
    field_overrides: fieldOverrides,
    comparison_rows: comparisonRows,
    review_version: reviewVersion,
    new_overrides: newOverrides,
  };
}

/**
 * Compact override summary for pre-approval UI / snapshot.
 * @param {object} cos
 */
function buildOverrideSummary(cos) {
  const rows = applyAcceptedToComparisonRows(
    Array.isArray(cos?.comparison_rows) ? cos.comparison_rows : [],
    cos?.accepted_fields && typeof cos.accepted_fields === "object" ? cos.accepted_fields : {},
  );
  return rows
    .filter((r) => r.operator_override === true)
    .map((r) => ({
      field: r.field,
      label: r.label,
      submitted: r.submitted,
      utility_issued: r.utility_issued,
      accepted: r.accepted,
      reason: r.override_reason || null,
      material: r.material === true,
    }));
}

/**
 * Freeze approved reviewed snapshot — does not mutate extracted_fields.
 * @param {object} cos
 * @param {object} params
 */
function buildApprovedSnapshot(cos, params) {
  const { userId, approvedAt, notes = null, acceptMaterialDeviation = false } = params;
  const acceptedFields =
    cos.accepted_fields && typeof cos.accepted_fields === "object" && !Array.isArray(cos.accepted_fields)
      ? cos.accepted_fields
      : seedAcceptedFields(Array.isArray(cos.comparison_rows) ? cos.comparison_rows : []);
  const comparisonRows = applyAcceptedToComparisonRows(
    Array.isArray(cos.comparison_rows) ? cos.comparison_rows : [],
    acceptedFields,
  );
  const overrides = buildOverrideSummary({
    ...cos,
    accepted_fields: acceptedFields,
    comparison_rows: comparisonRows,
  });

  // Ensure every active override has a reason before freeze
  for (const o of overrides) {
    if (!String(o.reason || "").trim()) {
      const err = new Error(
        `Override for ${o.label || o.field} requires a reason before approval`,
      );
      err.statusCode = 400;
      err.code = "OVERRIDE_REASON_REQUIRED";
      throw err;
    }
  }

  return {
    snapshot_version: "stage6-approved-reviewed-snapshot-v1",
    frozen_at: approvedAt,
    frozen_by: userId,
    approval_notes: notes,
    accept_material_deviation: acceptMaterialDeviation === true,
    cos_design_record_id: cos.id,
    cos_version: Number(cos.version || 1),
    review_version: Number(cos.review_version || 1),
    evidence_status: cos.evidence_status,
    source_communication_id: cos.source_communication_id || null,
    document_refs: Array.isArray(cos.document_refs) ? cos.document_refs : [],
    // Immutable utility source preserved as-is
    extracted_fields: cos.extracted_fields || {},
    baseline_fields: cos.baseline_fields || {},
    accepted_fields: acceptedFields,
    comparison_rows: comparisonRows,
    field_overrides: Array.isArray(cos.field_overrides) ? cos.field_overrides : [],
    override_summary: overrides,
  };
}

module.exports = {
  unwrapValue,
  sameAccepted,
  resolveSourceEvidence,
  seedAcceptedFields,
  applyAcceptedToComparisonRows,
  isEditableCosField,
  fieldLabel,
  buildAcceptedFieldUpdate,
  buildOverrideSummary,
  buildApprovedSnapshot,
};
