import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  attributeLineWords,
  createRowMapper,
  evaluateItems,
  isDimensionOrElevation,
  isTechnicalRow,
  linesAsItems,
  prepareGroundTruth,
  quality,
  v1AnalyzerBlock,
  v1DeliveredTexts,
  wordsAsItems,
} from "../lib/stage3EvidenceEval.mjs";

const box = (x, y, width = 40, height = 8) => ({ x, y, width, height });

// Two annotations: a two-row height callout and a one-row dimension; one more row in a separate column.
const GT = prepareGroundTruth({
  sheet: "SYN",
  scope: "sheet",
  rows: [
    { gid: "R1", aid: "A1", text: `3'-6" MIN HEIGHT FROM`, technical: true, box: box(100, 200, 90), vertical: false },
    { gid: "R2", aid: "A1", text: "T.O. ROOF DECK", technical: false, box: box(100, 190, 70), vertical: false },
    { gid: "R3", aid: "A2", text: `1'-0"`, technical: true, box: box(300, 200, 20), vertical: false },
    { gid: "R4", aid: "A3", text: "V.I.F.", technical: true, box: box(500, 100, 8, 30), vertical: true },
  ],
  annotations: [
    { aid: "A1", rows: ["R1", "R2"], technical: true },
    { aid: "A2", rows: ["R3"], technical: true },
    { aid: "A3", rows: ["R4"], technical: true },
  ],
});
const seg = (text, words, marker) => ({ text, words, ...(marker ? { marker } : {}) });
const w = (text, b) => ({ text, box: b });

describe("stage3 evidence eval: primitives", () => {
  it("quality distinguishes exact, fragment, superset and wrong", () => {
    assert.equal(quality(`3'-6” MIN HEIGHT FROM`, `3'-6" MIN HEIGHT FROM`), "E");
    assert.equal(quality("MIN HEIGHT", `3'-6" MIN HEIGHT FROM`), "F");
    assert.equal(quality(`1'-0" TYP.`, `1'-0"`), "S");
    assert.equal(quality(`1'-6"`, `1'-0"`), "V");
    assert.equal(quality("", "X"), "V");
  });

  it("technical and dimension rules", () => {
    assert.ok(isTechnicalRow("V.I.F."));
    assert.ok(isTechnicalRow("EXTEND 30\" BEYOND"));
    assert.ok(!isTechnicalRow("MANUFACTURER'S"));
    assert.ok(isDimensionOrElevation(`3'-6"`));
    assert.ok(isDimensionOrElevation("1 3/4"));
    assert.ok(!isDimensionOrElevation("PEX-1"));
  });

  it("maps by orientation and overlap, with a guarded orientation fallback", () => {
    const m = createRowMapper(GT);
    assert.equal(m.rowOf("V.I.F.", box(500, 100, 8, 30)), "R4");
    assert.equal(m.rowOf(`1'-0"`, box(301, 200, 18, 8)), "R3");
    assert.equal(m.rowOf("X", box(800, 800, 10, 10)), null);
    // A borderline-square read of a vertical row still maps when it overlaps almost entirely.
    assert.equal(m.rowOf("VIF", box(500, 105, 8, 12)), "R4");
  });

  it("window scope ignores words outside the windows", () => {
    const g = prepareGroundTruth({ ...GT, scope: "windows", windows: [box(90, 180, 300, 40)] });
    const e = evaluateItems([{ id: "a", segments: [seg("OUTSIDE", [w("OUTSIDE", box(900, 900))])] }], g);
    assert.equal(e.segmentCategories.out_of_scope, 1);
    assert.equal(e.rowsAll.none, 4);
  });

  it("attributes production lines to their words", () => {
    const words = [w("3'-6\"", box(100, 200, 20)), w("MIN HEIGHT FROM", box(125, 200, 60))];
    const line = { text: `3'-6" MIN HEIGHT FROM`, box: box(100, 200, 90), words: 2, vertical: false };
    assert.deepEqual(attributeLineWords(line, words).map((x) => x.text), [`3'-6"`, "MIN HEIGHT FROM"]);
    assert.equal(attributeLineWords({ ...line, words: 3 }, words), null);
  });
});

