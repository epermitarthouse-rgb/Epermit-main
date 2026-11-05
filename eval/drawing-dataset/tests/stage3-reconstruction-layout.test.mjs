/**
 * Phase 3: page geometry, rule-aware row splits, text-layer echo filter, title-block grounding,
 * ruled-table records, and the worker's fail-open geometry step.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { detectRules, ruleBetween } from "../lib/stage3PageGeometry.mjs";
import { splitLineWords, textLayerEcho, reconstructRows, rowsFromRecoveryPage } from "../lib/stage3RowReconstruct.mjs";
import { detectTitleBlockBorder, groundLayoutRegions } from "../lib/stage3TitleBlockDetect.mjs";
import { buildEvidenceModel, tableRowBand } from "../lib/stage3AnnotationModel.mjs";
import { renderAnnotation } from "../lib/stage3TechnicalDigest.mjs";
import { buildStage3V2Model } from "../lib/stage3EvidenceV2.mjs";
import { buildV2Envelope, pageGeometryForJob, v2CacheKey } from "../lib/stage3MacOcrWorker.mjs";
import { evaluateEchoFilter } from "../lib/stage3EvidenceEval.mjs";
import { STAGE3_V2_MODEL_REVISION } from "../lib/stage3EvidenceConfig.mjs";

const box = (x, y, width, height) => ({ x, y, width, height });
const word = (text, x, y, width, height = 9) => ({ text, box: box(x, y, width, height), confidence: 1 });
let n = 0;
const row = (text, x, y, width, height = 9) => ({
  rid: `t${++n}`, text, box: box(x, y, width, height), vertical: false, confidence: 1, words: [word(text, x, y, width, height)],
});

/** A 3-column ruled table: rows bands 100-113, 113-126, 126-139, 139-152; columns at 200 and 300. */
function tableGeometry() {
  return {
    version: "test", pageWidth: 1000, pageHeight: 600,
    horizontal: [100, 113, 126, 139, 152].map((y) => ({ y, x0: 100, x1: 400 })),
    vertical: [100, 200, 300, 400].map((x) => ({ x, y0: 100, y1: 152 })),
  };
}

describe("page geometry", () => {
  it("measures vertical and horizontal rules in PDF points (origin bottom-left)", () => {
    const w = 100, h = 100, data = new Uint8ClampedArray(w * h * 4).fill(255);
    const ink = (x, y) => { const i = (y * w + x) * 4; data[i] = data[i + 1] = data[i + 2] = 0; };
    for (let y = 10; y < 90; y++) { ink(50, y); ink(51, y); }
    for (let x = 10; x < 90; x++) ink(x, 20);
    const g = detectRules({ data }, w, h, { density: 2, pageHeight: 50, minRulePt: 8 });
    assert.deepEqual(g.vertical.map(({ x, y0, y1 }) => ({ x, y0, y1 })), [{ x: 25.5, y0: 5, y1: 45 }]);
    assert.equal(g.horizontal.length, 1);
    assert.equal(g.horizontal[0].x0, 5);
    assert.equal(g.horizontal[0].x1, 45);
  });

  it("finds a rule only strictly between two x positions and across the whole band", () => {
    const g = { vertical: [{ x: 50, y0: 0, y1: 20 }] };
    assert.equal(ruleBetween(g, { xLeft: 40, xRight: 60, yLow: 5, yHigh: 15 }), true);
    assert.equal(ruleBetween(g, { xLeft: 50, xRight: 60, yLow: 5, yHigh: 15 }), false);
    assert.equal(ruleBetween(g, { xLeft: 40, xRight: 60, yLow: 5, yHigh: 25 }), false);
  });
});

describe("rule-aware row splits", () => {
  const ws = [word("W8", 280, 115, 17), word("LR", 302, 115, 10)];
  it("splits a line at a long printed rule even when the gap is small", () => {
    const parts = splitLineWords(ws, false, { vertical: [{ x: 300, y0: 100, y1: 152 }] });
    assert.equal(parts.length, 2);
    assert.deepEqual(parts.reasons, [null, "rule"]);
  });
  it("ignores glyph-length strokes and keeps the line whole without geometry", () => {
    assert.equal(splitLineWords(ws, false, { vertical: [{ x: 300, y0: 115, y1: 123 }] }).length, 1);
    assert.equal(splitLineWords(ws, false, null).length, 1);
  });
  it("records the split source and reason on rows", () => {
    const page = { words: ws, lines: [{ text: "W8 LR", box: box(280, 115, 32, 9), words: 2 }] };
    const rows = rowsFromRecoveryPage(page, { geometry: { vertical: [{ x: 300, y0: 100, y1: 152 }] } });
    assert.deepEqual(rows.map((r) => [r.text, r.splitFrom, r.splitBy]), [["W8", "W8 LR", "rule"], ["LR", "W8 LR", "rule"]]);
    assert.equal(rowsFromRecoveryPage(page).length, 1);
  });
});

