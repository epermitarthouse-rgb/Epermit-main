import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { aggregateSheetAnalysisResults, type SheetAnnotationRow } from "./sheetResults.ts";
import { fileSectionScoreLabel, sheetResultPresentation } from "./combinedSheetSummary.ts";
import {
  mergeReviewReportViews,
  reviewEvidenceStripSummary,
  reviewOutcome,
  sheetFindingsHeadline,
} from "./reviewReport.ts";
import {
  IndexTextUnavailableError,
  indexSnapshotForRun,
  runDrawingIndexPrescreen,
} from "./runIndexPrescreen.ts";
import type { CodeAnalyzerSheet } from "./model.ts";
import type { IndexCompletenessResult } from "./indexCompleteness.ts";

const SHEET = "sheet-a104";
const DOC = "doc-a104";

function meta(codeType: "ibc" | "local", extra: Record<string, unknown> = {}): SheetAnnotationRow {
  return {
    id: `meta-${codeType}`,
    document_id: DOC,
    data: {
      compliance_metadata: true,
      codeType,
      sheet_id: SHEET,
      file_name: "A-1.04.00.pdf",
      summary: {
        totalIssues: 1,
        reviewState: "reviewed_partial",
        overallScore: null,
        limitations: [{ code: "reference_only_scope", detail: "Reference-only review." }],
      },
      ...extra,
    },
  } as SheetAnnotationRow;
}

function issueRow(codeType: "ibc" | "local", id: string, title: string): SheetAnnotationRow {
  return {
    id: `row-${codeType}-${id}`,
    document_id: DOC,
    data: {
      compliance_issue: true,
      codeType,
      id,
      sheet_id: SHEET,
      file_name: "A-1.04.00.pdf",
      title,
      severity: "advisory",
      findingType: "missing_information",
    },
  } as SheetAnnotationRow;
}

describe("combined issue counts across IBC and Local", () => {
  it("adds one IBC and one Local finding about the same physical concern", () => {
    const rows = [
      meta("ibc"),
      issueRow("ibc", "issue-1", "Egress path width"),
      meta("local"),
      issueRow("local", "issue-1", "Egress path width"),
    ];
    const [sheet] = aggregateSheetAnalysisResults(rows);
    const presentation = sheetResultPresentation(sheet, "ibc", {}, sheet.documentId);
    assert.equal(presentation.ibcCount, 1);
    assert.equal(presentation.localCount, 1);
    assert.equal(presentation.summary.totalIssues, 2);
    assert.equal(
      presentation.summary.totalIssues,
      presentation.summary.critical + presentation.summary.warnings + presentation.summary.advisory,
    );
    assert.equal(fileSectionScoreLabel(presentation.summary), "2 Findings · Potential issue");

    const view = mergeReviewReportViews([sheet.ibcResult?.reviewReport, sheet.localResult?.reviewReport]);
    assert.ok(view);
    assert.equal(view.verificationQuestions.length, 2);
    const strip = reviewEvidenceStripSummary(view, { totalIssues: presentation.summary.totalIssues });
    assert.equal(strip.reviewStateLabel, "Potential issue");
    assert.equal(strip.countLabel, "2 verification questions");
  });
});

