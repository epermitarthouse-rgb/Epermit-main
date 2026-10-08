"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  mergeModificationReviewResults,
  mergeMeasureEvidence,
  synthesizeMeasureEvidence,
} = require("../app/services/compliance/code-modification.service.js");

describe("mergeModificationReviewResults hardened pipeline", () => {
  const extracted = {
    projectAddress: null,
    requestedModification: "Modify egress requirements",
    citedSections: [],
    impracticalReason: null,
    compliesWithIntent: true,
    proposedMeasures: [{ id: "measure-1", description: "Provide automatic sprinkler system" }],
    floodHazardApplicable: false,
    supportingNarrative: null,
    extractionWarnings: [],
  };

  const evidenceSheets = [
    { id: "sheet-a", pageNumber: 1, fileName: "A-101.pdf", sheetLabel: "A-101" },
    { id: "sheet-b", pageNumber: 2, fileName: "A-102.pdf", sheetLabel: "A-102" },
  ];

  it("async merge routes through mergeMeasureEvidence + synthesizeMeasureEvidence", () => {
    const sheetFindingsList = [
      [
        {
          id: "finding-a",
          measureId: "measure-1",
          measure: "Provide automatic sprinkler system",
          status: "verified",
          source: { sheetId: "sheet-a", fileName: "A-101.pdf", pageNumber: 1, excerpt: "NFPA 13 noted" },
          note: "Sprinkler shown on A-101",
        },
      ],
    ];

    const merged = mergeModificationReviewResults({
      extracted,
      sheetFindingsList,
      evidenceSheets: [evidenceSheets[0]],
      excludedFormSheetCount: 0,
      sheets: [evidenceSheets[0]],
      sheetWarnings: [],
    });

    assert.equal(merged.evidence.length, 1);
    const finding = merged.evidence[0];
    assert.notEqual(finding.status, "not_found");
    assert.equal(finding.measureId, "measure-1");
  });

  it("sync and async share mergeMeasureEvidence + synthesizeMeasureEvidence helpers", () => {
    let findings = [
      {
        id: "finding-base",
        measureId: "measure-1",
        measure: "Provide automatic sprinkler system",
        status: "not_found",
        source: null,
        note: "No drawing evidence was reviewed for this measure.",
      },
    ];
    const incoming = [
      {
        id: "finding-in",
        measureId: "measure-1",
        measure: "Provide automatic sprinkler system",
        status: "verified",
        source: { sheetId: "sheet-a", fileName: "A-101.pdf", pageNumber: 1 },
        note: "Verified",
      },
    ];
    findings = mergeMeasureEvidence(findings, incoming, { deferSynthesis: true });
    findings = findings.map((f) => synthesizeMeasureEvidence(f));
    assert.equal(findings.length, 1);
    assert.ok(findings[0].observations && findings[0].observations.length >= 1);
  });
});
