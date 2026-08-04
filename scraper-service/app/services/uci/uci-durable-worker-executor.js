"use strict";

const { runPortalSync } = require("./uci-portal-sync.service.js");
const { publishUciPortalSyncJobProgress } = require("./uci-job-progress.js");
const {
  pollUciPortalSyncJobCancelled,
  heartbeatUciPortalSyncJobLease,
  releaseUciPortalSyncJobLease,
  MAX_RETRY_ATTEMPTS,
  isTransientPortalSyncError,
  computeRetryAfterIso,
} = require("./uci-portal-sync-job-store.js");

const HEARTBEAT_INTERVAL_MS = 60_000;

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {Record<string, unknown>} job
 * @param {string} workerId
 * @param {number} leaseTtlSeconds
 * @returns {Promise<() => void>}
 */
function startUciJobHeartbeat(supabase, job, workerId, leaseTtlSeconds) {
  const jobId = String(job.id);
  const timer = setInterval(() => {
    void heartbeatUciPortalSyncJobLease(supabase, jobId, workerId, leaseTtlSeconds).catch(
      () => {},
    );
  }, HEARTBEAT_INTERVAL_MS);
  return () => clearInterval(timer);
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} deps
 * @param {Record<string, unknown>} deps.job
 * @param {string} deps.workerId
 * @param {number} [deps.leaseTtlSeconds]
 * @returns {Promise<{ outcome: string, summary?: Record<string, unknown> }>}
 */
