#!/usr/bin/env node
"use strict";

/**
 * One-time cleanup for duplicate active Arlington scrape jobs sharing identity.
 * Usage:
 *   node scripts/cleanup-arlington-duplicate-jobs.js [--dry-run]
 *   node scripts/cleanup-arlington-duplicate-jobs.js --job-a=<uuid> --job-b=<uuid>
 */

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { createClient } = require("@supabase/supabase-js");

const ACTIVE_STATUSES = [
  "queued",
  "running",
  "resuming",
  "rate_limited",
  "partial",
  "waiting_user",
];

function parseArgs(argv) {
  const out = { dryRun: false, jobA: null, jobB: null };
  for (const arg of argv) {
    if (arg === "--dry-run") out.dryRun = true;
    else if (arg.startsWith("--job-a=")) out.jobA = arg.slice("--job-a=".length);
    else if (arg.startsWith("--job-b=")) out.jobB = arg.slice("--job-b=".length);
  }
  return out;
}

function identityKey(row) {
  return [
    row.project_id,
    row.normalized_permit_number || `${row.permit_number || ""}`.trim().toUpperCase(),
    row.normalized_scope_key || "",
  ].join("|");
}

function compareCanonicalJobs(a, b) {
  const checkpointA = Number(a.checkpoint_version) || 0;
  const checkpointB = Number(b.checkpoint_version) || 0;
  if (checkpointB !== checkpointA) return checkpointB - checkpointA;
  const createdA = a.created_at ? Date.parse(a.created_at) : 0;
  const createdB = b.created_at ? Date.parse(b.created_at) : 0;
  return createdA - createdB;
}

function pickCanonical(jobs) {
  return [...jobs].sort(compareCanonicalJobs)[0];
}

async function cancelDuplicate(supabase, duplicate, canonicalId, dryRun) {
  const patch = {
    status: "cancelled",
    cancellation_reason: "duplicate_active_job",
    canonical_job_id: canonicalId,
    lease_worker_id: null,
    lease_expires_at: null,
    lease_heartbeat_at: null,
    next_attempt_at: null,
    completed_at: new Date().toISOString(),
    current_stage: "cancelled",
    current_user_message: "Cancelled: duplicate active Arlington scrape job.",
    metadata: {
      ...(duplicate.metadata || {}),
      arlington: {
        ...(duplicate.metadata?.arlington || {}),
        terminalReason: "duplicate_active_job",
        canonicalJobId: canonicalId,
      },
    },
  };
  if (dryRun) {
    console.log(`[dry-run] would cancel duplicate job ${duplicate.id} -> canonical ${canonicalId}`);
    return { id: duplicate.id, dryRun: true };
  }
  const { error } = await supabase
    .from("scrape_jobs")
    .update(patch)
    .eq("id", duplicate.id);
  if (error) throw error;
  console.log(`cancelled duplicate job ${duplicate.id} (canonical ${canonicalId})`);
  return { id: duplicate.id, cancelled: true };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required");
    process.exit(1);
  }
  const supabase = createClient(url, key);

  if (args.jobA && args.jobB) {
    const { data, error } = await supabase
      .from("scrape_jobs")
      .select("*")
      .in("id", [args.jobA, args.jobB]);
    if (error) throw error;
    if (!data || data.length < 2) {
      console.error("Could not load both specified jobs");
      process.exit(1);
    }
    const canonical = pickCanonical(data);
    const duplicates = data.filter((j) => j.id !== canonical.id);
    for (const dup of duplicates) {
      await cancelDuplicate(supabase, dup, canonical.id, args.dryRun);
    }
    console.log(
      JSON.stringify({
        canonicalJobId: canonical.id,
        cancelled: duplicates.map((d) => d.id),
        dryRun: args.dryRun,
      }),
    );
    return;
  }

  const { data: activeRows, error } = await supabase
    .from("scrape_jobs")
    .select("*")
    .ilike("jurisdiction", "%arlington%")
    .in("status", ACTIVE_STATUSES)
    .is("completed_at", null);
  if (error) throw error;

  const groups = new Map();
  for (const row of activeRows || []) {
    const key = identityKey(row);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }

  const results = [];
  for (const [key, jobs] of groups) {
    if (jobs.length < 2) continue;
    const canonical = pickCanonical(jobs);
    const duplicates = jobs.filter((j) => j.id !== canonical.id);
    for (const dup of duplicates) {
      await cancelDuplicate(supabase, dup, canonical.id, args.dryRun);
      results.push({ identity: key, canonical: canonical.id, cancelled: dup.id });
    }
  }

  console.log(JSON.stringify({ groupsCleaned: results.length, results, dryRun: args.dryRun }));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
