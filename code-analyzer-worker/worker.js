"use strict";

require("dotenv").config();

const { randomUUID } = require("crypto");
const { getSupabaseAdmin, preferIpv4Dns } = require("./lib/supabase");
const { claimJob, heartbeatJob, releaseJob } = require("./lib/claim");
const { processIngestionJob } = require("./lib/processIngestionJob");
const { claimSheetJob } = require("./lib/sheetClaim");
const { processSheetJob, SHEET_CONCURRENCY } = require("./lib/processSheetJob");
const { claimCodeModJob, processCodeModJob } = require("./lib/processCodeModJob");

const POLL_MS = Number(process.env.CODE_ANALYZER_POLL_INTERVAL_MS) || 3000;
const INGESTION_CONCURRENCY = Math.max(1, Number(process.env.CODE_ANALYZER_CONCURRENCY) || 2);
const LEASE_TTL_SECONDS = Number(process.env.CODE_ANALYZER_LEASE_TTL_SECONDS) || 180;
const WORKER_ID =
  process.env.CODE_ANALYZER_WORKER_ID || `code-analyzer-worker-${randomUUID().slice(0, 8)}`;
const WORKER_VERSION = process.env.CODE_ANALYZER_WORKER_VERSION || "2.0.0";

let activeIngestion = 0;
let activeSheets = 0;
let activeCodeMod = 0;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function runIngestionJob(job) {
  const supabase = getSupabaseAdmin();
  try {
    await processIngestionJob({
      supabase,
      job,
      workerId: WORKER_ID,
      workerVersion: WORKER_VERSION,
      leaseTtlSeconds: LEASE_TTL_SECONDS,
      heartbeat: () => heartbeatJob(supabase, job.id, WORKER_ID, LEASE_TTL_SECONDS),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[code-analyzer-worker] ingestion ${job.id} failed:`, message);
    await releaseJob(supabase, {
      jobId: job.id,
      workerId: WORKER_ID,
      status: job.attempt_count >= job.max_attempts ? "failed" : "pending",
      progressPhase: job.attempt_count >= job.max_attempts ? "failed" : "queued",
      lastError: message,
      errorCode: "processing_error",
      availableAt:
        job.attempt_count >= job.max_attempts
          ? null
          : new Date(Date.now() + Math.min(60000, 5000 * 2 ** job.attempt_count)).toISOString(),
    });
  }
}

async function runSheetJob(job) {
  const supabase = getSupabaseAdmin();
  const { completeSheetJob } = require("./lib/sheetClaim");
  try {
    await processSheetJob({ supabase, job, workerId: WORKER_ID, leaseTtlSeconds: LEASE_TTL_SECONDS });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[code-analyzer-worker] sheet job ${job.id} failed:`, message);
    await completeSheetJob(supabase, {
      jobId: job.id,
      workerId: WORKER_ID,
      status: job.attempt_count >= job.max_attempts ? "failed" : "queued",
      lastError: message,
      errorCode: "analysis_error",
      availableAt:
        job.attempt_count >= job.max_attempts
          ? null
          : new Date(Date.now() + Math.min(60000, 5000 * 2 ** job.attempt_count)).toISOString(),
    });
  }
}

async function runCodeModJob(job) {
  const supabase = getSupabaseAdmin();
  try {
    await processCodeModJob({ supabase, job, workerId: WORKER_ID });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[code-analyzer-worker] code mod ${job.id} failed:`, message);
    await supabase
      .from("code_analyzer_code_mod_jobs")
      .update({
        status: job.attempt_count >= job.max_attempts ? "failed" : "queued",
        last_error: message,
        lease_owner: null,
        lease_expires_at: null,
      })
      .eq("id", job.id);
  }
}

async function pollOnce() {
  const supabase = getSupabaseAdmin();

  if (activeCodeMod < 1) {
    const modJob = await claimCodeModJob(supabase, WORKER_ID, LEASE_TTL_SECONDS);
    if (modJob) {
      activeCodeMod += 1;
      runCodeModJob(modJob)
        .catch((err) => console.error("[code-analyzer-worker] code mod unhandled:", err))
        .finally(() => {
          activeCodeMod -= 1;
        });
    }
  }

  if (activeSheets < SHEET_CONCURRENCY) {
    const sheetJob = await claimSheetJob(supabase, WORKER_ID, LEASE_TTL_SECONDS);
    if (sheetJob) {
      activeSheets += 1;
      runSheetJob(sheetJob)
        .catch((err) => console.error("[code-analyzer-worker] sheet unhandled:", err))
        .finally(() => {
          activeSheets -= 1;
        });
    }
  }

  if (activeIngestion < INGESTION_CONCURRENCY) {
    const job = await claimJob(supabase, WORKER_ID, LEASE_TTL_SECONDS);
    if (job) {
      activeIngestion += 1;
      runIngestionJob(job)
        .catch((err) => console.error("[code-analyzer-worker] ingestion unhandled:", err))
        .finally(() => {
          activeIngestion -= 1;
        });
    }
  }
}

async function main() {
  preferIpv4Dns();
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }

  console.log("[code-analyzer-worker] started", {
    workerId: WORKER_ID,
    pollMs: POLL_MS,
    ingestionConcurrency: INGESTION_CONCURRENCY,
    sheetConcurrency: SHEET_CONCURRENCY,
    version: WORKER_VERSION,
  });

  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      await pollOnce();
    } catch (err) {
      console.error("[code-analyzer-worker] poll error:", err instanceof Error ? err.message : err);
    }
    await sleep(POLL_MS);
  }
}

main();