async function executeUciPortalSyncWorkerCycle(deps) {
  const { supabase, job, workerId, leaseTtlSeconds = 180 } = deps;
  const jobId = String(job.id);
  const projectId = String(job.project_id);
  const coordinationRecordId = String(job.coordination_record_id || "");
  const providerSlug = String(
    job.metadata &&
      typeof job.metadata === "object" &&
      /** @type {{ provider_slug?: unknown }} */ (job.metadata).provider_slug
      ? /** @type {{ provider_slug?: unknown }} */ (job.metadata).provider_slug
      : job.portal_type || "",
  )
    .trim()
    .toLowerCase();

  if (!coordinationRecordId) {
    await releaseUciPortalSyncJobLease(supabase, jobId, workerId, {
      status: "failed_unrecoverable",
      phase: "complete",
      completed_at: new Date().toISOString(),
      current_stage: "failed",
      current_user_message: "Portal sync job is missing coordination record linkage.",
      error_code: "MISSING_COORDINATION_RECORD",
      last_error: "coordination_record_id missing on job row",
    });
    return { outcome: "failed" };
  }

  if (await pollUciPortalSyncJobCancelled(supabase, jobId)) {
    return { outcome: "cancelled" };
  }

  const stopHeartbeat = startUciJobHeartbeat(supabase, job, workerId, leaseTtlSeconds);
  const attemptCount = Number(job.attempt_count) || 0;

  try {
    await publishUciPortalSyncJobProgress(supabase, {
      jobId,
      projectId,
      stage: "portal_sync",
      status: "running",
      userMessage: "Starting normalized portal sync…",
      progressCurrent: 0,
      progressTotal: 5,
      eventType: "worker_claimed",
      forceFeed: true,
    });

    if (await pollUciPortalSyncJobCancelled(supabase, jobId)) {
      return { outcome: "cancelled" };
    }

    const summary = await runPortalSync(supabase, {
      coordinationRecordId,
      providerSlug: providerSlug || undefined,
      isCancelRequested: () => pollUciPortalSyncJobCancelled(supabase, jobId),
    });

    await publishUciPortalSyncJobProgress(supabase, {
      jobId,
      projectId,
      stage: "portal_sync",
      status: "completed",
      userMessage: "Portal sync completed.",
      progressCurrent: 5,
      progressTotal: 5,
      eventType: "scrape_completed",
      metadata: {
        lifecycle_status:
          summary?.lifecycle && typeof summary.lifecycle === "object"
            ? /** @type {{ status?: unknown }} */ (summary.lifecycle).status
            : null,
      },
      forceFeed: true,
    });

    const prevMeta =
      job.metadata && typeof job.metadata === "object" && !Array.isArray(job.metadata)
        ? /** @type {Record<string, unknown>} */ (job.metadata)
        : {};
    const prevUci =
      prevMeta.uci && typeof prevMeta.uci === "object" && !Array.isArray(prevMeta.uci)
        ? /** @type {Record<string, unknown>} */ (prevMeta.uci)
        : {};

    await supabase
      .from("scrape_jobs")
      .update({
        metadata: {
          ...prevMeta,
          uci: {
            ...prevUci,
            last_sync_summary: summary,
            terminal_reason: "completed",
          },
        },
      })
      .eq("id", jobId);

    await releaseUciPortalSyncJobLease(supabase, jobId, workerId, {
      status: "completed",
      phase: "complete",
      completed_at: new Date().toISOString(),
      current_stage: "completed",
      current_user_message: "Portal sync completed.",
      attempt_count: attemptCount,
    });

    return { outcome: "completed", summary };
  } catch (err) {
    const code =
      err && typeof err === "object" ? String(/** @type {{ code?: unknown }} */ (err).code || "") : "";
    const message = err instanceof Error ? err.message.slice(0, 500) : String(err).slice(0, 500);

    if (code === "CANCELLED" || (await pollUciPortalSyncJobCancelled(supabase, jobId))) {
      return { outcome: "cancelled" };
    }

    const userMessage =
      code === "NO_PORTAL_SNAPSHOT"
        ? "No portal snapshot found. Run PEPCO discovery, then retry sync."
        : "Portal sync failed.";

    if (code === "NO_PORTAL_SNAPSHOT") {
      await publishUciPortalSyncJobProgress(supabase, {
        jobId,
        projectId,
        stage: "awaiting_human",
        status: "waiting_user",
        userMessage,
        progressCurrent: 1,
        progressTotal: 5,
        eventType: "warning",
        metadata: { error_code: code },
        forceFeed: true,
      });
      await releaseUciPortalSyncJobLease(supabase, jobId, workerId, {
        status: "waiting_user",
        phase: "portal_sync",
        current_stage: "awaiting_human",
        current_user_message: userMessage,
        error_code: code,
        error_user_message: userMessage,
        last_error: message,
        attempt_count: attemptCount + 1,
      });
      return { outcome: "waiting_user" };
    }

    if (isTransientPortalSyncError(err) && attemptCount + 1 < MAX_RETRY_ATTEMPTS) {
      const nextAttempt = computeRetryAfterIso(attemptCount + 1);
      await publishUciPortalSyncJobProgress(supabase, {
        jobId,
        projectId,
        stage: "portal_sync",
        status: "partial",
        userMessage: "Portal sync hit a transient error; retry scheduled.",
        progressCurrent: 1,
        progressTotal: 5,
        eventType: "warning",
        metadata: { error_code: code || "TRANSIENT_ERROR" },
        forceFeed: true,
      });
      await releaseUciPortalSyncJobLease(supabase, jobId, workerId, {
        status: "partial",
        phase: "portal_sync",
        next_attempt_at: nextAttempt,
        current_stage: "retry_scheduled",
        current_user_message: "Retrying portal sync shortly…",
        last_error: message,
        attempt_count: attemptCount + 1,
      });
      return { outcome: "retry" };
    }

    await publishUciPortalSyncJobProgress(supabase, {
      jobId,
      projectId,
      stage: "failed",
      status: "failed_unrecoverable",
      userMessage,
      progressCurrent: 1,
      progressTotal: 5,
      eventType: "scrape_failed",
      metadata: { error_code: code || "SYNC_FAILED" },
      forceFeed: true,
    });
    await releaseUciPortalSyncJobLease(supabase, jobId, workerId, {
      status: "failed_unrecoverable",
      phase: "complete",
      completed_at: new Date().toISOString(),
      current_stage: "failed",
      current_user_message: userMessage,
      error_code: code || "SYNC_FAILED",
      error_user_message: userMessage,
      last_error: message,
      attempt_count: attemptCount + 1,
    });
    return { outcome: "failed" };
  } finally {
    stopHeartbeat();
  }
}

module.exports = {
  executeUciPortalSyncWorkerCycle,
  startUciJobHeartbeat,
};
