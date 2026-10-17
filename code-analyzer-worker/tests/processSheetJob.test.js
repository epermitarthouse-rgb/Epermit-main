"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  extractResultForAnalysisMode,
  buildIssueAnnotationData,
  assembleSheetIndex,
  drawingTextForJurisdiction,
} = require("../lib/processSheetJob.js");
const { resolveAnalysisJurisdiction } = require("../../scraper-service/app/services/compliance/findingQuality.js");

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

describe("assembleSheetIndex", () => {
  it("builds a short index from two synthetic sheet descriptions", () => {
    const index = assembleSheetIndex(
      [
        { id: "floor", file_name: "A-1.01.pdf", sheet_label: "First Floor Plan", excluded: false },
        { id: "enlarged", file_name: "A-4.00.pdf", sheet_label: "Enlarged Toilet Plan", excluded: false },
        { id: "skip", file_name: "X.pdf", sheet_label: "Excluded", excluded: true },
      ],
      {
        floor: { excerpt: "FIRST FLOOR PLAN", contentClass: "floor_plan" },
        enlarged: { excerpt: "ENLARGED TOILET PLAN 54x60", contentClass: "enlarged_plan" },
      },
    );
    assert.equal(index.length, 2);
    assert.equal(index[0].fileName, "A-1.01.pdf");
    assert.equal(index[0].contentClass, "floor_plan");
    assert.equal(index[1].contentClass, "enlarged_plan");
    assert.match(index[1].excerpt, /54x60/);
    assert.match(index[1].title, /Enlarged Toilet/);
  });

  it("classifies the index entry from extracted text when the file name does not say what the sheet is", () => {
    const index = assembleSheetIndex(
      [{ id: "cert", file_name: "upload-set.pdf", sheet_label: null, excluded: false }],
      { cert: { excerpt: "COMcheck Energy Compliance Certificate" } },
    );
    assert.equal(index[0].contentClass, "form");
    assert.equal(index[0].fileName, "upload-set.pdf");
  });
});

describe("drawing text jurisdiction", () => {
  it("uses Washington, D.C. and DC Building Code from the sheet index when the project record is empty", () => {
    const text = drawingTextForJurisdiction("TITLE BLOCK", [
      { title: "Cover", excerpt: "Washington, D.C." },
      { title: "Code notes", excerpt: "2017 DC Building Code" },
    ]);
    assert.match(text, /Washington, D\.C\./);
    assert.match(text, /DC Building Code/);
    assert.equal(
      resolveAnalysisJurisdiction({
        runJurisdiction: null,
        projectJurisdiction: null,
        projectCity: null,
        projectState: null,
        drawingText: text,
      }),
      "dc",
    );
  });
});
