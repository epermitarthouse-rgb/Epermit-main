"use strict";

/**
 * Agent 8 — CIAC / cost tracker.
 * Fires on cost insert OR actual_amount update.
 */

const { emitUciEvent } = require("./uci-events.service.js");
const { recordSystemTransition } = require("./uci-transitions.service.js");
const { canEnterStage7, canCompleteStage7 } = require("./uci-lifecycle-guards.service.js");
const { maybeEnterStage8 } = require("./uci-equipment-tracker.service.js");
const { raiseUciAlert } = require("./uci-alerts.service.js");
const {
  createUciPassthroughInvoice,
  retryUciPassthroughInvoice,
} = require("./uci-qb-passthrough.service.js");
const { resolveUciAlert } = require("./uci-alerts.service.js");
const { addBusinessDays } = require("./uci-ack-sla.service.js");
const {
  VARIANCE_REVIEW_PCT,
  VARIANCE_P2_PCT,
  VARIANCE_ESCALATE_PCT,
  CIAC_SLA_BUSINESS_DAYS,
  BLOCKED_REASON_CODES,
  UCI_LIFECYCLE_EVENTS,
} = require("./uci-lifecycle-constants.js");

function variancePct(estimated, actual) {
  const est = Number(estimated);
  const act = Number(actual);
  if (!Number.isFinite(est) || est === 0 || !Number.isFinite(act)) return null;
  return Number((((act - est) / est) * 100).toFixed(3));
}

function varianceGates(pct) {
  if (pct == null) {
    return { review: false, p2: false, escalate: false, billing_hold: false };
  }
  const escalate = pct > VARIANCE_ESCALATE_PCT;
  const p2 = pct > VARIANCE_P2_PCT;
  const review = pct > VARIANCE_REVIEW_PCT;
  return {
    review,
    p2,
    escalate,
    billing_hold: escalate,
  };
}

async function loadRecord(supabase, coordinationRecordId) {
  const { data } = await supabase
    .from("coordination_records")
    .select("*")
    .eq("id", coordinationRecordId)
    .maybeSingle();
  return data || null;
}

async function listCosts(supabase, coordinationRecordId, projectId) {
  const { data } = await supabase
    .from("coordination_costs")
    .select("*")
    .eq("coordination_record_id", coordinationRecordId)
    .eq("project_id", projectId);
  return Array.isArray(data) ? data : [];
}

async function maybeEnterStage7OnEstimate(supabase, record, cost) {
  if (!record) return { entered: false };
  if (Number(record.current_stage) > 7) return { entered: false, reason: "already_past_stage_7" };
  if (Number(record.current_stage) === 7) {
    if (String(record.current_stage_state) === "NOT_STARTED") {
      return recordSystemTransition(supabase, {
        coordinationRecordId: String(record.id),
        toStage: 7,
        toState: "IN_PROGRESS",
        reason: "Cost estimate received",
        metadata: { agent: "agent_8_cost_tracker", cost_id: cost.id },
      });
    }
    return { entered: false, reason: "already_in_stage_7" };
  }
  if (!canEnterStage7(record)) return { entered: false, reason: "stage_7_not_eligible" };
  return recordSystemTransition(supabase, {
    coordinationRecordId: String(record.id),
    toStage: 7,
    toState: "IN_PROGRESS",
    reason: "First cost estimate — Stage 7 CIAC in progress",
    metadata: { agent: "agent_8_cost_tracker", cost_id: cost.id },
  });
}

