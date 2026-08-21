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

/** Metadata retained across clean-slate resets (provider/site setup only). */
const PRESERVED_COORDINATION_METADATA_KEYS = new Set([
  "uci_provider_mapping",
  "uci_provider_resolution",
  "provider_setup",
  "uci_provider_setup",
  "uci_site_address",
  "uci_provider_reassignment_history",
]);

/** Run-scoped caches that must not survive reset (used for contamination audit). */
const RUN_SCOPED_COORDINATION_METADATA_KEYS = [
  "uci_document_processing",
  "stage2_readiness",
  "stage_5_acknowledgment",
  "stage_5_acknowledgment_history",
  "stage_5_acknowledgment_evidence",
  "uci_cos_analysis",
  "uci_meter_set",
  "closeout_artifacts",
  "uci_closeout_package",
  "uci_lifecycle_proposals",
  "uci_last_portal_sync_summary",
  "uci_last_portal_sync_at",
  "active_application_template",
  "application_package",
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

/**
 * Keep only provider/site setup metadata; drop all prior-run workflow caches.
 *
 * @param {Record<string, unknown>} metadata
 * @returns {Record<string, unknown>}
 */
function scrubCoordinationMetadataForCleanSlate(metadata) {
  const next = {};
  for (const key of PRESERVED_COORDINATION_METADATA_KEYS) {
    if (metadata[key] !== undefined) {
      next[key] = metadata[key];
    }
  }
  return next;
}

/**
 * @param {Record<string, unknown>} metadata
 * @returns {string[]}
 */
function listStaleRunMetadataKeys(metadata) {
  /** @type {string[]} */
  const stale = [];
  for (const key of Object.keys(metadata)) {
    if (key === "uci_clean_slate") continue;
    if (PRESERVED_COORDINATION_METADATA_KEYS.has(key)) continue;
    stale.push(key);
  }
  return stale;
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
  PRESERVED_COORDINATION_METADATA_KEYS,
  RUN_SCOPED_COORDINATION_METADATA_KEYS,
  readCleanSlateBoundary,
  isMessageBeforeCleanSlate,
  scrubCoordinationMetadataForCleanSlate,
  listStaleRunMetadataKeys,
  stampCleanSlateMetadata,
};
