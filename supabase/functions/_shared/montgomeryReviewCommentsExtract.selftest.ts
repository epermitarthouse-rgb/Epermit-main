/**
 * Run: npx tsx supabase/functions/_shared/montgomeryReviewCommentsExtract.selftest.ts
 * Montgomery adapter + deterministic Montgomery grid parser (not PGC stacked fallback).
 */

import assert from "node:assert/strict";

import {
  extractMontgomeryGridRefOrder,
  findMontgomeryRowAnchorIndices,
  parseMontgomeryGridRowsDeterministic,
  preprocessMontgomeryReviewCommentsExtractText,
} from "./montgomeryReviewCommentsExtract.ts";
import { parsePgcReviewComments, type PgcReviewCommentsRow } from "./pgcReviewCommentsStackedParse.ts";

/** Real tab separators (fixtures must use these — raw template \\t is wrong in TS backticks unless escaped carefully). */
const TAB = "\t";

/** Minimal COMBUILD-shaped sample (structured + small; tab-separated grid rows use real TAB chars). */
const SAMPLE_COMBUILD = [
  "Created in ProjectDox version 9.4.9.943",
  "",
  "Plan Review - Review Comments Report",
  "Project Name: COMBUILD-1140088",
  "Workflow Started: 11/6/2025 4:22:29 PM",
  "Report Generated: 04/28/2026 07:25 AM",
  "REVIEW COMMENTS",
  "REF # CYCLE REVIEWED BY TYPE FILENAME DISCUSSION STATUS",
  ["24", "1", "Health and Human", "Changemark", "A.2 EQUIPMENT PLAN.pdf", "Discuss trash cans near sinks.", "Resolved"].join(
    TAB,
  ),
  ["25", "1", "Health and Human", "Comment", "B.1 PLAN.pdf", "Stamp all sheets.", "Resolved"].join(TAB),
].join("\n");

const SAMPLE_GLUED_ONE_LINE =
  "REF # CYCLE REVIEWED BY TYPE FILENAME DISCUSSION STATUS " +
  "24 1 Health and Human Services (HHS) Reviewers Changemark A.2 EQUIPMENT PLAN.pdf Responded by note A. Resolved " +
  "25 1 Health and Human Services (HHS) Reviewers Comment B.1.pdf More discussion here. Resolved";

/** Multiline portal-style blocks: ref 24 uses tab-aligned TYPE overflow lines (real TAB chars). */
const SAMPLE_MULTILINE_REF_BLOCKS = [
  "Plan Review - Review Comments Report",
  "Project Name: COMBUILD-TEST",
  "REF # CYCLE REVIEWED BY TYPE FILENAME DISCUSSION STATUS",
  [
    "24",
    "1",
    "Health and Human Services (HHS) Reviewers / Annastasia Zenner",
    "Changemark",
    "A.2 EQUIPMENT PLAN.pdf",
    "Responded by: _ Commun-ET LLC -",
    "Resolved",
  ].join(TAB),
  ["", "", "", "Trashcans", "", "", ""].join(TAB),
  ["", "", "", "Indicate the intended location and specifications of trashcans near sinks.", "", "", ""].join(TAB),
  "26 1 Mechanical Reviewers Changemark B.3 MECHANICAL.pdf Responded by: Applicant note on sheet. Resolved",
  "RESTROOM EXHAUST",
  "Provide compliant restroom exhaust per COMAR.",
  "Sam Reviewer",
  "31 1 Energy Reviewers Changemark C.1 ENERGY.pdf Responded by: _ Commun-ET LLC - Resolved",
  "Energy Code Compliance",
  "Submit updated COMcheck documentation for envelope and mechanical systems.",
  "Pat Inspector",
  "39 2 Mechanical Reviewers Comment D.2 PLUMBING.pdf Responded by: coordination note. Resolved",
  "Paolo 2 Item 1",
  "Verify fixture text appears in the main discussion body before applicant response.",
  "Alex Partner",
].join("\n");

