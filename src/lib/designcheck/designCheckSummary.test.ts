import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  aggregateImpact,
  bucketImpactCategory,
  buildDesignCheckSummary,
  recomputeOverallScore,
  summarizeFindings,
  type DesignCheckFinding,
} from "./designCheckSummary.ts";

describe("designCheckSummary helpers", () => {
  it("buckets categories into impact groups", () => {
    assert.equal(bucketImpactCategory("Egress"), "Life Safety");
    assert.equal(bucketImpactCategory("Fire Safety"), "Life Safety");
    assert.equal(bucketImpactCategory("Accessibility"), "Accessibility");
    assert.equal(bucketImpactCategory("Zoning"), "Administrative");
    assert.equal(bucketImpactCategory("MEP"), "Other");
    assert.equal(bucketImpactCategory(""), "Other");
  });

  it("recomputes overall score with the analyzer FE formula", () => {
    assert.equal(recomputeOverallScore({ critical: 0, warnings: 0, advisory: 0, totalIssues: 0 }), 100);
    assert.equal(recomputeOverallScore({ critical: 2, warnings: 1, advisory: 1, totalIssues: 4 }), 63);
    assert.equal(recomputeOverallScore({ critical: 10, warnings: 0, advisory: 0, totalIssues: 10 }), 0);
  });

  it("builds a project summary from annotation rows without inventing findings", () => {
    const summary = buildDesignCheckSummary(
      [
        {
          id: "meta-1",
          document_id: "doc-1",
          updated_at: "2026-08-01T00:00:00Z",
          data: {
            compliance_metadata: true,
            codeType: "ibc",
            jurisdiction: "dc",
            projectType: "commercial",
            codeYear_meta: "2021",
            summary: {
              totalIssues: 2,
              critical: 1,
              warnings: 1,
              advisory: 0,
              overallScore: 80,
            },
          },
        },
        {
          id: "issue-1",
          document_id: "doc-1",
          updated_at: "2026-08-01T01:00:00Z",
          data: {
            compliance_issue: true,
            codeType: "ibc",
            id: "f1",
            category: "Egress",
            title: "Exit width short",
            description: "Corridor width below min",
            severity: "critical",
            codeReference: "IBC 1005.1",
            location: "Sheet A-101",
            suggestedFix: "Widen corridor",
          },
        },
        {
          id: "issue-2",
          document_id: "doc-1",
          updated_at: "2026-08-01T02:00:00Z",
          data: {
            compliance_issue: true,
            codeType: "ibc",
            id: "f2",
            category: "Accessibility",
            title: "Ramp slope",
            description: "Slope exceeds max",
            severity: "warning",
            codeReference: "IBC 1012.2",
            location: "Sheet A-102",
            suggestedFix: "Reduce slope",
          },
        },
        {
          id: "noise",
          document_id: "doc-1",
          data: { note: "not compliance" },
        },
      ],
      [{ id: "doc-1", file_name: "plans.pdf" }],
    );

    assert.ok(summary);
    assert.equal(summary!.findings.length, 2);
    assert.equal(summary!.summary.critical, 1);
    assert.equal(summary!.summary.warnings, 1);
    assert.equal(summary!.summary.overallScore, 80); // 100 - 15 - 5
    assert.equal(summary!.documents[0]?.fileName, "plans.pdf");
    assert.equal(summary!.jurisdiction, "dc");
    assert.equal(summary!.impact["Life Safety"], 1);
    assert.equal(summary!.impact.Accessibility, 1);
    assert.equal(summary!.hasIbc, true);
  });

  it("returns null when no compliance annotations exist", () => {
    assert.equal(buildDesignCheckSummary([{ id: "x", document_id: "d", data: {} }], []), null);
  });

  it("uses overallScore 100 when only metadata exists with echoed 85 and zero issue rows", () => {
    const summary = buildDesignCheckSummary(
      [
        {
          id: "meta-1",
          document_id: "doc-1",
          data: {
            compliance_metadata: true,
            codeType: "ibc",
            summary: {
              totalIssues: 0,
              critical: 0,
              warnings: 0,
              advisory: 0,
              overallScore: 85,
            },
          },
        },
      ],
      [{ id: "doc-1", file_name: "clean.pdf" }],
    );
    assert.ok(summary);
    assert.equal(summary!.findings.length, 0);
    assert.equal(summary!.summary.overallScore, 100);
  });

  it("aggregates impact from findings", () => {
    const findings: DesignCheckFinding[] = [
      {
        id: "1",
        documentId: "d",
        documentName: "a.pdf",
        category: "Egress",
        title: "a",
        description: "",
        severity: "critical",
        codeReference: "",
        codeYear: "",
        location: "",
        suggestedFix: "",
      },
      {
        id: "2",
        documentId: "d",
        documentName: "a.pdf",
        category: "Zoning",
        title: "b",
        description: "",
        severity: "advisory",
        codeReference: "",
        codeYear: "",
        location: "",
        suggestedFix: "",
      },
    ];
    const counts = summarizeFindings(findings);
    assert.equal(counts.totalIssues, 2);
    assert.equal(counts.overallScore, 83); // 100 - 15 - 2
    assert.deepEqual(aggregateImpact(findings), {
      "Life Safety": 1,
      Accessibility: 0,
      Administrative: 1,
      Other: 0,
    });
  });
});

describe("DesignCheck current-run filtering", () => {
  it("excludes stale/historical findings from the active summary", async () => {
    const { filterAnnotationsForActiveAnalysis } = await import("../codeAnalyzer/model.ts");
    const rows = [
      {
        id: "stale",
        document_id: "doc-1",
        analysis_run_id: "run-old",
        data: { compliance_issue: true, title: "old", severity: "critical", category: "Egress" },
      },
    ];
    const active = filterAnnotationsForActiveAnalysis(rows, {
      currentRunId: null,
      hasAnalyzerRuns: true,
    });
    assert.equal(buildDesignCheckSummary(active, [{ id: "doc-1", file_name: "a.pdf" }]), null);
  });

  it("keeps only the current run findings", async () => {
    const { filterAnnotationsForActiveAnalysis } = await import("../codeAnalyzer/model.ts");
    const rows = [
      {
        id: "stale",
        document_id: "doc-1",
        analysis_run_id: "run-old",
        data: { compliance_issue: true, title: "old", severity: "critical", category: "Egress" },
      },
      {
        id: "cur",
        document_id: "doc-2",
        analysis_run_id: "run-new",
        data: { compliance_issue: true, title: "new", severity: "warning", category: "Accessibility" },
      },
    ];
    const active = filterAnnotationsForActiveAnalysis(rows, {
      currentRunId: "run-new",
      hasAnalyzerRuns: true,
    });
    const summary = buildDesignCheckSummary(active, [{ id: "doc-2", file_name: "b.pdf" }]);
    assert.ok(summary);
    assert.equal(summary!.findings.length, 1);
    assert.equal(summary!.findings[0]?.title, "new");
  });
});
