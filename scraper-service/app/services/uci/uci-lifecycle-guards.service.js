"use strict";

/**
 * Stage 7–10 entry / completion predicates.
 * canEnterStage7 is preserved from Stage 6 (do not tighten 1–6).
 */

const { BLOCKED_REASON_CODES } = require("./uci-lifecycle-constants.js");

/**
 * Stage 7 eligibility — Stage 6 COMPLETED + utility-issued COS evidence date.
 * Same predicate as uci-stage6-entry.service.js (kept there; do not tighten 1–6).
 *
 * @param {Record<string, unknown> | null | undefined} record
 */
function canEnterStage7(record) {
  if (!record) return false;
  return (
    Number(record.current_stage) === 6 &&
    String(record.current_stage_state) === "COMPLETED" &&
    Boolean(record.class_of_service_issued_at)
  );
}

function asRecord(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return /** @type {Record<string, unknown>} */ (value);
  }
  return {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function isCompleted(record) {
  return String(record?.current_stage_state || "") === "COMPLETED";
}

function stageOf(record) {
  return Number(record?.current_stage);
}

function knownCosts(costs) {
  return asArray(costs).filter((c) => c && c.id);
}

function isCostSettled(cost) {
  const actual = num(cost.actual_amount);
  return (
    actual != null &&
    String(cost.client_approval_status || "") === "approved" &&
    Boolean(cost.paid_at) &&
    Boolean(cost.quickbooks_invoice_id) &&
    Boolean(cost.client_billed_at)
  );
}

function costHasOpenBillingHold(cost) {
  return cost.billing_hold === true && !cost.human_override_bill_at && !cost.client_billed_at;
}

/**
 * ≥1 known cost; each has actual, approved, paid_at, and QB invoice + client_billed_at.
 * billing_hold without later bill keeps the stage OPEN.
 *
 * @param {Record<string, unknown>} record
 * @param {Array<Record<string, unknown>>} [costs]
 */
function canCompleteStage7(record, costs = []) {
  void record;
  const rows = knownCosts(costs);
  if (rows.length < 1) return false;
  if (rows.some((c) => costHasOpenBillingHold(c))) return false;
  return rows.every((c) => isCostSettled(c));
}

/**
 * @param {Record<string, unknown>} record
 * @param {Array<Record<string, unknown>>} [costs]
 */
function canEnterStage8(record, costs = []) {
  return stageOf(record) === 7 && isCompleted(record) && canCompleteStage7(record, costs);
}

function isInScopeEquipment(item) {
  if (!item || item.out_of_scope === true) return false;
  const status = String(item.status || "");
  return status !== "cancelled" && status !== "not_required";
}

/**
 * Every in-scope item has current_eta AND
 * status IN (on_order, shipped, delivered) OR (pending AND current_eta AND last_check_in_at).
 * Does NOT require installed.
 *
 * @param {Record<string, unknown>} record
 * @param {Array<Record<string, unknown>>} [equipment]
 */
function canCompleteStage8(record, equipment = []) {
  void record;
  const items = asArray(equipment).filter(isInScopeEquipment);
  if (items.length < 1) return false;
  return items.every((item) => {
    const status = String(item.status || "");
    if (status === "installed" || status === "received") return true;
    if (!item.current_eta) return false;
    if (status === "on_order" || status === "shipped" || status === "delivered") return true;
    if (status === "pending" && item.current_eta && item.last_check_in_at) return true;
    return false;
  });
}

/**
 * @param {Record<string, unknown>} record
 * @param {Array<Record<string, unknown>>} [equipment]
 */
function canEnterStage9(record, equipment = []) {
  return stageOf(record) === 8 && isCompleted(record) && canCompleteStage8(record, equipment);
}

function hasMeterSetMilestone(milestones) {
  return asArray(milestones).some((m) => {
    const type = String(m.milestone_type || "");
    const status = String(m.status || "");
    return type === "meter_set" && (status === "scheduled" || status === "completed");
  });
}

/**
 * Agent 11 NEVER auto-sets COMPLETED. Human/system complete only when this is true.
 *
 * @param {Record<string, unknown>} record
 * @param {Array<Record<string, unknown>>} [milestones]
 */
function canCompleteStage9(record, milestones = []) {
  return Boolean(
    record?.inspection_release_received_at &&
      record?.meter_set_scheduled_at &&
      record?.site_readiness_confirmed_at &&
      hasMeterSetMilestone(milestones),
  );
}

/**
 * Entering 9 without inspection release is allowed (BLOCKED).
 * Choreography must not start until release is set.
 *
 * @param {Record<string, unknown>} record
 * @param {Array<Record<string, unknown>>} [milestones]
 */
function canEnterStage10(record, milestones = []) {
  return stageOf(record) === 9 && isCompleted(record) && canCompleteStage9(record, milestones);
}

function closeoutArtifacts(record) {
  const meta = asRecord(record?.metadata);
  const artifacts = asRecord(meta.closeout_artifacts);
  return artifacts;
}

function hasUtilityConfirmationEvidence(record) {
  const artifacts = closeoutArtifacts(record);
  return Boolean(
    artifacts.utility_confirmation ||
      artifacts.utility_confirmation_doc_id ||
      metaFlag(record, "utility_energization_confirmed"),
  );
}

function hasFinalMeterReading(record) {
  const artifacts = closeoutArtifacts(record);
  return Boolean(artifacts.final_meter_reading || artifacts.final_meter_reading_doc_id);
}

function hasCommissioningSignOff(record) {
  const artifacts = closeoutArtifacts(record);
  return Boolean(artifacts.commissioning_signoff || artifacts.commissioning_signoff_doc_id);
}

function metaFlag(record, key) {
  const meta = asRecord(record?.metadata);
  const closeout = asRecord(meta.uci_closeout_package);
  const checklist = asArray(closeout.checklist);
  return checklist.some((item) => asRecord(item).key === key && asRecord(item).completed === true);
}

function knownCostsHavePaidReceipts(costs) {
  const rows = knownCosts(costs);
  if (rows.length < 1) return false;
  return rows.every(
    (c) =>
      Boolean(c.paid_at) &&
      (Boolean(c.invoice_received_doc_ref) || Boolean(c.paid_receipt_doc_ref) || Boolean(c.payment_method)),
  );
}

/**
 * @param {Record<string, unknown>} record
 * @param {Array<Record<string, unknown>>} [costs]
 */
function canCompleteStage10(record, costs = []) {
  if (!record?.energization_actual_date) return false;
  if (record.energization_date_conflict === true) return false;
  if (!hasUtilityConfirmationEvidence(record)) return false;
  if (!hasFinalMeterReading(record)) return false;
  if (!hasCommissioningSignOff(record)) return false;
  if (!record.closeout_package_doc_id) return false;
  if (!knownCostsHavePaidReceipts(costs)) return false;
  return true;
}

/**
 * @param {Array<Record<string, unknown>>} records
 */
function isProjectUtilityCoordinationComplete(records) {
  const rows = asArray(records);
  if (rows.length < 1) return false;
  return rows.every((r) => stageOf(r) === 10 && isCompleted(r));
}

/**
 * Stage 7–10 skip / complete guards. Do not apply to Stages 1–6.
 *
 * @param {Record<string, unknown>} current
 * @param {number} toStage
 * @param {string} toState
 * @param {{
 *   costs?: Array<Record<string, unknown>>,
 *   equipment?: Array<Record<string, unknown>>,
 *   milestones?: Array<Record<string, unknown>>,
 * }} [ctx]
 */
function assertStage7to10Transition(current, toStage, toState, ctx = {}) {
  const fromStage = stageOf(current);
  const target = Number(toStage);
  const state = String(toState || "");

  if (!Number.isInteger(target) || target < 7) return;

  if (target > fromStage + 1) {
    const err = new Error(`Cannot skip from Stage ${fromStage} to Stage ${target}`);
    err.statusCode = 409;
    err.code = "STAGE_SKIP_BLOCKED";
    throw err;
  }

  if (target === 7 && fromStage < 7 && !canEnterStage7(current)) {
    const err = new Error(
      "Stage 7 requires Stage 6 COMPLETED with class_of_service_issued_at",
    );
    err.statusCode = 409;
    err.code = "STAGE_7_NOT_ELIGIBLE";
    throw err;
  }

  if (target === 8 && fromStage < 8 && !canEnterStage8(current, ctx.costs)) {
    const err = new Error("Stage 8 requires Stage 7 COMPLETED with settled costs");
    err.statusCode = 409;
    err.code = "STAGE_8_NOT_ELIGIBLE";
    throw err;
  }

  if (target === 9 && fromStage < 9 && !canEnterStage9(current, ctx.equipment)) {
    const err = new Error("Stage 9 requires Stage 8 COMPLETED with tracked equipment ETAs");
    err.statusCode = 409;
    err.code = "STAGE_9_NOT_ELIGIBLE";
    throw err;
  }

  if (target === 10 && fromStage < 10 && !canEnterStage10(current, ctx.milestones)) {
    const err = new Error("Stage 10 requires Stage 9 COMPLETED with meter-set predicates");
    err.statusCode = 409;
    err.code = "STAGE_10_NOT_ELIGIBLE";
    throw err;
  }

  if (state === "COMPLETED") {
    if (target === 7 && !canCompleteStage7(current, ctx.costs)) {
      const err = new Error(
        "Stage 7 cannot complete until every known cost is approved, paid, and billed",
      );
      err.statusCode = 409;
      err.code = "STAGE_7_INCOMPLETE";
      throw err;
    }
    if (target === 8 && !canCompleteStage8(current, ctx.equipment)) {
      const err = new Error(
        "Stage 8 cannot complete until every in-scope item has a current ETA and procurement status",
      );
      err.statusCode = 409;
      err.code = "STAGE_8_INCOMPLETE";
      throw err;
    }
    if (target === 9 && !canCompleteStage9(current, ctx.milestones)) {
      const err = new Error(
        "Stage 9 cannot complete without inspection release, scheduled meter set, and site readiness",
      );
      err.statusCode = 409;
      err.code = "STAGE_9_INCOMPLETE";
      throw err;
    }
    if (target === 10 && !canCompleteStage10(current, ctx.costs)) {
      const err = new Error(
        "Stage 10 cannot complete without energization date, three closeout artifacts, archived PDF, and paid receipts",
      );
      err.statusCode = 409;
      err.code = "STAGE_10_INCOMPLETE";
      throw err;
    }
  }
}

/**
 * Entering Stage 9 without inspection release is allowed but BLOCKED.
 *
 * @param {Record<string, unknown>} record
 * @param {number} toStage
 * @param {string} requestedState
 */
function resolveEntryState(record, toStage, requestedState) {
  if (Number(toStage) === 9 && !record.inspection_release_received_at) {
    if (requestedState === "COMPLETED") return requestedState;
    return "BLOCKED";
  }
  return requestedState;
}

function stage7BlockReasons(costs = []) {
  const rows = knownCosts(costs);
  /** @type {string[]} */
  const reasons = [];
  if (rows.length < 1) reasons.push(BLOCKED_REASON_CODES.COST_APPROVAL_PENDING);
  for (const cost of rows) {
    if (costHasOpenBillingHold(cost)) reasons.push(BLOCKED_REASON_CODES.COST_VARIANCE_BLOCK_BILL);
    if (!cost.paid_at) reasons.push(BLOCKED_REASON_CODES.COST_UNPAID_INVOICE);
    const qbStatus = String(cost.qb_sync_status || "");
    if (
      cost.paid_at &&
      !cost.quickbooks_invoice_id &&
      ["retry", "failed", "uncertain"].includes(qbStatus)
    ) {
      reasons.push(BLOCKED_REASON_CODES.COST_QB_FAILED);
    }
    if (String(cost.client_approval_status || "") !== "approved") {
      reasons.push(BLOCKED_REASON_CODES.COST_APPROVAL_PENDING);
    }
  }
  return [...new Set(reasons)];
}

function stage8BlockReasons(equipment = []) {
  const items = asArray(equipment).filter(isInScopeEquipment);
  /** @type {string[]} */
  const reasons = [];
  if (items.length < 1) return reasons;
  for (const item of items) {
    if (!item.last_response_at && item.last_check_in_at) {
      const last = new Date(String(item.last_check_in_at)).getTime();
      if (Number.isFinite(last) && Date.now() - last > 14 * 86400000) {
        reasons.push(BLOCKED_REASON_CODES.EQUIPMENT_NO_RESPONSE);
      }
    }
    const lastSlip = num(item.last_weeks_of_slip);
    const slip = num(item.weeks_of_slip);
    if (lastSlip != null && slip != null && slip - lastSlip > 2) {
      reasons.push(BLOCKED_REASON_CODES.EQUIPMENT_SLIP_INCREASE);
    }
  }
  return [...new Set(reasons)];
}

function stage9BlockReasons(record, milestones = []) {
  /** @type {string[]} */
  const reasons = [];
  if (!record?.inspection_release_received_at) {
    reasons.push(BLOCKED_REASON_CODES.INSPECTION_RELEASE_MISSING);
  }
  const meta = asRecord(record?.metadata);
  const meter = asRecord(meta.uci_meter_set);
  if (meter.no_show === true) reasons.push(BLOCKED_REASON_CODES.METER_SET_NO_SHOW);
  if (Number(meter.reschedule_count || 0) >= 2) {
    reasons.push(BLOCKED_REASON_CODES.METER_SET_MULTI_RESCHEDULE);
  }
  void milestones;
  return reasons;
}

function stage10BlockReasons(record, costs = []) {
  /** @type {string[]} */
  const reasons = [];
  if (record?.energization_date_conflict === true) {
    reasons.push(BLOCKED_REASON_CODES.CLOSEOUT_DATE_CONFLICT);
  }
  if (
    !hasUtilityConfirmationEvidence(record) ||
    !hasFinalMeterReading(record) ||
    !hasCommissioningSignOff(record) ||
    !record?.closeout_package_doc_id
  ) {
    reasons.push(BLOCKED_REASON_CODES.CLOSEOUT_MISSING_ARTIFACT);
  }
  void costs;
  return [...new Set(reasons)];
}

function evaluateLifecycleGuards(record, ctx = {}) {
  const costs = ctx.costs || [];
  const equipment = ctx.equipment || [];
  const milestones = ctx.milestones || [];
  return {
    can_enter_stage_7: canEnterStage7(record),
    can_complete_stage_7: canCompleteStage7(record, costs),
    can_enter_stage_8: canEnterStage8(record, costs),
    can_complete_stage_8: canCompleteStage8(record, equipment),
    can_enter_stage_9: canEnterStage9(record, equipment),
    can_complete_stage_9: canCompleteStage9(record, milestones),
    can_enter_stage_10: canEnterStage10(record, milestones),
    can_complete_stage_10: canCompleteStage10(record, costs),
    stage_7_reasons: stage7BlockReasons(costs),
    stage_8_reasons: stage8BlockReasons(equipment),
    stage_9_reasons: stage9BlockReasons(record, milestones),
    stage_10_reasons: stage10BlockReasons(record, costs),
    inspection_release_received: Boolean(record?.inspection_release_received_at),
    choreography_may_start:
      stageOf(record) === 9 && Boolean(record?.inspection_release_received_at),
  };
}

module.exports = {
  canEnterStage7,
  canEnterStage8,
  canEnterStage9,
  canEnterStage10,
  canCompleteStage7,
  canCompleteStage8,
  canCompleteStage9,
  canCompleteStage10,
  isProjectUtilityCoordinationComplete,
  assertStage7to10Transition,
  resolveEntryState,
  evaluateLifecycleGuards,
  stage7BlockReasons,
  stage8BlockReasons,
  stage9BlockReasons,
  stage10BlockReasons,
  isCostSettled,
  knownCostsHavePaidReceipts,
  hasUtilityConfirmationEvidence,
  hasFinalMeterReading,
  hasCommissioningSignOff,
};
