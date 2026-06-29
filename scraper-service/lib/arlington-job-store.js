"use strict";

const {
  verifyArlingtonJobCompletion,
  computeRateLimitRetryAfterMs,
  formatRetryAfterIso,
  detectArlingtonRecordMode,
  computeArlingtonProgressFingerprint,
} = require("./arlington-orchestration.js");
const {
  normalizeArlingtonPermitNumber,
  normalizeArlingtonRequestedScope,
  buildArlingtonScopeKey,
} = require("./arlington-scope-normalize.js");

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

const NO_PROGRESS_CLAIM_THRESHOLD = 3;

function parseRequestedScope(job) {
  return normalizeArlingtonRequestedScope(job?.requested_scope);
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

  if (patch.metadata || patch.cancellation_reason || patch.canonical_job_id) {
    const { data: row } = await supabase
      .from("scrape_jobs")
      .select("metadata")
      .eq("id", jobId)
      .maybeSingle();
    const priorMeta =
      row?.metadata && typeof row.metadata === "object" ? row.metadata : {};
    const nextMeta = {
      ...priorMeta,
      ...(patch.metadata || {}),
      arlington: {
        ...(priorMeta.arlington && typeof priorMeta.arlington === "object"
          ? priorMeta.arlington
          : {}),
        ...(patch.metadata?.arlington || {}),
      },
    };
    const jobPatch = { metadata: nextMeta };
    if (patch.cancellation_reason) {
      jobPatch.cancellation_reason = patch.cancellation_reason;
    }
    if (patch.canonical_job_id) {
      jobPatch.canonical_job_id = patch.canonical_job_id;
    }
    await supabase.from("scrape_jobs").update(jobPatch).eq("id", jobId);
  }

  return data || null;
}

/**
 * Atomic idempotent Arlington enqueue via Postgres RPC.
 */
async function enqueueOrGetArlingtonScrapeJob(supabase, fields) {
  const requestedScope = normalizeArlingtonRequestedScope(fields.requestedScope);
  const permitNumber = `${fields.permitNumber || ""}`.trim();
  const normalizedPermit = normalizeArlingtonPermitNumber(permitNumber);
  const scopeKey = buildArlingtonScopeKey(requestedScope);

  const { data, error } = await supabase.rpc("enqueue_or_get_arlington_scrape_job", {
    p_project_id: fields.projectId,
    p_user_id: fields.userId || null,
    p_credential_id: fields.credentialId || null,
    p_permit_number: permitNumber,
    p_normalized_permit_number: normalizedPermit,
    p_requested_scope: requestedScope,
    p_normalized_scope_key: scopeKey,
    p_scraper_session_id: fields.scraperSessionId || null,
    p_metadata: fields.metadata || {},
  });
  if (error) throw error;

  const row = Array.isArray(data) ? data[0] : data;
  const job = row?.job || row;
  const reusedExisting = Boolean(row?.reused_existing);
  return {
    job,
    jobId: job?.id || null,
    reusedExisting,
    requestedScope,
    normalizedPermitNumber: normalizedPermit,
    normalizedScopeKey: scopeKey,
  };
}

