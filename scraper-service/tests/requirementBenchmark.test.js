"use strict";

/**
 * Requirement-level benchmark. Each case names the requirement or objective,
 * the sheet evidence, and the expected outcome. Outcomes:
 *   kept       a genuine gap or concern stays published
 *   rejected   an invalid allegation is withheld and the check closes
 *   open       the candidate is withheld but the check stays a limitation
 *   resolved   another sheet answers the question
 * No case may produce a verified pass without an authoritative requirement.
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { hardenAnalysisResult } = require("../app/services/compliance/findingQuality.js");

const verifiedScope = { status: "verified", reviewScope: "permit_compliance" };
const referenceScope = { status: "conflict", reviewScope: "reference_only" };

function run(issue, ctx, extra = {}) {
  return hardenAnalysisResult(
    { issues: issue ? [issue] : [], checklist: extra.checklist || [], summary: {}, jurisdictionNotes: "" },
    "ibc",
    { legalApplicability: referenceScope, ...ctx },
  );
}

function outcome(hardened) {
  if (hardened.issues.length) return "kept";
  const reason = hardened.rejectedCandidates[0]?.validationReason;
  if (!reason) return "none";
  if (/cross_sheet|answered_on_other_sheet|special_inspection_documented/.test(reason)) return "resolved";
  return hardened.summary.limitations.some((item) => item.code === "open_check") ? "open" : "rejected";
}

const CASES = [
  {
    id: "architecture-egress: exit path claimed on an electrical roof plan",
    discipline: "electrical",
    issue: {
      severity: "warning", findingType: "potential_concern", category: "Egress",
      title: "Lack of clear exit path from roof",
      description: "The roof plan does not indicate a clear and accessible path to an exit.",
      location: "Roof plan", codeReference: "IBC 1011.1",
    },
    ctx: { fileName: "E-9.1.pdf", sheetTitle: "E-9.1.pdf", pageText: "ROOF POWER PLAN RTU-1 DISCONNECT" },
    expected: "rejected",
  },
  {
    id: "architecture-egress: corridor width measured on the floor plan",
    discipline: "architectural",
    issue: {
      severity: "warning", category: "Egress", title: "Corridor width below minimum",
      description: 'Dimension note shows 36" clear, which does not meet the 44" minimum.',
      codeReference: "IBC 1020.2", evidenceTier: "drawing", measurableEvidence: true, location: "Corridor B",
    },
    ctx: { fileName: "A-9.01.pdf", sheetTitle: "A-9.01 Floor Plan", pageText: 'CORRIDOR B 36" CLEAR' },
    expected: "kept",
  },
  {
    id: "accessibility: accessible route claimed on a structural sheet",
    discipline: "structural",
    issue: {
      severity: "warning", findingType: "missing_information", category: "Accessibility",
      title: "Accessible route", description: "The accessible route is not shown.",
      codeReference: "IBC 1104",
    },
    ctx: { fileName: "S-9.01.pdf", sheetTitle: "S-9.01 Framing Plan", pageText: "FRAMING PLAN W12X26" },
    expected: "rejected",
  },
  {
    id: "accessibility: restroom clearance not dimensioned on the plan that draws it",
    discipline: "architectural",
    issue: {
      severity: "warning", category: "Accessibility", title: "Restroom clearance",
      description: "The restroom drawn on this sheet is not dimensioned.",
      codeReference: "IBC 1109", location: "Toilet room A",
    },
    ctx: { fileName: "A-9.02.pdf", sheetTitle: "A-9.02.pdf", contentClass: "floor_plan", pageText: "FIRST FLOOR PLAN RESTROOM TOILET ROOM A" },
    expected: "kept",
  },
  {
    id: "structural: connection details resolved by the structural general notes",
    discipline: "structural",
    issue: {
      severity: "warning", findingType: "potential_concern", category: "Structural",
      title: "Lack of Detailed Connection Specifications",
      description: "The wall sections lack detailed specifications for the connections including types of fasteners.",
      location: "Wall Section 1", codeReference: "IBC 1604.8",
    },
    ctx: {
      fileName: "S-9.20.pdf", sheetTitle: "S-9.20.pdf", pageText: "WALL SECTION 1 WALL SECTION 2",
      drawingRecords: [{
        fileName: "S-9.00.pdf", sheetNumber: "S-9.00",
        text: "STRUCTURAL GENERAL NOTES. ALL CONNECTIONS SHALL BE BOLTED. FASTENERS SHALL BE A325 HIGH STRENGTH BOLTS.",
      }],
    },
    expected: "resolved",
  },
  {
    id: "structural: connection details with no other structural sheet stay a question",
    discipline: "structural",
    issue: {
      severity: "warning", findingType: "potential_concern", category: "Structural",
      title: "Lack of Detailed Connection Specifications",
      description: "The wall sections lack detailed specifications for the connections including types of fasteners.",
      location: "Wall Section 1", codeReference: "IBC 1604.8",
    },
    ctx: { fileName: "S-9.20.pdf", sheetTitle: "S-9.20.pdf", pageText: "WALL SECTION 1 CONNECTION AT TOP PLATE", drawingRecords: [] },
    expected: "kept",
  },
  {
    id: "mechanical: contractor demolition procedures are not a code requirement",
    discipline: "mechanical",
    issue: {
      severity: "advisory", findingType: "potential_concern", category: "Mechanical",
      title: "Incomplete Demolition Information",
      description: "The plan shows units marked for removal but lacks details on protection measures or procedures for safe removal.",
      location: "Throughout the plan", codeReference: "IBC 3303.4",
    },
    ctx: { fileName: "M-9.3.pdf", sheetTitle: "M-9.3.pdf", pageText: "MECHANICAL DEMOLITION PLAN REMOVE EXISTING RTU" },
    expected: "rejected",
  },
  {
    id: "electrical: grounding requirement already stated in the sheet notes",
    discipline: "electrical",
    issue: {
      severity: "advisory", findingType: "potential_concern", category: "Electrical",
      title: "Verification of Equipment Grounding",
      description: "Notes on the sheet indicate that kitchen equipment circuits should include a separate equipment grounding conductor.",
      location: "General Notes", codeReference: "NEC 250.118",
    },
    ctx: { fileName: "E-9.2.pdf", sheetTitle: "E-9.2.pdf", pageText: "ALL KITCHEN EQUIPMENT CIRCUITS SHALL INCLUDE A SEPARATE GREEN INSULATED EQUIPMENT GROUNDING CONDUCTOR" },
    expected: "open",
  },
  {
    id: "electrical: generic cable-management practice names no requirement",
    discipline: "electrical",
    issue: {
      severity: "advisory", findingType: "potential_concern", category: "Electrical",
      title: "Low Voltage Cable Management Specification",
      description: "Cable management does not specify pathways, which may result in non-compliance with standard cable management practices.",
      location: "Low voltage section", codeReference: "IBC 2701.1",
    },
    ctx: { fileName: "E-9.0.pdf", sheetTitle: "E-9.0.pdf", pageText: "LOW VOLTAGE CABLE MANAGEMENT SPECIFICATION" },
    expected: "rejected",
  },
  {
    id: "plumbing: trade coordination note is not a compliance concern",
    discipline: "plumbing",
    issue: {
      severity: "advisory", findingType: "potential_concern", category: "Plumbing",
      title: "Piping Route Coordination",
      description: "Piping routes as shown are general and may vary due to field conditions. Coordination with other trades is needed.",
      location: "General Drawing Notes", codeReference: "IBC 107.3.4",
    },
    ctx: { fileName: "P-9.0.pdf", sheetTitle: "P-9.0.pdf", pageText: "PIPING ROUTES ARE DIAGRAMMATIC. COORDINATE WITH OTHER TRADES." },
    expected: "rejected",
  },
  {
    id: "plumbing: water hammer arrester the sheet already specifies",
    discipline: "plumbing",
    issue: {
      severity: "advisory", findingType: "missing_information", category: "Plumbing",
      title: "Water hammer arrester", description: "Water hammer arresters are not shown.",
      location: "Fixture group",
    },
    ctx: { fileName: "P-9.2.pdf", sheetTitle: "P-9.2 Plumbing Plan", pageText: "PROVIDE WATER HAMMER ARRESTER AT EACH QUICK-CLOSING VALVE" },
    expected: "open",
  },
  {
    id: "fire protection: pipe material question with evidence about another element",
    discipline: "fire_protection",
    issue: {
      severity: "advisory", findingType: "missing_information", category: "Fire Protection",
      title: "Unknown Pipe Material Specification",
      description: "The sprinkler pipe material is not specified.",
      location: "Sprinkler riser detail", codeReference: "NFPA 13",
    },
    ctx: { fileName: "FP-9.3.pdf", sheetTitle: "FP-9.3.pdf", pageText: "MECHANICAL TEE OUTLET SPRINKLER BRANCHLINE 1\" DROP PENDENT SPRINKLER" },
    expected: "open",
  },
  {
    id: "fire protection: guard height on a detail that draws the guard stays a question",
    discipline: "architectural",
    issue: {
      severity: "advisory", findingType: "missing_information", category: "Life Safety",
      title: "Guard rail height verification",
      description: "The guard rail height is not dimensioned on the guard detail.",
      location: "Guard Rail Detail @ High Roof", codeReference: "IBC 1015",
    },
    ctx: { fileName: "A-9.06.pdf", sheetTitle: "A-9.06.pdf", pageText: "GUARD RAIL ELEVATION DETAIL @ HIGH ROOF GUARD RAIL DETAIL" },
    expected: "kept",
  },
  // False-negative guards: a fact on an unrelated discipline's sheet must not silence a genuine question.
  // "open" keeps the check as a listed limitation; "resolved" would close it as answered.
  {
    id: "architecture: guard height is not answered by a number on a fire-protection sheet",
    discipline: "architectural",
    issue: {
      severity: "advisory", findingType: "missing_information", category: "Life Safety",
      title: "Guard rail height verification",
      description: "The guard rail height is not dimensioned on the guard detail.",
      location: "Guard Rail Detail @ High Roof", codeReference: "IBC 1015",
    },
    ctx: {
      fileName: "A-9.06.pdf", sheetTitle: "A-9.06.pdf", pageText: "GUARD RAIL ELEVATION DETAIL @ HIGH ROOF",
      drawingRecords: [{ fileName: "FP-9.00.pdf", sheetNumber: "FP-9.00", text: "SPRINKLER HEADS 42 INCHES BELOW DECK. PIPE GUARD AT RISER." }],
    },
    expected: "kept",
  },
  {
    id: "architecture: plan fire-separation ratings are not answered by an electrical firestopping note",
    discipline: "architectural",
    issue: {
      severity: "advisory", findingType: "missing_information", category: "Fire Safety",
      title: "Lack of Fire Separation Details",
      description: "The plan does not provide readable fire separation ratings or locations.",
      location: "Floor plan", codeReference: "IBC 707",
    },
    // The floor plan names partition types and a legend. It does not name fire
    // separation, a rating, or a location, so the text does not support a published
    // finding that fire-separation information is missing. The electrical note says
    // penetrations of a 1-hour wall are firestopped; it does not locate this plan's
    // separations, so it does not answer the question. The check stays open.
    ctx: {
      fileName: "A-9.05.pdf", sheetTitle: "A-9.05 Floor Plan", contentClass: "floor_plan", pageText: "SECOND FLOOR PLAN PARTITION TYPES SEE LEGEND",
      drawingRecords: [{ fileName: "E-9.10.pdf", sheetNumber: "E-9.10", text: "PENETRATIONS THROUGH 1 HR RATED WALLS SHALL BE FIRESTOPPED." }],
    },
    expected: "open",
  },
  {
    id: "accessibility: service counter is not answered by a mechanical hood dimension",
    discipline: "architectural",
    issue: {
      severity: "advisory", findingType: "missing_information", category: "Accessibility",
      title: "Accessible service counter height",
      description: "The accessible portion of the service counter height is not shown.",
      location: "Service counter", codeReference: "ADA 904.4",
    },
    // The architectural plan names the service counter and does not show its
    // accessible height. The mechanical sheet dimensions an exhaust hood, which
    // is a different element, so the question stays a published finding.
    ctx: {
      fileName: "A-9.12.pdf", sheetTitle: "A-9.12 Floor Plan", contentClass: "floor_plan", pageText: "SERVICE COUNTER SEATING AREA",
      drawingRecords: [{ fileName: "M-9.20.pdf", sheetNumber: "M-9.20", text: 'EXHAUST HOOD 36" ABOVE COUNTER AFF' }],
    },
    expected: "kept",
  },
  // False-positive guards: details already on the owning sheet resolve the question before it is alleged.
  {
    id: "life safety: emergency lighting answered by the electrical lighting plan",
    discipline: "electrical",
    issue: {
      severity: "advisory", findingType: "missing_information", category: "Life Safety",
      title: "Emergency lighting not indicated",
      description: "The floor plan does not indicate emergency lighting along the egress path.",
      location: "Egress corridor", codeReference: "IBC 1008.3",
    },
    ctx: {
      fileName: "A-9.01.pdf", sheetTitle: "A-9.01 Floor Plan", contentClass: "floor_plan", pageText: "FIRST FLOOR PLAN CORRIDOR",
      drawingRecords: [{ fileName: "E-9.21.pdf", sheetNumber: "E-9.21", text: "LIGHTING PLAN. EMERGENCY LIGHTING SHALL BE PROVIDED ALONG THE PATH OF EGRESS." }],
    },
    expected: "resolved",
  },
  {
    id: "architecture: partition rating answered by the same-discipline wall legend",
    discipline: "architectural",
    issue: {
      severity: "warning", category: "Fire Safety", title: "Fire rating not shown",
      description: "The wall fire rating is not indicated.", codeReference: "IBC 703",
    },
    ctx: {
      fileName: "A-9.00.pdf", sheetTitle: "A-9.00.pdf", pageText: "FIRST FLOOR PLAN",
      drawingRecords: [{ fileName: "A-9.60.pdf", sheetNumber: "A-9.60", text: "WALL LEGEND PARTITION TYPE A 1 HR" }],
    },
    expected: "resolved",
  },
  {
    id: "plumbing: insulation answered by the mechanical piping specification",
    discipline: "plumbing",
    issue: {
      severity: "advisory", findingType: "missing_information", category: "Plumbing",
      title: "Missing pipe insulation", description: "Pipe insulation is not shown on this plumbing plan.",
      location: "Domestic water piping",
    },
    ctx: {
      fileName: "P-9.30.pdf", sheetTitle: "P-9.30 Plumbing Plan", pageText: "DOMESTIC WATER PIPING PLAN",
      drawingRecords: [{ fileName: "M-9.41.pdf", sheetNumber: "M-9.41", text: "PIPE INSULATION SHALL BE 1 INCH FIBERGLASS ON ALL DOMESTIC WATER PIPING." }],
    },
    expected: "resolved",
  },
];

describe("requirement-level benchmark", () => {
  for (const testCase of CASES) {
    it(testCase.id, () => {
      const hardened = run(testCase.issue, testCase.ctx);
      assert.equal(outcome(hardened), testCase.expected, JSON.stringify(hardened.rejectedCandidates[0]?.validationReason || null));
      assert.notEqual(hardened.summary.reviewState, "reviewed_clear");
      assert.notEqual(hardened.summary.reviewOutcome, "verified_compliant");
      assert.equal(
        hardened.summary.totalIssues,
        hardened.summary.critical + hardened.summary.warnings + hardened.summary.advisory,
      );
    });
  }

  it("covers every discipline in the benchmark", () => {
    const covered = new Set(CASES.map((testCase) => testCase.discipline));
    for (const discipline of ["architectural", "structural", "mechanical", "electrical", "plumbing", "fire_protection"]) {
      assert.ok(covered.has(discipline), discipline);
    }
    assert.ok(CASES.some((testCase) => /accessib/.test(testCase.id)));
    assert.ok(CASES.some((testCase) => /egress/.test(testCase.id)));
  });

  it("a quoted label with no authoritative requirement is evidence, not a pass", () => {
    const hardened = run(null, { fileName: "A-9.01.pdf", pageText: 'CORRIDOR 44" CLEAR AT GRID B' }, {
      checklist: [{ item: "Corridor width", result: '44" CLEAR AT GRID B' }],
    });
    // Reference-only scope alone does not make the review Partial; it leaves code compliance unverified.
    assert.equal(hardened.summary.reviewState, "reviewed_clear");
    assert.equal(hardened.summary.overallScore, null);
    assert.equal(hardened.summary.reviewOutcome, "no_findings_unverified");
    assert.deepEqual(hardened.summary.assessment, {
      drawingEvidence: "evidence_backed",
      technicalRequirements: "no_concerns_identified",
      codeVerification: "unverified",
      applicability: "reference_only",
    });
    assert.ok(hardened.summary.limitations.some((item) => item.code === "no_authoritative_requirement"));
    assert.ok(hardened.summary.limitations.some((item) => item.code === "reference_only_scope"));
  });

  it("verifies a pass only with an authoritative requirement and matching evidence", () => {
    const hardened = run(null, {
      fileName: "A-9.01.pdf",
      pageText: 'CORRIDOR 44" CLEAR AT GRID B',
      legalApplicability: verifiedScope,
      authoritativeCode: [{ authoritative: true, supportsConfirmedViolation: true, text: "The minimum corridor width shall be 44 inches." }],
    }, { checklist: [{ item: "Corridor width", result: '44" CLEAR AT GRID B' }] });
    assert.equal(hardened.summary.reviewState, "reviewed_clear");
    assert.equal(hardened.summary.reviewOutcome, "verified_compliant");
    assert.equal(hardened.summary.overallScore, 100);
  });

  it("a withheld check that only restates a requirement is never proof of compliance", () => {
    const hardened = run(CASES.find((c) => c.discipline === "electrical" && c.expected === "open").issue, {
      fileName: "E-9.2.pdf",
      pageText: "ALL KITCHEN EQUIPMENT CIRCUITS SHALL INCLUDE A SEPARATE GREEN INSULATED EQUIPMENT GROUNDING CONDUCTOR",
      legalApplicability: verifiedScope,
      authoritativeCode: [{ authoritative: true, supportsConfirmedViolation: true, text: "Equipment grounding conductor shall be installed." }],
    }, { checklist: [{ item: "Grounding", result: "SEPARATE GREEN INSULATED EQUIPMENT GROUNDING CONDUCTOR" }] });
    assert.equal(hardened.issues.length, 0);
    assert.equal(hardened.summary.reviewState, "reviewed_partial");
    assert.equal(hardened.summary.reviewOutcome, "verification_incomplete");
    assert.equal(hardened.summary.assessment.technicalRequirements, "checks_unresolved");
    assert.ok(hardened.summary.limitations.some((item) => /not proof of compliance/.test(item.detail)));
  });

  it("counts every published severity, including warning-level questions", () => {
    const hardened = hardenAnalysisResult(
      {
        issues: [{
          severity: "warning", findingType: "potential_concern", category: "Egress",
          title: "Unclear Egress Path",
          description: "The demolition plan does not clearly indicate the maintained egress paths during demolition.",
          location: "Mezzanine Floor Demolition Plan", codeReference: "IBC 3310",
        }],
        summary: {},
        jurisdictionNotes: "",
      },
      "local",
      { fileName: "D-9.01.pdf", sheetTitle: "D-9.01.pdf", pageText: "MEZZANINE FLOOR DEMOLITION PLAN EXIT STAIR EGRESS PATH" },
    );
    assert.equal(hardened.summary.totalIssues, hardened.issues.length);
    assert.equal(
      hardened.summary.totalIssues,
      hardened.summary.critical + hardened.summary.warnings + hardened.summary.advisory,
    );
  });
});
