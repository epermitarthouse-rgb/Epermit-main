"use strict";

/**
 * Shared actionable Needs Attention filter for operational snapshot, portfolio,
 * and listNeedsAttentionCommunications. Preserve records; only filter queues/counts.
 */

const { BLOCKED_REASON_CODES } = require("./uci-lifecycle-constants.js");

const LOW_CONFIDENCE_THRESHOLD = 0.75;
const OWN_PACKAGE_SUBJECT_RE = /utility\s+coordination\s+application\s+package/i;

const RECORD_REASON_LABELS = Object.freeze({
  [BLOCKED_REASON_CODES.COST_UNPAID_INVOICE]: "Utility invoice is unpaid",
  [BLOCKED_REASON_CODES.COST_VARIANCE_BLOCK_BILL]: "Cost variance is holding client billing",
  [BLOCKED_REASON_CODES.COST_QB_FAILED]: "QuickBooks invoice failed — retry or review",
  [BLOCKED_REASON_CODES.COST_CIAC_SLA]: "CIAC payment SLA is overdue",
  [BLOCKED_REASON_CODES.COST_APPROVAL_PENDING]: "Client cost approval is pending",
  [BLOCKED_REASON_CODES.EQUIPMENT_NO_RESPONSE]: "No equipment ETA response in 14 days",
  [BLOCKED_REASON_CODES.EQUIPMENT_SLIP_INCREASE]: "Equipment slip increased by more than 2 weeks",
  [BLOCKED_REASON_CODES.INSPECTION_RELEASE_MISSING]: "Inspection release has not been recorded",
  [BLOCKED_REASON_CODES.METER_SET_NO_SHOW]: "Meter-set crew no-show needs reschedule",
  [BLOCKED_REASON_CODES.METER_SET_MULTI_RESCHEDULE]: "Meter set has been rescheduled more than once",
  [BLOCKED_REASON_CODES.CLOSEOUT_MISSING_ARTIFACT]: "Closeout is missing a required artifact",
  [BLOCKED_REASON_CODES.CLOSEOUT_DATE_CONFLICT]: "Energization date conflict must be resolved",
  [BLOCKED_REASON_CODES.PROVIDER_MAPPING_BLOCKED]: "Utility provider mapping needs a human assignment",
  [BLOCKED_REASON_CODES.GEOCODING_FAILED]: "Project address could not be geocoded",
  [BLOCKED_REASON_CODES.LOAD_OVERSIZED]: "Calculated service size exceeds 800A — review required",
  [BLOCKED_REASON_CODES.EMAIL_BOUNCE]: "Utility submission email bounced",
  [BLOCKED_REASON_CODES.GRAPH_UNRECONCILED]: "Sent mail was accepted but the Graph message was not found",
  [BLOCKED_REASON_CODES.TEMPLATE_GAP]: "Utility-specific application template is missing — generic fallback in use",
});

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
  if (meta.stage_6_auto_completed === true) return true;
  if (asRecord(meta.stage_6_completion).auto_completed === true) return true;
  if (asRecord(meta.stage_6_cos).auto_completed === true) return true;
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

const SYNTHETIC_SUBJECT_PLAIN_RE = /^synthetic\s+test\b/i;
const SYNTHETIC_PACKAGE_SUBJECT_RE =
  /^\[TEST\].*utility\s+coordination\s+application\s+package/i;

/**
 * Crude / residual synthetic tests that should not inflate operator Needs Attention
 * (e.g. "Synthetic test -…" with trivial body, or [TEST] package-send echoes).
 * Presentation-only exclusion — never deletes rows.
 */
function isInertSyntheticTestArtifact(row) {
  const meta = asMeta(row);
  if (meta.no_longer_actionable === true || meta.synthetic_history === true) return true;
  if (meta.synthetic_test === true && meta.actionable === false) return true;
  const subject = String(row.raw_subject || "");
  const body = String(row.raw_body || "").trim();
  if (SYNTHETIC_PACKAGE_SUBJECT_RE.test(subject)) return true;
  if (SYNTHETIC_SUBJECT_PLAIN_RE.test(subject) && body.length < 40) return true;
  return false;
}

