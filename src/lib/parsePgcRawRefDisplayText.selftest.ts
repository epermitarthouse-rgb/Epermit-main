/**
 * Run: npx tsx src/lib/parsePgcRawRefDisplayText.selftest.ts
 */
import assert from "node:assert/strict";

import {
  parsePgcRawRefDisplayText,
  RAW_REF_PORTAL_RESPONSE_SEPARATOR,
  splitRawRefDiscussionAndResponse,
} from "./parsePgcRawRefDisplayText.ts";

const FULL_DISC_24 =
  ["Trashcans", "Indicate the intended location and specifications of trashcans."].join("\n") +
  RAW_REF_PORTAL_RESPONSE_SEPARATOR +
  ["Responded by: _ Commun-ET LLC Commun-ET LLC -", "Reviewer Response: stamped plans received."].join(
    "\n",
  );

const BLOB_REF24 = [
  "ref: 24",
  "cycle: 1",
  "reviewed_by: Health and Human Services (HHS) Reviewers / Annastasia Zenner",
  "type: Changemark",
  "filename: A.2 EQUIPMENT PLAN.pdf",
  "full_discussion_text:",
  FULL_DISC_24,
  "status: Resolved",
  "source_report: montgomery-export",
  "date_time:",
  "",
  "--- original_source_block ---",
  "24 1 …",
].join("\n");

const FULL_DISC_31 =
  ["Energy Code Compliance", "Detail lighting controls per COMAR."].join("\n") +
  RAW_REF_PORTAL_RESPONSE_SEPARATOR +
  "Responded by: Applicant submitted COMcheck update.";

const BLOB_REF31 = [
  "ref: 31",
  "cycle: 1",
  "reviewed_by: Energy Reviewers",
  "type: Changemark",
  "filename: C.1 ENERGY.pdf",
  "full_discussion_text:",
  FULL_DISC_31,
  "status: Resolved",
  "source_report: montgomery-export",
  "date_time:",
].join("\n");

/** Mirrors `formatPgcDeterministicPersistedComment` after `pgcPersistSingleLineCell` — blank cycle row ref 1 */
const REF1_LONG_TYPE =
  "Comment / Submissions did not meet guidelines for the following reasons: -Scope of work not listed on cover sheet";
const BLOB_REF1_MONTGOMERY = [
  "ref: 1",
  "cycle: ",
  "reviewed_by: Permit Tech / Marlany Gomez / 12/9/25 2:50 PM",
  `type: ${REF1_LONG_TYPE}`,
  "filename: ",
  "full_discussion_text:",
  "Responded by: Will fix.",
  "status: Resolved",
].join("\n");

const BLOB_REF7_MONTGOMERY = [
  "ref: 7",
  "cycle: 1",
  "reviewed_by: Mechanical Reviewers / Paolo Toschi / 12/23/25 11:37 AM",
  "type: Changemark / Paolo 1 Item 1",
  "filename: M.2 MECHANICAL PLANS.pdf",
  "full_discussion_text:",
  "Include a plat, and clearly identify property lines.",
  "Responded by: firm X note.",
  "status: Resolved",
].join("\n");

function run(): void {
  const rf1 = parsePgcRawRefDisplayText(BLOB_REF1_MONTGOMERY);
  assert.equal(rf1.ref, "1");
  assert.ok(!(String(rf1.cycle ?? "").trim().length));
  assert.ok(/Permit Tech/.test(String(rf1.reviewedBy)) && /Marlany Gomez/.test(String(rf1.reviewedBy)));
  assert.ok(/Comment/.test(String(rf1.type)) && /Scope of work/.test(String(rf1.type)));
  assert.ok(!(String(rf1.filename ?? "").trim()));
  assert.ok(String(rf1.discussion).trim().startsWith("Responded by"));

  const rf7 = parsePgcRawRefDisplayText(BLOB_REF7_MONTGOMERY);
  assert.equal(rf7.ref, "7");
  assert.equal(String(rf7.cycle)?.trim(), "1");
  assert.ok(String(rf7.reviewedBy).includes("Mechanical Reviewers") && String(rf7.reviewedBy).includes("Paolo Toschi"));
  assert.ok(/Changemark/.test(String(rf7.type)) && /Paolo\s+1\s+Item\s+1/i.test(String(rf7.type)));
  assert.ok(/M\.2\s+MECHANICAL\s+PLANS\.pdf/i.test(String(rf7.filename)));
  assert.ok(
    String(rf7.discussion).includes("Responded by") ||
      String(rf7.discussion).includes("Include a plat"),
  );

  const r24 = parsePgcRawRefDisplayText(BLOB_REF24);
  assert.equal(r24.ref, "24");
  assert.equal(r24.cycle, "1");
  assert.ok(r24.reviewedBy?.includes("Health and Human"));
  assert.equal(r24.type, "Changemark");
  assert.ok(r24.filename?.includes("EQUIPMENT"));
  assert.ok(r24.discussion.includes("Trashcans"), "full DISCUSSION includes issue title");
  assert.ok(r24.discussion.includes("Responded by"), "full DISCUSSION includes portal/applicant response text");
  assert.ok(r24.discussion.includes("Reviewer Response"));

  const r31 = parsePgcRawRefDisplayText(BLOB_REF31);
  assert.ok(r31.discussion.includes("Energy Code Compliance"));
  assert.ok(r31.discussion.includes("Responded by"));

  const sp = splitRawRefDiscussionAndResponse(
    `Issue A${RAW_REF_PORTAL_RESPONSE_SEPARATOR}Responded by: X`,
  );
  assert.equal(sp.discussion.trim(), "Issue A");
  assert.ok(sp.responseText?.includes("Responded by"));

  console.log("parsePgcRawRefDisplayText.selftest: OK");
}

run();
