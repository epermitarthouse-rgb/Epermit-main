"use strict";

async function claimJob(supabase, workerId, leaseTtlSeconds) {
  const { data, error } = await supabase.rpc("claim_code_analyzer_ingestion_job", {
    p_worker_id: workerId,
    p_lease_ttl_seconds: leaseTtlSeconds,
  });
  if (error) throw new Error(error.message);
  return data ?? null;
}

async function heartbeatJob(supabase, jobId, workerId, leaseTtlSeconds) {
  const { data, error } = await supabase.rpc("heartbeat_code_analyzer_ingestion_job", {
    p_job_id: jobId,
    p_worker_id: workerId,
    p_lease_ttl_seconds: leaseTtlSeconds,
  });
  if (error) throw new Error(error.message);
  return Boolean(data);
}

async function releaseJob(supabase, params) {
  const { data, error } = await supabase.rpc("release_code_analyzer_ingestion_job", {
    p_job_id: params.jobId,
    p_worker_id: params.workerId,
    p_status: params.status,
    p_progress_phase: params.progressPhase ?? null,
    p_total_pages: params.totalPages ?? null,
    p_processed_pages: params.processedPages ?? null,
    p_failed_pages: params.failedPages ?? null,
    p_last_error: params.lastError ?? null,
    p_error_code: params.errorCode ?? null,
    p_progress_detail: params.progressDetail ?? null,
    p_available_at: params.availableAt ?? null,
  });
  if (error) throw new Error(error.message);
  return data ?? null;
}

module.exports = { claimJob, heartbeatJob, releaseJob };
