"use strict";

const scrapeEvents = require("./scrape-events.js");
const { SCRAPE_STAGES } = require("./scrape-stages.js");
const { attachProgressPublisher, publishScrapeProgress, publishScrapeCompleted } =
  require("./scrape-progress-publisher.js");
const {
  computeArlingtonDurableProgress,
  phaseUserMessage,
} = require("./arlington-durable-progress.js");
const { parseRequestedScope } = require("./arlington-job-store.js");
const orchestration = require("./arlington-orchestration.js");

async function readPortalDataForProgress(supabase, job) {
  const projectId = `${job?.project_id || ""}`.trim();
  const userId = `${job?.user_id || ""}`.trim();
  const permitNumber = `${job?.permit_number || ""}`.trim();
  if (!projectId) return null;
  try {
    const row = await orchestration.readProjectPortalRow(
      supabase,
      projectId,
      userId,
      permitNumber,
    );
    return row?.portal_data || null;
  } catch {
    return null;
  }
}

async function resolveProgress(supabase, session, job, opts = {}) {
  const portalData =
    opts.portalData != null
      ? opts.portalData
      : await readPortalDataForProgress(supabase, job);
  const requestedScope = parseRequestedScope(job);
  return computeArlingtonDurableProgress(
    { ...job, ...(opts.jobPatch || {}) },
    portalData,
    requestedScope,
    opts.progressOpts || {},
  );
}

/**
 * Attach durable-worker progress publishing (no UI heartbeat timer).
 */
function attachArlingtonWorkerProgressBridge(supabase, session, job) {
  const jobId = `${job?.id || ""}`.trim();
  const projectId = `${job?.project_id || ""}`.trim();
  if (!jobId || !projectId) return;

  session._scrapeJobId = jobId;
  session._scrapeProjectId = projectId;
  session._scrapePermitNumber = job?.permit_number || null;
  session._scrapeJurisdiction = "Arlington County";
  session._scrapeJobTerminalStatus = null;
  session._terminalScrapeEventEmitted = false;
  session.arlingtonDurableMode = true;

  attachProgressPublisher(supabase, session);

  session.publishScrapeProgress = async (opts = {}) => {
    const progress = await resolveProgress(supabase, session, job, {
      portalData: opts.portalData,
      jobPatch: { phase: opts.phase || job.phase, status: opts.status || "running" },
      progressOpts: opts.progressOpts,
    });
    return publishScrapeProgress(supabase, session, {
      status: "running",
      ...opts,
      progress_current: opts.progress_current ?? progress.current,
      progress_total: opts.progress_total ?? progress.total,
    });
  };

  session.setScrapeProgress = async (opts = {}) => {
    await session.publishScrapeProgress(opts);
  };

  session.publishArlingtonPhaseProgress = async (phase, kind, extra = {}) => {
    const stage =
      phase === "attachments" || phase === "plan_review"
        ? SCRAPE_STAGES.DOWNLOADING
        : phase === "verify"
          ? SCRAPE_STAGES.SAVING
          : SCRAPE_STAGES.LOADING_SECTION;
    const userMessage = extra.user_message || phaseUserMessage(phase, kind);
    const eventType =
      kind === "complete"
        ? "section_completed"
        : kind === "checkpoint"
          ? "checkpoint_persisted"
          : "section_started";
    return session.publishScrapeProgress({
      stage,
      event_type: eventType,
      user_message: userMessage,
      dedupeKey: `${phase}:${kind}:${extra.checkpointVersion ?? ""}`,
      forceFeed: extra.forceFeed === true || kind !== "progress",
      skipFeed: kind === "progress",
      phase,
      ...extra,
    });
  };
}

async function emitWorkerClaimedProgress(supabase, session, job, workerId) {
  if (typeof session?.publishScrapeProgress !== "function") return null;
  const permit = `${job?.permit_number || session?._scrapePermitNumber || ""}`.trim();
  const progress = await resolveProgress(supabase, session, job, {
    jobPatch: { phase: job.phase, status: "running" },
  });
  return publishScrapeProgress(supabase, session, {
    event_type: "worker_claimed",
    stage: SCRAPE_STAGES.PROCESSING_RECORDS,
    status: "running",
    user_message: permit
      ? `Worker started scraping permit ${permit}.`
      : "Worker started Arlington scrape.",
    dedupeKey: `worker_claimed:${workerId || "worker"}`,
    forceFeed: true,
    progress_current: progress.current,
    progress_total: progress.total,
  });
}

