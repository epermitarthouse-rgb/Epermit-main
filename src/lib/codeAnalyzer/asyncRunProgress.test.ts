import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { metricsFromAsyncSheetJobs, pickActiveSheetJobSheetId } from "./asyncRunProgress.ts";

describe("asyncRunProgress", () => {
  it("picks an active processing sheet id", () => {
    assert.equal(
      pickActiveSheetJobSheetId([
        { id: "j1", run_id: "r1", sheet_id: "s1", analysis_mode: "ibc", status: "completed", last_error: null },
        { id: "j2", run_id: "r1", sheet_id: "s2", analysis_mode: "ibc", status: "processing", last_error: null },
      ]),
      "s2",
    );
  });

  it("counts completed and failed sheet jobs by sheet_id", () => {
    const m = metricsFromAsyncSheetJobs([
      { id: "j1", run_id: "r1", sheet_id: "s1", analysis_mode: "ibc", status: "completed", last_error: null },
      { id: "j2", run_id: "r1", sheet_id: "s2", analysis_mode: "ibc", status: "pending", last_error: null },
      { id: "j3", run_id: "r1", sheet_id: "s3", analysis_mode: "ibc", status: "failed", last_error: "x" },
    ]);
    assert.equal(m.completed, 1);
    assert.equal(m.failed, 1);
    assert.equal(m.total, 3);
    assert.deepEqual([...m.completedSheetIds], ["s1"]);
    assert.deepEqual([...m.failedSheetIds], ["s3"]);
  });
});
