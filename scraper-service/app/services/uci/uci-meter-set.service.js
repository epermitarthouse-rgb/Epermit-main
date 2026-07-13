"use strict";

const { getCoordinationRecordById } = require("./uci-records.service.js");

const METER_SET_VERSION = "d9-v1";

const DEFAULT_CHECKLIST = Object.freeze([
  "confirm_meter_set_date_with_utility",
  "verify_site_access_and_contact",
  "confirm_equipment_installed",
  "confirm_inspection_release_if_required",
  "capture_utility_confirmation",
]);

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} params
 */
async function prepareMeterSetChecklist(supabase, params) {
  const { coordinationRecordId, userId, scheduledDate } = params;

  const record = await getCoordinationRecordById(supabase, coordinationRecordId);
  if (!record) {
    const err = new Error("Coordination record not found");
    err.statusCode = 404;
    err.code = "NOT_FOUND";
    throw err;
  }

  const projectId = String(record.project_id);
  const generatedAt = new Date().toISOString();

  const milestoneRow = {
    coordination_record_id: coordinationRecordId,
    project_id: projectId,
    milestone_type: "meter_set_scheduled",
    parent_stage: 9,
    target_date: scheduledDate ?? null,
    status: "scheduled",
    notes: "D9 foundation — 48h pre-meter-set checklist (human completion required)",
    source: "agent_draft",
    idempotency_key: `meter_set_checklist:${coordinationRecordId}`,
    metadata: {
      version: METER_SET_VERSION,
      checklist: DEFAULT_CHECKLIST.map((item) => ({ key: item, completed: false })),
      generated_at: generatedAt,
      generated_by_user_id: userId,
      requires_human_review: true,
    },
  };

  const { data: existing } = await supabase
    .from("coordination_milestones")
    .select("id")
    .eq("coordination_record_id", coordinationRecordId)
    .eq("idempotency_key", milestoneRow.idempotency_key)
    .maybeSingle();

  /** @type {Record<string, unknown>} */
  let milestone;
  if (existing?.id) {
    const { data, error } = await supabase
      .from("coordination_milestones")
      .update(milestoneRow)
      .eq("id", existing.id)
      .select("*")
      .single();
    if (error) throw Object.assign(new Error(error.message), { statusCode: 500 });
    milestone = data;
  } else {
    const { data, error } = await supabase
      .from("coordination_milestones")
      .insert(milestoneRow)
      .select("*")
      .single();
    if (error) throw Object.assign(new Error(error.message), { statusCode: 500 });
    milestone = data;
  }

  return {
    coordination_record_id: coordinationRecordId,
    milestone,
    checklist: DEFAULT_CHECKLIST,
    stage_unchanged: true,
  };
}

module.exports = {
  METER_SET_VERSION,
  DEFAULT_CHECKLIST,
  prepareMeterSetChecklist,
};
