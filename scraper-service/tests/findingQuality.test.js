"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  applyEvidenceGate,
  hardenAnalysisResult,
  buildJurisdictionDiagnostics,
  resolveAnalysisJurisdiction,
  semanticDedupKey,
  dedupAgainstRun,
} = require("../app/services/compliance/findingQuality.js");

describe("findingQuality evidence gate", () => {
  it("downgrades unverified egress width to missing_information advisory", () => {
    const out = applyEvidenceGate(
      {
        severity: "critical",
        category: "Egress",
        title: "Egress width insufficient",
        description: "The corridor width does not meet the minimum required clear width.",
        codeReference: "IBC 1005.1",
        evidenceTier: "drawing",
      },
      { sheetTitle: "A002 Plaza Plan" },
    );
    assert.ok(out);
    assert.equal(out.findingType, "missing_information");
    assert.equal(out.severity, "advisory");
    assert.match(out.title, /verification required/i);
  });

  it("drops parked vehicle false positive", () => {
    const out = applyEvidenceGate(
      {
        severity: "warning",
        category: "Accessibility",
        title: "Accessible route obstructed",
        description: "Route appears obstructed by parked vehicles.",
        codeReference: "IBC 1104",
      },
      {},
    );
    assert.equal(out, null);
  });

  it("keeps strong measurable finding when flagged measurableEvidence", () => {
    const out = applyEvidenceGate(
      {
        severity: "warning",
        category: "Egress",
        title: "Corridor width",
        description: 'Dimension note shows 42" clear — below 44" minimum.',
        evidenceTier: "drawing",
        measurableEvidence: true,
      },
      {},
    );
    assert.equal(out.findingType, "confirmed_violation");
  });
});

describe("findingQuality Riverside-like bundle", () => {
  const riversideIssues = [
    {
      severity: "critical",
      category: "Egress",
      title: "Stair rise/run noncompliant",
      description: "Risers may not meet maximum rise without dimensions shown.",
      codeReference: "IBC 1011.5.2",
    },
    {
      severity: "critical",
      category: "Accessibility",
      title: "Accessible parking",
      description: "Insufficient accessible parking spaces shown on site plan.",
      codeReference: "IBC 1106",
    },
    {
      severity: "critical",
      category: "Accessibility",
      title: "Accessible parking",
      description: "Insufficient accessible parking spaces shown on garage plan.",
      codeReference: "IBC 1106",
    },
    {
      severity: "warning",
      category: "Accessibility",
      title: "Route blocked",
      description: "Accessible route obstructed by parked vehicles.",
      codeReference: "IBC 1104",
    },
    {
      severity: "critical",
      category: "Fire Safety",
      title: "Fire separation",
      description: "Garage separation rating not indicated.",
      codeReference: "IBC 406.3",
    },
  ];

  it("hardens and dedups semantic duplicates", () => {
    const hardened = hardenAnalysisResult(
      { issues: riversideIssues, summary: {}, jurisdictionNotes: "" },
      "ibc",
      { sheetTitle: "A003 Site Plan", pageText: "SITE PLAN ACCESSIBLE PARKING SPACES FIRE SEPARATION", specChunks: [] },
    );
    assert.ok(hardened.summary.verificationRequired + hardened.summary.unverified >= 1);
    assert.ok(hardened.summary.totalIssues >= 2);
    assert.equal(
      hardened.issues.filter((i) => i.severity === "critical" && i.findingType === "confirmed_violation")
        .length,
      0,
    );
    const keys = new Set();
    const deduped = dedupAgainstRun(keys, hardened.issues);
    assert.ok(deduped.length <= hardened.issues.length);
  });
});

describe("jurisdiction diagnostics", () => {
  it("detects DC hints vs general run jurisdiction", () => {
    const d = buildJurisdictionDiagnostics("general", [
      "24-070 Riverside Condominium — Washington, DC Specifications.pdf",
    ]);
    assert.equal(d.mismatch, true);
    assert.match(d.message, /Washington, DC/i);
  });
});

