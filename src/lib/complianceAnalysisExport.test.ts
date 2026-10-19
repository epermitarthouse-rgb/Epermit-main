import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildAggregatedComplianceExport,
  buildComplianceExportJsonReport,
  combineComplianceScopeSummaries,
  complianceIssueResponseKey,
  formatComplianceScoreLabel,
  selectComplianceExportGroups,
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

  it("labels one IBC finding and two Local findings and keeps an unknown score unset", () => {
    const ibc = makeResult(1, 0, 0, "ibc");
    const localBase = makeResult(0, 1, 1, "local");
    const local = {
      ...localBase,
      summary: {
        ...localBase.summary,
        overallScore: null,
        reviewState: "reviewed_partial" as const,
      },
      reviewReport: {
        selectedScope: "Washington, DC",
        detectedLocation: "Washington, DC",
        amendmentsEnforced: false,
        disclosure: null,
        userEmphasis: null,
        documentsReviewed: ["A-1.pdf"],
        disciplines: ["architectural"],
        confirmedFindings: [],
        verificationQuestions: [],
        cleanChecks: [],
        unreviewable: [],
        evidence: [{ where: "A-1.pdf", quote: "Corridor 44 in", hasRegion: true }],
        withheldReasons: [],
        legalApplicability: { status: "conflict", reviewScope: "reference_only" },
        codeCoverage: { status: "applicability_only", authoritativeProvisionCount: 4 },
      },
    };
    const runGroups: ComplianceExportResultGroup[] = [
      {
        id: "sheet-1",
        fileName: "A-1.pdf",
        ibcResult: ibc,
        localResult: local,
      },
      {
        id: "sheet-2",
        fileName: "hidden-by-search.pdf",
        ibcResult: makeResult(0, 1, 0, "ibc"),
        localResult: null,
      },
    ];
    const filteredView = [runGroups[0]];
    const aggregated = buildAggregatedComplianceExport(selectComplianceExportGroups(runGroups));

    assert.notEqual(aggregated.files.length, filteredView.length);
    assert.equal(aggregated.files.length, 2);
    assert.equal(aggregated.files[0].summary.totalIssues, 3);
    assert.equal(aggregated.files[0].summary.critical, 1);
    assert.equal(aggregated.files[0].summary.warnings, 1);
    assert.equal(aggregated.files[0].summary.advisory, 1);
    assert.equal(aggregated.files[0].summary.overallScore, null);
    assert.equal(formatComplianceScoreLabel(aggregated.files[0].summary), "Partial");
    assert.deepEqual(
      aggregated.files[0].issues.map((issue) => issue.scopeLabel),
      ["IBC", "Local", "Local"],
    );
    assert.equal(aggregated.files[0].scopes[1].evidence[0].quote, "Corridor 44 in");
    assert.equal(combineComplianceScopeSummaries([ibc, local]).totalIssues, 3);
    assert.equal(combineComplianceScopeSummaries([ibc, local]).overallScore, null);
  });
});