async function applyVarianceAndApproval(supabase, params) {
  const { cost, previous = null, record } = params;
  const priorActual = previous?.actual_amount;
  const actualChanged =
    cost.actual_amount != null && String(cost.actual_amount) !== String(priorActual ?? "");
  const pct = variancePct(cost.estimated_amount, cost.actual_amount);
  const gates = varianceGates(pct);

  /** @type {Record<string, unknown>} */
  const patch = {};
  if (pct != null) patch.variance_pct = pct;

  if (actualChanged) {
    emitUciEvent(
      UCI_LIFECYCLE_EVENTS.COST_ACTUAL_RECEIVED,
      {
        coordination_record_id: cost.coordination_record_id,
        project_id: cost.project_id,
        cost_id: cost.id,
        actual_amount: cost.actual_amount,
        variance_pct: pct,
      },
      { supabase },
    );
  }

  if (gates.review || gates.p2 || gates.escalate) {
    emitUciEvent(
      UCI_LIFECYCLE_EVENTS.COST_VARIANCE_FLAGGED,
      {
        coordination_record_id: cost.coordination_record_id,
        project_id: cost.project_id,
        cost_id: cost.id,
        variance_pct: pct,
        review: gates.review,
        p2: gates.p2,
        escalate: gates.escalate,
      },
      { supabase },
    );
  }

  if (gates.escalate) {
    patch.billing_hold = true;
    if (record) {
      await raiseUciAlert(supabase, {
        record,
        severity: "P1",
        code: BLOCKED_REASON_CODES.COST_VARIANCE_BLOCK_BILL,
        message: `Variance ${pct}% exceeds 20% — do not auto-bill until override`,
        details: { cost_id: cost.id, variance_pct: pct },
      });
      if (Number(record.current_stage) === 7) {
        await recordSystemTransition(supabase, {
          coordinationRecordId: String(record.id),
          toStage: 7,
          toState: "ESCALATED",
          reason: `Cost variance ${pct}% — billing held`,
          metadata: { cost_id: cost.id, variance_pct: pct },
        }).catch(() => null);
      }
    }
  } else if (gates.p2 && record) {
    await raiseUciAlert(supabase, {
      record,
      severity: "P2",
      code: BLOCKED_REASON_CODES.COST_VARIANCE_BLOCK_BILL,
      message: `Variance ${pct}% exceeds 15% — review required`,
      details: { cost_id: cost.id, variance_pct: pct },
    });
  }

  if (Object.keys(patch).length) {
    const { data } = await supabase
      .from("coordination_costs")
      .update(patch)
      .eq("id", cost.id)
      .select("*")
      .single();
    return { cost: data || { ...cost, ...patch }, gates, variance_pct: pct };
  }
  return { cost, gates, variance_pct: pct };
}

/**
 * Called after every cost insert or actual_amount update.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} params
 */
async function handleCostLifecycleEvent(supabase, params) {
  const { cost, previous = null, created = false, deps = {} } = params;
  const record = await loadRecord(supabase, String(cost.coordination_record_id));

  if (created || (cost.estimated_amount != null && previous == null)) {
    emitUciEvent(
      UCI_LIFECYCLE_EVENTS.COST_ESTIMATED,
      {
        coordination_record_id: cost.coordination_record_id,
        project_id: cost.project_id,
        cost_id: cost.id,
        estimated_amount: cost.estimated_amount,
        cost_type: cost.cost_type,
      },
      { supabase },
    );
    await maybeEnterStage7OnEstimate(supabase, record, cost);
    if (record) {
      await raiseUciAlert(supabase, {
        record,
        severity: "P2",
        code: BLOCKED_REASON_CODES.COST_APPROVAL_PENDING,
        message: "Zero-markup client approval is pending for this cost",
        details: { cost_id: cost.id },
      });
    }
  }

  const variance = await applyVarianceAndApproval(supabase, { cost, previous, record });
  let nextCost = variance.cost;

  if (nextCost.paid_at && !nextCost.quickbooks_invoice_id && !variance.gates.billing_hold) {
    const billed = await createUciPassthroughInvoice(supabase, {
      cost: nextCost,
      createInvoiceFn: deps.createInvoiceFn,
      queryFn: deps.queryFn,
      getValidConnectionFn: deps.getValidConnectionFn,
      getOrCreateCustomerFn: deps.getOrCreateCustomerFn,
      qbCustomerId: deps.qbCustomerId,
      qbItemId: deps.qbItemId,
    });
    if (billed.cost) nextCost = billed.cost;
    if ((billed.reason === "failed" || billed.reason === "uncertain") && record) {
      const errCode = billed.error_code ? `[${billed.error_code}] ` : "";
      await raiseUciAlert(supabase, {
        record,
        severity: billed.retryable === false ? "P1" : "P2",
        code: BLOCKED_REASON_CODES.COST_QB_FAILED,
        message: `${errCode}${billed.error || "QuickBooks invoice failed"}`.slice(0, 500),
        details: {
          cost_id: nextCost.id,
          qb_sync_status: billed.billing?.qb_sync_status || nextCost.qb_sync_status,
          retryable: billed.retryable !== false,
        },
      });
    }
  } else if (nextCost.paid_at && variance.gates.billing_hold && !nextCost.human_override_bill_at) {
    await supabase
      .from("coordination_costs")
      .update({ qb_sync_status: "not_ready", billing_hold: true })
      .eq("id", nextCost.id);
  }

  const autoStage7 = record
    ? await maybeTryAutoCompleteStage7(supabase, String(cost.coordination_record_id)).catch(() => null)
    : null;

  return { cost: nextCost, variance: variance.gates, record, stage_7: autoStage7 };
}

/**
 * Human client approval (zero markup).
 */
