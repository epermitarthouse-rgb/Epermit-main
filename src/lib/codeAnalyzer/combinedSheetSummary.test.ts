import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  combineSheetSummaries,
  exportScoreText,
  fileSectionScoreLabel,
  sheetResultPresentation,
  type CombinedModeResult,
} from "./combinedSheetSummary.ts";

function finding(
  id: string,
  severity: "critical" | "warning" | "advisory",
  codeType: "ibc" | "local",
): NonNullable<CombinedModeResult["issues"]>[number] {
  return { id, severity, codeType, codeYear: "2021", codeSourceStatus: "authoritative" };
}

/** Fixture only: one IBC finding and two Local findings on the same sheet. */
function dualScopeSheet(): { ibcResult: CombinedModeResult; localResult: CombinedModeResult } {
  return {
    ibcResult: {
      codeType: "ibc",
      issues: [finding("ibc-1", "critical", "ibc")],
      summary: {
        totalIssues: 1,
        critical: 1,
        warnings: 0,
        advisory: 0,
        overallScore: 85,
        reviewState: "reviewed_findings",
      },
    },
    localResult: {
      codeType: "local",
      issues: [finding("local-1", "warning", "local"), finding("local-2", "advisory", "local")],
      summary: {
        totalIssues: 2,
        critical: 0,
        warnings: 1,
        advisory: 1,
        overallScore: 90,
        reviewState: "reviewed_findings",
      },
    },
  };
}

describe("combined sheet summary", () => {
  it("counts 1 IBC finding and 2 Local findings as 3", () => {
    const sheet = dualScopeSheet();
    const summary = combineSheetSummaries(sheet.ibcResult, sheet.localResult);
    assert.equal(summary.totalIssues, 3);
    assert.equal(summary.critical, 1);
    assert.equal(summary.warnings, 1);
    assert.equal(summary.advisory, 1);
    assert.equal(sheet.ibcResult.issues?.length, 1);
    assert.equal(sheet.localResult.issues?.length, 2);
  });

  it("keeps the combined summary and resolution when the code tab changes", () => {
    const sheet = dualScopeSheet();
    const responses = { "sheet-1:ibc-1": { status: "accepted" } };
    const ibc = sheetResultPresentation(sheet, "ibc", responses, "sheet-1");
    const local = sheetResultPresentation(sheet, "local", responses, "sheet-1");

    assert.deepEqual(ibc.summary, local.summary);
    assert.equal(ibc.summary.totalIssues, 3);
    assert.deepEqual(ibc.resolution, local.resolution);
    assert.equal(ibc.resolution.resolved, 1);
    assert.equal(ibc.resolution.total, 3);
    assert.equal(ibc.findings.length, 1);
    assert.equal(local.findings.length, 2);
    assert.equal(ibc.ibcCount, 1);
    assert.equal(local.localCount, 2);
  });

  it("does not collapse duplicate issue ids across IBC and Local", () => {
    const shared = finding("same-id", "warning", "ibc");
    const summary = combineSheetSummaries(
      {
        issues: [shared],
        summary: {
          totalIssues: 1,
          critical: 0,
          warnings: 1,
          advisory: 0,
          overallScore: 95,
          reviewState: "reviewed_findings",
        },
      },
      {
        issues: [{ ...shared, id: "same-id", codeType: "local", severity: "advisory" }],
        summary: {
          totalIssues: 1,
          critical: 0,
          warnings: 0,
          advisory: 1,
          overallScore: 98,
          reviewState: "reviewed_findings",
        },
      },
    );
    const presentation = sheetResultPresentation(
      {
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
        },
        localResult: {
          issues: [{ ...shared, codeType: "local", severity: "advisory" }],
          summary: {
            totalIssues: 1,
            critical: 0,
            warnings: 0,
            advisory: 1,
            overallScore: 98,
            reviewState: "reviewed_findings",
          },
        },
      },
      "ibc",
      {},
      "sheet",
    );
    assert.equal(summary.totalIssues, 2);
    assert.equal(presentation.combinedIssues.filter((issue) => issue.id === "same-id").length, 2);
  });

  it("leaves a clear sheet with no verified code unscored", () => {
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
    };
    const summary = combineSheetSummaries(clear, clear);
    assert.equal(summary.reviewState, "reviewed_clear");
    assert.equal(summary.overallScore, null);
    assert.equal(exportScoreText(summary), "Clear");
    assert.equal(fileSectionScoreLabel(summary), "Clear · 0 issues");
    assert.notEqual(exportScoreText(summary), "0%");
  });

  it("keeps reviewed_partial and reviewed_findings nullable", () => {
    const partial = combineSheetSummaries(
      {
        issues: [],
        summary: {
          totalIssues: 0,
          critical: 0,
          warnings: 0,
          advisory: 0,
          overallScore: null,
          reviewState: "reviewed_partial",
        },
      },
      null,
    );
    assert.equal(partial.reviewState, "reviewed_partial");
    assert.equal(partial.overallScore, null);
    assert.equal(exportScoreText(partial), "Partial");

    const findings = combineSheetSummaries(
      {
        issues: [finding("q", "advisory", "ibc")],
        summary: {
          totalIssues: 1,
          critical: 0,
          warnings: 0,
          advisory: 1,
          overallScore: null,
          reviewState: "reviewed_findings",
        },
      },
      null,
    );
    assert.equal(findings.totalIssues, 1);
    assert.equal(findings.reviewState, "reviewed_findings");
    assert.equal(findings.overallScore, null);
    assert.equal(exportScoreText(findings), "Findings");
    assert.notEqual(exportScoreText(findings), "0%");
  });
});

describe("production logic stays generic", () => {
  it("does not hardcode a sample sheet name or project name", () => {
    const files = [
      new URL("./combinedSheetSummary.ts", import.meta.url),
      new URL("../complianceAnalysisExport.ts", import.meta.url),
      new URL("../../components/compliance/AIComplianceAnalyzer.tsx", import.meta.url),
      new URL("../complianceReportPDF.ts", import.meta.url),
    ];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      assert.equal(source.includes("P-3.0"), false, String(file));
      assert.equal(/mcdonald/i.test(source), false, String(file));
    }
  });
});
