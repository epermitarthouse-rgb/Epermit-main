"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { hardenAnalysisResult, resolveAnalysisJurisdiction } = require("../app/services/compliance/findingQuality.js");
const { createDrawingIndex, hybridRetrieveDrawings, applyQueryEmbeddings } = require("../app/services/compliance/rag/drawingIndex.js");
const { retrieveCodeProvisions } = require("../app/services/compliance/rag/codeCorpus.js");

function sheet(fileName, text, extra = {}) {
  return {
    projectId: "project-a",
    documentId: extra.documentId || "doc-a",
    sheetId: extra.sheetId || fileName,
    fileName,
    title: extra.title || fileName,
    discipline: extra.discipline || null,
    contentClass: extra.contentClass || null,
    pageNumber: 1,
    text,
  };
}

describe("drawing retrieval relevance", () => {
  it("returns the sheet that contains the fact and omits unrelated sheets", () => {
    const index = createDrawingIndex();
    index.upsert(sheet("A-1.03.pdf", "GENERAL NOTES DOOR WIDTH WALL WIDTH AND PLAN WIDTH", {
      sheetId: "notes",
      title: "General notes",
      contentClass: "general_notes",
    }));
    index.upsert(sheet("A-1.04.pdf", "SYMBOL LEGEND EXIT WIDTH AND COVER SHEET NOTES", {
      sheetId: "cover",
      title: "Cover sheet",
    }));
    index.upsert(sheet("P-4.0.pdf", "PLUMBING DETAIL. PIPE INSULATION SHALL BE 1 INCH THICK.", {
      sheetId: "insulation",
      discipline: "plumbing",
    }));
    const hits = hybridRetrieveDrawings(index, {
      topics: ["pipe insulation"],
      disciplines: ["plumbing"],
      currentSheetId: "asking-sheet",
      limit: 4,
    });
    assert.equal(hits.length, 1);
    assert.equal(hits[0].fileName, "P-4.0.pdf");
    assert.match(hits[0].quote, /INSULATION/);
    assert.equal(hits[0].provenance.legs.vector, false);
    assert.equal(hits[0].diagnostics.embeddingStatus, "missing");
  });

  it("does not treat a missing embedding as a vector match", async () => {
    const index = createDrawingIndex();
    index.upsert(sheet("E-2.1.pdf", "EMERGENCY LIGHTING SHALL BE PROVIDED AT THE EXITS.", { sheetId: "electrical" }));
    index.upsert({
      ...sheet("A-1.03.pdf", "GENERAL NOTES WIDTH", { sheetId: "notes" }),
      embedding: [0, 1, 0],
      embeddingStatus: "present",
    });
    const embedded = await applyQueryEmbeddings(index, [{ id: "lighting", topics: ["emergency lighting"] }], async () => {
      throw new Error("embed unavailable");
    });
    assert.equal(embedded.embeddingStatus, "missing");
    const hits = hybridRetrieveDrawings(index, {
      topics: ["emergency lighting"],
      disciplines: ["electrical"],
      queryEmbedding: [0, 1, 0],
      currentSheetId: "other",
    });
    assert.equal(hits.length, 1);
    assert.equal(hits[0].fileName, "E-2.1.pdf");
    assert.equal(hits[0].provenance.legs.vector, false);
    assert.notEqual(hits[0].diagnostics.embeddingStatus, "present");
  });

  it("ranks an identifier match ahead of a sheet that only shares a generic word", () => {
    const index = createDrawingIndex();
    index.upsert(sheet("A-1.04.pdf", "GENERAL NOTES WIDTH CLEAR WIDTH", { sheetId: "notes" }));
    index.upsert(sheet("A-2.10.pdf", "FLOOR PLAN CORRIDOR 44 IN CLEAR. SEE SHEET A-6.01.", { sheetId: "plan" }));
    const hits = hybridRetrieveDrawings(index, {
      topics: ["corridor", "width"],
      identifiers: ["A-2.10"],
      currentSheetId: "equipment",
    });
    assert.ok(hits.length >= 1);
    assert.equal(hits[0].fileName, "A-2.10.pdf");
    assert.equal(hits.some((hit) => hit.fileName === "A-1.04.pdf"), false);
    assert.equal(hits[0].provenance.legs.exactIdentifier, true);
  });
});

