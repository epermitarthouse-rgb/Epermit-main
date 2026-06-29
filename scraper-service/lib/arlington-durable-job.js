"use strict";

const {
  ARLINGTON_JOB_LEASE_TTL_MS,
  claimArlingtonJobLease,
  computeRateLimitRetryAfterMs,
  findActiveArlingtonJobForProject,
  formatRetryAfterIso,
  newWorkerId,
  refreshArlingtonJobLease,
  releaseArlingtonJobLease,
  safeStr,
  updateArlingtonJobPhase,
  verifyArlingtonJobCompletion,
} = require("./arlington-orchestration.js");

/** @type {Map<string, NodeJS.Timeout>} Process-local optional continuations — NOT restart-safe. */
const scheduledContinuations = new Map();

function clearScheduledContinuation(jobId) {
  const t = scheduledContinuations.get(jobId);
  if (t) clearTimeout(t);
  scheduledContinuations.delete(jobId);
}

/**
 * Schedule a durable Arlington continuation after cooldown (e.g. rate limit).
 * @param {object} opts
 */
function scheduleArlingtonContinuation(opts) {
  const {
    jobId,
    delayMs,
    reason,
    runContinuation,
  } = opts;
  if (!jobId || typeof runContinuation !== "function") return;
  clearScheduledContinuation(jobId);
  const waitMs = Math.max(1000, Number(delayMs) || 60000);
  console.log(
    `[Arlington][DurableJob] schedule continuation jobId=${jobId} reason=${safeStr(reason, 80) || "resume"} delayMs=${waitMs}`,
  );
  const timer = setTimeout(() => {
    scheduledContinuations.delete(jobId);
    runContinuation({ jobId, reason: reason || "scheduled_resume" }).catch(
      (err) => {
        console.warn(
          `[Arlington][DurableJob] scheduled continuation failed jobId=${jobId}: ${err?.message || err}`,
        );
      },
    );
  }, waitMs);
  scheduledContinuations.set(jobId, timer);
}

async function withArlingtonJobLease(supabase, jobId, workerFn, opts = {}) {
  const workerId = opts.workerId || newWorkerId();
  const claim = await claimArlingtonJobLease(
    supabase,
    jobId,
    workerId,
    opts.ttlMs || ARLINGTON_JOB_LEASE_TTL_MS,
  );
  if (!claim.claimed) {
    return { ok: false, reason: claim.reason || "lease_not_claimed", claim };
  }
  let heartbeat = null;
  try {
    heartbeat = setInterval(() => {
      refreshArlingtonJobLease(supabase, jobId, workerId).catch(() => {});
    }, Math.floor((opts.ttlMs || ARLINGTON_JOB_LEASE_TTL_MS) / 3));
    const result = await workerFn({ workerId, claim });
    return { ok: true, result, workerId };
  } finally {
    if (heartbeat) clearInterval(heartbeat);
    await releaseArlingtonJobLease(
      supabase,
      jobId,
      workerId,
      opts.releaseReason || "phase_complete",
    ).catch(() => {});
  }
}

async function persistRateLimitState(supabase, session, opts) {
  const jobId = session?._scrapeJobId;
  if (!jobId || !supabase) return null;
  const attempt = Number(opts.attempt) || 0;
  const delayMs = computeRateLimitRetryAfterMs(attempt);
  const retryAfter = formatRetryAfterIso(delayMs);
  await updateArlingtonJobPhase(supabase, jobId, {
    phase: "attachments",
    attachmentsState: "rate_limited",
    rateLimitError: safeStr(opts.errorCode, 20) || "1015",
    rateLimitRetryAfter: retryAfter,
    rateLimitAttempt: attempt + 1,
  });
  if (typeof session.publishScrapeProgress === "function") {
    await session.publishScrapeProgress({
      event_type: "rate_limited",
      stage: "attachments",
      status: "running",
      user_message:
        "Accela portal rate-limited attachment access. Will retry automatically after cooldown.",
      metadata: {
        retryAfter,
        errorCode: safeStr(opts.errorCode, 20) || "1015",
      },
      forceFeed: true,
    });
  }
  return { retryAfter, delayMs };
}

async function scheduleRateLimitResume(supabase, session, runContinuation, opts) {
  const jobId = session?._scrapeJobId;
  if (!jobId) return null;
  const persisted = await persistRateLimitState(supabase, session, opts);
  if (!persisted) return null;
  // Process-local setTimeout is NOT authoritative — durable worker polls next_attempt_at.
  if (
    process.env.ARLINGTON_DURABLE_WORKER_ENABLED === "false" &&
    typeof runContinuation === "function"
  ) {
    scheduleArlingtonContinuation({
      jobId,
      delayMs: persisted.delayMs,
      reason: "rate_limit_cooldown",
      runContinuation,
    });
  } else {
    console.log(
      `[Arlington][DurableJob] rate-limit resume delegated to durable worker jobId=${jobId} retryAfter=${persisted.retryAfter}`,
    );
  }
  return persisted;
}

async function finalizeArlingtonDurableJob(supabase, session, verifyOpts) {
  const jobId = session?._scrapeJobId;
  const projectId = session?._scrapeProjectId;
  if (!supabase || !jobId || !projectId) return null;
  const verification = await verifyArlingtonJobCompletion(supabase, {
    projectId,
    userId: session.userId,
    permitNumber: session._scrapePermitNumber || verifyOpts?.permitNumber,
    requestedTabs: verifyOpts?.requestedTabs,
  });
  await updateArlingtonJobPhase(supabase, jobId, {
    phase: verification.complete ? "complete" : "partial",
    verification,
    checkpointVersion: verification.checkpointVersion,
    attachmentsState: verification.states.attachments,
    projectInformationState: verification.states.projectInformation,
    planReviewState: verification.states.planReview,
  });
  return verification;
}

module.exports = {
  scheduleArlingtonContinuation,
  clearScheduledContinuation,
  withArlingtonJobLease,
  persistRateLimitState,
  scheduleRateLimitResume,
  finalizeArlingtonDurableJob,
  findActiveArlingtonJobForProject,
};
