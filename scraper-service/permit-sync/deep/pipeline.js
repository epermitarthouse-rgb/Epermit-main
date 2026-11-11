"use strict";

/**
 * Starts the agent pipeline for a linked project after the deep pass changed its portal data (D-063).
 * The same loop the browser runs (AgentWorkflowStatus runChainedPipeline), as a service call:
 *   Authorization: Bearer <service role key>, x-permitpilot-service-secret, x-permitpilot-acting-user = owner.
 * Skipped when project_pipeline_runs already has this hash (running or completed): the browser's Realtime
 * trigger and this driver use the same idempotency key, so a hash is processed once.
 */

const ACTIVE_OR_DONE = ["pending", "running", "completed", "completed_with_warnings"];
const RETRY_ACTIONS = new Set(["retry_parser", "retry_classifier", "retry_enrichment", "retry_routing"]);

function idempotencyKey(hash) {
  return `hash:${hash}`;
}

/** @returns {Promise<boolean>} */
async function pipelineAlreadyRan(supabase, projectId, hash) {
  const { data, error } = await supabase
    .from("project_pipeline_runs")
    .select("id, status")
    .eq("project_id", projectId)
    .eq("idempotency_key", idempotencyKey(hash))
    .in("status", ACTIVE_OR_DONE)
    .limit(1);
  if (error) throw new Error(`project_pipeline_runs: ${error.message}`);
  return Boolean(data && data.length);
}

/**
 * @param {object} deps
 * @param {Function} deps.fetch                   injected (tests never call anything real)
 * @param {string} deps.supabaseUrl
 * @param {string} deps.serviceRoleKey
 * @param {string} deps.serviceSecret             PERMITPILOT_SERVICE_PIPELINE_SECRET
 * @param {object} deps.supabase                  service-role client for the dedupe read
 * @param {Function} [deps.sleep]
 * @param {number} [deps.maxRounds]
 * @param {number} [deps.pollIntervalMs]
 */
function createPipelineDriver({ fetch, supabaseUrl, serviceRoleKey, serviceSecret, supabase, sleep, maxRounds = 120, pollIntervalMs = 2500 }) {
  if (typeof fetch !== "function") throw new Error("fetch is required");
  const wait = sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const url = `${String(supabaseUrl || "").replace(/\/$/, "")}/functions/v1/intake-pipeline-agent`;

  async function call(ownerUserId, body) {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serviceRoleKey}`,
        apikey: serviceRoleKey,
        "x-permitpilot-service-secret": serviceSecret,
        "x-permitpilot-acting-user": ownerUserId,
      },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch (_) {
      data = null;
    }
    if (!res.ok) {
      const msg = data && (data.error || data.message) ? String(data.error || data.message) : `HTTP ${res.status}`;
      const err = new Error(`intake-pipeline-agent: ${msg.slice(0, 200)}`);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  /**
   * Without a service secret the trigger is off ('disabled'); the browser trigger still works as before.
   * @returns {Promise<{ outcome: 'disabled'|'skipped_duplicate'|'complete'|'failed'|'stale_run'|'max_rounds'|'unknown_action', rounds: number, pipelineRunId?: string, error?: string }>}
   */
  async function trigger({ projectId, ownerUserId, portalDataHash }) {
    if (!serviceSecret) return { outcome: "disabled", rounds: 0 };
    if (await pipelineAlreadyRan(supabase, projectId, portalDataHash)) return { outcome: "skipped_duplicate", rounds: 0 };
    let cursor;
    let pipelineRunId;
    for (let round = 0; round < maxRounds; round += 1) {
      const data = await call(ownerUserId, {
        project_id: projectId,
        is_shadow_mode: false,
        portal_data_hash: portalDataHash,
        ...(pipelineRunId ? { pipeline_run_id: pipelineRunId } : {}),
        ...(!cursor && !pipelineRunId ? { full_refresh: true } : {}),
        ...(cursor ? { cursor } : {}),
      });
      if (data == null) return { outcome: "failed", rounds: round + 1, pipelineRunId, error: "empty response" };
      pipelineRunId = data.pipeline_run_id || pipelineRunId;
      const action = data.next_action || "poll_again";
      const cp = data.comment_parser || null;
      if (action === "complete") return { outcome: "complete", rounds: round + 1, pipelineRunId };
      if (RETRY_ACTIONS.has(action)) return { outcome: "failed", rounds: round + 1, pipelineRunId, error: action };
      if (action === "stale_run") return { outcome: "stale_run", rounds: round + 1, pipelineRunId };
      if (action !== "poll_again" && action !== "continue_enrichment" && action !== "continue") {
        return { outcome: "unknown_action", rounds: round + 1, pipelineRunId, error: String(action).slice(0, 60) };
      }
      cursor = cp && cp.error !== "timeout" && cp.next_cursor != null && !cp.done ? cp.next_cursor : undefined;
      await wait(pollIntervalMs);
    }
    return { outcome: "max_rounds", rounds: maxRounds, pipelineRunId };
  }

  return { trigger };
}

module.exports = { createPipelineDriver, pipelineAlreadyRan, idempotencyKey };
