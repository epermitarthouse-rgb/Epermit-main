"use strict";

/**
 * Jurisdiction-agnostic permit sync worker (D-007): one job = one source credential run.
 *
 *   claim → open adapter (login) → discovery (skipped when the checkpoint already has it)
 *         → per permit: fetchPermit → buildBatch → apply → checkpoint + heartbeat
 *         → finish with metrics
 *
 * A permit-level failure is recorded and the run continues; guard violations, session loss and
 * rate limiting abort the run. Losing the lease (cancel/reclaim) stops the run without finishing.
 *
 * `rpc` is the service-role database interface (see supabaseWorkerRpc below, and the PGlite
 * implementation in tests/helpers/permit-sync-rpc.js).
 *
 * An adapter session may add `afterPermit({ record, batch, result, job, event })` (the DC deep pass, D-055).
 * It runs after the permit's batch is applied; its numeric result is summed into `metrics.deep`. If it
 * throws, the permit is not checkpointed as done, so a retry repeats it (the JSON pass is then a no-op).
 */

const { buildBatch, buildDiscovery } = require("./ingest");
const { classify, safeMessage, LeaseLostError } = require("./errors");

const ABORT_CODES = new Set(["safety_violation", "session_ended", "rate_limited", "mfa_required", "captcha", "auth_failed"]);

function emptySectionTally() {
  return { ok: 0, partial: 0, absent: 0, failed: 0, suspect_empty: 0 };
}

/**
 * Portal record ids this job may process (D-074): the job's `options.only_portal_record_ids`, narrowed by the
 * worker's own filter (PERMIT_SYNC_ONLY_PORTAL_RECORD_IDS). null = every discovered permit.
 */
function jobScope(job, workerScope = null) {
  const fromJob = job && job.options && Array.isArray(job.options.only_portal_record_ids)
    ? job.options.only_portal_record_ids.map(String) : null;
  const fromWorker = Array.isArray(workerScope) && workerScope.length ? workerScope.map(String) : null;
  if (fromJob && fromWorker) return fromJob.filter((id) => fromWorker.includes(id));
  return fromJob || fromWorker;
}

