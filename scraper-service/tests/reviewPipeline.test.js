"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { hardenAnalysisResult, resolveAnalysisJurisdiction, resolveJurisdictionDecisionFromInput } = require("../app/services/compliance/findingQuality.js");
const { createDrawingIndex, hybridRetrieveDrawings } = require("../app/services/compliance/rag/drawingIndex.js");
const { retrieveForQuestions } = require("../app/services/compliance/rag/retrieve.js");
const { retrieveCodeProvisions } = require("../app/services/compliance/rag/codeCorpus.js");
const { prepareSheetReview } = require("../app/services/compliance/review/orchestrate.js");
const { hydrateStoredReviewState } = require("../app/services/compliance/review/reviewStates.js");
const { evaluateRules } = require("../app/services/compliance/review/rules.js");

function sheet(fileName, text, extra = {}) {
  return {
    projectId: "project-1",
    documentId: extra.documentId || fileName,
    sheetId: extra.sheetId || fileName,
    fileName,
    title: extra.title || fileName,
    discipline: extra.discipline || null,
    pageNumber: 1,
    text,
    contentClass: extra.contentClass || null,
    regions: extra.regions || [],
    extractionMethod: "pdfjs-text-layer",
  };
}

describe("review states", () => {
  it("keeps a completed sparse checklist visible and unscored", () => {
    const hardened = hardenAnalysisResult(
      {
        issues: [],
        checklist: [{ item: "Plumbing details", result: "reviewed" }],
        summary: { overallScore: 100 },
        jurisdictionNotes: "",
      },
      "ibc",
      { sheetTitle: "P-3.0-00.pdf", contentClass: "drawing", fileName: "P-3.0-00.pdf" },
    );
    assert.equal(hardened.summary.reviewState, "reviewed_partial");
    assert.equal(hardened.summary.overallScore, null);
  });

  it("reviews a mechanical schedule instead of discarding it", () => {
    const hardened = hardenAnalysisResult(
      { issues: [], summary: { overallScore: 100 }, jurisdictionNotes: "" },
      "ibc",
      { sheetTitle: "M-4.1.pdf", contentClass: "schedule", fileName: "M-4.1.pdf" },
    );
    assert.equal(hardened.summary.reviewState, "reviewed_partial");
    assert.notEqual(hardened.summary.reviewState, "not_reviewed");
    assert.notEqual(hardened.summary.overallScore, 100);
  });

  it("gives a special-inspections sheet a documentary review without an architectural pass", () => {
    const hardened = hardenAnalysisResult(
      { issues: [], summary: { overallScore: 100 }, jurisdictionNotes: "" },
      "ibc",
      { sheetTitle: "S-300.00.pdf", contentClass: "form", fileName: "S-300.00.pdf", pageText: "STATEMENT OF SPECIAL INSPECTIONS" },
    );
    assert.equal(hardened.summary.reviewState, "reviewed_partial");
    assert.equal(hardened.summary.overallScore, null);
  });

  it("hydrates a historical pass without treating it as a new write", () => {
    const stored = hydrateStoredReviewState("passed");
    assert.equal(stored.canonical, "reviewed_clear");
    assert.equal(stored.reviewState, "passed");
    assert.equal(stored.legacy, true);
    assert.equal(hydrateStoredReviewState("not_reviewed").reviewState, "not_reviewed");
  });
});