/** @deprecated Use enqueueOrGetArlingtonScrapeJob for new Arlington enqueues. */
async function initializeArlingtonDurableJob(supabase, jobId, fields) {
  const scope = normalizeArlingtonRequestedScope(fields.requestedScope);
  const permitNumber = `${fields.permitNumber || ""}`.trim();
  const { error } = await supabase
    .from("scrape_jobs")
    .update({
      requested_scope: scope,
      normalized_permit_number: normalizeArlingtonPermitNumber(permitNumber),
      normalized_scope_key: buildArlingtonScopeKey(scope),
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

function terminalStatusFromVerification(verification) {
  if (!verification) return "completed_with_warnings";
  if (verification.finalStatus === "partial_rate_limited") return "rate_limited";
  if (verification.finalStatus === "partial_project_info") {
    return "completed_with_warnings";
  }
  if (verification.finalStatus === "partial_external_blocker") {
    return "completed_with_warnings";
  }
  return "completed_with_warnings";
}

async function finalizeJobFromVerification(supabase, job, verification) {
  if (!verification) return null;
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
      metadata: {
        arlington: {
          terminalReason: verification.finalStatus,
          lastProgressAt: new Date().toISOString(),
        },
      },
    });
  }

  if (verification.finalStatus === "partial_rate_limited") {
    return releaseLease(supabase, job.id, job.lease_worker_id, {
      status: "rate_limited",
      phase: job.phase,
      attachments_state: verification.states.attachments,
      project_info_state: verification.states.projectInformation,
      plan_review_state: verification.states.planReview,
      checkpoint_version: verification.checkpointVersion,
      next_attempt_at: formatRetryAfterIso(
        computeRateLimitRetryAfterMs(Number(job.attempt_count) || 0),
      ),
      current_stage: "rate_limited",
      current_user_message: "Arlington scrape rate-limited; worker will retry.",
    });
  }

  if (verification.terminalPartial || !verification.hasRetryableWork) {
    const terminalReason = verification.blockers?.includes("plan_review_metadata_only")
      ? "plan_review_metadata_only"
      : verification.blockers?.includes("no_progress_guard")
        ? "no_progress_guard"
        : verification.finalStatus;
    return releaseLease(supabase, job.id, job.lease_worker_id, {
      status: terminalStatusFromVerification(verification),
      phase: "complete",
      attachments_state: verification.states.attachments,
      project_info_state: verification.states.projectInformation,
      plan_review_state:
        verification.blockers?.includes("plan_review_metadata_only")
          ? "complete"
          : verification.states.planReview,
      checkpoint_version: verification.checkpointVersion,
      completed_at: new Date().toISOString(),
      next_attempt_at: null,
      current_stage: "completed_with_warnings",
      current_user_message: `Arlington scrape stopped: ${verification.finalStatus}.`,
      metadata: {
        arlington: {
          terminalReason,
          metadataOnlyCount: verification.counts?.planReviewMetadataOnly || 0,
          metadataOnlyDocumentNames:
            verification.counts?.planReviewMetadataOnlyNames || [],
          lastProgressAt: new Date().toISOString(),
        },
      },
    });
  }

  return releaseLease(supabase, job.id, job.lease_worker_id, {
    status: "partial",
    phase: job.phase,
    attachments_state: verification.states.attachments,
    project_info_state: verification.states.projectInformation,
    plan_review_state: verification.states.planReview,
    checkpoint_version: verification.checkpointVersion,
    next_attempt_at: new Date().toISOString(),
    current_stage: "partial",
    current_user_message: `Arlington scrape partial: ${verification.finalStatus}`,
  });
}

async function evaluateNoProgressGuard(supabase, job, phaseResult, verification) {
  const priorMeta =
    job?.metadata?.arlington && typeof job.metadata.arlington === "object"
      ? job.metadata.arlington
      : {};
  const fingerprint = computeArlingtonProgressFingerprint({
    phase: phaseResult?.phase || job.phase,
    checkpointVersion:
      phaseResult?.checkpoint_version ?? job.checkpoint_version ?? 0,
    attachmentsState: phaseResult?.attachments_state || job.attachments_state,
    projectInfoState: phaseResult?.project_info_state || job.project_info_state,
    planReviewState: phaseResult?.plan_review_state || job.plan_review_state,
    attachmentsPending: verification?.counts?.attachmentsPending ?? 0,
    planReviewRetryablePending: verification?.counts?.planReviewPending ?? 0,
    planReviewMetadataOnly: verification?.counts?.planReviewMetadataOnly ?? 0,
    downloadedThisRun: phaseResult?.downloadedThisRun ?? 0,
    pendingReasons: phaseResult?.pendingByReason || null,
  });

  const immediateTerminal =
    phaseResult?.terminalMetadataOnly === true ||
    (verification?.blockers?.includes("plan_review_metadata_only") &&
      !verification?.hasRetryableWork);

  if (immediateTerminal) {
    return { terminal: true, reason: "plan_review_metadata_only", fingerprint };
  }

  const priorFingerprint = `${priorMeta.noProgressFingerprint || ""}`;
  const same =
    priorFingerprint.length > 0 &&
    priorFingerprint === fingerprint &&
    (phaseResult?.downloadedThisRun ?? 0) === 0;

  const consecutive = same
    ? Number(priorMeta.noProgressClaimCount || 0) + 1
    : 0;

  await supabase
    .from("scrape_jobs")
    .update({
      metadata: {
        ...(job.metadata || {}),
        arlington: {
          ...priorMeta,
          noProgressFingerprint: fingerprint,
          noProgressClaimCount: consecutive,
          lastProgressAt: same
            ? priorMeta.lastProgressAt || new Date().toISOString()
            : new Date().toISOString(),
        },
      },
    })
    .eq("id", job.id);

  if (consecutive >= NO_PROGRESS_CLAIM_THRESHOLD) {
    return { terminal: true, reason: "no_progress_guard", fingerprint, consecutive };
  }

  return { terminal: false, fingerprint, consecutive };
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
  NO_PROGRESS_CLAIM_THRESHOLD,
  parseRequestedScope,
  claimJobViaRpc,
  heartbeatLease,
  releaseLease,
  enqueueOrGetArlingtonScrapeJob,
  initializeArlingtonDurableJob,
  scheduleRateLimitRelease,
  finalizeJobFromVerification,
  evaluateNoProgressGuard,
  verifyArlingtonJobCompletion,
  detectArlingtonRecordMode,
  persistPortalDataPatch,
  normalizeArlingtonPermitNumber,
  normalizeArlingtonRequestedScope,
  buildArlingtonScopeKey,
};
