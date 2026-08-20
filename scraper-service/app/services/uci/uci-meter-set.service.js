"use strict";

/**
 * Compatibility wrapper — product path is Agent 11 choreographer.
 * Prepare no longer starts choreography without Stage 9 + inspection release.
 */

const {
  confirmMeterSetDate,
  choreographyBlocked,
  CHECKLIST_48H,
} = require("./uci-meter-set-choreographer.service.js");
const { getCoordinationRecordById } = require("./uci-records.service.js");

const METER_SET_VERSION = "track-b-v1";
const DEFAULT_CHECKLIST = CHECKLIST_48H;

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

  const gate = choreographyBlocked(record);
  if (gate.blocked) {
    return {
      coordination_record_id: coordinationRecordId,
      started: false,
      ...gate,
      checklist: DEFAULT_CHECKLIST,
      stage_unchanged: true,
    };
  }

  if (scheduledDate) {
    const confirmed = await confirmMeterSetDate(supabase, {
      coordinationRecordId,
      scheduledDate,
      userId,
    });
    return {
      coordination_record_id: coordinationRecordId,
      milestone: confirmed.milestone,
      checklist: DEFAULT_CHECKLIST,
      stage_unchanged: true,
      version: METER_SET_VERSION,
    };
  }

  return {
    coordination_record_id: coordinationRecordId,
    checklist: DEFAULT_CHECKLIST,
    started: true,
    stage_unchanged: true,
    version: METER_SET_VERSION,
  };
}

module.exports = {
  METER_SET_VERSION,
  DEFAULT_CHECKLIST,
  prepareMeterSetChecklist,
};