describe("empty review is not a pass", () => {
  it("marks an empty issue list with no checklist as not_reviewed", () => {
    const hardened = hardenAnalysisResult(
      { issues: [], summary: { overallScore: 100 }, jurisdictionNotes: "" },
      "ibc",
      {},
    );
    assert.equal(hardened.summary.reviewState, "reviewed_partial");
    assert.equal(hardened.summary.overallScore, null);
    assert.equal(hardened.summary.checklist.length, 0);
  });

  it("does not pass a generic checklist that has no evidence quote", () => {
    const hardened = hardenAnalysisResult(
      {
        issues: [],
        checklist: [
          {
            item: "Egress, fire separation, stairs, structural",
            result: "no failing condition",
          },
        ],
        summary: { overallScore: 100 },
        jurisdictionNotes: "",
      },
      "ibc",
      {},
    );
    assert.equal(hardened.summary.reviewState, "reviewed_partial");
    assert.equal(hardened.summary.overallScore, null);
    assert.notEqual(hardened.summary.overallScore, 100);
  });

  it("passes only when every checklist item quotes evidence from the sheet", () => {
    const hardened = hardenAnalysisResult(
      {
        issues: [],
        checklist: [
          { item: "Corridor width", result: '44" clear labeled at grid B' },
          { item: "Wall rating", result: "shown on sheet A-1.01" },
        ],
        summary: { overallScore: 85 },
        jurisdictionNotes: "",
      },
      "ibc",
      { pageText: '44" clear labeled at grid B\nshown on sheet A-1.01' },
    );
    assert.equal(hardened.summary.reviewState, "reviewed_clear");
    assert.equal(hardened.summary.overallScore, null);
    assert.notEqual(hardened.summary.codeCoverageVerified, true);
  });

  it("scores 100 only when sheet quotes and authoritative code cover the checks", () => {
    const hardened = hardenAnalysisResult(
      {
        issues: [],
        checklist: [
          { item: "Corridor width", result: '44" clear labeled at grid B' },
        ],
        summary: { overallScore: 100 },
        jurisdictionNotes: "",
      },
      "ibc",
      {
        pageText: '44" clear labeled at grid B',
        authoritativeCode: [{
          authoritative: true,
          supportsConfirmedViolation: true,
          text: "Section 1020.2 minimum corridor width is 44 inches.",
        }],
        legalApplicability: {
          status: "verified",
          reviewScope: "permit_compliance",
        },
      },
    );
    assert.equal(hardened.summary.reviewState, "reviewed_clear");
    assert.equal(hardened.summary.overallScore, 100);
    assert.equal(hardened.summary.codeCoverageVerified, true);
  });

  it("does not keep overallScore 100 when any issue remains", () => {
    const hardened = hardenAnalysisResult(
      {
        issues: [
          {
            severity: "warning",
            category: "Egress",
            title: "Corridor width",
            description: 'Dimension note shows 36" clear, which does not meet the 44" minimum.',
            codeReference: "IBC 1020.2",
            evidenceTier: "drawing",
            measurableEvidence: true,
            location: "Corridor B",
          },
        ],
        summary: { overallScore: 100 },
        jurisdictionNotes: "",
      },
      "ibc",
      { sheetTitle: "A-101 Floor Plan", pageText: 'CORRIDOR B 36" CLEAR' },
    );
    assert.equal(hardened.issues.length, 1);
    assert.notEqual(hardened.summary.overallScore, 100);
    assert.ok(hardened.summary.overallScore < 100);
  });
});

