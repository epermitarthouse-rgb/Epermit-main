"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  classifyPage,
  buildSegmentsFromPageClasses,
  getPageClass,
  isMixedSegments,
  resolveAutoAnalyzerClass,
  shouldCreateSheetsForPage,
  shouldIndexSpecForPage,
  shouldRasterizeForPage,
} = require("../lib/segments");
const { shouldRunVisualDefectChecks } = require("../lib/classify");

const LETTER = { widthInches: 8.5, heightInches: 11 };
const ARCH_D = { widthInches: 36, heightInches: 24 };
const TABLOID = { widthInches: 11, heightInches: 17 };
const LONG_TITLE_BLOCK = `${"GENERAL NOTES AND TITLE BLOCK ".repeat(80)}\nSCALE 1/8" = 1'-0"\nDRAWN BY`;
const CSI_PAGE = `DIVISION 03 CONCRETE
SECTION 03 30 00 CAST-IN-PLACE CONCRETE
PART 1 GENERAL
1.1 SUMMARY
A. Section includes cast-in-place concrete for foundations, slabs, and structural elements.
B. Related work is specified in Division 01 and Division 02 of the project manual.`;

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

  it("classifies architectural SECTION DETAILS sheets as drawing_set, not specification", () => {
    const noisySectionDetailText = `
      SECTION DETAILS
      SECTION DETAIL AT STOREFRONT
      SECTION DETAIL AT PARAPET
      SCALE: 1 1/2" = 1'-0"
      PROJECT NO. 100-41ST
      SHEET OF
      DRAWN BY
    `.trim();

    for (const fileName of [
      "ASK04 - SECTION DETAILS.pdf",
      "A201 - SECTION DETAILS.pdf",
      "Wall Section Details.pdf",
    ]) {
      const page = classifyPage({
        pageNumber: 1,
        text: noisySectionDetailText,
        fileName,
        documentType: "specification",
      });
      assert.equal(page.analyzerClass, "drawing_set", fileName);
      assert.equal(shouldCreateSheetsForPage(page.analyzerClass), true, fileName);
    }
  });

  it("classifies one-page architectural sheet PDFs as drawings when title-block text is long", () => {
    const longNotes = `${"GENERAL NOTES AND DIMENSIONS ".repeat(40)}\nA-1.03`;
    for (const fileName of ["A-1.03-00.pdf", "A-1.04.00.pdf", "A-3.02-00.pdf"]) {
      const page = classifyPage({
        pageNumber: 1,
        text: longNotes,
        fileName,
        documentType: "specification",
      });
      assert.equal(page.analyzerClass, "drawing_set", fileName);
      assert.equal(shouldCreateSheetsForPage(page.analyzerClass), true, fileName);
    }
  });

  it("still classifies CSI SECTION headings as specification", () => {
    const csi03030 = classifyPage({
      pageNumber: 1,
      text: `DIVISION 03 CONCRETE
SECTION 03 30 00 CAST-IN-PLACE CONCRETE
PART 1 GENERAL
1.1 SUMMARY
A. Work includes cast-in-place concrete for foundations, slabs, and structural elements as shown on the drawings.
B. Related work is specified in Division 01 and Division 02 of the project manual.`,
      fileName: "upload.pdf",
      documentType: "other",
    });
    assert.equal(csi03030.analyzerClass, "specification");
    assert.equal(shouldCreateSheetsForPage(csi03030.analyzerClass), false);

    const csi01010 = classifyPage({
      pageNumber: 1,
      text: `DIVISION 1 - GENERAL REQUIREMENTS
SECTION 01010 Summary of Work
PART 1 GENERAL
1.1 The work includes selective demolition and facade restoration per the contract documents and applicable codes.`,
      fileName: "Project Manual.pdf",
      documentType: "specification",
    });
    assert.equal(csi01010.analyzerClass, "specification");
    assert.equal(shouldCreateSheetsForPage(csi01010.analyzerClass), false);
  });

  it("classifies a large-format page with long text as a drawing sheet", () => {
    const page = classifyPage({
      pageNumber: 1,
      text: LONG_TITLE_BLOCK,
      fileName: "Project Manual.pdf",
      documentType: "specification",
      ...ARCH_D,
    });
    assert.equal(page.analyzerClass, "drawing_set");
    assert.equal(page.source, "page_size");
    assert.equal(shouldCreateSheetsForPage(page.analyzerClass), true);
    assert.equal(shouldRasterizeForPage(page.analyzerClass), true);
    assert.equal(shouldIndexSpecForPage(page.analyzerClass), false);

    const segments = buildSegmentsFromPageClasses({ 1: page.analyzerClass });
    assert.equal(
      resolveAutoAnalyzerClass({
        segments,
        fileName: "Project Manual.pdf",
        documentType: "specification",
        samplePageTexts: [LONG_TITLE_BLOCK],
        pageSizes: [ARCH_D],
      }),
      "drawing_set",
    );
  });

  it("keeps a letter-size text page as a specification and does not rasterize it", () => {
    const page = classifyPage({
      pageNumber: 1,
      text: CSI_PAGE,
      fileName: "notes.pdf",
      documentType: "other",
      ...LETTER,
    });
    assert.equal(page.analyzerClass, "specification");
    assert.equal(shouldCreateSheetsForPage(page.analyzerClass), false);
    assert.equal(shouldRasterizeForPage(page.analyzerClass), false);
    assert.equal(shouldIndexSpecForPage(page.analyzerClass), true);
  });

  it("does not let the file name flip a large page to spec or a letter-size spec into the drawing set", () => {
    const largeNamedAsSpec = classifyPage({
      pageNumber: 1,
      text: LONG_TITLE_BLOCK,
      fileName: "Division 01 Technical Specifications.pdf",
      documentType: "specification",
      ...ARCH_D,
    });
    assert.equal(largeNamedAsSpec.analyzerClass, "drawing_set");
    assert.equal(shouldCreateSheetsForPage(largeNamedAsSpec.analyzerClass), true);

    const letterNamedAsDrawing = classifyPage({
      pageNumber: 1,
      text: CSI_PAGE,
      fileName: "A-1.03-00.pdf",
      documentType: "permit_drawing",
      ...LETTER,
    });
    assert.equal(letterNamedAsDrawing.analyzerClass, "specification");
    assert.equal(shouldCreateSheetsForPage(letterNamedAsDrawing.analyzerClass), false);
    assert.equal(shouldIndexSpecForPage(letterNamedAsDrawing.analyzerClass), true);
  });

  it("treats tabloid pages as drawings when graphic and as specs when text-dense", () => {
    const graphic = classifyPage({
      pageNumber: 1,
      text: "A-101 FLOOR PLAN\nSCALE 1/4\" = 1'-0\"\nDRAWN BY",
      fileName: "Project Manual.pdf",
      documentType: "specification",
      ...TABLOID,
    });
    assert.equal(graphic.analyzerClass, "drawing_set");
    assert.equal(shouldRasterizeForPage(graphic.analyzerClass), true);

    const dense = classifyPage({
      pageNumber: 1,
      text: `${CSI_PAGE}\n${"The contractor shall provide materials and workmanship meeting the referenced standard. ".repeat(40)}`,
      fileName: "A-101 FLOOR PLAN.pdf",
      documentType: "permit_drawing",
      ...TABLOID,
    });
    assert.equal(dense.analyzerClass, "specification");
    assert.equal(shouldCreateSheetsForPage(dense.analyzerClass), false);
    assert.equal(shouldIndexSpecForPage(dense.analyzerClass), true);
  });

  it("keeps large-format schedules and forms as rasterized drawing sheets but skips visual defect checks", () => {
    const schedule = classifyPage({
      pageNumber: 1,
      text: "A-6.00\nDOOR SCHEDULE\nHARDWARE SCHEDULE\nMARK TYPE HARDWARE SET WIDTH",
      fileName: "upload.pdf",
      documentType: "specification",
      ...ARCH_D,
    });
    assert.equal(schedule.analyzerClass, "drawing_set");
    assert.equal(schedule.source, "page_size");
    assert.equal(schedule.contentClass, "schedule");
    assert.equal(shouldRasterizeForPage(schedule.analyzerClass), true);
    assert.equal(shouldCreateSheetsForPage(schedule.analyzerClass), true);
    assert.equal(shouldRunVisualDefectChecks(schedule.contentClass), false);

    const inspections = classifyPage({
      pageNumber: 2,
      text: "S-300.00\nSTATEMENT OF SPECIAL INSPECTIONS",
      fileName: "A-101 FLOOR PLAN.pdf",
      documentType: "permit_drawing",
      ...ARCH_D,
    });
    assert.equal(inspections.analyzerClass, "drawing_set");
    assert.equal(inspections.contentClass, "form");
    assert.equal(shouldRasterizeForPage(inspections.analyzerClass), true);

    const energy = classifyPage({
      pageNumber: 3,
      text: "EN-1.00\nENERGY CODE COMPLIANCE CERTIFICATE",
      fileName: "floor-plan.pdf",
      documentType: "permit_drawing",
      ...ARCH_D,
    });
    assert.equal(energy.contentClass, "form");
    assert.equal(energy.analyzerClass, "drawing_set");
    assert.equal(shouldRunVisualDefectChecks(energy.contentClass), false);
  });

  it("classifies plan content from the page text and ignores the file name", () => {
    const floorFromScheduleName = classifyPage({
      pageNumber: 1,
      text: "A-2.01\nFIRST FLOOR PLAN\nSCALE 1/8\" = 1'-0\"",
      fileName: "DOOR SCHEDULE.pdf",
      documentType: "specification",
      ...ARCH_D,
    });
    assert.equal(floorFromScheduleName.contentClass, "floor_plan");
    assert.equal(floorFromScheduleName.analyzerClass, "drawing_set");
    assert.equal(shouldRunVisualDefectChecks(floorFromScheduleName.contentClass), true);

    const scheduleFromPlanName = classifyPage({
      pageNumber: 1,
      text: "A-6.00 DOOR AND HARDWARE SCHEDULE\nHARDWARE SET 3 CLOSER",
      fileName: "A-101 FLOOR PLAN.pdf",
      documentType: "permit_drawing",
      ...ARCH_D,
    });
    assert.equal(scheduleFromPlanName.contentClass, "schedule");
    assert.equal(shouldRunVisualDefectChecks(scheduleFromPlanName.contentClass), false);

    const egress = classifyPage({
      pageNumber: 1,
      text: "LIFE SAFETY EGRESS PLAN\nEXIT ACCESS",
      fileName: "notes.pdf",
      documentType: "other",
      ...ARCH_D,
    });
    assert.equal(egress.contentClass, "egress_plan");

    const enlarged = classifyPage({
      pageNumber: 1,
      text: "ENLARGED TOILET PLAN\nSCALE 1/4\" = 1'-0\"",
      fileName: "sheet.pdf",
      documentType: "other",
      ...ARCH_D,
    });
    assert.equal(enlarged.contentClass, "enlarged_plan");

    const elevation = classifyPage({
      pageNumber: 1,
      text: "EXTERIOR ELEVATIONS\nNORTH ELEVATION",
      fileName: "sheet.pdf",
      documentType: "other",
      ...ARCH_D,
    });
    assert.equal(elevation.contentClass, "elevation");

    const section = classifyPage({
      pageNumber: 1,
      text: "BUILDING SECTION\nWALL SECTION AT STOREFRONT",
      fileName: "sheet.pdf",
      documentType: "other",
      ...ARCH_D,
    });
    assert.equal(section.contentClass, "section");
    assert.equal(section.analyzerClass, "drawing_set");
  });
});