describe("text-layer echo filter", () => {
  const spans = [{ text: "GENERAL NOTES", box: box(98, 98, 104, 14) }];
  it("drops a row that re-reads text-layer glyphs", () => {
    assert.deepEqual(textLayerEcho(row("G", 100, 100, 8), spans), ["GENERAL NOTES"]);
  });
  it("keeps rows with low coverage or characters not in the span", () => {
    assert.equal(textLayerEcho(row("12'-0\"", 180, 100, 60), spans), null);
    assert.equal(textLayerEcho(row("X", 100, 100, 8), spans), null);
  });
  it("keeps real text that the text layer also carries, and drops single-glyph duplicates", () => {
    const fp = [{ text: "155 °F", box: box(98, 98, 34, 14) }, { text: "1/2\"", box: box(198, 98, 24, 14) }, { text: "3", box: box(298, 98, 10, 14) }];
    assert.equal(textLayerEcho(row("155 °F", 100, 100, 30), fp), null);
    assert.equal(textLayerEcho(row("1/2\"", 200, 100, 20), fp), null);
    assert.equal(textLayerEcho(row("GENERAL NOTES", 100, 100, 100), spans), null);
    assert.deepEqual(textLayerEcho(row("3", 300, 100, 6), fp), ["3"]);
  });
  it("reconstructRows returns kept rows and excluded echoes", () => {
    const page = { words: [], lines: [{ text: "G", box: box(100, 100, 8, 9) }, { text: "3'-6\" MIN", box: box(500, 100, 50, 9) }] };
    const { rows, echoes } = reconstructRows(page, { textSpans: spans });
    assert.deepEqual(rows.map((r) => r.text), ["3'-6\" MIN"]);
    assert.deepEqual(echoes.map((e) => e.text), ["G"]);
  });
  it("harness scores removed echoes and real rows dropped", () => {
    const gt = { rows: [{ box: box(500, 100, 50, 9) }], noise: { textLayerEcho: [box(100, 100, 8, 9)] } };
    assert.deepEqual(evaluateEchoFilter([{ text: "G", box: box(100, 100, 8, 9) }], gt, []),
      { excluded: 1, removedEcho: 1, keptEcho: 0, realDropped: 0, realDroppedTexts: [] });
  });
});

describe("title-block grounding", () => {
  const regions = [
    { id: "band-title-block", kind: "title_block" }, { id: "band-drawing-field", kind: "drawing_field" },
    { id: "band-bottom-notes", kind: "notes_band" }, { id: "schedule-1", kind: "schedule_candidate" },
  ];
  it("uses the right-most near-full-height rule as the title-block border", () => {
    const g = { pageWidth: 1000, pageHeight: 600, vertical: [{ x: 40, y0: 10, y1: 590 }, { x: 890, y0: 10, y1: 590 }, { x: 920, y0: 300, y1: 400 }] };
    assert.equal(detectTitleBlockBorder(g).x, 890);
    const out = groundLayoutRegions(regions, g);
    assert.equal(out.titleBlock.method, "printed_rule");
    assert.deepEqual(out.regions.map((r) => r.id), ["rule-title-block", "rule-drawing-field", "schedule-1"]);
    assert.equal(out.regions[0].bbox.x, 890);
  });
  it("keeps the heuristic bands and records why", () => {
    assert.deepEqual(groundLayoutRegions(regions, null).titleBlock, { method: "heuristic_band", reason: "page_geometry_unavailable" });
    const noRule = groundLayoutRegions(regions, { pageWidth: 1000, pageHeight: 600, vertical: [{ x: 890, y0: 10, y1: 200 }] });
    assert.equal(noRule.titleBlock.reason, "no_full_height_rule");
    assert.equal(noRule.regions, regions);
  });
});