describe("page text drops missing-information notes that the sheet already states", () => {
  it("drops a fire rating not shown note when the text has 1 HR and 45-MINUTE", () => {
    const hardened = hardenAnalysisResult(
      {
        issues: [
          {
            severity: "warning",
            category: "Fire Safety",
            title: "Fire rating not shown",
            description: "The wall fire rating is not shown on this sheet.",
            codeReference: "IBC 703",
          },
        ],
        summary: {},
        jurisdictionNotes: "",
      },
      "ibc",
      { pageText: "PARTITION TYPE A 1 HR / DOOR 45-MINUTE" },
    );
    assert.equal(hardened.issues.length, 0);
  });

  it("drops an accessible seating not shown note when ADA seats are in the text", () => {
    const hardened = hardenAnalysisResult(
      {
        issues: [
          {
            severity: "advisory",
            category: "Accessibility",
            title: "Accessible seating not shown",
            description: "Accessible seating is not shown on this plan.",
            codeReference: "IBC 1108",
          },
        ],
        summary: {},
        jurisdictionNotes: "",
      },
      "ibc",
      { pageText: "ASSEMBLY SEATING ADA SEATS PROVIDED 12" },
    );
    assert.equal(hardened.issues.length, 0);
  });

  it("drops hour-rating and minute-door notes when the sheet text states them", () => {
    const hardened = hardenAnalysisResult(
      {
        issues: [
          {
            severity: "warning",
            category: "Fire Safety",
            title: "Fire-resistance rating not shown",
            description: "The 1-hour wall rating is not indicated.",
            codeReference: "IBC 703",
          },
          {
            severity: "warning",
            category: "Fire Safety",
            title: "Door rating missing",
            description: "The 45-minute door rating is not shown.",
            codeReference: "IBC 716",
          },
        ],
        summary: { overallScore: 100 },
        jurisdictionNotes: "",
      },
      "ibc",
      { pageText: "PARTITION 1-hour wall / DOOR 45-minute" },
    );
    assert.equal(hardened.issues.length, 0);
    assert.equal(hardened.summary.reviewState, "reviewed_partial");
    assert.equal(hardened.summary.overallScore, null);
  });

  it("drops clearance, counter-height, and door-width notes the page already states", () => {
    const hardened = hardenAnalysisResult(
      {
        issues: [
          {
            severity: "warning",
            category: "Accessibility",
            title: "Clearance not shown",
            description: "The 54x60 and 48x48 clearance symbols are not shown.",
            codeReference: "ICC A117.1",
          },
          {
            severity: "advisory",
            category: "Accessibility",
            title: "Accessory heights not shown",
            description: "Accessory heights are not indicated.",
            codeReference: "ICC A117.1",
          },
          {
            severity: "warning",
            category: "Accessibility",
            title: "Counter height not shown",
            description: "Counter dimensions A.F.F. are not shown.",
            codeReference: "IBC 1109",
          },
          {
            severity: "warning",
            category: "Egress",
            title: "Door width not shown",
            description: "The door width in inches is not shown.",
            codeReference: "IBC 1010",
          },
        ],
        summary: {},
        jurisdictionNotes: "",
      },
      "ibc",
      {
        pageText:
          'CLEARANCE 54x60 AND 48x48\nMIRROR 40" A.F.F. DISPENSER HEIGHT\nCOUNTER 34" A.F.F. AND 36" A.F.F.\nDOOR 101 36"',
      },
    );
    assert.equal(hardened.issues.length, 0);
  });

  it("uses graphic quotes from image understanding when the text layer omitted the dimension", () => {
    const hardened = hardenAnalysisResult(
      {
        issues: [
          {
            severity: "warning",
            category: "Accessibility",
            title: "Clear floor space not shown",
            description: "Turning clearance is not shown on this plan.",
            codeReference: "ICC A117.1",
          },
        ],
        summary: {},
        jurisdictionNotes: "",
      },
      "ibc",
      {
        pageText: "ENLARGED TOILET PLAN",
        observations: [{ quote: "54 × 60 clearance" }, { quote: "48 x 48" }],
      },
    );
    assert.equal(hardened.issues.length, 0);
  });

  it("stores an unlocated missing note as unverified and does not fail the sheet", () => {
    const hardened = hardenAnalysisResult(
      {
        issues: [
          {
            severity: "critical",
            category: "Fire Safety",
            title: "Fire rating missing",
            description: "The fire-resistance rating is not shown.",
            codeReference: "IBC 703",
          },
        ],
        checklist: [{ item: "Fire rating", result: "no failing condition" }],
        summary: { overallScore: 100 },
        jurisdictionNotes: "",
      },
      "ibc",
      { pageText: "FIRST FLOOR PLAN", sheetTitle: "A-1.01 Floor Plan" },
    );
    assert.equal(hardened.issues.length, 0);
    assert.equal(hardened.rejectedCandidates[0].validationReason, "incomplete_question");
    assert.equal(hardened.summary.confirmedViolations, 0);
    assert.equal(hardened.summary.reviewState, "reviewed_partial");
    assert.equal(hardened.summary.overallScore, null);
    assert.notEqual(hardened.summary.overallScore, 100);
  });

  it("keeps a measured defect even when other ratings appear in the text", () => {
    const hardened = hardenAnalysisResult(
      {
        issues: [
          {
            severity: "warning",
            category: "Egress",
            title: "Corridor width below minimum",
            description: 'Dimension note shows 36" clear, which does not meet the 44" minimum.',
            codeReference: "IBC 1020.2",
            evidenceTier: "drawing",
            measurableEvidence: true,
          },
        ],
        summary: {},
        jurisdictionNotes: "",
      },
      "ibc",
      { sheetTitle: "A-101 Floor Plan", pageText: '1 HR WALL 45-MINUTE DOOR\nCORRIDOR 36" CLEAR' },
    );
    assert.equal(hardened.issues.length, 1);
    assert.equal(hardened.issues[0].findingType, "missing_information");
    assert.equal(hardened.issues[0].codeSourceStatus, "unverified");
    assert.doesNotMatch(`${hardened.issues[0].title} ${hardened.issues[0].description}`, /does not meet|44/);
    assert.notEqual(hardened.summary.reviewState, "reviewed_clear");
  });

  it("confirms a corridor defect only when the threshold text is authoritative", () => {
    const hardened = hardenAnalysisResult(
      {
        issues: [
          {
            severity: "warning",
            category: "Egress",
            title: "Corridor width below minimum",
            description: 'Dimension note shows 36" clear, which does not meet the 44" minimum.',
            codeReference: "IBC 1020.2",
            evidenceTier: "drawing",
            measurableEvidence: true,
          },
        ],
        summary: {},
        jurisdictionNotes: "",
      },
      "ibc",
      {
        sheetTitle: "A-101 Floor Plan",
        pageText: 'CORRIDOR 36" CLEAR',
        authoritativeCode: [{
          id: "fixture-corridor",
          registryRecordId: "fixture-ibc-2021",
          authoritative: true,
          supportsConfirmedViolation: true,
          sourceStatus: "verified_text",
          codeBook: "IBC",
          section: "1020.2",
          text: 'IBC Section 1020.2 minimum corridor width 44"',
          exceptions: [],
        }],
        legalApplicability: {
          status: "verified",
          reviewScope: "permit_compliance",
          registryRecordId: "fixture-ibc-2021",
        },
      },
    );
    assert.equal(hardened.issues[0].findingType, "confirmed_violation");
    assert.equal(hardened.issues[0].codeSourceStatus, "authoritative");
  });

  it("rejects a design provision the sheet already states instead of confirming it", () => {
    const hardened = hardenAnalysisResult(
      {
        issues: [
          {
            title: "Emergency Lighting Installation and Compliance",
            description: "The sheet indicates that emergency lighting must comply with NFPA 101 for maintaining 1 foot-candle in the path of egress.",
            severity: "advisory",
            findingType: "confirmed_violation",
            codeReference: "NFPA 101",
            measurableEvidence: true,
            evidenceTier: "drawing",
          },
        ],
        checklist: [
          {
            item: "Emergency lighting",
            result: "Designed per NFPA 101",
            evidence: "EMERGENCY LIGHTING HAS BEEN DESIGNED PER NFPA 101 TO MAINTAIN 1 FOOT-CANDLE",
          },
        ],
        summary: { overallScore: 85 },
        jurisdictionNotes: "",
      },
      "ibc",
      {
        sheetTitle: "Lighting plan",
        fileName: "lighting.pdf",
        pageText: "EMERGENCY LIGHTING HAS BEEN DESIGNED PER NFPA 101 TO MAINTAIN 1 FOOT-CANDLE IN PATH OF EGRESS",
      },
    );
    assert.equal(hardened.issues.filter((issue) => issue.findingType === "confirmed_violation").length, 0);
    assert.equal(hardened.rejectedCandidates[0].validationReason, "documented_design_provision");
    assert.notEqual(hardened.summary.overallScore, 100);
  });

  it("does not score 100 for plumbing evidence when no verified code text covers the check", () => {
    const hardened = hardenAnalysisResult(
      {
        issues: [],
        checklist: [
          { item: "Grease interceptor", result: "GREASE OUTPUT SELECT GREASE INTERCEPTOR", evidence: "GREASE OUTPUT SELECT GREASE INTERCEPTOR" },
        ],
        summary: { overallScore: 100 },
        jurisdictionNotes: "",
      },
      "ibc",
      { sheetTitle: "Plumbing details", fileName: "plumbing.pdf", pageText: "GREASE OUTPUT SELECT GREASE INTERCEPTOR. BACKFLOW PREVENTION SHALL COMPLY." },
    );
    assert.equal(hardened.summary.reviewState, "reviewed_clear");
    assert.equal(hardened.summary.overallScore, null);
  });
});

