"use strict";

const { sanitizeApplicationRowsForApi } = require("./uci-sync-utils.js");

const DETAIL_APPLICATION_BASE_SELECT = `
  id,
  coordination_record_id,
  project_id,
  tenant_id,
  application_type,
  package_documents,
  submission_method,
  utility_ticket_number,
  submitted_at,
  submitted_by,
  reviewed_by,
  reviewed_at,
  draft_status,
  agent_draft_metadata,
  idempotency_key,
  last_error,
  created_at,
  updated_at,
  provider_slug,
  external_application_id,
  external_job_id,
  portal_status,
  portal_milestone,
  portal_last_updated_at,
  portal_submitted_at,
  action_required,
  last_synced_at,
  record_source,
  metadata
`;

/**
 * Attach the canonical, computed review gate to Agent 3 API rows. This value is
 * intentionally derived at read time so mapping or signature changes cannot
 * leave a persisted readiness flag stale.
 *
 * @param {Array<Record<string, unknown>>} rows
 * @returns {Array<Record<string, unknown>>}
 */
function withPackageReviewSummaries(rows) {
  // Lazy require avoids the builder -> records -> applications dependency cycle.
  const { summarizePackageReview } = require("./uci-package-review.service.js");
  return rows.map((row) => {
    if (
      String(row.record_source ?? "") !== "agent_draft" ||
      String(row.idempotency_key ?? "") !== "agent_3_application_package:d3-v1"
    ) {
      return row;
    }
    return {
      ...row,
      package_review_summary: summarizePackageReview(row),
    };
  });
}

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
  const sanitized = opts.sanitize === false ? rows : sanitizeApplicationRowsForApi(rows);
  return withPackageReviewSummaries(sanitized);
}

/**
 * Coordination detail only needs the large load_summary JSON for the Agent 2
 * load-profile draft. Agent 3 rows intentionally snapshot those values in
 * agent_draft_metadata, so selecting every row's duplicate load_summary makes
 * ordinary page-open reads needlessly expensive.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} coordinationRecordId
 * @param {string} projectId
 * @returns {Promise<Array<Record<string, unknown>>>}
 */
async function listApplicationsForCoordinationDetail(
  supabase,
  coordinationRecordId,
  projectId,
) {
  const baseQuery = supabase
    .from("coordination_applications")
    .select(DETAIL_APPLICATION_BASE_SELECT)
    .eq("coordination_record_id", coordinationRecordId)
    .eq("project_id", projectId)
    .order("last_synced_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });
  const loadSummaryQuery = supabase
    .from("coordination_applications")
    .select("id, load_summary")
    .eq("coordination_record_id", coordinationRecordId)
    .eq("project_id", projectId)
    .like("idempotency_key", "agent_2_load_profile:%");

  const [baseResult, loadSummaryResult] = await Promise.all([
    baseQuery,
    loadSummaryQuery,
  ]);
  if (baseResult.error) {
    throw Object.assign(
      new Error(baseResult.error.message || "Failed to load applications"),
      {
        cause: baseResult.error,
        statusCode: 500,
        code: "APPLICATIONS_FETCH_FAILED",
      },
    );
  }
  if (loadSummaryResult.error) {
    throw Object.assign(
      new Error(loadSummaryResult.error.message || "Failed to load load profile"),
      {
        cause: loadSummaryResult.error,
        statusCode: 500,
        code: "LOAD_PROFILE_FETCH_FAILED",
      },
    );
  }

  const summariesById = new Map(
    (loadSummaryResult.data ?? []).map((row) => [String(row.id), row.load_summary ?? {}]),
  );
  return withPackageReviewSummaries(sanitizeApplicationRowsForApi(
    (baseResult.data ?? []).map((row) => ({
      ...row,
      load_summary: summariesById.get(String(row.id)) ?? {},
    })),
  ));
}

module.exports = {
  listApplicationsByCoordination,
  listApplicationsForCoordinationDetail,
};
