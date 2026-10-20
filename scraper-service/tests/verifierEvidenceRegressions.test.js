"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { decideCandidate } = require("../app/services/compliance/review/verifier.js");
const { OPEN_CHECK_REJECTIONS, hardenIssues } = require("../app/services/compliance/findingQuality.js");

const unreadableRegion = { readable: false, quote: null, limitations: "ocr_unavailable", reason: "graphic" };

function ctxFor(fileName, pageText, extra = {}) {
  return {
    fileName,
    sheetTitle: fileName,
    pageText,
    corpus: pageText,
    regions: [],
    observations: [],
    drawingRecords: [],
    sheetIndex: [],
    projectType: "commercial",
    ...extra,
  };
}

function issue(fields) {
  return {
    id: "issue-1",
    category: "General",
    severity: "advisory",
    findingType: "potential_concern",
    codeReference: "",
    location: "",
    ...fields,
  };
}

describe("explicit code edition on the source document", () => {
  it("rejects a finding whose claimed edition contradicts the readable certificate", () => {
    const decision = decideCandidate(
      issue({
        title: "Inconsistent Energy Code Reference",
        description: "The COMcheck certificate references the 2012 IECC, which is not the adopted energy code.",
        category: "Energy",
      }),
      ctxFor("EN-1.00.pdf", "COMCHECK ENVELOPE COMPLIANCE CERTIFICATE Energy Code: 2017 DC Energy Conservation Code", {
        legalApplicability: { adoptedEdition: "District of Columbia Construction Codes 2017" },
      }),
    );
    assert.equal(decision.disposition, "reject");
    assert.equal(decision.reason, "code_edition_contradicted");
    assert.match(decision.detail, /2017 DC Energy Conservation Code/);
    assert.equal(OPEN_CHECK_REJECTIONS.has(decision.reason), false);
  });

  it("rejects a claimed edition that appears nowhere in the readable evidence", () => {
    const decision = decideCandidate(
      issue({
        title: "Inconsistent Energy Code Reference",
        description: "The sheet cites the 2012 IECC for envelope compliance.",
        category: "Energy",
      }),
      ctxFor("EN-1.00.pdf", "JET ENERGY COMPLIANCE EN-1.00 REVISED PERMIT SET", { regions: [unreadableRegion] }),
    );
    assert.equal(decision.reason, "code_edition_not_in_evidence");
  });

  it("keeps a finding whose cited edition is printed on the sheet", () => {
    const decision = decideCandidate(
      issue({
        title: "Envelope compliance path",
        description: "The certificate cites the 2017 DC Energy Conservation Code but the wall U-factor exceeds the listed maximum.",
        category: "Energy",
      }),
      ctxFor("EN-1.00.pdf", "COMCHECK Energy Code: 2017 DC Energy Conservation Code WALL U-FACTOR 0.064"),
    );
    assert.notEqual(decision.reason, "code_edition_contradicted");
    assert.notEqual(decision.reason, "code_edition_not_in_evidence");
  });
});

describe("requirement reminders and specific unresolved conditions", () => {
  const egressSheet =
    "SCALE: 4 TRAVEL DISTANCE CALCULATION N.T.S. SCALE: 6 DOOR/ STAIR CAPACITY & NOTES N.T.S. EGRESS CAPACITY OF DOOR#1 OCCUPANCY CALCULATIONS";

  it("withdraws a reminder that names no fact the sheet lacks", () => {
    const decision = decideCandidate(
      issue({
        title: "Egress Path Clarity",
        description: "The egress path must be clearly marked and maintained free of obstructions.",
        category: "Egress",
      }),
      ctxFor("A-1.04.pdf", egressSheet),
    );
    assert.equal(decision.disposition, "reject");
    assert.equal(decision.reason, "no_specific_condition");
    assert.equal(OPEN_CHECK_REJECTIONS.has(decision.reason), false);
  });

  it("keeps a reminder that names an unstated fact as an unresolved check, never a finding", () => {
    const decision = decideCandidate(
      issue({
        title: "Potential Inaccessibility of Egress Routes",
        description: "Egress routes must provide required door clearances and ramp slopes if present.",
        category: "Egress",
        findingType: "missing_information",
      }),
      ctxFor("A-1.04.pdf", egressSheet),
    );
    assert.equal(decision.reason, "requirement_reminder");
    assert.ok(OPEN_CHECK_REJECTIONS.has(decision.reason));
    assert.match(decision.detail, /clearance/);
    assert.doesNotMatch(decision.detail, /slope/);
  });

  it("publishes a discrepancy between two values printed on the sheet", () => {
    const decision = decideCandidate(
      issue({
        title: "Grease Interceptor Sizing Verification Required",
        description:
          "The flow rate used to select the grease interceptor is noted as 75 GPM, which requires verification against the calculated flow rate of 149.70 GPM for a 2-minute drainage period.",
        category: "Plumbing",
      }),
      ctxFor(
        "P-3.0.pdf",
        "GREASE INTERCEPTOR SIZING FLOW RATE BY PIPE SIZE: 75 GPM FLOW RATE BY FIXTURES, 2-MINUTE DRAINAGE PERIOD: 149.70 GPM NOTES: THE GREASE INTERCEPTOR SHALL BE SIZED PER THE PLUMBING CODE",
      ),
    );
    assert.equal(decision.disposition === "reject", false, `${decision.reason}: ${decision.detail}`);
  });
});

