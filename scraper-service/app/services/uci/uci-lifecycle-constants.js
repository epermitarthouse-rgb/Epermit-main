"use strict";

/** PDF CET-2026-UCI-BACKEND-001 cost types — only these may be written. */
const UCI_COST_TYPES = Object.freeze([
  "CIAC",
  "application_fee",
  "design_review",
  "meter",
  "recording",
  "courier",
]);

const COST_TYPE_ALIASES = Object.freeze({
  ciac: "CIAC",
  ciac_estimate: "CIAC",
  "ciac estimate": "CIAC",
  contribution_in_aid: "CIAC",
});

const CLIENT_APPROVAL_STATUSES = Object.freeze(["pending", "approved", "rejected"]);

const QB_SYNC_STATUSES = Object.freeze([
  "not_ready",
  "ready",
  "pending",
  "succeeded",
  "retry",
  "failed",
  "uncertain",
]);

const BLOCKED_REASON_CODES = Object.freeze({
  COST_UNPAID_INVOICE: "COST_UNPAID_INVOICE",
  COST_VARIANCE_BLOCK_BILL: "COST_VARIANCE_BLOCK_BILL",
  COST_QB_FAILED: "COST_QB_FAILED",
  COST_CIAC_SLA: "COST_CIAC_SLA",
  COST_APPROVAL_PENDING: "COST_APPROVAL_PENDING",
  EQUIPMENT_NO_RESPONSE: "EQUIPMENT_NO_RESPONSE",
  EQUIPMENT_SLIP_INCREASE: "EQUIPMENT_SLIP_INCREASE",
  INSPECTION_RELEASE_MISSING: "INSPECTION_RELEASE_MISSING",
  METER_SET_NO_SHOW: "METER_SET_NO_SHOW",
  METER_SET_MULTI_RESCHEDULE: "METER_SET_MULTI_RESCHEDULE",
  PROVIDER_MAPPING_BLOCKED: "PROVIDER_MAPPING_BLOCKED",
  GEOCODING_FAILED: "GEOCODING_FAILED",
  LOAD_OVERSIZED: "LOAD_OVERSIZED",
  EMAIL_BOUNCE: "EMAIL_BOUNCE",
  GRAPH_UNRECONCILED: "GRAPH_UNRECONCILED",
  TEMPLATE_GAP: "TEMPLATE_GAP",
});

const UCI_LIFECYCLE_EVENTS = Object.freeze({
  COST_ESTIMATED: "uci.cost.estimated",
  COST_ACTUAL_RECEIVED: "uci.cost.actual_received",
  COST_VARIANCE_FLAGGED: "uci.cost.variance_flagged",
  COST_APPROVED: "uci.cost.approved",
  COST_PAID: "uci.cost.paid",
  COST_BILLED: "uci.cost.billed",
  EQUIPMENT_CHECKIN_SENT: "uci.equipment.checkin_sent",
  EQUIPMENT_ETA_UPDATED: "uci.equipment.eta_updated",
  EQUIPMENT_SLIP_INCREASED: "uci.equipment.slip_increased",
  INSPECTION_RELEASE_RECORDED: "uci.inspection_release.recorded",
  METER_SET_REQUESTED: "uci.meter_set.requested",
  METER_SET_SCHEDULED: "uci.meter_set.scheduled",
  METER_SET_CHECKLIST_SENT: "uci.meter_set.checklist_sent",
  METER_SET_NO_SHOW: "uci.meter_set.no_show",
  ENERGIZATION_CAPTURED: "uci.energization.captured",
  CLOSEOUT_BLOCKED: "uci.closeout.blocked",
  CLOSEOUT_ARCHIVED: "uci.closeout.archived",
  PROJECT_UCI_COMPLETE: "uci.project.utility_coordination_completed",
  PREDICTION_RECOMPUTED: "uci.prediction.recomputed",
  PREDICTION_P50_SLIP: "uci.prediction.p50_slip",
});

const EMAIL_TEMPLATES = Object.freeze({
  EQUIPMENT_ETA_CHECKIN: "uci.equipment_eta_checkin.v1",
  METER_SET_REQUEST: "uci.meter_set_request.v1",
  METER_SET_48H_CHECKLIST: "uci.meter_set_48h_checklist.v1",
});

const VARIANCE_REVIEW_PCT = 5;
const VARIANCE_P2_PCT = 15;
const VARIANCE_ESCALATE_PCT = 20;
const CIAC_SLA_BUSINESS_DAYS = 14;
const EQUIPMENT_CHECKIN_CADENCE_DAYS = 7;
const EQUIPMENT_NO_RESPONSE_DAYS = 14;
const EQUIPMENT_SLIP_INCREASE_WEEKS = 2;
const P50_SLIP_ALERT_DAYS = 7;
const P90_MULTIPLIER = 1.4;
const LOW_CONFIDENCE_THRESHOLD = 0.75;

const FALLBACK_BASELINE_DAYS = Object.freeze({
  1: 180,
  2: 160,
  3: 140,
  4: 120,
  5: 100,
  6: 80,
  7: 55,
  8: 40,
  9: 18,
  10: 5,
});

/**
 * @param {unknown} raw
 * @returns {string | null}
 */
function normalizeCostType(raw) {
  if (raw == null) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;
  const alias = COST_TYPE_ALIASES[trimmed.toLowerCase()];
  if (alias) return alias;
  if (UCI_COST_TYPES.includes(trimmed)) return trimmed;
  return null;
}

/**
 * @param {unknown} raw
 * @returns {boolean}
 */
function isAllowedCostType(raw) {
  return normalizeCostType(raw) != null;
}

module.exports = {
  UCI_COST_TYPES,
  COST_TYPE_ALIASES,
  CLIENT_APPROVAL_STATUSES,
  QB_SYNC_STATUSES,
  BLOCKED_REASON_CODES,
  UCI_LIFECYCLE_EVENTS,
  EMAIL_TEMPLATES,
  VARIANCE_REVIEW_PCT,
  VARIANCE_P2_PCT,
  VARIANCE_ESCALATE_PCT,
  CIAC_SLA_BUSINESS_DAYS,
  EQUIPMENT_CHECKIN_CADENCE_DAYS,
  EQUIPMENT_NO_RESPONSE_DAYS,
  EQUIPMENT_SLIP_INCREASE_WEEKS,
  P50_SLIP_ALERT_DAYS,
  P90_MULTIPLIER,
  FALLBACK_BASELINE_DAYS,
  LOW_CONFIDENCE_THRESHOLD,
  normalizeCostType,
  isAllowedCostType,
};