describe("published questions and false findings", () => {
  it("rejects accessibility complaints on structural and electrical sheets", () => {
    for (const current of [
      { fileName: "S-201.pdf", sheetTitle: "Foundation section", pageText: "STRUCTURAL FOUNDATION SECTION" },
      { fileName: "E-1.2.pdf", sheetTitle: "Power plan", pageText: "ELECTRICAL POWER PLAN" },
    ]) {
      const hardened = hardenAnalysisResult(
        {
          issues: [{
            title: "Missing accessibility features",
            description: "The accessible route is not shown.",
            category: "Accessibility",
            severity: "warning",
            findingType: "missing_information",
          }],
          summary: {},
          jurisdictionNotes: "",
        },
        "ibc",
        { projectType: "Office", ...current },
      );
      assert.equal(hardened.issues.length, 0);
      assert.equal(hardened.rejectedCandidates[0].validationReason, "accessible_route_outside_discipline");
    }
  });

  it("rejects egress width on equipment plans and general-notes sheets", () => {
    const equipment = hardenAnalysisResult(
      {
        issues: [{
          title: "Egress width",
          description: "The egress width is not shown.",
          category: "Egress",
          severity: "warning",
          findingType: "missing_information",
        }],
        summary: {},
        jurisdictionNotes: "",
      },
      "ibc",
      { projectType: "Assembly", fileName: "EQ-1.pdf", sheetTitle: "Equipment plan", pageText: "KITCHEN EQUIPMENT PLAN" },
    );
    assert.equal(equipment.issues.length, 0);
    assert.equal(equipment.rejectedCandidates[0].validationReason, "egress_width_outside_sheet");

    const notes = hardenAnalysisResult(
      {
        issues: [{
          title: "Corridor width",
          description: "The corridor width is not shown.",
          category: "Egress",
          severity: "warning",
          findingType: "missing_information",
        }],
        summary: {},
        jurisdictionNotes: "",
      },
      "ibc",
      { projectType: "Business", fileName: "G-0.00.pdf", sheetTitle: "General notes", pageText: "GENERAL NOTES ABBREVIATIONS" },
    );
    assert.equal(notes.issues.length, 0);
    assert.equal(notes.rejectedCandidates[0].validationReason, "egress_width_outside_sheet");
  });

  it("rejects insulation and documentation claims that the set already specifies", () => {
    const insulation = hardenAnalysisResult(
      {
        issues: [{
          title: "Missing insulation",
          description: "Pipe insulation is not shown.",
          category: "Plumbing",
          severity: "warning",
          findingType: "missing_information",
        }],
        summary: {},
        jurisdictionNotes: "",
      },
      "ibc",
      { projectType: "Office", fileName: "P-1.2.pdf", pageText: "HOT WATER PIPE INSULATION SHALL BE 1 INCH THICK." },
    );
    assert.equal(insulation.issues.length, 0);

    const documented = hardenAnalysisResult(
      {
        issues: [{
          title: "Energy documentation",
          description: "Energy efficiency documentation is not shown.",
          category: "Energy",
          severity: "warning",
          findingType: "missing_information",
        }],
        summary: {},
        jurisdictionNotes: "",
      },
      "ibc",
      {
        projectType: "Retail",
        fileName: "P-1.0.pdf",
        pageText: "PLUMBING PLAN",
        drawingRecords: [{
          fileName: "EN-1.pdf",
          sheetId: "energy",
          text: "ENERGY EFFICIENCY SHALL BE DOCUMENTED ON THE CERTIFICATE.",
        }],
      },
    );
    assert.equal(documented.issues.length, 0);
    assert.equal(documented.rejectedCandidates[0].validationReason, "cross_sheet_answers_question");
  });

  it("does not publish a generic missing-information question or cite an unrelated sheet", () => {
    const hardened = hardenAnalysisResult(
      {
        issues: [{
          title: "Missing information",
          description: "Additional information is required for compliance.",
          category: "Life Safety",
          severity: "advisory",
          findingType: "missing_information",
        }],
        summary: { overallScore: 100 },
        jurisdictionNotes: "",
      },
      "ibc",
      {
        projectType: "School",
        fileName: "A-1.01.pdf",
        sheetTitle: "Floor plan",
        pageText: "FLOOR PLAN OFFICE",
        drawingRecords: [
          { fileName: "A-1.03.pdf", sheetId: "notes", text: "GENERAL NOTES WIDTH" },
          { fileName: "A-1.04.pdf", sheetId: "cover", text: "COVER SHEET" },
        ],
      },
    );
    assert.equal(hardened.issues.length, 0);
    assert.equal(hardened.rejectedCandidates[0].userVisible, false);
    assert.notEqual(hardened.summary.overallScore, 100);
    const detail = hardened.rejectedCandidates.map((item) => `${item.validationDetail || ""} ${item.description || ""}`).join(" ");
    assert.doesNotMatch(detail, /A-1\.03|A-1\.04/);
  });

  it("keeps a measured violation when the fixture supplies verified threshold text", () => {
    const verified = {
      id: "riser",
      registryRecordId: "fixture-city-2021",
      authoritative: true,
      supportsConfirmedViolation: true,
      sourceStatus: "verified_text",
      codeBook: "IBC",
      edition: "2021",
      text: 'IBC Section 1011.5.2 maximum riser height is 7".',
      section: "1011.5.2",
      exceptions: [],
    };
    const hits = retrieveCodeProvisions({
      topics: ["riser"],
      provisions: [{ ...verified, jurisdiction: "fixture-city", topics: ["riser"] }],
      authoritativeOnly: true,
    });
    assert.equal(hits.length, 1);
    const hardened = hardenAnalysisResult(
      {
        issues: [{
          title: "Stair riser",
          description: 'Stair riser is 8" and the maximum in the verified section is 7".',
          category: "Egress",
          codeReference: "IBC 1011.5.2",
          findingType: "confirmed_violation",
          measurableEvidence: true,
          evidenceTier: "drawing",
          location: "Stair B",
          severity: "warning",
        }],
        summary: {},
        jurisdictionNotes: "",
      },
      "ibc",
      {
        projectType: "Dwelling",
        fileName: "A-2.00.pdf",
        sheetTitle: "Floor plan",
        pageText: 'FLOOR PLAN STAIR B RISER 8"',
        authoritativeCode: [verified],
        legalApplicability: {
          status: "verified",
          reviewScope: "permit_compliance",
          registryRecordId: "fixture-city-2021",
        },
        codeYear: "2021",
        jurisdictionScope: {
          selectionSource: "explicit",
          selectedScope: "fixture-city",
          enforcedJurisdiction: "fixture-city",
          amendmentsEnforced: true,
        },
      },
    );
    assert.equal(hardened.issues.length, 1);
    assert.equal(hardened.issues[0].findingType, "confirmed_violation");
    assert.equal(hardened.issues[0].codeSourceStatus, "authoritative");
  });

  it("keeps explicit General IBC when drawings name another jurisdiction", () => {
    assert.equal(resolveAnalysisJurisdiction({
      runJurisdiction: "General IBC",
      projectJurisdiction: "Washington, DC",
      drawingText: "Washington, D.C. Building Code",
    }), "general");
    const library = retrieveCodeProvisions({ topics: ["corridor"], jurisdiction: "dc", authoritativeOnly: true });
    assert.equal(library.length, 0);
  });

  it("publishes a grounded question without converting an unsupported violation into an advisory", () => {
    const grounded = hardenAnalysisResult(
      {
        issues: [{
          title: "Corridor width below minimum",
          description: 'Dimension note shows 36" clear, which does not meet the 44" minimum.',
          category: "Egress",
          codeReference: "IBC 1020.2",
          findingType: "confirmed_violation",
          measurableEvidence: true,
          evidenceTier: "drawing",
          severity: "warning",
        }],
        summary: {},
        jurisdictionNotes: "",
      },
      "ibc",
      {
        projectType: "Office",
        fileName: "A-1.01.pdf",
        sheetTitle: "Floor plan",
        pageText: 'CORRIDOR 36" CLEAR',
        jurisdictionScope: { enforcedJurisdiction: "general", amendmentsEnforced: false },
        codeYear: "2021",
      },
    );
    assert.equal(grounded.issues.length, 1);
    assert.equal(grounded.issues[0].findingType, "missing_information");
    assert.match(grounded.issues[0].description, /Drawing evidence:/);
    assert.match(grounded.issues[0].description, /unresolved condition/i);
    assert.match(grounded.issues[0].description, /do not resolve|does not resolve/i);
    assert.match(grounded.issues[0].description, /general/);
    assert.doesNotMatch(grounded.issues[0].description, /A-1\.03|A-1\.04/);

    const unsupported = hardenAnalysisResult(
      {
        issues: [{
          title: "General deficiency",
          description: "The design appears non-compliant.",
          category: "Egress",
          findingType: "confirmed_violation",
          severity: "critical",
        }],
        summary: { overallScore: 100 },
        jurisdictionNotes: "",
      },
      "ibc",
      { projectType: "Office", fileName: "A-1.01.pdf", pageText: "FLOOR PLAN" },
    );
    assert.equal(unsupported.issues.length, 0);
    assert.equal(unsupported.rejectedCandidates[0].userVisible, false);
    assert.equal(unsupported.rejectedCandidates[0].validationDisposition, "reject");
  });
});
