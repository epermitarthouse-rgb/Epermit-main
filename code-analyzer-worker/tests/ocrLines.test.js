"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  OCR_TEXT_HEADING,
  OCR_INDEX_HEADING,
  groupWordsIntoLines,
  indexRowsFromLines,
  composeSheetText,
  correctedSheetToken,
} = require("../lib/ocrLines.js");

const word = (text, x, y, width = text.length * 6, height = 8) => ({ text, confidence: 90, box: { x, y, width, height } });

describe("groupWordsIntoLines", () => {
  it("joins words on one baseline and keeps distant columns apart", () => {
    const lines = groupWordsIntoLines([
      word("STAIR", 10, 100), word("WIDTH", 46, 100), word("44\"", 82, 100),
      word("SCHEDULE", 400, 100),
      word("NEXT", 10, 80),
    ]);
    assert.deepEqual(lines.map((line) => line.text), ["STAIR WIDTH 44\"", "SCHEDULE", "NEXT"]);
  });
});

describe("correctedSheetToken", () => {
  it("fixes CAD-font digit and letter confusions in sheet numbers only", () => {
    assert.equal(correctedSheetToken("A-I.OO"), "A-1.00");
    assert.equal(correctedSheetToken("5-201"), "S-201");
    assert.equal(correctedSheetToken("6-0.00"), "G-0.00");
    assert.equal(correctedSheetToken("WALL"), null);
    assert.equal(correctedSheetToken("POOL"), null);
  });
});

describe("index rows", () => {
  const rows = ["CV-1.00 COVER", "G-0.00 GENERAL", "A-1.00 FLOOR PLAN", "A-1.01 FLOOR PLAN", "S-201 STRUCTURAL NOTES", "M-1.2 SCHEDULES"]
    .map((text, index) => ({ text, box: { x: 20, y: 500 - index * 12, width: 120, height: 8 } }));

  it("reads a left-aligned column of sheet numbers as index rows", () => {
    assert.deepEqual(indexRowsFromLines(rows).map((row) => row.sheetNumber), ["CV-1.00", "G-0.00", "A-1.00", "A-1.01", "S-201", "M-1.2"]);
  });

  it("a lone title-block sheet number is not an index", () => {
    assert.deepEqual(indexRowsFromLines([{ text: "A-1.00", box: { x: 700, y: 20, width: 40, height: 8 } }]), []);
  });

  it("composes the index first, then the text layer, then only novel OCR lines", () => {
    const lines = [...rows, { text: "1H ONE HOUR FIRE RATED WALLS", box: { x: 300, y: 300, width: 200, height: 8 } }, { text: "DRAWING INDEX", box: { x: 20, y: 520, width: 90, height: 8 } }];
    const composed = composeSheetText("COVER SHEET DRAWING INDEX", lines);
    const [first] = composed.text.split("\n");
    assert.ok(first.startsWith(OCR_INDEX_HEADING));
    assert.match(composed.text, new RegExp(`${OCR_TEXT_HEADING.replace(/[()]/g, "\\$&")}[\\s\\S]*1H ONE HOUR FIRE RATED WALLS`));
    assert.equal(composed.indexRows.length, 6);
  });
});
