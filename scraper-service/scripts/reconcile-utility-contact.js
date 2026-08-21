#!/usr/bin/env node
"use strict";

/**
 * Backfill utility_contact_email from trusted inbound communication senders.
 *
 * Usage:
 *   node scripts/reconcile-utility-contact.js [--apply] [--id <coordination-id>]
 */

require("dotenv").config();

const { createClient } = require("@supabase/supabase-js");
const {
  reconcileUtilityContactEmail,
  resolveUtilityContact,
  loadCoordinationCommunicationsForContact,
} = require("../app/services/uci/uci-utility-contact.service.js");
const { meterSetStatus } = require("../app/services/uci/uci-meter-set-choreographer.service.js");

const TARGETS = [
  { label: "Portsmouth", coordinationId: "f656209f-8fb5-4711-98ad-3e65801505db" },
  { label: "Highland", coordinationId: "1a2b4b06-a7f9-4b17-96ca-f757be8e0c69" },
];

function parseArgs(argv) {
  const apply = argv.includes("--apply");
  const idIdx = argv.indexOf("--id");
  const id = idIdx >= 0 ? String(argv[idIdx + 1] || "").trim() : null;
  return { apply, id };
}

async function inspectTarget(supabase, target, dryRun) {
  const { coordinationId, label } = target;
  const communications = await loadCoordinationCommunicationsForContact(supabase, coordinationId);
  const { data: record } = await supabase
    .from("coordination_records")
    .select("*")
    .eq("id", coordinationId)
    .maybeSingle();

  const before = resolveUtilityContact(record, { communications });
  const reconcile = await reconcileUtilityContactEmail(supabase, {
    coordinationRecordId: coordinationId,
    dryRun: !dryRun,
  });

  const { data: milestones } = await supabase
    .from("coordination_milestones")
    .select("*")
    .eq("coordination_record_id", coordinationId);

  const afterRecord = reconcile.record || record;
  const after = resolveUtilityContact(afterRecord, { communications });
  const stage9 = meterSetStatus(afterRecord, milestones || [], { communications });

  return {
    label,
    coordinationId,
    before,
    after,
    reconcile,
    stage9_gate: {
      status: stage9.status,
      utility_contact_blocker: stage9.utility_contact_blocker,
      utility_contact_blocker_message: stage9.utility_contact_blocker_message,
      actions: stage9.actions,
      outbound_ready: after.completeForOutbound,
    },
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
    process.exit(1);
  }

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const targets = args.id
    ? TARGETS.filter((t) => t.coordinationId === args.id)
    : TARGETS;

  if (!targets.length) {
    console.error(`Unknown coordination id: ${args.id}`);
    process.exit(1);
  }

  const results = [];
  for (const target of targets) {
    results.push(await inspectTarget(supabase, target, args.apply));
  }

  console.log(
    JSON.stringify(
      {
        mode: args.apply ? "apply" : "dry_run",
        results,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
