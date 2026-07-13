"use strict";

const scrapeEvents = require("../../../lib/scrape-events.js");

/**
 * Publish durable progress for a UCI portal sync job (no in-memory session).
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} opts
 * @param {string} opts.jobId
 * @param {string} opts.projectId
 * @param {string} opts.userMessage
 * @param {string} [opts.stage]
 * @param {string} [opts.status]
 * @param {number} [opts.progressCurrent]
 * @param {number} [opts.progressTotal]
 * @param {string} [opts.eventType]
 * @param {Record<string, unknown>} [opts.metadata]
 * @param {boolean} [opts.forceFeed]
 */
async function publishUciPortalSyncJobProgress(supabase, opts) {
  const jobId = String(opts.jobId || "").trim();
  const projectId = String(opts.projectId || "").trim();
  if (!jobId || !projectId) return null;

  const userMessage = String(opts.userMessage || "Working…").slice(0, 500);
  const stage = opts.stage ? String(opts.stage).slice(0, 80) : "portal_sync";
  const status = opts.status ? String(opts.status).slice(0, 40) : "running";
  const eventType = opts.eventType ? String(opts.eventType).slice(0, 80) : "section_progress";
  const now = new Date().toISOString();

  const jobPatch = {
    current_stage: stage,
    current_user_message: userMessage,
    last_heartbeat_at: now,
    last_activity_at: now,
    status,
  };
  if (opts.progressCurrent != null) jobPatch.progress_current = Number(opts.progressCurrent);
  if (opts.progressTotal != null) jobPatch.progress_total = Number(opts.progressTotal);

  await scrapeEvents.updateScrapeJob(supabase, jobId, jobPatch);

  return scrapeEvents.emitScrapeEvent(supabase, jobId, projectId, {
    event_type: eventType,
    stage,
    status,
    user_message: userMessage,
    progress_current: opts.progressCurrent ?? null,
    progress_total: opts.progressTotal ?? null,
    metadata: scrapeEvents.sanitizeMetadata({
      job_type: "uci_portal_sync",
      ...(opts.metadata || {}),
    }),
    skip_job_patch: true,
    forceFeed: opts.forceFeed,
  });
}

module.exports = {
  publishUciPortalSyncJobProgress,
};
