"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { extractResultForAnalysisMode, buildIssueAnnotationData } = require("../lib/processSheetJob.js");

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

describe("buildIssueAnnotationData", () => {
  it("copies the sheet file name onto every issue annotation", () => {
    const data = buildIssueAnnotationData({
      issue: {
        title: "Corridor width",
        description: "Shown as 36 inches.",
        evidenceTier: "drawing",
      },
      codeType: "ibc",
      sheetId: "sheet-1",
      pageNumber: 4,
      sourceDocumentId: "doc-1",
      sheetFileName: "A-2.01.pdf",
    });
    assert.equal(data.compliance_issue, true);
    assert.equal(data.sheet_file_name, "A-2.01.pdf");
    assert.equal(data.file_name, "A-2.01.pdf");
    assert.equal(data.sheet_id, "sheet-1");
    assert.notEqual(data.sheet_file_name, "(no name)");
  });
});
