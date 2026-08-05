import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildAggregatedComplianceExport,
  buildComplianceExportJsonReport,
  complianceIssueResponseKey,
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
    assert.equal(report.summary.critical, 1);
  });
});