describe("zero-finding partial reviews", () => {
  it("names the unresolved checks, the missing evidence, and the sheets", () => {
    const rejectedCandidates = [
      {
        title: "Potential Inaccessibility of Egress Routes — verification required",
        validationReason: "requirement_reminder",
        validationDetail:
          "Potential Inaccessibility of Egress Routes: the clearance is not stated on this sheet and was not found on a related sheet. Related sheets: A-1.05-00.pdf.",
      },
      { title: "Inconsistent Energy Code Reference", validationReason: "code_edition_contradicted", validationDetail: "Withdrawn." },
    ];
    const rows = [
      meta("ibc", {
        summary: {
          totalIssues: 0,
          reviewState: "reviewed_partial",
          overallScore: null,
          limitations: [{ code: "reference_only_scope", detail: "Reference-only review." }],
        },
        rejectedCandidates,
      }),
    ];
    const [sheet] = aggregateSheetAnalysisResults(rows);
    const presentation = sheetResultPresentation(sheet, "ibc", {}, sheet.documentId);
    assert.equal(presentation.summary.totalIssues, 0);
    assert.equal(reviewOutcome(presentation.summary), "verification_incomplete");
    assert.equal(sheetFindingsHeadline(presentation.summary), "0 Findings · Verification incomplete · 1 unresolved check");
    assert.doesNotMatch(sheetFindingsHeadline(presentation.summary), /Partial|0%|100%/);

    const view = sheet.ibcResult?.reviewReport;
    assert.ok(view);
    assert.equal(view.openChecks.length, 1);
    const [check] = view.openChecks;
    assert.equal(check.check, "Potential Inaccessibility of Egress Routes");
    assert.match(check.missingEvidence ?? "", /clearance is not stated/);
    assert.deepEqual(check.relatedSheets, ["A-1.04.00.pdf", "A-1.05-00.pdf"]);
    assert.equal(reviewEvidenceStripSummary(view, { totalIssues: 0 }).countLabel, "1 unresolved check");
  });

  it("keeps no findings, open checks, potential issues, and verified compliance distinct", () => {
    const open = [{ code: "open_check", detail: "Door clearance: not stated." }];
    assert.equal(
      sheetFindingsHeadline({ reviewState: "reviewed_partial", totalIssues: 0, limitations: [] }),
      "0 Findings · Code compliance unverified",
    );
    assert.equal(
      sheetFindingsHeadline({ reviewState: "reviewed_partial", totalIssues: 0, limitations: open }),
      "0 Findings · Verification incomplete · 1 unresolved check",
    );
    assert.equal(
      sheetFindingsHeadline({ reviewState: "reviewed_findings", totalIssues: 3, limitations: open }),
      "3 Findings · Potential issue",
    );
    assert.equal(
      sheetFindingsHeadline({
        reviewState: "reviewed_clear",
        totalIssues: 0,
        overallScore: 100,
        codeCoverageVerified: true,
        limitations: [],
      }),
      "0 Findings · Verified compliant",
    );
  });
});

function sheet(id: string, file_name: string): CodeAnalyzerSheet {
  return {
    id, project_id: "p", source_document_id: `doc-${id}`, image_document_id: null,
    page_number: 1, file_name, excluded: false, created_at: "2026-01-01",
  };
}

describe("image-based drawing index state", () => {
  const sheets = [sheet("cv", "CV-1.00-00.pdf"), sheet("a1", "A-1.00-00.pdf"), sheet("e1", "E-1.0-00.pdf")];

  it("detects an index whose title is the only text, without inventing rows", async () => {
    const result = await runDrawingIndexPrescreen({
      sheets,
      pageTextBySheetId: { cv: "SCALE: 7 INDEX OF SHEETS N.T.S.", a1: "FLOOR PLAN", e1: "LIGHTING PLAN" },
    });
    assert.equal(result.hasIndex, true);
    assert.equal(result.status, "index_unreadable");
    assert.equal(result.indexSheetId, "cv");
    assert.equal(result.expectedCount, 0);
  });

  it("never reports no index while a sheet has no text yet", async () => {
    await assert.rejects(
      runDrawingIndexPrescreen({ sheets, pageTextBySheetId: { a1: "FLOOR PLAN" } }),
      (err: unknown) => err instanceof IndexTextUnavailableError && err.textlessSheets === 2,
    );
  });

  it("reports no index only when every sheet's text was read", async () => {
    const result = await runDrawingIndexPrescreen({
      sheets,
      pageTextBySheetId: { cv: "COVER SHEET", a1: "FLOOR PLAN", e1: "LIGHTING PLAN" },
    });
    assert.equal(result.status, "no_index");
  });

  it("rechecks a held 'not found' before a run stores it", async () => {
    const stale = { status: "no_index", hasIndex: false } as IndexCompletenessResult;
    const fresh = { status: "index_unreadable", hasIndex: true, indexSheetId: "cv" } as IndexCompletenessResult;
    assert.equal(await indexSnapshotForRun(stale, async () => fresh), fresh);
    assert.equal(await indexSnapshotForRun(null, async () => fresh), fresh);
    const found = { status: "complete", hasIndex: true } as IndexCompletenessResult;
    let rechecked = false;
    assert.equal(await indexSnapshotForRun(found, async () => { rechecked = true; return fresh; }), found);
    assert.equal(rechecked, false);
    const failed = await indexSnapshotForRun(stale, async () => {
      throw new IndexTextUnavailableError(1);
    });
    assert.equal(failed, undefined);
  });
});
