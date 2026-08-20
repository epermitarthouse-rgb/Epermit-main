"use strict";

/**
 * Stage 5 acknowledgment SLA — start / stop / overdue / 2× escalation.
 * Uses provider.sla_acknowledgment_business_days (default 5).
 */

const { emitUciEvent } = require("./uci-events.service.js");

async function withPredictionRecompute(supabase, record) {
  const { afterCoordinationRecordWrite } = require("./uci-record-write.service.js");
  return afterCoordinationRecordWrite(supabase, record);
}

const DEFAULT_ACK_SLA_BUSINESS_DAYS = 5;

/**
 * @param {Date} start
 * @param {number} businessDays
 * @returns {Date}
 */
function addBusinessDays(start, businessDays) {
  const days = Math.max(0, Math.floor(Number(businessDays) || 0));
  const result = new Date(start.getTime());
  let added = 0;
  while (added < days) {
    result.setUTCDate(result.getUTCDate() + 1);
    const dow = result.getUTCDay();
    if (dow !== 0 && dow !== 6) added += 1;
  }
  return result;
}

/**
 * @param {Date} startedAt
 * @param {Date} dueAt
 * @param {Date} [now]
 */
function slaMultiplierElapsed(startedAt, dueAt, now = new Date()) {
  const startMs = startedAt.getTime();
  const dueMs = dueAt.getTime();
  const span = dueMs - startMs;
  if (!(span > 0)) return 0;
  return (now.getTime() - startMs) / span;
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} coordinationRecordId
 */
async function loadRecordWithProvider(supabase, coordinationRecordId) {
  const { data: record, error } = await supabase
    .from("coordination_records")
    .select("*")
    .eq("id", coordinationRecordId)
    .maybeSingle();
  if (error) {
    throw Object.assign(new Error(error.message || "Failed to load coordination record"), {
      cause: error,
      statusCode: 500,
      code: "COORDINATION_FETCH_FAILED",
    });
  }
  if (!record) {
    const err = new Error("Coordination record not found");
    err.statusCode = 404;
    err.code = "NOT_FOUND";
    throw err;
  }

  let slaDays = DEFAULT_ACK_SLA_BUSINESS_DAYS;
  if (record.utility_provider_id) {
    const { data: provider } = await supabase
      .from("utility_providers")
      .select("sla_acknowledgment_business_days, slug")
      .eq("id", record.utility_provider_id)
      .maybeSingle();
    const configured = Number(provider?.sla_acknowledgment_business_days);
    if (Number.isFinite(configured) && configured > 0) slaDays = configured;
  }

  return { record, slaDays };
}

/**
 * Start (or restart if not stopped) acknowledgment SLA when entering Stage 5 AWAITING_UTILITY.
 * Idempotent when already started and not stopped.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} params
 * @param {string} params.coordinationRecordId
 * @param {string} [params.reason]
 * @param {Date|string} [params.startedAt]
 */
async function startAcknowledgmentSla(supabase, params) {
  const { coordinationRecordId, reason = "Stage 5 AWAITING_UTILITY" } = params;
  const { record, slaDays } = await loadRecordWithProvider(supabase, coordinationRecordId);

  if (record.ack_sla_started_at && !record.ack_sla_stopped_at) {
    return {
      started: false,
      already_active: true,
      coordination_record: record,
      sla_business_days: slaDays,
    };
  }

  const startedAt = params.startedAt ? new Date(params.startedAt) : new Date();
  const dueAt = addBusinessDays(startedAt, slaDays);
  const startedIso = startedAt.toISOString();
  const dueIso = dueAt.toISOString();

  const prevMeta =
    record.metadata && typeof record.metadata === "object" && !Array.isArray(record.metadata)
      ? /** @type {Record<string, unknown>} */ (record.metadata)
      : {};

  const { data: updated, error } = await supabase
    .from("coordination_records")
    .update({
      ack_sla_started_at: startedIso,
      ack_sla_due_at: dueIso,
      ack_sla_stopped_at: null,
      ack_sla_escalated_at: null,
      metadata: {
        ...prevMeta,
        stage_5_ack_sla: {
          started_at: startedIso,
          due_at: dueIso,
          business_days: slaDays,
          reason,
          started_by: "system",
        },
      },
    })
    .eq("id", coordinationRecordId)
    .select("*")
    .single();

  if (error) {
    throw Object.assign(new Error(error.message || "Failed to start acknowledgment SLA"), {
      cause: error,
      statusCode: 500,
      code: "ACK_SLA_START_FAILED",
    });
  }

  emitUciEvent(
    "uci.stage5.ack_sla.started",
    {
      coordination_record_id: coordinationRecordId,
      project_id: record.project_id,
      due_at: dueIso,
      business_days: slaDays,
    },
    { supabase },
  );

  const withPredictions = await withPredictionRecompute(supabase, updated);

  return {
    started: true,
    already_active: false,
    coordination_record: withPredictions,
    sla_business_days: slaDays,
    due_at: dueIso,
  };
}

