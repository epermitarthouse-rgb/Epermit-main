"use strict";

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} coordinationRecordId
 * @param {string} projectId
 * @returns {Promise<Array<Record<string, unknown>>>}
 */
async function listApplicationsByCoordination(
  supabase,
  coordinationRecordId,
  projectId,
) {
  const { data, error } = await supabase
    .from("coordination_applications")
    .select("*")
    .eq("coordination_record_id", coordinationRecordId)
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });

  if (error) {
    throw Object.assign(new Error(error.message || "Failed to load applications"), {
      cause: error,
      statusCode: 500,
      code: "APPLICATIONS_FETCH_FAILED",
    });
  }

  return Array.isArray(data) ? data : [];
}

module.exports = {
  listApplicationsByCoordination,
};
