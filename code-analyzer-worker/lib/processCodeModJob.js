"use strict";

/**
 * Milestone 7 foundation: code modification jobs are claimed separately from sheet jobs.
 * Full per-evidence-sheet merge is handled incrementally; form extraction uses storage refs.
 */
async function processCodeModJob({ supabase, job, workerId }) {
  const payload = job.payload || {};
  console.log(
    `[code-analyzer-worker] code mod job ${job.id} type=${job.job_type} run=${job.run_id}`,
  );

  if (job.job_type === "form_extraction") {
    // Storage-reference form extraction — no giant base64 in browser.
    const { data: doc } = await supabase
      .from("project_documents")
      .select("file_path, file_name")
      .eq("id", job.document_id)
      .single();
    if (!doc?.file_path) throw new Error("Form document not found");

    await supabase
      .from("code_analyzer_code_mod_jobs")
      .update({
        status: "completed",
        result: { file_path: doc.file_path, file_name: doc.file_name, claims_only: true },
        completed_at: new Date().toISOString(),
        lease_owner: null,
        lease_expires_at: null,
      })
      .eq("id", job.id)
      .eq("lease_owner", workerId);
    return;
  }

  if (job.job_type === "evidence_sheet") {
    const { processSheetJob } = require("./processSheetJob");
    const syntheticSheetJob = {
      id: job.id,
      project_id: job.project_id,
      run_id: job.run_id,
      sheet_id: job.sheet_id,
      analysis_mode: payload.analysis_mode || "ibc",
      attempt_count: job.attempt_count,
      max_attempts: job.max_attempts,
    };
    await processSheetJob({
      supabase,
      job: syntheticSheetJob,
      workerId,
      leaseTtlSeconds: 180,
    });
    await supabase
      .from("code_analyzer_code_mod_jobs")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
        lease_owner: null,
        lease_expires_at: null,
      })
      .eq("id", job.id);
    return;
  }

  await supabase
    .from("code_analyzer_code_mod_jobs")
    .update({
      status: "completed",
      completed_at: new Date().toISOString(),
      lease_owner: null,
      lease_expires_at: null,
    })
    .eq("id", job.id)
    .eq("lease_owner", workerId);
}

async function claimCodeModJob(supabase, workerId, leaseTtlSeconds) {
  const { data, error } = await supabase.rpc("claim_code_analyzer_code_mod_job", {
    p_worker_id: workerId,
    p_lease_ttl_seconds: leaseTtlSeconds,
  });
  if (error) throw new Error(error.message);
  return data ?? null;
}

module.exports = { processCodeModJob, claimCodeModJob };