/**
 * Stop SLA when Stage 5 completes with a valid acknowledgment.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} params
 * @param {string} params.coordinationRecordId
 * @param {string} [params.reason]
 */
async function stopAcknowledgmentSla(supabase, params) {
  const { coordinationRecordId, reason = "Stage 5 acknowledgment confirmed" } = params;
  const { data: record, error: fetchErr } = await supabase
    .from("coordination_records")
    .select("*")
    .eq("id", coordinationRecordId)
    .maybeSingle();

  if (fetchErr) {
    throw Object.assign(new Error(fetchErr.message || "Failed to load coordination record"), {
      cause: fetchErr,
      statusCode: 500,
      code: "COORDINATION_FETCH_FAILED",
    });
  }
  if (!record) {
    const err = new Error("Coordination record not found");
    err.statusCode = 404;
    err.code = "NOT_FOUND";
    throw err;
  }

  if (record.ack_sla_stopped_at) {
    return { stopped: false, already_stopped: true, coordination_record: record };
  }

  const stoppedAt = new Date().toISOString();
  const prevMeta =
    record.metadata && typeof record.metadata === "object" && !Array.isArray(record.metadata)
      ? /** @type {Record<string, unknown>} */ (record.metadata)
      : {};
  const priorSla =
    prevMeta.stage_5_ack_sla && typeof prevMeta.stage_5_ack_sla === "object"
      ? /** @type {Record<string, unknown>} */ (prevMeta.stage_5_ack_sla)
      : {};

  const { data: updated, error } = await supabase
    .from("coordination_records")
    .update({
      ack_sla_stopped_at: stoppedAt,
      metadata: {
        ...prevMeta,
        stage_5_ack_sla: {
          ...priorSla,
          stopped_at: stoppedAt,
          stop_reason: reason,
        },
      },
    })
    .eq("id", coordinationRecordId)
    .select("*")
    .single();

  if (error) {
    throw Object.assign(new Error(error.message || "Failed to stop acknowledgment SLA"), {
      cause: error,
      statusCode: 500,
      code: "ACK_SLA_STOP_FAILED",
    });
  }

  emitUciEvent(
    "uci.stage5.ack_sla.stopped",
    {
      coordination_record_id: coordinationRecordId,
      project_id: record.project_id,
      stopped_at: stoppedAt,
      reason,
    },
    { supabase },
  );

  const withPredictions = await withPredictionRecompute(supabase, updated);

  return { stopped: true, already_stopped: false, coordination_record: withPredictions };
}

/**
 * Evaluate overdue / 2× SLA escalation for a single record.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} coordinationRecordId
 * @param {Date} [now]
 */
