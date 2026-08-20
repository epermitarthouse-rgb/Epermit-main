"use strict";

/**
 * Live Stage 6 Graph attachment UAT — Highland Springs.
 * Self-send only to dzahid@commun-et.com. Never emails Dominion/external utility.
 *
 * Usage:
 *   node scripts/uat-stage6-graph-attachments.js              # send fixture 01 + poll twice
 *   node scripts/uat-stage6-graph-attachments.js --fixture=02
 *   node scripts/uat-stage6-graph-attachments.js --fixture=03
 *   node scripts/uat-stage6-graph-attachments.js --poll-only
 *   node scripts/uat-stage6-graph-attachments.js --edge=no-attachment
 *   node scripts/uat-stage6-graph-attachments.js --edge=unsupported
 *   node scripts/uat-stage6-graph-attachments.js --edge=multi
 *   node scripts/uat-stage6-graph-attachments.js --edge=low-confidence
 */

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");
const { getValidAccessTokenForUser } = require("../app/services/microsoft/microsoft-graph-auth.service.js");
const { graphSendMail } = require("../app/services/uci/uci-email-submission.service.js");
const { pollGraphInboundForUser } = require("../app/services/uci/uci-graph-inbound.service.js");

const COORDINATION_ID = "1a2b4b06-a7f9-4b17-96ca-f757be8e0c69";
const PACKAGE_ID = "6314b620-8cc3-4642-a08c-28c2949e921f";
const MAILBOX_USER_ID = "f1f84c83-36f6-4664-b34b-614b2881f09d";
const SELF = "dzahid@commun-et.com";
const FIXTURE_DIR = path.join(__dirname, "../fixtures/stage6-cos");

const FIXTURES = {
  "01": {
    file: "01_Synthetic_COS_Matching.pdf",
    subject:
      "[SYNTHETIC TEST] Class of Service — McDonald's Highland Springs, VA - LC 451497 matching COS (Stage 6 UAT)",
    body: [
      "SYNTHETIC TEST — NOT A REAL DOMINION / UTILITY DOCUMENT",
      "McDonald's Highland Springs, VA - LC 451497 — synthetic Class of Service matching verified Load Profile.",
      `Coordination ${COORDINATION_ID}`,
      `Package ${PACKAGE_ID}`,
      "Class of Service issued. Assigned voltage: 120/208 V. Service capacity: 1000 A. 3-phase 4-wire.",
    ].join("\n"),
  },
  "02": {
    file: "02_Synthetic_COS_Discrepant.pdf",
    subject:
      "[SYNTHETIC TEST] Class of Service — McDonald's Highland Springs, VA - LC 451497 discrepant COS (Stage 6 UAT)",
    body: [
      "SYNTHETIC TEST — NOT A REAL DOMINION / UTILITY DOCUMENT",
      "McDonald's Highland Springs, VA - LC 451497 — synthetic Class of Service with deliberate amperage discrepancy.",
      `Coordination ${COORDINATION_ID}`,
      `Package ${PACKAGE_ID}`,
      "Assigned service: 400 A (undersized vs 1000 A verified).",
    ].join("\n"),
  },
  "03": {
    file: "03_Synthetic_Design_Review_Revision_Request.pdf",
    subject:
      "[SYNTHETIC TEST] Design review response — McDonald's Highland Springs, VA - LC 451497 revision required (Stage 6 UAT)",
    body: [
      "SYNTHETIC TEST — NOT A REAL DOMINION / UTILITY DOCUMENT",
      "McDonald's Highland Springs, VA - LC 451497 — design review response. More Information Required. Revised plans required.",
      `Coordination ${COORDINATION_ID}`,
      `Package ${PACKAGE_ID}`,
      "Easement required. Please provide revised plans and additional documents.",
    ].join("\n"),
  },
};

function parseArgs(argv) {
  /** @type {Record<string, string | boolean>} */
  const out = { fixture: "01" };
  for (const a of argv.slice(2)) {
    if (a === "--poll-only") out.pollOnly = true;
    else if (a.startsWith("--fixture=")) out.fixture = a.slice("--fixture=".length);
    else if (a.startsWith("--edge=")) out.edge = a.slice("--edge=".length);
  }
  return out;
}

async function sendWithAttachments(accessToken, opts) {
  const attachments = (opts.files || []).map((filePath) => {
    const buf = fs.readFileSync(filePath);
    return {
      file_name: path.basename(filePath),
      content_type: filePath.endsWith(".zip") ? "application/zip" : "application/pdf",
      content_base64: buf.toString("base64"),
    };
  });
  const result = await graphSendMail(accessToken, {
    subject: opts.subject,
    body: opts.body,
    toRecipients: [SELF],
    attachments,
  });
  if (!result.ok) {
    throw new Error(`sendMail failed: ${result.error || result.status}`);
  }
  return result;
}

