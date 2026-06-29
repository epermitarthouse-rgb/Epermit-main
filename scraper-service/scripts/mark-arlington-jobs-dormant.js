#!/usr/bin/env node
"use strict";

/**
 * Mark unrelated unfinished Arlington scrape jobs dormant (no auto worker claim).
 * Usage:
 *   node scripts/mark-arlington-jobs-dormant.js [--dry-run]
 *   node scripts/mark-arlington-jobs-dormant.js --permit=COFO25-00233
 *   node scripts/mark-arlington-jobs-dormant.js --except-job=<uuid>
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
  const out = { dryRun: false, permit: null, exceptJobId: null };
  for (const arg of argv) {
    if (arg === "--dry-run") out.dryRun = true;
    else if (arg.startsWith("--permit=")) out.permit = arg.slice("--permit=".length).trim().toUpperCase();
    else if (arg.startsWith("--except-job=")) out.exceptJobId = arg.slice("--except-job=".length).trim();
  }
  return out;
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

  let query = supabase
    .from("scrape_jobs")
    .select("id, permit_number, normalized_permit_number, status, run_intent, lease_expires_at")
    .ilike("jurisdiction", "%arlington%")
    .in("status", ACTIVE_STATUSES)
    .is("completed_at", null)
    .neq("run_intent", "dormant");

  if (args.permit) {
    query = query.eq("normalized_permit_number", args.permit);
  }
  if (args.exceptJobId) {
    query = query.neq("id", args.exceptJobId);
  }

  const { data: rows, error } = await query;
  if (error) throw error;

  const toDormant = (rows || []).filter((row) => {
    const leaseActive =
      row.lease_expires_at && new Date(row.lease_expires_at).getTime() > Date.now();
    return !leaseActive;
  });

  if (toDormant.length === 0) {
    console.log(JSON.stringify({ marked: 0, message: "no eligible jobs" }));
    return;
  }

  const ids = toDormant.map((r) => r.id);
  if (args.dryRun) {
    console.log(JSON.stringify({ dryRun: true, wouldMark: ids, permits: toDormant.map((r) => r.permit_number) }));
    return;
  }

  const { error: updateError } = await supabase
    .from("scrape_jobs")
    .update({
      run_intent: "dormant",
      dispatch_priority: 0,
      lease_worker_id: null,
      lease_expires_at: null,
      lease_heartbeat_at: null,
      next_attempt_at: null,
      current_user_message: "Dormant — will not auto-run until explicitly resumed.",
    })
    .in("id", ids);
  if (updateError) throw updateError;

  console.log(
    JSON.stringify({
      marked: ids.length,
      jobIds: ids,
      permits: toDormant.map((r) => r.permit_number),
    }),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
