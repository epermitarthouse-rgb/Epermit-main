"use strict";

/**
 * Agent 11 — meter-set choreographer.
 * ONLY runs when current_stage=9 AND inspection_release_received_at is set.
 * NEVER auto-completes Stage 9.
 */

const { emitUciEvent } = require("./uci-events.service.js");
const { recordSystemTransition } = require("./uci-transitions.service.js");
const { updateCoordinationRecordFields } = require("./uci-record-write.service.js");
const { raiseUciAlert } = require("./uci-alerts.service.js");
const { sendUciOutboundEmail } = require("./uci-outbound-email.service.js");
const { canCompleteStage9 } = require("./uci-lifecycle-guards.service.js");
const {
  BLOCKED_REASON_CODES,
  UCI_LIFECYCLE_EVENTS,
  EMAIL_TEMPLATES,
} = require("./uci-lifecycle-constants.js");

const CHECKLIST_48H = Object.freeze([
  "gates_open_or_access_arranged",
  "panel_accessible",
  "dummy_meter_removed_if_temp_power",
]);

function asMeta(record) {
  if (record?.metadata && typeof record.metadata === "object" && !Array.isArray(record.metadata)) {
    return { ...record.metadata };
  }
  return {};
}

function choreographyBlocked(record) {
  if (Number(record?.current_stage) !== 9) {
    return { blocked: true, reason: "not_stage_9" };
  }
  if (!record.inspection_release_received_at) {
    return { blocked: true, reason: "inspection_release_missing" };
  }
  return { blocked: false };
}

async function loadRecord(supabase, id) {
  const { data } = await supabase.from("coordination_records").select("*").eq("id", id).maybeSingle();
  return data || null;
}

async function loadProject(supabase, projectId) {
  const { data } = await supabase.from("projects").select("id, name, permit_number").eq("id", projectId).maybeSingle();
  return data || {};
}

async function listMilestones(supabase, coordinationRecordId, projectId) {
  const { data } = await supabase
    .from("coordination_milestones")
    .select("*")
    .eq("coordination_record_id", coordinationRecordId)
    .eq("project_id", projectId);
  return Array.isArray(data) ? data : [];
}

/**
 * Durable inspection release — writes DB, never localStorage.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} params
 */
async function recordInspectionRelease(supabase, params) {
  const { coordinationRecordId, userId = null, receivedAt = null, notes = null } = params;
  const receivedIso = receivedAt ? new Date(receivedAt).toISOString() : new Date().toISOString();
  const current = await loadRecord(supabase, coordinationRecordId);
  if (!current) {
    const err = new Error("Coordination record not found");
    err.statusCode = 404;
    err.code = "NOT_FOUND";
    throw err;
  }

  const { record } = await updateCoordinationRecordFields(supabase, {
    coordinationRecordId,
    fields: { inspection_release_received_at: receivedIso },
    metadataPatch: {
      inspection_release: {
        received_at: receivedIso,
        recorded_by: userId,
        notes: notes || null,
      },
    },
    eventName: UCI_LIFECYCLE_EVENTS.INSPECTION_RELEASE_RECORDED,
    eventPayload: { received_at: receivedIso },
  });

  if (Number(record.current_stage) === 9 && String(record.current_stage_state) === "BLOCKED") {
    await recordSystemTransition(supabase, {
      coordinationRecordId,
      toStage: 9,
      toState: "IN_PROGRESS",
      reason: "Inspection release recorded — meter-set choreography may start",
      triggeredByType: userId ? "user" : "system",
      triggeredById: userId,
    }).catch(() => null);
  }

  return { record: (await loadRecord(supabase, coordinationRecordId)) || record };
}

async function updateSiteContact(supabase, params) {
  const { coordinationRecordId, siteContactName, siteContactEmail, siteContactPhone } = params;
  return updateCoordinationRecordFields(supabase, {
    coordinationRecordId,
    fields: {
      site_contact_name: siteContactName ?? undefined,
      site_contact_email: siteContactEmail ?? undefined,
      site_contact_phone: siteContactPhone ?? undefined,
    },
  });
}

/**
 * Step 1 — templated request to utility PM. No-op if choreography blocked.
 */
