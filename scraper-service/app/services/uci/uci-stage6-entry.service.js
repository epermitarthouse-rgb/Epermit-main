"use strict";

/**
 * Stage 6 lifecycle entry + Stage 7 eligibility guard.
 * Portal status alone must never invent utility-issued COS values.
 */

const { canEnterStage6 } = require("./uci-stage5-entry.service.js");
const { recordSystemTransition } = require("./uci-transitions.service.js");
const { startCosSla } = require("./uci-cos-sla.service.js");
const {
  COS_TRIGGER_CLASSIFICATIONS,
  LOW_CONFIDENCE_THRESHOLD,
} = require("./uci-cos-constants.js");
const { emitUciEvent } = require("./uci-events.service.js");
const { isFlaggedForReview } = require("./uci-ack-acceptance.service.js");

/**
 * Stage 7 eligibility — Stage 6 COMPLETED + utility-issued COS evidence date.
 * Does not start Stage 7 product.
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

/**
 * Enter Stage 6 AWAITING_UTILITY (or keep IN_PROGRESS if already in Stage 6).
 * Starts COS SLA. Does not create utility-issued COS from portal status.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} params
 */
async function enterStage6(supabase, params) {
  const {
    coordinationRecordId,
    reason = "Stage 6 Class of Service / Design Review",
    triggeredByType = "system",
    triggeredById = null,
    initialState = "AWAITING_UTILITY",
    metadata = {},
  } = params;

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

  const stage = Number(record.current_stage);
  const state = String(record.current_stage_state);

  if (stage === 6) {
    const sla = await startCosSla(supabase, {
      coordinationRecordId,
      reason: "Stage 6 already active — ensure COS SLA",
    });
    return {
      entered: false,
      already_in_stage_6: true,
      coordination_record: sla.coordination_record || record,
      cos_sla: sla,
      can_enter_stage_7: canEnterStage7(sla.coordination_record || record),
    };
  }

  if (!canEnterStage6(record)) {
    const err = new Error(
      "Stage 6 requires Stage 5 COMPLETED with acknowledgment_received_at",
    );
    err.statusCode = 409;
    err.code = "STAGE_6_NOT_ELIGIBLE";
    throw err;
  }

  const toState = ["AWAITING_UTILITY", "IN_PROGRESS", "BLOCKED"].includes(String(initialState))
    ? String(initialState)
    : "AWAITING_UTILITY";

  const { record: updated, transition } = await recordSystemTransition(supabase, {
    coordinationRecordId,
    toStage: 6,
    toState,
    reason,
    triggeredByType,
    triggeredById,
    metadata: {
      action: "enter_stage_6",
      portal_status_alone_does_not_issue_cos: true,
      agent: "agent_6_cos_analyst",
      ...metadata,
    },
  });

  const sla = await startCosSla(supabase, {
    coordinationRecordId,
    reason,
  });

  emitUciEvent(
    "uci.stage6.entered",
    {
      coordination_record_id: coordinationRecordId,
      project_id: record.project_id,
      to_state: toState,
      transition_id: transition?.id ?? null,
    },
    { supabase },
  );

  return {
    entered: true,
    already_in_stage_6: false,
    coordination_record: sla.coordination_record || updated,
    transition,
    cos_sla: sla,
    can_enter_stage_7: false,
  };
}

/**
 * High-confidence COS/design classification → enter Stage 6 + kick analysis.
 * Never invents COS values from portal status alone.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} params
 * @param {Record<string, unknown>} params.communication
 * @param {Record<string, unknown>} [params.deps]
 */
async function maybeEnterStage6FromCommunication(supabase, params) {
  const { communication, deps = {} } = params;
  if (!communication?.coordination_record_id) {
    return { attempted: false, entered: false, reason: "unmatched" };
  }

  const classification = String(communication.classification || "");
  if (!COS_TRIGGER_CLASSIFICATIONS.includes(classification)) {
    return { attempted: false, entered: false, reason: "not_cos_or_design" };
  }

  const confidence = Number(communication.classification_confidence);
  if (!(confidence >= LOW_CONFIDENCE_THRESHOLD)) {
    return { attempted: true, entered: false, reason: "low_confidence" };
  }

  const meta =
    communication.agent_processed_metadata &&
    typeof communication.agent_processed_metadata === "object" &&
    !Array.isArray(communication.agent_processed_metadata)
      ? /** @type {Record<string, unknown>} */ (communication.agent_processed_metadata)
      : {};

  if (isFlaggedForReview(meta)) {
    return { attempted: true, entered: false, reason: "flagged_for_review" };
  }

  const { data: record } = await supabase
    .from("coordination_records")
    .select("*")
    .eq("id", String(communication.coordination_record_id))
    .maybeSingle();

  if (!record) {
    return { attempted: true, entered: false, reason: "record_not_found" };
  }

  if (Number(record.current_stage) === 6) {
    await startCosSla(supabase, {
      coordinationRecordId: String(record.id),
      reason: "COS/design communication while Stage 6 active",
    });
  } else if (canEnterStage6(record)) {
    await enterStage6(supabase, {
      coordinationRecordId: String(record.id),
      reason: `High-confidence ${classification} communication`,
      metadata: {
        source_communication_id: communication.id,
        classification,
        confidence,
      },
    });
  } else {
    return {
      attempted: true,
      entered: false,
      reason: "stage_5_not_completed",
      can_enter_stage_6: false,
    };
  }

  /** @type {Record<string, unknown> | null} */
  let analysis = null;
  if (deps.skipAnalysis !== true) {
    const { runCosDesignAnalysis } = require("./uci-cos-analyst.service.js");
    analysis = await runCosDesignAnalysis(supabase, {
      coordinationRecordId: String(communication.coordination_record_id),
      userId: null,
      communicationId: String(communication.id),
      triggeredBy: "classifier",
      deps,
    });
  }

  return {
    attempted: true,
    entered: true,
    reason: "cos_or_design_trigger",
    analysis,
    can_enter_stage_7: canEnterStage7(
      analysis?.coordination_record || record,
    ),
  };
}

module.exports = {
  canEnterStage6,
  canEnterStage7,
  enterStage6,
  maybeEnterStage6FromCommunication,
};
