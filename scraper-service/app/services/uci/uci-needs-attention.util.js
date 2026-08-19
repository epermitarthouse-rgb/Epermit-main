"use strict";

/**
 * Shared actionable Needs Attention filter for operational snapshot, portfolio,
 * and listNeedsAttentionCommunications. Preserve records; only filter queues/counts.
 */

const LOW_CONFIDENCE_THRESHOLD = 0.75;
const OWN_PACKAGE_SUBJECT_RE = /utility\s+coordination\s+application\s+package/i;

function asMeta(row) {
  const meta = row?.agent_processed_metadata;
  if (meta && typeof meta === "object" && !Array.isArray(meta)) return meta;
  return {};
}

function asRecord(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return /** @type {Record<string, unknown>} */ (value);
  }
  return {};
}

function emailsEqual(a, b) {
  const left = String(a || "")
    .trim()
    .toLowerCase();
  const right = String(b || "")
    .trim()
    .toLowerCase();
  return Boolean(left && right && left === right);
}

/** Own Stage 4 package echo / outbound transmission — never operator attention. */
function isOwnOutboundPackageEcho(row) {
  const meta = asMeta(row);
  if (meta.inbound_echo != null) return true;
  if (meta.source === "stage4_live_transmit" || meta.stage5_handoff === true) {
    return String(row.direction || "").toLowerCase() === "outbound";
  }
  const subject = String(row.raw_subject || "");
  if (!OWN_PACKAGE_SUBJECT_RE.test(subject)) return false;
  if (String(row.direction || "").toLowerCase() === "outbound") return true;
  if (emailsEqual(row.sender, row.recipient)) return true;
  return false;
}

function isOutboundTransmission(row) {
  if (String(row.direction || "").toLowerCase() === "outbound") return true;
  return isOwnOutboundPackageEcho(row);
}

function isRejected(row) {
  const meta = asMeta(row);
  if (meta.rejected_irrelevant === true) return true;
  const decision = asRecord(meta.review_decision);
  return String(decision.action || "") === "reject_irrelevant";
}

function isAutoCompletedAck(row, record) {
  const meta = asMeta(row);
  if (meta.stage_5_auto_completed === true || meta.stage_5_completed === true) return true;
  if (asRecord(meta.stage_5_completion).completed === true) return true;
  if (
    String(row.classification || "") === "acknowledgment" &&
    row.needs_human_attention !== true &&
    record &&
    Number(record.current_stage) === 5 &&
    String(record.current_stage_state) === "COMPLETED" &&
    record.acknowledgment_received_at
  ) {
    return true;
  }
  return false;
}

function isManuallyResolved(row) {
  if (isRejected(row)) return true;
  if (!row.reviewed_at) return false;
  if (row.needs_human_attention === true) return false;
  const meta = asMeta(row);
  return (
    meta.human_confirmed === true ||
    meta.human_reclassified === true ||
    Boolean(asRecord(meta.review_decision).action)
  );
}

/** Synthetic/test rows that are history only and no longer actionable. */
function isSyntheticHistoryNotActionable(row) {
  const meta = asMeta(row);
  if (meta.no_longer_actionable === true || meta.synthetic_history === true) return true;
  if (meta.synthetic_test === true && meta.actionable !== true) {
    // Outbound synthetic package sends are never triage items.
    if (isOutboundTransmission(row)) return true;
  }
  const subject = String(row.raw_subject || "");
  if (/^\[TEST\]/i.test(subject) && isOutboundTransmission(row)) return true;
  return false;
}

function hasAttentionSignal(row) {
  const confidence = Number(row.classification_confidence);
  const classification = row.classification == null ? null : String(row.classification).trim();
  const meta = asMeta(row);
  if (meta.flagged_for_review === true) return true;
  if (row.needs_human_attention === true) return true;
  if (!classification || classification === "unclassified") return true;
  if (Number.isFinite(confidence) && confidence < LOW_CONFIDENCE_THRESHOLD) return true;
  const incomplete = asRecord(meta.stage_5_incomplete);
  if (incomplete.reason) return true;
  const match = asRecord(meta.match);
  if (match.matched === false) return true;
  return false;
}

/**
 * True only for actionable, unresolved operator triage items.
 * Excludes outbound transmissions, completed acks, resolved/rejected, and inert synthetic history.
 *
 * @param {Record<string, unknown>} row
 * @param {Record<string, unknown> | null | undefined} [record]
 */
function isActionableNeedsAttentionCommunication(row, record) {
  if (!row || typeof row !== "object") return false;
  if (isOutboundTransmission(row)) return false;
  if (isSyntheticHistoryNotActionable(row)) return false;
  if (isRejected(row)) return false;
  if (isAutoCompletedAck(row, record)) return false;
  if (isManuallyResolved(row) && asMeta(row).flagged_for_review !== true) return false;
  return hasAttentionSignal(row);
}

module.exports = {
  LOW_CONFIDENCE_THRESHOLD,
  isOwnOutboundPackageEcho,
  isOutboundTransmission,
  isRejected,
  isAutoCompletedAck,
  isManuallyResolved,
  isSyntheticHistoryNotActionable,
  isActionableNeedsAttentionCommunication,
};
