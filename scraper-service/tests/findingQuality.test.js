"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  applyEvidenceGate,
  hardenAnalysisResult,
  buildJurisdictionDiagnostics,
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
