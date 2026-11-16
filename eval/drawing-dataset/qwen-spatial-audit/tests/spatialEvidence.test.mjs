// Offline tests for the experimental spatial evidence selector: node --test qwen-spatial-audit/tests/
import assert from "node:assert/strict";
import test from "node:test";
import { buildSpatialEvidence, questionEvidence, retrieveEvidence } from "../lib/spatialEvidence.mjs";

const box = (x, y, width = 120, height = 10) => ({ x, y, width, height });
const line = (lid, text, x, y, extra = {}) => ({ lid, text, box: box(x, y), conflict: false, alternatives: [], uncertain: false,
  provenance: [{ tileId: "r00c00" }], confidenceBasis: { selfReportedUncertain: false }, ...extra });

function sheet(lines, annotations) {
  return { sheetId: "T-1", discipline: "Test", model: "m", page: { width: 2592, height: 1728 }, layout: {}, lines,
    annotations: annotations || lines.map((l, i) => ({ aid: `N${i}`, lines: [l.lid] })) };
}
const detail = { number: "2", title: "GUARD RAIL DETAIL", scale: "3/4\" = 1'-0\"", titleBox: box(100, 100, 200, 12), region: { x: 60, y: 80, width: 900, height: 600 } };

test("tile-seam fragments and overlap duplicates are not delivered twice", () => {
  const { block, pack } = buildSpatialEvidence(sheet([
    line("L0", "EXTERIOR PLYWOOD 1/2\"", 200, 300),
    line("L1", "XTERIOR PLYWOOD 1/2\"", 205, 300),
    line("L2", "3'-6\" MIN.", 200, 400),
  ]), { details: [detail] });
  assert.equal((block.match(/PLYWOOD/g) || []).length, 1);
  assert.deepEqual(pack.suppressedLines, [{ lid: "L1", duplicateOf: "L0" }]);
  assert.match(block, /## 2 GUARD RAIL DETAIL \(3\/4" = 1'-0"\)/);
});

test("uncertain and conflicting readings keep their markers; only a tile-edge cut is not a conflict", () => {
  const reads = (full, fullPx, short, shortPx) => [{ tileId: "r00c03", text: full, px: fullPx }, { tileId: "r00c02", text: short, px: shortPx }];
  const { block, pack } = buildSpatialEvidence(sheet([
    line("L0", "A-4.0I", 200, 300, { uncertain: true, valueChecks: [{ status: "flagged_ambiguous" }] }),
    line("L1", "70 DEGREES", 200, 340, { conflict: true, uncertain: true, alternatives: ["10 DEGREES"] }),
    line("L2", "GUARD RAIL SHALL BE 42\"", 200, 380, { conflict: true, uncertain: true, alternatives: ["GUAR"],
      provenance: reads("GUARD RAIL SHALL BE 42\"", { x: 67, y: 766, w: 775, h: 35 }, "GUAR", { x: 909, y: 766, w: 58, h: 35 }) }),
    line("L3", "2 ALUM.", 200, 420, { conflict: true, uncertain: true, alternatives: ["2"],
      provenance: reads("2 ALUM.", { x: 73, y: 579, w: 183, h: 31 }, "2", { x: 913, y: 579, w: 19, h: 33 }) }),
  ]), { details: [detail] });
  assert.match(block, /\?A-4\.0I/);
  assert.match(block, /\{70 DEGREES \| 10 DEGREES\}/);
  assert.match(block, /- e\d+ GUARD RAIL SHALL BE 42"/);
  assert.match(block, /\{2 ALUM\. \| 2\}/);
  const seam = pack.shown.flatMap((u) => u.copies.flatMap((c) => c.lines)).find((l) => l.lid === "L2");
  assert.deepEqual(seam.cutReadings, ["GUAR"]);
});

test("block stays within the character budget and reports what it omitted", () => {
  const lines = Array.from({ length: 200 }, (_, i) => line(`L${i}`, `${i}'-${i % 12}" MIN. ABOVE DECK ${i}`, 100 + (i % 10) * 130, 90 + Math.floor(i / 10) * 25));
  const { block, pack } = buildSpatialEvidence(sheet(lines), { details: [detail], maxChars: 1500 });
  assert.ok(block.length <= 1500, `block ${block.length} chars`);
  assert.ok(pack.omitted.length > 0);
  assert.match(block, /omitted \d+ \(\d+ technical\) by budget/);
});

test("retrieval reaches omitted units with their source ids", () => {
  const lines = [line("L0", "GROUND SNOW LOAD: 25 PSF + DRIFT", 1500, 500), line("L1", "FLAT ROOF SNOW LOAD: 17.5 PSF", 1500, 480)];
  const { pack } = buildSpatialEvidence(sheet(lines), { details: [], maxChars: 520 });
  const r = retrieveEvidence(pack, "ground snow load");
  assert.ok(r.units.some((u) => u.text.includes("25 PSF")));
  assert.ok(r.units[0].copies[0].lines[0].tiles.includes("r00c00"));
});

test("question sections cite summary units by id and quote omitted units and captions", () => {
  const lines = [
    line("L0", "SEISMIC IMPORTANCE FACTOR 1.0", 1500, 500),
    line("L1", "SEISMIC DESIGN CATEGORY", 1500, 480),
    line("L2", "BASIC WIND SPEED (3 SECOND GUST) 115 MPH", 1500, 300),
    line("L3", "SCALE: 3/4\"1'-0\"", 120, 95),
  ];
  const { pack } = buildSpatialEvidence(sheet(lines), { details: [detail], maxChars: 330 });
  const shownSeismic = pack.shown.find((u) => u.text.startsWith("SEISMIC"));
  const { block, asked } = questionEvidence(pack);
  assert.ok(pack.captions.some((u) => u.text.includes("SCALE")));
  assert.match(block, /### Q-TITLE[^#]*c\d+ \[detail title [^\]]+\] SCALE: 3\/4"1'-0"/);
  assert.match(block, /### Q-WIND[^#]*o\d+ \[sheet\] BASIC WIND SPEED/);
  if (shownSeismic) assert.match(block, new RegExp(`### Q-SEISMIC[^#]*in summary: [^\\n]*${shownSeismic.id}\\b`));
  assert.ok(!/WINDOW/.test(block));
  assert.ok(asked.some((q) => q.id === "Q-SEISMIC"));
});
