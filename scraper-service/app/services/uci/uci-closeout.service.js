"use strict";

const { getCoordinationRecordById } = require("./uci-records.service.js");

const CLOSEOUT_VERSION = "d10-v1";

const CLOSEOUT_CHECKLIST = Object.freeze([
  "utility_energization_confirmed",
  "final_invoices_reconciled",
  "equipment_records_complete",
  "communications_archived",
  "closeout_documents_uploaded",
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

  const projectId = String(record.project_id);
  const generatedAt = new Date().toISOString();

  const existingMetadata =
    record.metadata && typeof record.metadata === "object" && !Array.isArray(record.metadata)
      ? /** @type {Record<string, unknown>} */ (record.metadata)
      : {};

  const closeout = {
    version: CLOSEOUT_VERSION,
    checklist: CLOSEOUT_CHECKLIST.map((key) => ({ key, completed: false })),
    generated_at: generatedAt,
    generated_by_user_id: userId,
    requires_human_review: true,
    notes: ["D10 foundation — closeout package metadata only; PDF generation deferred"],
  };

  const { data: updated, error } = await supabase
    .from("coordination_records")
    .update({
      metadata: {
        ...existingMetadata,
        uci_closeout_package: closeout,
      },
    })
    .eq("id", coordinationRecordId)
    .eq("project_id", projectId)
    .select("*")
    .single();

  if (error) {
    throw Object.assign(new Error(error.message || "Failed to prepare closeout package"), {
      statusCode: 500,
      code: "CLOSEOUT_UPDATE_FAILED",
    });
  }

  return {
    coordination_record_id: coordinationRecordId,
    closeout,
    record: updated,
    stage_unchanged: true,
  };
}

module.exports = {
  CLOSEOUT_VERSION,
  CLOSEOUT_CHECKLIST,
  prepareCloseoutPackage,
};