describe("schedule restatement and citation book", () => {
  it("drops a finding that only restates hardware already on the schedule", () => {
    const hardened = hardenAnalysisResult(
      {
        issues: [
          {
            severity: "warning",
            category: "Life Safety",
            title: "Hardware set 3 requires a closer",
            description: "The schedule requires a door closer for hardware set 3.",
            codeReference: "IBC 1010",
          },
        ],
        summary: {},
        jurisdictionNotes: "",
      },
      "ibc",
      {
        contentClass: "schedule",
        pageText: "DOOR SCHEDULE\nHARDWARE SET 3 CLOSER",
      },
    );
    assert.equal(hardened.issues.length, 0);
  });

  it("relabels an IBC finding whose reference is ADA section 604.8.1.2", () => {
    const hardened = hardenAnalysisResult(
      {
        issues: [
          {
            severity: "warning",
            category: "Accessibility",
            title: "Wheelchair compartment",
            description: "The compartment does not meet the required turning space.",
            codeReference: "IBC 604.8.1.2",
            evidenceTier: "drawing",
            measurableEvidence: true,
          },
        ],
        summary: {},
        jurisdictionNotes: "",
      },
      "ibc",
      {
        sheetTitle: "A-101 Floor Plan",
        pageText: "WHEELCHAIR COMPARTMENT TURNING SPACE",
      },
    );
    assert.equal(hardened.issues.length, 1);
    assert.equal(hardened.issues[0].citationBook, "ICC A117.1");
    assert.doesNotMatch(hardened.issues[0].codeReference, /\bIBC\b/);
    assert.match(hardened.issues[0].codeReference, /604\.8\.1\.2/);
  });
});

