"use strict";

const { describe, it, mock } = require("node:test");
const assert = require("node:assert/strict");
const { PDFDocument, StandardFonts } = require("pdf-lib");
const {
  classifyPageRole,
  applicantPagesFrom,
  heuristicExtractModificationRequest,
  mergeExtractedRequests,
  pagesAreSparse,
  validateAndGroundFindings,
  stripApprovalClaims,
  computeOverallStatus,
  buildFormExtractPrompt,
  buildSheetReviewPrompt,
  formatStaffGuidanceBlock,
  analyzeCodeModification,
  extractPdfPageTexts,
  isDcJurisdiction,
  PROMPT_CONSTRAINTS,
  HEURISTIC_FIELD_WARNINGS,
  reconcileExtractionWarnings,
  splitMeasureDescription,
  normalizeProposedMeasures,
  filterDrawingEvidenceSheetsForReview,
  emptyExtractedRequest,
} = require("../app/services/compliance/code-modification.service.js");

const SAMPLE_PAGES = [
  {
    pageNumber: 1,
    text: `APPLICATION FOR MODIFICATION OF CONSTRUCTION CODE REQUIREMENTS
Project / Address: 123 Historic Row NW, Washington, DC 20001
APPLICANT REQUEST:
The applicant requests a modification of IBC 1021.2 (2021) / 12A DCMR 1021.2
regarding egress / number of exits.
The existing historic stair makes strict compliance impractical.
The applicant states that the proposed modification complies with the intent and purpose of the Construction Codes.
Reason strict application is impractical: The existing historic stair cannot be altered.`,
  },
  {
    pageNumber: 2,
    text: `PROPOSED ALTERNATIVE / COMPENSATING MEASURES:
1. Automatic sprinkler system designed and installed in accordance with NFPA 13
2. 2-hour fire-rated stair enclosure
3. Fire alarm system throughout the building
4. Occupant load signage at assembly spaces
5. Egress lighting and exit signage
Flood Hazard Applicable: No`,
  },
  {
    pageNumber: 3,
    text: `FOR OFFICIAL USE ONLY
DOB Reviewer Name: ________________
DOB Reviewer Decision: ________________
DOEE Reviewer: ________________
Conditions of Approval: ________________`,
  },
];

async function buildSamplePdfBase64() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const page of SAMPLE_PAGES) {
    const pdfPage = doc.addPage([612, 792]);
    let y = 740;
    for (const line of page.text.split("\n")) {
      pdfPage.drawText(line, { x: 48, y, size: 10, font, maxWidth: 516 });
      y -= 14;
    }
  }
  return Buffer.from(await doc.save()).toString("base64");
}

describe("code-modification.service extract", () => {
  it("classifies reviewer page separately and extracts the sample request", () => {
    assert.equal(classifyPageRole(SAMPLE_PAGES[0]), "applicant");
    assert.equal(classifyPageRole(SAMPLE_PAGES[2]), "reviewer");
    assert.equal(applicantPagesFrom(SAMPLE_PAGES).length, 2);
    const extracted = heuristicExtractModificationRequest(SAMPLE_PAGES);
    assert.match(extracted.requestedModification, /IBC 1021\.2/);
    assert.equal(extracted.citedSections.some((s) => s.citation.includes("12A DCMR 1021.2")), true);
    assert.equal(extracted.proposedMeasures.length >= 5, true);
    assert.equal(extracted.floodHazardApplicable, false);
    assert.equal(JSON.stringify(extracted).includes("DOB Reviewer Name"), false);
    assert.equal(pagesAreSparse(SAMPLE_PAGES), false);
  });

  it("extracts numbered measures from pdf.js-flattened single-line page text", () => {
    const pages = [
      SAMPLE_PAGES[0],
      {
        pageNumber: 2,
        text:
          "PROPOSED ALTERNATIVE / COMPENSATING MEASURES: 1. Automatic sprinkler system designed and installed in accordance with NFPA 13 2. 2-hour fire-rated stair enclosure 3. Fire alarm system throughout the building 4. Occupant load signage at assembly spaces 5. Egress lighting and exit signage Flood Hazard Applicable: No",
      },
      SAMPLE_PAGES[2],
    ];
    const extracted = heuristicExtractModificationRequest(pages);
    assert.equal(extracted.proposedMeasures.length, 5);
    assert.equal(
      extracted.extractionWarnings.some((w) => /No proposed alternative measures/i.test(w)),
      false,
    );
  });
});