async function approveCoordinationCost(supabase, params) {
  const { costId, userId, status = "approved" } = params;
  const { data: cost } = await supabase.from("coordination_costs").select("*").eq("id", costId).maybeSingle();
  if (!cost) {
    const err = new Error("Cost not found");
    err.statusCode = 404;
    err.code = "NOT_FOUND";
    throw err;
  }
  const allowed = status === "approved" || status === "rejected" ? status : "approved";
  const { data: updated, error } = await supabase
    .from("coordination_costs")
    .update({
      client_approval_status: allowed,
      client_approved_at: new Date().toISOString(),
      client_approved_by: userId || null,
    })
    .eq("id", costId)
    .select("*")
    .single();
  if (error) {
    throw Object.assign(new Error(error.message || "Failed to approve cost"), {
      statusCode: 500,
      code: "COST_APPROVE_FAILED",
    });
  }
  emitUciEvent(
    UCI_LIFECYCLE_EVENTS.COST_APPROVED,
    {
      coordination_record_id: updated.coordination_record_id,
      project_id: updated.project_id,
      cost_id: updated.id,
      status: allowed,
    },
    { supabase },
  );

  const record = await loadRecord(supabase, String(updated.coordination_record_id));
  if (record && allowed === "approved") {
    await resolveUciAlert(supabase, {
      record,
      code: BLOCKED_REASON_CODES.COST_APPROVAL_PENDING,
    }).catch(() => null);
  }

  if (
    allowed === "approved" &&
    updated.paid_at &&
    !updated.quickbooks_invoice_id &&
    !updated.billing_hold
  ) {
    const lifecycle = await handleCostLifecycleEvent(supabase, {
      cost: updated,
      previous: cost,
      created: false,
    });
    return { cost: lifecycle.cost || updated };
  }

  return { cost: updated };
}

/**
 * Persist paid_at / payment_method FIRST, then create QB invoice.
 */
async function recordCostPayment(supabase, params) {
  const { costId, paidAt, paymentMethod, deps = {} } = params;
  const { data: existing } = await supabase.from("coordination_costs").select("*").eq("id", costId).maybeSingle();
  if (!existing) {
    const err = new Error("Cost not found");
    err.statusCode = 404;
    err.code = "NOT_FOUND";
    throw err;
  }
  const paidIso = paidAt ? new Date(paidAt).toISOString() : new Date().toISOString();
  const { data: paid, error } = await supabase
    .from("coordination_costs")
    .update({
      paid_at: paidIso,
      payment_method: paymentMethod || existing.payment_method || "utility",
    })
    .eq("id", costId)
    .select("*")
    .single();
  if (error) {
    throw Object.assign(new Error(error.message || "Failed to record payment"), {
      statusCode: 500,
      code: "COST_PAYMENT_FAILED",
    });
  }
  emitUciEvent(
    UCI_LIFECYCLE_EVENTS.COST_PAID,
    {
      coordination_record_id: paid.coordination_record_id,
      project_id: paid.project_id,
      cost_id: paid.id,
      paid_at: paidIso,
    },
    { supabase },
  );

  const lifecycle = await handleCostLifecycleEvent(supabase, {
    cost: paid,
    previous: existing,
    created: false,
    deps,
  });
  return lifecycle;
}

async function overrideCostBillingHold(supabase, params) {
  const { costId, userId, deps = {} } = params;
  const { data: existing } = await supabase.from("coordination_costs").select("*").eq("id", costId).maybeSingle();
  if (!existing) {
    const err = new Error("Cost not found");
    err.statusCode = 404;
    err.code = "NOT_FOUND";
    throw err;
  }
  const { data: updated } = await supabase
    .from("coordination_costs")
    .update({
      human_override_bill_at: new Date().toISOString(),
      billing_hold: false,
      qb_sync_status: existing.paid_at ? "ready" : existing.qb_sync_status,
    })
    .eq("id", costId)
    .select("*")
    .single();
  if (updated.paid_at && !updated.quickbooks_invoice_id) {
    await createUciPassthroughInvoice(supabase, {
      cost: updated,
      createInvoiceFn: deps.createInvoiceFn,
      queryFn: deps.queryFn,
      getValidConnectionFn: deps.getValidConnectionFn,
      getOrCreateCustomerFn: deps.getOrCreateCustomerFn,
      qbCustomerId: deps.qbCustomerId,
      qbItemId: deps.qbItemId,
      userId,
    });
  }
  const { data: latest } = await supabase.from("coordination_costs").select("*").eq("id", costId).maybeSingle();
  return { cost: latest || updated };
}

/**
 * 14 business-day SLA while Stage 7 is AWAITING_UTILITY (invoice unpaid).
 */