describe("candidate verification", () => {
  it("rejects a corridor width that is not on the equipment plan and does not score 100", () => {
    const hardened = hardenAnalysisResult(
      {
        issues: [
          {
            severity: "critical",
            category: "Egress",
            title: "Corridor width",
            description: 'The corridor is 44" wide.',
            codeReference: "IBC 1020.2",
            evidenceTier: "drawing",
            measurableEvidence: true,
            findingType: "confirmed_violation",
          },
        ],
        summary: { overallScore: 100 },
        jurisdictionNotes: "",
      },
      "ibc",
      { sheetTitle: "EQ-1.00-0.pdf", fileName: "EQ-1.00-0.pdf", pageText: "EQUIPMENT PLAN KITCHEN LAYOUT" },
    );
    assert.equal(hardened.issues.length, 0);
    assert.equal(hardened.rejectedCandidates[0].validationReason, "corridor_width_not_on_equipment_plan");
    assert.equal(hardened.summary.reviewState, "reviewed_partial");
    assert.equal(hardened.summary.overallScore, null);
  });

  it("does not publish an equipment-plan dimension as a corridor violation", () => {
    const hardened = hardenAnalysisResult(
      {
        issues: [
          {
            severity: "critical",
            category: "Egress",
            title: "Corridor Width Non-Compliance",
            description: 'The corridor width is marked as 2\'-6", which does not meet the minimum clear width requirement.',
            codeReference: "IBC 1020.2",
            findingType: "confirmed_violation",
            measurableEvidence: true,
            location: "Corridor near equipment layout",
          },
        ],
        checklist: [
          { item: "Corridor clear width", result: '2\'-6" labeled at the corridor', evidence: '2\'-6" (CLEAR)' },
        ],
        summary: { overallScore: 80 },
        jurisdictionNotes: "",
      },
      "ibc",
      { sheetTitle: "EQ-1.00-0.pdf", fileName: "EQ-1.00-0.pdf", pageText: 'EQUIPMENT PLAN 2\'-6" CLEAR' },
    );
    assert.equal(hardened.issues.length, 0);
    assert.equal(hardened.rejectedCandidates[0].validationReason, "dimension_not_tied_to_element");
    assert.equal(hardened.summary.cleanChecks.length, 0);
    assert.equal(hardened.summary.confirmedViolations, 0);
    assert.notEqual(hardened.summary.reviewState, "reviewed_clear");
  });

  it("names the architectural sheet that already shows the corridor and does not invent one", () => {
    const hardened = hardenAnalysisResult(
      {
        issues: [
          {
            severity: "critical",
            title: "Corridor Width Non-Compliance",
            description: 'The corridor is 36" and does not meet the minimum.',
            codeReference: "IBC 1020.2",
            findingType: "confirmed_violation",
            measurableEvidence: true,
          },
        ],
        summary: {},
        jurisdictionNotes: "",
      },
      "ibc",
      {
        sheetTitle: "EQ-1.00-0.pdf",
        fileName: "EQ-1.00-0.pdf",
        pageText: 'EQUIPMENT PLAN 36" CLEAR',
        drawingRecords: [
          { fileName: "A-101.pdf", title: "Floor plan", text: 'CORRIDOR 36" CLEAR', contentClass: "drawing" },
        ],
      },
    );
    assert.equal(hardened.issues.length, 0);
    assert.equal(hardened.rejectedCandidates[0].validationReason, "dimension_answered_on_other_sheet");
    assert.match(hardened.rejectedCandidates[0].validationDetail, /A-101\.pdf/);
  });

  it("does not confirm a 44-inch corridor without a traceable dimension", () => {
    const hardened = hardenAnalysisResult(
      {
        issues: [
          {
            severity: "warning",
            category: "Egress",
            title: "Corridor width",
            description: 'Corridor width is 44".',
            codeReference: "IBC 1020.2",
            measurableEvidence: true,
            findingType: "confirmed_violation",
            location: "Corridor A",
          },
        ],
        summary: {},
        jurisdictionNotes: "",
      },
      "ibc",
      { sheetTitle: "A-1.00-00.pdf", fileName: "A-1.00-00.pdf", pageText: "FLOOR PLAN PARTITION TAG 1 HR" },
    );
    assert.notEqual(hardened.issues[0]?.findingType, "confirmed_violation");
    assert.equal(hardened.summary.confirmedViolations, 0);
    assert.notEqual(hardened.summary.overallScore, 100);
  });

  it("does not report a missing fire rating when the plan text has a 1-hour tag", () => {
    const hardened = hardenAnalysisResult(
      {
        issues: [
          {
            severity: "warning",
            category: "Fire Safety",
            title: "Fire rating missing",
            description: "The partition fire rating is not shown.",
            codeReference: "IBC 703",
          },
        ],
        summary: {},
        jurisdictionNotes: "",
      },
      "ibc",
      { sheetTitle: "A-1.00-00.pdf", pageText: "PARTITION TYPE A 1 HR" },
    );
    assert.equal(hardened.issues.length, 0);
  });

  it("rejects exit-sign findings on a wall section", () => {
    const hardened = hardenAnalysisResult(
      {
        issues: [
          {
            severity: "warning",
            category: "Egress",
            title: "Exit sign missing",
            description: "Exit sign is not shown at the stair.",
            codeReference: "IBC 1013",
            location: "Wall section 3",
          },
        ],
        summary: {},
        jurisdictionNotes: "",
      },
      "ibc",
      { sheetTitle: "A-6.01 Wall Section", contentClass: "section", fileName: "A-6.01.pdf" },
    );
    assert.equal(hardened.issues.length, 0);
    assert.equal(hardened.rejectedCandidates[0].validationReason, "exit_sign_on_wall_section");
  });

  it("does not treat a requirement already written on the sheet as a violation", () => {
    for (const [title, pageText] of [
      ["Water hammer arrester missing", "PROVIDE WATER HAMMER ARRESTER AT QUICK CLOSE VALVES"],
      ["GFCI protection missing", "RECEPTACLES IN KITCHEN SHALL BE GFCI"],
      ["Draft stop seal missing", "DRAFT-STOP SEAL AT TOP OF WALL"],
    ]) {
      const hardened = hardenAnalysisResult(
        {
          issues: [
            {
              severity: "warning",
              category: "MEP",
              title,
              description: `${title}. The item is not provided.`,
              codeReference: "IBC",
            },
          ],
          summary: {},
          jurisdictionNotes: "",
        },
        "ibc",
        { sheetTitle: "P-3.0-00.pdf", fileName: "P-3.0-00.pdf", pageText },
      );
      assert.equal(hardened.issues.length, 0, title);
      assert.equal(hardened.summary.confirmedViolations, 0);
    }
  });
});

