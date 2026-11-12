"use strict";

/** Worker rpc interface over the PGlite harness, executed as service_role (same calls as supabaseWorkerRpc). */
function pgliteWorkerRpc(h, { mode = null } = {}) {
  const svc = (sql, params) => h.svc(sql, params);
  return {
    async claim(workerId, ttl) {
      const j = mode
        ? await svc(`SELECT to_jsonb(j) FROM claim_permit_sync_job_v2($1, $2, $3) j`, [workerId, ttl, mode])
        : await svc(`SELECT to_jsonb(j) FROM claim_permit_sync_job($1, $2) j`, [workerId, ttl]);
      return j && j.id ? j : null;
    },
    heartbeat: (jobId, workerId, ttl, checkpoint) =>
      svc(`SELECT heartbeat_permit_sync_job($1, $2, $3, $4::jsonb)`, [jobId, workerId, ttl, JSON.stringify(checkpoint)]),
    log: (jobId, workerId, level, code, message, data) =>
      svc(`SELECT log_permit_sync_event($1, $2, $3, $4, $5, $6::jsonb)`, [jobId, workerId, level, code, message, data ? JSON.stringify(data) : null]),
    finish: (jobId, workerId, outcome, code, message, metrics, retryable, retryAfter) =>
      svc(`SELECT to_jsonb(finish_permit_sync_job($1, $2, $3, $4, $5, $6::jsonb, $7, $8))`,
        [jobId, workerId, outcome, code, message, metrics ? JSON.stringify(metrics) : null, Boolean(retryable), retryAfter]),
    applyDiscovery: (d) => h.rpc("apply_permit_discovery", d),
    applyBatch: (b) => h.rpc("apply_permit_sync_batch", b),
    progress: (jobId, workerId, report) =>
      svc(`SELECT report_permit_sync_progress($1, $2, $3::jsonb)`, [jobId, workerId, JSON.stringify(report)]),
    release: (jobId, workerId, reason, checkpoint, retryAfter) =>
      svc(`SELECT release_permit_sync_job($1, $2, $3, $4::jsonb, $5)`, [jobId, workerId, reason, checkpoint ? JSON.stringify(checkpoint) : null, retryAfter]),
    workerBeat: (workerId, status, jobId, details) =>
      svc(`SELECT permit_sync_worker_heartbeat($1, $2, $3, $4, $5::jsonb)`, [workerId, mode || "json", status, jobId || null, JSON.stringify(details || {})]),
  };
}

module.exports = { pgliteWorkerRpc };