describe("code-modification.service grounding", () => {
  const allowed = [{ sheetId: "s1", pageNumber: 1, fileName: "A-101.png", sheetLabel: "A-101" }];

  it("rejects unsupported sheet refs and ungrounded conflicts", () => {
    const grounded = validateAndGroundFindings(
      [
        { id: "1", measure: "sprinkler", status: "verified", source: { sheetId: "unknown", pageNumber: 9 } },
        { id: "2", measure: "alarm", status: "conflicting", source: null },
        { id: "3", measure: "stair", status: "verified", source: { sheetId: "s1", pageNumber: 1 } },
      ],
      allowed,
    );
    assert.equal(grounded[0].status, "not_found");
    assert.equal(grounded[1].status, "requires_professional_dob_review");
    assert.equal(grounded[2].status, "verified");
    assert.equal(computeOverallStatus(grounded), "manual_review_required");
  });

  it("strips approval claims", () => {
    assert.equal(/DOB approved/i.test(stripApprovalClaims("DOB approved the request")), false);
  });
});

describe("code-modification.service prompts", () => {
  it("requires submitted evidence only, citations, and schema JSON", () => {
    const form = buildFormExtractPrompt("page text");
    const sheet = buildSheetReviewPrompt({ requestedModification: "IBC 1021.2" }, { pageNumber: 1, fileName: "A-101" });
    for (const prompt of [form.systemPrompt, sheet.systemPrompt, PROMPT_CONSTRAINTS]) {
      assert.match(prompt, /ONLY submitted evidence/i);
      assert.match(prompt, /Do not invent/i);
      assert.match(prompt, /Do not claim official DOB approval/i);
      assert.match(prompt, /sheet\/page/i);
      assert.match(prompt, /missing/i);
      assert.match(prompt, /cited code/i);
      assert.match(prompt, /JSON/i);
    }
  });

  it("injects staff guidance as non-evidence focus in sheet and form prompts", () => {
    const guidance = "Check sprinkler coverage only.";
    const form = buildFormExtractPrompt("page text", guidance);
    const sheet = buildSheetReviewPrompt(
      { requestedModification: "IBC 1021.2" },
      { pageNumber: 1, fileName: "A-101" },
      guidance,
    );
    for (const prompt of [form.systemPrompt, sheet.systemPrompt]) {
      assert.match(prompt, /STAFF GUIDANCE \/ REVIEW FOCUS \(NOT EVIDENCE\)/i);
      assert.match(prompt, /Check sprinkler coverage only/);
      assert.match(prompt, /NOT submitted evidence/i);
    }
    assert.equal(formatStaffGuidanceBlock(""), "");
  });
});

describe("analyzeCodeModification", () => {
  it("reviews from heuristic extract without OpenAI and grounds missing evidence", async () => {
    const outcome = await analyzeCodeModification({
      openai: null,
      formPages: SAMPLE_PAGES,
      sheets: [{ id: "s1", fileName: "A-101.png", pageNumber: 1 }],
      formDocument: { id: "form-1" },
    });
    assert.equal(outcome.ok, true);
    assert.match(outcome.result.extracted_request.requestedModification, /IBC 1021\.2/);
    assert.equal(outcome.result.evidence.length >= 5, true);
    assert.equal(outcome.result.evidence.every((f) => f.status === "not_found"), true);
    assert.equal(outcome.result.overall_status, "material_evidence_missing");
  });

  it("continues when one sheet vision review fails", async () => {
    const openai = {
      chat: {
        completions: {
          create: mock.fn(async (args) => {
            const blob = JSON.stringify(args);
            if (blob.includes("bad.png")) {
              throw new Error("vision timeout");
            }
            return {
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      findings: [
                        {
                          id: "ok-1",
                          measureId: "measure-1",
                          measure: "Automatic sprinkler system designed and installed in accordance with NFPA 13",
                          status: "verified",
                          source: { sheetId: "good", pageNumber: 1, fileName: "good.png" },
                          note: "Sprinkler heads visible on sheet.",
                        },
                      ],
                    }),
                  },
                },
              ],
            };
          }),
        },
      },
    };

    const outcome = await analyzeCodeModification({
      openai,
      formPages: SAMPLE_PAGES,
      sheets: [
        { id: "bad", fileName: "bad.png", pageNumber: 2, imageBase64: "aaaa" },
        { id: "good", fileName: "good.png", pageNumber: 1, imageBase64: "bbbb" },
      ],
      formDocument: { id: "form-1" },
    });
    assert.equal(outcome.ok, true);
    assert.equal(outcome.result.sheet_warnings.some((w) => /bad\.png/.test(w)), true);
    const sprinkler = outcome.result.evidence.find((f) => /NFPA 13/i.test(f.measure));
    assert.equal(sprinkler?.status, "verified");
    assert.equal(sprinkler?.source?.sheetId, "good");
  });

  it("extracts text from a synthetic pdf-lib fixture", async () => {
    const formPdfBase64 = await buildSamplePdfBase64();
    const pages = await extractPdfPageTexts(formPdfBase64);
    assert.equal(pages.length, 3);
    assert.match(pages[0].text, /IBC 1021\.2/);
    assert.match(pages[2].text, /FOR OFFICIAL USE ONLY/);
    const extracted = heuristicExtractModificationRequest(pages);
    assert.match(extracted.requestedModification, /1021\.2/);
    assert.equal(extracted.proposedMeasures.length, 5);
    assert.equal(
      extracted.extractionWarnings.some((w) => /No proposed alternative measures/i.test(w)),
      false,
    );
  });
});

