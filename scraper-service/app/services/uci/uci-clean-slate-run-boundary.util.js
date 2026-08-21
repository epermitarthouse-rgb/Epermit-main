"use strict";

const CLEAN_SLATE_META_KEY = "uci_clean_slate";

/**
 * @param {Record<string, unknown> | null | undefined} metadata
 * @returns {{ run_id: string, at: string } | null}
 */
function readCleanSlateBoundary(metadata) {
  const meta =
    metadata && typeof metadata === "object" && !Array.isArray(metadata)
      ? /** @type {Record<string, unknown>} */ (metadata)
      : {};
  const block =
    meta[CLEAN_SLATE_META_KEY] &&
    typeof meta[CLEAN_SLATE_META_KEY] === "object" &&
    !Array.isArray(meta[CLEAN_SLATE_META_KEY])
      ? /** @type {Record<string, unknown>} */ (meta[CLEAN_SLATE_META_KEY])
      : null;
  if (!block) return null;
  const runId = block.run_id != null ? String(block.run_id).trim() : "";
  const at = block.at != null ? String(block.at).trim() : "";
  if (!runId || !at) return null;
  return { run_id: runId, at };
}

/**
 * @param {Record<string, unknown> | null | undefined} metadata
 * @param {string | null | undefined} messageTimestamp
 * @returns {boolean}
 */
function isMessageBeforeCleanSlate(metadata, messageTimestamp) {
  const boundary = readCleanSlateBoundary(metadata);
  if (!boundary) return false;
  const msgMs = messageTimestamp ? new Date(String(messageTimestamp)).getTime() : NaN;
  const boundaryMs = new Date(boundary.at).getTime();
  if (!Number.isFinite(msgMs) || !Number.isFinite(boundaryMs)) return false;
  return msgMs < boundaryMs;
}

/**
 * Strip workflow keys that would let stale inbound mail match a fresh run.
 *
 * @param {Record<string, unknown>} metadata
 * @returns {Record<string, unknown>}
 */
function scrubCoordinationMetadataForCleanSlate(metadata) {
  const next = { ...metadata };
  const keysToRemove = [
    "lc_number",
    "load_control_number",
    "LC",
    "job_id",
    "utility_ticket_number",
    "external_application_id",
    "dom_demo_ref",
    "ack_reconciled_at",
    "stage5_reconciled_at",
    "package_review_reset_at",
    "uci_legacy_type_scope_duplicate",
    "original_scope_description",
  ];
  for (const key of keysToRemove) {
    delete next[key];
  }
  if (next.application_package && typeof next.application_package === "object") {
    delete next.application_package;
  }
  return next;
}

/**
 * @param {Record<string, unknown>} metadata
 * @param {{ runId: string, at: string, reason?: string, priorRunId?: string | null }} params
 */
function stampCleanSlateMetadata(metadata, params) {
  const scrubbed = scrubCoordinationMetadataForCleanSlate(metadata);
  return {
    ...scrubbed,
    [CLEAN_SLATE_META_KEY]: {
      run_id: params.runId,
      at: params.at,
      reason: params.reason || "operator_clean_slate_reset",
      prior_run_id: params.priorRunId || null,
    },
  };
}

module.exports = {
  CLEAN_SLATE_META_KEY,
  readCleanSlateBoundary,
  isMessageBeforeCleanSlate,
  scrubCoordinationMetadataForCleanSlate,
  stampCleanSlateMetadata,
};
