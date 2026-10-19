import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { aggregateSheetAnalysisResults, filterSheetResultsBySearch } from "./codeAnalyzer/sheetResults.ts";
import {
  buildAggregatedComplianceExport,
  buildComplianceExportJsonReport,
  complianceIssueResponseKey,
  describeExportFinding,
  exportReportButtonLabel,
  mapReviewerResponse,
  selectSheetsForExport,
  type ComplianceExportResultGroup,
} from "./complianceAnalysisExport.ts";

function makeResult(
  critical: number,
  warnings: number,
  advisory = 0,
  codeType: "ibc" | "local" = "ibc",
) {
  const totalIssues = critical + warnings + advisory;
  const issues = Array.from({ length: totalIssues }, (_, i) => {
    const severity =
      i < critical ? ("critical" as const) : i < critical + warnings ? ("warning" as const) : ("advisory" as const);
    return {
      id: `${codeType}-${i}`,
      category: "Egress",
      title: `${codeType} issue ${i}`,
      description: "desc",
      severity,
      codeReference: "IBC 1010",
      codeYear: "2021",
      location: "Sheet A1",
      suggestedFix: "fix it",
      codeType,
    };
  });
  return {
    issues,
    summary: {
      totalIssues,
      critical,
      warnings,
      advisory,
      overallScore: totalIssues === 0 ? 100 : Math.max(0, 100 - critical * 15 - warnings * 5 - advisory * 2),
    },
    jurisdictionNotes: codeType === "local" ? "Local note" : "",
    codeType,
  };
}

describe("buildAggregatedComplianceExport", () => {
  it("aggregates All displayed groups to match multi-file KPI totals", () => {
    const groups: ComplianceExportResultGroup[] = [
      {
        id: "doc-1",
        fileName: "SPEC #24-070-page1.pdf",
        documentId: "doc-1",
        ibcResult: makeResult(0, 0),
        localResult: null,
      },
      {
        id: "doc-2",
        fileName: "A101.pdf",
        documentId: "doc-2",
        ibcResult: makeResult(5, 2),
        localResult: null,
      },
      {
        id: "doc-3",
        fileName: "E201.pdf",
        documentId: "doc-3",
        ibcResult: makeResult(6, 4),
        localResult: null,
      },
    ];

    const aggregated = buildAggregatedComplianceExport(groups);

    assert.equal(aggregated.filesAnalyzed, 3);
    assert.equal(aggregated.summary.critical, 11);
    assert.equal(aggregated.summary.warnings, 6);
    assert.equal(aggregated.summary.advisory, 0);
    assert.equal(aggregated.summary.totalIssues, 17);
    assert.equal(aggregated.files.length, 3);
    assert.equal(aggregated.issues.length, 17);
    // Score derived from aggregated severities, not the first clean file's 100%.
    assert.ok(aggregated.summary.overallScore < 100);
    assert.equal(
      aggregated.summary.overallScore,
      Math.max(0, 100 - 11 * 15 - 6 * 5),
    );
  });

  it("exports a single selected file group only", () => {
    const groups: ComplianceExportResultGroup[] = [
      {
        id: "doc-2",
        fileName: "A101.pdf",
        documentId: "doc-2",
        ibcResult: makeResult(2, 1),
        localResult: null,
      },
    ];

    const aggregated = buildAggregatedComplianceExport(groups);
    assert.equal(aggregated.filesAnalyzed, 1);
    assert.equal(aggregated.files.length, 1);
    assert.equal(aggregated.files[0].fileName, "A101.pdf");
    assert.equal(aggregated.summary.critical, 2);
    assert.equal(aggregated.summary.warnings, 1);
  });

  it("sums both IBC and local results like the KPI strip", () => {
    const groups: ComplianceExportResultGroup[] = [
      {
        id: "doc-1",
        fileName: "dual.pdf",
        ibcResult: makeResult(1, 0, 0, "ibc"),
        localResult: makeResult(0, 2, 0, "local"),
      },
    ];
    const aggregated = buildAggregatedComplianceExport(groups);
    assert.equal(aggregated.filesAnalyzed, 1);
    assert.equal(aggregated.summary.critical, 1);
    assert.equal(aggregated.summary.warnings, 2);
    assert.equal(aggregated.issues.length, 3);
    assert.equal(aggregated.files[0].codeType, "combined");
  });

  it("skips groups with no results and keeps failed placeholders", () => {
    const groups: ComplianceExportResultGroup[] = [
      {
        id: "empty",
        fileName: "empty.pdf",
        ibcResult: null,
        localResult: null,
      },
      {
        id: "fail",
        fileName: "fail.pdf",
        failed: true,
        error: "timeout",
        ibcResult: null,
        localResult: null,
      },
      {
        id: "ok",
        fileName: "ok.pdf",
        ibcResult: makeResult(1, 0),
        localResult: null,
      },
    ];
    const aggregated = buildAggregatedComplianceExport(groups);
    assert.equal(aggregated.filesAnalyzed, 1);
    assert.equal(aggregated.files.length, 2);
    assert.equal(aggregated.files[0].failed, true);
    assert.equal(aggregated.summary.critical, 1);
  });
});

