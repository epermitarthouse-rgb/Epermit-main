"use strict";

const { runArlingtonWorkerBoundedPhase } = require("../accela-scraper.js");
const { createArlingtonWorkerSession } = require("./arlington-worker-session.js");
const {
  parseRequestedScope,
  heartbeatLease,
  releaseLease,
  scheduleRateLimitRelease,
  finalizeJobFromVerification,
  verifyArlingtonJobCompletion,
} = require("./arlington-job-store.js");

const LEASE_TTL_SECONDS = 180;
const HEARTBEAT_INTERVAL_MS = 60 * 1000;

/**
 * Execute one claimed Arlington job cycle: session recreate → bounded phase → lease release.
 * @param {object} ctx
 */
async function executeArlingtonWorkerCycle(ctx) {
  const {
    supabase,
    job,
    workerId,
    sessions,
    rearmSessionIdleTimeout,
    cleanupSession,
    hashPortalData,
    uploadToSupabaseStorage,
    sanitizeStorageKey,
  } = ctx;

  const requestedScope = parseRequestedScope(job);
  const userId = `${job.user_id || ""}`.trim();
  const projectId = `${job.project_id || ""}`.trim();
  const permitNumber = `${job.permit_number || ""}`.trim();
  const phase = `${job.phase || "record_info"}`.trim();

  let heartbeatTimer = null;
  let sessionHandle = null;

  const startHeartbeat = () => {
    heartbeatTimer = setInterval(() => {
      heartbeatLease(supabase, job.id, workerId, LEASE_TTL_SECONDS).catch(
        () => {},
      );
    }, HEARTBEAT_INTERVAL_MS);
  };

  try {
    sessionHandle = await createArlingtonWorkerSession({
      supabase,
      job,
      sessions,
      rearmSessionIdleTimeout,
      cleanupSession,
      preferSessionId: null,
    });

    startHeartbeat();

    const phaseResult = await runArlingtonWorkerBoundedPhase(
      sessionHandle.session,
      {
        job,
        userId,
        supabase,
        hashPortalData,
        uploadToSupabaseStorage,
        sanitizeStorageKey,
        requestedScope,
        phase,
        onHeartbeat: () =>
          heartbeatLease(supabase, job.id, workerId, LEASE_TTL_SECONDS),
      },
    );

    if (phaseResult.rateLimited) {
      const attemptCount = Number(job.attempt_count) || 0;
      const patch = scheduleRateLimitRelease(
        {
          phase: "attachments",
          checkpoint_version: phaseResult.checkpoint_version,
          last_error: "cloudflare_1015",
        },
        attemptCount,
      );
      await releaseLease(supabase, job.id, workerId, patch);
      return { ok: true, outcome: "rate_limited", phaseResult };
    }

    if (phaseResult.verify) {
      const verification = await verifyArlingtonJobCompletion(supabase, {
        projectId,
        userId,
        permitNumber,
        requestedTabs: requestedScope.tabs,
      });
      const finalized = await finalizeJobFromVerification(
        supabase,
        { ...job, lease_worker_id: workerId },
        verification,
      );
      return {
        ok: true,
        outcome: verification.complete ? "completed" : "partial",
        verification,
        finalized,
      };
    }

    const nextPhase = phaseResult.nextPhase || phase;

    await releaseLease(supabase, job.id, workerId, {
      status:
        nextPhase === "complete"
          ? "partial"
          : phaseResult.cycleTimedOut
            ? "partial"
            : "partial",
      phase: nextPhase,
      attachments_state: phaseResult.attachments_state,
      project_info_state: phaseResult.project_info_state,
      plan_review_state: phaseResult.plan_review_state,
      checkpoint_version: phaseResult.checkpoint_version,
      next_attempt_at: new Date().toISOString(),
      current_stage: nextPhase,
      current_user_message: phaseResult.cycleTimedOut
        ? `Arlington worker cycle checkpointed at ${nextPhase}; resuming shortly.`
        : `Arlington worker advanced to ${nextPhase}.`,
    });

    return { ok: true, outcome: "checkpointed", phaseResult };
  } catch (err) {
    const msg = err?.message || String(err);
    console.warn(`[Arlington][Worker] cycle failed job=${job.id}: ${msg}`);
    const unrecoverable =
      /credential_not|login_requires_manual|not_arlington_credential/i.test(msg);
    await releaseLease(supabase, job.id, workerId, {
      status: unrecoverable ? "failed_unrecoverable" : "partial",
      last_error: msg.slice(0, 500),
      next_attempt_at: unrecoverable
        ? null
        : new Date(Date.now() + 60_000).toISOString(),
      current_stage: unrecoverable ? "failed" : "partial",
      current_user_message: unrecoverable
        ? "Arlington scrape failed with an unrecoverable error."
        : "Arlington worker hit a transient error; will retry.",
      completed_at: unrecoverable ? new Date().toISOString() : null,
    });
    return { ok: false, error: msg, unrecoverable };
  } finally {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    if (sessionHandle) await sessionHandle.dispose().catch(() => {});
  }
}

module.exports = {
  executeArlingtonWorkerCycle,
  LEASE_TTL_SECONDS,
  HEARTBEAT_INTERVAL_MS,
};
