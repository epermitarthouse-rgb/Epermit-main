/**
 * Run: npx tsx supabase/functions/_shared/mapMontgomeryStructuredRowsToDeterministic.selftest.ts
 * Phase B: Excel `structuredRows` → `PgcReviewCommentsRow` + persisted `original_text` shape (refs 1 / 16 / 24).
 */

import assert from "node:assert/strict";

import {
  mapMontgomeryStructuredRowsToPgcDeterministic,
  type MontgomeryPortalStructuredExcelRow,
} from "./mapMontgomeryStructuredRowsToDeterministic.ts";
import type { PgcReviewCommentsRow } from "./pgcReviewCommentsStackedParse.ts";

/** Mirrors `formatPgcDeterministicPersistedComment` in comment-parser-agent (persisted `original_text`). */
function formatPgcPersistedOriginalTextForTest(row: PgcReviewCommentsRow, sourceReport: string): string {
  const sl = (v: unknown) =>
    String(v ?? "").replace(/\r\n|\r|\n/g, " ").replace(/\s+/g, " ").trim();
  return [
    `ref: ${sl(row.ref)}`,
    `cycle: ${sl(row.cycle)}`,
    `reviewed_by: ${sl(row.reviewedBy)}`,
    `type: ${sl(row.type)}`,
    `filename: ${sl(row.filename)}`,
    `full_discussion_text:`,
    row.discussion,
    `status: ${sl(row.status)}`,
    `source_report: ${sl(sourceReport)}`,
    `date_time: ${sl(row.dateTime)}`,
    "",
    "--- original_source_block ---",
    row.originalTextBlock,
  ]
    .join("\n")
    .trim();
}

const FIXTURE_ROWS: MontgomeryPortalStructuredExcelRow[] = [
  {
    ref: 1,
    cycle: "",
    reviewed_by: "Permit Tech / Marlany Gomez / 12/9/25 2:50 PM",
    type: "Comment / Submissions guidelines / Scope",
    filename: "SITE_PLAN_REV1.pdf",
    discussion: "Responded by:\nProvide revised scope narrative.",
    status: "Open",
  },
  {
    ref: "16",
    cycle: 1,
    reviewed_by: "Mechanical Reviewers / Sam Lee",
    type: "Changemark / exhaust note",
    filename: "M.4 MECHANICAL.pdf",
    discussion: "Line one\nLine two Responded by applicant.",
    status: "Resolved",
  },
  {
    ref: "24",
    cycle: "1",
    reviewed_by: "Health and Human (HHS) Reviewers",
    type: "Changemark",
    filename: "A.2 EQUIPMENT PLAN.pdf",
    discussion: "Discuss trash cans near sinks.\nSecond paragraph.",
    status: "Resolved",
  },
];

function run(): void {
  const mapped = mapMontgomeryStructuredRowsToPgcDeterministic(FIXTURE_ROWS);
  assert.equal(mapped.length, 3, "all three refs map");
  assert.deepEqual(mapped.map((r) => r.ref), ["1", "16", "24"]);

  const byRef = Object.fromEntries(mapped.map((r) => [r.ref, r]));
  const report = "Plan Review - Review Comments";

  const b1 = formatPgcPersistedOriginalTextForTest(byRef["1"]!, report);
  assert.ok(/reviewed_by:.*Marlany Gomez/i.test(b1.replace(/\r\n|\n/g, " ")));
  assert.ok(/type:.*Submissions guidelines/i.test(b1.replace(/\r\n|\n/g, " ")));
  assert.ok(/filename: SITE_PLAN_REV1\.pdf/.test(b1));
  const disc1 = b1.split(/full_discussion_text:\s*\r?\n/i)[1]?.split(/\r?\nstatus:\s*/i)[0] ?? "";
  assert.ok(disc1.includes("Responded by:"));
  assert.ok(disc1.includes("revised scope"));
  assert.ok(/\[montgomery:excel-row\]/.test(b1));
  assert.ok(b1.includes('"ref":"1"'));
  const b16 = formatPgcPersistedOriginalTextForTest(byRef["16"]!, report);
  assert.ok(/reviewed_by:.*Mechanical Reviewers/i.test(b16.replace(/\r\n|\n/g, " ")));
  assert.ok(/filename: M\.4 MECHANICAL\.pdf/.test(b16));
  assert.ok(/type:.*Changemark/i.test(b16));
  const disc16 = b16.split(/full_discussion_text:\s*\r?\n/i)[1]?.split(/\r?\nstatus:\s*/i)[0] ?? "";
  assert.ok(disc16.includes("Line one"));
  assert.ok(disc16.includes("Line two"));

  const b24 = formatPgcPersistedOriginalTextForTest(byRef["24"]!, report);
  assert.ok(/reviewed_by:.*Health and Human/i.test(b24.replace(/\r\n|\n/g, " ")));
  assert.ok(/filename: A\.2 EQUIPMENT PLAN\.pdf/.test(b24));
  assert.ok(/type:\s+Changemark\b/.test(b24));
  const disc24 = b24.split(/full_discussion_text:\s*\r?\n/i)[1]?.split(/\r?\nstatus:\s*/i)[0] ?? "";
  assert.ok(/trash cans near sinks/i.test(disc24));
  assert.ok(disc24.includes("Second paragraph"), "discussion keeps newlines");
}

run();
console.log("mapMontgomeryStructuredRowsToDeterministic.selftest.ts OK");
