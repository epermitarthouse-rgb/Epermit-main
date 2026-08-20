"use strict";

/**
 * Send-only SYNTHETIC Graph email for automatic-poller verification.
 * Does NOT call pollGraphInboundForUser or the graph-poll HTTP endpoint.
 *
 * Usage (from scraper-service):
 *   node scripts/uat-graph-inbound-send-only.js
 *   node scripts/uat-graph-inbound-send-only.js --fixture=01
 */

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");
const {
  getValidAccessTokenForUser,
} = require("../app/services/microsoft/microsoft-graph-auth.service.js");
const { graphSendMail } = require("../app/services/uci/uci-email-submission.service.js");

const COORDINATION_ID = "1a2b4b06-a7f9-4b17-96ca-f757be8e0c69";
const PACKAGE_ID = "6314b620-8cc3-4642-a08c-28c2949e921f";
const MAILBOX_USER_ID = "f1f84c83-36f6-4664-b34b-614b2881f09d";
const SELF = "dzahid@commun-et.com";
const FIXTURE_DIR = path.join(__dirname, "../fixtures/stage6-cos");

const FIXTURES = {
  "01": {
    file: "01_Synthetic_COS_Matching.pdf",
    subjectBase:
      "[SYNTHETIC TEST] Class of Service — McDonald's Highland Springs, VA - LC 451497 matching COS (auto-poller UAT)",
    body: [
      "SYNTHETIC TEST — NOT A REAL DOMINION / UTILITY DOCUMENT",
      "McDonald's Highland Springs, VA - LC 451497 — synthetic Class of Service matching verified Load Profile.",
      `Coordination ${COORDINATION_ID}`,
      `Package ${PACKAGE_ID}`,
      "Class of Service issued. Assigned voltage: 120/208 V. Service capacity: 1000 A. 3-phase 4-wire.",
      "Sent for automatic Graph inbound poller verification (no manual poll).",
    ].join("\n"),
  },
};

async function main() {
  const fixtureKey =
    (process.argv.find((a) => a.startsWith("--fixture=")) || "--fixture=01").split(
      "=",
    )[1] || "01";
  const fixture = FIXTURES[fixtureKey];
  if (!fixture) throw new Error(`Unknown fixture ${fixtureKey}`);

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  );
  const token = await getValidAccessTokenForUser(supabase, MAILBOX_USER_ID);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const subject = `${fixture.subjectBase} ${stamp}`;
  const filePath = path.join(FIXTURE_DIR, fixture.file);
  const buf = fs.readFileSync(filePath);

  const sentAt = new Date().toISOString();
  const result = await graphSendMail(token, {
    subject,
    body: fixture.body,
    toRecipients: [SELF],
    attachments: [
      {
        file_name: fixture.file,
        content_type: "application/pdf",
        content_base64: buf.toString("base64"),
      },
    ],
  });
  if (!result.ok) {
    throw new Error(`sendMail failed: ${result.error || result.status}`);
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        sent_at: sentAt,
        to: SELF,
        subject,
        attachment: fixture.file,
        note: "Wait for background Graph inbound poller; do not call graph-poll.",
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