describe("ruled-table records", () => {
  it("joins the cells of one ruled row into a record, read cell by cell", () => {
    const g = tableGeometry();
    const rows = [
      row("1", 110, 115, 8), row("ALUM.", 210, 115, 30), row("3'-0\"x7'-0\"", 310, 115, 60),
      row("2", 110, 128, 8), row("H.M.", 210, 128, 25), row("2\"JAMB", 310, 133, 40, 5), row("4\"HD", 310, 127, 30, 5),
    ];
    const model = buildEvidenceModel(rows, { geometry: g });
    const records = model.annotations.filter((a) => a.layout === "record");
    assert.equal(records.length, 2);
    const byId = new Map(model.rows.map((r) => [r.rid, r]));
    assert.deepEqual(records.map((a) => renderAnnotation(a, byId)).sort(), ["- 1 ; ALUM. ; 3'-0\"x7'-0\"", "- 2 ; H.M. ; 2\"JAMB / 4\"HD"]);
  });
  it("never forms records without a ruled grid (dimension lines, detail frames)", () => {
    const g = { horizontal: [{ y: 100, x0: 100, x1: 400 }, { y: 113, x0: 100, x1: 400 }], vertical: [{ x: 200, y0: 90, y1: 130 }] };
    const model = buildEvidenceModel([row("EQ.", 120, 102, 20), row("EQ.", 220, 102, 20)], { geometry: g });
    assert.equal(model.annotations.filter((a) => a.layout === "record").length, 0);
    assert.equal(model.annotations.length, 2);
  });
  it("rejects a cell whose OCR box crosses a row rule", () => {
    const g = tableGeometry();
    assert.ok(tableRowBand(row("1", 110, 115, 8), g));
    assert.equal(tableRowBand(row("2", 110, 108, 8, 20), g), null);
  });
  it("builds records only with page geometry", () => {
    const recovery = { pages: [{ words: [], lines: [{ text: "1", box: box(110, 115, 8, 9) }, { text: "ALUM.", box: box(210, 115, 30, 9) }] }] };
    const withG = buildStage3V2Model({ layout: { regions: [] }, recovery, geometry: tableGeometry() });
    const without = buildStage3V2Model({ layout: { regions: [] }, recovery });
    assert.equal(withG.layoutProvenance.records, 1);
    assert.equal(without.layoutProvenance.records, 0);
    assert.deepEqual(without.layoutProvenance.geometry, { status: "unavailable" });
  });
});

describe("worker v2 page geometry step", () => {
  const job = { sheetId: "T-1", relativePath: "T-1.pdf", contentSha256: "abc", pdfPath: null };
  const recovery = { pages: [{ words: [], lines: [{ text: "1", box: box(110, 115, 8, 9) }, { text: "ALUM.", box: box(210, 115, 30, 9) }] }] };
  it("is fail-open: missing PDF, disabled, and render failure give no geometry with the reason", async () => {
    assert.deepEqual(await pageGeometryForJob(job), { geometry: null, reason: "pdf_unavailable" });
    assert.deepEqual(await pageGeometryForJob(job, { pageGeometry: false }), { geometry: null, reason: "disabled" });
    const failing = await pageGeometryForJob({ ...job, pdfPath: new URL(import.meta.url).pathname }, {
      renderPageGeometry: async () => { throw new Error("canvas unavailable"); },
    });
    assert.deepEqual(failing, { geometry: null, reason: "render_failed:canvas unavailable" });
  });
  it("keys the cache on the model revision and geometry use, and records the layout method", () => {
    assert.notEqual(v2CacheKey("abc", true), v2CacheKey("abc", false));
    assert.equal(v2CacheKey("abc", false), `abc.macos-vision.phase3.stage3-visual-evidence.v2.${STAGE3_V2_MODEL_REVISION}.no-page-geometry`);
    const without = buildV2Envelope(job, { layout: { regions: [] }, recovery, geometryReason: "pdf_unavailable" });
    assert.equal(without.cacheKey, v2CacheKey("abc", false));
    assert.equal(without.extractionVersion, "phase3.stage3-visual-evidence.v2");
    assert.deepEqual(without.provenance.layout.geometry, { status: "unavailable", reason: "pdf_unavailable" });
    assert.equal(without.provenance.layout.titleBlock.method, "heuristic_band");
    const withG = buildV2Envelope(job, { layout: { regions: [] }, recovery, geometry: tableGeometry() });
    assert.equal(withG.cacheKey, v2CacheKey("abc", true));
    assert.equal(withG.provenance.layout.records, 1);
    assert.match(withG.promptBlock, /- 1 ; ALUM\./);
  });
});
