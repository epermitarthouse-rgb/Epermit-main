"use strict";

const APPLICATION_PACKAGE_IDEMPOTENCY_KEY = "agent_3_application_package:d3-v1";
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
 * @param {Record<string, unknown>} [p.metadata]
 * @returns {Promise<{ record: Record<string, unknown>, transition: Record<string, unknown> }>}
 */
async function recordUserTransition(supabase, p) {
  const {
    coordinationRecordId,
    userId,
    toStage,
    toState,
    reason = null,
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
    triggered_by_type: "user",
    triggered_by_id: userId,
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

/**
 * Explicit human gate between engineering review and application preparation.
 * A reviewed/ready Agent 3 package closes Stage 3; otherwise Stage 3 starts in progress.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} p
 * @param {string} p.coordinationRecordId
 * @param {string} p.userId
 * @param {string} p.reason
 * @returns {Promise<{ record: Record<string, unknown>, transition: Record<string, unknown>, stage3Completed: boolean, application: Record<string, unknown> | null }>}
 */
async function completeStage2EngineeringReview(supabase, p) {
  const { coordinationRecordId, userId, reason } = p;
  const { data: current, error: recordError } = await supabase
    .from("coordination_records")
    .select("*")
    .eq("id", coordinationRecordId)
    .maybeSingle();

  if (recordError) {
    throw Object.assign(new Error(recordError.message || "Failed to load coordination record"), {
      cause: recordError,
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
  if (
    Number(current.current_stage) !== 2 ||
    String(current.current_stage_state) !== "IN_PROGRESS"
  ) {
    const err = new Error("Stage 2 must be active before engineering review can be completed");
    err.statusCode = 409;
    err.code = "STAGE_2_NOT_ACTIVE";
    throw err;
  }

  const projectId = String(current.project_id);
  const { data: application, error: applicationError } = await supabase
    .from("coordination_applications")
    .select("*")
    .eq("coordination_record_id", coordinationRecordId)
    .eq("project_id", projectId)
    .eq("record_source", "agent_draft")
    .eq("idempotency_key", APPLICATION_PACKAGE_IDEMPOTENCY_KEY)
    .maybeSingle();

  if (applicationError) {
    throw Object.assign(
      new Error(applicationError.message || "Failed to load application package"),
      {
        cause: applicationError,
        statusCode: 500,
        code: "APPLICATION_FETCH_FAILED",
      },
    );
  }

  const packageMetadata =
    application?.agent_draft_metadata?.application_package &&
    typeof application.agent_draft_metadata.application_package === "object"
      ? application.agent_draft_metadata.application_package
      : {};
  // Final lifecycle disposition must use the same computed gate returned to
  // Agent 3 clients; persisted draft/package labels alone can become stale.
  const packageReviewSummary = application
    ? require("./uci-package-review.service.js").summarizePackageReview(application)
    : null;
  const stage3Completed =
    packageReviewSummary?.status === "reviewed" &&
    packageReviewSummary?.ready_for_final_review === true &&
    Boolean(packageReviewSummary?.reviewed_snapshot);
  const toState = stage3Completed ? "COMPLETED" : "IN_PROGRESS";

  const result = await recordUserTransition(supabase, {
    coordinationRecordId,
    userId,
    toStage: 3,
    toState,
    reason,
    metadata: {
      action: "complete_stage_2_engineering_review",
      human_gated: true,
      stage_2_completed: true,
      stage_3_disposition: toState,
      application_id: application?.id ?? null,
      package_reviewed: String(application?.draft_status ?? "") === "reviewed",
      package_status: packageMetadata.package_status ?? null,
      package_review_summary: packageReviewSummary,
      synthetic_data_auto_advanced: false,
    },
  });

  return { ...result, stage3Completed, application: application ?? null };
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
  completeStage2EngineeringReview,
  VALID_STATES,
  isValidStage,
};
