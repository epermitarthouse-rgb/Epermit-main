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
 *
 * `triggerCentral({ permitId })` asks for the permit-level (central) pass of a synced permit, linked or not
 * (D-121). The edge function processes only comments whose input or processing version changed, within the
 * approved AI budget; while central processing is off it answers 403/503 and this returns 'disabled'.
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

  async function post(body) {
    let res;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceRoleKey}`, apikey: serviceRoleKey },
        body: JSON.stringify(body),
      });
    } catch (err) {
      return { error: `permit-comment-pipeline unreachable: ${String((err && err.message) || err).slice(0, 120)}` };
    }
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch (_) {
      data = null;
    }
    return { res, data };
  }

  /** @returns {Promise<{ outcome: 'disabled'|'skipped_duplicate'|'complete'|'failed', rounds: number, queued?: boolean, error?: string }>} */
  async function trigger({ projectId }) {
    if (!serviceSecret) return { outcome: "disabled", rounds: 0 };
    const { res, data, error } = await post({ action: "sweep", source: "deep_worker", project_ids: [projectId] });
    if (error) return { outcome: "failed", rounds: 1, error };
    if (!res.ok) {
      const msg = data && (data.error || data.message) ? String(data.error || data.message) : `HTTP ${res.status}`;
      return { outcome: "failed", rounds: 1, error: `permit-comment-pipeline: ${msg.slice(0, 160)}` };
    }
    const claimed = data && Number(data.claimed);
    return claimed > 0 ? { outcome: "complete", rounds: 1, queued: true } : { outcome: "skipped_duplicate", rounds: 1 };
  }

  /** @returns {Promise<{ outcome: 'disabled'|'skipped_duplicate'|'complete'|'failed', error?: string }>} */
  async function triggerCentral({ permitId }) {
    if (!serviceSecret || !permitId) return { outcome: "disabled" };
    const { res, data, error } = await post({ action: "central_sweep", source: "deep_worker", permit_ids: [permitId] });
    if (error) return { outcome: "failed", error };
    if (res.status === 403 || res.status === 503) return { outcome: "disabled" };
    if (!res.ok) {
      const msg = data && (data.error || data.message) ? String(data.error || data.message) : `HTTP ${res.status}`;
      return { outcome: "failed", error: `permit-comment-pipeline: ${msg.slice(0, 160)}` };
    }
    if (data && data.accepted === true) return { outcome: "complete" };
    return data && Number(data.claimed) > 0 ? { outcome: "complete" } : { outcome: "skipped_duplicate" };
  }

  return { trigger, triggerCentral };
}

module.exports = { createCommentPipelineDispatcher };
