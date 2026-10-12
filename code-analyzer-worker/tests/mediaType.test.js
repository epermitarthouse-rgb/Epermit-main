"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { isRasterImageFile, isPdfFile } = require("../lib/mediaType.js");

describe("mediaType", () => {
  it("detects PNG/JPEG/WebP raster sources", () => {
    assert.equal(isRasterImageFile("drawing.png", null), true);
    assert.equal(isRasterImageFile("sheet.jpg", "image/jpeg"), true);
    assert.equal(isRasterImageFile("photo.jpeg", null), true);
    assert.equal(isRasterImageFile("scan.webp", "image/webp"), true);
  });

  it("detects PDF sources", () => {
    assert.equal(isPdfFile("set.pdf", "application/pdf"), true);
    assert.equal(isPdfFile("plans.PDF", null), true);
  });

  it("does not treat PDF as raster", () => {
    assert.equal(isRasterImageFile("set.pdf", "application/pdf"), false);
  });

  it("rejects unsupported extensions", () => {
    assert.equal(isRasterImageFile("notes.docx", null), false);
    assert.equal(isPdfFile("notes.docx", null), false);
  });
});