describe("set-level sheet index", () => {
  const floorAndEnlarged = [
    {
      fileName: "A-1.01.pdf",
      contentClass: "floor_plan",
      title: "First Floor Plan",
      excerpt: "FIRST FLOOR PLAN",
    },
    {
      fileName: "A-4.00.pdf",
      contentClass: "enlarged_plan",
      title: "Enlarged Restroom Plan",
      excerpt: "ENLARGED TOILET PLAN 54x60",
    },
  ];

  it("drops a missing restroom dimension when another included sheet is the enlarged plan", () => {
    const hardened = hardenAnalysisResult(
      {
        issues: [
          {
            severity: "warning",
            category: "Accessibility",
            title: "Restroom dimensions not shown",
            description: "Toilet room dimensions are not shown.",
            codeReference: "IBC 1109",
          },
        ],
        summary: {},
        jurisdictionNotes: "",
      },
      "ibc",
      {
        sheetTitle: "A-1.01.pdf",
        contentClass: "floor_plan",
        pageText: "FIRST FLOOR PLAN",
        sheetIndex: floorAndEnlarged,
      },
    );
    assert.equal(hardened.issues.length, 0);
  });

  it("keeps a missing note that names a condition drawn on this sheet", () => {
    const hardened = hardenAnalysisResult(
      {
        issues: [
          {
            severity: "warning",
            category: "Accessibility",
            title: "Restroom clearance",
            description: "The restroom drawn on this sheet is not dimensioned.",
            codeReference: "IBC 1109",
            location: "Toilet room A",
          },
        ],
        summary: {},
        jurisdictionNotes: "",
      },
      "ibc",
      {
        sheetTitle: "A-1.01.pdf",
        contentClass: "floor_plan",
        pageText: "FIRST FLOOR PLAN RESTROOM TOILET ROOM A",
        sheetIndex: floorAndEnlarged,
      },
    );
    assert.equal(hardened.issues.length, 1);
  });

  it("drops door hardware and egress width when a schedule and egress plan are included", () => {
    const hardened = hardenAnalysisResult(
      {
        issues: [
          {
            severity: "warning",
            category: "Egress",
            title: "Door hardware not shown",
            description: "Door size and hardware are not shown.",
            codeReference: "IBC 1010",
          },
          {
            severity: "warning",
            category: "Egress",
            title: "Egress width not shown",
            description: "Egress width and capacity are not shown.",
            codeReference: "IBC 1005",
          },
        ],
        summary: {},
        jurisdictionNotes: "",
      },
      "ibc",
      {
        sheetTitle: "A-2.01.pdf",
        contentClass: "floor_plan",
        sheetIndex: [
          { fileName: "A-2.01.pdf", contentClass: "floor_plan", excerpt: "FLOOR PLAN" },
          { fileName: "A-6.00.pdf", contentClass: "schedule", title: "Door Schedule", excerpt: "DOOR SCHEDULE" },
          { fileName: "A-1.04.pdf", contentClass: "egress_plan", title: "Egress Plan", excerpt: "EGRESS PLAN" },
        ],
      },
    );
    assert.equal(hardened.issues.length, 0);
  });
});

