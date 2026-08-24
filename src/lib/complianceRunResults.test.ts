import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildComplianceResultGroups,
  computeActiveRunProgressMetrics,
  isPendingSessionUpload,
  shouldIsolateCurrentRunResults,
} from "./complianceRunResults.ts";

describe("buildComplianceResultGroups / shouldIsolateCurrentRunResults", () => {
  const runA = {
    id: "a",
    documentId: "doc-a",
    fileName: "A.pdf",
    ibcResult: { summary: { overallScore: 90 } },
    localResult: null,
    failed: false,
  };
  const runB = {
    id: "b",
    documentId: "doc-b",
    fileName: "B.pdf",
    ibcResult: { summary: { overallScore: 80 } },
    localResult: null,
    failed: false,
  };

  it("Run B start — Run A hydrated findings excluded from current view", () => {
    const groups = buildComplianceResultGroups({
      batchCompleted: [],
      batchFailed: [],
      hydrated: [runA],
      isolateCurrentRun: shouldIsolateCurrentRunResults({
        analyzing: true,
        activeBatchRunId: "run-b",
        viewingHistoricalRunId: null,
      }),
    });
    assert.equal(groups.length, 0);
  });

  it("Run B progressively populates own batch findings only", () => {
    const groups = buildComplianceResultGroups({
      batchCompleted: [runB],
      batchFailed: [],
      hydrated: [runA],
      isolateCurrentRun: shouldIsolateCurrentRunResults({
        analyzing: true,
        activeBatchRunId: "run-b",
        viewingHistoricalRunId: null,
      }),
    });
    assert.deepEqual(groups.map((g) => g.documentId), ["doc-b"]);
  });

  it("Run A still available when viewing historical run", () => {
    const groups = buildComplianceResultGroups({
      batchCompleted: [],
      batchFailed: [],
      hydrated: [runA],
      isolateCurrentRun: shouldIsolateCurrentRunResults({
        analyzing: false,
        activeBatchRunId: "run-b",
        viewingHistoricalRunId: "run-a",
      }),
    });
    assert.deepEqual(groups.map((g) => g.documentId), ["doc-a"]);
  });

  it("After complete — hydrated current run merges when not isolating", () => {
    const groups = buildComplianceResultGroups({
      batchCompleted: [runB],
      batchFailed: [],
      hydrated: [runA],
      isolateCurrentRun: shouldIsolateCurrentRunResults({
        analyzing: false,
        activeBatchRunId: null,
        viewingHistoricalRunId: null,
      }),
    });
    assert.equal(groups.length, 2);
  });
});

describe("computeActiveRunProgressMetrics", () => {
  it("reports pending for in-progress batch", () => {
    const m = computeActiveRunProgressMetrics({
      analyzing: true,
      total: 34,
      completed: 7,
      failed: 1,
    });
    assert.equal(m.completed, 6);
    assert.equal(m.failed, 1);
    assert.equal(m.pending, 27);
    assert.equal(m.inProgress, true);
  });
});

describe("isPendingSessionUpload", () => {
  it("excludes persisted sheets re-queued for analysis", () => {
    assert.equal(isPendingSessionUpload({ status: "pending", sheetId: "sheet-1" }), false);
    assert.equal(isPendingSessionUpload({ status: "pending" }), true);
  });
});
