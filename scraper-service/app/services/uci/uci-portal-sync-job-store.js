"use strict";

const UCI_PORTAL_SYNC_JOB_TYPE = "uci_portal_sync";
const UCI_JURISDICTION = "UCI";

const TERMINAL_STATUSES = new Set([
  "completed",
  "completed_with_warnings",
  "failed",
  "failed_unrecoverable",
  "cancelled",
]);

const WORKER_POLLABLE = new Set(["queued", "running", "partial"]);

const MAX_RETRY_ATTEMPTS = 5;
const RETRY_DELAY_MS = 60_000;

/**
 * @returns {boolean}
 */
function isUciDurableJobsEnabled() {
  return process.env.UCI_DURABLE_JOBS_ENABLED === "true";
}

/**
 * @param {unknown} job
 * @returns {boolean}
 */
function isUciPortalSyncJobCancelled(job) {
  if (!job) return false;
  const status = `${job.status || ""}`.toLowerCase();
  if (status === "cancelled" || status === "cancelling") return true;
  const uci =
    job?.metadata?.uci && typeof job.metadata.uci === "object"
      ? /** @type {Record<string, unknown>} */ (job.metadata.uci)
      : null;
  return `${uci?.terminal_reason || ""}` === "user_cancelled";
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} jobId
 * @returns {Promise<boolean>}
 */
async function pollUciPortalSyncJobCancelled(supabase, jobId) {
  if (!jobId) return false;
  const { data, error } = await supabase
    .from("scrape_jobs")
    .select("id, status, completed_at, metadata")
    .eq("id", jobId)
    .maybeSingle();
  if (error) throw error;
  return isUciPortalSyncJobCancelled(data);
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} opts
 * @param {string} opts.projectId
 * @param {string} opts.userId
 * @param {string} opts.coordinationRecordId
 * @param {string} [opts.providerSlug]
 * @param {Record<string, unknown>} [opts.requestedScope]
 * @returns {Promise<{ job: Record<string, unknown>, reusedExisting: boolean }>}
 */
async function enqueueOrGetUciPortalSyncJob(supabase, opts) {
  const { data, error } = await supabase.rpc("enqueue_or_get_uci_portal_sync_job", {
    p_project_id: opts.projectId,
    p_user_id: opts.userId,
    p_coordination_record_id: opts.coordinationRecordId,
    p_provider_slug: opts.providerSlug || "",
    p_requested_scope: opts.requestedScope || {},
  });
  if (error) throw error;

  const row = Array.isArray(data) ? data[0] : data;
  const job = row?.job ?? row;
  const reusedExisting = Boolean(row?.reused_existing ?? row?.reusedExisting);
  return { job, reusedExisting };
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} workerId
 * @param {number} [leaseTtlSeconds]
 * @returns {Promise<Record<string, unknown> | null>}
 */
async function claimUciPortalSyncJobViaRpc(supabase, workerId, leaseTtlSeconds = 180) {
  const { data, error } = await supabase.rpc("claim_uci_portal_sync_job", {
    p_worker_id: workerId,
    p_lease_ttl_seconds: leaseTtlSeconds,
  });
  if (error) throw error;
  return data || null;
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} jobId
 * @param {string} workerId
 * @param {number} [leaseTtlSeconds]
 * @returns {Promise<boolean>}
 */
async function heartbeatUciPortalSyncJobLease(
  supabase,
  jobId,
  workerId,
  leaseTtlSeconds = 180,
) {
  const { data, error } = await supabase.rpc("heartbeat_uci_portal_sync_job_lease", {
    p_job_id: jobId,
    p_worker_id: workerId,
    p_lease_ttl_seconds: leaseTtlSeconds,
  });
  if (error) throw error;
  return Boolean(data);
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} jobId
 * @param {string} workerId
 * @param {Record<string, unknown>} [patch]
 * @returns {Promise<Record<string, unknown> | null>}
 */
async function releaseUciPortalSyncJobLease(supabase, jobId, workerId, patch = {}) {
  const { data, error } = await supabase.rpc("release_uci_portal_sync_job_lease", {
    p_job_id: jobId,
    p_worker_id: workerId,
    p_next_attempt_at: patch.next_attempt_at ?? null,
    p_status: patch.status ?? null,
    p_phase: patch.phase ?? null,
    p_attempt_count: patch.attempt_count ?? null,
    p_last_error: patch.last_error ?? null,
    p_completed_at: patch.completed_at ?? null,
    p_current_stage: patch.current_stage ?? null,
    p_current_user_message: patch.current_user_message ?? null,
    p_error_code: patch.error_code ?? null,
    p_error_user_message: patch.error_user_message ?? null,
  });
  if (error) throw error;
  return data || null;
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} opts
 * @param {string} opts.jobId
 * @param {string} opts.projectId
 * @param {string} [opts.userId]
 * @returns {Promise<Record<string, unknown> | null>}
 */