async function evaluateAcknowledgmentSla(supabase, coordinationRecordId, now = new Date()) {
  const { data: record, error } = await supabase
    .from("coordination_records")
    .select("*")
    .eq("id", coordinationRecordId)
    .maybeSingle();

  if (error || !record) {
    return { ok: false, code: "NOT_FOUND" };
  }

  if (!record.ack_sla_started_at || !record.ack_sla_due_at || record.ack_sla_stopped_at) {
    return {
      ok: true,
      active: false,
      overdue: false,
      double_sla: false,
      coordination_record_id: coordinationRecordId,
    };
  }

  const startedAt = new Date(String(record.ack_sla_started_at));
  const dueAt = new Date(String(record.ack_sla_due_at));
  const mult = slaMultiplierElapsed(startedAt, dueAt, now);
  const overdue = now.getTime() > dueAt.getTime();
  const doubleSla = mult >= 2;

  /** @type {Record<string, unknown>} */
  let updated = record;

  if (doubleSla && !record.ack_sla_escalated_at) {
    const escalatedAt = now.toISOString();
    const prevMeta =
      record.metadata && typeof record.metadata === "object" && !Array.isArray(record.metadata)
        ? /** @type {Record<string, unknown>} */ (record.metadata)
        : {};
    const priorSla =
      prevMeta.stage_5_ack_sla && typeof prevMeta.stage_5_ack_sla === "object"
        ? /** @type {Record<string, unknown>} */ (prevMeta.stage_5_ack_sla)
        : {};

    const { data, error: upErr } = await supabase
      .from("coordination_records")
      .update({
        ack_sla_escalated_at: escalatedAt,
        current_stage_state:
          record.current_stage === 5 && record.current_stage_state === "AWAITING_UTILITY"
            ? "ESCALATED"
            : record.current_stage_state,
        metadata: {
          ...prevMeta,
          stage_5_ack_sla: {
            ...priorSla,
            escalated_at: escalatedAt,
            escalation_multiplier: mult,
            escalation_reason: "acknowledgment_exceeded_2x_sla",
          },
        },
      })
      .eq("id", coordinationRecordId)
      .select("*")
      .single();

    if (!upErr && data) {
      updated = await withPredictionRecompute(supabase, data);
      emitUciEvent(
        "uci.stage5.ack_sla.escalated_2x",
        {
          coordination_record_id: coordinationRecordId,
          project_id: record.project_id,
          multiplier: mult,
          due_at: record.ack_sla_due_at,
        },
        { supabase },
      );
    }
  } else if (overdue) {
    emitUciEvent(
      "uci.stage5.ack_sla.overdue",
      {
        coordination_record_id: coordinationRecordId,
        project_id: record.project_id,
        due_at: record.ack_sla_due_at,
        multiplier: mult,
      },
      { supabase },
    );
  }

  return {
    ok: true,
    active: true,
    overdue,
    double_sla: doubleSla,
    multiplier: mult,
    due_at: record.ack_sla_due_at,
    coordination_record: updated,
  };
}

/**
 * Sweep active Stage 5 SLA timers (bounded).
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {{ limit?: number }} [opts]
 */
async function sweepAcknowledgmentSlas(supabase, opts = {}) {
  const limit = Math.min(Math.max(Number(opts.limit) || 50, 1), 200);
  const { data, error } = await supabase
    .from("coordination_records")
    .select("id")
    .eq("current_stage", 5)
    .not("ack_sla_started_at", "is", null)
    .is("ack_sla_stopped_at", null)
    .limit(limit);

  if (error) {
    throw Object.assign(new Error(error.message || "Failed to list acknowledgment SLAs"), {
      cause: error,
      statusCode: 500,
      code: "ACK_SLA_SWEEP_FAILED",
    });
  }

  const rows = Array.isArray(data) ? data : [];
  /** @type {Array<Record<string, unknown>>} */
  const results = [];
  for (const row of rows) {
    results.push(await evaluateAcknowledgmentSla(supabase, String(row.id)));
  }
  return { evaluated: results.length, results };
}

module.exports = {
  DEFAULT_ACK_SLA_BUSINESS_DAYS,
  addBusinessDays,
  slaMultiplierElapsed,
  startAcknowledgmentSla,
  stopAcknowledgmentSla,
  evaluateAcknowledgmentSla,
  sweepAcknowledgmentSlas,
};