describe("isDcJurisdiction", () => {
  it("accepts DC aliases only", () => {
    assert.equal(isDcJurisdiction("dc"), true);
    assert.equal(isDcJurisdiction("District of Columbia"), true);
    assert.equal(isDcJurisdiction("new-york"), false);
  });
});

const SCANNED_SPARSE_PAGES = [
  { pageNumber: 1, text: "" },
  { pageNumber: 2, text: "" },
  { pageNumber: 3, text: "Michelle Davis" },
  { pageNumber: 4, text: "" },
  { pageNumber: 5, text: "" },
  { pageNumber: 6, text: "" },
];

const COMBINED_MEASURE_PARAGRAPH =
  "Provide a two-hour fire rated enclosed stairway serving all occupied levels, provide a fully automatic sprinkler system throughout the building, provide a fully monitored fire alarm and emergency notification system, maintain an occupant load below 49 people per floor. Incorporate DOB recommendations from June 9, 2026 PDRM include a standpipe, maintain a common path of travel distance of less than 75'-0\", provide permanent signage identifying and limiting the maximum occupant load of the rooftop amenity area.";

const COMBINED_MEASURE_WITH_BOILERPLATE =
  "In lieu of providing a second means of egress stairs, the following life safety measures are proposed: Provide a two-hour fire rated enclosed stairway serving all occupied levels, provide a fully automatic sprinkler system throughout the building, provide a fully monitored fire alarm and emergency notification system, maintain an occupant load below 49 people per floor. Incorporated DOB recommendations from June 9, 2026 PDRM include a standpipe, maintain a common path of travel distance of less than 75'-0\", provide permanent signage identifying and limiting the maximum occupant load of the rooftop amenity area.";

describe("mergeExtractedRequests warning reconciliation", () => {
  it("drops stale heuristic warnings when vision fills extracted fields", () => {
    const heuristic = heuristicExtractModificationRequest(SCANNED_SPARSE_PAGES);
    assert.equal(heuristic.extractionWarnings.length, 3);
    const vision = {
      projectAddress: "1513 P St NW, Washington DC, 20005",
      requestedModification:
        "The code modification request is for the use of a targeted equivalency strategy for alternative life safety design implementation methods in lieu of providing a second egress stair requirement per 2017 DCMR 12A, DC Building Code with Amendments (2015 IBC) Chapter 10, Section 1006.",
      citedSections: [
        {
          citation:
            "2017 DCMR 12A, DC Building Code with Amendments (2015 IBC) Chapter 10, Section 1006",
          year: null,
          source: "applicant",
          label: "Applicant-cited code",
        },
      ],
      impracticalReason: "Low occupant load makes a second stair impractical.",
      compliesWithIntent: true,
      proposedMeasures: [
        {
          id: "measure-1",
          description: COMBINED_MEASURE_PARAGRAPH,
          sourcePageNumber: 2,
          sourceContext: "Proposed alternative / compensating measures",
        },
      ],
      floodHazardApplicable: false,
      supportingNarrative: null,
      extractionWarnings: [],
    };
    const merged = mergeExtractedRequests(heuristic, vision);
    assert.equal(
      merged.extractionWarnings.some((w) => w === HEURISTIC_FIELD_WARNINGS.requestedModification),
      false,
    );
    assert.equal(
      merged.extractionWarnings.some((w) => w === HEURISTIC_FIELD_WARNINGS.citedSections),
      false,
    );
    assert.equal(
      merged.extractionWarnings.some((w) => w === HEURISTIC_FIELD_WARNINGS.proposedMeasures),
      false,
    );
    assert.match(merged.requestedModification, /equivalency strategy/i);
    assert.equal(merged.citedSections.length, 1);
    assert.equal(merged.proposedMeasures.length >= 5, true);
  });

  it("keeps heuristic warnings when vision also fails to extract fields", () => {
    const heuristic = heuristicExtractModificationRequest(SCANNED_SPARSE_PAGES);
    const vision = emptyExtractedRequest(["Form LLM extract failed: timeout"]);
    const merged = mergeExtractedRequests(heuristic, vision);
    assert.equal(
      merged.extractionWarnings.some((w) => w === HEURISTIC_FIELD_WARNINGS.requestedModification),
      true,
    );
    assert.equal(
      merged.extractionWarnings.some((w) => w === HEURISTIC_FIELD_WARNINGS.citedSections),
      true,
    );
    assert.equal(
      merged.extractionWarnings.some((w) => w === HEURISTIC_FIELD_WARNINGS.proposedMeasures),
      true,
    );
    assert.match(merged.extractionWarnings.join(" "), /Form LLM extract failed/i);
  });
});

