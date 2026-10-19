"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { boxFromTextItem, selectInspectionRegions, pdfBoxFromNormalized, shouldAttachRegionImages } = require("../lib/comprehension.js");

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