/** COMBUILD-1140088–style large grid: refs 1–42 with blank-cycle, .docx, and no-attachment rows */
function buildCombuildLargeFixture(): string {
  const header = `
Plan Review - Review Comments Report
Project Name: COMBUILD-1140088
Report Generated: 04/28/2026 07:25 AM
REF # CYCLE REVIEWED BY TYPE FILENAME DISCUSSION STATUS
`;
  const rows: string[] = [];
  for (let ref = 1; ref <= 42; ref++) {
    if (ref <= 6) {
      rows.push(
        `${ref} Permit Tech Comment COMBUILD-R${ref}_SHEET.pdf Discussion body for blank-cycle ref ${ref}. Resolved`,
      );
    } else if (ref >= 17 && ref <= 19) {
      rows.push(
        `${ref}\t1\tHealth and Human\tChangemark\tHACCP - POP UP BAGELS.docx\tDiscussion docx ref ${ref}.\tResolved`,
      );
    } else if (ref === 30) {
      rows.push(
        `30 1 Health and Human Services (HHS) Reviewers Comment Responded by: applicant note for ref 30. Resolved`,
      );
    } else {
      rows.push(
        `${ref}\t1\tHealth and Human Services (HHS) Reviewers\tChangemark\tCOMBUILD-R${ref}_SHEET.pdf\tDiscussion body for ref ${ref}.\tResolved`,
      );
    }
  }
  return `${header.trim()}\n${rows.join("\n")}`;
}

/** Discussion line must not be parsed as a fake ref row (REG #17–#19 trap). */
const SAMPLE_INTERNAL_REF_NOT_ANCHOR = `
17 1 Health and Human Changemark HACCP - POP UP BAGELS.docx Row seventeen. Resolved
See cross-refs REF #17-#19 in prior submittal for context.
18 1 Health and Human Changemark HACCP - POP UP BAGELS.docx Row eighteen. Resolved
`;

function assertNoMalformedCycle(rows: ReturnType<typeof parseMontgomeryGridRowsDeterministic>): void {
  for (const r of rows) {
    assert.ok(!/review/i.test(String(r.cycle)), `cycle leaked text: ${r.cycle}`);
    assert.ok(/^\d*$/.test(String(r.cycle).trim()), `cycle must be digits or empty: ${r.cycle}`);
  }
}

function assertNoMergedRowSwallow(rows: ReturnType<typeof parseMontgomeryGridRowsDeterministic>): void {
  for (const r of rows) {
    const block = r.originalTextBlock ?? "";
    const anchorCount = findMontgomeryRowAnchorIndices(block).length;
    assert.ok(
      anchorCount <= 1,
      `row ref ${r.ref} block unexpectedly contains multiple grid anchors: ${anchorCount}`,
    );
  }
}

/** PDF-aligned sample rows; ref 24 uses tab-wrapped TYPE continuation (portal column alignment). */
const PDF_COLUMN_ACCURACY_FIXTURE = [
  "REF # CYCLE REVIEWED BY TYPE FILENAME DISCUSSION STATUS",
  "1 Permit Tech / Marlany Gomez / 12/9/25 2:50 PM Comment / Submissions did not meet guidelines for the following reasons: -Scope of work not listed on cover sheet Responded by: Will fix. Resolved",
  "2 Permit Tech / Person B / 12/10/25 1:00 PM Comment / Second note. COMBUILD-R2_SHEET.pdf OK. Resolved",
  "6 Applicant Inquiry / Jane D / 1/1/26 10:00 AM Inquiry / Scope question text. Responded by applicant. Resolved",
  "7 1 Mechanical Reviewers / Paolo Toschi / 12/23/25 11:37 AM Changemark / Paolo 1 Item 1 M.2 MECHANICAL PLANS.pdf Include a plat, and clearly identify property lines. Responded by: firm X note. Resolved",
  "8 1 Mechanical Reviewers / Paolo Toschi / 12/23/25 11:38 AM Changemark / Paolo 1 Item 2 M.2 MECHANICAL PLANS.pdf Include a detail drawing showing compliance with NFPA 96 section and figure 7.8.3. Responded by: note. Resolved",
  [
    "24",
    "1",
    "Health and Human Services (HHS) Reviewers / Annastasia Zenner",
    "Changemark",
    "A.2 EQUIPMENT PLAN.pdf",
    "Responded by: _ Commun-ET LLC -",
    "Resolved",
  ].join(TAB),
  ["", "", "", "Trashcans", "", "", ""].join(TAB),
  ["", "", "", "Indicate the intended location and specifications of trashcans near sinks.", "", "", ""].join(TAB),
  "31 1 Energy Reviewers / Ye Jiang / 1/16/26 12:28 PM Changemark E.2 LIGHTING PLAN.pdf Energy Code Compliance Detail lighting controls per COMAR. Responded by applicant. Resolved",
].join("\n");