describe("normalizeProposedMeasures", () => {
  it("splits a combined compensating-measures paragraph into independent measures", () => {
    const split = splitMeasureDescription(COMBINED_MEASURE_PARAGRAPH);
    assert.equal(split.length >= 5, true);
    assert.match(split.join(" | "), /two-hour fire rated enclosed stairway/i);
    assert.match(split.join(" | "), /sprinkler system/i);
    assert.match(split.join(" | "), /fire alarm/i);
    assert.match(split.join(" | "), /occupant load below 49/i);
    assert.match(split.join(" | "), /standpipe/i);
    assert.match(split.join(" | "), /common path of travel/i);
    assert.match(split.join(" | "), /permanent signage/i);

    const normalized = normalizeProposedMeasures([
      {
        id: "measure-1",
        description: COMBINED_MEASURE_PARAGRAPH,
        sourcePageNumber: 2,
        sourceContext: "Proposed alternative / compensating measures",
      },
    ]);
    assert.equal(normalized.length, split.length);
    assert.equal(normalized.every((m) => m.sourcePageNumber === 2), true);
    assert.equal(
      normalized.every((m) => m.sourceContext === "Proposed alternative / compensating measures"),
      true,
    );
    assert.equal(normalized.every((m) => /^measure-\d+$/.test(m.id)), true);
  });
});

describe("analyzeCodeModification scanned-form regression", () => {
  it("clears stale warnings and splits measures when optional LLM extract succeeds", async () => {
    const openai = {
      chat: {
        completions: {
          create: mock.fn(async () => ({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    projectAddress: "1513 P St NW, Washington DC, 20005",
                    requestedModification:
                      "The code modification request is for the use of a targeted equivalency strategy for alternative life safety design implementation methods in lieu of providing a second egress stair requirement per 2017 DCMR 12A, DC Building Code with Amendments (2015 IBC) Chapter 10, Section 1006.",
                    citedSections: [
                      {
                        citation:
                          "2017 DCMR 12A, DC Building Code with Amendments (2015 IBC) Chapter 10, Section 1006",
                        year: null,
                        source: "applicant",
                        label: "Applicant-cited code",
                      },
                    ],
                    impracticalReason:
                      "Due to the limited floor area and low occupant load (48 for the whole building), adding a second egress stair would significantly reduce usable space.",
                    compliesWithIntent: true,
                    proposedMeasures: [
                      {
                        id: "measure-1",
                        description: COMBINED_MEASURE_PARAGRAPH,
                        sourcePageNumber: 2,
                      },
                    ],
                    floodHazardApplicable: false,
                    extractionWarnings: [],
                  }),
                },
              },
            ],
          })),
        },
      },
    };

    const outcome = await analyzeCodeModification({
      openai,
      formPages: SCANNED_SPARSE_PAGES,
      formImages: [{ pageNumber: 2, imageBase64: "aaaa", imageType: "image/png" }],
      formDocument: { id: "form-1513" },
    });

    assert.equal(outcome.ok, true);
    assert.equal(
      outcome.result.extraction_warnings.some(
        (w) => w === HEURISTIC_FIELD_WARNINGS.requestedModification,
      ),
      false,
    );
    assert.equal(
      outcome.result.extraction_warnings.some(
        (w) => w === HEURISTIC_FIELD_WARNINGS.citedSections,
      ),
      false,
    );
    assert.equal(
      outcome.result.extraction_warnings.some(
        (w) => w === HEURISTIC_FIELD_WARNINGS.proposedMeasures,
      ),
      false,
    );
    assert.equal(outcome.result.extracted_request.proposedMeasures.length >= 5, true);
    assert.equal(outcome.result.evidence.length >= 5, true);
    assert.equal(outcome.result.overall_status, "material_evidence_missing");
    assert.equal(
      outcome.result.extraction_warnings.some((w) =>
        /No drawing sheets were provided for evidence review/.test(w),
      ),
      true,
    );
  });
});

