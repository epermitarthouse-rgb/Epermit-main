"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { boxFromTextItem, selectInspectionRegions, pdfBoxFromNormalized, shouldAttachRegionImages, rankRegionsForQuestions, questionLineRegions, visualFallbackRegions } = require("../lib/comprehension.js");

describe("selective page regions", () => {
  it("keeps a real text-item box in PDF points and normalized page space", () => {
    const box = boxFromTextItem({ transform: [1, 0, 0, 1, 72, 144], width: 36, height: 8 }, 720, 432);
    assert.equal(box.unit, "pdf-point");
    assert.equal(box.origin, "bottom-left");
    assert.equal(box.x, 72);
    assert.equal(box.y, 144);
    assert.equal(box.normalized.origin, "top-left");
    assert.ok(box.normalized.x > 0 && box.normalized.x < 1);
    assert.ok(box.normalized.y > 0 && box.normalized.y < 1);
  });

  it("does not invent a box when the text item has no position", () => {
    assert.equal(boxFromTextItem({ str: "1 HR" }, 720, 432), null);
  });

  it("selects rating and note regions without gridding the page", () => {
    const page = { pageWidth: 2000, pageHeight: 1400 };
    const items = [
      { str: "TITLE BLOCK PROJECT", region: { x: 10, y: 10, width: 1800, height: 1200, pageWidth: 2000, pageHeight: 1400 } },
      { str: "1 HR", region: { x: 100, y: 200, width: 24, height: 8, pageWidth: 2000, pageHeight: 1400 } },
      { str: '36"', region: { x: 400, y: 500, width: 18, height: 8, pageWidth: 2000, pageHeight: 1400 } },
      { str: "WALL LEGEND", region: { x: 900, y: 80, width: 80, height: 10, pageWidth: 2000, pageHeight: 1400 } },
    ];
    const regions = selectInspectionRegions(items, page);
    assert.ok(regions.length >= 2);
    assert.ok(regions.length <= 6);
    assert.ok(regions.every((region) => region.width < 500));
    assert.ok(regions.some((region) => region.reason === "rating"));
    assert.ok(regions.some((region) => region.quote === "1 HR"));
  });
});

describe("crop coordinate mapping", () => {
  it("maps a normalized OCR word back onto the PDF tile", () => {
    const box = pdfBoxFromNormalized(
      { x: 100, y: 200, width: 400, height: 300 },
      { x: 0.5, y: 0.25, width: 0.1, height: 0.05 },
    );
    assert.equal(box.x, 300);
    assert.equal(box.y, 275);
    assert.equal(box.width, 40);
    assert.equal(box.height, 15);
  });

  it("attaches crops when the full-sheet raster is too coarse to read tags", () => {
    assert.equal(shouldAttachRegionImages(1200, 800, 2592, 1728), true);
    assert.equal(shouldAttachRegionImages(8000, 5400, 2592, 1728), false);
  });
});

describe("question-driven crops", () => {
  const regions = [
    { quote: "3700 O'Donnell Street, Suite 200", reason: "dimension", x: 1, y: 2, width: 10, height: 4 },
    { quote: 'SCALE: 1/4" = 1\'-0"', reason: "dimension", x: 3, y: 4, width: 10, height: 4 },
    { quote: "EMERGENCY LIGHTING HAS BEEN DESIGNED PER NFPA 101", reason: "note", x: 20, y: 30, width: 80, height: 8 },
    { quote: "— 1H — ONE HOUR FIRE RATED WA", reason: "rating", x: 100, y: 40, width: 40, height: 8 },
  ];

  it("prefers a graphic fire-rating tag over the scale and address", () => {
    const picked = rankRegionsForQuestions(regions, { questions: ["fire-rated-partition"] });
    assert.equal(picked.limitation, null);
    assert.equal(picked.regions.length, 1);
    assert.match(picked.regions[0].quote, /ONE HOUR/);
    assert.deepEqual(picked.regions[0].matchedQuestions, ["fire-rated-partition"]);
  });

  it("prefers the emergency-lighting note over the address and scale", () => {
    const picked = rankRegionsForQuestions(regions, { questions: ["emergency-lighting"] });
    assert.equal(picked.regions[0].quote.includes("EMERGENCY LIGHTING"), true);
    assert.ok(picked.regions.every((region) => region.boilerplate == null));
  });

  it("records a limitation when only a title-block crop would match", () => {
    const picked = rankRegionsForQuestions(regions.slice(0, 2), { questions: ["emergency-lighting"] });
    assert.equal(picked.regions.length, 0);
    assert.equal(picked.limitation, "crop_selection_unconfident");
  });

  it("builds a crop from split text items instead of the title block", () => {
    const page = { pageWidth: 2000, pageHeight: 1400 };
    const items = [
      { str: "3700", region: { ...page, x: 1600, y: 40, width: 40, height: 8 } },
      { str: "Street", region: { ...page, x: 1650, y: 40, width: 50, height: 8 } },
      { str: 'SCALE: 1/4" = 1\'-0"', region: { ...page, x: 1600, y: 20, width: 80, height: 8 } },
      { str: "EMERGENCY", region: { ...page, x: 200, y: 700, width: 70, height: 8 } },
      { str: "LIGHTING", region: { ...page, x: 280, y: 700, width: 60, height: 8 } },
      { str: "HAS BEEN DESIGNED PER NFPA 101", region: { ...page, x: 350, y: 702, width: 180, height: 8 } },
    ];
    const lines = questionLineRegions(items, ["emergency-lighting"]);
    assert.equal(lines.length, 1);
    assert.match(lines[0].quote, /EMERGENCY LIGHTING/);
    assert.equal(lines[0].readable, true);
    assert.ok(lines[0].x < 1000);
    assert.equal(lines[0].quote.includes("Street"), false);
  });

  it("keeps an unreadable interior fallback out of the title-block corner", () => {
    const boxes = visualFallbackRegions(2000, 1400, ["plumbing-details"]);
    assert.equal(boxes.length, 2);
    for (const box of boxes) {
      assert.equal(box.quote, null);
      assert.equal(box.readable, false);
      assert.equal(box.limitations, "region_unreadable");
      assert.ok(box.x + box.width < 2000 * 0.7);
      assert.ok(box.y > 1400 * 0.2);
    }
  });
});
