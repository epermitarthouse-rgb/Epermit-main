"use strict";

/**
 * Hands a linked project to the permit-comment-pipeline edge function after a deep pass (D-113), instead of
 * driving intake-pipeline-agent from the worker (deep/pipeline.js). The edge function decides whether the
 * project's linked-permit comment content changed since the last completed run, so a re-scrape that changes
 * nothing (or flips projects.portal_data_hash, D-101) starts nothing. Same `trigger()` shape as
 * createPipelineDriver so runner.js is unchanged:
 *   'complete'          the project was handed off (processing continues server-side)
 *   'skipped_duplicate' nothing new to process (or already being processed)
 *   'disabled'          no service secret configured: the worker trigger stays off
 *   'failed'            the edge function refused or was unreachable
 */

/**
 * @param {object} deps
 * @param {Function} deps.fetch
 * @param {string} deps.supabaseUrl
 * @param {string} deps.serviceRoleKey
 * @param {string} deps.serviceSecret   PERMITPILOT_SERVICE_PIPELINE_SECRET; presence switches the trigger on
 */
function createCommentPipelineDispatcher({ fetch, supabaseUrl, serviceRoleKey, serviceSecret }) {
  if (typeof fetch !== "function") throw new Error("fetch is required");
  const url = `${String(supabaseUrl || "").replace(/\/$/, "")}/functions/v1/permit-comment-pipeline`;

  /** @returns {Promise<{ outcome: 'disabled'|'skipped_duplicate'|'complete'|'failed', rounds: number, queued?: boolean, error?: string }>} */
  async function trigger({ projectId }) {
    if (!serviceSecret) return { outcome: "disabled", rounds: 0 };
    let res;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceRoleKey}`, apikey: serviceRoleKey },
        body: JSON.stringify({ action: "sweep", source: "deep_worker", project_ids: [projectId] }),
      });
    } catch (err) {
      return { outcome: "failed", rounds: 1, error: `permit-comment-pipeline unreachable: ${String((err && err.message) || err).slice(0, 120)}` };
    }
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch (_) {
      data = null;
    }
    if (!res.ok) {
      const msg = data && (data.error || data.message) ? String(data.error || data.message) : `HTTP ${res.status}`;
      return { outcome: "failed", rounds: 1, error: `permit-comment-pipeline: ${msg.slice(0, 160)}` };
    }
    const claimed = data && Number(data.claimed);
    return claimed > 0 ? { outcome: "complete", rounds: 1, queued: true } : { outcome: "skipped_duplicate", rounds: 1 };
  }

  return { trigger };
}

module.exports = { createCommentPipelineDispatcher };
