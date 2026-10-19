"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { comprehendPdfPage } = require("../lib/comprehension.js");
const { prepareSheetReview } = require("../../scraper-service/app/services/compliance/review/orchestrate.js");
const { createDrawingIndex } = require("../../scraper-service/app/services/compliance/rag/drawingIndex.js");
const { hardenAnalysisResult, resolveJurisdictionDecisionFromInput } = require("../../scraper-service/app/services/compliance/findingQuality.js");

const DIR = "/Users/javerianaveed/Desktop/008-0003 New York Ave Wash DC_PERMIT REV5 SET_2026-10-15_Individual";
const SAMPLE = [
  ["A-1.00", "A-1.00-00.pdf"],
  ["A-3.02", "A-3.02-00.pdf"],
  ["CV-1.00", "CV-1.00-00.pdf"],
  ["E-2.1", "E-2.1-00.pdf"],
  ["EQ-1.00", "EQ-1.00-0.pdf"],
  ["M-4.1", "M-4.1.pdf"],
  ["P-3.0", "P-3.0-00.pdf"],
  ["S-201", "S-201.00.pdf"],
  ["S-204", "S-204.00.pdf"],
  ["S-300", "S-300.00.pdf"],
];

describe("local permit sample", { timeout: 420000 }, () => {
  it("reads crops and verifies the sample without a live model call", async (t) => {
    if (!fs.existsSync(path.join(DIR, "A-1.00-00.pdf"))) {
      t.skip("local permit PDFs are not on this machine");
      return;
    }
    const index = createDrawingIndex();
    const rows = [];
    for (const [label, fileName] of SAMPLE) {
      const filePath = path.join(DIR, fileName);
      assert.equal(fs.existsSync(filePath), true, fileName);
      const page = await comprehendPdfPage(filePath, 1, { render: label === "A-1.00" });
      const prepared = prepareSheetReview({
        projectId: "local-sample",
        sheet: { id: fileName, file_name: fileName, sheet_label: label },
        pageText: page.text,
        items: page.items,
        regions: page.regions,
        contentClass: "drawing",
        index,
        jurisdictionScope: resolveJurisdictionDecisionFromInput({
          runJurisdiction: "general",
          drawingText: page.text,
        }),
        analysisInstructions: "Pay attention to rated partitions.",
      });
      rows.push({ label, fileName, page, prepared });
    }

    const a100 = rows.find((row) => row.label === "A-1.00");
    assert.equal(/one hour/i.test(a100.page.textLayer || ""), false);
    const rating = (a100.page.regions || []).find(
      (region) => region.readable && region.quote && /one hour|\b[1I]\s*h/i.test(region.quote) && /vision|tesseract|ocr/.test(region.extractionMethod || ""),
    );
    const unreadable = (a100.page.regions || []).filter((region) => region.readable === false && Number.isFinite(region.x));
    if (process.platform === "darwin") {
      assert.ok(rating, "A-1.00 graphical hour rating was not read from a crop");
      assert.ok(rating.x >= 0 && rating.x <= a100.page.pageWidth);
      assert.ok(rating.y >= 0 && rating.y <= a100.page.pageHeight);
      assert.equal(a100.page.textLayer.includes(rating.quote), false);
      assert.ok(a100.page.regionImages.length >= 1);
      assert.ok(Buffer.from(a100.page.regionImages[0].imageBase64, "base64").length > 500);
    } else {
      assert.ok(rating || unreadable.length > 0);
    }

    const scope = resolveJurisdictionDecisionFromInput({ runJurisdiction: "general", drawingText: a100.page.text });
    assert.equal(scope.enforcedJurisdiction, "general");
    assert.equal(scope.amendmentsEnforced, false);
    assert.match(a100.prepared.promptBlock, /no verified code section text/i);

    const fire = hardenAnalysisResult(
      {
        issues: [
          {
            issueTitle: "Fire rating missing",
            description: "Fire rating is not shown on the partition.",
            location: "A-1.00",
            severity: "critical",
            findingType: "missing_information",
          },
        ],
        summary: { overallScore: 100, checklist: [{ item: "Partitions", result: "reviewed" }] },
        jurisdictionNotes: "",
      },
      "ibc",
      {
        fileName: "A-1.00-00.pdf",
        pageText: a100.page.text,
        observations: a100.prepared.observations,
        drawingRecords: index.list(),
        callStatus: "completed",
      },
    );
    if (rating) assert.equal(fire.issues.filter((issue) => /fire rating/i.test(issue.issueTitle || "")).length, 0);
    assert.notEqual(fire.summary.reviewState, "not_reviewed");
    assert.notEqual(fire.summary.overallScore, 100);

    const eq = rows.find((row) => row.label === "EQ-1.00");
    const corridor = hardenAnalysisResult(
      {
        issues: [
          {
            issueTitle: "Corridor too narrow",
            description: 'Corridor width is 44" and does not meet the requirement.',
            location: "EQ-1.00",
            severity: "critical",
            findingType: "confirmed_violation",
          },
        ],
        summary: { overallScore: 100 },
        jurisdictionNotes: "",
      },
      "ibc",
      { fileName: "EQ-1.00-0.pdf", pageText: eq.page.text, observations: eq.prepared.observations, callStatus: "completed" },
    );
    assert.equal(corridor.issues.filter((issue) => issue.findingType === "confirmed_violation").length, 0);
    assert.notEqual(corridor.summary.overallScore, 100);

    const electrical = rows.find((row) => row.label === "E-2.1");
    const lighting = hardenAnalysisResult(
      {
        issues: [
          {
            issueTitle: "Emergency lighting missing",
            description: "Emergency lighting is not shown.",
            severity: "warning",
            findingType: "missing_information",
          },
        ],
        summary: { overallScore: 70 },
        jurisdictionNotes: "",
      },
      "ibc",
      { fileName: "E-2.1-00.pdf", pageText: electrical.page.text, observations: electrical.prepared.observations, callStatus: "completed" },
    );
    if (/emergency\s+light/i.test(electrical.page.text || "")) {
      assert.equal(lighting.issues.length, 0);
    }

    for (const row of rows) {
      const summary = hardenAnalysisResult(
        { issues: [], summary: { overallScore: 100, checklist: [] }, jurisdictionNotes: "" },
        "ibc",
        { fileName: row.fileName, pageText: row.page.text, callStatus: "completed" },
      ).summary;
      assert.notEqual(summary.reviewState, "not_reviewed");
      assert.notEqual(summary.overallScore, 100);
      assert.equal(summary.reviewState, "reviewed_partial");
    }

    const table = rows.map((row) => ({
      sheet: row.label,
      graphical: row.page.graphicalReadStatus,
      textChars: (row.page.textLayer || "").length,
      cropImages: (row.page.regionImages || []).length,
      hourQuote: (row.page.regions || []).find((region) => region.quote && /hour|\b[1I]\s*h/i.test(region.quote))?.quote || null,
      questions: row.prepared.questions,
      codeAuthoritative: row.prepared.retrieval.packages.every((pack) => (pack.code || []).length === 0),
    }));
    console.log(JSON.stringify(table, null, 2));
    assert.ok(table.every((row) => row.codeAuthoritative));
  });
});
