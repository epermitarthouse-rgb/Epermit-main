#!/usr/bin/env node
"use strict";

/**
 * Recover Portsmouth synthetic ack from uci_unmatched_inbound_messages.
 * Does NOT send email or fabricate messages — reprocesses existing mailbox row.
 *
 * Usage:
 *   node scripts/recover-portsmouth-ack.js [--apply]
 *
 * Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
 */

require("dotenv").config();

const { createClient } = require("@supabase/supabase-js");
const {
  reprocessUnmatchedInboundMessage,
  findLinkedOutboundEcho,
  linkOutboundEcho,
} = require("../app/services/uci/uci-graph-inbound.service.js");
const {
  resolveTransmissionSender,
  resolveTransmissionRecipients,
} = require("../app/services/uci/uci-stage5-entry.service.js");

const PORTSMOUTH = {
  applicationId: "5c2321ce-1f29-412d-a9ca-102ee543e02e",
  coordinationId: "f656209f-8fb5-4711-98ad-3e65801505db",
  projectId: "13dbc43e-860f-435d-a8af-27dfe34f2322",
  transmissionId: "87ba13f7-e7d5-4e53-8020-671880e0fafd",
  outboundCommId: "773c2271-683d-4c74-975e-bdda3807649f",
  ackUnmatchedId: "58901de0-3cc2-412b-8a06-ab91f7728f91",
  selfEchoUnmatchedId: "eae80da1-b598-40fe-b2f3-e6276155da7f",
};

function parseArgs(argv) {
  return { apply: argv.includes("--apply") };
}

async function snapshot(supabase) {
  const { data: coord } = await supabase
    .from("coordination_records")
    .select("id, current_stage, current_stage_state, acknowledgment_received_at, metadata")
    .eq("id", PORTSMOUTH.coordinationId)
    .maybeSingle();
  const { data: outbound } = await supabase
    .from("coordination_communications")
    .select("id, sender, recipient, direction, classification, raw_subject")
    .eq("coordination_record_id", PORTSMOUTH.coordinationId)
    .order("created_at", { ascending: false });
  const { data: unmatched } = await supabase
    .from("uci_unmatched_inbound_messages")
    .select("id, sender, raw_subject, match_status")
    .in("id", [PORTSMOUTH.ackUnmatchedId, PORTSMOUTH.selfEchoUnmatchedId]);
  return { coord, communications: outbound || [], unmatched: unmatched || [] };
}

async function backfillOutboundCommFields(supabase) {
  const { data: tx } = await supabase
    .from("submission_transmission_attempts")
    .select("*")
    .eq("id", PORTSMOUTH.transmissionId)
    .maybeSingle();
  if (!tx) return { updated: false, reason: "transmission_not_found" };

  const sender = resolveTransmissionSender(tx);
  const recipient = resolveTransmissionRecipients(tx);
  const { data, error } = await supabase
    .from("coordination_communications")
    .update({
      sender,
      recipient,
      updated_at: new Date().toISOString(),
    })
    .eq("id", PORTSMOUTH.outboundCommId)
    .select("*")
    .maybeSingle();
  if (error) throw error;
  return { updated: true, sender, recipient, communication: data };
}

async function linkSelfEchoIfPresent(supabase) {
  const { data: row } = await supabase
    .from("uci_unmatched_inbound_messages")
    .select("*")
    .eq("id", PORTSMOUTH.selfEchoUnmatchedId)
    .maybeSingle();
  if (!row) return { linked: false, reason: "self_echo_not_found" };

  const normalized = {
    external_message_id: row.external_message_id ? String(row.external_message_id) : null,
    internet_message_id: row.internet_message_id ? String(row.internet_message_id) : null,
    conversation_id: row.conversation_id ? String(row.conversation_id) : null,
    thread_id: row.conversation_id ? String(row.conversation_id) : null,
    raw_subject: row.raw_subject ?? null,
    raw_body: row.raw_body ?? null,
    sender: row.sender ?? null,
    idempotency_key: row.idempotency_key ? String(row.idempotency_key) : null,
  };

  const outboundEcho = await findLinkedOutboundEcho(supabase, normalized);
  if (!outboundEcho) {
    return { linked: false, reason: "no_outbound_echo_match" };
  }

  const linked = await linkOutboundEcho(supabase, outboundEcho, normalized);
  await supabase
    .from("uci_unmatched_inbound_messages")
    .update({
      match_status: "linked_outbound_echo",
      needs_human_attention: false,
      updated_at: new Date().toISOString(),
    })
    .eq("id", PORTSMOUTH.selfEchoUnmatchedId);

  return { linked: true, outbound_communication_id: linked?.id || outboundEcho.id };
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

  const before = await snapshot(supabase);
  console.log(JSON.stringify({ phase: "before", ...before }, null, 2));

  if (!args.apply) {
    console.log("Dry run — pass --apply to recover ack and backfill outbound fields.");
    return;
  }

  const outboundPatch = await backfillOutboundCommFields(supabase);
  const selfEcho = await linkSelfEchoIfPresent(supabase);
  const ack = await reprocessUnmatchedInboundMessage(supabase, {
    unmatchedId: PORTSMOUTH.ackUnmatchedId,
    projectId: PORTSMOUTH.projectId,
    providerSlug: "dominion",
    deps: { env: process.env, skipAttachmentPersist: true },
  });

  const after = await snapshot(supabase);
  console.log(
    JSON.stringify(
      {
        phase: "after",
        outboundPatch,
        selfEcho,
        ack: {
          status: ack.status,
          communication_id: ack.communication?.id ?? null,
          classification: ack.communication?.classification ?? ack.classification?.communication?.classification ?? null,
          lifecycle: ack.classification?.lifecycle ?? null,
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