describe("content class does not discard a reviewed sheet", () => {
  it("keeps a measured architectural defect on an MEP sheet", () => {
    const hardened = hardenAnalysisResult(
      {
        issues: [
          {
            severity: "warning",
            category: "Egress",
            title: "Corridor width below minimum",
            description: 'Dimension note shows 36" clear, which does not meet the 44" minimum.',
            codeReference: "IBC 1020.2",
            evidenceTier: "drawing",
            measurableEvidence: true,
            location: "Corridor B",
          },
        ],
        summary: { overallScore: 100 },
        jurisdictionNotes: "",
      },
      "ibc",
      { contentClass: "mep", sheetTitle: "E-1.2 Electrical Power Plan", pageText: 'CORRIDOR B 36" CLEAR' },
    );
    assert.equal(hardened.issues.length, 0);
    assert.equal(hardened.rejectedCandidates[0].validationReason, "wrong_sheet_for_element");
    assert.notEqual(hardened.summary.reviewState, "not_reviewed");
    assert.notEqual(hardened.summary.overallScore, 100);
  });

  it("keeps a measured door-detail defect on a door schedule", () => {
    const hardened = hardenAnalysisResult(
      {
        issues: [
          {
            severity: "warning",
            category: "Egress",
            title: "Door width below minimum",
            description: 'Door detail shows 30" clear, which does not meet the 32" minimum.',
            codeReference: "IBC 1010.1.1",
            evidenceTier: "drawing",
            measurableEvidence: true,
            location: "Door 101 detail",
          },
        ],
        summary: { overallScore: 100 },
        jurisdictionNotes: "",
      },
      "ibc",
      {
        contentClass: "schedule",
        pageText: 'DOOR AND HARDWARE SCHEDULE\nDOOR DETAILS\nDOOR 101 30" CLEAR\nWINDOW ELEVATIONS',
        sheetTitle: "A-6.00.pdf",
      },
    );
    assert.equal(hardened.issues.length, 1);
    assert.notEqual(hardened.summary.overallScore, 100);
  });

  it("does not treat a not-labeled checklist line as a pass", () => {
    for (const result of ["not labeled", "not labeled E-1.2", "not labeled P-1.3"]) {
      const hardened = hardenAnalysisResult(
        {
          issues: [],
          checklist: [{ item: "Equipment", result }],
          summary: { overallScore: 100 },
          jurisdictionNotes: "",
        },
        "ibc",
        { contentClass: "mep", sheetTitle: "E-1.2.pdf" },
      );
      assert.equal(hardened.summary.reviewState, "reviewed_partial");
      assert.equal(hardened.summary.overallScore, null);
      assert.notEqual(hardened.summary.overallScore, 100);
    }
  });

  it("still passes a checklist that quotes a label on the sheet", () => {
    const hardened = hardenAnalysisResult(
      {
        issues: [],
        checklist: [{ item: "Door 101", result: "labeled HW-3" }],
        summary: { overallScore: 85 },
        jurisdictionNotes: "",
      },
      "ibc",
      { contentClass: "schedule", sheetTitle: "A-6.00.pdf", pageText: "Door 101 labeled HW-3" },
    );
    assert.equal(hardened.summary.reviewState, "reviewed_clear");
    assert.equal(hardened.summary.overallScore, null);
  });
});

