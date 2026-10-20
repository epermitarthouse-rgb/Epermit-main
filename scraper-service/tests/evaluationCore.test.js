"use strict";

/**
 * Regression cases for the evaluation core: element-bound evidence, evidence states, the
 * two-direction challenge, and the per-check evaluation record. Sheet text is excerpted from a
 * real permit set; sheet names are neutral.
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const {
  parseClaim, boundEvidence, attributeEvidence, evidenceState, relatedSources,
} = require("../app/services/compliance/review/evaluation.js");
const { hardenAnalysisResult } = require("../app/services/compliance/findingQuality.js");
const { scoreDispositions } = require("../scripts/score-review-dispositions.js");
const { buildDrawingChunks, MAX_CHUNKS } = require("../app/services/compliance/rag/drawingIndex.js");

const referenceScope = { status: "conflict", reviewScope: "reference_only" };

function harden(issue, ctx) {
  return hardenAnalysisResult(
    { issues: [issue], checklist: [], summary: {}, jurisdictionNotes: "" },
    "ibc",
    { legalApplicability: referenceScope, ...ctx },
  );
}

function evaluationOf(hardened) {
  return (hardened.issues[0] || hardened.rejectedCandidates[0])?.evaluation;
}

describe("element-bound evidence", () => {
  it("a hood dimension never resolves a counter clearance", () => {
    const claim = parseClaim({ title: "Counter clearance not shown", description: "The clearance at the service counter is not dimensioned.", findingType: "missing_information" });
    assert.equal(claim.element.id, "counter");
    assert.equal(boundEvidence('EXHAUST HOOD 18" CLEARANCE TO COMBUSTIBLES. HOOD MOUNTED 6\'-6" A.F.F.', claim), null);
    assert.ok(boundEvidence('SERVICE COUNTER 36" MIN. CLEARANCE IN FRONT', claim));
  });

  it("a firestop note never establishes a partition rating", () => {
    const claim = parseClaim({ title: "Partition fire rating missing", description: "The fire rating of the corridor partition is not stated.", findingType: "missing_information" });
    assert.equal(claim.element.id, "fire_rated_assembly");
    const firestop = "ALL PENETRATIONS SHALL BE FIRESTOPPED WITH A LISTED 2 HOUR FIRESTOPPING SYSTEM.";
    assert.equal(attributeEvidence([{ text: firestop }], claim).answered, false);
    assert.equal(attributeEvidence([{ text: "1H ONE HOUR FIRE RATED WALLS" }], claim).answered, true);
  });

  it("a door width does not answer a corridor width", () => {
    const claim = parseClaim({ title: "Corridor width unclear", description: "The corridor width is not stated.", findingType: "missing_information" });
    assert.equal(claim.element.id, "egress_path");
    assert.equal(boundEvidence('NEW 33" EGRESS DOOR WIDTH = 165 PERSONS CAPACITY', claim), null);
    assert.ok(boundEvidence('MAINTAIN AISLE AT LEAST 44" WIDE AT PUBLIC AREAS.', claim));
  });

  it("a length is not a width, and a drawing scale is not a dimension", () => {
    const claim = parseClaim({ title: "Egress width missing", description: "The egress path width is not stated.", findingType: "missing_information" });
    assert.equal(boundEvidence("CLEAR SPACE 42' LENGTH OF WHEELCHAIR EGRESS PATH", claim), null);
    assert.equal(boundEvidence('EGRESS PLAN SCALE: 1/4" = 1\'-0" CLEAR', claim), null);
  });

  it("an abbreviation period does not split the clause that binds a value", () => {
    const claim = parseClaim({ title: "Guard height missing", description: "The guard height is not stated.", findingType: "missing_information" });
    assert.ok(boundEvidence("GUARD 3'-6\" MIN. HEIGHT FROM T.O. ROOF DECK", claim));
    assert.ok(boundEvidence("GUARD 3-6 MIN HEIGHT FROM T.O. ROOF DECK", claim), "OCR drops the foot and inch marks");
  });

  it("a specification-only claim is not answered by a cover-sheet scope line", () => {
    const claim = parseClaim({ title: "Sprinkler system details missing", description: "Sprinkler system details are not provided.", findingType: "missing_information" });
    const related = relatedSources(claim, {
      fileName: "FP-9.02.pdf",
      drawingRecords: [
        { fileName: "G-9.00.pdf", text: "SCOPE: PROVIDE A NEW SPRINKLER SYSTEM THROUGHOUT" },
        { fileName: "FP-9.01.pdf", text: "SPRINKLER SYSTEM SHALL BE INSTALLED PER NFPA 13" },
      ],
    });
    assert.deepEqual(related.map((source) => source.sheet), ["FP-9.01.pdf"]);
  });

  it("a sealed penetration is not a signature claim", () => {
    const claim = parseClaim({ title: "Draft stop penetrations", description: "Penetrations through draft stop walls need to be properly sealed." });
    assert.ok(!claim.attributes.includes("signature"));
  });
});

describe("evidence states", () => {
  const missingWidth = parseClaim({ title: "Stair width missing", description: "The stair width is not stated.", findingType: "missing_information" });

  it("an unread graphic leaves absence unestablished", () => {
    const state = evidenceState(missingWidth, { pageText: "STAIR A", graphicalReadStatus: "ocr_unavailable" });
    assert.equal(state.state, "unreadable");
  });

  it("a fully read sheet that names the element and omits the fact is adequate absence", () => {
    const state = evidenceState(missingWidth, { fileName: "A-9.01.pdf", pageText: "STAIR A UP 18 RISERS", graphicalReadStatus: "recognized" });
    assert.equal(state.state, "absent");
    assert.equal(state.adequate, true);
  });

  it("an existing element is a scope question, not an absence", () => {
    const claim = parseClaim({ title: "Stair riser and tread dimensions missing", description: "Riser and tread dimensions are not shown.", findingType: "missing_information" });
    const state = evidenceState(claim, { fileName: "A-9.02.pdf", pageText: "EXISTING STAIR. EXISTING RISERS, TREADS & RAILING TO REMAIN", graphicalReadStatus: "recognized" });
    assert.equal(state.adequate, false);
    assert.equal(state.reason, "existing_element_scope");
  });

  it("a schedule that names the element is not read as missing values", () => {
    const claim = parseClaim({ title: "Ventilation rates missing", description: "Outdoor airflow values are not stated.", findingType: "missing_information" });
    const state = evidenceState(claim, { fileName: "M-9.02.pdf", pageText: "VENTILATION SCHEDULE ZONE OCCUPANCY AREA PEOPLE", graphicalReadStatus: "recognized" });
    assert.equal(state.adequate, false);
    assert.equal(state.reason, "schedule_values_not_bound");
  });
});

describe("challenge and evaluation record", () => {
  it("a guard height stated on the sheet is never published as missing", () => {
    const hardened = harden({
      severity: "warning", findingType: "missing_information", category: "Guards",
      title: "Guardrail height and opening size", description: "The guard height and opening size are not shown on the roof plan.",
      codeReference: "IBC 1015.3",
    }, {
      fileName: "A-9.06.pdf", sheetTitle: "A-9.06 Roof Details", graphicalReadStatus: "recognized",
      pageText: "GUARD 3'-6\" MIN HEIGHT FROM T.O. ROOF DECK. OPENINGS SHALL NOT ALLOW PASSAGE OF A 4\" SPHERE.",
    });
    assert.equal(hardened.issues.length, 0);
    assert.notEqual(evaluationOf(hardened).verification.outcome, "published");
  });

  it("an FDC location is resolved by the fire protection sheet that states it", () => {
    const hardened = harden({
      severity: "warning", findingType: "missing_information", category: "Fire Protection",
      title: "Fire department connection location", description: "The fire department connection location is not shown.",
      codeReference: "IFC 912.2",
    }, {
      fileName: "FP-9.02.pdf", sheetTitle: "FP-9.02 Sprinkler Plan", graphicalReadStatus: "recognized",
      pageText: "SPRINKLER PLAN FIRE DEPARTMENT CONNECTION",
      drawingRecords: [{ fileName: "FP-9.01.pdf", text: "THE FIRE DEPARTMENT CONNECTION (FDC) SHALL BE WALL MOUNTED IN AN ACCESSIBLE LOCATION WITHIN 100' OF A HYDRANT" }],
    });
    const evaluation = evaluationOf(hardened);
    assert.equal(hardened.issues.length, 0);
    assert.equal(evaluation.verification.outcome, "resolved_by_evidence");
    assert.ok(evaluation.related.some((item) => item.sheet === "FP-9.01.pdf"));
  });

  it("a signature cannot be resolved or ruled out from text", () => {
    const hardened = harden({
      severity: "warning", findingType: "missing_information", category: "Structural",
      title: "Special inspections engineer of record signature missing",
      description: "The statement of special inspections is not signed by the engineer of record.",
    }, {
      fileName: "S-9.03.pdf", graphicalReadStatus: "recognized",
      pageText: "SCHEDULE OF SPECIAL INSPECTIONS. SPECIAL INSPECTIONS ENGINEER OF RECORD FIRM ADDRESS TELEPHONE",
    });
    const evaluation = evaluationOf(hardened);
    assert.equal(hardened.issues.length, 0);
    assert.equal(evaluation.verification.outcome, "open_check");
    assert.ok(hardened.summary.limitations.some((item) => item.code === "open_check"));
  });

  it("establishes what two flows mean before comparing them", () => {
    const hardened = harden({
      severity: "critical", findingType: "violation", category: "Plumbing",
      title: "Grease interceptor sizing discrepancy",
      description: "The flow rate to the interceptor is 75 GPM but the fixture flow is 149.70 GPM, so the interceptor is undersized.",
      codeReference: "IPC 1003.3", evidenceTier: "drawing", measurableEvidence: true,
    }, {
      fileName: "P-9.03.pdf", sheetTitle: "P-9.03 Plumbing Details and Schedules", graphicalReadStatus: "recognized",
      pageText: "GREASE INTERCEPTOR GI-1 FLOW RATE CALCULATION: FLOW RATE TO INTERCEPTOR = (LESSER OF FLOW RATE BY PIPE SIZE AND FLOW RATE BY FIXTURES) SIZE OF PIPE CONNECTED TO THE GREASE INTERCEPTOR: 4 IN. DRAINAGE PERIOD: 2 MINUTES FLOW RATE BY PIPE SIZE: 75 GPM FLOW RATE BY FIXTURES, 2-MINUTE DRAINAGE PERIOD: 149.70 GPM",
    });
    const record = hardened.issues[0] || hardened.rejectedCandidates[0];
    assert.notEqual(record.findingType, "violation");
    assert.equal(record.evaluation.calculation.explained, true);
    assert.equal(record.evaluation.calculation.governing.value, 75);
    assert.equal(record.evaluation.verification.reason, "calculation_reconciled");
    assert.match(record.evaluation.verification.detail, /rated for at least 75 gpm/i);
  });

  it("an unexplained pair of values is unresolved, not a discrepancy", () => {
    const hardened = harden({
      severity: "critical", findingType: "violation", category: "Plumbing",
      title: "Grease interceptor sizing discrepancy",
      description: "The flow rate is 75 GPM but the fixture flow is 149.70 GPM, so the interceptor is undersized.",
      codeReference: "IPC 1003.3", evidenceTier: "drawing", measurableEvidence: true,
    }, {
      fileName: "P-9.03.pdf", sheetTitle: "P-9.03 Plumbing Details and Schedules", graphicalReadStatus: "recognized",
      pageText: "GREASE INTERCEPTOR GI-1 FLOW RATE BY PIPE SIZE: 75 GPM FLOW RATE BY FIXTURES: 149.70 GPM",
    });
    const record = hardened.issues[0] || hardened.rejectedCandidates[0];
    assert.equal(record.evaluation.calculation.explained, false);
    assert.notEqual(record.findingType, "violation");
  });

  it("every candidate carries an evaluation and every open check is listed", () => {
    const issues = Array.from({ length: 8 }, (_, index) => ({
      severity: "warning", findingType: "missing_information", category: "Egress",
      title: `Stair ${index} width missing`, description: `The width of stair ${index} is not stated.`,
    }));
    const hardened = hardenAnalysisResult(
      { issues, checklist: [], summary: {}, jurisdictionNotes: "" },
      "ibc",
      { legalApplicability: referenceScope, fileName: "A-9.03.pdf", pageText: "STAIR 0 STAIR 1 STAIR 2", graphicalReadStatus: "ocr_unavailable" },
    );
    const all = [...hardened.issues, ...hardened.rejectedCandidates];
    assert.equal(all.length, issues.length);
    assert.ok(all.every((item) => item.evaluation?.verification?.outcome));
    const open = all.filter((item) => item.evaluation.verification.outcome === "open_check").length;
    const listed = hardened.summary.limitations.filter((item) => item.code === "open_check").length;
    assert.equal(listed, open);
  });
});

describe("drawing index chunks", () => {
  it("covers a 12000-character sheet end to end, including a schedule at the tail", () => {
    const filler = "GENERAL NOTE TEXT ".repeat(640);
    const text = `${filler}GI-1 GREASE INTERCEPTOR SCHEDULE RATED FLOW 50 GPM`;
    const chunks = buildDrawingChunks({ fileName: "P-9.04.pdf", text });
    assert.ok(chunks.length <= MAX_CHUNKS);
    assert.ok(chunks.some((chunk) => /RATED FLOW 50 GPM/.test(chunk.text)));
    for (let index = 1; index < chunks.length; index += 1) {
      assert.ok(chunks[index].charStart <= chunks[index - 1].charEnd, "windows are contiguous");
    }
  });
});

describe("disposition benchmark scorer", () => {
  const truth = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/benchmark/permit-set-82-dispositions.json"), "utf8"));

  it("labels every candidate and only from drawing facts", () => {
    assert.equal(truth.candidates.length, 106);
    for (const label of truth.candidates.filter((item) => item.groundTruth)) {
      assert.ok(truth.facts[label.groundTruth], `candidate ${label.n} cites a recorded drawing fact`);
      assert.ok(label.acceptable.includes(label.expected), `candidate ${label.n} expected is acceptable`);
    }
    const disciplines = new Set(truth.candidates.filter((item) => item.groundTruth).map((item) => item.discipline));
    for (const discipline of ["architectural", "structural", "mechanical", "electrical", "plumbing", "fire_protection", "accessibility"]) {
      assert.ok(disciplines.has(discipline), discipline);
    }
  });

  it("counts a false publication, a wrong resolution, and an ungrounded citation", () => {
    const dispositions = truth.candidates.map((label) => ({
      n: label.n, sheet: `${label.sheet}.pdf`, outcome: label.expected || "open_check", reason: "", detail: "", openReason: "fact_not_found",
    }));
    const set = (n, patch) => Object.assign(dispositions.find((item) => item.n === n), patch);
    set(37, { outcome: "published", reason: "PUBLISHED:evidence_chain" });
    set(26, { outcome: "resolved_by_evidence", detail: "A-9.99.pdf states it" });
    set(66, { outcome: "resolved_by_evidence", detail: "S-201.00.pdf states the location" });
    set(105, { outcome: "published", reason: "PUBLISHED:evidence_chain" });
    const score = scoreDispositions(dispositions, truth);
    assert.deepEqual(score.falsePublications, [37, 105]);
    assert.deepEqual(score.wrongResolutions, [26]);
    assert.ok(score.ungrounded.some((item) => item.n === 66));
    assert.equal(score.withDisposition, 106);
  });
});
