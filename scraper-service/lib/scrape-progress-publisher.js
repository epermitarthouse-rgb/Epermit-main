"use strict";

const { SCRAPE_STAGES } = require("./scrape-stages.js");

function scrapeEvents() {
  return require("./scrape-events.js");
}

/** Per-job feed dedupe: skip repetitive scrape_events while still updating scrape_jobs. */
const feedDedupeState = new Map();

function safeStr(value, maxLen = 500) {
  if (value == null) return "";
  const text = String(value).trim();
  if (!text) return "";
  return text.length > maxLen ? `${text.slice(0, maxLen)}…` : text;
}

function resolveJurisdiction(session, opts) {
  return (
    safeStr(opts.jurisdiction, 120) ||
    session?._scrapeJurisdiction ||
    scrapeEvents().detectJurisdictionFromSession(session)
  );
}

function resolveScrapeMode(session, opts) {
  return safeStr(opts.scrapeMode || session?._scrapeMode, 80) || null;
}

function buildNormalizedEvent(session, opts = {}) {
  const stage = safeStr(opts.stage, 80) || SCRAPE_STAGES.PROCESSING_RECORDS;
  const userMessage =
    safeStr(opts.user_message || opts.userMessage, 500) || "Working…";
  const current =
    opts.progress_current != null
      ? Number(opts.progress_current)
      : opts.current != null
        ? Number(opts.current)
        : session?.progress != null
          ? Number(session.progress)
          : null;
  const total =
    opts.progress_total != null
      ? Number(opts.progress_total)
      : opts.total != null
        ? Number(opts.total)
        : session?.total != null
          ? Number(session.total)
          : null;

  return {
    jurisdiction: resolveJurisdiction(session, opts),
    scrapeMode: resolveScrapeMode(session, opts),
    stage,
    action: safeStr(opts.action || opts.event_type, 80) || "progress",
    userMessage,
    current: Number.isFinite(current) ? current : null,
    total: Number.isFinite(total) ? total : null,
    severity: safeStr(opts.severity, 20) || "info",
    entityType: safeStr(opts.entityType, 80) || null,
    entityName: safeStr(opts.entityName, 200) || null,
    technicalDetails:
      opts.technical_message != null
        ? opts.technical_message
        : opts.technicalDetails != null
          ? opts.technicalDetails
          : null,
    dedupeKey: safeStr(opts.dedupeKey, 200) || null,
    event_type: safeStr(opts.event_type, 80) || "section_progress",
    status: opts.status || "running",
    forceFeed: Boolean(opts.forceFeed),
    skipFeed: Boolean(opts.skipFeed),
  };
}

function buildEventMetadata(normalized) {
  return scrapeEvents().sanitizeMetadata({
    jurisdiction: normalized.jurisdiction,
    scrapeMode: normalized.scrapeMode,
    stage: normalized.stage,
    action: normalized.action,
    userMessage: normalized.userMessage,
    current: normalized.current,
    total: normalized.total,
    severity: normalized.severity,
    entityType: normalized.entityType,
    entityName: normalized.entityName,
    dedupeKey: normalized.dedupeKey,
  });
}

function defaultDedupeKey(normalized) {
  if (normalized.dedupeKey) return normalized.dedupeKey;
  const parts = [normalized.stage, normalized.action, normalized.userMessage];
  if (normalized.entityType && normalized.current != null) {
    parts.push(`${normalized.entityType}:${normalized.current}`);
  }
  return parts.filter(Boolean).join("|");
}

function shouldInsertFeedEvent(jobId, normalized) {
  if (normalized.skipFeed) return false;
  if (normalized.forceFeed) return true;

  const severity = `${normalized.severity || ""}`.toLowerCase();
  if (severity === "error" || severity === "warning") return true;
  if (
    normalized.event_type === "scrape_completed" ||
    normalized.event_type === "scrape_failed" ||
    normalized.event_type === "scrape_cancelled"
  ) {
    return true;
  }

  const state = feedDedupeState.get(jobId) || {
    lastKey: null,
    lastStage: null,
    lastFeedAt: 0,
  };

  if (normalized.stage && state.lastStage && normalized.stage !== state.lastStage) {
    return true;
  }

  const key = defaultDedupeKey(normalized);
  if (key === state.lastKey) {
    return false;
  }

  const entityType = `${normalized.entityType || ""}`.toLowerCase();
  if (
    (entityType === "record" || entityType === "file") &&
    normalized.current != null &&
    normalized.current > 1 &&
    normalized.current % 10 !== 0
  ) {
    return false;
  }

  return true;
}

function recordFeedDedupe(jobId, normalized) {
  const key = defaultDedupeKey(normalized);
  feedDedupeState.set(jobId, {
    lastKey: key,
    lastStage: normalized.stage,
    lastFeedAt: Date.now(),
  });
}

function applySessionMirror(session, normalized) {
  if (normalized.userMessage) session.message = normalized.userMessage;
  if (normalized.current != null) session.progress = normalized.current;
  if (normalized.total != null) session.total = normalized.total;
  scrapeEvents().applySessionStatusFromScrapeEvent(session, normalized.status);
  if (typeof session._touchScrapeActivity === "function") {
    session._touchScrapeActivity();
  }
}

function clearFeedDedupe(jobId) {
  feedDedupeState.delete(jobId);
}

/**
 * Shared publisher: always updates scrape_jobs; inserts scrape_events when feed-worthy.
 */
