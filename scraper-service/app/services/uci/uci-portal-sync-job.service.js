"use strict";

const {
  isUciDurableJobsEnabled,
  enqueueOrGetUciPortalSyncJob,
  cancelUciPortalSyncJob,
  findActiveUciPortalSyncJobForCoordination,
  UCI_PORTAL_SYNC_JOB_TYPE,
} = require("./uci-portal-sync-job-store.js");
const { publishUciPortalSyncJobProgress } = require("./uci-job-progress.js");
const { runPortalSync } = require("./uci-portal-sync.service.js");

/**
 * @param {Record<string, unknown>} job
 * @returns {Record<string, unknown>}
 */
function mapJobToSyncRunResponse(job) {
  const metadata =
    job.metadata && typeof job.metadata === "object" && !Array.isArray(job.metadata)
      ? /** @type {Record<string, unknown>} */ (job.metadata)
      : {};
  const uci =
    metadata.uci && typeof metadata.uci === "object" && !Array.isArray(metadata.uci)
      ? /** @type {Record<string, unknown>} */ (metadata.uci)
      : {};

  return {
    id: job.id,
    jobType: job.job_type || UCI_PORTAL_SYNC_JOB_TYPE,
    coordinationRecordId: job.coordination_record_id,
    projectId: job.project_id,
    providerSlug: metadata.provider_slug || job.portal_type || null,
    status: job.status,
    phase: job.phase,
    currentStage: job.current_stage,
    currentUserMessage: job.current_user_message,
    progressCurrent: job.progress_current,
    progressTotal: job.progress_total,
    attemptCount: job.attempt_count,
    nextAttemptAt: job.next_attempt_at,
    errorCode: job.error_code,
    errorUserMessage: job.error_user_message,
    createdAt: job.created_at,
    updatedAt: job.updated_at,
    startedAt: job.started_at,
    completedAt: job.completed_at,
    cancelledAt: job.cancelled_at,
    lastSyncSummary: uci.last_sync_summary || null,
    pepcoMfaSessionId: uci.pepco_mfa_session_id || null,
    awaitingHumanReason: uci.awaiting_human_reason || null,
  };
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} opts
 * @param {string} opts.projectId
 * @param {string} opts.userId
 * @param {string} opts.coordinationRecordId
 * @param {string} [opts.providerSlug]
 * @returns {Promise<{ mode: "durable", job: Record<string, unknown>, reusedExisting: boolean }>}
 */
async function enqueuePortalSyncJob(supabase, opts) {
  const { job, reusedExisting } = await enqueueOrGetUciPortalSyncJob(supabase, opts);

  if (!reusedExisting) {
    await publishUciPortalSyncJobProgress(supabase, {
      jobId: String(job.id),
      projectId: opts.projectId,
      stage: "queued",
      status: "queued",
      userMessage: reusedExisting ? "Reusing active portal sync job." : "Portal sync queued.",
      progressCurrent: 0,
      progressTotal: 5,
      eventType: reusedExisting ? "job_reused" : "job_queued",
      forceFeed: true,
    });
  }

  return {
    mode: "durable",
    job: mapJobToSyncRunResponse(job),
    reusedExisting,
  };
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} opts
 * @param {string} opts.coordinationRecordId
 * @param {string} opts.projectId
 * @param {string} [opts.providerSlug]
 * @param {number} [opts.limit]
 * @returns {Promise<{ runs: Record<string, unknown>[], total: number }>}
 */
async function listPortalSyncRuns(supabase, opts) {
  const limit = Math.min(Math.max(Number(opts.limit) || 20, 1), 100);
  let query = supabase
    .from("scrape_jobs")
    .select("*", { count: "exact" })
    .eq("job_type", UCI_PORTAL_SYNC_JOB_TYPE)
    .eq("coordination_record_id", opts.coordinationRecordId)
    .eq("project_id", opts.projectId)
    .order("created_at", { ascending: false })
    .limit(limit);

  const slug = String(opts.providerSlug || "").trim().toLowerCase();
  if (slug) {
    query = query.or(`portal_type.eq.${slug},metadata->>provider_slug.eq.${slug}`);
  }

  const { data, error, count } = await query;
  if (error) throw error;
  const runs = Array.isArray(data) ? data.map(mapJobToSyncRunResponse) : [];
  return { runs, total: count ?? runs.length };
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} opts
 * @param {string} opts.jobId
 * @param {string} opts.projectId
 * @param {string} opts.coordinationRecordId
 * @returns {Promise<Record<string, unknown> | null>}
 */
async function getPortalSyncRun(supabase, opts) {
  const { data, error } = await supabase
    .from("scrape_jobs")
    .select("*")
    .eq("id", opts.jobId)
    .eq("job_type", UCI_PORTAL_SYNC_JOB_TYPE)
    .eq("project_id", opts.projectId)
    .eq("coordination_record_id", opts.coordinationRecordId)
    .maybeSingle();
  if (error) throw error;
  return data ? mapJobToSyncRunResponse(data) : null;
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} opts
 * @param {string} opts.coordinationRecordId
 * @param {string} [opts.providerSlug]
 * @param {string} [opts.providerSlugFromRecord]
 * @returns {Promise<Record<string, unknown>>}
 */
async function runPortalSyncWithMode(supabase, opts) {
  if (!isUciDurableJobsEnabled()) {
    const summary = await runPortalSync(supabase, {
      coordinationRecordId: opts.coordinationRecordId,
      providerSlug: opts.providerSlug,
    });
    return { mode: "sync", summary };
  }

  const durable = await enqueuePortalSyncJob(supabase, {
    projectId: opts.projectId,
    userId: opts.userId,
    coordinationRecordId: opts.coordinationRecordId,
    providerSlug: opts.providerSlug || opts.providerSlugFromRecord || "",
  });

  return {
    mode: "durable",
    job: durable.job,
    reusedExisting: durable.reusedExisting,
  };
}

async function cancelPortalSyncRun(supabase, opts) {
  const job = await cancelUciPortalSyncJob(supabase, opts);
  return job ? mapJobToSyncRunResponse(job) : null;
}

module.exports = {
  isUciDurableJobsEnabled,
  mapJobToSyncRunResponse,
  enqueuePortalSyncJob,
  listPortalSyncRuns,
  getPortalSyncRun,
  cancelPortalSyncRun,
  findActiveUciPortalSyncJobForCoordination,
  runPortalSyncWithMode,
};