/** REVIEWED BY cell split across PDF lines — leader merge must reconstruct before TYPE anchor. */
const SPLIT_LEADER_REF_1 = `
REF # CYCLE REVIEWED BY TYPE FILENAME DISCUSSION STATUS
1 Permit Tech / Marlany Gomez /
12/9/25 2:50 PM Comment / Submissions did not meet guidelines for the following reasons: -Scope of work not listed on cover sheet Responded by: Will fix. Resolved
`;

/**
 * Exact tab-grid excerpts from COMBUILD-1140088 export semantics (seven columns).
 * Ref 1 wraps REVIEWED BY across two physical lines; ref 7 is one line.
 */
const COMBUILD_1140088_REF1_TAB_SOURCE = [
  "REF # CYCLE REVIEWED BY TYPE FILENAME DISCUSSION STATUS",
  ["1", "", "Permit Tech / Marlany Gomez /", "", "", "", ""].join(TAB),
  [
    "",
    "",
    "12/9/25 2:50 PM",
    "Comment / Submissions did not meet guidelines for the following reasons: -Scope of work not listed on cover sheet",
    "",
    "Responded by: Will fix.",
    "Resolved",
  ].join(TAB),
].join("\n");

const COMBUILD_1140088_REF7_TAB_SOURCE = [
  "REF # CYCLE REVIEWED BY TYPE FILENAME DISCUSSION STATUS",
  [
    "7",
    "1",
    "Mechanical Reviewers / Paolo Toschi / 12/23/25 11:37 AM",
    "Changemark / Paolo 1 Item 1 / Include a plat, and clearly identify property lines",
    "M.2 MECHANICAL PLANS.pdf",
    "Responded by: A Plot Plan has been added to the M.1 sheet.",
    "Resolved",
  ].join(TAB),
].join("\n");

