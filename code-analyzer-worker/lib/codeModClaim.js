"use strict";

async function claimCodeModJob(supabase, workerId, leaseTtlSeconds) {
  const { data, error } = await supabase.rpc("claim_code_analyzer_code_mod_job", {
    p_worker_id: workerId,
    p_lease_ttl_seconds: leaseTtlSeconds,
  });
  if (error) throw new Error(error.message);
  return data ?? null;
}

async function completeCodeModJob(
  supabase,
  { jobId, workerId, status, result, lastError, availableAt },
) {
  const { data, error } = await supabase.rpc("complete_code_analyzer_code_mod_job", {
    p_job_id: jobId,
    p_worker_id: workerId,
    p_status: status,
    p_result: result ?? null,
    p_last_error: lastError ?? null,
    p_available_at: availableAt ?? null,
  });
  if (error) throw new Error(error.message);
  return data ?? null;
}

module.exports = { claimCodeModJob, completeCodeModJob };
