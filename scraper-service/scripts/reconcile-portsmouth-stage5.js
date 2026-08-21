#!/usr/bin/env node
"use strict";

/**
 * Reconcile Portsmouth Stage 5 from existing inbound messages (no new email).
 *
 * Usage:
 *   node scripts/reconcile-portsmouth-stage5.js [--apply]
 */

require("dotenv").config();

const { createClient } = require("@supabase/supabase-js");
const {
  reconcileStage5FromCoordinationEvidence,
} = require("../app/services/uci/uci-ack-acceptance.service.js");
const { maybeEnterStage6FromCommunication } = require("../app/services/uci/uci-stage6-entry.service.js");

const PORTSMOUTH = {
  coordinationId: "f656209f-8fb5-4711-98ad-3e65801505db",
  ackCommId: "727e3cad-e267-4b85-94e4-6e37f340ee66",
  designReviewCommId: "2f2b3ffe-9b8b-457b-b329-0d374ce769c9",
};

function parseArgs(argv) {
  return { apply: argv.includes("--apply") };
}

async function snapshot(supabase, coordinationId) {
  const { data: coord } = await supabase
    .from("coordination_records")
    .select(
      "id, current_stage, current_stage_state, acknowledgment_received_at, utility_project_manager, utility_contact_name, metadata",
    )
    .eq("id", coordinationId)
    .maybeSingle();
  const { data: comms } = await supabase
    .from("coordination_communications")
    .select("id, classification, needs_human_attention, agent_processed_metadata")
    .eq("coordination_record_id", coordinationId)
    .in("id", [PORTSMOUTH.ackCommId, PORTSMOUTH.designReviewCommId]);
  return { coord, comms: comms || [] };
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

  const before = await snapshot(supabase, PORTSMOUTH.coordinationId);
  console.log(JSON.stringify({ phase: "before", ...before }, null, 2));

  if (!args.apply) {
    console.log("Dry run — pass --apply to reconcile Stage 5 and enter Stage 6.");
    return;
  }

  const reconcile = await reconcileStage5FromCoordinationEvidence(supabase, {
    coordinationRecordId: PORTSMOUTH.coordinationId,
    triggerCommunicationId: PORTSMOUTH.designReviewCommId,
    source: "system",
  });

  const { data: designComm } = await supabase
    .from("coordination_communications")
    .select("*")
    .eq("id", PORTSMOUTH.designReviewCommId)
    .maybeSingle();

  let stage6 = null;
  if (designComm) {
    stage6 = await maybeEnterStage6FromCommunication(supabase, {
      communication: designComm,
    });
  }

  const after = await snapshot(supabase, PORTSMOUTH.coordinationId);
  console.log(
    JSON.stringify(
      {
        phase: "after",
        reconcile,
        stage6,
        ...after,
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
