"use strict";

const { SCRAPE_STAGES } = require("./scrape-stages.js");

/** Durable scrape_jobs.status values emitted with terminal scrape_events. */
const TERMINAL_EVENT_STATUSES = {
  scrape_completed: "completed",
  scrape_failed: "failed",
  scrape_cancelled: "cancelled",
};

/**
 * Resolve durable job status for mirrorSessionProgress / setScrapeProgress.
 * Terminal event types must never default to "running".
 */
function resolveMirrorStatus(opts = {}) {
  if (opts.status) return opts.status;
  const eventType = opts.event_type ? String(opts.event_type) : "";
  if (TERMINAL_EVENT_STATUSES[eventType]) {
    return TERMINAL_EVENT_STATUSES[eventType];
  }
  return "running";
}

function inferStage(message, opts = {}) {
  if (opts.stage) return opts.stage;
  const m = `${message || ""}`.toLowerCase();
  if (m.includes("sync") || m.includes("saving")) return SCRAPE_STAGES.SAVING;
  if (m.includes("upload")) return SCRAPE_STAGES.UPLOADING;
  if (m.includes("download")) return SCRAPE_STAGES.DOWNLOADING;
  if (m.includes("report") || m.includes("discover")) {
    return SCRAPE_STAGES.DISCOVERING_RECORDS;
  }
  if (m.includes("search") || m.includes("targeting")) {
    return SCRAPE_STAGES.LOCATING_PROJECT;
  }
  if (m.includes("login")) return SCRAPE_STAGES.LOGGING_IN;
  if (m.includes("harvest") || m.includes("complete")) {
    return SCRAPE_STAGES.PROCESSING_RECORDS;
  }
  if (m.includes("→")) return SCRAPE_STAGES.LOADING_SECTION;
  return SCRAPE_STAGES.PROCESSING_RECORDS;
}

function inferEventType(message, opts) {
  if (opts.event_type) return opts.event_type;
  const m = `${message || ""}`.toLowerCase();
  if (m.includes("syncing")) return "save_started";
  if (m.includes("sync complete") || m.includes("complete!")) return "save_completed";
  if (m.includes("downloading")) return "download_progress";
  if (m.includes("searching")) return "permit_search_started";
  if (m.includes("complete")) return "section_completed";
  if (m.includes("→")) return "section_started";
  return "section_progress";
}

function inferEntity(message) {
  const m = `${message || ""}`;
  const fileMatch = m.match(/(?:file|downloading)\s*(\d+)\s*\/\s*(\d+)/i);
  if (fileMatch) {
    return {
      entityType: "file",
      current: Number(fileMatch[1]),
      total: Number(fileMatch[2]),
      dedupeKey: `file:${fileMatch[1]}`,
    };
  }
  const pageMatch = m.match(/page\s*(\d+)/i);
  if (pageMatch) {
    return {
      entityType: "page",
      entityName: `Page ${pageMatch[1]}`,
      dedupeKey: `page:${pageMatch[1]}`,
    };
  }
  const sectionMatch = m.match(/→\s*(.+)$/);
  if (sectionMatch) {
    const name = sectionMatch[1].trim();
    return {
      entityType: "section",
      entityName: name,
      dedupeKey: `section:${name.toLowerCase()}`,
    };
  }
  return {};
}

function humanizeSessionMessage(message, session) {
  const text = `${message || ""}`.trim();
  if (!text) return "Working…";

  const permit = session?._scrapePermitNumber || session?.permitNumber;
  if (text.includes("→ Searching")) {
    return permit ? `Searching for permit ${permit}.` : "Searching for permit record.";
  }
  if (/→ downloading/i.test(text)) {
    const match = text.match(/(\d+)\s*\/\s*(\d+)/);
    if (match) {
      return `Downloading file ${match[1]} of ${match[2]}.`;
    }
    return "Downloading files from the portal.";
  }
  if (text.includes("Syncing")) return "Saving results to your project.";
  if (text.includes("complete")) return text.replace(/^Error:\s*/i, "");
  if (text.includes("→")) {
    const section = text.split("→").pop()?.trim();
    if (section) return `Opening ${section}.`;
  }
  return text.replace(/^Error:\s*/i, "");
}

/**
 * Mirror in-memory session.message updates to durable scrape progress when a job is attached.
 * Non-throwing; safe to call anywhere session.message is assigned.
 */
function mirrorSessionProgress(session, message, opts = {}) {
  const text = message != null ? String(message) : "";
  session.message = text;
  if (typeof session.publishScrapeProgress !== "function") return;

  const entity = inferEntity(text);
  const userMessage = opts.user_message || humanizeSessionMessage(text, session);
  const stage = inferStage(text, opts);
  const durableStatus = resolveMirrorStatus(opts);

  void session
    .publishScrapeProgress({
      user_message: userMessage,
      event_type: opts.event_type || inferEventType(text, opts),
      stage,
      action: opts.action || opts.event_type || inferEventType(text, opts),
      status: durableStatus,
      technical_message: opts.technical_message || text,
      progress_current: opts.progress_current ?? entity.current ?? session.progress,
      progress_total: opts.progress_total ?? entity.total ?? session.total,
      entityType: opts.entityType || entity.entityType,
      entityName: opts.entityName || entity.entityName,
      dedupeKey: opts.dedupeKey || entity.dedupeKey,
      severity: opts.severity,
      forceFeed: opts.forceFeed,
      skipFeed: opts.skipFeed,
      metadata: opts.metadata,
    })
    .catch(() => {});
}

module.exports = {
  mirrorSessionProgress,
  resolveMirrorStatus,
  TERMINAL_EVENT_STATUSES,
  inferStage,
};
