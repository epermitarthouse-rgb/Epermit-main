import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  aggregateSheetAnalysisResults,
  fetchAllPages,
  filterSheetResultsBySearch,
  formatSheetResultsCounter,
  type SheetAnnotationRow,
} from "./sheetResults.ts";

const ACTIVE_RUN = "106f9523-975c-406c-bd0c-e58f0316c47b";
const SHEET_COUNT = 82;

function reviewStateFor(index: number): "reviewed_clear" | "reviewed_partial" {
  return index < 50 ? "reviewed_clear" : "reviewed_partial";
}

function modeRow(
  index: number,
  mode: "ibc" | "local",
  runId: string,
): SheetAnnotationRow {
  const reviewState = reviewStateFor(index);
  return {
    id: `${runId}-${index}-${mode}`,
    document_id: `doc-${index}`,
    analysis_run_id: runId,
    data: {
      compliance_metadata: true,
      codeType: mode,
      sheet_id: `sheet-${index}`,
      sheet_file_name: index === 7 ? "Stair Detail" : `Sheet ${String(index + 1).padStart(3, "0")}`,
      summary: {
        reviewState,
        totalIssues: 0,
        critical: 0,
        warnings: 0,
        advisory: 0,
        overallScore: reviewState === "reviewed_clear" ? 100 : null,
        codeCoverageVerified: reviewState === "reviewed_clear",
      },
      jurisdictionNotes: `${mode}-note`,
    },
  };
}

/** 82 sheets × IBC + local metadata. Issue rows are separate annotations. */
function activeRunRecords(): SheetAnnotationRow[] {
  const ibc = Array.from({ length: SHEET_COUNT }, (_, index) => modeRow(index, "ibc", ACTIVE_RUN));
  const local = Array.from({ length: SHEET_COUNT }, (_, index) => modeRow(index, "local", ACTIVE_RUN));
  return [...ibc, ...local];
}

describe("aggregateSheetAnalysisResults", () => {
  const records = activeRunRecords();

  it("returns all 82 sheets from 164 IBC and local records", () => {
    assert.equal(records.length, 164);
    const sheets = aggregateSheetAnalysisResults(records);
    assert.equal(sheets.length, SHEET_COUNT);
    assert.equal(new Set(sheets.map((sheet) => sheet.sheetId)).size, SHEET_COUNT);
    assert.equal(sheets.every((sheet) => sheet.ibcResult && sheet.localResult), true);
    assert.equal(sheets[0].ibcResult?.jurisdictionNotes, "ibc-note");
    assert.equal(sheets[0].localResult?.jurisdictionNotes, "local-note");
  });

  it("keeps clear, partial, and zero-issue sheets", () => {
    const sheets = aggregateSheetAnalysisResults(records);
    const clear = sheets.filter(
      (sheet) =>
        sheet.ibcResult?.summary.reviewState === "reviewed_clear" &&
        sheet.ibcResult.summary.totalIssues === 0 &&
        sheet.localResult?.summary.totalIssues === 0,
    );
    const partial = sheets.filter(
      (sheet) => sheet.ibcResult?.summary.reviewState === "reviewed_partial",
    );
    assert.equal(clear.length, 50);
    assert.equal(partial.length, 32);
    assert.equal(clear.length + partial.length, SHEET_COUNT);
  });

  it("shows Showing 82 of 82 when unfiltered, and search changes only the shown count", () => {
    const sheets = aggregateSheetAnalysisResults(records);
    assert.equal(formatSheetResultsCounter(sheets.length, sheets.length), "Showing 82 of 82 sheets");
    const searched = filterSheetResultsBySearch(sheets, "STAIR");
    assert.equal(searched.length, 1);
    assert.equal(searched[0].fileName, "Stair Detail");
    assert.equal(
      formatSheetResultsCounter(searched.length, sheets.length),
      "Showing 1 of 82 sheets",
    );
    assert.equal(sheets.length, 82);
  });
});