async function requestMeterSet(supabase, params) {
  const { coordinationRecordId, deps = {} } = params;
  const record = await loadRecord(supabase, coordinationRecordId);
  if (!record) {
    const err = new Error("Coordination record not found");
    err.statusCode = 404;
    err.code = "NOT_FOUND";
    throw err;
  }
  const gate = choreographyBlocked(record);
  if (gate.blocked) {
    return { started: false, ...gate };
  }
  if (!record.utility_contact_email) {
    return { started: false, reason: "missing_utility_pm", needs_fields: ["utility_contact_email"] };
  }
  const project = await loadProject(supabase, String(record.project_id));
  const sent = await sendUciOutboundEmail(supabase, {
    coordinationRecordId,
    projectId: String(record.project_id),
    userId: record.user_id || deps.userId || null,
    templateId: EMAIL_TEMPLATES.METER_SET_REQUEST,
    idempotencyKey: `meter_set_request:${coordinationRecordId}`,
    toEmail: record.utility_contact_email,
    vars: {
      project_name: project.name || project.permit_number,
      utility_contact_name: record.utility_contact_name,
      site_contact_name: record.site_contact_name,
      site_contact_email: record.site_contact_email,
      site_contact_phone: record.site_contact_phone,
    },
    sendMailFn: deps.sendMailFn,
    getTokenFn: deps.getTokenFn,
  });
  emitUciEvent(
    UCI_LIFECYCLE_EVENTS.METER_SET_REQUESTED,
    { coordination_record_id: coordinationRecordId, project_id: record.project_id },
    { supabase },
  );
  return { started: true, request: sent, stage_completed: false };
}

async function upsertMeterSetMilestone(supabase, params) {
  const { record, scheduledDate, status = "scheduled" } = params;
  const row = {
    coordination_record_id: String(record.id),
    project_id: String(record.project_id),
    milestone_type: "meter_set",
    parent_stage: 9,
    target_date: scheduledDate,
    status,
    notes: "Agent 11 meter-set milestone",
    source: "agent_11",
    idempotency_key: `meter_set:${record.id}`,
    metadata: { scheduled_date: scheduledDate },
  };
  const { data: existing } = await supabase
    .from("coordination_milestones")
    .select("id")
    .eq("coordination_record_id", String(record.id))
    .eq("idempotency_key", row.idempotency_key)
    .maybeSingle();
  if (existing?.id) {
    const { data, error } = await supabase
      .from("coordination_milestones")
      .update(row)
      .eq("id", existing.id)
      .select("*")
      .single();
    if (error) throw Object.assign(new Error(error.message), { statusCode: 500 });
    return data;
  }
  const { data, error } = await supabase.from("coordination_milestones").insert(row).select("*").single();
  if (error) throw Object.assign(new Error(error.message), { statusCode: 500 });
  return data;
}

/**
 * Step 2 — confirmed date: persist meter_set_scheduled_at + milestone type `meter_set`.
 */
async function confirmMeterSetDate(supabase, params) {
  const { coordinationRecordId, scheduledDate, userId = null } = params;
  const record = await loadRecord(supabase, coordinationRecordId);
  if (!record) {
    const err = new Error("Coordination record not found");
    err.statusCode = 404;
    err.code = "NOT_FOUND";
    throw err;
  }
  const gate = choreographyBlocked(record);
  if (gate.blocked) {
    return { scheduled: false, ...gate, proposed_date: scheduledDate };
  }
  if (!scheduledDate) {
    const err = new Error("scheduled_date is required");
    err.statusCode = 400;
    err.code = "SCHEDULED_DATE_REQUIRED";
    throw err;
  }

  const { record: updated } = await updateCoordinationRecordFields(supabase, {
    coordinationRecordId,
    fields: { meter_set_scheduled_at: new Date(scheduledDate).toISOString() },
    eventName: UCI_LIFECYCLE_EVENTS.METER_SET_SCHEDULED,
    eventPayload: { scheduled_date: scheduledDate },
  });
  const milestone = await upsertMeterSetMilestone(supabase, {
    record: updated,
    scheduledDate,
    status: "scheduled",
  });
  void userId;
  return { scheduled: true, record: updated, milestone, stage_completed: false };
}

/**
 * Step 3 — 48h checklist to SITE CONTACT.
 */
