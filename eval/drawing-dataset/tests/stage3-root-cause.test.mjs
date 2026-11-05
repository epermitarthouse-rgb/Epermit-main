/**
 * Regression tests for evidence-construction defects behind confirmed analyzer errors
 * (07-finding-root-cause: C1 repeated notes, C2 v1 glyph variants, C3 truncated reads, C4 field lists).
 * Texts are the saved OCR readings of the failing sheets; boxes are simplified.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildEvidenceModel, resolveOverlaps } from "../lib/stage3AnnotationModel.mjs";
import { renderAnnotation } from "../lib/stage3TechnicalDigest.mjs";
import { mergeSamePlaceReadings } from "../lib/stage3ReadingVariants.mjs";
import { extractDoorScheduleEvidence } from "../lib/stage3VisualExtractionSpike.mjs";
import { extractGenericSheetEvidence } from "../lib/stage3GenericSheetEvidence.mjs";

const box = (x, y, width, height) => ({ x, y, width, height });
const row = (rid, text, b, extra = {}) => ({ rid, text, box: b, vertical: false, confidence: 1, words: [{ text, box: b, confidence: 1 }], ...extra });
const rendered = (model) => {
  const byId = new Map(model.rows.map((r) => [r.rid, r]));
  return model.annotations.map((a) => renderAnnotation(a, byId));
};

describe("C1 repeated notes read with a different digit", () => {
  const closerNote = (prefix, x, y, value) => [
    row(`${prefix}1`, "OF 5# PUSH/PULL PRESSURE. SWEEP PERIOD", box(x, y + 12, 196, 10)),
    row(`${prefix}2`, `FROM ${value} DEGREES TO A POINT 3" FROM`, box(x, y, 186, 10)),
    row(`${prefix}3`, "LATCH MUST BE AT LEAST 3 SECONDS.", box(x, y - 12, 170, 10)),
  ];

  it("marks the number in every copy, keeps each OCR reading and chooses no winner (A-4.00 12x9)", () => {
    const model = buildEvidenceModel([
      row("r006", "SWEEP PERIOD FROM 70 DEGREES TO A POINT 3\" FROM LATCH MUST BE AT LEAST 3 SECONDS.", box(1761, 1659, 501, 10)),
      ...closerNote("a", 494, 1620, "10"),
      ...closerNote("b", 638, 868, "10"),
    ]);
    const lines = rendered(model);
    assert.equal(lines.filter((l) => l.includes("FROM {10 | 70} DEGREES")).length, 3, lines.join("\n"));
    assert.ok(!lines.some((l) => /FROM 10 DEGREES|FROM 70 DEGREES/.test(l)), lines.join("\n"));
    const r006 = model.rows.find((r) => r.rid === "r006");
    assert.equal(r006.text.includes("FROM 70 DEGREES"), true);
    assert.equal(r006.repeatedReadings[0].own, "70");
    assert.deepEqual(r006.repeatedReadings[0].sources.map((s) => s.rid).sort(), ["a2", "b2"]);
  });

  it("leaves copies alone when their numbers differ by more than one confusable digit", () => {
    const model = buildEvidenceModel([...closerNote("a", 494, 1620, "10"), ...closerNote("b", 638, 868, "45")]);
    assert.ok(model.rows.every((r) => !r.repeatedReadings));
  });

  it("leaves similar notes with less shared wording alone", () => {
    const model = buildEvidenceModel([
      row("r1", "1 EA PANIC 9975EO-LD 36\" SP28 V.DUPRIN", box(600, 700, 200, 10)),
      row("r2", "1 EA PANIC 9975EO-LD 38\" SP28 V.DUPRIN", box(900, 400, 200, 10)),
    ]);
    assert.ok(model.rows.every((r) => !r.repeatedReadings));
  });

  it("can be disabled", () => {
    const model = buildEvidenceModel([...closerNote("a", 494, 1620, "10"), ...closerNote("b", 638, 868, "70")], { repeatedNotes: false });
    assert.ok(model.rows.every((r) => !r.repeatedReadings));
  });
});

describe("C2 v1 excerpts: one place read twice with a glyph variant", () => {
  const hit = (text, bbox, extra = {}) => ({ text, bbox, origin: "visual_ocr", extractionMethod: "macos-vision", ...extra });
  const panicA = hit("3. 1EA PANIC 9975EO-LD 36\" SP28 V.DUPRIN", box(612, 775, 180, 9));
  const panicB = hit("1 EA PANIC 9975E0-LD 36\" SP28 V.DUPRIN", box(620, 775, 172, 9));

  it("merges overlapping O/0 readings and keeps the first as printed (A-6.00 9975EO/9975E0)", () => {
    const { hits, merged } = mergeSamePlaceReadings([panicA, panicB]);
    assert.deepEqual(hits.map((h) => h.text), [panicA.text]);
    assert.deepEqual(merged, [{ kept: panicA.text, variant: panicB.text }]);
  });

  it("keeps the same identifier printed at a different place", () => {
    const elsewhere = hit("1 EA PANIC 9975E0-LD 36\"", box(1075, 759, 110, 9));
    const { hits, merged } = mergeSamePlaceReadings([panicA, elsewhere]);
    assert.equal(hits.length, 2);
    assert.deepEqual(merged, []);
  });

  it("keeps overlapping readings that differ beyond confusable glyphs", () => {
    const other = hit("1 EA PANIC 9975EO-LD 48\" SP28 V.DUPRIN", box(612, 775, 180, 9));
    assert.equal(mergeSamePlaceReadings([panicA, other]).hits.length, 2);
  });

  it("leaves spacing and truncation duplicates as v1 quoted them (A-3.06 parity)", () => {
    const a = hit("-GUARD RAIL SHALL BE CONSTRUCTED SO AS TO", box(100, 100, 200, 9));
    const b = hit("- GUARD RAIL SHALL BE CONSTRUCTED SO AS TO", box(102, 100, 200, 9));
    const c = hit("GUARD RAIL SHALL BE", box(110, 100, 100, 9));
    assert.equal(mergeSamePlaceReadings([a, b, c]).hits.length, 3);
  });

  it("prefers the longer reading when the first one was truncated", () => {
    const short = hit("1 EA PANIC 9975E0-LD", box(620, 775, 90, 9));
    const { hits } = mergeSamePlaceReadings([short, panicA]);
    assert.deepEqual(hits.map((h) => h.text), [panicA.text]);
  });

  it("quotes the door-schedule hardware line once and records the variant", () => {
    const pack = extractDoorScheduleEvidence({ associations: [
      hit("DOOR SCHEDULE", box(100, 1500, 80, 12)), panicA, panicB,
      hit("1 EA LOCK ND80PD RHO 626 SCHLAGE", box(612, 760, 160, 9)),
    ] });
    assert.equal(pack.extractedTexts.filter((t) => t.includes("9975E")).length, 1);
    assert.deepEqual(pack.assessment.readingVariantsMerged, [{ kept: panicA.text, variant: panicB.text }]);
  });

  it("generic packs keep identical texts at different places and merge same-place variants", () => {
    const layout = { sheetId: "X-1.00", associations: [
      hit("TYP.", box(100, 100, 20, 8), { regionId: "r1", regionKind: "drawing_field" }),
      hit("TYP.", box(400, 300, 20, 8), { regionId: "r1", regionKind: "drawing_field" }),
      { ...panicA, regionId: "r1", regionKind: "drawing_field" },
      { ...panicB, regionId: "r1", regionKind: "drawing_field" },
    ] };
    const pack = extractGenericSheetEvidence(layout, { sheetId: "X-1.00", topic: "general" });
    assert.equal(pack.extractedTexts.filter((t) => t === "TYP.").length, 2);
    assert.equal(pack.extractedTexts.filter((t) => t.includes("9975E")).length, 1);
    assert.equal(pack.assessment.readingVariantsMerged.length, 1);
  });
});

describe("C4 design-data field lists", () => {
  const seismic = (texts) => texts.map((t, i) => row(`r${String(i + 1).padStart(2, "0")}`, t, box(1648, 1400 - i * 11, Math.max(40, t.length * 5), 9.5)));
  const S201 = [
    "Ss 0.133", "S1 0.43", "Sds 0.142", "Sdl 0.069", "SITE CLASS D. ASSUMED", "SEISMIC IMPORTANCE FACTOR 1.0",
    "SEISMIC DESIGN CATEGORY", "BASIC SEISMIC FORCE RESISTING SYSTEM:", "ORD. PLAIN REINF MASONRY", "Cs= 0.095",
  ];

  it("splits each field and caption of the S-201 seismic list into its own annotation", () => {
    const model = buildEvidenceModel(seismic(S201));
    const texts = (a) => a.rows.map((rid) => model.rows.find((r) => r.rid === rid).text);
    const groups = model.annotations.map(texts);
    assert.ok(groups.some((g) => g.length === 1 && g[0] === "SITE CLASS D. ASSUMED"), JSON.stringify(groups));
    assert.ok(groups.some((g) => g.length === 1 && g[0] === "SEISMIC DESIGN CATEGORY"), JSON.stringify(groups));
    assert.ok(groups.some((g) => g.length === 1 && g[0] === "SEISMIC IMPORTANCE FACTOR 1.0"), JSON.stringify(groups));
    assert.ok(groups.some((g) => g.join(" / ") === "BASIC SEISMIC FORCE RESISTING SYSTEM: / ORD. PLAIN REINF MASONRY"), JSON.stringify(groups));
  });

  it("keeps the stack joined when the option is off (previous behaviour)", () => {
    const model = buildEvidenceModel(seismic(S201), { fieldLists: false });
    assert.ok(model.annotations.some((a) => a.rows.length >= 3));
  });

  it("does not split a short note with fewer than three fields", () => {
    const model = buildEvidenceModel(seismic(["ROOF LIVE LOAD: 30 PSF", "(NO REDUCTIONS PERMITTED)"]));
    assert.equal(model.annotations.length, 1);
    const note = buildEvidenceModel(seismic(["PROVIDE HORIZONTAL", "JOINT FULL LENGTH", "JUST ABOVE WINDOW HEADER"]));
    assert.equal(note.annotations.length, 1);
  });
});

describe("C3 truncated readings of one place", () => {
  it("absorbs a read that differs only in separators or is a prefix of an alternative (A-6.00 U value)", () => {
    const kept = resolveOverlaps([
      row("r001", "8. DOOR 3, 4. & 4A TO HAVE MAXIMUM U VALUE = 0.61", box(1884, 700, 300, 10), { confidence: 0.5 }),
      row("r002", "DOOR 3, 4, & 4A TO HAVE MAXIMUM U VALUE = 0.61", box(1896, 700, 288, 10)),
      row("r003", "DOOR 3, 4, & 4A TO HAVE", box(1896, 700, 140, 10)),
    ]);
    assert.equal(kept.length, 1);
    assert.deepEqual(kept[0].alternatives, []);
    assert.deepEqual(kept[0].absorbed.sort(), ["r002", "r003"]);
  });

  it("keeps a digit conflict at one place (A-4.00 70 vs 10 DEGREES)", () => {
    const kept = resolveOverlaps([
      row("r001", "FROM 70 DEGREES TO A POINT 3\" FROM", box(638, 880, 200, 10)),
      row("r002", "FROM 10 DEGREES TO A POINT 3\" FROM", box(638, 880, 200, 10)),
    ]);
    assert.equal(kept.length, 1);
    assert.deepEqual(kept[0].alternatives.map((a) => a.text), ["FROM 10 DEGREES TO A POINT 3\" FROM"]);
  });

  it("does not treat separator-free digits as contained (3, 4 vs 34)", () => {
    const kept = resolveOverlaps([
      row("r001", "DOOR 3, 4 TO HAVE CLOSER", box(100, 100, 150, 10)),
      row("r002", "DOOR 34 TO HAVE CLOSER", box(100, 100, 150, 10)),
    ]);
    assert.equal(kept[0].alternatives.length, 1);
  });

  it("renders the U-value row without competing readings", () => {
    const model = buildEvidenceModel([
      row("r001", "8. DOOR 3, 4. & 4A TO HAVE MAXIMUM U VALUE = 0.61", box(1884, 700, 300, 10)),
      row("r002", "DOOR 3, 4, & 4A TO HAVE MAXIMUM U VALUE = 0.61", box(1896, 700, 288, 10)),
      row("r003", "DOOR 3, 4, & 4A TO HAVE", box(1896, 700, 140, 10)),
    ]);
    const [line] = rendered(model);
    assert.ok(!line.includes("{"), line);
    assert.ok(line.includes("U VALUE = 0.61"), line);
  });
});