async function evaluateCiacSla(supabase, coordinationRecordId, now = new Date()) {
  const record = await loadRecord(supabase, coordinationRecordId);
  if (!record || Number(record.current_stage) !== 7) {
    return { ok: true, active: false };
  }
  if (String(record.current_stage_state) !== "AWAITING_UTILITY") {
    return { ok: true, active: false, reason: "not_awaiting_utility" };
  }
  const startedAt = record.updated_at ? new Date(String(record.updated_at)) : now;
  const dueAt = addBusinessDays(startedAt, CIAC_SLA_BUSINESS_DAYS);
  const overdue = now.getTime() > dueAt.getTime();
  if (overdue) {
    await raiseUciAlert(supabase, {
      record,
      severity: "P1",
      code: BLOCKED_REASON_CODES.COST_CIAC_SLA,
      message: `CIAC invoice unpaid after ${CIAC_SLA_BUSINESS_DAYS} business days`,
    });
    await recordSystemTransition(supabase, {
      coordinationRecordId,
      toStage: 7,
      toState: "ESCALATED",
      reason: "CIAC 14-business-day SLA exceeded",
    }).catch(() => null);
  }
  return { ok: true, active: true, overdue, due_at: dueAt.toISOString() };
}

async function maybeCompleteStage7(supabase, params) {
  const { coordinationRecordId, userId = null } = params;
  const record = await loadRecord(supabase, coordinationRecordId);
  if (!record) {
    const err = new Error("Coordination record not found");
    err.statusCode = 404;
    err.code = "NOT_FOUND";
    throw err;
  }
  const costs = await listCosts(supabase, coordinationRecordId, String(record.project_id));
  if (!canCompleteStage7(record, costs)) {
    const err = new Error(
      "Stage 7 cannot complete until every known cost is approved, paid, and billed",
    );
    err.statusCode = 409;
    err.code = "STAGE_7_INCOMPLETE";
    throw err;
  }
  const transition = await recordSystemTransition(supabase, {
    coordinationRecordId,
    toStage: 7,
    toState: "COMPLETED",
    reason: "All known costs approved, paid, and billed",
    triggeredByType: userId ? "user" : "system",
    triggeredById: userId,
  });
  const completedRecord = transition.record || record;
  const stage8 = await maybeEnterStage8(supabase, completedRecord, costs);
  return { ...transition, stage_8: stage8 };
}

async function maybeTryAutoCompleteStage7(supabase, coordinationRecordId, userId = null) {
  const record = await loadRecord(supabase, coordinationRecordId);
  if (!record) return { completed: false, reason: "record_not_found" };

  const costs = await listCosts(supabase, coordinationRecordId, String(record.project_id));
  const stage = Number(record.current_stage);
  const state = String(record.current_stage_state || "");

  if (stage > 7) {
    return { completed: false, reason: "already_past_stage_7" };
  }
  if (stage === 7 && state === "COMPLETED") {
    const stage8 = await maybeEnterStage8(supabase, record, costs);
    return { completed: false, already_completed: true, record, stage_8: stage8 };
  }
  if (stage !== 7 || state === "COMPLETED") {
    return { completed: false, reason: "stage_7_not_active" };
  }
  if (!canCompleteStage7(record, costs)) {
    return { completed: false, reason: "stage_7_incomplete" };
  }
  return maybeCompleteStage7(supabase, { coordinationRecordId, userId });
}

async function retryCoordinationCostInvoice(supabase, params) {
  const { costId, userId = null, deps = {} } = params;
  const { data: existing } = await supabase.from("coordination_costs").select("*").eq("id", costId).maybeSingle();
  if (!existing) {
    const err = new Error("Cost not found");
    err.statusCode = 404;
    err.code = "NOT_FOUND";
    throw err;
  }
  const result = await retryUciPassthroughInvoice(supabase, {
    costId,
    userId,
    deps,
  });
  if ((result.reason === "failed" || result.reason === "uncertain") && !result.created) {
    const record = await loadRecord(supabase, String(existing.coordination_record_id));
    if (record) {
      const errCode = result.error_code ? `[${result.error_code}] ` : "";
      await raiseUciAlert(supabase, {
        record,
        severity: result.retryable === false ? "P1" : "P2",
        code: BLOCKED_REASON_CODES.COST_QB_FAILED,
        message: `${errCode}${result.error || "QuickBooks invoice failed"}`.slice(0, 500),
        details: {
          cost_id: existing.id,
          qb_sync_status: result.billing?.qb_sync_status,
          retryable: result.retryable !== false,
          manual_retry: true,
        },
      });
    }
  }
  return result;
}

module.exports = {
  variancePct,
  varianceGates,
  handleCostLifecycleEvent,
  approveCoordinationCost,
  recordCostPayment,
  overrideCostBillingHold,
  retryCoordinationCostInvoice,
  evaluateCiacSla,
  maybeCompleteStage7,
  maybeTryAutoCompleteStage7,
  maybeEnterStage7OnEstimate,
};
