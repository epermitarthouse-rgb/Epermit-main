"use strict";

/**
 * Agent 9 — long-lead equipment tracker.
 * Daily 06:00 UTC job + 15-minute due-row catch-up.
 * Escalate only when slip INCREASES >2 weeks since last check-in, not merely total >2.
 */

const { emitUciEvent } = require("./uci-events.service.js");
const { recordSystemTransition } = require("./uci-transitions.service.js");
const { canEnterStage8, canCompleteStage8 } = require("./uci-lifecycle-guards.service.js");
const { raiseUciAlert } = require("./uci-alerts.service.js");
const { sendUciOutboundEmail } = require("./uci-outbound-email.service.js");
const { resolveUtilityContact } = require("./uci-utility-contact.service.js");
const {
  EQUIPMENT_CHECKIN_CADENCE_DAYS,
  EQUIPMENT_NO_RESPONSE_DAYS,
  EQUIPMENT_SLIP_INCREASE_WEEKS,
  BLOCKED_REASON_CODES,
  UCI_LIFECYCLE_EVENTS,
  EMAIL_TEMPLATES,
} = require("./uci-lifecycle-constants.js");

function weeksBetween(a, b) {
  const start = new Date(a);
  const end = new Date(b);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  return Number(((end.getTime() - start.getTime()) / (7 * 86400000)).toFixed(2));
}

function yyyyMmDd(date) {
  return new Date(date).toISOString().slice(0, 10);
}

function addDays(date, days) {
  return new Date(date.getTime() + days * 86400000);
}

/**
 * Slip increase vs last observed weeks_of_slip — not total slip.
 * @param {number | null} previousWeeks
 * @param {number | null} nextWeeks
 */
function slipIncreasedBeyondThreshold(previousWeeks, nextWeeks) {
  if (previousWeeks == null || nextWeeks == null) return false;
  return nextWeeks - previousWeeks > EQUIPMENT_SLIP_INCREASE_WEEKS;
}

function isDueForCheckIn(item, now = new Date()) {
  const status = String(item.status || "");
  if (!["pending", "on_order", "shipped"].includes(status)) return false;
  if (!item.next_check_in_at) return true;
  return new Date(item.next_check_in_at).getTime() <= now.getTime();
}

async function loadRecord(supabase, id) {
  const { data } = await supabase.from("coordination_records").select("*").eq("id", id).maybeSingle();
  return data || null;
}

async function loadProject(supabase, projectId) {
  const { data } = await supabase.from("projects").select("id, name, permit_number").eq("id", projectId).maybeSingle();
  return data || {};
}

/**
 * COS seed creates type/size only. Does not complete Stage 8.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} params
 */
async function maybeSeedEquipmentFromCos(supabase, params) {
  const { coordinationRecordId, projectId, extractedFields } = params;
  const fields = extractedFields && typeof extractedFields === "object" ? extractedFields : {};
  const transformer = fields.transformer_specs;
  const meterSize = fields.water_meter_size || fields.meter_size;
  const type =
    transformer && typeof transformer === "object" && transformer.value
      ? "transformer"
      : meterSize && typeof meterSize === "object" && meterSize.value
        ? "meter"
        : null;
  if (!type) return { created: false, reason: "no_equipment_fields" };

  const size =
    type === "transformer"
      ? String(transformer.value)
      : String(meterSize.value);

  const idempotencyKey = `cos_equipment:${type}:${size}`;
  const { data: existingRows } = await supabase
    .from("coordination_equipment")
    .select("*")
    .eq("coordination_record_id", coordinationRecordId)
    .eq("project_id", projectId)
    .eq("equipment_type", type);

  const existing = (Array.isArray(existingRows) ? existingRows : []).find(
    (row) => String(row.equipment_size || "") === size,
  );
  if (existing) return { created: false, reason: "already_exists", equipment: existing };

  const { data, error } = await supabase
    .from("coordination_equipment")
    .insert({
      coordination_record_id: coordinationRecordId,
      project_id: projectId,
      equipment_type: type,
      equipment_size: size,
      status: "pending",
      eta_history: [],
      next_check_in_at: new Date().toISOString(),
      check_in_method: "cos_seed",
    })
    .select("*")
    .single();
  if (error) {
    return { created: false, reason: "insert_failed", error: error.message };
  }
  void idempotencyKey;
  return { created: true, equipment: data, reason: "seeded_from_cos", stage_8_complete: false };
}

