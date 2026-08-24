"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  classifyDocument,
  shouldCreateAnalyzerSheets,
  shouldRasterizePage,
} = require("../lib/classify");

describe("classifyDocument", () => {
  it("classifies Riverside Project Manual as specification by filename", () => {
    const result = classifyDocument({
      fileName: "Riverside Project Manual.pdf",
      documentType: "specification",
      samplePageTexts: [],
    });
    assert.equal(result.analyzerClass, "specification");
    assert.equal(shouldCreateAnalyzerSheets(result.analyzerClass), false);
    assert.equal(shouldRasterizePage(result.analyzerClass), false);
  });

  it("classifies architectural drawings as drawing_set", () => {
    const result = classifyDocument({
      fileName: "Architectural Drawings.pdf",
      documentType: "permit_drawing",
      samplePageTexts: ["A-101 FLOOR PLAN", "A-102 ELEVATIONS"],
    });
    assert.equal(result.analyzerClass, "drawing_set");
    assert.equal(shouldCreateAnalyzerSheets(result.analyzerClass), true);
    assert.equal(shouldRasterizePage(result.analyzerClass), true);
  });

  it("uses CSI text heuristics for specification content", () => {
    const result = classifyDocument({
      fileName: "upload.pdf",
      documentType: "other",
      samplePageTexts: [
        `DIVISION 02 EXISTING CONDITIONS
SECTION 02 41 19 SELECTIVE DEMOLITION
PART 1 GENERAL
1.1 SUMMARY
A. Section includes selective demolition of existing concrete and masonry walls throughout the basement level.
B. Remove all existing waterproofing membranes and prepare surfaces for new application per Section 03 15 00.`,
      ],
    });
    assert.equal(result.analyzerClass, "specification");
  });

  it("classifies code modification forms", () => {
    const result = classifyDocument({
      fileName: "DC Code Mod Application.pdf",
      documentType: "code_modification_application",
      samplePageTexts: [],
    });
    assert.equal(result.analyzerClass, "code_modification_form");
    assert.equal(shouldCreateAnalyzerSheets(result.analyzerClass), false);
  });
});
