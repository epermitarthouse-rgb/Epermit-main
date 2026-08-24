"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  classifyPage,
  buildSegmentsFromPageClasses,
  getPageClass,
  isMixedSegments,
  shouldCreateSheetsForPage,
  shouldIndexSpecForPage,
} = require("../lib/segments");

describe("mixed PDF page-level routing", () => {
  const mixedPageClasses = {
    1: "code_modification_form",
    2: "code_modification_form",
    3: "drawing_set",
    4: "drawing_set",
    5: "specification",
    6: "specification",
    7: "supporting",
  };

  it("builds contiguous segments from per-page classes", () => {
    const segments = buildSegmentsFromPageClasses(mixedPageClasses);
    assert.deepEqual(segments, [
      { page_start: 1, page_end: 2, analyzer_class: "code_modification_form" },
      { page_start: 3, page_end: 4, analyzer_class: "drawing_set" },
      { page_start: 5, page_end: 6, analyzer_class: "specification" },
      { page_start: 7, page_end: 7, analyzer_class: "supporting" },
    ]);
    assert.equal(isMixedSegments(segments), true);
  });

  it("routes pages by segment class instead of document-level class", () => {
    const segments = buildSegmentsFromPageClasses(mixedPageClasses);
    const docLevelClass = "specification";

    assert.equal(getPageClass(3, segments, docLevelClass), "drawing_set");
    assert.equal(getPageClass(5, segments, docLevelClass), "specification");
    assert.equal(getPageClass(1, segments, docLevelClass), "code_modification_form");
    assert.equal(shouldCreateSheetsForPage(getPageClass(3, segments, docLevelClass)), true);
    assert.equal(shouldCreateSheetsForPage(getPageClass(5, segments, docLevelClass)), false);
    assert.equal(shouldIndexSpecForPage(getPageClass(5, segments, docLevelClass)), true);
    assert.equal(shouldIndexSpecForPage(getPageClass(1, segments, docLevelClass)), false);
  });

  it("classifies form, drawing, and spec pages in a synthetic mixed document", () => {
    const formPage = classifyPage({
      pageNumber: 1,
      text: "Applicant Request for Code Modification — For Official Use Only",
      fileName: "mixed-package.pdf",
      documentType: "other",
    });
    assert.equal(formPage.analyzerClass, "code_modification_form");

    const drawingPage = classifyPage({
      pageNumber: 3,
      text: "A-101\nFLOOR PLAN",
      fileName: "mixed-package.pdf",
      documentType: "other",
    });
    assert.equal(drawingPage.analyzerClass, "drawing_set");

    const specPage = classifyPage({
      pageNumber: 5,
      text: `DIVISION 03 CONCRETE
SECTION 03 30 00 CAST-IN-PLACE CONCRETE
PART 1 GENERAL
1.1 SUMMARY
A. Section includes cast-in-place concrete for foundations, slabs, and structural elements.
B. Related work specified in Division 01 and Division 02.`,
      fileName: "mixed-package.pdf",
      documentType: "other",
    });
    assert.equal(specPage.analyzerClass, "specification");
  });
});
