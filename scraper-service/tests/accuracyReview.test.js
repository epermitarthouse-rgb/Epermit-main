"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { hardenAnalysisResult, resolveAnalysisJurisdiction } = require("../app/services/compliance/findingQuality.js");
const { retrieveCodeProvisions, CODE_PROVISIONS } = require("../app/services/compliance/rag/codeCorpus.js");
const { inferOccupancy, inferWorkScope } = require("../app/services/compliance/review/applicability.js");

function issue(partial) {
  return {
    severity: "warning",
    category: "Accessibility",
    evidenceTier: "drawing",
    findingType: "missing_information",
    ...partial,
  };
}

describe("requirement applicability", () => {
  it("does not apply residential Type A dwelling requirements to a commercial restaurant", () => {
    const hardened = hardenAnalysisResult(
      {
        issues: [
          issue({
            title: "Type A dwelling unit clearance",
            description: "Type A dwelling unit kitchen clearance is not shown.",
            codeReference: "ICC A117.1",
          }),
        ],
        summary: { overallScore: 100 },
        jurisdictionNotes: "",
      },
      "ibc",
      {
        projectType: "Restaurant",
        sheetTitle: "Floor plan",
        fileName: "floor-plan.pdf",
        contentClass: "floor_plan",
        pageText: "OCCUPANCY GROUP A-2 RESTAURANT NEW CONSTRUCTION",
      },
    );
    assert.equal(hardened.issues.length, 0);
    assert.equal(hardened.rejectedCandidates[0].validationReason, "residential_requirement_on_commercial");
    assert.equal(inferOccupancy("Restaurant", "group A-2"), "commercial");
    assert.equal(inferWorkScope("new construction"), "new_construction");
  });

  it("does not fault an electrical plan or an equipment plan for an architectural accessible route", () => {
    for (const sheet of [
      { sheetTitle: "Lighting plan", fileName: "lighting.pdf", contentClass: "mep", pageText: "ELECTRICAL LIGHTING PLAN" },
      { sheetTitle: "Equipment plan", fileName: "equipment.pdf", contentClass: "mep", pageText: "KITCHEN EQUIPMENT PLAN" },
    ]) {
      const hardened = hardenAnalysisResult(
        {
          issues: [
            issue({
              title: "Accessible route",
              description: "The accessible route is not shown.",
              codeReference: "IBC 1104",
            }),
          ],
          summary: {},
          jurisdictionNotes: "",
        },
        "ibc",
        { projectType: "Commercial", ...sheet },
      );
      assert.equal(hardened.issues.length, 0);
      assert.equal(hardened.rejectedCandidates[0].validationReason, "accessible_route_outside_discipline");
    }
  });

  it("does not flag an energy certificate for a missing egress plan", () => {
    const hardened = hardenAnalysisResult(
      {
        issues: [
          issue({
            category: "Egress",
            title: "Egress plan",
            description: "The egress plan is not shown.",
            codeReference: "IBC 1006",
          }),
        ],
        summary: {},
        jurisdictionNotes: "",
      },
      "ibc",
      {
        projectType: "Commercial",
        sheetTitle: "Energy compliance certificate",
        fileName: "energy-certificate.pdf",
        contentClass: "form",
        pageText: "ENERGY CODE CERTIFICATE COMCHECK",
      },
    );
    assert.equal(hardened.issues.length, 0);
    assert.equal(hardened.rejectedCandidates[0].validationReason, "egress_outside_energy_certificate");
  });

  it("checks project special-inspection documents before reporting them missing on a structural sheet", () => {
    const documented = hardenAnalysisResult(
      {
        issues: [
          issue({
            category: "Structural",
            title: "Special inspections",
            description: "Special inspections are not shown.",
            codeReference: "IBC Chapter 17",
          }),
        ],
        summary: {},
        jurisdictionNotes: "",
      },
      "ibc",
      {
        projectType: "Commercial",
        sheetTitle: "Foundation plan",
        fileName: "foundation.pdf",
        contentClass: "drawing",
        pageText: "FOUNDATION PLAN FOOTING SCHEDULE",
        drawingRecords: [
          {
            fileName: "inspection-statement.pdf",
            sheetId: "statement",
            text: "STATEMENT OF SPECIAL INSPECTIONS REQUIRED UNDER CHAPTER 17",
          },
        ],
      },
    );
    assert.equal(documented.issues.length, 0);
    assert.equal(documented.rejectedCandidates[0].validationReason, "special_inspection_documented");

    const unavailable = hardenAnalysisResult(
      {
        issues: [
          issue({
            category: "Structural",
            title: "Special inspections",
            description: "Special inspections are not shown.",
            codeReference: "IBC Chapter 17",
          }),
        ],
        summary: {},
        jurisdictionNotes: "",
      },
      "ibc",
      {
        projectType: "Commercial",
        sheetTitle: "Foundation plan",
        fileName: "foundation.pdf",
        contentClass: "drawing",
        pageText: "FOUNDATION PLAN",
        drawingRetrieval: { available: false, persisted: false, reason: "probe_failed" },
      },
    );
    assert.equal(unavailable.issues.length, 1);
    assert.match(unavailable.issues[0].description, /retrieval was unavailable/i);
    assert.doesNotMatch(unavailable.issues[0].description, /absent/i);
  });
});