const FORM_1513_FILE = "1513 P St NW_Code-Modification-Form_10.01.24.pdf";

describe("drawing evidence source exclusion", () => {
  it("filters application sheets before vision review using excluded document ids", () => {
    const filtered = filterDrawingEvidenceSheetsForReview(
      [
        {
          id: "form-sheet-1",
          documentId: "form-drawing-dup",
          fileName: FORM_1513_FILE,
          pageNumber: 1,
          imageBase64: "aaaa",
        },
        {
          id: "real-sheet",
          documentId: "a101-doc",
          fileName: "A-101.pdf",
          pageNumber: 1,
          imageBase64: "bbbb",
        },
      ],
      { id: "form-app", fileName: FORM_1513_FILE },
      ["form-app", "form-drawing-dup"],
    );
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0].id, "real-sheet");
  });

  it("reproduces the 1513 form-only case without verifying applicant claims from the application", async () => {
    const measures = normalizeProposedMeasures([
      {
        id: "measure-1",
        description: COMBINED_MEASURE_PARAGRAPH,
        sourcePageNumber: 2,
      },
    ]);

    const openai = {
      chat: {
        completions: {
          create: mock.fn(async (args) => {
            const blob = JSON.stringify(args);
            if (blob.includes("Review only this submitted sheet")) {
              return {
                choices: [
                  {
                    message: {
                      content: JSON.stringify({
                        findings: measures.map((measure, index) => ({
                          id: `verified-${index + 1}`,
                          measureId: measure.id,
                          measure: measure.description,
                          status: "verified",
                          source: {
                            sheetId: "form-sheet-1",
                            fileName: FORM_1513_FILE,
                            pageNumber: 1,
                            excerpt: measure.description,
                          },
                          note: "Applicant claim visible on application page 1.",
                        })),
                      }),
                    },
                  },
                ],
              };
            }
            return {
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      projectAddress: "1513 P St NW, Washington DC, 20005",
                      requestedModification:
                        "Targeted equivalency strategy in lieu of a second egress stair per 2017 DCMR 12A Chapter 10 Section 1006.",
                      citedSections: [
                        {
                          citation: "2017 DCMR 12A Chapter 10 Section 1006",
                          year: null,
                          source: "applicant",
                          label: "Applicant-cited code",
                        },
                      ],
                      proposedMeasures: measures,
                      compliesWithIntent: true,
                      floodHazardApplicable: false,
                      extractionWarnings: [],
                    }),
                  },
                },
              ],
            };
          }),
        },
      },
    };

    const outcome = await analyzeCodeModification({
      openai,
      formPages: SCANNED_SPARSE_PAGES,
      formDocument: { id: "form-app-id", fileName: FORM_1513_FILE },
      excludedEvidenceDocumentIds: ["form-app-id", "form-drawing-dup-id"],
      sheets: [
        {
          id: "form-sheet-1",
          documentId: "form-drawing-dup-id",
          fileName: FORM_1513_FILE,
          pageNumber: 1,
          imageBase64: "aaaa",
        },
        {
          id: "form-sheet-4",
          documentId: "form-drawing-dup-id",
          fileName: FORM_1513_FILE,
          pageNumber: 4,
          imageBase64: "bbbb",
        },
      ],
    });

    assert.equal(outcome.result.extracted_request.proposedMeasures.length >= 5, true);
    assert.equal(outcome.result.evidence.every((finding) => finding.status === "not_found"), true);
    assert.equal(
      outcome.result.evidence.some((finding) => finding.source?.fileName === FORM_1513_FILE),
      false,
    );
    assert.equal(outcome.result.overall_status, "material_evidence_missing");
    assert.equal(
      outcome.result.extraction_warnings.some((w) =>
        /application pages were excluded from drawing evidence review/.test(w),
      ),
      true,
    );
    assert.equal(
      outcome.result.extraction_warnings.some((w) =>
        /No drawing sheets were provided for evidence review/.test(w),
      ),
      true,
    );
    assert.equal(openai.chat.completions.create.mock.calls.length, 1);
  });

  it("keeps base permit drawing sheets when only the form-slot upload is excluded", () => {
    const filtered = filterDrawingEvidenceSheetsForReview(
      [
        {
          id: "base-sheet-1",
          documentId: "base-page-1",
          fileName: "1513_P_St_MOCK_Permit_Drawings_Base.pdf",
          pageNumber: 1,
          imageBase64: "aaaa",
        },
        {
          id: "base-sheet-2",
          documentId: "base-page-2",
          fileName: "1513_P_St_MOCK_Permit_Drawings_Base.pdf",
          pageNumber: 2,
          imageBase64: "bbbb",
        },
      ],
      { id: "form-app", fileName: "1513 P St NW_Code-Modification-Form_10.01.24.pdf" },
      ["form-app", "drawing-form-slot-misupload"],
    );
    assert.equal(filtered.length, 2);
    assert.deepEqual(
      filtered.map((sheet) => sheet.pageNumber),
      [1, 2],
    );
  });
});

