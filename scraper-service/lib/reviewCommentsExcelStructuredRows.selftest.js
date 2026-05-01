#!/usr/bin/env node
"use strict";

/**
 * Run: node scraper-service/lib/reviewCommentsExcelStructuredRows.selftest.js
 * Synthetic COMBUILD-1140088–shaped rows — not a real export file.
 */

const assert = require("assert");
const ExcelJS = require("exceljs");
const {
  extractReviewCommentsStructuredRowsFromExcelBuffer,
} = require("./reviewCommentsExcelStructuredRows.js");

async function buildCombuildMockWorkbookBuffer() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Plan Review");
  /** Row 1 — headers (typical SSRS order) */
  ws.addRow(["REF #", "CYCLE", "REVIEWED BY", "TYPE", "FILENAME", "DISCUSSION", "STATUS"]);
  ws.addRow([
    "1",
    "",
    "Permit Tech / Marlany Gomez / 12/9/25 2:50 PM",
    "Comment / Submissions did not meet guidelines (Scope of work not listed)",
    "",
    "Responded by: Will fix.",
    "Resolved",
  ]);
  ws.addRow([
    "16",
    "1",
    "Health and Human Services (HHS) Reviewers / Annastasia Zenner / 1/12/26 2:04 PM",
    "Changemark / INCORRECT TYPE / If taking over abandoned work",
    "PUBHHS Application - Plan Review .pdf",
    "Reviewer Response: note. Responded by: applicant.",
    "Resolved",
  ]);
  ws.addRow([
    "24",
    "1",
    "Health and Human Services (HHS) Reviewers / Annastasia Zenner / 1/12/26 5:02 PM",
    "Changemark / Trashcans / Indicate the intended location of trashcans",
    "A.2 EQUIPMENT PLAN.pdf",
    "Responded by: applicant. Reviewer Response: follow-up.",
    "Resolved",
  ]);
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

async function run() {
  const buf = await buildCombuildMockWorkbookBuffer();
  const rows = await extractReviewCommentsStructuredRowsFromExcelBuffer(buf);
  assert.ok(rows.length >= 3, `expected at least 3 data rows, got ${rows.length}`);
  const byRef = new Map(rows.map((r) => [r.ref, r]));

  const r1 = byRef.get("1");
  assert.ok(r1, "ref 1 present");
  assert.equal(r1.cycle, "");
  assert.ok(/Permit Tech/i.test(r1.reviewed_by));
  assert.ok(/Marlany Gomez/i.test(r1.reviewed_by));
  assert.ok(/12\/9\/25.*2:50 PM/is.test(r1.reviewed_by));
  assert.ok(/Comment.*Submissions/i.test(r1.type));
  assert.ok(!String(r1.filename || "").trim(), "ref 1 filename blank");
  assert.ok(/^Responded by/i.test(r1.discussion.trim()));
  assert.equal(r1.status, "Resolved");

  const r16 = byRef.get("16");
  assert.ok(r16, "ref 16 present");
  assert.ok(/Health and Human Services \(HHS\) Reviewers/i.test(r16.reviewed_by));
  assert.ok(/Annastasia Zenner/i.test(r16.reviewed_by));
  assert.ok(/1\/12\/26.*2:04 PM/i.test(r16.reviewed_by));
  assert.ok(/Changemark/i.test(r16.type) && /INCORRECT TYPE/i.test(r16.type));
  assert.ok(/PUBHHS Application.*Plan Review.*\.pdf/i.test(r16.filename));
  assert.ok(/Reviewer Response/i.test(r16.discussion) && /Responded by/i.test(r16.discussion));

  const r24 = byRef.get("24");
  assert.ok(r24, "ref 24 present");
  assert.ok(/Changemark.*Trashcans.*Indicate/i.test(r24.type));
  assert.ok(/A\.2\s+EQUIPMENT\s+PLAN\.pdf/i.test(r24.filename));
  assert.ok(/Responded by/i.test(r24.discussion) && /Reviewer Response/i.test(r24.discussion));

  console.log("reviewCommentsExcelStructuredRows.selftest.js: OK", { rowCount: rows.length });
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