/** Synthetic/test rows that are history only and no longer actionable. */
function isSyntheticHistoryNotActionable(row) {
  const meta = asMeta(row);
  if (isInertSyntheticTestArtifact(row)) return true;
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
  const stage6 = asRecord(meta.stage_6_cos);
  if (stage6.auto_completed === true || meta.stage_6_auto_completed === true) return false;
  if (stage6.cos_design_record_id && (stage6.review_status === "needs_attention" || stage6.review_status === "revision_required")) {
    return true;
  }
  if (isLifecycleCommunicationAttention(row)) return true;
  return false;
}

/**
 * Actionable COS / design attention items from durable Stage 6 records.
 * @param {Record<string, unknown>} cosRow
 */
function isActionableCosDesignAttention(cosRow) {
  if (!cosRow || typeof cosRow !== "object") return false;
  if (cosRow.needs_human_attention !== true) return false;
  if (cosRow.is_current === false) return false;
  const status = String(cosRow.review_status || "");
  if (status === "approved" || status === "superseded" || status === "rejected") return false;
  return true;
}

/**
 * Record-level Needs Attention items from Stage 7–10 reason codes and open alerts.
 * @param {Record<string, unknown> | null | undefined} record
 * @param {{
 *   costs?: Array<Record<string, unknown>>,
 *   equipment?: Array<Record<string, unknown>>,
 *   milestones?: Array<Record<string, unknown>>,
 * }} [ctx]
 */
function listRecordNeedsAttention(record, ctx = {}) {
  if (!record || typeof record !== "object") return [];
  const { evaluateLifecycleGuards } = require("./uci-lifecycle-guards.service.js");
  const guards = evaluateLifecycleGuards(record, ctx);
  const stage = Number(record.current_stage);
  /** @type {string[]} */
  let codes = [];
  if (stage === 7) codes = guards.stage_7_reasons;
  else if (stage === 8) codes = guards.stage_8_reasons;
  else if (stage === 9) codes = guards.stage_9_reasons;
  else if (stage === 10) codes = guards.stage_10_reasons;

  const meta = asRecord(record.metadata);
  const alerts = Array.isArray(meta.uci_alerts) ? meta.uci_alerts : [];
  for (const alert of alerts) {
    if (alert && typeof alert === "object" && !alert.resolved_at && alert.code) {
      codes.push(String(alert.code));
    }
  }

  const unique = [...new Set(codes.filter(Boolean))];
  return unique.map((code) => ({
    kind: "record",
    coordination_record_id: record.id,
    project_id: record.project_id,
    code,
    label: RECORD_REASON_LABELS[code] || String(code).replace(/_/g, " ").toLowerCase(),
    stage,
    state: record.current_stage_state,
  }));
}

/**
 * Communication-level NA for lifecycle classifications that must not write state.
 * @param {Record<string, unknown>} row
 */
function isLifecycleCommunicationAttention(row) {
  const classification = String(row?.classification || "");
  const meta = asMeta(row);
  if (classification === "inspection_release_request") return true;
  if (meta.lifecycle_dispatch === "needs_attention") return true;
  if (meta.reason_code && RECORD_REASON_LABELS[String(meta.reason_code)]) return true;
  return false;
}

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
  BLOCKED_REASON_CODES,
  RECORD_REASON_LABELS,
  isOwnOutboundPackageEcho,
  isOutboundTransmission,
  isRejected,
  isAutoCompletedAck,
  isManuallyResolved,
  isInertSyntheticTestArtifact,
  isSyntheticHistoryNotActionable,
  isActionableNeedsAttentionCommunication,
  isActionableCosDesignAttention,
  listRecordNeedsAttention,
  isLifecycleCommunicationAttention,
};
