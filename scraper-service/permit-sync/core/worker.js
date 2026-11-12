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
 *
 * Progress (D-096) goes to `rpc.progress` when the rpc has it; a failed progress write never fails the run.
 * `signal` (shutdown, D-098): checked before each permit and passed to afterPermit; an aborted run releases
 * the job (attempt given back, checkpoint kept) instead of finishing it.
 */

const { buildBatch, buildDiscovery } = require("./ingest");
const { classify, safeMessage, LeaseLostError, ShutdownError } = require("./errors");

const ABORT_CODES = new Set(["safety_violation", "session_ended", "rate_limited", "mfa_required", "captcha", "auth_failed"]);

/**
 * D-086: a deep job that finished but left something behind is completed_with_warnings: reports or files
 * that failed, guard refusals, and files or reports still pending, deferred or in back-off.
 */
const DEEP_WARNING_KEYS = Object.freeze([
  "reports_failed", "files_failed", "reports_guard_denied", "files_pending", "files_deferred_oversize", "files_failed_open", "reports_open",
]);

function deepWarnings(deep) {
  if (!deep) return [];
  return DEEP_WARNING_KEYS.filter((k) => Number(deep[k]) > 0);
}

/** Terminal per-permit phase from the permit's deep metrics and batch warnings. */
function permitOutcome(extra, warnings) {
  return deepWarnings(extra).length || Number(extra && extra.reports_failed) > 0 || warnings > 0 ? "completed_with_warnings" : "completed";
}

/** Best-effort progress writer over rpc.progress (absent in older rpc implementations). */
function createProgress(rpc, job, workerId) {
  if (!rpc || typeof rpc.progress !== "function") return { job: async () => {}, permit: async () => {} };
  const send = (report) => rpc.progress(job.id, workerId, report).catch(() => false);
  return {
    job: (phase, extra = {}) => send({ phase, ...extra }),
    permit: (portalRecordId, fields) => send({ permits: [{ portal_record_id: String(portalRecordId), ...fields }] }),
  };
}

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

async function runJob({ job, rpc, openAdapter, workerId, leaseTtlSeconds = 300, now = () => Date.now(), scope: workerScope = null, signal = null, pauseMs = 0, sleep = null }) {
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
  const progress = createProgress(rpc, job, workerId);
  const wait = sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const stopIfShuttingDown = () => {
    if (signal && signal.aborted) throw new ShutdownError();
  };

  let session = null;
  try {
    if (scope && scope.length === 0) {
      metrics.duration_ms = now() - started;
      await rpc.finish(job.id, workerId, "failed_unrecoverable", "scope_empty", "the job scope and the worker filter share no permit", metrics, false, null);
      return { outcome: "failed_unrecoverable", code: "scope_empty", metrics, checkpoint };
    }
    if (scope) metrics.scope = scope;
    stopIfShuttingDown();
    session = await openAdapter(job);
    const { adapter } = session;

    if (!checkpoint.discovered) {
      await progress.job("discovering");
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

    // Rows for every permit this run will process (new permits included); existing rows keep their phase.
    const todo = checkpoint.discovered.map((r) => String(r.portal_record_id))
      .filter((id) => !checkpoint.done.includes(id) && (!scope || scope.includes(id)));
    for (let i = 0; i < todo.length; i += 200) {
      await progress.job("processing", { permits: todo.slice(i, i + 200).map((id) => ({ portal_record_id: id })) });
    }
    if (!todo.length) await progress.job("processing");
    let processed = 0;
    for (const record of checkpoint.discovered) {
      const id = record.portal_record_id;
      if (checkpoint.done.includes(id)) continue;
      if (scope && !scope.includes(String(id))) {
        metrics.permits_out_of_scope = (metrics.permits_out_of_scope || 0) + 1;
        continue;
      }
      stopIfShuttingDown();
      if (processed > 0 && pauseMs > 0) await wait(pauseMs);
      processed += 1;
      await progress.job("processing", { current_portal_record_id: String(id) });
      await progress.permit(id, { phase: "reading_info" });
      let permitWarnings = 0;
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
        permitWarnings += warnings.length;
        for (const [name, s] of Object.entries(res.sections || {})) {
          const tally = metrics.sections[name] || (metrics.sections[name] = emptySectionTally());
          tally[s.status] = (tally[s.status] || 0) + 1;
          if (s.status === "partial" || s.status === "failed" || s.status === "suspect_empty") permitWarnings += 1;
        }
        metrics.permits_ok += 1;
        let extra = null;
        if (typeof session.afterPermit === "function") {
          try {
            // 3d: the deep pass renews the lease while it runs; false = the lease is gone (cancel or reclaim).
            const heartbeat = () => rpc.heartbeat(job.id, workerId, leaseTtlSeconds, checkpoint);
            extra = await session.afterPermit({ record, batch, result: res, job, event, heartbeat, signal, progress: (fields) => progress.permit(id, fields) });
            const deep = metrics.deep || (metrics.deep = {});
            for (const [k, v] of Object.entries(extra || {})) if (typeof v === "number") deep[k] = (deep[k] || 0) + v;
          } catch (err) {
            if (err instanceof LeaseLostError || ABORT_CODES.has(err && err.code) || err instanceof ShutdownError) throw err;
            metrics.deep_failed = (metrics.deep_failed || 0) + 1;
            checkpoint.failed[id] = (checkpoint.failed[id] || 0) + 1;
            await event("error", "deep_pass_failed", safeMessage(err), { portal_record_id: id });
            await progress.permit(id, { phase: "failed", error_code: "deep_pass_failed", message: safeMessage(err).slice(0, 300) });
            await beat();
            continue;
          }
        }
        checkpoint.done.push(id);
        const outcome = permitOutcome(extra, permitWarnings);
        await progress.permit(id, {
          phase: outcome,
          error_code: null,
          message: extra && extra.deep_skipped ? "no portal changes; nothing new to capture" : null,
        });
      } catch (err) {
        if (err instanceof LeaseLostError || ABORT_CODES.has(err && err.code) || err instanceof ShutdownError) throw err;
        metrics.permits_failed += 1;
        checkpoint.failed[id] = (checkpoint.failed[id] || 0) + 1;
        await event("error", "permit_failed", safeMessage(err), { portal_record_id: id });
        await progress.permit(id, { phase: "failed", error_code: (err && err.code) || "permit_failed", message: safeMessage(err).slice(0, 300) });
      }
      await beat();
    }

    await progress.job("finishing", { current_portal_record_id: null });
    metrics.duration_ms = now() - started;
    const sectionIssues = Object.values(metrics.sections).reduce((n, t) => n + t.partial + t.failed + t.suspect_empty, 0);
    if (metrics.permits_ok === 0 && checkpoint.discovered.length > 0 && !(scope && metrics.permits_skipped_done > 0)) {
      await rpc.finish(job.id, workerId, "failed", "all_permits_failed", "every permit failed", metrics, true, null);
      return { outcome: "failed", metrics, checkpoint };
    }
    const deepIssues = deepWarnings(metrics.deep);
    if (deepIssues.length) metrics.deep_warnings = deepIssues;
    const outcome = metrics.permits_failed || metrics.deep_failed || sectionIssues || metrics.warnings || metrics.discovery_complete === false || deepIssues.length
      ? "completed_with_warnings" : "completed";
    await rpc.finish(job.id, workerId, outcome, null, null, metrics, false, null);
    return { outcome, metrics, checkpoint };
  } catch (err) {
    const c = classify(err);
    metrics.duration_ms = now() - started;
    if (c.outcome === null) return { outcome: "lease_lost", metrics, checkpoint };
    if (c.outcome === "release") {
      const released = typeof rpc.release === "function"
        ? await rpc.release(job.id, workerId, c.code, checkpoint, c.retryAfterSeconds).catch(() => false)
        : false;
      if (released) return { outcome: "released", code: c.code, metrics, checkpoint };
      // An rpc without release (older database): fall back to a retryable failure.
      await rpc.finish(job.id, workerId, "failed", c.code, safeMessage(err), metrics, true, c.retryAfterSeconds).catch(() => null);
      return { outcome: "failed", code: c.code, metrics, checkpoint };
    }
    await rpc.heartbeat(job.id, workerId, leaseTtlSeconds, checkpoint).catch(() => false);
    await rpc.finish(job.id, workerId, c.outcome, c.code, safeMessage(err), metrics, c.retryable, c.retryAfterSeconds);
    return { outcome: c.outcome, code: c.code, metrics, checkpoint };
  } finally {
    if (session && typeof session.close === "function") await session.close().catch(() => {});
  }
}

