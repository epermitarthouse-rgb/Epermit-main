"use strict";

/**
 * Scope key for load-profile extraction when no portal application exists.
 * Portal apps use their external_application_id; other utilities use
 * coordination:<coordination_record_id>.
 */

/**
 * @param {Record<string, unknown>} record
 * @param {unknown} externalApplicationId
 * @returns {string}
 */
function resolveLoadProfileScopeKey(record, externalApplicationId) {
  const ext = String(externalApplicationId ?? "").trim();
  if (ext) return ext;
  const coordinationId = String(record?.id ?? "").trim();
  if (!coordinationId) {
    const err = new Error("coordination record id is required when external_application_id is omitted");
    err.statusCode = 400;
    err.code = "COORDINATION_SCOPE_REQUIRED";
    throw err;
  }
  return `coordination:${coordinationId}`;
}

/**
 * @param {unknown} scopeKey
 * @returns {boolean}
 */
function isCoordinationScopedScopeKey(scopeKey) {
  return String(scopeKey ?? "").startsWith("coordination:");
}

module.exports = {
  resolveLoadProfileScopeKey,
  isCoordinationScopedScopeKey,
};