async function runJob({ job, rpc, openAdapter, workerId, leaseTtlSeconds = 300, now = () => Date.now(), scope: workerScope = null }) {
  const started = now();
  const scope = jobScope(job, workerScope);
  const checkpoint = { done: [], failed: {}, ...(job.checkpoint || {}) };
  const metrics = {
    attempt: job.attempt_count,
    discovered: checkpoint.discovered ? checkpoint.discovered.length : 0,
    expected_total: checkpoint.expected_total ?? null,
    discovery_complete: checkpoint.discovery_complete ?? null,
    permits_ok: 0,
    permits_failed: 0,
    permits_skipped_done: checkpoint.done.length,
    changes: 0,
    snapshots_inserted: 0,
    warnings: 0,
    sections: {},
  };

  const beat = async () => {
    const ok = await rpc.heartbeat(job.id, workerId, leaseTtlSeconds, checkpoint);
    if (!ok) throw new LeaseLostError();
  };
  const event = (level, code, message, data) => rpc.log(job.id, workerId, level, code, message, data).catch(() => false);

  let session = null;
  try {
    if (scope && scope.length === 0) {
      metrics.duration_ms = now() - started;
      await rpc.finish(job.id, workerId, "failed_unrecoverable", "scope_empty", "the job scope and the worker filter share no permit", metrics, false, null);
      return { outcome: "failed_unrecoverable", code: "scope_empty", metrics, checkpoint };
    }
    if (scope) metrics.scope = scope;
    session = await openAdapter(job);
    const { adapter } = session;

    if (!checkpoint.discovered) {
      const d = await adapter.discover();
      const discovery = buildDiscovery({
        adapterKey: adapter.key, credentialId: job.credential_id, runId: job.id,
        records: d.records, expectedTotal: d.expectedTotal, complete: d.complete,
      });
      const res = await rpc.applyDiscovery(discovery);
      checkpoint.discovered = d.records.map((r) => ({ portal_record_id: r.portal_record_id, fields: r.fields }));
      checkpoint.expected_total = d.expectedTotal;
      checkpoint.discovery_complete = res.complete;
      metrics.discovered = d.records.length;
      metrics.expected_total = d.expectedTotal;
      metrics.discovery_complete = res.complete;
      if (!res.complete) {
        metrics.warnings += 1;
        await event("warn", "discovery_incomplete", `${d.records.length}/${d.expectedTotal}`, { skipped: d.skipped || [] });
      }
      await beat();
    }

    if (scope && !checkpoint.discovered.some((r) => scope.includes(String(r.portal_record_id)))) {
      metrics.duration_ms = now() - started;
      await rpc.finish(job.id, workerId, "failed_unrecoverable", "scope_not_found", "no permit in the job scope was discovered", metrics, false, null);
      return { outcome: "failed_unrecoverable", code: "scope_not_found", metrics, checkpoint };
    }

    for (const record of checkpoint.discovered) {
      const id = record.portal_record_id;
      if (checkpoint.done.includes(id)) continue;
      if (scope && !scope.includes(String(id))) {
        metrics.permits_out_of_scope = (metrics.permits_out_of_scope || 0) + 1;
        continue;
      }
      try {
        const { sections } = await adapter.fetchPermit(record);
        const { batch, warnings } = buildBatch({
          adapterKey: adapter.key, credentialId: job.credential_id, runId: job.id,
          portalRecordId: id, permitFields: record.fields, sections,
        });
        const res = await rpc.applyBatch(batch);
        metrics.changes += res.changes || 0;
        metrics.snapshots_inserted += res.snapshots_inserted || 0;
        metrics.warnings += warnings.length;
        for (const [name, s] of Object.entries(res.sections || {})) {
          const tally = metrics.sections[name] || (metrics.sections[name] = emptySectionTally());
          tally[s.status] = (tally[s.status] || 0) + 1;
        }
        metrics.permits_ok += 1;
        if (typeof session.afterPermit === "function") {
          try {
            const extra = await session.afterPermit({ record, batch, result: res, job, event });
            const deep = metrics.deep || (metrics.deep = {});
            for (const [k, v] of Object.entries(extra || {})) if (typeof v === "number") deep[k] = (deep[k] || 0) + v;
          } catch (err) {
            if (err instanceof LeaseLostError || ABORT_CODES.has(err && err.code)) throw err;
            metrics.deep_failed = (metrics.deep_failed || 0) + 1;
            checkpoint.failed[id] = (checkpoint.failed[id] || 0) + 1;
            await event("error", "deep_pass_failed", safeMessage(err), { portal_record_id: id });
            await beat();
            continue;
          }
        }
        checkpoint.done.push(id);
      } catch (err) {
        if (err instanceof LeaseLostError || ABORT_CODES.has(err && err.code)) throw err;
        metrics.permits_failed += 1;
        checkpoint.failed[id] = (checkpoint.failed[id] || 0) + 1;
        await event("error", "permit_failed", safeMessage(err), { portal_record_id: id });
      }
      await beat();
    }

    metrics.duration_ms = now() - started;
    const sectionIssues = Object.values(metrics.sections).reduce((n, t) => n + t.partial + t.failed + t.suspect_empty, 0);
    if (metrics.permits_ok === 0 && checkpoint.discovered.length > 0 && !(scope && metrics.permits_skipped_done > 0)) {
      await rpc.finish(job.id, workerId, "failed", "all_permits_failed", "every permit failed", metrics, true, null);
      return { outcome: "failed", metrics, checkpoint };
    }
    const outcome = metrics.permits_failed || metrics.deep_failed || sectionIssues || metrics.warnings || metrics.discovery_complete === false
      ? "completed_with_warnings" : "completed";
    await rpc.finish(job.id, workerId, outcome, null, null, metrics, false, null);
    return { outcome, metrics, checkpoint };
  } catch (err) {
    const c = classify(err);
    metrics.duration_ms = now() - started;
    if (c.outcome === null) return { outcome: "lease_lost", metrics, checkpoint };
    await rpc.heartbeat(job.id, workerId, leaseTtlSeconds, checkpoint).catch(() => false);
    await rpc.finish(job.id, workerId, c.outcome, c.code, safeMessage(err), metrics, c.retryable, c.retryAfterSeconds);
    return { outcome: c.outcome, code: c.code, metrics, checkpoint };
  } finally {
    if (session && typeof session.close === "function") await session.close().catch(() => {});
  }
}