describe("buildComplianceExportJsonReport", () => {
  it("attaches responses via file-scoped keys", () => {
    const groups: ComplianceExportResultGroup[] = [
      {
        id: "doc-1",
        fileName: "A.pdf",
        ibcResult: makeResult(1, 0),
        localResult: null,
      },
    ];
    const aggregated = buildAggregatedComplianceExport(groups);
    const issueId = aggregated.files[0].issues[0].id;
    const key = complianceIssueResponseKey("doc-1", issueId);
    const report = buildComplianceExportJsonReport({
      aggregated,
      jurisdiction: "general",
      projectType: "commercial",
      codeYear: "2021",
      responses: {
        [key]: { status: "accepted", originalFix: "fix it" },
      },
      generatedAt: "2026-08-06T00:00:00.000Z",
    });

    assert.equal(report.filesAnalyzed, 1);
    assert.equal(report.files[0].issues[0].response?.status, "accepted");
    assert.equal(report.files[0].issues[0].reviewerResponse, "Accept");
    assert.equal(report.summary.critical, 1);
  });
});

function labeledIssue(
  id: string,
  codeType: "ibc" | "local",
  severity: "critical" | "warning" | "advisory",
  codeSourceStatus: "authoritative" | "unverified",
) {
  return {
    id,
    category: "Plumbing",
    title: `${codeType} ${id}`,
    description: "Check the note on this sheet.",
    severity,
    codeReference: codeType === "local" ? "Local amendment" : "IBC 403",
    codeYear: "2021",
    location: "Grid B",
    suggestedFix: "Confirm the dimension.",
    codeType,
    codeSourceStatus,
    sheetFileName: "P-3.0",
  };
}