/**
 * Append ETA history, recompute slip, optionally escalate on increase.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} params
 */
async function appendEquipmentEta(supabase, params) {
  const {
    equipmentId,
    projectId,
    eta,
    source = "operator",
    status = null,
    observedAt = new Date().toISOString(),
    checkInMethod = source,
  } = params;

  const { data: existing, error: fetchErr } = await supabase
    .from("coordination_equipment")
    .select("*")
    .eq("id", equipmentId)
    .eq("project_id", projectId)
    .maybeSingle();
  if (fetchErr || !existing) {
    const err = new Error("Equipment record not found");
    err.statusCode = 404;
    err.code = "NOT_FOUND";
    throw err;
  }

  const history = Array.isArray(existing.eta_history) ? [...existing.eta_history] : [];
  history.push({
    eta: eta || existing.current_eta,
    source,
    observed_at: observedAt,
  });

  const previousSlip =
    existing.last_weeks_of_slip != null
      ? Number(existing.last_weeks_of_slip)
      : existing.weeks_of_slip != null
        ? Number(existing.weeks_of_slip)
        : null;
  let weeksOfSlip = existing.weeks_of_slip;
  const initial = existing.initial_eta || (history[0] && history[0].eta);
  const currentEta = eta || existing.current_eta;
  if (initial && currentEta) {
    weeksOfSlip = weeksBetween(initial, currentEta);
  }
  const increased = slipIncreasedBeyondThreshold(previousSlip, weeksOfSlip);

  const { data, error } = await supabase
    .from("coordination_equipment")
    .update({
      current_eta: currentEta,
      initial_eta: existing.initial_eta || currentEta,
      status: status || existing.status,
      eta_history: history,
      last_check_in_at: observedAt,
      last_response_at: observedAt,
      next_check_in_at: addDays(new Date(observedAt), EQUIPMENT_CHECKIN_CADENCE_DAYS).toISOString(),
      weeks_of_slip: weeksOfSlip,
      last_weeks_of_slip: previousSlip,
      check_in_method: checkInMethod,
    })
    .eq("id", equipmentId)
    .select("*")
    .single();
  if (error) {
    throw Object.assign(new Error(error.message || "Failed to update equipment ETA"), {
      statusCode: 500,
      code: "EQUIPMENT_UPDATE_FAILED",
    });
  }

  emitUciEvent(
    UCI_LIFECYCLE_EVENTS.EQUIPMENT_ETA_UPDATED,
    {
      coordination_record_id: existing.coordination_record_id,
      project_id: projectId,
      equipment_id: equipmentId,
      eta: currentEta,
      source,
      weeks_of_slip: weeksOfSlip,
    },
    { supabase },
  );

  if (increased) {
    emitUciEvent(
      UCI_LIFECYCLE_EVENTS.EQUIPMENT_SLIP_INCREASED,
      {
        coordination_record_id: existing.coordination_record_id,
        project_id: projectId,
        equipment_id: equipmentId,
        previous_weeks: previousSlip,
        weeks_of_slip: weeksOfSlip,
      },
      { supabase },
    );
    const record = await loadRecord(supabase, String(existing.coordination_record_id));
    if (record) {
      await raiseUciAlert(supabase, {
        record,
        severity: "P1",
        code: BLOCKED_REASON_CODES.EQUIPMENT_SLIP_INCREASE,
        message: `Equipment slip increased by more than ${EQUIPMENT_SLIP_INCREASE_WEEKS} weeks`,
        details: { equipment_id: equipmentId, previous_weeks: previousSlip, weeks_of_slip: weeksOfSlip },
      });
    }
  }

  const stage8 = await maybeTryAutoCompleteStage8(
    supabase,
    String(existing.coordination_record_id),
  ).catch(() => null);

  return {
    equipment: data,
    slip_increased: increased,
    slip_alert: increased,
    total_weeks_of_slip: weeksOfSlip,
    stage_8: stage8,
  };
}