async function emitWorkerPhaseCheckpointProgress(
  supabase,
  session,
  job,
  phaseResult,
  opts = {},
) {
  if (typeof session?.publishArlingtonPhaseProgress !== "function") return null;
  const phase = `${opts.phase || phaseResult?.phase || job?.phase || ""}`.trim();
  const nextPhase = `${phaseResult?.nextPhase || phase}`.trim();
  const portalData = opts.portalData ?? (await readPortalDataForProgress(supabase, job));
  const progress = await resolveProgress(supabase, session, job, {
    portalData,
    jobPatch: {
      phase: nextPhase,
      status: opts.status || "partial",
      attachments_state: phaseResult?.attachments_state,
      project_info_state: phaseResult?.project_info_state,
      plan_review_state: phaseResult?.plan_review_state,
      checkpoint_version: phaseResult?.checkpoint_version,
    },
  });

  const cycleMsg = phaseResult?.cycleTimedOut
    ? `Checkpoint saved at ${nextPhase}; resuming shortly.`
    : phaseUserMessage(phase, "complete");

  return session.publishScrapeProgress({
    event_type: "checkpoint_persisted",
    stage: SCRAPE_STAGES.SAVING,
    status: opts.status || "running",
    user_message: opts.user_message || cycleMsg,
    dedupeKey: `checkpoint:${phase}:${phaseResult?.checkpoint_version ?? 0}`,
    forceFeed: true,
    progress_current: progress.current,
    progress_total: progress.total,
    metadata: {
      nextPhase,
      checkpointVersion: phaseResult?.checkpoint_version,
    },
  });
}

async function emitWorkerTerminalProgress(supabase, session, job, patch = {}) {
  if (typeof session?.publishScrapeProgress !== "function") return null;
  scrapeEvents.stopHeartbeat(job.id);

  const status = `${patch.status || job?.status || ""}`.trim();
  const withWarnings =
    status === "completed_with_warnings" || status === "partial_external_blocker";
  const portalData = await readPortalDataForProgress(supabase, job);
  const progress = await resolveProgress(
    supabase,
    session,
    { ...job, status, phase: "complete" },
    {
      portalData,
      progressOpts: { terminal: true, status, phase: "complete" },
    },
  );

  const userMessage =
    patch.current_user_message ||
    (withWarnings
      ? "Arlington scrape completed with warnings."
      : status === "failed" || status === "failed_unrecoverable"
        ? "Arlington scrape failed."
        : status === "cancelled"
          ? "Arlington scrape cancelled."
          : "Arlington scrape completed.");

  if (
    status === "completed" ||
    status === "completed_with_warnings" ||
    status === "partial_external_blocker"
  ) {
    return publishScrapeCompleted(supabase, session, {
      withWarnings,
      user_message: userMessage,
      progress_current: progress.total,
      progress_total: progress.total,
      finalize: false,
    });
  }

  if (status === "failed" || status === "failed_unrecoverable") {
    return session.publishScrapeProgress({
      event_type: "scrape_failed",
      stage: SCRAPE_STAGES.FAILED,
      status: "failed",
      user_message: userMessage,
      forceFeed: true,
      progress_current: progress.current,
      progress_total: progress.total,
    });
  }

  if (status === "cancelled") {
    return session.publishScrapeProgress({
      event_type: "scrape_cancelled",
      stage: SCRAPE_STAGES.CANCELLED,
      status: "cancelled",
      user_message: userMessage,
      forceFeed: true,
      progress_current: progress.current,
      progress_total: progress.total,
    });
  }

  return session.publishScrapeProgress({
    event_type: "section_progress",
    stage: SCRAPE_STAGES.PROCESSING_RECORDS,
    status,
    user_message: userMessage,
    forceFeed: true,
    progress_current: progress.current,
    progress_total: progress.total,
  });
}

module.exports = {
  attachArlingtonWorkerProgressBridge,
  emitWorkerClaimedProgress,
  emitWorkerPhaseCheckpointProgress,
  emitWorkerTerminalProgress,
  readPortalDataForProgress,
  resolveProgress,
};