async function send48hChecklist(supabase, params) {
  const { record, deps = {}, now = new Date() } = params;
  const gate = choreographyBlocked(record);
  if (gate.blocked) return { sent: false, ...gate };
  if (!record.meter_set_scheduled_at) return { sent: false, reason: "not_scheduled" };
  const scheduled = new Date(String(record.meter_set_scheduled_at));
  const hoursUntil = (scheduled.getTime() - now.getTime()) / 3600000;
  if (hoursUntil > 48 || hoursUntil < 0) {
    return { sent: false, reason: "outside_48h_window", hours_until: hoursUntil };
  }
  if (!record.site_contact_email) {
    return { sent: false, reason: "missing_site_contact", needs_fields: ["site_contact_email"] };
  }
  const scheduledDate = scheduled.toISOString().slice(0, 10);
  const project = await loadProject(supabase, String(record.project_id));
  const sent = await sendUciOutboundEmail(supabase, {
    coordinationRecordId: String(record.id),
    projectId: String(record.project_id),
    userId: record.user_id || deps.userId || null,
    templateId: EMAIL_TEMPLATES.METER_SET_48H_CHECKLIST,
    idempotencyKey: `meter_set_48h:${record.id}:${scheduledDate}`,
    toEmail: record.site_contact_email,
    vars: {
      project_name: project.name || project.permit_number,
      site_contact_name: record.site_contact_name,
      scheduled_date: scheduledDate,
    },
    sendMailFn: deps.sendMailFn,
    getTokenFn: deps.getTokenFn,
  });
  emitUciEvent(
    UCI_LIFECYCLE_EVENTS.METER_SET_CHECKLIST_SENT,
    { coordination_record_id: record.id, project_id: record.project_id, scheduled_date: scheduledDate },
    { supabase },
  );
  return { sent: sent.sent === true, checklist: CHECKLIST_48H, email: sent, stage_completed: false };
}

async function sweep48hChecklists(supabase, opts = {}) {
  const now = opts.now || new Date();
  const windowStart = new Date(now.getTime());
  const windowEnd = new Date(now.getTime() + 48 * 3600000);
  const { data, error } = await supabase
    .from("coordination_records")
    .select("*")
    .eq("current_stage", 9)
    .not("inspection_release_received_at", "is", null)
    .not("meter_set_scheduled_at", "is", null)
    .is("site_readiness_confirmed_at", null)
    .limit(50);
  if (error) {
    throw Object.assign(new Error(error.message || "Failed to list meter-set 48h rows"), {
      statusCode: 500,
      code: "METER_48H_SWEEP_FAILED",
    });
  }
  const rows = (Array.isArray(data) ? data : []).filter((row) => {
    const scheduled = new Date(String(row.meter_set_scheduled_at));
    return scheduled.getTime() >= windowStart.getTime() && scheduled.getTime() <= windowEnd.getTime();
  });
  /** @type {Array<Record<string, unknown>>} */
  const results = [];
  for (const record of rows) {
    results.push(await send48hChecklist(supabase, { record, now, deps: opts.deps || {} }));
  }
  return { evaluated: results.length, results };
}

async function confirmSiteReadiness(supabase, params) {
  const { coordinationRecordId, userId = null } = params;
  const record = await loadRecord(supabase, coordinationRecordId);
  if (!record) {
    const err = new Error("Coordination record not found");
    err.statusCode = 404;
    err.code = "NOT_FOUND";
    throw err;
  }
  const gate = choreographyBlocked(record);
  if (gate.blocked) return { confirmed: false, ...gate };
  return updateCoordinationRecordFields(supabase, {
    coordinationRecordId,
    fields: { site_readiness_confirmed_at: new Date().toISOString() },
    metadataPatch: { site_readiness: { confirmed_at: new Date().toISOString(), confirmed_by: userId } },
  });
}

/**
 * Step 5 — day-of actual or missed + reschedule. Does not complete Stage 9.
 */
