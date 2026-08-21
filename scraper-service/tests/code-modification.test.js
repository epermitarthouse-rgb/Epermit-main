"use strict";

const { describe, it, mock } = require("node:test");
const assert = require("node:assert/strict");
const { PDFDocument, StandardFonts } = require("pdf-lib");
const {
  classifyPageRole,
  applicantPagesFrom,
  heuristicExtractModificationRequest,
  pagesAreSparse,
  validateAndGroundFindings,
  stripApprovalClaims,
  computeOverallStatus,
  buildFormExtractPrompt,
  buildSheetReviewPrompt,
  analyzeCodeModification,
  extractPdfPageTexts,
  isDcJurisdiction,
  PROMPT_CONSTRAINTS,
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
  });
});

describe("isDcJurisdiction", () => {
  it("accepts DC aliases only", () => {
    assert.equal(isDcJurisdiction("dc"), true);
    assert.equal(isDcJurisdiction("District of Columbia"), true);
    assert.equal(isDcJurisdiction("new-york"), false);
  });
});