describe("cross-sheet verification and citation limits", () => {
  it("rejects a missing dimension that another sheet already states", () => {
    const hardened = hardenAnalysisResult(
      {
        issues: [
          issue({
            category: "Egress",
            title: "Stair width",
            description: "Stair width 44 inches is not shown.",
            codeReference: "IBC 1011",
            location: "Stair A",
          }),
        ],
        summary: {},
        jurisdictionNotes: "",
      },
      "ibc",
      {
        projectType: "Commercial",
        sheetTitle: "Floor plan",
        fileName: "floor-plan.pdf",
        sheetId: "floor",
        contentClass: "floor_plan",
        pageText: "FLOOR PLAN OFFICE",
        drawingRecords: [
          {
            fileName: "egress-plan.pdf",
            sheetId: "egress",
            sheetNumber: "LS-2",
            text: "STAIR A WIDTH 44 INCHES CLEAR",
          },
        ],
      },
    );
    assert.equal(hardened.issues.length, 0);
    assert.equal(hardened.rejectedCandidates[0].validationReason, "cross_sheet_answers_question");
  });

  it("keeps an unsupported citation unverified and does not confirm it", () => {
    const hardened = hardenAnalysisResult(
      {
        issues: [
          {
            severity: "critical",
            category: "Egress",
            title: "General deficiency",
            description: "The design appears non-compliant with the cited section.",
            codeReference: "IBC 1020.2",
            findingType: "confirmed_violation",
            evidenceTier: "drawing",
          },
        ],
        summary: { overallScore: 100 },
        jurisdictionNotes: "",
      },
      "ibc",
      {
        projectType: "Commercial",
        sheetTitle: "Floor plan",
        fileName: "floor-plan.pdf",
        contentClass: "floor_plan",
        pageText: "FLOOR PLAN",
      },
    );
    assert.equal(hardened.issues.length, 0);
    assert.equal(hardened.rejectedCandidates[0].validationReason, "unsupported_allegation");
    assert.notEqual(hardened.summary.overallScore, 100);
    const library = retrieveCodeProvisions({ topics: ["corridor", "width"], authoritativeOnly: true });
    assert.equal(library.length, 0);
    assert.equal(CODE_PROVISIONS.every((item) => item.authoritative === false && !item.section), true);
  });

  it("retains a measured defect only when the fixture supplies a verified threshold", () => {
    const verified = {
      id: "fixture-riser",
      authoritative: true,
      sourceStatus: "verified_text",
      codeBook: "IBC",
      edition: "2021",
      section: "1011.5.2",
        text: 'Section 1011.5.2 maximum riser height is 7".',
      jurisdiction: "any",
      registryRecordId: "fixture-ibc-2021",
      supportsConfirmedViolation: true,
      exceptions: [],
      topics: ["riser", "stair"],
      requirement: 'Section 1011.5.2 maximum riser height is 7".',
    };
    const hits = retrieveCodeProvisions({ topics: ["riser"], provisions: [verified], authoritativeOnly: true });
    assert.equal(hits.length, 1);
    assert.equal(hits[0].authoritative, true);
    assert.equal(hits[0].section, "1011.5.2");

    const hardened = hardenAnalysisResult(
      {
        issues: [
          {
            severity: "warning",
            category: "Egress",
            title: "Stair riser",
            description: 'Stair riser is 8" and the maximum in the verified section is 7".',
            codeReference: "IBC 1011.5.2",
            findingType: "confirmed_violation",
            measurableEvidence: true,
            evidenceTier: "drawing",
            location: "Stair A",
          },
        ],
        summary: {},
        jurisdictionNotes: "",
      },
      "ibc",
      {
        projectType: "Commercial",
        sheetTitle: "Floor plan",
        fileName: "floor-plan.pdf",
        contentClass: "floor_plan",
        pageText: 'FLOOR PLAN\nSTAIR A RISER 8"',
        authoritativeCode: [verified],
        legalApplicability: {
          status: "verified",
          reviewScope: "permit_compliance",
          registryRecordId: "fixture-ibc-2021",
        },
      },
    );
    assert.equal(hardened.issues.length, 1);
    assert.equal(hardened.issues[0].findingType, "confirmed_violation");
    assert.equal(hardened.issues[0].codeSourceStatus, "authoritative");
  });

  it("rejects a dimension that is not tied to the named element", () => {
    const hardened = hardenAnalysisResult(
      {
        issues: [
          {
            severity: "warning",
            category: "Egress",
            title: "Corridor width",
            description: 'Corridor width is 36".',
            codeReference: "IBC 1020.2",
            findingType: "confirmed_violation",
            measurableEvidence: true,
            evidenceTier: "drawing",
          },
        ],
        summary: {},
        jurisdictionNotes: "",
      },
      "ibc",
      {
        projectType: "Commercial",
        sheetTitle: "Floor plan",
        fileName: "floor-plan.pdf",
        contentClass: "floor_plan",
        pageText: `DOOR 36" AT THE ENTRY VESTIBULE BESIDE THE TITLE BLOCK AND FAR FROM THE NAMED ELEMENT ${"x".repeat(80)}\nCORRIDOR AT GRID B`,
      },
    );
    assert.equal(hardened.issues.length, 0);
    assert.equal(hardened.rejectedCandidates[0].validationReason, "dimension_not_tied_to_element");
  });

  it("keeps explicit General IBC when the drawing names another jurisdiction", () => {
    assert.equal(
      resolveAnalysisJurisdiction({
        runJurisdiction: "General IBC",
        projectJurisdiction: "Washington, DC",
        drawingText: "Washington, D.C. Building Code",
      }),
      "general",
    );
    assert.equal(
      resolveAnalysisJurisdiction({
        runJurisdiction: "2021 IBC",
        projectJurisdiction: "Florida",
        drawingText: "Florida Building Code",
      }),
      "2021-ibc",
    );
  });
});
