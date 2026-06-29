"use strict";

const {
  verifyArlingtonJobCompletion,
  computeRateLimitRetryAfterMs,
  formatRetryAfterIso,
  detectArlingtonRecordMode,
} = require("./arlington-orchestration.js");

const TERMINAL_STATUSES = new Set([
  "completed",
  "completed_with_warnings",
  "failed",
  "failed_unrecoverable",
  "cancelled",
]);

const WORKER_POLLABLE = new Set([
  "queued",
  "running",
  "resuming",
  "rate_limited",
  "partial",
]);

function parseRequestedScope(job) {
  const raw = job?.requested_scope;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { tabs: ["info", "attachments", "plan_review"], planReviewScope: "all" };
  }
  const tabs = Array.isArray(raw.tabs) ? raw.tabs.map(String) : ["info", "attachments", "plan_review"];
  return {
    tabs,
    planReviewScope: raw.planReviewScope ? String(raw.planReviewScope) : "all",
    autoContinueAttachments: raw.autoContinueAttachments !== false,
    autoContinueDownloads: raw.autoContinueDownloads !== false,
  };
}

async function claimJobViaRpc(supabase, workerId, leaseTtlSeconds = 180) {
  const { data, error } = await supabase.rpc("claim_arlington_scrape_job", {
    p_worker_id: workerId,
    p_lease_ttl_seconds: leaseTtlSeconds,
  });
  if (error) throw error;
  return data || null;
}

async function heartbeatLease(supabase, jobId, workerId, leaseTtlSeconds = 180) {
  const { data, error } = await supabase.rpc("heartbeat_arlington_scrape_job_lease", {
    p_job_id: jobId,
    p_worker_id: workerId,
    p_lease_ttl_seconds: leaseTtlSeconds,
  });
  if (error) throw error;
  return Boolean(data);
}

async function releaseLease(supabase, jobId, workerId, patch = {}) {
  const { data, error } = await supabase.rpc("release_arlington_scrape_job_lease", {
    p_job_id: jobId,
    p_worker_id: workerId,
    p_next_attempt_at: patch.next_attempt_at ?? null,
    p_status: patch.status ?? null,
    p_phase: patch.phase ?? null,
    p_attachments_state: patch.attachments_state ?? null,
    p_project_info_state: patch.project_info_state ?? null,
    p_plan_review_state: patch.plan_review_state ?? null,
    p_checkpoint_version: patch.checkpoint_version ?? null,
    p_attempt_count: patch.attempt_count ?? null,
    p_last_error: patch.last_error ?? null,
    p_completed_at: patch.completed_at ?? null,
    p_current_stage: patch.current_stage ?? null,
    p_current_user_message: patch.current_user_message ?? null,
  });
  if (error) throw error;
  return data || null;
}

async function initializeArlingtonDurableJob(supabase, jobId, fields) {
  const scope = fields.requestedScope || {};
  const { error } = await supabase
    .from("scrape_jobs")
    .update({
      requested_scope: scope,
      phase: fields.phase || "record_info",
      attachments_state: fields.attachments_state || "not_started",
      project_info_state: fields.project_info_state || "not_started",
      plan_review_state: fields.plan_review_state || "not_started",
      checkpoint_version: fields.checkpoint_version || 0,
      next_attempt_at: fields.next_attempt_at || new Date().toISOString(),
      attempt_count: 0,
      status: "queued",
      current_stage: "queued",
      current_user_message: fields.user_message || "Arlington scrape queued for durable worker.",
    })
    .eq("id", jobId);
  if (error) throw error;
}

function scheduleRateLimitRelease(patch, attemptCount) {
  const delayMs = computeRateLimitRetryAfterMs(attemptCount);
  return {
    ...patch,
    status: "rate_limited",
    attachments_state: "rate_limited",
    next_attempt_at: formatRetryAfterIso(delayMs),
    attempt_count: attemptCount + 1,
    current_stage: "attachments",
    current_user_message:
      "Accela rate-limited attachment access. Worker will retry after cooldown.",
  };
}

async function finalizeJobFromVerification(supabase, job, verification) {
  if (!verification) return null;
  const scope = parseRequestedScope(job);
  if (verification.complete) {
    const status =
      verification.finalStatus === "complete"
        ? "completed"
        : "completed_with_warnings";
    return releaseLease(supabase, job.id, job.lease_worker_id, {
      status,
      phase: "complete",
      attachments_state: verification.states.attachments,
      project_info_state: verification.states.projectInformation,
      plan_review_state: verification.states.planReview,
      checkpoint_version: verification.checkpointVersion,
      completed_at: new Date().toISOString(),
      next_attempt_at: null,
      current_stage: "completed",
      current_user_message: "Arlington scrape completed.",
    });
  }

  const partialStatus =
    verification.finalStatus === "partial_rate_limited"
      ? "rate_limited"
      : "partial";

  return releaseLease(supabase, job.id, job.lease_worker_id, {
    status: partialStatus,
    phase: job.phase,
    attachments_state: verification.states.attachments,
    project_info_state: verification.states.projectInformation,
    plan_review_state: verification.states.planReview,
    checkpoint_version: verification.checkpointVersion,
    next_attempt_at: new Date().toISOString(),
    current_stage: partialStatus,
    current_user_message: `Arlington scrape partial: ${verification.finalStatus}`,
  });
}

async function persistPortalDataPatch(
  supabase,
  userId,
  projectId,
  permitNumber,
  hashPortalData,
  mutator,
) {
  const { readProjectPortalRow, bumpCheckpointVersion } = require("./arlington-orchestration.js");
  const row = await readProjectPortalRow(supabase, projectId, userId, permitNumber);
  if (!row?.id) return { ok: false, reason: "project_not_found" };
  const prior =
    row.portal_data && typeof row.portal_data === "object" ? row.portal_data : {};
  const next = mutator({ ...prior });
  const checkpointVersion = bumpCheckpointVersion(prior);
  next.checkpointVersion = checkpointVersion;
  const newHash = hashPortalData(next);
  const { error } = await supabase
    .from("projects")
    .update({
      portal_data: next,
      portal_data_hash: newHash,
      last_checked_at: new Date().toISOString(),
    })
    .eq("id", row.id);
  if (error) throw error;
  return { ok: true, checkpointVersion, portalData: next };
}

module.exports = {
  TERMINAL_STATUSES,
  WORKER_POLLABLE,
  parseRequestedScope,
  claimJobViaRpc,
  heartbeatLease,
  releaseLease,
  initializeArlingtonDurableJob,
  scheduleRateLimitRelease,
  finalizeJobFromVerification,
  verifyArlingtonJobCompletion,
  detectArlingtonRecordMode,
  persistPortalDataPatch,
};
