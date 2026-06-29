#!/usr/bin/env node
"use strict";

/**
 * Re-evaluate and terminalize a stuck Arlington verify-loop job from persisted portal_data.
 * Usage: node scripts/reterminalize-arlington-job.js --job-id=<uuid> [--dry-run]
 */

const { getSupabaseAdmin } = require("../lib/supabase-admin.js");
const { verifyArlingtonJobCompletion } = require("../lib/arlington-orchestration.js");
const { evaluateArlingtonJobCompletion } = require("../lib/arlington-completion-evaluator.js");
const { finalizeJobFromVerification } = require("../lib/arlington-job-store.js");

function parseArgs(argv) {
  const args = { dryRun: false, jobId: null };
  for (const arg of argv.slice(2)) {
    if (arg === "--dry-run") args.dryRun = true;
    else if (arg.startsWith("--job-id=")) args.jobId = arg.slice("--job-id=".length);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.jobId) {
    console.error("Usage: node scripts/reterminalize-arlington-job.js --job-id=<uuid> [--dry-run]");
    process.exit(1);
  }

  const supabase = getSupabaseAdmin();
  const { data: job, error } = await supabase
    .from("scrape_jobs")
    .select("*")
    .eq("id", args.jobId)
    .maybeSingle();
  if (error) throw error;
  if (!job) {
    console.error(`Job not found: ${args.jobId}`);
    process.exit(1);
  }

  const { data: project } = await supabase
    .from("projects")
    .select("portal_data")
    .eq("id", job.project_id)
    .maybeSingle();

  const evaluation = evaluateArlingtonJobCompletion(job, project?.portal_data || {});
  console.log(JSON.stringify({ evaluation }, null, 2));

  const verification = await verifyArlingtonJobCompletion(supabase, {
    projectId: job.project_id,
    userId: job.user_id,
    permitNumber: job.permit_number,
    requestedScope: job.requested_scope,
    job,
  });

  if (args.dryRun) {
    console.log(JSON.stringify({ dryRun: true, verification }, null, 2));
    return;
  }

  if (!verification.complete && !verification.terminalPartial && verification.hasRetryableWork) {
    console.error("Job still has retryable work; not auto-terminalizing.");
    process.exit(2);
  }

  const result = await finalizeJobFromVerification(supabase, job, verification);
  console.log(JSON.stringify({ finalized: true, result, verification }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