async function publishScrapeProgress(supabase, session, opts = {}) {
  const jobId = session?._scrapeJobId;
  const projectId = session?._scrapeProjectId;
  if (!jobId || !projectId) return null;

  try {
    const {
      shouldSuppressProgress,
      isJobCancelled,
    } = require("./scrape-job-cancellation.js");
    if (shouldSuppressProgress(session)) return null;
    if (await isJobCancelled(supabase, jobId)) {
      session._scrapeEventsSuppressed = true;
      session._cancelRequested = true;
      return null;
    }
  } catch (_) {}

  const normalized = buildNormalizedEvent(session, opts);
  if (
    normalized.event_type !== "scrape_cancelled" &&
    normalized.event_type !== "scrape_cancelling" &&
    (session?._cancelRequested || session?._scrapeEventsSuppressed)
  ) {
    return null;
  }
  applySessionMirror(session, normalized);

  const metadata = buildEventMetadata(normalized);
  const technical = scrapeEvents().sanitizeTechnicalMessage(
    normalized.technicalDetails,
  );
  const insertFeed = shouldInsertFeedEvent(jobId, normalized);
  const now = new Date().toISOString();

  const jobPatch = {
    current_stage: normalized.stage,
    current_user_message: normalized.userMessage,
    last_heartbeat_at: now,
    last_activity_at: now,
    status: normalized.status,
  };
  if (normalized.current != null) jobPatch.progress_current = normalized.current;
  if (normalized.total != null) jobPatch.progress_total = normalized.total;

  await scrapeEvents().updateScrapeJob(supabase, jobId, jobPatch);

  if (!insertFeed) return null;

  const inserted = await scrapeEvents().emitScrapeEvent(supabase, jobId, projectId, {
    event_type: normalized.event_type,
    stage: normalized.stage,
    status: normalized.status,
    user_message: normalized.userMessage,
    technical_message: technical,
    progress_current: normalized.current,
    progress_total: normalized.total,
    metadata,
    skip_job_patch: true,
  });

  if (inserted) recordFeedDedupe(jobId, normalized);
  return inserted;
}

async function publishScrapeWarning(supabase, session, opts = {}) {
  return publishScrapeProgress(supabase, session, {
    ...opts,
    severity: "warning",
    event_type: opts.event_type || "warning",
    forceFeed: opts.forceFeed !== false,
  });
}

async function publishScrapeFailure(supabase, session, opts = {}) {
  const userMessage =
    opts.user_message ||
    opts.userMessage ||
    scrapeEvents().mapTechnicalErrorToUserMessage(
      opts.technical_message || opts.technicalDetails,
    ) ||
    "The scrape could not be completed.";

  applySessionMirror(session, {
    userMessage,
    status: "failed",
    stage: opts.stage || SCRAPE_STAGES.FAILED,
  });
  session.status = "error";

  if (typeof session.finalizeScrapeJob === "function" && opts.finalize !== false) {
    await session.finalizeScrapeJob("error", {
      user_message: userMessage,
      technical_message: opts.technical_message || opts.technicalDetails,
      error_code: opts.error_code,
      metadata: opts.metadata,
    });
    return null;
  }

  return publishScrapeProgress(supabase, session, {
    ...opts,
    user_message: userMessage,
    severity: "error",
    status: "failed",
    stage: opts.stage || SCRAPE_STAGES.FAILED,
    event_type: "scrape_failed",
    forceFeed: true,
  });
}

async function publishScrapeCompleted(supabase, session, opts = {}) {
  const withWarnings = Boolean(opts.withWarnings || opts.with_warnings);
  const stage = withWarnings
    ? SCRAPE_STAGES.COMPLETED_WITH_WARNINGS
    : SCRAPE_STAGES.COMPLETED;
  const status = withWarnings ? "completed_with_warnings" : "completed";
  const userMessage =
    opts.user_message ||
    opts.userMessage ||
    (withWarnings
      ? "Scrape completed with warnings."
      : "Scrape completed successfully.");

  if (typeof session.finalizeScrapeJob === "function" && opts.finalize !== false) {
    const sessionStatus = withWarnings ? "partial_success_attachments_pending" : "done";
    await session.finalizeScrapeJob(sessionStatus, {
      user_message: userMessage,
      technical_message: opts.technical_message || opts.technicalDetails,
      metadata: opts.metadata,
    });
    clearFeedDedupe(session._scrapeJobId);
    return null;
  }

  clearFeedDedupe(session._scrapeJobId);
  return publishScrapeProgress(supabase, session, {
    ...opts,
    user_message: userMessage,
    severity: withWarnings ? "warning" : "info",
    status,
    stage,
    event_type: withWarnings ? "warning" : "scrape_completed",
    forceFeed: true,
  });
}

function attachProgressPublisher(supabase, session) {
  session.publishScrapeProgress = (opts) =>
    publishScrapeProgress(supabase, session, opts);
  session.publishScrapeWarning = (opts) =>
    publishScrapeWarning(supabase, session, opts);
  session.publishScrapeFailure = (opts) =>
    publishScrapeFailure(supabase, session, opts);
  session.publishScrapeCompleted = (opts) =>
    publishScrapeCompleted(supabase, session, opts);
}

module.exports = {
  SCRAPE_STAGES,
  attachProgressPublisher,
  publishScrapeProgress,
  publishScrapeWarning,
  publishScrapeFailure,
  publishScrapeCompleted,
  buildNormalizedEvent,
  shouldInsertFeedEvent,
  defaultDedupeKey,
  clearFeedDedupe,
};
