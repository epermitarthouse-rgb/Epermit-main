"use strict";

/**
 * Compatibility wrapper — product path is Agent 12 energization closeout.
 */

const {
  generateAndArchiveCloseout,
  closeoutStatus,
  loadBundle,
} = require("./uci-energization-closeout.service.js");
const { getCoordinationRecordById } = require("./uci-records.service.js");

const CLOSEOUT_VERSION = "track-b-v1";
const CLOSEOUT_CHECKLIST = Object.freeze([
  "utility_confirmation",
  "final_meter_reading",
  "commissioning_signoff",
  "closeout_pdf",
  "paid_receipts",
]);

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} params
 */
async function prepareCloseoutPackage(supabase, params) {
  const { coordinationRecordId, userId } = params;
  const record = await getCoordinationRecordById(supabase, coordinationRecordId);
  if (!record) {
    const err = new Error("Coordination record not found");
    err.statusCode = 404;
    err.code = "NOT_FOUND";
    throw err;
  }
  const bundle = await loadBundle(supabase, record);
  const status = closeoutStatus(record, bundle.costs);
  if (status.status === "ready_to_generate_pdf" || status.status === "ready_to_complete_stage_10") {
    try {
      const generated = await generateAndArchiveCloseout(supabase, {
        coordinationRecordId,
        userId,
      });
      return {
        coordination_record_id: coordinationRecordId,
        closeout: generated.pdf,
        record: generated.record,
        stage_unchanged: true,
        version: CLOSEOUT_VERSION,
      };
    } catch (err) {
      if (err && err.code === "CLOSEOUT_HARD_BLOCK") {
        return {
          coordination_record_id: coordinationRecordId,
          blocked: true,
          missing: err.missing,
          status,
          stage_unchanged: true,
          version: CLOSEOUT_VERSION,
        };
      }
      throw err;
    }
  }
  return {
    coordination_record_id: coordinationRecordId,
    closeout: { version: CLOSEOUT_VERSION, checklist: CLOSEOUT_CHECKLIST, status },
    record,
    stage_unchanged: true,
  };
}

module.exports = {
  CLOSEOUT_VERSION,
  CLOSEOUT_CHECKLIST,
  prepareCloseoutPackage,
};