async function runOnce({ rpc, openAdapter, workerId, leaseTtlSeconds = 300, now, scope = null }) {
  const job = await rpc.claim(workerId, leaseTtlSeconds);
  if (!job) return { idle: true };
  const result = await runJob({ job, rpc, openAdapter, workerId, leaseTtlSeconds, now, scope });
  return { idle: false, jobId: job.id, ...result };
}

/** Long-running loop; resolves when `signal.aborted` becomes true, or after one claim attempt when `once`. */
async function runLoop({ rpc, openAdapter, workerId, leaseTtlSeconds = 300, idleMs = 60000, signal, sleep, onResult = () => {}, once = false, scope = null }) {
  const wait = sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  while (!(signal && signal.aborted)) {
    let result;
    try {
      result = await runOnce({ rpc, openAdapter, workerId, leaseTtlSeconds, scope });
    } catch (err) {
      result = { idle: true, error: safeMessage(err) };
    }
    onResult(result);
    if (once) return result;
    if (result.idle) await wait(idleMs);
  }
  return null;
}

/**
 * supabase-js (service role) implementation of the worker rpc interface.
 * Deep workers claim only deep jobs through claim_permit_sync_job_v2 (D-073); JSON workers keep the
 * two-argument RPC, which returns JSON jobs only once the deep-capture migration is applied.
 */
function supabaseWorkerRpc(client, { mode = "json" } = {}) {
  const call = async (fn, args) => {
    const { data, error } = await client.rpc(fn, args);
    if (error) throw new Error(`${fn}: ${error.message}`);
    return data;
  };
  return {
    claim: async (workerId, ttl) => {
      const job = mode === "deep"
        ? await call("claim_permit_sync_job_v2", { p_worker_id: workerId, p_lease_ttl_seconds: ttl, p_worker_mode: "deep" })
        : await call("claim_permit_sync_job", { p_worker_id: workerId, p_lease_ttl_seconds: ttl });
      if (!job || !job.id) return null;
      if ((job.worker_mode || "json") !== mode) throw new Error(`claimed a ${job.worker_mode} job in ${mode} mode`);
      return job;
    },
    heartbeat: (jobId, workerId, ttl, checkpoint) =>
      call("heartbeat_permit_sync_job", { p_job_id: jobId, p_worker_id: workerId, p_lease_ttl_seconds: ttl, p_checkpoint: checkpoint }),
    log: (jobId, workerId, level, code, message, data) =>
      call("log_permit_sync_event", { p_job_id: jobId, p_worker_id: workerId, p_level: level, p_code: code, p_message: message, p_data: data || null }),
    finish: (jobId, workerId, outcome, code, message, metrics, retryable, retryAfter) =>
      call("finish_permit_sync_job", {
        p_job_id: jobId, p_worker_id: workerId, p_outcome: outcome, p_error_code: code, p_last_error: message,
        p_metrics: metrics, p_retryable: retryable, p_retry_after_seconds: retryAfter,
      }),
    applyDiscovery: (d) => call("apply_permit_discovery", { p_discovery: d }),
    applyBatch: (b) => call("apply_permit_sync_batch", { p_batch: b }),
  };
}

module.exports = { runJob, runOnce, runLoop, supabaseWorkerRpc, jobScope };
