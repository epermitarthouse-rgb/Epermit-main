"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

/** Mirrors processSheetJob coverage grouping (both IBC + local per sheet). */
function computeCoverageFromJobs(jobs, eligibleCount) {
  const sheetIds = [...new Set(jobs.map((j) => j.sheet_id).filter(Boolean))];
  const jobsBySheet = new Map();
  for (const j of jobs) {
    if (!jobsBySheet.has(j.sheet_id)) jobsBySheet.set(j.sheet_id, []);
    jobsBySheet.get(j.sheet_id).push(j);
  }
  let sheetsFullyCompleted = 0;
  let sheetsPendingOrFailedCount = 0;
  for (const sheetId of sheetIds) {
    const sheetJobs = jobsBySheet.get(sheetId) || [];
    if (sheetJobs.every((j) => j.status === "completed")) sheetsFullyCompleted += 1;
    else sheetsPendingOrFailedCount += 1;
  }
  return {
    eligibleSheetCount: eligibleCount,
    sheetsAnalyzed: sheetsFullyCompleted,
    sheetsPendingOrFailed: sheetsPendingOrFailedCount,
    sheetJobsCompleted: jobs.filter((j) => j.status === "completed").length,
    sheetJobsTotal: jobs.length,
  };
}

describe("coverage accounting", () => {
  it("counts 13 sheets when 26 ibc+local jobs all completed", () => {
    const jobs = [];
    for (let i = 0; i < 13; i++) {
      jobs.push({ sheet_id: `s${i}`, status: "completed", analysis_mode: "ibc" });
      jobs.push({ sheet_id: `s${i}`, status: "completed", analysis_mode: "local" });
    }
    const c = computeCoverageFromJobs(jobs, 13);
    assert.equal(c.sheetsAnalyzed, 13);
    assert.equal(c.sheetsPendingOrFailed, 0);
    assert.equal(c.sheetJobsCompleted, 26);
  });

  it("does not mark sheet analyzed until both modes complete", () => {
    const jobs = [
      { sheet_id: "a", status: "completed", analysis_mode: "ibc" },
      { sheet_id: "a", status: "pending", analysis_mode: "local" },
      { sheet_id: "b", status: "completed", analysis_mode: "ibc" },
      { sheet_id: "b", status: "completed", analysis_mode: "local" },
    ];
    const c = computeCoverageFromJobs(jobs, 2);
    assert.equal(c.sheetsAnalyzed, 1);
    assert.equal(c.sheetsPendingOrFailed, 1);
  });
});