describe("stage3 evidence eval: delivered evidence", () => {
  it("scores a clean two-row annotation as complete with context preserved", () => {
    const item = { id: "i1", segments: [
      seg(`3'-6" MIN HEIGHT FROM`, [w(`3'-6" MIN HEIGHT FROM`, box(100, 200, 90))]),
      seg("T.O. ROOF DECK", [w("T.O. ROOF DECK", box(100, 190, 70))]),
    ] };
    const e = evaluateItems([item], GT);
    const a1 = e.annotations.find((a) => a.aid === "A1");
    assert.ok(a1.complete && a1.completeClean && a1.contextPreserved);
    assert.equal(e.mixedItems, 0);
  });

  it("separate one-line items are complete but lose context", () => {
    const e = evaluateItems(linesAsItems([
      { text: `3'-6" MIN HEIGHT FROM`, box: box(100, 200, 90), words: 1 },
      { text: "T.O. ROOF DECK", box: box(100, 190, 70), words: 1 },
    ], [w(`3'-6" MIN HEIGHT FROM`, box(100, 200, 90)), w("T.O. ROOF DECK", box(100, 190, 70))]), GT);
    const a1 = e.annotations.find((a) => a.aid === "A1");
    assert.ok(a1.complete);
    assert.ok(!a1.contextPreserved);
  });

  it("a cross-column merge keeps the values only inside the merge and counts as mixed", () => {
    const merged = seg(`3'-6" MIN HEIGHT FROM 1'-0"`, [w(`3'-6" MIN HEIGHT FROM`, box(100, 200, 90)), w(`1'-0"`, box(300, 200, 20))]);
    const e = evaluateItems([{ id: "m", segments: [merged] }], GT);
    assert.equal(e.rows.find((r) => r.gid === "R1").state, "exact_in_merge");
    assert.equal(e.rows.find((r) => r.gid === "R3").state, "exact_in_merge");
    assert.equal(e.mixedSegments, 1);
    assert.equal(e.mixedItems, 1);
    assert.equal(e.annotationsTechnical.complete, 0);
  });

  it("an unmarked wrong reading contradicts an exact one; a marked one does not", () => {
    const good = { id: "g", segments: [seg(`1'-0"`, [w(`1'-0"`, box(300, 200, 20))])] };
    const bad = (marker) => ({ id: "b", segments: [seg(`1'-6"`, [w(`1'-6"`, box(300, 200, 20))], marker)] });
    const unmarked = evaluateItems([good, bad()], GT);
    assert.equal(unmarked.rows.find((r) => r.gid === "R3").state, "exact_contradicted");
    assert.equal(unmarked.wrongDimensionOrElevationUnmarked, 1);
    const marked = evaluateItems([good, bad("conflict")], GT);
    assert.equal(marked.rows.find((r) => r.gid === "R3").state, "exact");
    assert.equal(marked.wrongDimensionOrElevationUnmarked, 0);
    assert.equal(marked.wrongTechnicalSegmentsMarked, 1);
  });

  it("a word with no ground-truth row makes the line merged_with_noise", () => {
    const e = evaluateItems([{ id: "n", segments: [seg(`1'-0" #`, [w(`1'-0"`, box(300, 200, 20)), w("#", box(330, 200, 6))])] }], GT);
    assert.equal(e.segmentCategories.merged_with_noise, 1);
    assert.equal(e.rows.find((r) => r.gid === "R3").state, "wrong");
  });

  it("word stage counts each observation", () => {
    const e = evaluateItems(wordsAsItems([w("V.I.F.", box(500, 100, 8, 30)), w("MIN", box(140, 200, 20))]), GT);
    assert.equal(e.rows.find((r) => r.gid === "R4").state, "exact");
    assert.equal(e.rows.find((r) => r.gid === "R1").state, "partial");
  });
});

describe("stage3 evidence eval: v1 analyzer block", () => {
  const pack = {
    id: "p", promptBlock: "", detailIdentifier: "GUARD RAIL DETAIL",
    extractedTexts: ["ALPHA NOTE", "BRAVO NOTE", "CHARLIE NOTE"],
  };
  it("parses complete excerpts and a truncated tail", () => {
    pack.promptBlock = ["header", `detailIdentifier: ${pack.detailIdentifier}`, `excerpts: ${pack.extractedTexts.join(" || ")}`].join("\n");
    const full = v1DeliveredTexts(pack, v1AnalyzerBlock([pack]));
    assert.deepEqual(full.map((d) => [d.field, d.text, d.complete]), [
      ["detailIdentifier", "GUARD RAIL DETAIL", true],
      ["excerpts", "ALPHA NOTE", true], ["excerpts", "BRAVO NOTE", true], ["excerpts", "CHARLIE NOTE", true],
    ]);
    const cut = v1DeliveredTexts(pack, v1AnalyzerBlock([pack], "recovered", { maxPacks: 3, maxCharsPerPack: pack.promptBlock.length - 7, maxTotalChars: 3200 }));
    assert.deepEqual(cut.at(-1), { field: "excerpts", text: "CHARLIE NOTE", visible: "CHARL", complete: false });
  });

  it("does not match a short excerpt inside a longer one", () => {
    const p = { ...pack, detailIdentifier: null, extractedTexts: ["1", `3'-0"x1`] };
    p.promptBlock = `excerpts: 2 || 3'-0"x1`;
    assert.deepEqual(v1DeliveredTexts(p, v1AnalyzerBlock([p])).map((d) => d.text), [`3'-0"x1`]);
  });
});
