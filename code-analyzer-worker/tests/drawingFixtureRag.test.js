"use strict";

const fs = require("fs");
const path = require("path");
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { extractPdfPageText } = require("../lib/pdfExtract.js");
const { createDrawingIndex, hybridRetrieveDrawings } = require("../../scraper-service/app/services/compliance/rag/drawingIndex.js");
const { hardenAnalysisResult, resolveJurisdictionDecisionFromInput } = require("../../scraper-service/app/services/compliance/findingQuality.js");

const FIXTURE_DIR = "/Users/javerianaveed/Desktop/008-0003 New York Ave Wash DC_PERMIT REV5 SET_2026-10-15_Individual";
const FILES = [
  "A-1.00-00.pdf",
  "A-3.02-00.pdf",
  "A-6.01.00.pdf",
  "E-2.1-00.pdf",
  "EQ-1.00-0.pdf",
  "M-4.1.pdf",
  "P-3.0-00.pdf",
  "P-2.0-00.pdf",
  "S-300.00.pdf",
];

async function loadFixtures() {
  if (!fs.existsSync(FIXTURE_DIR)) return null;
  const index = createDrawingIndex();
  const texts = new Map();
  for (const fileName of FILES) {
    const filePath = path.join(FIXTURE_DIR, fileName);
    if (!fs.existsSync(filePath)) continue;
    const text = await extractPdfPageText(filePath, 1);
    texts.set(fileName, text);
    index.upsert({
      projectId: "local-fixture",
      documentId: fileName,
      sheetId: fileName,
      fileName,
      pageNumber: 1,
      text,
      extractionMethod: "pdfjs-text-layer",
    });
  }
  return { index, texts };
}

describe("local permit-set retrieval", { timeout: 180000 }, () => {
  it("retrieves real sheet text without fabricating quotes or writing a run", async () => {
    const loaded = await loadFixtures();
    if (!loaded) {
      console.log("fixture folder missing; skipped real PDF retrieval");
      return;
    }
    const { index, texts } = loaded;
    assert.ok(texts.size >= 5);

    const partition = hybridRetrieveDrawings(index, {
      topics: ["partition", "legend", "wall", "rating", "hour"],
      currentSheetId: "A-1.00-00.pdf",
    });
    const lighting = hybridRetrieveDrawings(index, {
      topics: ["emergency lighting", "emergency light"],
      currentSheetId: "not-the-electrical-sheet",
    });
    const mechanical = hybridRetrieveDrawings(index, {
      topics: ["schedule", "equipment"],
      currentSheetId: "M-1.1.pdf",
    });
    const plumbing = hybridRetrieveDrawings(index, {
      topics: ["plumbing", "schedule", "detail", "water"],
      currentSheetId: "P-3.0-00.pdf",
    });
    const architectural = hybridRetrieveDrawings(index, {
      topics: ["corridor", "floor plan"],
      identifiers: ["A-1.00"],
      currentSheetId: "EQ-1.00-0.pdf",
    });

    for (const hit of [...partition, ...lighting, ...mechanical, ...plumbing, ...architectural]) {
      const source = texts.get(hit.fileName) || "";
      assert.equal(hit.provesRequirementSatisfied, false);
      assert.ok(source.includes(hit.quote) || source.replace(/\s+/g, " ").includes(hit.quote), hit.fileName);
    }

    const eqText = texts.get("EQ-1.00-0.pdf") || "";
    const eqReview = hardenAnalysisResult(
      {
        issues: [
          {
            title: "Corridor width",
            description: 'The corridor is 44" wide.',
            category: "Egress",
            severity: "critical",
            measurableEvidence: true,
            findingType: "confirmed_violation",
            codeReference: "IBC 1020.2",
          },
        ],
        summary: { overallScore: 100 },
        jurisdictionNotes: "",
      },
      "ibc",
      { sheetTitle: "EQ-1.00-0.pdf", fileName: "EQ-1.00-0.pdf", pageText: eqText },
    );
    if (!/44\s*["″]/.test(eqText) && !/44in/i.test(eqText.replace(/\s+/g, ""))) {
      assert.equal(eqReview.summary.confirmedViolations, 0);
      assert.notEqual(eqReview.summary.overallScore, 100);
    }

    const scope = resolveJurisdictionDecisionFromInput({
      runJurisdiction: "General IBC",
      drawingText: [...texts.values()].join("\n").slice(0, 20000),
    });
    assert.equal(scope.enforcedJurisdiction, "general");
    assert.equal(scope.amendmentsEnforced, false);

    for (const fileName of ["P-3.0-00.pdf", "M-4.1.pdf", "S-300.00.pdf"]) {
      if (!texts.has(fileName)) continue;
      const review = hardenAnalysisResult(
        { issues: [], checklist: [{ item: fileName, result: "sheet opened" }], summary: { overallScore: 100 }, jurisdictionNotes: "" },
        "ibc",
        { sheetTitle: fileName, fileName, pageText: texts.get(fileName), contentClass: fileName.startsWith("S-") ? "form" : "schedule" },
      );
      assert.notEqual(review.summary.reviewState, "not_reviewed");
      assert.notEqual(review.summary.overallScore, 100);
    }
  });
});
