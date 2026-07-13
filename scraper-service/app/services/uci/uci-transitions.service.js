"use strict";

const VALID_STATES = new Set([
  "NOT_STARTED",
  "IN_PROGRESS",
  "AWAITING_UTILITY",
  "BLOCKED",
  "ESCALATED",
  "COMPLETED",
]);

/**
 * @param {unknown} n
 * @returns {boolean}
 */
function isValidStage(n) {
  const x = Number(n);
  return Number.isInteger(x) && x >= 1 && x <= 10;
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} p
 * @param {string} p.coordinationRecordId
 * @param {string} p.userId
 * @param {number} p.toStage
 * @param {string} p.toState
 * @param {string} [p.reason]
 * @returns {Promise<{ record: Record<string, unknown>, transition: Record<string, unknown> }>}
 */
async function recordUserTransition(supabase, p) {
  const {
    coordinationRecordId,
    userId,
    toStage,
    toState,
    reason = null,
  } = p;

  if (!isValidStage(toStage)) {
    const err = new Error("to_stage must be an integer from 1 to 10");
    err.statusCode = 400;
    err.code = "INVALID_STAGE";
    throw err;
  }

  const stateStr = String(toState ?? "").trim();
  if (!VALID_STATES.has(stateStr)) {
    const err = new Error("Invalid to_state value");
    err.statusCode = 400;
    err.code = "INVALID_STATE";
    throw err;
  }

  const { data: current, error: fetchErr } = await supabase
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

  if (!current) {
    const err = new Error("Coordination record not found");
    err.statusCode = 404;
    err.code = "NOT_FOUND";
    throw err;
  }

  const projectId = String(current.project_id);
  const fromStage =
    current.current_stage != null ? Number(current.current_stage) : null;
  const fromState =
    current.current_stage_state != null
      ? String(current.current_stage_state)
      : null;

  const transitionRow = {
    coordination_record_id: coordinationRecordId,
    project_id: projectId,
    from_stage: Number.isFinite(fromStage) ? fromStage : null,
    to_stage: toStage,
    from_state: VALID_STATES.has(fromState) ? fromState : null,
    to_state: stateStr,
    triggered_by_type: "user",
    triggered_by_id: userId,
    reason: typeof reason === "string" && reason.trim() ? reason.trim() : null,
    metadata: {},
  };

  const { data: transition, error: tErr } = await supabase
    .from("coordination_stage_transitions")
    .insert(transitionRow)
    .select("*")
    .single();

  if (tErr) {
    throw Object.assign(new Error(tErr.message || "Failed to record transition"), {
      cause: tErr,
      statusCode: 500,
      code: "TRANSITION_INSERT_FAILED",
    });
  }

  const { data: updated, error: uErr } = await supabase
    .from("coordination_records")
    .update({
      current_stage: toStage,
      current_stage_state: stateStr,
    })
    .eq("id", coordinationRecordId)
    .eq("project_id", projectId)
    .select("*")
    .single();

  if (uErr) {
    throw Object.assign(new Error(uErr.message || "Failed to update coordination record"), {
      cause: uErr,
      statusCode: 500,
      code: "COORDINATION_UPDATE_FAILED",
    });
  }

  return { record: updated, transition };
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} p
 * @param {string} p.coordinationRecordId
 * @param {number} p.toStage
 * @param {string} p.toState
 * @param {string} p.reason
 * @param {string} [p.triggeredByType]
 * @param {string | null} [p.triggeredById]
 * @param {Record<string, unknown>} [p.metadata]
 * @returns {Promise<{ record: Record<string, unknown>, transition: Record<string, unknown> }>}
 */
async function recordSystemTransition(supabase, p) {
  const {
    coordinationRecordId,
    toStage,
    toState,
    reason,
    triggeredByType = "system",
    triggeredById = null,
    metadata = {},
  } = p;

  if (!isValidStage(toStage)) {
    const err = new Error("to_stage must be an integer from 1 to 10");
    err.statusCode = 400;
    err.code = "INVALID_STAGE";
    throw err;
  }

  const stateStr = String(toState ?? "").trim();
  if (!VALID_STATES.has(stateStr)) {
    const err = new Error("Invalid to_state value");
    err.statusCode = 400;
    err.code = "INVALID_STATE";
    throw err;
  }

  const { data: current, error: fetchErr } = await supabase
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

  if (!current) {
    const err = new Error("Coordination record not found");
    err.statusCode = 404;
    err.code = "NOT_FOUND";
    throw err;
  }

  const projectId = String(current.project_id);
  const fromStage =
    current.current_stage != null ? Number(current.current_stage) : null;
  const fromState =
    current.current_stage_state != null
      ? String(current.current_stage_state)
      : null;

  const transitionRow = {
    coordination_record_id: coordinationRecordId,
    project_id: projectId,
    from_stage: Number.isFinite(fromStage) ? fromStage : null,
    to_stage: toStage,
    from_state: VALID_STATES.has(fromState) ? fromState : null,
    to_state: stateStr,
    triggered_by_type: triggeredByType,
    triggered_by_id: triggeredById,
    reason: typeof reason === "string" && reason.trim() ? reason.trim() : null,
    metadata: metadata && typeof metadata === "object" ? metadata : {},
  };

  const { data: transition, error: tErr } = await supabase
    .from("coordination_stage_transitions")
    .insert(transitionRow)
    .select("*")
    .single();

  if (tErr) {
    throw Object.assign(new Error(tErr.message || "Failed to record transition"), {
      cause: tErr,
      statusCode: 500,
      code: "TRANSITION_INSERT_FAILED",
    });
  }

  const { data: updated, error: uErr } = await supabase
    .from("coordination_records")
    .update({
      current_stage: toStage,
      current_stage_state: stateStr,
    })
    .eq("id", coordinationRecordId)
    .eq("project_id", projectId)
    .select("*")
    .single();

  if (uErr) {
    throw Object.assign(new Error(uErr.message || "Failed to update coordination record"), {
      cause: uErr,
      statusCode: 500,
      code: "COORDINATION_UPDATE_FAILED",
    });
  }

  return { record: updated, transition };
}

module.exports = {
  recordUserTransition,
  recordSystemTransition,
  VALID_STATES,
  isValidStage,
};
