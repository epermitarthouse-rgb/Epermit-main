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
      { sheetTitle: "A003 Site Plan", specChunks: [] },
    );
    assert.ok(hardened.summary.verificationRequired >= 1);
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
    assert.equal(hardened.summary.reviewState, "not_reviewed");
    assert.equal(hardened.summary.overallScore, null);
    assert.equal(hardened.summary.checklist.length, 0);
  });

  it("marks a recorded checklist with no failing item as passed", () => {
    const hardened = hardenAnalysisResult(
      {
        issues: [],
        checklist: [{ item: "Egress width", result: "checked, no failing condition" }],
        summary: { overallScore: 85 },
        jurisdictionNotes: "",
      },
      "ibc",
      {},
    );
    assert.equal(hardened.summary.reviewState, "passed");
    assert.equal(hardened.summary.overallScore, 100);
    assert.match(hardened.summary.checklist[0], /Egress width/);
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
      { sheetTitle: "A-101 Floor Plan", pageText: "1 HR WALL 45-MINUTE DOOR" },
    );
    assert.equal(hardened.issues.length, 1);
    assert.equal(hardened.issues[0].findingType, "confirmed_violation");
    assert.doesNotMatch(hardened.issues[0].description, /does not provide enough readable evidence/i);
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
      { sheetTitle: "A-101 Floor Plan" },
    );
    assert.equal(hardened.issues.length, 1);
    assert.equal(hardened.issues[0].citationBook, "ICC A117.1");
    assert.doesNotMatch(hardened.issues[0].codeReference, /\bIBC\b/);
    assert.match(hardened.issues[0].codeReference, /604\.8\.1\.2/);
  });
});

describe("resolveAnalysisJurisdiction", () => {
  it("uses a stored DC project jurisdiction when the run is general", () => {
    assert.equal(
      resolveAnalysisJurisdiction({
        runJurisdiction: "general",
        projectJurisdiction: "Washington, D.C.",
      }),
      "dc",
    );
    assert.equal(
      resolveAnalysisJurisdiction({
        runJurisdiction: "general",
        projectJurisdiction: null,
        projectCity: "Washington",
        projectState: "DC",
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