async function runOnce({ rpc, openAdapter, workerId, leaseTtlSeconds = 300, now, scope = null, signal = null, pauseMs = 0, sleep = null, onClaim = () => {} }) {
  const job = await rpc.claim(workerId, leaseTtlSeconds);
  if (!job) return { idle: true };
  onClaim(job);
  const result = await runJob({ job, rpc, openAdapter, workerId, leaseTtlSeconds, now, scope, signal, pauseMs, sleep });
  return { idle: false, jobId: job.id, ...result };
}

/** Long-running loop; resolves when `signal.aborted` becomes true, or after one claim attempt when `once`. */
async function runLoop({ rpc, openAdapter, workerId, leaseTtlSeconds = 300, idleMs = 60000, signal, sleep, onResult = () => {}, onClaim = () => {}, once = false, scope = null, pauseMs = 0 }) {
  const wait = sleep || ((ms) => abortableSleep(ms, signal));
  while (!(signal && signal.aborted)) {
    let result;
    try {
      result = await runOnce({ rpc, openAdapter, workerId, leaseTtlSeconds, scope, signal, pauseMs, onClaim });
    } catch (err) {
      result = { idle: true, error: safeMessage(err) };
    }
    onResult(result);
    if (once) return result;
    if (result.idle) await wait(idleMs);
  }
  return null;
}

/** Resolves after ms, or at once when the signal aborts (so shutdown does not wait out an idle sleep). */
function abortableSleep(ms, signal) {
  return new Promise((resolve) => {
    if (signal && signal.aborted) return resolve();
    const t = setTimeout(done, ms);
    function done() {
      clearTimeout(t);
      if (signal) signal.removeEventListener("abort", done);
      resolve();
    }
    if (signal) signal.addEventListener("abort", done, { once: true });
  });
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
    progress: (jobId, workerId, report) => call("report_permit_sync_progress", { p_job_id: jobId, p_worker_id: workerId, p_report: report }),
    release: (jobId, workerId, reason, checkpoint, retryAfter) =>
      call("release_permit_sync_job", { p_job_id: jobId, p_worker_id: workerId, p_reason: reason, p_checkpoint: checkpoint, p_retry_after_seconds: retryAfter }),
    workerBeat: (workerId, status, jobId, details) =>
      call("permit_sync_worker_heartbeat", { p_worker_id: workerId, p_mode: mode, p_status: status, p_job_id: jobId || null, p_details: details || {} }),
  };
}

module.exports = { runJob, runOnce, runLoop, supabaseWorkerRpc, jobScope, deepWarnings, permitOutcome, abortableSleep, DEEP_WARNING_KEYS };
