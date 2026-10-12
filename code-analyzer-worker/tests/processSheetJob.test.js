"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { extractResultForAnalysisMode } = require("../lib/processSheetJob.js");

describe("extractResultForAnalysisMode", () => {
  const both = {
    ibc: { issues: [{ id: "i1" }], summary: { totalIssues: 1 }, jurisdictionNotes: "ibc note" },
    local: { issues: [{ id: "l1" }], summary: { totalIssues: 1 }, jurisdictionNotes: "local note" },
    jurisdictionDiagnostics: { mismatch: true },
  };

  it("returns ibc bundle for ibc jobs", () => {
    const r = extractResultForAnalysisMode(both, "ibc");
    assert.deepEqual(r.issues, [{ id: "i1" }]);
    assert.equal(r.jurisdictionDiagnostics.mismatch, true);
  });

  it("returns local bundle for local jobs", () => {
    const r = extractResultForAnalysisMode(both, "local");
    assert.deepEqual(r.issues, [{ id: "l1" }]);
  });

  it("passes through flat result", () => {
    const flat = { issues: [{ id: "x" }], summary: {} };
    assert.deepEqual(extractResultForAnalysisMode(flat, "ibc").issues, [{ id: "x" }]);
  });
});
