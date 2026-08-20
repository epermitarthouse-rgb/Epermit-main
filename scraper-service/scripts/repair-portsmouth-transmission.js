#!/usr/bin/env node
"use strict";

/**
 * Backfill Portsmouth (or any app) Graph 202 outcome_unknown transmission → sent + Stage 5.
 * Does NOT call Graph sendMail or resend email.
 *
 * Usage:
 *   node scripts/repair-portsmouth-transmission.js [--application-id=<uuid>] [--transmission-id=<uuid>] [--apply]
 *
 * Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
 * Optional: UCI_RECOVERY_OPERATOR_USER_ID (defaults to transmission operator_user_id)
 * Optional: MICROSOFT_GRAPH repair via operator token when Sent Items can be reconciled
 */

require("dotenv").config();

const { createClient } = require("@supabase/supabase-js");
const {
  repairTransmissionOutcomeAfterSuccessfulGraphSend,
} = require("../app/services/uci/uci-submission-transmission.service.js");
const {
  reconcileLiveTransmissionIntoStage5,
} = require("../app/services/uci/uci-stage5-entry.service.js");
const { getValidAccessTokenForUser } = require("../app/services/microsoft/microsoft-graph-auth.service.js");

const DEFAULT_APPLICATION_ID = "5c2321ce-1f29-412d-a9ca-102ee543e02e";
const DEFAULT_TRANSMISSION_ID = "87ba13f7-e7d5-4e53-8020-671880e0fafd";

function parseArgs(argv) {
  const args = {
    apply: false,
    applicationId: DEFAULT_APPLICATION_ID,
    transmissionId: DEFAULT_TRANSMISSION_ID,
  };
  for (const arg of argv) {
    if (arg === "--apply") args.apply = true;
    else if (arg.startsWith("--application-id=")) {
      args.applicationId = arg.slice("--application-id=".length).trim();
    } else if (arg.startsWith("--transmission-id=")) {
      args.transmissionId = arg.slice("--transmission-id=".length).trim();
    }
  }
  return args;
}

async function snapshot(supabase, applicationId, transmissionId) {
  const { data: app } = await supabase
    .from("coordination_applications")
    .select("id, coordination_record_id, submitted_at, submission_method, agent_draft_metadata")
    .eq("id", applicationId)
    .maybeSingle();
  const { data: coord } = await supabase
    .from("coordination_records")
    .select("id, current_stage, current_stage_state")
    .eq("id", app?.coordination_record_id)
    .maybeSingle();
  const { data: tx } = await supabase
    .from("submission_transmission_attempts")
    .select("id, preparation_id, status, graph_message_id, graph_http_status, completed_at")
    .eq("id", transmissionId)
    .maybeSingle();
  return { app, coord, tx };
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

  const before = await snapshot(supabase, args.applicationId, args.transmissionId);
  console.log(JSON.stringify({ phase: "before", ...before }, null, 2));

  if (!args.apply) {
    console.log("Dry run — pass --apply to repair transmission and advance Stage 5.");
    return;
  }

  const { data: txRow } = await supabase
    .from("submission_transmission_attempts")
    .select("operator_user_id")
    .eq("id", args.transmissionId)
    .maybeSingle();
  const operatorUserId =
    process.env.UCI_RECOVERY_OPERATOR_USER_ID ||
    (txRow?.operator_user_id ? String(txRow.operator_user_id) : null);
  if (!operatorUserId) {
    console.error("Set UCI_RECOVERY_OPERATOR_USER_ID or ensure transmission has operator_user_id");
    process.exit(1);
  }

  let accessToken = null;
  try {
    accessToken = await getValidAccessTokenForUser(supabase, operatorUserId);
  } catch {
    accessToken = null;
  }

  const repaired = await repairTransmissionOutcomeAfterSuccessfulGraphSend(supabase, {
    applicationId: args.applicationId,
    transmissionId: args.transmissionId,
    userId: operatorUserId,
    accessToken,
    forceSyntheticMessageId: !accessToken,
  });

  const stage5 = await reconcileLiveTransmissionIntoStage5(supabase, {
    applicationId: args.applicationId,
    userId: operatorUserId,
    transmissionId: args.transmissionId,
    preparationId: String(repaired.attempt.preparation_id || ""),
  });

  const after = await snapshot(supabase, args.applicationId, args.transmissionId);
  console.log(
    JSON.stringify(
      {
        phase: "after",
        repaired,
        stage5: {
          submitted_at: stage5.submitted_at,
          current_stage: stage5.coordination_record?.current_stage,
          current_stage_state: stage5.coordination_record?.current_stage_state,
          stage_5_advanced: true,
        },
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
