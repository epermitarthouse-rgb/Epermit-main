import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ANALYZER_CAPACITY_WARNING_THRESHOLD,
  formatCapacityLine,
  formatCompactDatasetLine,
  resolveAnalyzerRuntimeStatus,
} from "./analyzerRuntimeStatus.ts";
import type { AnalyzerDatasetMetrics } from "./sheetState.ts";

function metrics(
  partial: Partial<AnalyzerDatasetMetrics> & Pick<AnalyzerDatasetMetrics, "includedSheetCount">,
): AnalyzerDatasetMetrics {
  return {
    sourceDocumentCount: partial.sourceDocumentCount ?? 1,
    includedSheetCount: partial.includedSheetCount,
    analyzedCompletedCount: partial.analyzedCompletedCount ?? 0,
    analyzedFailedCount: partial.analyzedFailedCount ?? 0,
    analysisTotalCount: partial.analysisTotalCount ?? partial.includedSheetCount,
  };
}

describe("analyzerRuntimeStatus", () => {
  it("A: compact dataset line", () => {
    assert.equal(
      formatCompactDatasetLine(metrics({ sourceDocumentCount: 3, includedSheetCount: 7 })),
      "Documents 3 · Sheets 7",
    );
  });

  it("B: capacity line hidden below threshold, shown at 35+", () => {
    assert.equal(formatCapacityLine(7, 0), null);
    assert.equal(
      formatCapacityLine(ANALYZER_CAPACITY_WARNING_THRESHOLD, 0),
      "35 of 40 sheet capacity used",
    );
    assert.equal(
      formatCapacityLine(36, 2),
      "36 of 40 sheet capacity used · 2 excluded",
    );
    assert.equal(formatCapacityLine(10, 3), "3 excluded — over the 40-sheet analysis cap");
  });

  it("C: idle Code Mod — Ready for review", () => {
    const lines = resolveAnalyzerRuntimeStatus({
      mode: "code_modification",
      metrics: metrics({ sourceDocumentCount: 3, includedSheetCount: 7 }),
      analyzing: false,
      stale: false,
    });
    assert.equal(lines.datasetLine, "Documents 3 · Sheets 7");
    assert.equal(lines.statusLine, "Ready for review");
    assert.equal(lines.capacityLine, null);
  });

  it("D: Code Mod active — Reviewing evidence", () => {
    const lines = resolveAnalyzerRuntimeStatus({
      mode: "code_modification",
      metrics: metrics({ includedSheetCount: 7 }),
      analyzing: true,
      stale: false,
    });
    assert.equal(lines.statusLine, "Reviewing evidence…");
  });

  it("E: Code Mod active with progress", () => {
    const lines = resolveAnalyzerRuntimeStatus({
      mode: "code_modification",
      metrics: metrics({ includedSheetCount: 7 }),
      analyzing: true,
      stale: false,
      batchProgress: { completed: 4, total: 7 },
    });
    assert.equal(lines.statusLine, "Reviewing 4 of 7 sheets…");
  });

  it("F: Code Mod complete — not 0 completed standard metrics", () => {
    const lines = resolveAnalyzerRuntimeStatus({
      mode: "code_modification",
      metrics: metrics({
        includedSheetCount: 7,
        analyzedCompletedCount: 0,
        analysisTotalCount: 7,
      }),
      analyzing: false,
      stale: false,
      hasModificationReview: true,
      reviewedSheetCount: 7,
    });
    assert.equal(lines.statusLine, "Review complete · 7 sheets reviewed");
  });

  it("G: standard active — Analyzing N of M", () => {
    const lines = resolveAnalyzerRuntimeStatus({
      mode: "standard",
      metrics: metrics({ includedSheetCount: 7 }),
      analyzing: true,
      stale: false,
      batchProgress: { completed: 4, total: 7 },
    });
    assert.equal(lines.statusLine, "Analyzing 4 of 7 sheets…");
  });

  it("H: standard partial and stale", () => {
    const partial = resolveAnalyzerRuntimeStatus({
      mode: "standard",
      metrics: metrics({
        includedSheetCount: 7,
        analyzedCompletedCount: 5,
        analyzedFailedCount: 2,
        analysisTotalCount: 7,
      }),
      analyzing: false,
      stale: false,
      displayRunStatus: "current",
    });
    assert.equal(partial.statusLine, "5 reviewed · 2 failed");

    const stale = resolveAnalyzerRuntimeStatus({
      mode: "code_modification",
      metrics: metrics({ includedSheetCount: 7 }),
      analyzing: false,
      stale: true,
    });
    assert.equal(stale.statusLine, "Review needs update");
  });
});