/**
 * Send check-in (email, portal fallback to email) and advance next_check_in_at +7d.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} params
 */
async function sendEquipmentCheckIn(supabase, params) {
  const { equipment, now = new Date(), deps = {} } = params;
  const record = await loadRecord(supabase, String(equipment.coordination_record_id));
  const project = await loadProject(supabase, String(equipment.project_id));
  const idempotencyKey = `equip_checkin:${equipment.id}:${yyyyMmDd(now)}`;

  let portalResult = { ok: false, reason: "not_attempted" };
  if (typeof deps.portalCheckInFn === "function") {
    try {
      portalResult = await deps.portalCheckInFn(equipment, record);
    } catch (err) {
      portalResult = { ok: false, reason: "portal_error", error: err instanceof Error ? err.message : String(err) };
    }
  }

  let emailResult = null;
  const shouldEmail = portalResult.ok !== true;
  if (shouldEmail) {
    const utilityContact = resolveUtilityContact(record, { communications: deps.communications || [] });
    const toEmail = utilityContact.email || deps.toEmail;
    emailResult = await sendUciOutboundEmail(supabase, {
      coordinationRecordId: String(equipment.coordination_record_id),
      projectId: String(equipment.project_id),
      userId: record?.user_id || deps.userId || null,
      templateId: EMAIL_TEMPLATES.EQUIPMENT_ETA_CHECKIN,
      idempotencyKey,
      toEmail,
      vars: {
        project_name: project.name || project.permit_number,
        equipment_type: equipment.equipment_type,
        equipment_size: equipment.equipment_size,
        current_eta: equipment.current_eta,
        utility_contact_name: utilityContact.name || record?.utility_contact_name,
      },
      sendMailFn: deps.sendMailFn,
      getTokenFn: deps.getTokenFn,
    });
    if (portalResult.ok !== true && portalResult.reason !== "not_attempted") {
      emailResult = { ...emailResult, portal_fallback: true, portal: portalResult };
    }
  }

  const nextCheckIn = addDays(now, EQUIPMENT_CHECKIN_CADENCE_DAYS).toISOString();
  const { data: updated } = await supabase
    .from("coordination_equipment")
    .update({
      last_check_in_at: now.toISOString(),
      next_check_in_at: nextCheckIn,
      check_in_method: portalResult.ok ? "portal" : "email",
    })
    .eq("id", equipment.id)
    .select("*")
    .single();

  emitUciEvent(
    UCI_LIFECYCLE_EVENTS.EQUIPMENT_CHECKIN_SENT,
    {
      coordination_record_id: equipment.coordination_record_id,
      project_id: equipment.project_id,
      equipment_id: equipment.id,
      method: portalResult.ok ? "portal" : "email",
    },
    { supabase },
  );

  return {
    equipment: updated || equipment,
    portal: portalResult,
    email: emailResult,
    next_check_in_at: nextCheckIn,
  };
}

function noResponseDays(item, now) {
  const last = item.last_response_at || item.last_check_in_at;
  if (!last) return EQUIPMENT_NO_RESPONSE_DAYS + 1;
  return (now.getTime() - new Date(last).getTime()) / 86400000;
}

/**
 * Daily + catch-up worker.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} [opts]
 */
