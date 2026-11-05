/**
 * Stage 3 v2 format tie-break (model r4): competing readings that differ only in glyphs Vision confuses
 * resolve to the well-formed number, dimension or sheet reference; anything else keeps the conflict.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildEvidenceModel, formatTieBreak } from "../lib/stage3AnnotationModel.mjs";
import { buildStage3V2Pack } from "../lib/stage3TechnicalDigest.mjs";
import { STAGE3_V2_MODEL_REVISION } from "../lib/stage3EvidenceConfig.mjs";

const box = (x, y, width, height) => ({ x, y, width, height });
const reading = (text) => ({ text, confidence: 1, box: box(100, 200, 120, 8), words: [{ text, box: box(100, 200, 120, 8), confidence: 1 }] });
const contested = (text, ...others) => ({ rid: "r001", ...reading(text), vertical: false, alternatives: others.map((t, i) => ({ rid: `r00${i + 2}`, ...reading(t) })) });

describe("format tie-break", () => {
  it("keeps the well-formed reading when the others differ only by confusable glyphs or marks", () => {
    for (const [a, b, kept] of [
      ["12'-O\"", "12'-0\"", "12'-0\""],
      ["25-0 A.F.F", "25'-0\" A.F.F.", "25'-0\" A.F.F."],
      ["SHEET A-I.03 FOR SCHEDULE.", "SHEET A-1.03 FOR SCHEDULE.", "SHEET A-1.03 FOR SCHEDULE."],
      ["-I-1/4\" PIPE RAILING.", "-1-1/4\" PIPE RAILING.", "-1-1/4\" PIPE RAILING."],
      ["I\" GAP TOP OF STUD TO TRACK", "1\" GAP TOP OF STUD TO TRACK", "1\" GAP TOP OF STUD TO TRACK"],
    ]) {
      const r = formatTieBreak(contested(a, b));
      assert.equal(r.text, kept, a);
      assert.deepEqual(r.alternatives, []);
      assert.deepEqual(r.formatRejected, [a === kept ? b : a]);
      assert.equal(r.words[0].text, kept);
    }
  });

  it("keeps the conflict when the glyphs differ, both or neither reading is well formed, or tokens do not align", () => {
    for (const [a, b] of [
      ["DOOR 4010", "DOOR 4070"],
      ["9975EO-LD", "9975E0-LD"],
      ["(2)#IO SCREWS", "(2)#10 SCREWS"],
      ["1-1/4\" PIPE", "1 -1/4\" PIPE"],
      ["12'-0\"", "12'-6\""],
    ]) {
      const r = formatTieBreak(contested(a, b));
      assert.equal(r.text, a, `${a} / ${b}`);
      assert.equal(r.alternatives.length, 1);
      assert.equal(r.formatRejected, undefined);
    }
  });

  it("resolves only when one reading beats every other", () => {
    const r = formatTieBreak(contested("12'-O\"", "12'-0\"", "12'-6\""));
    assert.equal(r.text, "12'-O\"");
    assert.equal(r.alternatives.length, 2);
  });

  it("applies by default in the model, keeps rejected readings in the pack and out of the prompt", () => {
    const rows = [{ rid: "r001", ...reading("12'-O\""), vertical: false }, { rid: "r002", ...reading("12'-0\""), vertical: false }];
    const on = buildEvidenceModel(rows);
    const off = buildEvidenceModel(rows, { formatTieBreak: false });
    assert.equal(on.rows.length, 1);
    assert.equal(on.rows[0].text, "12'-0\"");
    assert.equal(off.rows[0].alternatives.length, 1);
    const pack = buildStage3V2Pack({ sheetId: "T-1", model: on });
    assert.deepEqual(pack.evidenceModel.rows[0].formatRejected, ["12'-O\""]);
    assert.ok(pack.promptBlock.includes("12'-0\""));
    assert.ok(!pack.promptBlock.includes("12'-O\""));
  });

  it("bumps the v2 model revision so cached r5 packs are rebuilt", () => {
    assert.equal(STAGE3_V2_MODEL_REVISION, "model.r6-downstream");
  });
});
