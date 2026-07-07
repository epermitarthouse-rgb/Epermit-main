"use strict";

const { sanitizeApplicationRowsForApi } = require("./uci-sync-utils.js");

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} coordinationRecordId
 * @param {string} projectId
 * @param {{ sanitize?: boolean }} [opts]
 * @returns {Promise<Array<Record<string, unknown>>>}
 */
async function listApplicationsByCoordination(
  supabase,
  coordinationRecordId,
  projectId,
  opts = {},
) {
  const { data, error } = await supabase
    .from("coordination_applications")
    .select("*")
    .eq("coordination_record_id", coordinationRecordId)
    .eq("project_id", projectId)
    .order("last_synced_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });

  if (error) {
    throw Object.assign(new Error(error.message || "Failed to load applications"), {
      cause: error,
      statusCode: 500,
      code: "APPLICATIONS_FETCH_FAILED",
    });
  }

  const rows = Array.isArray(data) ? data : [];
  return opts.sanitize === false ? rows : sanitizeApplicationRowsForApi(rows);
}

module.exports = {
  listApplicationsByCoordination,
};