describe("jurisdiction precedence", () => {
  it("stores detected DC separately and does not enforce DC amendments for explicit General IBC", () => {
    const decision = resolveJurisdictionDecisionFromInput({
      runJurisdiction: "General IBC",
      projectJurisdiction: null,
      drawingText: "Washington, D.C. 12A DCMR",
    });
    assert.equal(decision.selectionSource, "explicit");
    assert.equal(decision.selectedScope, "general-ibc");
    assert.equal(decision.enforcedJurisdiction, "general");
    assert.equal(decision.detectedLocation, "dc");
    assert.equal(decision.amendmentsEnforced, false);
    assert.equal(resolveAnalysisJurisdiction({ runJurisdiction: "General IBC", drawingText: "Washington, DC" }), "general");
  });

  it("discloses detection when the user did not select a jurisdiction", () => {
    const decision = resolveJurisdictionDecisionFromInput({
      runJurisdiction: null,
      drawingText: "District of Columbia Building Code",
    });
    assert.equal(decision.selectionSource, "detected");
    assert.equal(decision.enforcedJurisdiction, "dc");
    assert.equal(decision.disclosed, true);
  });

  it("rejects a DC amendment citation when General IBC was explicit", () => {
    const hardened = hardenAnalysisResult(
      {
        issues: [
          {
            severity: "warning",
            category: "Egress",
            title: "Corridor width",
            description: 'Dimension note shows 36" clear, which does not meet the local minimum.',
            codeReference: "12A DCMR 1017.2",
            measurableEvidence: true,
            findingType: "confirmed_violation",
            location: "Corridor A",
          },
        ],
        summary: {},
        jurisdictionNotes: "",
      },
      "ibc",
      {
        sheetTitle: "A-1.00-00.pdf",
        pageText: 'CORRIDOR A 36" CLEAR',
        jurisdictionScope: {
          selectionSource: "explicit",
          selectedScope: "general-ibc",
          enforcedJurisdiction: "general",
          detectedLocation: "dc",
          amendmentsEnforced: false,
        },
      },
    );
    assert.equal(hardened.issues.length, 0);
    assert.equal(hardened.rejectedCandidates[0].validationReason, "explicit_general_ibc");
  });
});

