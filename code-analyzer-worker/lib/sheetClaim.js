"use strict";

async function claimSheetJob(supabase, workerId, leaseTtlSeconds) {
  const { data, error } = await supabase.rpc("claim_code_analyzer_sheet_job", {
    p_worker_id: workerId,
    p_lease_ttl_seconds: leaseTtlSeconds,
  });
  if (error) throw new Error(error.message);
  return data ?? null;
}

async function heartbeatSheetJob(supabase, jobId, workerId, leaseTtlSeconds) {
  const { data, error } = await supabase.rpc("heartbeat_code_analyzer_sheet_job", {
    p_job_id: jobId,
    p_worker_id: workerId,
    p_lease_ttl_seconds: leaseTtlSeconds,
  });
  if (error) throw new Error(error.message);
  return Boolean(data);
}

async function completeSheetJob(
  supabase,
  { jobId, workerId, status, lastError, errorCode, availableAt },
) {
  const { data, error } = await supabase.rpc("complete_code_analyzer_sheet_job", {
    p_job_id: jobId,
    p_worker_id: workerId,
    p_status: status,
    p_last_error: lastError ?? null,
    p_error_code: errorCode ?? null,
    p_available_at: availableAt ?? null,
  });
  if (error) throw new Error(error.message);
  return data ?? null;
}

module.exports = { claimSheetJob, heartbeatSheetJob, completeSheetJob };