async function cancelUciPortalSyncJob(supabase, opts) {
  const { data, error } = await supabase.rpc("cancel_uci_portal_sync_job", {
    p_job_id: opts.jobId,
    p_project_id: opts.projectId,
    p_user_id: opts.userId || null,
  });
  if (error) throw error;
  return data || null;
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} coordinationRecordId
 * @param {string} [providerSlug]
 * @returns {Promise<Record<string, unknown> | null>}
 */
async function findActiveUciPortalSyncJobForCoordination(
  supabase,
  coordinationRecordId,
  providerSlug,
) {
  let query = supabase
    .from("scrape_jobs")
    .select("*")
    .eq("job_type", UCI_PORTAL_SYNC_JOB_TYPE)
    .eq("coordination_record_id", coordinationRecordId)
    .is("completed_at", null)
    .not(
      "status",
      "in",
      "(completed,completed_with_warnings,failed,failed_unrecoverable,cancelled)",
    )
    .order("created_at", { ascending: false })
    .limit(1);

  const slug = String(providerSlug || "").trim().toLowerCase();
  if (slug) {
    query = query.or(`portal_type.eq.${slug},metadata->>provider_slug.eq.${slug}`);
  }

  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data || null;
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} jobId
 * @param {string} pepcoMfaSessionId
 * @returns {Promise<void>}
 */
async function linkPepcoMfaSessionToPortalSyncJob(supabase, jobId, pepcoMfaSessionId) {
  if (!jobId || !pepcoMfaSessionId) return;
  const { data: current, error: fetchErr } = await supabase
    .from("scrape_jobs")
    .select("metadata")
    .eq("id", jobId)
    .eq("job_type", UCI_PORTAL_SYNC_JOB_TYPE)
    .maybeSingle();
  if (fetchErr || !current) return;

  const prevMeta =
    current.metadata && typeof current.metadata === "object" && !Array.isArray(current.metadata)
      ? /** @type {Record<string, unknown>} */ (current.metadata)
      : {};
  const prevUci =
    prevMeta.uci && typeof prevMeta.uci === "object" && !Array.isArray(prevMeta.uci)
      ? /** @type {Record<string, unknown>} */ (prevMeta.uci)
      : {};

  await supabase
    .from("scrape_jobs")
    .update({
      status: "waiting_user",
      current_stage: "awaiting_human",
      current_user_message: "PEPCO MFA required to continue portal discovery.",
      metadata: {
        ...prevMeta,
        uci: {
          ...prevUci,
          pepco_mfa_session_id: pepcoMfaSessionId,
          awaiting_human_reason: "pepco_mfa",
        },
      },
    })
    .eq("id", jobId)
    .eq("job_type", UCI_PORTAL_SYNC_JOB_TYPE)
    .is("completed_at", null);
}

/**
 * @param {unknown} err
 * @returns {boolean}
 */
function isTransientPortalSyncError(err) {
  const code = err && typeof err === "object" ? String(/** @type {{ code?: unknown }} */ (err).code || "") : "";
  if (code === "NO_PORTAL_SNAPSHOT") return false;
  const statusCode =
    err && typeof err === "object" ? Number(/** @type {{ statusCode?: unknown }} */ (err).statusCode) : NaN;
  if (statusCode === 422 || statusCode === 404 || statusCode === 400) return false;
  const message = err instanceof Error ? err.message : String(err || "");
  return /timeout|temporarily|network|fetch failed|econnreset|503|502|504/i.test(message);
}

function computeRetryAfterIso(attemptCount) {
  const delayMs = Math.min(RETRY_DELAY_MS * Math.max(1, attemptCount), 15 * 60_000);
  return new Date(Date.now() + delayMs).toISOString();
}

module.exports = {
  UCI_PORTAL_SYNC_JOB_TYPE,
  UCI_JURISDICTION,
  TERMINAL_STATUSES,
  WORKER_POLLABLE,
  MAX_RETRY_ATTEMPTS,
  RETRY_DELAY_MS,
  isUciDurableJobsEnabled,
  isUciPortalSyncJobCancelled,
  pollUciPortalSyncJobCancelled,
  enqueueOrGetUciPortalSyncJob,
  claimUciPortalSyncJobViaRpc,
  heartbeatUciPortalSyncJobLease,
  releaseUciPortalSyncJobLease,
  cancelUciPortalSyncJob,
  findActiveUciPortalSyncJobForCoordination,
  linkPepcoMfaSessionToPortalSyncJob,
  isTransientPortalSyncError,
  computeRetryAfterIso,
};