describe("active-run paging versus the 1000-row cap", () => {
  const current = activeRunRecords();
  const older = Array.from({ length: 982 }, (_, index) =>
    modeRow(index % SHEET_COUNT, index % 2 === 0 ? "ibc" : "local", `older-${index}`),
  );
  const heap = [...older, ...current];

  it("an unordered 1000-row project page contains 18 active-run sheets and drops the other mode", () => {
    const page = heap.slice(0, 1000);
    const visible = aggregateSheetAnalysisResults(
      page.filter((row) => row.analysis_run_id === ACTIVE_RUN),
    );
    assert.equal(visible.length, 18);
    assert.equal(visible.every((sheet) => sheet.ibcResult && !sheet.localResult), true);
  });

  it("a run-scoped paged read returns all 82 sheets and both modes", async () => {
    const loaded = await fetchAllPages(
      async (from, to) => current.slice(from, to + 1),
      1000,
    );
    const sheets = aggregateSheetAnalysisResults(loaded);
    assert.equal(loaded.length, 164);
    assert.equal(sheets.length, 82);
    assert.equal(sheets.every((sheet) => sheet.ibcResult && sheet.localResult), true);
  });

  it("pages past 1000 rows so local results stored after the first page are kept", async () => {
    const issues: SheetAnnotationRow[] = Array.from({ length: 950 }, (_, index) => {
      const sheetIndex = index % SHEET_COUNT;
      return {
        id: `issue-${index}`,
        document_id: `doc-${sheetIndex}`,
        analysis_run_id: ACTIVE_RUN,
        data: {
          compliance_issue: true,
          codeType: "ibc",
          sheet_id: `sheet-${sheetIndex}`,
          id: `issue-${index}`,
          title: "Exit width",
          severity: "warning",
          sheet_file_name: `Sheet ${sheetIndex}`,
        },
      };
    });
    const wide = [...current.slice(0, SHEET_COUNT), ...issues, ...current.slice(SHEET_COUNT)];
    assert.ok(wide.length > 1000);
    const firstPage = aggregateSheetAnalysisResults(wide.slice(0, 1000));
    assert.equal(firstPage.some((sheet) => sheet.localResult == null), true);

    let calls = 0;
    const loaded = await fetchAllPages(async (from, to) => {
      calls += 1;
      return wide.slice(from, to + 1);
    }, 1000);
    const sheets = aggregateSheetAnalysisResults(loaded);
    assert.equal(calls, 2);
    assert.equal(sheets.length, 82);
    assert.equal(sheets.every((sheet) => sheet.ibcResult && sheet.localResult), true);
    assert.equal(sheets.some((sheet) => (sheet.ibcResult?.issues.length ?? 0) > 0), true);
  });
});

describe("stored finding labels", () => {
  it("keeps citation verification status and a nullable findings score", () => {
    const sheets = aggregateSheetAnalysisResults([
      {
        id: "meta",
        document_id: "doc-1",
        analysis_run_id: ACTIVE_RUN,
        data: {
          compliance_metadata: true,
          codeType: "ibc",
          sheet_id: "sheet-1",
          sheet_file_name: "Plumbing Plan",
          summary: {
            reviewState: "reviewed_findings",
            totalIssues: 1,
            critical: 0,
            warnings: 1,
            advisory: 0,
            overallScore: null,
          },
        },
      },
      {
        id: "issue-1",
        document_id: "doc-1",
        analysis_run_id: ACTIVE_RUN,
        data: {
          compliance_issue: true,
          codeType: "ibc",
          sheet_id: "sheet-1",
          id: "finding-1",
          title: "Vent size",
          severity: "warning",
          codeYear: "2021",
          codeSourceStatus: "unverified",
          sheet_file_name: "Plumbing Plan",
        },
      },
    ]);
    assert.equal(sheets.length, 1);
    assert.equal(sheets[0].ibcResult?.issues[0].codeSourceStatus, "unverified");
    assert.equal(sheets[0].ibcResult?.issues[0].codeYear, "2021");
    assert.equal(sheets[0].ibcResult?.summary.reviewState, "reviewed_findings");
    assert.equal(sheets[0].ibcResult?.summary.overallScore, null);
  });
});
