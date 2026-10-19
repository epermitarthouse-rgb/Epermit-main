"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { hardenAnalysisResult } = require("../app/services/compliance/findingQuality.js");

const general = {
  selectionSource: "explicit",
  selectedScope: "general-ibc",
  enforcedJurisdiction: "general",
  detectedLocation: "dc",
  amendmentsEnforced: false,
};

function replay(sheet) {
  return hardenAnalysisResult(sheet.raw, "ibc", {
    sheetTitle: sheet.fileName,
    fileName: sheet.fileName,
    pageText: sheet.pageText,
    observations: sheet.observations || [],
    jurisdictionScope: general,
    drawingRecords: sheet.drawingRecords || [],
  });
}

const sheets = [
  {
    fileName: "A-1.00-00.pdf",
    pageText: "SYMBOL LEGENDS TYPICAL INTERIOR PARTITION",
    observations: [{ quote: "— 1H — ONE HOUR FIRE RATED WA" }],
    raw: {
      issues: [
        {
          title: "Corridor Clear Width Missing Information",
          description: "The corridor width appears to meet requirements but lacks a documented dimension to confirm compliance.",
          severity: "advisory",
          findingType: "missing_information",
          codeReference: "IBC 2021 Section 1020.2",
        },
        {
          title: "Incomplete Fire-Rated Wall Annotation",
          description: "The drawing includes labels for 1-hour fire-rated assemblies but lacks complete annotation.",
          severity: "advisory",
          findingType: "missing_information",
          codeReference: "IBC 2021 Section 707",
        },
      ],
      checklist: [{ item: "Wall Fire Rating", result: "1-hour noted", evidence: "1-hour wall" }],
      observedEvidence: ["44 in clear", "1-hour wall"],
      overallScore: 85,
    },
  },
  {
    fileName: "A-3.02-00.pdf",
    pageText: "WALL SECTION 1/2 INCH EXTERIOR SHEATHING",
    raw: {
      issues: [
        {
          title: "Missing Fire-Resistance Rating Documentation",
          description: "The sections do not clearly indicate if the walls are fire-rated.",
          severity: "advisory",
          findingType: "missing_information",
          codeReference: "IBC 2021 Section 703.2",
        },
        {
          title: "Structural Connection Details Missing",
          description: "The drawings lack specific structural connection details.",
          severity: "warning",
          findingType: "missing_information",
          codeReference: "IBC 2021 Section 1603.1",
        },
      ],
      observedEvidence: ["29'-0' dimension"],
      overallScore: 85,
    },
    drawingRecords: [
      { fileName: "A-1.00-00.pdf", title: "Partition plan", text: "— 1H — ONE HOUR FIRE RATED WA", contentClass: "drawing" },
    ],
  },
  {
    fileName: "E-2.1-00.pdf",
    pageText: "EMERGENCY LIGHTING HAS BEEN DESIGNED PER NFPA 101 TO MAINTAIN 1 FOOT-CANDLE IN PATH OF EGRESS. ILLUMINATING FIXTURE FOR 1.5 HOURS",
    raw: {
      issues: [],
      checklist: [{ item: "Emergency Lighting", result: "Designed per NFPA 101", evidence: "EMERGENCY LIGHTING HAS BEEN DESIGNED PER NFPA 101" }],
      observedEvidence: ["EMERGENCY LIGHTING HAS BEEN DESIGNED PER NFPA 101"],
      overallScore: 100,
    },
  },
  {
    fileName: "EQ-1.00-0.pdf",
    pageText: 'EQUIPMENT PLAN 2\'-6" (CLEAR) 11\'-1" (HOLD) 44.60',
    raw: {
      issues: [
        {
          title: "Corridor Width Non-Compliance",
          description: 'The corridor width is marked as 2\'-6", which does not meet the minimum clear width requirement.',
          severity: "critical",
          findingType: "confirmed_violation",
          codeReference: "IBC 2021 Section 1020.2",
          measurableEvidence: true,
          evidenceTier: "drawing",
        },
      ],
      checklist: [{ item: "Corridor clear width", result: '2\'-6" labeled at the corridor', evidence: '2\'-6" (CLEAR)' }],
      observedEvidence: ['2\'-6" (CLEAR)'],
      overallScore: 80,
    },
  },
  {
    fileName: "P-3.0-00.pdf",
    pageText: "GREASE OUTPUT SELECT GREASE INTERCEPTOR. BACKFLOW PREVENTION SHALL COMPLY WITH THE LOCAL PLUMBING CODE. RPZ",
    raw: {
      issues: [
        {
          title: "Backflow Prevention Noted but Details Missing",
          description: "While backflow prevention is noted, specific details of the installation are not fully visible.",
          severity: "advisory",
          findingType: "missing_information",
          codeReference: "IBC 2021, Section 2902.1.2",
        },
      ],
      checklist: [{ item: "Backflow prevention", result: "Noted in Beverage System Distribution Schematic", evidence: "RPZ" }],
      overallScore: 95,
    },
  },
];

describe("saved five-sheet responses through the new verifier", () => {
  for (const sheet of sheets) {
    it(sheet.fileName, () => {
      const after = replay(sheet);
      assert.equal(after.summary.confirmedViolations, 0);
      for (const issue of after.issues) {
        assert.notEqual(issue.findingType, "confirmed_violation");
        assert.equal(issue.codeSourceStatus, "unverified");
        assert.doesNotMatch(`${issue.title} ${issue.description}`, /non-compliance|does not meet|44 in clear/i);
      }
      if (sheet.fileName.startsWith("EQ")) {
        assert.equal(after.issues.length, 0);
        assert.equal(after.rejectedCandidates[0].validationReason, "dimension_not_tied_to_element");
        assert.notEqual(after.summary.overallScore, 100);
      }
      if (sheet.fileName.startsWith("E-2")) {
        assert.equal(after.issues.length, 0);
        assert.equal(after.summary.reviewState, "reviewed_partial");
        assert.equal(after.summary.reviewOutcome, "insufficient_evidence");
        assert.notEqual(after.summary.overallScore, 100);
      }
      if (sheet.fileName.startsWith("P-")) {
        assert.notEqual(after.summary.overallScore, 100);
      }
      assert.notEqual(after.summary.reviewState, "reviewed_clear");
    });
  }
});
