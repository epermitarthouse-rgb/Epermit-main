"use strict";

/**
 * Merge supplemental utility COS/design evidence into an in-progress Stage 6 record.
 * Fills previously-null extracted fields only — never overwrites utility-issued values.
 */

const { valuesMatch } = require("./uci-cos-discrepancy.service.js");

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
 * @param {Record<string, unknown>} priorFields
 * @param {Record<string, unknown>} incomingFields
 */
function mergeSupplementalExtractedFields(priorFields, incomingFields) {
  const merged = { ...(priorFields || {}) };
  for (const [key, incomingEntry] of Object.entries(incomingFields || {})) {
    if (incomingEntry == null) continue;
    const incomingValue = fieldValue(incomingEntry);
    if (incomingValue == null || incomingValue === "") continue;

    const priorEntry = merged[key];
    if (priorEntry == null) {
      merged[key] = incomingEntry;
      continue;
    }

    const priorValue = fieldValue(priorEntry);
    if (priorValue == null || priorValue === "") {
      merged[key] = incomingEntry;
      continue;
    }

    // Conflicting values across communications — keep prior; caller surfaces via re-compare
    if (valuesMatch(priorValue, incomingValue) !== true) {
      merged[key] = {
        ...(typeof priorEntry === "object" && !Array.isArray(priorEntry) ? priorEntry : { value: priorValue }),
        supplemental_conflict: true,
        supplemental_candidate: incomingEntry,
      };
    }
  }
  return merged;
}

/**
 * Whether a new communication should update the current in-progress record in place.
 *
 * @param {object} params
 * @param {Record<string, unknown> | null} params.priorRecord
 * @param {Record<string, unknown> | null} params.primaryCommunication
 * @param {boolean} [params.forceNewVersion]
 */
function shouldReconcileSupplementalCosEvidence(params) {
  const { priorRecord, primaryCommunication, forceNewVersion = false } = params;
  if (forceNewVersion === true) return false;
  if (!priorRecord || !primaryCommunication?.id) return false;

  const reviewStatus = String(priorRecord.review_status || "");
  if (["approved", "superseded", "rejected"].includes(reviewStatus)) return false;

  const priorSource = priorRecord.source_communication_id
    ? String(priorRecord.source_communication_id)
    : null;
  const nextSource = String(primaryCommunication.id);
  if (priorSource && priorSource === nextSource) return false;

  return true;
}

module.exports = {
  mergeSupplementalExtractedFields,
  shouldReconcileSupplementalCosEvidence,
  fieldValue,
};