describe("single-sheet export labels", () => {
  it("includes both IBC and Local findings with scope, edition, sheet, citation, and response", () => {
    const groups: ComplianceExportResultGroup[] = [
      {
        id: "sheet-p",
        fileName: "P-3.0",
        documentId: "sheet-p",
        ibcResult: {
          issues: [labeledIssue("ibc-1", "ibc", "critical", "authoritative")],
          summary: {
            totalIssues: 1,
            critical: 1,
            warnings: 0,
            advisory: 0,
            overallScore: 85,
            reviewState: "reviewed_findings",
          },
          jurisdictionNotes: "",
          codeType: "ibc",
        },
        localResult: {
          issues: [
            labeledIssue("local-1", "local", "warning", "unverified"),
            labeledIssue("local-2", "local", "advisory", "authoritative"),
          ],
          summary: {
            totalIssues: 2,
            critical: 0,
            warnings: 1,
            advisory: 1,
            overallScore: 90,
            reviewState: "reviewed_findings",
          },
          jurisdictionNotes: "Local note",
          codeType: "local",
        },
      },
    ];
    const aggregated = buildAggregatedComplianceExport(groups);
    assert.equal(aggregated.files.length, 1);
    assert.equal(aggregated.issues.length, 3);
    assert.equal(aggregated.summary.totalIssues, 3);

    const report = buildComplianceExportJsonReport({
      aggregated,
      jurisdiction: "general",
      projectType: "commercial",
      codeYear: "2021",
      responses: {
        [complianceIssueResponseKey("sheet-p", "ibc-1")]: { status: "accepted" },
        [complianceIssueResponseKey("sheet-p", "local-1")]: { status: "modified" },
        [complianceIssueResponseKey("sheet-p", "local-2")]: { status: "rejected" },
      },
      generatedAt: "2026-10-20T00:00:00.000Z",
    });
    const issues = report.files[0].issues;
    assert.equal(issues.length, 3);
    assert.deepEqual(
      issues.map((issue) => issue.codeScope),
      ["General IBC", "Local Amendments", "Local Amendments"],
    );
    for (const issue of issues) {
      assert.equal(issue.codeEdition, "2021");
      assert.equal(issue.sheet, "P-3.0");
      assert.ok(issue.citationVerificationStatus);
      assert.ok(issue.reviewerResponse);
    }
    assert.equal(issues[0].citationVerificationStatus, "Verified");
    assert.equal(issues[1].citationVerificationStatus, "Unverified");
    assert.equal(issues[0].reviewerResponse, "Accept");
    assert.equal(issues[1].reviewerResponse, "Modify");
    assert.equal(issues[2].reviewerResponse, "N/A");
    assert.match(issues[0].description, /Check the note/);
  });

  it("maps reviewer responses and leaves an unanswered finding unreviewed", () => {
    assert.equal(mapReviewerResponse({ status: "accepted" }), "Accept");
    assert.equal(mapReviewerResponse({ status: "modified" }), "Modify");
    assert.equal(mapReviewerResponse({ status: "rejected" }), "N/A");
    assert.equal(mapReviewerResponse(null), "Unreviewed");
    const labels = describeExportFinding(
      { codeType: "local", codeYear: "2018", sheetFileName: "A-1", codeSourceStatus: "unverified" },
      { status: "rejected" },
    );
    assert.equal(labels.codeScope, "Local Amendments");
    assert.equal(labels.codeEdition, "2018");
    assert.equal(labels.sheet, "A-1");
    assert.equal(labels.citationVerificationStatus, "Unverified");
    assert.equal(labels.reviewerResponse, "N/A");
  });

  it("retains duplicate issue ids instead of collapsing scopes", () => {
    const shared = labeledIssue("dup", "ibc", "warning", "authoritative");
    const aggregated = buildAggregatedComplianceExport([
      {
        id: "sheet",
        fileName: "A-1",
        ibcResult: {
          issues: [shared],
          summary: {
            totalIssues: 1,
            critical: 0,
            warnings: 1,
            advisory: 0,
            overallScore: 95,
            reviewState: "reviewed_findings",
          },
          jurisdictionNotes: "",
          codeType: "ibc",
        },
        localResult: {
          issues: [{ ...shared, codeType: "local" }],
          summary: {
            totalIssues: 1,
            critical: 0,
            warnings: 1,
            advisory: 0,
            overallScore: 95,
            reviewState: "reviewed_findings",
          },
          jurisdictionNotes: "",
          codeType: "local",
        },
      },
    ]);
    assert.equal(aggregated.issues.length, 2);
    assert.equal(aggregated.issues.filter((issue) => issue.id === "dup").length, 2);
    assert.deepEqual(
      aggregated.issues.map((issue) => issue.codeScope),
      ["General IBC", "Local Amendments"],
    );
  });
});