describe("splitMeasureDescription embedded include clauses", () => {
  it("splits standpipe from an incorporate / PDRM clause", () => {
    const split = splitMeasureDescription(
      "Incorporate DOB recommendations from June 9, 2026 PDRM include a standpipe",
    );
    assert.equal(split.length, 2);
    assert.match(split[0], /Incorporate DOB recommendations/i);
    assert.match(split[1], /standpipe/i);
  });

  it("keeps occupant load and standpipe as separate measures in the full 1513 paragraph", () => {
    const split = splitMeasureDescription(COMBINED_MEASURE_PARAGRAPH);
    const joined = split.join(" | ");
    assert.match(joined, /occupant load below 49/i);
    assert.match(joined, /standpipe/i);
    assert.equal(split.some((part) => /occupant load below 49/i.test(part)), true);
    assert.equal(split.some((part) => /standpipe/i.test(part)), true);
    assert.equal(
      split.some((part) => /occupant load below 49/i.test(part) && /standpipe/i.test(part)),
      false,
    );
  });
});

describe("splitMeasureDescription boilerplate and carryover cleanup", () => {
  it("strips introductory boilerplate from the first measure", () => {
    const measures = normalizeProposedMeasures([
      {
        id: "measure-1",
        description: COMBINED_MEASURE_WITH_BOILERPLATE,
        sourcePageNumber: 2,
        sourceContext: "Proposed alternative / compensating measures",
      },
    ]);
    assert.equal(
      measures[0].description,
      "Provide a two-hour fire rated enclosed stairway serving all occupied levels",
    );
    assert.doesNotMatch(measures[0].description, /in lieu of/i);
    assert.doesNotMatch(measures[0].description, /following life safety measures/i);
  });

  it("keeps occupant load clean without PDRM narrative carryover", () => {
    const measures = normalizeProposedMeasures([
      {
        id: "measure-1",
        description: COMBINED_MEASURE_WITH_BOILERPLATE,
        sourcePageNumber: 2,
      },
    ]);
    const occupantLoad = measures.find((measure) =>
      /occupant load below 49/i.test(measure.description),
    );
    assert.ok(occupantLoad);
    assert.equal(occupantLoad.description, "Maintain an occupant load below 49 people per floor");
    assert.doesNotMatch(occupantLoad.description, /PDRM/i);
    assert.doesNotMatch(occupantLoad.description, /Incorporated/i);
  });

  it("preserves standpipe and PDRM as separate measures in the 1513 pattern", () => {
    const measures = normalizeProposedMeasures([
      {
        id: "measure-1",
        description: COMBINED_MEASURE_WITH_BOILERPLATE,
        sourcePageNumber: 2,
      },
    ]);
    assert.equal(
      measures.some((measure) => /standpipe/i.test(measure.description)),
      true,
    );
    assert.equal(
      measures.some(
        (measure) =>
          /PDRM/i.test(measure.description) && !/occupant load below 49/i.test(measure.description),
      ),
      true,
    );
    assert.equal(measures.every((measure) => measure.sourcePageNumber === 2), true);
    assert.equal(measures.length, 8);
  });
});