describe("drawing code and specification retrieval", () => {
  it("retrieves partition evidence from other sheets before a missing-rating claim on A-1.00", () => {
    const index = createDrawingIndex();
    index.upsert(sheet("A-1.00-00.pdf", "FIRST FLOOR PLAN NO RATING CALLOUT ON THIS VIEW", { sheetId: "a100" }));
    index.upsert(
      sheet("A-6.01.00.pdf", "WALL LEGEND PARTITION TYPE A 1 HR", {
        sheetId: "legend",
        regions: [{ x: 10, y: 20, width: 40, height: 12, unit: "pdf-point", origin: "bottom-left" }],
      }),
    );
    index.upsert(sheet("A-3.02-00.pdf", "WALL SECTION 1-HOUR PARTITION", { sheetId: "section" }));
    const retrieval = retrieveForQuestions({
      index,
      currentSheetId: "a100",
      questions: [{ id: "fire-rated-partition", topics: ["partition", "legend", "1 hr", "1-hour", "wall"] }],
    });
    const names = retrieval.packages[0].drawing.map((hit) => hit.fileName);
    assert.ok(names.includes("A-6.01.00.pdf"));
    assert.ok(names.includes("A-3.02-00.pdf"));
    assert.equal(retrieval.packages[0].drawing.every((hit) => hit.provesRequirementSatisfied === false), true);
    assert.equal(retrieval.packages[0].drawing[0].region == null || retrieval.packages[0].drawing.some((hit) => hit.region), true);
    for (const hit of retrieval.packages[0].drawing) {
      const source = index.list().find((record) => record.fileName === hit.fileName);
      assert.ok(String(source.text).includes(hit.quote.slice(0, 12).trim()) || source.text.includes("1 HR") || source.text.includes("1-HOUR"));
    }

    const hardened = hardenAnalysisResult(
      {
        issues: [
          {
            severity: "warning",
            category: "Fire Safety",
            title: "Fire rating not shown",
            description: "The wall fire rating is not indicated.",
            codeReference: "IBC 703",
          },
        ],
        summary: {},
        jurisdictionNotes: "",
      },
      "ibc",
      {
        sheetTitle: "A-1.00-00.pdf",
        sheetId: "a100",
        pageText: "FIRST FLOOR PLAN",
        drawingRecords: index.list(),
      },
    );
    assert.equal(hardened.issues.length, 0);
    assert.equal(hardened.rejectedCandidates[0].validationReason, "cross_sheet_supplies_fact");
  });

  it("considers emergency-lighting notes before a missing finding on E-2.1", () => {
    const index = createDrawingIndex();
    index.upsert(sheet("E-2.1-00.pdf", "LIGHTING PLAN EMERGENCY LIGHTING SHALL BE PROVIDED AT EXITS", { sheetId: "e21" }));
    const hits = hybridRetrieveDrawings(index, { topics: ["emergency lighting"], currentSheetId: "other" });
    assert.equal(hits[0].fileName, "E-2.1-00.pdf");
    assert.match(hits[0].quote, /EMERGENCY LIGHTING/);
    assert.equal(hits[0].provesRequirementSatisfied, false);
    const hardened = hardenAnalysisResult(
      {
        issues: [
          {
            title: "Emergency lighting missing",
            description: "Emergency lighting is not shown.",
            category: "Fire Safety",
            severity: "warning",
          },
        ],
        summary: {},
        jurisdictionNotes: "",
      },
      "ibc",
      { sheetTitle: "E-2.1-00.pdf", sheetId: "e21", pageText: "LIGHTING PLAN EMERGENCY LIGHTING SHALL BE PROVIDED AT EXITS" },
    );
    assert.equal(hardened.issues.length, 0);
  });

  it("retrieves equipment schedules for a mechanical sheet and plumbing sheets for P-3.0", () => {
    const index = createDrawingIndex();
    index.upsert(sheet("M-1.1.pdf", "MECHANICAL PLAN", { sheetId: "m11", discipline: "mechanical" }));
    index.upsert(sheet("M-4.1.pdf", "MECHANICAL EQUIPMENT SCHEDULE AHU-1", { sheetId: "m41", discipline: "mechanical" }));
    index.upsert(sheet("P-3.0-00.pdf", "PLUMBING DETAILS", { sheetId: "p30" }));
    index.upsert(sheet("P-2.0-00.pdf", "PLUMBING FIXTURE SCHEDULE WATER HAMMER ARRESTER", { sheetId: "p20" }));
    const mechanical = hybridRetrieveDrawings(index, {
      topics: ["equipment", "schedule"],
      currentSheetId: "m11",
      discipline: "mechanical",
    });
    assert.ok(mechanical.some((hit) => hit.fileName === "M-4.1.pdf"));
    const plumbing = hybridRetrieveDrawings(index, { topics: ["plumbing", "schedule", "water hammer"], currentSheetId: "p30" });
    assert.ok(plumbing.some((hit) => hit.fileName === "P-2.0-00.pdf"));
  });

  it("retrieves architectural sheets before an equipment plan asserts a corridor dimension", () => {
    const index = createDrawingIndex();
    index.upsert(sheet("EQ-1.00-0.pdf", "EQUIPMENT PLAN", { sheetId: "eq" }));
    index.upsert(sheet("A-1.00-00.pdf", 'FLOOR PLAN CORRIDOR 44" CLEAR', { sheetId: "a100" }));
    const hits = hybridRetrieveDrawings(index, { topics: ["corridor", "width"], identifiers: ["A-1.00"], currentSheetId: "eq" });
    assert.equal(hits[0].fileName, "A-1.00-00.pdf");
    assert.match(hits[0].quote, /44/);
  });

  it("matches an exact sheet identifier and keeps specification hits from proving the drawing", () => {
    const index = createDrawingIndex();
    index.upsert(sheet("A-3.02-00.pdf", "DETAIL KH-1 WALL TYPE", { sheetId: "a302" }));
    const exact = hybridRetrieveDrawings(index, { identifiers: ["A-3.02", "KH-1"], topics: [] });
    assert.equal(exact[0].fileName, "A-3.02-00.pdf");
    const prepared = prepareSheetReview({
      sheet: { id: "p30", fileName: "P-3.0-00.pdf", sheet_label: "Plumbing details" },
      pageText: "PLUMBING DETAILS",
      index,
      specChunks: [{ sectionNumber: "22 40 00", sectionTitle: "Plumbing fixtures", text: "Provide water hammer arresters." }],
    });
    const specHits = prepared.retrieval.packages.flatMap((pack) => pack.spec);
    assert.ok(specHits.length >= 1);
    assert.equal(specHits[0].provesDrawing, false);
    assert.equal(specHits[0].embeddingModel, "text-embedding-3-small");
  });

  it("does not return unverified amendment summaries as authoritative code", () => {
    const hits = retrieveCodeProvisions({ topics: ["corridor", "width"], authoritativeOnly: true });
    assert.equal(hits.length, 0);
    const policy = retrieveCodeProvisions({ topics: ["emergency lighting"], authoritativeOnly: false });
    assert.ok(policy.every((hit) => hit.authoritative === false));
    assert.ok(policy.every((hit) => hit.section == null));
  });

  it("uses a vector leg without replacing exact evidence", () => {
    const index = createDrawingIndex();
    index.upsert({ ...sheet("A-9.00.pdf", "UNRELATED NOTE", { sheetId: "far" }), embedding: [1, 0, 0] });
    index.upsert({ ...sheet("E-2.1-00.pdf", "EMERGENCY LIGHTING NOTE", { sheetId: "near" }), embedding: [0, 1, 0] });
    const hits = hybridRetrieveDrawings(index, { topics: ["emergency lighting"], queryEmbedding: [0, 1, 0] });
    assert.equal(hits[0].fileName, "E-2.1-00.pdf");
    assert.equal(hits[0].provenance.legs.vector, true);
  });
});