describe("export all sheets", () => {
  const SHEET_COUNT = 82;

  function modeRow(index: number, mode: "ibc" | "local") {
    const reviewState = index < 50 ? "reviewed_clear" : "reviewed_partial";
    return {
      id: `run-${index}-${mode}`,
      document_id: `doc-${index}`,
      analysis_run_id: "run-1",
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
      },
    };
  }

  it("exports all 82 sheets from 164 records when the UI filter shows fewer", () => {
    const records = [
      ...Array.from({ length: SHEET_COUNT }, (_, index) => modeRow(index, "ibc")),
      ...Array.from({ length: SHEET_COUNT }, (_, index) => modeRow(index, "local")),
    ];
    assert.equal(records.length, 164);
    const sheets = aggregateSheetAnalysisResults(records);
    const groups: ComplianceExportResultGroup[] = sheets.map((sheet) => ({
      id: sheet.documentId,
      fileName: sheet.fileName,
      documentId: sheet.documentId,
      ibcResult: sheet.ibcResult,
      localResult: sheet.localResult,
    }));
    const displayed = filterSheetResultsBySearch(groups, "stair");
    assert.equal(displayed.length, 1);
    const exportedGroups = selectSheetsForExport(groups, displayed, "all");
    assert.equal(exportedGroups.length, SHEET_COUNT);

    const aggregated = buildAggregatedComplianceExport(exportedGroups);
    assert.equal(aggregated.files.length, SHEET_COUNT);
    assert.equal(aggregated.filesAnalyzed, SHEET_COUNT);
    const clear = aggregated.files.filter((file) => file.summary.reviewState === "reviewed_clear");
    const partial = aggregated.files.filter((file) => file.summary.reviewState === "reviewed_partial");
    assert.equal(clear.length, 50);
    assert.equal(partial.length, 32);
    assert.equal(clear.every((file) => file.summary.overallScore === 100 && file.summary.totalIssues === 0), true);
    assert.equal(partial.every((file) => file.summary.overallScore === null && file.summary.totalIssues === 0), true);
    assert.equal(aggregated.files.some((file) => file.summary.overallScore === 0), false);
    assert.equal(aggregated.summary.overallScore, null);
    assert.equal(aggregated.summary.reviewState, "reviewed_partial");
    assert.notEqual(exportReportButtonLabel("pdf", "all"), exportReportButtonLabel("pdf", "filtered"));
    assert.match(exportReportButtonLabel("pdf", "all"), /Export All/);
    assert.match(exportReportButtonLabel("json", "all"), /Export All/);
    assert.match(exportReportButtonLabel("pdf", "filtered"), /only the filtered sheets/);
    assert.doesNotMatch(exportReportButtonLabel("pdf", "filtered"), /Export All/);
  });

  it("keeps an unverified clear sheet unscored in the export", () => {
    const clear = {
      issues: [],
      summary: {
        totalIssues: 0,
        critical: 0,
        warnings: 0,
        advisory: 0,
        overallScore: null,
        reviewState: "reviewed_clear" as const,
        codeCoverageVerified: false,
      },
      jurisdictionNotes: "",
      codeType: "ibc" as const,
    };
    const aggregated = buildAggregatedComplianceExport([
      {
        id: "clear",
        fileName: "Cover",
        ibcResult: clear,
        localResult: { ...clear, codeType: "local" },
      },
    ]);
    assert.equal(aggregated.files.length, 1);
    assert.equal(aggregated.files[0].summary.reviewState, "reviewed_clear");
    assert.equal(aggregated.files[0].summary.overallScore, null);
    assert.equal(aggregated.summary.overallScore, null);
    assert.notEqual(aggregated.summary.overallScore, 0);
  });
});

describe("pdf export contract", () => {
  it("prints finding captions and does not substitute 0% for a missing score", () => {
    const source = readFileSync(new URL("./complianceReportPDF.ts", import.meta.url), "utf8");
    assert.match(source, /findingCaptionLines/);
    assert.match(source, /fileSectionScoreLabel/);
    assert.match(source, /exportScoreText/);
    assert.equal(source.includes("overallScore ?? 0"), false);
  });
});
