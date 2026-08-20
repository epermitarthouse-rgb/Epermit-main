"use strict";

/**
 * Stage 6 Class-of-Service SLA — start / stop / overdue / 2× escalation.
 * Uses provider.sla_class_of_service_business_days (default 30).
 */

const { emitUciEvent } = require("./uci-events.service.js");
const { addBusinessDays, slaMultiplierElapsed } = require("./uci-ack-sla.service.js");

const DEFAULT_COS_SLA_BUSINESS_DAYS = 30;

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} coordinationRecordId
 */
async function loadRecordWithCosSla(supabase, coordinationRecordId) {
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

  let slaDays = DEFAULT_COS_SLA_BUSINESS_DAYS;
  if (record.utility_provider_id) {
    const { data: provider } = await supabase
      .from("utility_providers")
      .select("sla_class_of_service_business_days, slug")
      .eq("id", record.utility_provider_id)
      .maybeSingle();
    const configured = Number(provider?.sla_class_of_service_business_days);
    if (Number.isFinite(configured) && configured > 0) slaDays = configured;
  }

  return { record, slaDays };
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} params
 */
async function startCosSla(supabase, params) {
  const { coordinationRecordId, reason = "Stage 6 COS / design review" } = params;
  const { record, slaDays } = await loadRecordWithCosSla(supabase, coordinationRecordId);

  if (record.cos_sla_started_at && !record.cos_sla_stopped_at) {
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
      cos_sla_started_at: startedIso,
      cos_sla_due_at: dueIso,
      cos_sla_stopped_at: null,
      cos_sla_escalated_at: null,
      metadata: {
        ...prevMeta,
        stage_6_cos_sla: {
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
    throw Object.assign(new Error(error.message || "Failed to start COS SLA"), {
      cause: error,
      statusCode: 500,
      code: "COS_SLA_START_FAILED",
    });
  }

  emitUciEvent(
    "uci.stage6.cos_sla.started",
    {
      coordination_record_id: coordinationRecordId,
      project_id: record.project_id,
      due_at: dueIso,
      business_days: slaDays,
    },
    { supabase },
  );

  return {
    started: true,
    already_active: false,
    coordination_record: updated,
    sla_business_days: slaDays,
    due_at: dueIso,
  };
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} params
 */
async function stopCosSla(supabase, params) {
  const { coordinationRecordId, reason = "Stage 6 COS approved" } = params;
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

  if (record.cos_sla_stopped_at) {
    return { stopped: false, already_stopped: true, coordination_record: record };
  }

  const stoppedAt = new Date().toISOString();
  const prevMeta =
    record.metadata && typeof record.metadata === "object" && !Array.isArray(record.metadata)
      ? /** @type {Record<string, unknown>} */ (record.metadata)
      : {};
  const priorSla =
    prevMeta.stage_6_cos_sla && typeof prevMeta.stage_6_cos_sla === "object"
      ? /** @type {Record<string, unknown>} */ (prevMeta.stage_6_cos_sla)
      : {};

  const { data: updated, error } = await supabase
    .from("coordination_records")
    .update({
      cos_sla_stopped_at: stoppedAt,
      metadata: {
        ...prevMeta,
        stage_6_cos_sla: {
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
    throw Object.assign(new Error(error.message || "Failed to stop COS SLA"), {
      cause: error,
      statusCode: 500,
      code: "COS_SLA_STOP_FAILED",
    });
  }

  emitUciEvent(
    "uci.stage6.cos_sla.stopped",
    {
      coordination_record_id: coordinationRecordId,
      project_id: record.project_id,
      stopped_at: stoppedAt,
      reason,
    },
    { supabase },
  );

  return { stopped: true, already_stopped: false, coordination_record: updated };
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} coordinationRecordId
 * @param {Date} [now]
 */
async function evaluateCosSla(supabase, coordinationRecordId, now = new Date()) {
  const { data: record, error } = await supabase
    .from("coordination_records")
    .select("*")
    .eq("id", coordinationRecordId)
    .maybeSingle();

  if (error || !record) {
    return { ok: false, code: "NOT_FOUND" };
  }

  if (!record.cos_sla_started_at || !record.cos_sla_due_at || record.cos_sla_stopped_at) {
    return {
      ok: true,
      active: false,
      overdue: false,
      double_sla: false,
      coordination_record_id: coordinationRecordId,
    };
  }

  const startedAt = new Date(String(record.cos_sla_started_at));
  const dueAt = new Date(String(record.cos_sla_due_at));
  const mult = slaMultiplierElapsed(startedAt, dueAt, now);
  const overdue = now.getTime() > dueAt.getTime();
  const doubleSla = mult >= 2;

  /** @type {Record<string, unknown>} */
  let updated = record;

  if (doubleSla && !record.cos_sla_escalated_at) {
    const escalatedAt = now.toISOString();
    const prevMeta =
      record.metadata && typeof record.metadata === "object" && !Array.isArray(record.metadata)
        ? /** @type {Record<string, unknown>} */ (record.metadata)
        : {};
    const priorSla =
      prevMeta.stage_6_cos_sla && typeof prevMeta.stage_6_cos_sla === "object"
        ? /** @type {Record<string, unknown>} */ (prevMeta.stage_6_cos_sla)
        : {};

    const { data, error: upErr } = await supabase
      .from("coordination_records")
      .update({
        cos_sla_escalated_at: escalatedAt,
        current_stage_state:
          Number(record.current_stage) === 6 &&
          ["AWAITING_UTILITY", "IN_PROGRESS"].includes(String(record.current_stage_state))
            ? "ESCALATED"
            : record.current_stage_state,
        metadata: {
          ...prevMeta,
          stage_6_cos_sla: {
            ...priorSla,
            escalated_at: escalatedAt,
            escalation_multiplier: mult,
            escalation_reason: "cos_exceeded_2x_sla",
            needs_attention: true,
          },
        },
      })
      .eq("id", coordinationRecordId)
      .select("*")
      .single();

    if (!upErr && data) {
      updated = data;
      emitUciEvent(
        "uci.stage6.cos_sla.escalated_2x",
        {
          coordination_record_id: coordinationRecordId,
          project_id: record.project_id,
          multiplier: mult,
          due_at: record.cos_sla_due_at,
        },
        { supabase },
      );
    }
  } else if (overdue) {
    emitUciEvent(
      "uci.stage6.cos_sla.overdue",
      {
        coordination_record_id: coordinationRecordId,
        project_id: record.project_id,
        due_at: record.cos_sla_due_at,
        multiplier: mult,
        needs_attention: true,
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
    due_at: record.cos_sla_due_at,
    coordination_record: updated,
  };
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {{ limit?: number }} [opts]
 */
async function sweepCosSlas(supabase, opts = {}) {
  const limit = Math.min(Math.max(Number(opts.limit) || 50, 1), 200);
  const { data, error } = await supabase
    .from("coordination_records")
    .select("id")
    .eq("current_stage", 6)
    .not("cos_sla_started_at", "is", null)
    .is("cos_sla_stopped_at", null)
    .limit(limit);

  if (error) {
    throw Object.assign(new Error(error.message || "Failed to list COS SLAs"), {
      cause: error,
      statusCode: 500,
      code: "COS_SLA_SWEEP_FAILED",
    });
  }

  const rows = Array.isArray(data) ? data : [];
  /** @type {Array<Record<string, unknown>>} */
  const results = [];
  for (const row of rows) {
    results.push(await evaluateCosSla(supabase, String(row.id)));
  }
  return { evaluated: results.length, results };
}

module.exports = {
  DEFAULT_COS_SLA_BUSINESS_DAYS,
  startCosSla,
  stopCosSla,
  evaluateCosSla,
  sweepCosSlas,
};