async function summarizeState(supabase) {
  const { data: record } = await supabase
    .from("coordination_records")
    .select(
      "id,current_stage,current_stage_state,class_of_service_issued_at,acknowledgment_received_at",
    )
    .eq("id", COORDINATION_ID)
    .maybeSingle();

  const { data: comms } = await supabase
    .from("coordination_communications")
    .select(
      "id,raw_subject,classification,classification_confidence,needs_human_attention,raw_attachments,message_timestamp,external_message_id",
    )
    .eq("coordination_record_id", COORDINATION_ID)
    .order("message_timestamp", { ascending: false })
    .limit(10);

  const { data: cos } = await supabase
    .from("coordination_cos_design_records")
    .select(
      "id,version,is_current,evidence_status,review_status,source_communication_id,needs_human_attention,attention_reasons,comparison_rows",
    )
    .eq("coordination_record_id", COORDINATION_ID)
    .order("version", { ascending: false })
    .limit(5);

  const { data: docs } = await supabase
    .from("project_documents")
    .select("id,file_name,description,created_at")
    .eq("project_id", "62f83b5b-9d22-4ebc-8282-6fc41e3033c0")
    .ilike("description", "%graph_attachment_id=%")
    .order("created_at", { ascending: false })
    .limit(10);

  return { record, communications: comms || [], cos_records: cos || [], inbound_docs: docs || [] };
}

async function main() {
  const args = parseArgs(process.argv);
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  );

  const { data: coord } = await supabase
    .from("coordination_records")
    .select("id,project_id")
    .eq("id", COORDINATION_ID)
    .maybeSingle();
  if (!coord) throw new Error("Highland Springs coordination not found");

  const accessToken = await getValidAccessTokenForUser(supabase, MAILBOX_USER_ID);
  if (!accessToken) throw new Error("Mailbox not connected for dzahid user");

  if (!args.pollOnly) {
    if (args.edge === "no-attachment") {
      await sendWithAttachments(accessToken, {
        subject: "[SYNTHETIC TEST] Highland Springs COS note — no attachment",
        body: `SYNTHETIC TEST Highland Springs Class of Service body-only. Coordination ${COORDINATION_ID}`,
        files: [],
      });
      console.log("sent: no-attachment");
    } else if (args.edge === "unsupported") {
      const zipPath = path.join(FIXTURE_DIR, "_uat_unsupported.zip");
      fs.writeFileSync(zipPath, Buffer.from("PK\x03\x04synthetic-unsupported"));
      await sendWithAttachments(accessToken, {
        subject: "[SYNTHETIC TEST] Highland Springs unsupported attachment",
        body: `SYNTHETIC TEST Highland Springs unsupported zip. Coordination ${COORDINATION_ID}`,
        files: [zipPath],
      });
      console.log("sent: unsupported zip");
    } else if (args.edge === "multi") {
      await sendWithAttachments(accessToken, {
        subject: "[SYNTHETIC TEST] Highland Springs multi-attachment COS",
        body: `SYNTHETIC TEST Highland Springs multi COS attachments. Coordination ${COORDINATION_ID}`,
        files: [
          path.join(FIXTURE_DIR, FIXTURES["01"].file),
          path.join(FIXTURE_DIR, FIXTURES["02"].file),
        ],
      });
      console.log("sent: multi attachments");
    } else if (args.edge === "low-confidence") {
      await sendWithAttachments(accessToken, {
        subject: "[SYNTHETIC TEST] Highland Springs vague utility note",
        body: `SYNTHETIC TEST. Hi team, following up on Highland Springs paperwork sometime soon. Coordination ${COORDINATION_ID}`,
        files: [path.join(FIXTURE_DIR, FIXTURES["01"].file)],
      });
      console.log("sent: low-confidence candidate");
    } else {
      const key = String(args.fixture || "01");
      const fx = FIXTURES[key];
      if (!fx) throw new Error(`Unknown fixture ${key}`);
      const filePath = path.join(FIXTURE_DIR, fx.file);
      if (!fs.existsSync(filePath)) throw new Error(`Missing fixture ${filePath}`);
      await sendWithAttachments(accessToken, {
        subject: fx.subject,
        body: fx.body,
        files: [filePath],
      });
      console.log("sent fixture", key, fx.file);
    }

    // Graph delivery lag
    await new Promise((r) => setTimeout(r, 8000));
  }

  const receivedAfter = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const poll1 = await pollGraphInboundForUser(supabase, {
    userId: MAILBOX_USER_ID,
    projectId: coord.project_id,
    top: 30,
    receivedAfterIso: receivedAfter,
  });
  console.log(
    "poll1",
    JSON.stringify(
      {
        processed: poll1.results?.length ?? poll1.processed ?? null,
        matched: (poll1.results || []).filter((r) => r.status === "matched").length,
        inserted: (poll1.results || []).filter((r) => r.inserted).length,
      },
      null,
      2,
    ),
  );

  await new Promise((r) => setTimeout(r, 2000));
  const poll2 = await pollGraphInboundForUser(supabase, {
    userId: MAILBOX_USER_ID,
    projectId: coord.project_id,
    top: 30,
    receivedAfterIso: receivedAfter,
  });
  console.log(
    "poll2_dup_check",
    JSON.stringify(
      {
        inserted: (poll2.results || []).filter((r) => r.inserted).length,
        matched: (poll2.results || []).filter((r) => r.status === "matched").length,
      },
      null,
      2,
    ),
  );

  const state = await summarizeState(supabase);
  console.log("state", JSON.stringify(state, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