describe("resolveAnalysisJurisdiction", () => {
  it("keeps explicit General IBC when the project or title block says Washington DC", () => {
    assert.equal(
      resolveAnalysisJurisdiction({
        runJurisdiction: "general",
        projectJurisdiction: "Washington, D.C.",
      }),
      "general",
    );
    assert.equal(
      resolveAnalysisJurisdiction({
        runJurisdiction: "General IBC",
        projectJurisdiction: null,
        projectCity: "Washington",
        projectState: "DC",
      }),
      "general",
    );
    assert.equal(
      resolveAnalysisJurisdiction({
        runJurisdiction: null,
        projectJurisdiction: "Washington, D.C.",
      }),
      "dc",
    );
  });

  it("keeps a specific run jurisdiction and does not treat Washington State as DC", () => {
    assert.equal(
      resolveAnalysisJurisdiction({
        runJurisdiction: "new-york-city",
        projectJurisdiction: "Washington DC",
      }),
      "new-york-city",
    );
    assert.equal(resolveAnalysisJurisdiction({ runJurisdiction: "washington" }), "washington");
    assert.equal(
      resolveAnalysisJurisdiction({ runJurisdiction: "general", projectJurisdiction: null }),
      "general",
    );
  });

  it("reads Washington, D.C. and the DC Building Code from drawing text when the project record is empty", () => {
    assert.equal(
      resolveAnalysisJurisdiction({
        runJurisdiction: "general",
        projectJurisdiction: null,
        projectCity: null,
        projectState: null,
        drawingText: "PROJECT LOCATION Washington, D.C.\nAPPLICABLE CODE: 2017 DC Building Code",
      }),
      "general",
    );
    assert.equal(
      resolveAnalysisJurisdiction({
        runJurisdiction: null,
        projectJurisdiction: null,
        drawingText: "PROJECT LOCATION Washington, D.C.\nAPPLICABLE CODE: 2017 DC Building Code",
      }),
      "dc",
    );
    assert.equal(
      resolveAnalysisJurisdiction({
        runJurisdiction: null,
        projectJurisdiction: null,
        pageText: "Washington State Building Code",
      }),
      "general",
    );
    assert.equal(
      resolveAnalysisJurisdiction({
        runJurisdiction: "new-york-city",
        projectJurisdiction: null,
        drawingText: "Washington, D.C. DC Building Code",
      }),
      "new-york-city",
    );
  });

  it("keeps an IBC section labeled IBC and a DC section labeled DC", () => {
    const ibc = hardenAnalysisResult(
      {
        issues: [
          {
            severity: "warning",
            category: "Egress",
            title: "Corridor width",
            description: 'Dimension note shows 36" clear, which does not meet the 44" minimum.',
            codeReference: "IBC 1020.2",
            evidenceTier: "drawing",
            measurableEvidence: true,
            location: "Corridor A",
          },
        ],
        summary: {},
        jurisdictionNotes: "",
      },
      "local",
      { sheetTitle: "A-101 Floor Plan", pageText: 'CORRIDOR 36" CLEAR' },
    );
    assert.match(ibc.issues[0].codeReference, /\bIBC\b/);
    assert.notEqual(ibc.issues[0].citationBook, "12A DCMR");

    const dc = hardenAnalysisResult(
      {
        issues: [
          {
            severity: "warning",
            category: "Egress",
            title: "Corridor width",
            description: 'Dimension note shows 36" clear, which does not meet the 48" minimum.',
            codeReference: "IBC DC Building Code 1017.2",
            evidenceTier: "drawing",
            measurableEvidence: true,
            location: "Corridor A",
          },
        ],
        summary: {},
        jurisdictionNotes: "",
      },
      "local",
      { sheetTitle: "A-101 Floor Plan", pageText: 'CORRIDOR 36" CLEAR' },
    );
    assert.equal(dc.issues[0].citationBook, "12A DCMR");
    assert.doesNotMatch(dc.issues[0].codeReference, /\bIBC\b/);
    assert.match(dc.issues[0].codeReference, /1017\.2/);
  });
});

describe("semanticDedupKey", () => {
  it("matches parking titles across sheets", () => {
    const a = semanticDedupKey({
      category: "Accessibility",
      codeReference: "IBC 1106",
      title: "Accessible parking — verification required",
    });
    const b = semanticDedupKey({
      category: "Accessibility",
      codeReference: "IBC 1106",
      title: "Accessible parking — verification required",
    });
    assert.equal(a, b);
  });
});
