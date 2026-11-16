// Offline tests for stage 3 linking, the Qwen recovery adapter and the finding screen:
//   node --test qwen-spatial-audit/tests/
import assert from "node:assert/strict";
import test from "node:test";
import { buildIndex, canonicalSheet, compareOpeningForces, findReferences, openingForces, resolveReference } from "../stage3-link.mjs";
import { qwenRecovery, restrictGroundTruth } from "../lib/qwenRecovery.mjs";
import { screen } from "../eval-findings.mjs";

const box = (x, y, width = 40, height = 8) => ({ x, y, width, height });
const line = (text, x, y, extra = {}) => ({ text, box: box(x, y), ...extra });
const idx = buildIndex({
  sheets: [
    { sheetKey: "A-3.06", status: "indexed", fileName: "A-3.06-00.pdf", page: [2592, 1728], details: [] },
    { sheetKey: "A-5.01", status: "indexed", fileName: "A-5.01-00.pdf", page: [2592, 1728],
      details: [{ detail: "4", title: "GUARDRAIL DETAIL", scale: "1 1/2\"=1'-0\"", titleBox: box(900, 300, 200, 12) }] },
  ],
});

test("canonical sheet keys", () => {
  assert.equal(canonicalSheet("A-3.06-00.pdf"), "A-3.06");
  assert.equal(canonicalSheet("S-201"), "S-201");
  assert.equal(canonicalSheet("S-201.00.pdf"), "S-201");
  assert.equal(canonicalSheet("S-001.00"), "S-001");
  assert.equal(canonicalSheet("A600"), "A-6.00");
  assert.equal(canonicalSheet("TITLE"), null);
});

test("stacked bubble resolves to a text-layer detail; unknown number does not", () => {
  const refs = findReferences("A-3.06", [line("4", 500, 412), line("A-5.01", 495, 400), line("9", 800, 412), line("A-5.01", 795, 400)], idx);
  assert.deepEqual(refs.map((r) => [r.kind, r.detail]), [["detail_bubble", "4"], ["detail_bubble", "9"]]);
  const [ok, missing] = refs.map((r) => resolveReference(r, idx, {}));
  assert.equal(ok.status, "detail_resolved");
  assert.equal(ok.detail.title, "GUARDRAIL DETAIL");
  assert.ok(ok.targetRegion.width > 0 && ok.regionMethod.startsWith("approximate"));
  assert.equal(missing.status, "detail_not_found_on_target");
});

test("own title-block number and sheets outside the index are not resolved links", () => {
  const refs = findReferences("A-3.06", [line("A-3.06", 2400, 60), line("SEE M-9.99 FOR DUCTS", 300, 300)], idx);
  assert.equal(refs.length, 1);
  assert.equal(resolveReference(refs[0], idx, {}).status, "not_in_82_sheet_index");
});

test("different opening-force conditions are not a contradiction", () => {
  const st = openingForces("A-6.00", [
    line("MAX DOOR OPENING FORCE EXTERIOR 8 1/2 LBS", 0, 0),
    line("INTERIOR DOORS MAX OPENING FORCE 5 LBS", 0, 20),
    line("INTERIOR DOOR PUSH 5 LBS", 0, 40),
  ]);
  const cmp = compareOpeningForces(st);
  assert.deepEqual(cmp.map((c) => [c.condition, c.status]).sort(), [["exterior", "single_sheet"], ["interior", "single_sheet"]]);
});

test("qwen recovery keeps both conflicting readings and flags uncertain lines", () => {
  const rec = qwenRecovery({ backend: "t", page: { width: 2592, height: 1728 }, lines: [
    { lid: "L1", text: "70 DEGREES", conflict: true, alternatives: ["10 DEGREES"], uncertain: false, box: box(10, 10) },
    { lid: "L2", text: "EXTERIC", conflict: false, alternatives: [], uncertain: true, box: box(10, 30) },
  ] });
  assert.deepEqual(rec.pages[0].lines.map((l) => [l.text, l.confidence]), [["70 DEGREES", 1], ["10 DEGREES", 1], ["EXTERIC", 0.5]]);
});

test("ground truth restricted to read tiles drops partly covered annotations", () => {
  const gt = { rows: [{ gid: "a", box: box(10, 10) }, { gid: "b", box: box(500, 500) }], annotations: [{ id: "x", rows: ["a"] }, { id: "y", rows: ["a", "b"] }] };
  const r = restrictGroundTruth(gt, [box(0, 0, 200, 200)]);
  assert.deepEqual(r.annotations.map((a) => a.id), ["x"]);
  assert.deepEqual(r.rows.map((x) => x.gid), ["a"]);
});

test("finding screen separates genuine gaps from known traps", () => {
  const f = (title, observation, severity = "warning") => ({ title, observation, severity, drawing_evidence: "" });
  assert.equal(screen(f("Seismic design category missing", "SEISMIC DESIGN CATEGORY is not specified."), "S-201.00").screen, "G-S201-SDC");
  assert.equal(screen(f("Guardrail height", "Guardrail height is not specified."), "A-3.06-00").screen, "T-A306-GUARD");
  assert.equal(screen(f("Guardrail height", "Guardrail height 3'-6\" min is shown."), "A-3.06-00").screen, null);
  assert.equal(screen(f("Opening force conflict", "8 1/2 lbs exterior and 5 lbs interior are inconsistent."), "A-6.00-00").screen, "T-A600-FORCE");
});