async function runDueEquipmentCheckIns(supabase, opts = {}) {
  const now = opts.now || new Date();
  const limit = Math.min(Math.max(Number(opts.limit) || 50, 1), 200);
  const dueAt = now.toISOString();
  const [dueRes, unsetRes] = await Promise.all([
    supabase
      .from("coordination_equipment")
      .select("*")
      .in("status", ["pending", "on_order", "shipped"])
      .lte("next_check_in_at", dueAt)
      .limit(limit),
    supabase
      .from("coordination_equipment")
      .select("*")
      .in("status", ["pending", "on_order", "shipped"])
      .is("next_check_in_at", null)
      .limit(limit),
  ]);
  const error = dueRes.error || unsetRes.error;
  if (error) {
    throw Object.assign(new Error(error.message || "Failed to list due equipment"), {
      statusCode: 500,
      code: "EQUIPMENT_DUE_LIST_FAILED",
    });
  }

  const seen = new Set();
  const merged = [...(Array.isArray(dueRes.data) ? dueRes.data : []), ...(Array.isArray(unsetRes.data) ? unsetRes.data : [])]
    .filter((row) => {
      if (!row?.id || seen.has(String(row.id))) return false;
      seen.add(String(row.id));
      return true;
    });
  const rows = merged.filter((row) => isDueForCheckIn(row, now)).slice(0, limit);
  /** @type {Array<Record<string, unknown>>} */
  const results = [];
  for (const item of rows) {
    const sent = await sendEquipmentCheckIn(supabase, { equipment: item, now, deps: opts.deps || {} });
    if (noResponseDays(item, now) >= EQUIPMENT_NO_RESPONSE_DAYS) {
      const record = await loadRecord(supabase, String(item.coordination_record_id));
      if (record) {
        await raiseUciAlert(supabase, {
          record,
          severity: "P1",
          code: BLOCKED_REASON_CODES.EQUIPMENT_NO_RESPONSE,
          message: "No equipment ETA response in 14 days",
          details: { equipment_id: item.id },
        });
      }
      sent.no_response_escalated = true;
    }
    results.push(sent);
  }
  return { evaluated: results.length, results, at: now.toISOString() };
}

async function maybeCompleteStage8(supabase, params) {
  const { coordinationRecordId, userId = null } = params;
  const record = await loadRecord(supabase, coordinationRecordId);
  if (!record) {
    const err = new Error("Coordination record not found");
    err.statusCode = 404;
    err.code = "NOT_FOUND";
    throw err;
  }
  const { data: equipment } = await supabase
    .from("coordination_equipment")
    .select("*")
    .eq("coordination_record_id", coordinationRecordId)
    .eq("project_id", record.project_id);
  const items = Array.isArray(equipment) ? equipment : [];
  if (!canCompleteStage8(record, items)) {
    const err = new Error(
      "Stage 8 cannot complete until every in-scope item has a current ETA and procurement status",
    );
    err.statusCode = 409;
    err.code = "STAGE_8_INCOMPLETE";
    throw err;
  }
  return recordSystemTransition(supabase, {
    coordinationRecordId,
    toStage: 8,
    toState: "COMPLETED",
    reason: "Procurement queue tracked with current ETAs",
    triggeredByType: userId ? "user" : "system",
    triggeredById: userId,
  });
}

async function maybeTryAutoCompleteStage8(supabase, coordinationRecordId, userId = null) {
  const record = await loadRecord(supabase, coordinationRecordId);
  if (!record) return { completed: false, reason: "record_not_found" };

  const { data: equipment } = await supabase
    .from("coordination_equipment")
    .select("*")
    .eq("coordination_record_id", coordinationRecordId)
    .eq("project_id", record.project_id);
  const items = Array.isArray(equipment) ? equipment : [];

  const stage = Number(record.current_stage);
  const state = String(record.current_stage_state || "");

  if (stage > 8) {
    return { completed: false, reason: "already_past_stage_8" };
  }
  if (stage === 8 && state === "COMPLETED") {
    return { completed: false, already_completed: true, record };
  }
  if (stage !== 8 || state === "COMPLETED") {
    return { completed: false, reason: "stage_8_not_active" };
  }
  if (!canCompleteStage8(record, items)) {
    return { completed: false, reason: "stage_8_incomplete" };
  }
  return maybeCompleteStage8(supabase, { coordinationRecordId, userId });
}

async function maybeEnterStage8(supabase, record, costs) {
  if (!canEnterStage8(record, costs)) return { entered: false };
  const transition = await recordSystemTransition(supabase, {
    coordinationRecordId: String(record.id),
    toStage: 8,
    toState: "IN_PROGRESS",
    reason: "Stage 7 complete — long-lead equipment tracking",
  });
  return { entered: true, ...transition };
}

module.exports = {
  weeksBetween,
  slipIncreasedBeyondThreshold,
  isDueForCheckIn,
  maybeSeedEquipmentFromCos,
  appendEquipmentEta,
  sendEquipmentCheckIn,
  runDueEquipmentCheckIns,
  maybeCompleteStage8,
  maybeTryAutoCompleteStage8,
  maybeEnterStage8,
  noResponseDays,
};