/** Mirrors `formatPgcDeterministicPersistedComment` in comment-parser-agent (persisted `original_text`). */
function formatPgcPersistedOriginalTextForTest(row: PgcReviewCommentsRow, sourceReport: string): string {
  const sl = (v: unknown) => String(v ?? "").replace(/\r\n|\r|\n/g, " ").replace(/\s+/g, " ").trim();
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

function assertCombuild1140088TabSourcePersistedBlobs(): void {
  const hdr =
    "Plan Review - Review Comments Report\nProject Name: COMBUILD-1140088\nReport Generated: 01/01/2026 00:00 AM\n\n";

  const p1 = preprocessMontgomeryReviewCommentsExtractText(hdr + COMBUILD_1140088_REF1_TAB_SOURCE);
  const r1 = parseMontgomeryGridRowsDeterministic(p1).find((r) => String(r.ref) === "1");
  assert.ok(r1, "COMBUILD ref 1 tab block parses");
  assert.equal(r1!.cycle ?? "", "");
  const blob1 = formatPgcPersistedOriginalTextForTest(r1!, "COMBUILD-1140088");
  const flat1 = blob1.replace(/\r\n|\n/g, " ");
  assert.ok(
    /reviewed_by:.*Permit Tech.*Marlany Gomez.*12\/9\/25.*2:50 PM/i.test(flat1),
    "persisted reviewed_by full cell",
  );
  assert.ok(
    /type:.*Comment.*Submissions did not meet.*Scope of work/i.test(flat1),
    "persisted type full cell",
  );
  const disc1 = blob1.split(/full_discussion_text:\s*\r?\n/i)[1]?.split(/\r?\nstatus:\s*/i)[0] ?? "";
  assert.ok(disc1.trim().toLowerCase().startsWith("responded by"), "ref 1 discussion column");
  assert.ok(!disc1.includes("Marlany Gomez"), "ref 1 discussion must not bleed reviewed-by text");

  const p7 = preprocessMontgomeryReviewCommentsExtractText(hdr + COMBUILD_1140088_REF7_TAB_SOURCE);
  const r7 = parseMontgomeryGridRowsDeterministic(p7).find((r) => String(r.ref) === "7");
  assert.ok(r7, "COMBUILD ref 7 tab block parses");
  assert.equal(String(r7!.cycle ?? ""), "1");
  assert.equal(r7!.filename.trim(), "M.2 MECHANICAL PLANS.pdf");
  const blob7 = formatPgcPersistedOriginalTextForTest(r7!, "COMBUILD-1140088");
  const flat7 = blob7.replace(/\r\n|\n/g, " ");
  assert.ok(
    /reviewed_by:.*Mechanical.*Reviewers.*Paolo Toschi.*12\/23\/25.*11:37 AM/i.test(flat7),
    "ref 7 persisted reviewed_by full cell",
  );
  assert.ok(
    /type:.*Changemark.*Paolo 1 Item 1.*Include a plat/i.test(flat7),
    "ref 7 persisted type full cell",
  );
  assert.ok(blob7.includes("M.2 MECHANICAL PLANS.pdf"), "ref 7 filename in persisted blob header");
  const disc7 = blob7.split(/full_discussion_text:\s*\r?\n/i)[1]?.split(/\r?\nstatus:\s*/i)[0] ?? "";
  assert.ok(disc7.trim().toLowerCase().startsWith("responded by"), "ref 7 discussion starts Responded by");
  assert.ok(disc7.includes("A Plot Plan"), "ref 7 discussion contains plot plan response");
}

function assertSplitRef1MultilineLeader(rows: ReturnType<typeof parseMontgomeryGridRowsDeterministic>): void {
  assert.equal(rows.length, 1, "split-leader ref 1");
  const r1 = rows[0]!;
  assert.equal(String(r1!.ref).trim(), "1");
  assert.equal(r1!.cycle ?? "", "");
  assert.ok(
    /Permit Tech/i.test(r1!.reviewedBy) &&
      /Marlany Gomez/i.test(r1!.reviewedBy) &&
      /12\/9\/25/.test(r1!.reviewedBy),
    "split leader: REVIEWED BY includes dept, reviewer, timestamp",
  );
  assert.ok(
    /Comment/i.test(r1!.type) &&
      /Submissions did not meet guidelines/i.test(r1!.type) &&
      /Scope of work/i.test(r1!.type),
    "split leader: TYPE full cell",
  );
  assert.ok(r1!.discussion.trim().startsWith("Responded by"), "split leader: DISCUSSION");
}

function assertPdfColumnFixture(rows: ReturnType<typeof parseMontgomeryGridRowsDeterministic>): void {
  const byRef = new Map(rows.map((r) => [String(r.ref), r]));
  for (const r of ["1", "2", "6", "7", "8", "24", "31"]) assert.ok(byRef.has(r), `expected ref ${r} in PDF fixture`);

  assert.equal(byRef.get("1")?.cycle ?? "", "");
  assert.equal(byRef.get("7")?.cycle, "1");

  const r1 = byRef.get("1")!;
  assert.ok(
    /Permit Tech/i.test(r1.reviewedBy) && /Marlany Gomez/i.test(r1.reviewedBy) && /12\/9\/25/i.test(r1.reviewedBy),
    "ref 1 REVIEWED BY full PDF cell",
  );
  assert.ok(
    /Comment/i.test(r1.type) && /Submissions did not meet guidelines/i.test(r1.type) && /Scope of work/i.test(r1.type),
    "ref 1 TYPE full PDF cell",
  );
  assert.equal((r1.filename ?? "").trim(), "");
  assert.ok(r1.discussion.trim().startsWith("Responded by"), "ref 1 DISCUSSION is portal Responded block");

  const r7 = byRef.get("7")!;
  assert.ok(
    /Mechanical\s+Reviewers/i.test(r7.reviewedBy) &&
      r7.reviewedBy.includes("Paolo Toschi") &&
      /12\/23\/25/.test(r7.reviewedBy) &&
      /11:37\s+AM/i.test(r7.reviewedBy),
    "ref 7 REVIEWED BY full cell incl. timestamp",
  );
  assert.ok(
    /Changemark/i.test(r7.type) &&
      /Paolo\s+1\s+Item\s+1/i.test(r7.type) &&
      /Include a plat/i.test(r7.type),
    "ref 7 TYPE includes Changemark, item line, and plat detail (PDF TYPE cell after filename)",
  );
  assert.ok(/M\.2\s+MECHANICAL\s+PLANS\.pdf/i.test(r7.filename));
  assert.ok(r7.discussion.trim().startsWith("Responded"), "ref 7 DISCUSSION starts with Responded block");
  assert.ok(!r7.discussion.includes("Include a plat"), "ref 7 plat detail stays in TYPE, not DISCUSSION");
  assert.ok(r7.discussion.includes("Responded by"), "ref 7 DISCUSSION includes response text");

  const r8 = byRef.get("8")!;
  assert.ok(/Paolo\s+1\s+Item\s+2/i.test(r8.type));
  assert.ok(
    /NFPA\s+96|7\.8\.3/.test(r8.type) || r8.discussion.includes("NFPA 96") || r8.discussion.includes("7.8.3"),
    "ref 8 NFPA / figure detail is TYPE overflow after filename or in discussion",
  );

  const r24 = byRef.get("24")!;
  assert.ok(
    /Changemark/i.test(r24.type) && /Trashcans/i.test(r24.type) && /Indicate the intended location/i.test(r24.type),
    "ref 24 TYPE includes Changemark + wrapped Trashcans / Indicate lines",
  );
  assert.ok(/A\.2\s+EQUIPMENT\s+PLAN\.pdf/i.test(r24.filename));
  assert.ok(
    /Health and Human Services \(HHS\) Reviewers/i.test(r24.reviewedBy) && /Annastasia Zenner/i.test(r24.reviewedBy),
    "ref 24 REVIEWED BY full cell",
  );
  assert.ok(r24.discussion.includes("Responded by"), "ref 24 DISCUSSION includes response text");

  const r31 = byRef.get("31")!;
  assert.ok(r31.reviewedBy.includes("Energy") && r31.reviewedBy.includes("Ye Jiang"));
  assert.ok(/E\.2\s+LIGHTING\s+PLAN\.pdf/i.test(r31.filename));
  assert.ok(
    r31.discussion.includes("Energy Code Compliance") || /Energy Code Compliance/i.test(r31.type),
    "ref 31 Energy Code Compliance may sit in TYPE overflow after filename or in discussion",
  );
}

function assertMultilineRefFixture(rows: ReturnType<typeof parseMontgomeryGridRowsDeterministic>): void {
  const byRef = new Map(rows.map((r) => [String(r.ref), r]));

  const r24 = byRef.get("24");
  const r26 = byRef.get("26");
  const r31 = byRef.get("31");
  const r39 = byRef.get("39");
  assert.ok(r24 && r26 && r31 && r39, "expected refs 24, 26, 31, 39 in multiline fixture");

  assert.ok(/Trashcans/i.test(r24!.type), "ref 24: Trashcands overflow wraps into TYPE");
  assert.ok(/Indicate the intended location/i.test(r24!.type), "ref 24: Indicate overflow in TYPE");
  assert.ok(r24!.discussion.includes("Responded by") || r24!.discussion.includes("Commun"), "ref 24: discussion keeps response blob");

  assert.ok(/RESTROOM\s+EXHAUST/i.test(r26!.discussion), "ref 26: discussion includes RESTROOM EXHAUST");

  assert.ok(r31!.discussion.includes("Energy Code Compliance"), "ref 31: discussion includes Energy Code Compliance");

  assert.ok(r39!.discussion.includes("Paolo 2 Item 1"), "ref 39: discussion includes Paolo 2 Item 1");
}

function run(): void {
  const a = preprocessMontgomeryReviewCommentsExtractText(SAMPLE_COMBUILD);
  assert.ok(extractMontgomeryGridRefOrder(a).length >= 2, "grid ref order extracts leading refs");

  const monoSmall = parseMontgomeryGridRowsDeterministic(a);
  assert.ok(monoSmall.length >= 2);

  const g = preprocessMontgomeryReviewCommentsExtractText(SAMPLE_GLUED_ONE_LINE);
  const monoGlued = parseMontgomeryGridRowsDeterministic(g);
  assert.ok(monoGlued.length >= 2);
  assertNoMalformedCycle(monoGlued);
  assertNoMergedRowSwallow(monoGlued);

  /** Large realistic grid */
  const rawLarge = buildCombuildLargeFixture();
  const mega = preprocessMontgomeryReviewCommentsExtractText(rawLarge);
  const monoMega = parseMontgomeryGridRowsDeterministic(mega);
  assert.ok(
    monoMega.length >= 42,
    `expected 42 Montgomery rows for COMBUILD 1–42, got ${monoMega.length}`,
  );

  const gotRefs = new Set(monoMega.map((r) => String(r.ref).trim()));
  for (const need of [
    "1", "2", "3", "4", "5", "6",
    "7", "16", "17", "18", "19", "20", "24", "25", "26", "27", "30", "31", "39", "42",
  ]) {
    assert.ok(gotRefs.has(need), `missing distinct ref ${need}`);
  }

  const byRef = new Map(monoMega.map((r) => [String(r.ref), r]));
  for (const r of ["1", "2", "3", "4", "5", "6"]) assert.equal(byRef.get(r)?.cycle ?? "", "");
  for (const r of ["17", "18", "19", "30"]) assert.equal(byRef.get(r)?.cycle ?? "", "1");
  assert.ok(
    /\.docx$/i.test(String(byRef.get("17")?.filename)),
    "ref 17 docx filename preserved",
  );

  const trap = preprocessMontgomeryReviewCommentsExtractText(SAMPLE_INTERNAL_REF_NOT_ANCHOR);
  const monoTrap = parseMontgomeryGridRowsDeterministic(trap);
  assert.equal(
    monoTrap.length,
    2,
    `internal REF #17-#19 prose must not split rows; expected 2 refs, got ${monoTrap.length}`,
  );
  assertNoMalformedCycle(monoMega);
  assertNoMergedRowSwallow(monoMega);

  /** PGC stacked path may merge on mega — not asserted; Montgomery parser is authoritative for export */
  const pgcMega = parsePgcReviewComments(mega);
  void pgcMega;

  const multi = preprocessMontgomeryReviewCommentsExtractText(SAMPLE_MULTILINE_REF_BLOCKS);
  const monoMulti = parseMontgomeryGridRowsDeterministic(multi);
  assert.ok(monoMulti.length >= 4, `expected multiline fixture rows, got ${monoMulti.length}`);
  assertMultilineRefFixture(monoMulti);
  assertNoMalformedCycle(monoMulti);
  assertNoMergedRowSwallow(monoMulti);

  const splitLead = preprocessMontgomeryReviewCommentsExtractText(SPLIT_LEADER_REF_1);
  const monoSplitLead = parseMontgomeryGridRowsDeterministic(splitLead);
  assertSplitRef1MultilineLeader(monoSplitLead);
  assertNoMalformedCycle(monoSplitLead);

  assertCombuild1140088TabSourcePersistedBlobs();

  const pdfAcc = preprocessMontgomeryReviewCommentsExtractText(PDF_COLUMN_ACCURACY_FIXTURE);
  const monoPdf = parseMontgomeryGridRowsDeterministic(pdfAcc);
  assertPdfColumnFixture(monoPdf);
  assertNoMalformedCycle(monoPdf);

  console.log("montgomeryReviewCommentsExtract.selftest: OK", {
    mono_small: monoSmall.length,
    mono_glued: monoGlued.length,
    mono_mega_count: monoMega.length,
    grid_refs_mega: extractMontgomeryGridRefOrder(mega).length,
    mono_multiline: monoMulti.length,
    mono_pdf_accuracy: monoPdf.length,
  });
}

run();