describe("cross-sheet reconciliation", () => {
  const question = () =>
    issue({
      title: "Accessibility Route Information Missing",
      description: "The accessible route width and turning space are not shown on this floor plan.",
      category: "Accessibility",
      findingType: "missing_information",
      codeReference: "IBC 1104",
    });
  const plan = "SCALE: 1 FLOOR PLAN 1/4\" = 1'-0\" DINING SEATING COUNTER ACCESSIBLE ROUTE";
  const record = (fileName, text) => ({ fileName, sheetNumber: fileName.replace(/\.pdf$/, ""), pageNumber: 1, text });
  const outcome = (records) => {
    const result = hardenIssues([question()], {
      ...ctxFor("A-1.01.pdf", plan, { drawingRecords: records }),
      codeType: "ibc",
    });
    const rejected = result.rejectedCandidates || [];
    return { published: result.issues.length, reasons: rejected.map((item) => item.validationReason) };
  };

  it("a sheet that shares only generic words does not answer the question", () => {
    const { reasons } = outcome([record("A-4.02.pdf", "ACCESSIBLE SEATING (5% OF TOTAL SEATS REQUIRED) 1 REQUIRED 1 PROVIDED")]);
    assert.ok(!reasons.includes("cross_sheet_supplies_fact"), reasons.join(","));
    assert.ok(!reasons.includes("cross_sheet_answers_question"), reasons.join(","));
  });

  it("a same-discipline sheet that states the measured fact answers it", () => {
    const decision = decideCandidate(
      issue({
        title: "Accessible Route Width Not Shown",
        description: 'The 44" clear width of the accessible route is not shown on this floor plan.',
        category: "Accessibility",
        findingType: "missing_information",
      }),
      ctxFor("A-1.01.pdf", plan, {
        drawingRecords: [record("A-1.05.pdf", "ACCESSIBLE ROUTE: 44\" MIN CLEAR WIDTH AT ACCESSIBLE ROUTE TO RESTROOMS")],
      }),
    );
    assert.equal(decision.disposition, "reject");
    assert.equal(decision.reason, "cross_sheet_answers_question");
    assert.match(decision.detail, /A-1\.05/);
  });
});

describe("graphic-only evidence stays an unresolved check", () => {
  it("does not publish a missing rating when the detail is titled but its body is unreadable", () => {
    const decision = decideCandidate(
      issue({
        title: "Missing Fire-Resistance Rating for Wall Section",
        description: "The wall section does not indicate the fire-resistance rating of the assembly.",
        category: "Fire",
        findingType: "missing_information",
      }),
      ctxFor(
        "A-3.03.pdf",
        "Wash DC_SECTIONS.DWG 10/15/26 A-3.03-00 WALL SECTIONS SCALE: 1 WALL SECTION @ RIGHT SIDE ENTRY 3/4\" = 1'-0\" SCALE: 5 CANOPY DETAIL",
        { regions: [unreadableRegion, unreadableRegion] },
      ),
    );
    assert.equal(decision.disposition, "reject");
    assert.equal(decision.reason, "detail_unreadable");
    assert.ok(OPEN_CHECK_REJECTIONS.has(decision.reason));
  });

  it("does not publish a fire damper question when no rated assembly is evidenced", () => {
    const decision = decideCandidate(
      issue({
        title: "Missing Fire Damper in Mechanical Ductwork",
        description: "Fire dampers are not shown where the ductwork penetrates fire-rated assemblies.",
        category: "Mechanical",
        findingType: "missing_information",
      }),
      ctxFor("MD-1.2.pdf", "MEZZANINE PLAN - MECHANICAL DEMOLITION (D) SUPPLY AND RETURN DUCTWORK FROM RTU TO REMAIN"),
    );
    assert.equal(decision.reason, "rated_assembly_unconfirmed");
    assert.ok(OPEN_CHECK_REJECTIONS.has(decision.reason));
  });
});