describe("discipline orchestration", () => {
  it("lets one sheet inform several disciplines and still builds one review package", () => {
    const prepared = prepareSheetReview({
      sheet: { id: "a100", fileName: "A-1.00-00.pdf", sheet_label: "Floor plan" },
      pageText: "FLOOR PLAN",
      contentClass: "floor_plan",
      analysisInstructions: "Look closely at the servery.",
      jurisdictionScope: {
        selectionSource: "explicit",
        selectedScope: "general-ibc",
        enforcedJurisdiction: "general",
        detectedLocation: "dc",
        amendmentsEnforced: false,
      },
    });
    assert.ok(prepared.disciplines.length > 1);
    assert.match(prepared.promptBlock, /does not narrow/i);
    assert.match(prepared.promptBlock, /General IBC|general-ibc/i);
    assert.match(prepared.promptBlock, /servery/i);
    assert.ok(prepared.questions.includes("fire-rated-partition"));
    assert.ok(prepared.rules.some((rule) => rule.ruleId === "fire-rating-tag-on-plan"));
  });

  it("fires the equipment-plan corridor rule without creating a violation", () => {
    const results = evaluateRules({ fileName: "EQ-1.00-0.pdf", pageText: "EQUIPMENT PLAN", contentClass: "drawing" });
    const rule = results.find((item) => item.ruleId === "egress-width-sheet-applicability");
    assert.equal(rule.fired, true);
    assert.equal(rule.authoritative, false);
    assert.notEqual(rule.effect, "violate");
  });
});

describe("graphical rating evidence", () => {
  it("does not confirm a missing fire rating when a crop quote states the hour rating", () => {
    const hardened = hardenAnalysisResult(
      {
        issues: [
          {
            issueTitle: "Fire rating missing",
            description: "The 1-hour partition rating is not shown.",
            location: "A-1.00",
            codeReference: "IBC 716",
            severity: "critical",
            findingType: "missing_information",
          },
        ],
        summary: { overallScore: 40 },
        jurisdictionNotes: "",
      },
      "ibc",
      {
        fileName: "A-1.00-00.pdf",
        pageText: "FLOOR PLAN\n— 1H — ONE HOUR FIRE RATED WALLS",
        observations: [
          {
            element: "fire_rating",
            quote: "— 1H — ONE HOUR FIRE RATED WALLS",
            evidenceType: "ocr_crop",
            extractionMethod: "macos-vision",
          },
        ],
      },
    );
    assert.equal(hardened.issues.length, 0);
    assert.notEqual(hardened.summary.reviewState, "reviewed_clear");
    assert.notEqual(hardened.summary.overallScore, 100);
  });
});
