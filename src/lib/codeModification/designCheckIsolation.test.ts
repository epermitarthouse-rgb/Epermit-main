import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ANALYSIS_TYPE_DC_MODIFICATION,
  ANALYSIS_TYPE_STANDARD,
  filterAnnotationsForActiveAnalysis,
  isStandardComplianceRun,
  pickCurrentRun,
} from "../codeAnalyzer/model.ts";
import { buildDesignCheckSummary } from "../designcheck/designCheckSummary.ts";

describe("DesignCheck isolation from code modification reviews", () => {
  it("ignores a current modification run when choosing the DesignCheck current run", () => {
    const runs = [
      { id: "mod-current", status: "current", analysis_type: ANALYSIS_TYPE_DC_MODIFICATION },
      { id: "std-current", status: "current", analysis_type: ANALYSIS_TYPE_STANDARD },
    ];
    const standardRuns = runs.filter(isStandardComplianceRun);
    assert.deepEqual(standardRuns.map((r) => r.id), ["std-current"]);
    assert.equal(pickCurrentRun(runs)?.id, "std-current");
    assert.equal(pickCurrentRun(standardRuns)?.id, "std-current");
  });

  it("does not treat modification-only projects as having DesignCheck analyzer runs", () => {
    const runs = [
      { id: "mod-current", status: "current", analysis_type: ANALYSIS_TYPE_DC_MODIFICATION },
    ];
    const standardRuns = runs.filter(isStandardComplianceRun);
    assert.equal(standardRuns.length, 0);
    assert.equal(pickCurrentRun(runs), null);
    const hasAnalyzerRuns = standardRuns.length > 0;
    assert.equal(hasAnalyzerRuns, false);

    const active = filterAnnotationsForActiveAnalysis(
      [
        { id: "legacy", data: { compliance_issue: true, title: "Exit width", severity: "critical", category: "Egress" } },
        { id: "mod-ann", analysis_run_id: "mod-current", data: { compliance_issue: true, title: "mod leak", severity: "critical", category: "Egress" } },
      ],
      { currentRunId: pickCurrentRun(runs)?.id ?? null, hasAnalyzerRuns },
    );
    // No standard runs → legacy hydration, not the modification run annotations.
    assert.deepEqual(active.map((r) => r.id), ["legacy"]);
  });

  it("does not let a current modification run pull modification findings into DesignCheck KPIs", () => {
    const runs = [
      { id: "mod-current", status: "current", analysis_type: ANALYSIS_TYPE_DC_MODIFICATION },
      { id: "std-current", status: "current", analysis_type: ANALYSIS_TYPE_STANDARD },
    ];
    const currentRun = pickCurrentRun(runs.filter(isStandardComplianceRun));
    const rows = [
      {
        id: "std-finding",
        document_id: "doc-std",
        analysis_run_id: "std-current",
        data: {
          compliance_issue: true,
          title: "Standard corridor",
          severity: "warning",
          category: "Egress",
        },
      },
      {
        id: "mod-finding",
        document_id: "doc-mod",
        analysis_run_id: "mod-current",
        data: {
          compliance_issue: true,
          title: "Modification sprinkler claim",
          severity: "critical",
          category: "Fire Safety",
        },
      },
    ];
    const active = filterAnnotationsForActiveAnalysis(rows, {
      currentRunId: currentRun?.id ?? null,
      hasAnalyzerRuns: true,
    });
    const summary = buildDesignCheckSummary(active, [
      { id: "doc-std", file_name: "plans.pdf" },
      { id: "doc-mod", file_name: "mod-form.pdf" },
    ]);
    assert.ok(summary);
    assert.equal(summary!.findings.length, 1);
    assert.equal(summary!.findings[0]?.title, "Standard corridor");
    assert.equal(summary!.summary.critical, 0);
    assert.equal(summary!.summary.warnings, 1);
  });
});
