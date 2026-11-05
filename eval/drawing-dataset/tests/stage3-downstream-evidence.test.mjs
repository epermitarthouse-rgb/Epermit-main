/**
 * Regression tests for the v2 downstream evidence defects (09-v2-downstream): design-data lists lost to
 * the budget after C4 split them into fields, truncated readings shown as conflicts, a duplicated word
 * in a production line, two door notes joined across a misread sentence end, and a garbled load value
 * delivered without a doubt marker. Real rows are the saved reconstructRows output of S-201.00 and
 * A-6.00-00 (fixtures/stage3-downstream-rows.fixture.json).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildEvidenceModel, cutReading, designDataLists, listNumberReading, listPriority, resolveOverlaps,
  startsNewAnnotation, uncertaintyReasons,
} from "../lib/stage3AnnotationModel.mjs";
import { renderAnnotation, renderTechnicalDigest, buildStage3V2Pack } from "../lib/stage3TechnicalDigest.mjs";
import { duplicateWords, rowsFromRecoveryPage } from "../lib/stage3RowReconstruct.mjs";

const FIXTURE = JSON.parse(readFileSync(new URL("./fixtures/stage3-downstream-rows.fixture.json", import.meta.url), "utf8"));
const rowsOf = (name) => FIXTURE.cases.find((c) => c.name === name).rows;
const box = (x, y, width, height) => ({ x, y, width, height });
const row = (rid, text, b) => ({ rid, text, box: b, vertical: false, confidence: 1, words: [{ text, box: b, confidence: 1 }] });
const lines = (block) => block.split("\n").filter((l) => l.startsWith("- "));
const textsOf = (model) => {
  const byId = new Map(model.rows.map((r) => [r.rid, r]));
  return model.annotations.map((a) => renderAnnotation(a, byId));
};

describe("design-data lists (S-201 seismic design data)", () => {
  for (const name of ["S-201 design data 4x3", "S-201 design data 12x9"]) {
    it(`keeps every seismic field, including the caption printed without a value (${name})`, () => {
      const model = buildEvidenceModel(rowsOf(name));
      const { promptBlock } = renderTechnicalDigest(model, { sheetId: "S-201.00", maxChars: 800 });
      const shown = lines(promptBlock);
      for (const field of ["- SEISMIC DESIGN CATEGORY (ctx?)", "SITE CLASS D", "- SEISMIC IMPORTANCE FACTOR 1.0 (ctx?)", "Cs= 0.095", "- BASIC SEISMIC FORCE RESISTING SYSTEM: / ORD. PLAIN REINF MASONRY (ctx?)"]) {
        assert.ok(shown.some((l) => l.includes(field)), `${field} missing:\n${promptBlock}`);
      }
      const seismic = model.annotations.filter((a) => a.list && textsOf({ rows: model.rows, annotations: [a] })[0].includes("SEISMIC DESIGN CATEGORY"));
      const list = seismic[0].list;
      const at = shown.map((l, i) => [l, i]).filter(([l]) => model.annotations.some((a) => a.list === list && renderAnnotation(a, new Map(model.rows.map((r) => [r.rid, r]))) === l)).map(([, i]) => i);
      assert.deepEqual(at, at.map((_, k) => at[0] + k), "list fields are shown as consecutive lines");
    });
  }

  it("without list selection the empty caption is the first to be dropped (the defect)", () => {
    const model = buildEvidenceModel(rowsOf("S-201 design data 12x9"));
    const { promptBlock } = renderTechnicalDigest(model, { sheetId: "S-201.00", maxChars: 800, lists: false });
    assert.ok(!promptBlock.includes("- SEISMIC DESIGN CATEGORY"), promptBlock);
  });

  it("splits fields inside a list whose stacking chain is broken, without joining unrelated fields (12x9)", () => {
    const texts = textsOf(buildEvidenceModel(rowsOf("S-201 design data 12x9")));
    assert.ok(texts.includes("- SEISMIC DESIGN CATEGORY (ctx?)"), texts.join("\n"));
    assert.ok(!texts.some((t) => t.includes("SEISMIC IMPORTANCE FACTOR 1.0 /")), texts.join("\n"));
    assert.ok(texts.includes("- BASIC SEISMIC FORCE RESISTING SYSTEM: / ORD. PLAIN REINF MASONRY (ctx?)"), "a caption ending in ':' keeps its value row");
  });

  it("adds no value for an empty caption and keeps the OCR text of each field", () => {
    const model = buildEvidenceModel(rowsOf("S-201 design data 4x3"));
    const sdc = model.annotations.find((a) => textsOf({ rows: model.rows, annotations: [a] })[0].includes("SEISMIC DESIGN CATEGORY"));
    assert.equal(sdc.rows.length, 1);
    assert.equal(model.rows.find((r) => r.rid === sdc.rows[0]).text, "SEISMIC DESIGN CATEGORY");
  });

  it("ranks a list like one annotation holding its fields", () => {
    assert.equal(listPriority(["value"]), 5);
    assert.equal(listPriority([]), 0);
    const model = buildEvidenceModel(rowsOf("S-201 design data 4x3"));
    const members = model.annotations.filter((a) => a.list);
    assert.ok(members.length >= 10);
    assert.ok(members.every((a) => a.listPriority === 5));
  });

  it("falls back to single fields when the whole list does not fit", () => {
    const model = buildEvidenceModel(rowsOf("S-201 design data 12x9"));
    const { digest } = renderTechnicalDigest(model, { sheetId: "S-201.00", maxChars: 520 });
    const listed = model.annotations.filter((a) => a.list);
    const shownListed = listed.filter((a) => digest.shown.includes(a.aid));
    assert.ok(shownListed.length > 0 && shownListed.length < listed.length, `${shownListed.length}/${listed.length}`);
  });

  it("does not form lists from wrapped note sentences ending in a full stop", () => {
    const notes = ["SPACING OF LIGHT GAGE FRAMING.", "DRAWINGS.", "OTHERWISE.", "PRACTICE.", "PERMITTED AT TOP OR BOTTOM OF STUD."]
      .map((t, i) => row(`n${i}`, t, box(1882, 1450 - i * 30, 200, 11)));
    const model = buildEvidenceModel(notes);
    assert.equal(designDataLists(model.annotations, new Map(model.rows.map((r) => [r.rid, r]))).size, 0);
  });

  it("adds no list marker to the block and keeps the pack unverified", () => {
    const model = buildEvidenceModel(rowsOf("S-201 design data 4x3"));
    const pack = buildStage3V2Pack({ sheetId: "S-201.00", model, maxChars: 2600 });
    assert.equal(pack.independentlyVerified, false);
    assert.ok(!pack.promptBlock.includes("L1"));
  });
});

describe("truncated readings of one place (A-6.00 EXTERIC)", () => {
  it("absorbs a reading cut inside a word with a misread last glyph and records it", () => {
    const model = buildEvidenceModel(rowsOf("A-6.00 door 5 note 4x3"));
    const texts = textsOf(model);
    assert.ok(texts.some((t) => t.includes("/ DOOR 5 RESTROOM EXTERIOR, 7 - LAMINATED FINISH, PER DECOR")), texts.join("\n"));
    assert.ok(!texts.some((t) => t.includes("EXTERIC") || t.includes("{")), texts.join("\n"));
    const kept = model.rows.find((r) => r.text.startsWith("DOOR 5 RESTROOM EXTERIOR"));
    assert.deepEqual(kept.cutReadings.map((c) => [c.kind, c.text]).sort(), [["cut_word", "DOOR 5 RESTROOM EXTERIC"], ["list_number", "9. DOOR 5"]]);
    const pack = buildStage3V2Pack({ sheetId: "A-6.00-00", model });
    assert.equal(pack.evidenceModel.rows.find((r) => r.text === kept.text).cutReadings.length, 2);
  });

  it("only treats a cut word as truncated, never a cut number", () => {
    const long = row("a", "DOOR 5 RESTROOM EXTERIOR, 7 - LAMINATED", box(1899, 659, 356, 11));
    assert.equal(cutReading(row("b", "DOOR 5 RESTROOM EXTERIC", box(1899, 659, 147, 11)), long), true);
    assert.equal(cutReading(row("c", "DOOR 5 RESTROOM EXTERIOR, 8", box(1899, 659, 190, 11)), long), false);
    assert.equal(cutReading(row("d", "DOOR 5 RESTROOM EXT", box(1899, 659, 120, 11)), long), false, "stem shorter than CUT_STEM_MIN letters");
    const value = row("e", "MAXIMUM U VALUE = 0.61", box(1884, 672, 200, 11));
    const rows = resolveOverlaps([value, row("f", "MAXIMUM U VALUE = 0.5", box(1884, 672, 180, 11))]);
    assert.equal(rows[0].alternatives.length, 1, "a differing value stays a conflict");
  });

  it("absorbs a list-number reading only when the kept reading starts after the number", () => {
    const long = row("a", "DOOR 5 RESTROOM EXTERIOR", box(1899, 659, 356, 11));
    assert.equal(listNumberReading(row("b", "9. DOOR 5", box(1884, 658, 61, 11)), long), true);
    assert.equal(listNumberReading(row("c", "9. DOOR 5", box(1905, 658, 61, 11)), long), false);
    assert.equal(listNumberReading(row("d", "9. DOOR 6", box(1884, 658, 61, 11)), long), false);
  });
});

describe("duplicated words in a production line", () => {
  it("drops a word that re-reads part of another word and records it on the right row", () => {
    const words = [
      { text: "9. DOOR 5", box: box(1884, 658, 61, 11), confidence: 0.5 },
      { text: "9.", box: box(1884, 659, 11, 9), confidence: 1 },
      { text: "OTHER NOTE", box: box(2100, 658, 60, 11), confidence: 1 },
    ];
    assert.deepEqual(duplicateWords(words).map((d) => [d.word.text, d.host.text]), [["9.", "9. DOOR 5"]]);
    const page = { words, lines: [{ text: "9. DOOR 5 9. OTHER NOTE", box: box(1884, 658, 276, 11), confidence: 0.5 }] };
    const rows = rowsFromRecoveryPage(page);
    assert.deepEqual(rows.map((r) => r.text), ["9. DOOR 5", "OTHER NOTE"]);
    assert.deepEqual(rows[0].duplicateWords.map((w) => w.text), ["9."]);
    assert.equal(rows[1].duplicateWords, undefined);
  });
});

describe("door opening forces (A-6.00)", () => {
  it("keeps the exterior and interior requirements as separate annotations when OCR reads LBS. as LB:", () => {
    assert.equal(startsNewAnnotation(".. THE OPENING FORCE OF ALL EXT. PUSH/PULL DOORS SHALL NOT EXCEED 8 1/2 LB:", "HE OPENING FORCE OF ALL INTERIOR PUSH/PULL DOORS SHALL NOT EXCEED 5 LB"), true);
    const texts = textsOf(buildEvidenceModel(rowsOf("A-6.00 door notes 4x3")));
    const ext = texts.filter((t) => t.includes("8 1/2 LB")), int = texts.filter((t) => t.includes("EXCEED 5 LB"));
    assert.equal(ext.length, 1);
    assert.equal(int.length, 1);
    assert.notEqual(ext[0], int[0], texts.join("\n"));
  });

  it("does not split a value row that continues (ROOF LIVE LOAD: 30 PSF / (NO REDUCTIONS ...))", () => {
    assert.equal(startsNewAnnotation("ROOF LIVE LOAD: 30 PSF", "(NO REDUCTIONS IN ROOF LIVE LOAD PERMITTED)"), false);
  });
});

describe("garbled load values", () => {
  it("marks a letter between a number and its unit, or a digit glued to a unit", () => {
    assert.deepEqual(uncertaintyReasons("DESIGN BASE SHEAR 15T KIPS3"), ["glyph"]);
    assert.deepEqual(uncertaintyReasons("DESIGN BASE SHEAR 57 KIPS"), []);
    assert.deepEqual(uncertaintyReasons("FLOOR LIVE LOAD: 100 PSF"), []);
    assert.deepEqual(uncertaintyReasons("3,500 PSI, NORMAL WEIGHT"), []);
  });
});
