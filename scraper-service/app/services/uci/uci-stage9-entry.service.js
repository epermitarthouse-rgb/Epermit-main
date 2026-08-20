"use strict";

/**
 * Stage 9 lifecycle entry — explicit operator gate after Stage 8 COMPLETED.
 * Uses recordUserTransition; explicit operator entry persists Stage 9 / IN_PROGRESS.
 */

const { canEnterStage9 } = require("./uci-lifecycle-guards.service.js");
const { recordUserTransition } = require("./uci-transitions.service.js");

async function loadRecord(supabase, coordinationRecordId) {
  const { data, error } = await supabase
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
  return data || null;
}

async function loadEquipment(supabase, record) {
  const { data } = await supabase
    .from("coordination_equipment")
    .select("*")
    .eq("coordination_record_id", String(record.id))
    .eq("project_id", String(record.project_id));
  return Array.isArray(data) ? data : [];
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} params
 * @param {string} params.coordinationRecordId
 * @param {string | null} [params.userId]
 * @param {string} [params.reason]
 */
async function enterStage9(supabase, params) {
  const {
    coordinationRecordId,
    userId = null,
    reason = "Operator started Stage 9 — pre-energization coordination",
  } = params;

  const record = await loadRecord(supabase, coordinationRecordId);
  if (!record) {
    const err = new Error("Coordination record not found");
    err.statusCode = 404;
    err.code = "NOT_FOUND";
    throw err;
  }

  const stage = Number(record.current_stage);
  if (stage === 9) {
    return {
      entered: false,
      already_in_stage_9: true,
      record,
    };
  }

  const equipment = await loadEquipment(supabase, record);
  if (!canEnterStage9(record, equipment)) {
    const err = new Error("Stage 9 requires Stage 8 COMPLETED with tracked equipment ETAs");
    err.statusCode = 409;
    err.code = "STAGE_9_NOT_ELIGIBLE";
    throw err;
  }

  const transition = await recordUserTransition(supabase, {
    coordinationRecordId,
    userId: userId || "system",
    toStage: 9,
    toState: "IN_PROGRESS",
    reason,
    metadata: {
      action: "enter_stage_9",
      human_gated: true,
    },
  });

  const updatedStage = Number(transition.record?.current_stage);
  const updatedState = String(transition.record?.current_stage_state || "");
  if (updatedStage !== 9 || updatedState !== "IN_PROGRESS") {
    const err = new Error(
      `Stage 9 entry did not persist (stage=${updatedStage}, state=${updatedState || "unknown"})`,
    );
    err.statusCode = 500;
    err.code = "STAGE_9_ENTRY_NOT_PERSISTED";
    throw err;
  }

  return {
    entered: true,
    already_in_stage_9: false,
    ...transition,
  };
}

module.exports = {
  enterStage9,
};