async function recordMeterSetOutcome(supabase, params) {
  const { coordinationRecordId, outcome, actualDate = null, rescheduleDate = null, userId = null } = params;
  const record = await loadRecord(supabase, coordinationRecordId);
  if (!record) {
    const err = new Error("Coordination record not found");
    err.statusCode = 404;
    err.code = "NOT_FOUND";
    throw err;
  }
  const gate = choreographyBlocked(record);
  if (gate.blocked) return { recorded: false, ...gate };

  const meta = asMeta(record);
  const prior = meta.uci_meter_set && typeof meta.uci_meter_set === "object" ? meta.uci_meter_set : {};
  const rescheduleCount = Number(prior.reschedule_count || 0);

  if (outcome === "completed") {
    const milestone = await upsertMeterSetMilestone(supabase, {
      record,
      scheduledDate: actualDate || record.meter_set_scheduled_at,
      status: "completed",
    });
    await supabase
      .from("coordination_milestones")
      .update({ actual_date: actualDate || new Date().toISOString().slice(0, 10), status: "completed" })
      .eq("id", milestone.id);
    return { recorded: true, outcome: "completed", milestone, stage_completed: false };
  }

  if (outcome === "no_show" || outcome === "missed") {
    const nextCount = rescheduleCount + (rescheduleDate ? 1 : 0);
    await raiseUciAlert(supabase, {
      record,
      severity: "P0",
      code: BLOCKED_REASON_CODES.METER_SET_NO_SHOW,
      message: "Meter-set crew no-show — reschedule required",
    });
    emitUciEvent(
      UCI_LIFECYCLE_EVENTS.METER_SET_NO_SHOW,
      { coordination_record_id: coordinationRecordId, project_id: record.project_id },
      { supabase },
    );
    if (nextCount >= 2) {
      await raiseUciAlert(supabase, {
        record,
        severity: "P1",
        code: BLOCKED_REASON_CODES.METER_SET_MULTI_RESCHEDULE,
        message: "Meter set has been rescheduled more than once",
      });
    }
    const { record: updated } = await updateCoordinationRecordFields(supabase, {
      coordinationRecordId,
      fields: rescheduleDate ? { meter_set_scheduled_at: new Date(rescheduleDate).toISOString() } : {},
      metadataPatch: {
        uci_meter_set: {
          ...prior,
          no_show: true,
          reschedule_count: nextCount,
          last_outcome: outcome,
        },
      },
    });
    if (rescheduleDate) {
      await upsertMeterSetMilestone(supabase, {
        record: updated,
        scheduledDate: rescheduleDate,
        status: "scheduled",
      });
    } else {
      await upsertMeterSetMilestone(supabase, {
        record: updated,
        scheduledDate: record.meter_set_scheduled_at,
        status: "missed",
      });
    }
    void userId;
    return { recorded: true, outcome, reschedule_count: nextCount, stage_completed: false };
  }

  const err = new Error("outcome must be completed, no_show, or missed");
  err.statusCode = 400;
  err.code = "INVALID_OUTCOME";
  throw err;
}

/**
 * Human-only Stage 9 complete. Agent 11 never calls this automatically.
 */
async function completeStage9IfReady(supabase, params) {
  const { coordinationRecordId, userId } = params;
  const record = await loadRecord(supabase, coordinationRecordId);
  if (!record) {
    const err = new Error("Coordination record not found");
    err.statusCode = 404;
    err.code = "NOT_FOUND";
    throw err;
  }
  const milestones = await listMilestones(supabase, coordinationRecordId, String(record.project_id));
  if (!canCompleteStage9(record, milestones)) {
    const err = new Error(
      "Stage 9 cannot complete without inspection release, scheduled meter set, and site readiness",
    );
    err.statusCode = 409;
    err.code = "STAGE_9_INCOMPLETE";
    throw err;
  }
  return recordSystemTransition(supabase, {
    coordinationRecordId,
    toStage: 9,
    toState: "COMPLETED",
    reason: "Operator marked Stage 9 complete after meter-set predicates",
    triggeredByType: "user",
    triggeredById: userId,
  });
}

function meterSetStatus(record, milestones = []) {
  const gate = choreographyBlocked(record);
  if (gate.blocked) {
    return {
      status: gate.reason === "inspection_release_missing" ? "waiting_on_inspection_release" : "not_in_stage_9",
      reason: gate.reason,
      actions: gate.reason === "inspection_release_missing" ? ["record_inspection_release"] : [],
    };
  }
  if (!record.meter_set_scheduled_at) {
    return {
      status: "request_or_confirm_date",
      reason: "meter_set_unscheduled",
      actions: record.utility_contact_email ? ["request_meter_set", "confirm_date"] : ["add_utility_pm"],
    };
  }
  if (!record.site_readiness_confirmed_at) {
    return {
      status: "awaiting_site_readiness",
      reason: "checklist_pending",
      actions: record.site_contact_email ? ["confirm_site_readiness"] : ["add_site_contact"],
    };
  }
  const done = milestones.some((m) => m.milestone_type === "meter_set" && m.status === "completed");
  if (done && canCompleteStage9(record, milestones)) {
    return { status: "ready_to_complete_stage_9", reason: null, actions: ["complete_stage_9"] };
  }
  return { status: "meter_set_scheduled", reason: null, actions: ["record_outcome"] };
}

module.exports = {
  CHECKLIST_48H,
  choreographyBlocked,
  recordInspectionRelease,
  updateSiteContact,
  requestMeterSet,
  confirmMeterSetDate,
  send48hChecklist,
  sweep48hChecklists,
  confirmSiteReadiness,
  recordMeterSetOutcome,
  completeStage9IfReady,
  meterSetStatus,
  upsertMeterSetMilestone,
};
