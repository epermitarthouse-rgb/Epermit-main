"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  classifyDocument,
  classifySheetContent,
  shouldCreateAnalyzerSheets,
  shouldRasterizePage,
  shouldRunVisualDefectChecks,
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

  it("classifies dotted and hyphenated architectural sheet PDFs as drawing_set", () => {
    const planNames = [
      "A-1.03-00.pdf",
      "A-1.04.00.pdf",
      "A-1.05.00.pdf",
      "A-2.02.00.pdf",
      "A-3.02-00.pdf",
      "M-1.1.pdf",
      "S-001.00.pdf",
      "E-1.0-00.pdf",
      "FP100.pdf",
    ];
    const longTitleBlock = "GENERAL NOTES ".repeat(80);
    for (const fileName of planNames) {
      const result = classifyDocument({
        fileName,
        documentType: "specification",
        samplePageTexts: [longTitleBlock],
      });
      assert.equal(result.analyzerClass, "drawing_set", fileName);
      assert.equal(shouldCreateAnalyzerSheets(result.analyzerClass), true, fileName);
    }
  });

  it("classifies V2 plan PDFs as drawing_set despite document_type specification", () => {
    const planNames = [
      "A001-SITE PLAN.pdf",
      "A002-PLAZA PLAN.pdf",
      "A003-LOWER LVL PL (EXISTING).pdf",
      "A004-LOWER LVL RESTO PL (NEW).pdf",
      "A005-GARAGE B PLAN.pdf",
    ];
    for (const fileName of planNames) {
      const result = classifyDocument({
        fileName,
        documentType: "specification",
        samplePageTexts: [""],
      });
      assert.equal(result.analyzerClass, "drawing_set", fileName);
      assert.equal(shouldCreateAnalyzerSheets(result.analyzerClass), true, fileName);
    }
  });

  it("still classifies project manuals as specification with V2 document_type", () => {
    const result = classifyDocument({
      fileName: "Riverside Project Manual.pdf",
      documentType: "specification",
      samplePageTexts: [],
    });
    assert.equal(result.analyzerClass, "specification");
    assert.equal(shouldCreateAnalyzerSheets(result.analyzerClass), false);
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

  it("does not let a long title block or a spec file name turn a large-format page into a specification", () => {
    const longTitleBlock = "GENERAL NOTES AND TITLE BLOCK ".repeat(80);
    const result = classifyDocument({
      fileName: "Project Manual.pdf",
      documentType: "specification",
      samplePageTexts: [longTitleBlock],
      pageSizes: [{ widthInches: 36, heightInches: 24 }],
    });
    assert.equal(result.analyzerClass, "drawing_set");
    assert.equal(result.source, "page_size");
    assert.equal(shouldCreateAnalyzerSheets(result.analyzerClass), true);
    assert.equal(shouldRasterizePage(result.analyzerClass), true);
  });

  it("keeps a letter-size text page as a specification even when the file name is a sheet id", () => {
    const result = classifyDocument({
      fileName: "A-101 FLOOR PLAN.pdf",
      documentType: "permit_drawing",
      samplePageTexts: [
        `DIVISION 03 CONCRETE
SECTION 03 30 00 CAST-IN-PLACE CONCRETE
PART 1 GENERAL
1.1 SUMMARY
A. Section includes cast-in-place concrete for foundations and slabs.
B. Related requirements are specified in Division 01.`,
      ],
      pageSizes: [{ widthInches: 8.5, heightInches: 11 }],
    });
    assert.equal(result.analyzerClass, "specification");
    assert.equal(result.source, "page_size");
    assert.equal(shouldCreateAnalyzerSheets(result.analyzerClass), false);
    assert.equal(shouldRasterizePage(result.analyzerClass), false);
  });

  it("classifies schedule and form content without using the file name", () => {
    assert.equal(
      classifySheetContent({
        text: "A-6.00\nDOOR SCHEDULE\nHARDWARE SET 3 CLOSER",
      }),
      "schedule",
    );
    assert.equal(
      classifySheetContent({ text: "S-300.00\nSTATEMENT OF SPECIAL INSPECTIONS" }),
      "form",
    );
    assert.equal(
      classifySheetContent({ text: "EN-1.00\nENERGY CODE COMPLIANCE CERTIFICATE" }),
      "form",
    );
    assert.equal(
      classifySheetContent({ text: "FIRST FLOOR PLAN\nSCALE 1/8\" = 1'-0\"" }),
      "floor_plan",
    );
    assert.equal(shouldRunVisualDefectChecks("schedule"), false);
    assert.equal(shouldRunVisualDefectChecks("form"), false);
    assert.equal(shouldRunVisualDefectChecks("floor_plan"), true);
    assert.equal(shouldRunVisualDefectChecks("mep"), true);

    assert.equal(
      classifySheetContent({
        text: "Job 12345\nCOMcheck\nEnergy Compliance Certificate\nEnvelope passes.",
      }),
      "form",
    );
    assert.equal(
      classifySheetContent({
        text: "S-301\nSCHEDULE OF SPECIAL INSPECTIONS\nSteel frame",
      }),
      "form",
    );
    assert.equal(
      classifySheetContent({
        text: "A-8.10\nROOM FINISH SCHEDULE\nFLOOR BASE WALL CEILING",
      }),
      "schedule",
    );
    assert.equal(
      classifySheetContent({ text: "E-2.01\nELECTRICAL POWER PLAN\nPANEL LP1" }),
      "mep",
    );

    const largeScheduleNamedAsPlan = classifyDocument({
      fileName: "A-101 FLOOR PLAN.pdf",
      documentType: "permit_drawing",
      samplePageTexts: ["DOOR SCHEDULE\nHARDWARE SCHEDULE"],
      pageSizes: [{ widthInches: 36, heightInches: 24 }],
    });
    assert.equal(largeScheduleNamedAsPlan.analyzerClass, "drawing_set");
    assert.equal(largeScheduleNamedAsPlan.source, "page_size");
    assert.equal(shouldRasterizePage(largeScheduleNamedAsPlan.analyzerClass), true);
  });
});
