import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  STAGE3_SPIKE_VERSION,
  compareModes,
  evaluateCriticalControls,
  extractDoorScheduleEvidence,
  extractGuardrailDetailEvidence,
  extractHydraulicEvidence,
  formatStage3PromptBlock,
} from "../lib/stage3VisualExtractionSpike.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const datasetOut = path.resolve(__dirname, "../out/mcd-649fdaa6");

const SHEETS = {
  "A-3.06": "c20cc018310747ea435c888f7c1b1d4884ef8d1054b16da9ab770a504a33b6cf",
  "A-6.00": "28369090ce34e1d503f9364bc293f9be51ff37bb521dd50a86968b472411c56d",
  FP200: "983bbfcf38083ff04c7b5c93092f2267f3d5776a01f92ff71411460107127dea",
};

function loadLayout(sha) {
  const file = path.join(datasetOut, "layout-full/pages", `${sha}.json`);
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, "utf8"));
}

describe("Stage 3 visual extraction spike", () => {
  it("versions and provenance stay unverified", () => {
    assert.match(STAGE3_SPIKE_VERSION, /stage3-visual-extraction-spike/);
  });

  it("A-3.06 recovers 3'-6\" MIN HEIGHT and associates to guardrail detail via OCR", () => {
    const layout = loadLayout(SHEETS["A-3.06"]);
    assert.ok(layout, "requires local layout-full cache for A-3.06");
    const stage3 = extractGuardrailDetailEvidence(layout, { mode: "stage3_visual" });
    const textOnly = extractGuardrailDetailEvidence(layout, { mode: "text_layer_only" });
    assert.equal(stage3.provenance.independentlyVerified, false);
    assert.ok(stage3.extractedTexts.some((text) => /3\s*['′]\s*-?\s*6/i.test(text)));
    assert.equal(stage3.assessment.status, "associated_to_guardrail_detail");
    assert.match(String(stage3.assessment.detailIdentifier || ""), /GUARD\s*RAIL/i);
    assert.ok(stage3.hits.visualHeightHits >= 1);
    // Stage 1–2 text-layer path should miss CAD-outlined height.
    assert.equal(textOnly.hits.heightExact, 0);
    const cmp = compareModes(stage3, textOnly);
    assert.equal(cmp.improvement, true);
    const prompt = formatStage3PromptBlock(stage3);
    assert.match(prompt, /independentlyVerified=false/);
    assert.match(prompt, /3\s*['′]\s*-?\s*6/i);
  });

  it("A-3.06 does not treat generic MIN ABOVE DECK as guardrail height clearance", () => {
    const layout = loadLayout(SHEETS["A-3.06"]);
    assert.ok(layout);
    const stage3 = extractGuardrailDetailEvidence(layout, { mode: "stage3_visual" });
    assert.ok(Array.isArray(stage3.assessment.rejectedGenericHeights));
    assert.equal(stage3.assessment.applicableToGuardrail, "likely_same_detail_candidate");
  });

  it("A-6.00 recovers locking and fire notes with schedule structure signals", () => {
    const layout = loadLayout(SHEETS["A-6.00"]);
    assert.ok(layout, "requires local layout-full cache for A-6.00");
    const stage3 = extractDoorScheduleEvidence(layout, { mode: "stage3_visual" });
    const textOnly = extractDoorScheduleEvidence(layout, { mode: "text_layer_only" });
    assert.equal(stage3.status, "evidence_recovered");
    assert.equal(stage3.assessment.present.lockingHardware, true);
    assert.equal(stage3.assessment.present.fireRatingNotes, true);
    assert.ok(stage3.hits.visualHardware >= 1);
    assert.ok(stage3.assessment.sampleRows.length >= 1);
    assert.ok(stage3.extractedTexts.some((text) => /PANIC|SCHLAGE|LOCK/i.test(text)));
    assert.ok(stage3.extractedTexts.some((text) => /FIRE\s*RATED|GASKET/i.test(text)));
    // Text-layer alone is weaker on this CAD sheet.
    assert.ok(stage3.hits.hardware >= textOnly.hits.hardware);
    const controls = evaluateCriticalControls(stage3);
    assert.equal(controls.controls[0].retainedIfGenerated, true);
    assert.equal(controls.independentlyVerified, false);
  });

  it("FP200 regression still recovers hydraulic values (density×area ≠ flow)", () => {
    const layout = loadLayout(SHEETS.FP200);
    assert.ok(layout, "requires local layout-full cache for FP200");
    const stage3 = extractHydraulicEvidence(layout, { mode: "stage3_visual" });
    const textOnly = extractHydraulicEvidence(layout, { mode: "text_layer_only" });
    assert.equal(stage3.status, "evidence_recovered");
    assert.equal(stage3.assessment.values.densityGpmPerSqFt, 0.15);
    assert.equal(stage3.assessment.values.dischargeAreaSqFt, 1524);
    assert.ok(stage3.assessment.values.flowDemandGpm != null);
    assert.equal(
      stage3.assessment.relationships.densityAreaEqualsFlowDemand,
      false,
    );
    // Text-rich sheet: Stage 1–2 should also recover (regression control).
    assert.equal(textOnly.status, "evidence_recovered");
    assert.match(formatStage3PromptBlock(stage3), /density×area≠flowDemand/);
  });

  it("fail-open formatting tolerates empty packs", () => {
    const empty = formatStage3PromptBlock({
      id: "x",
      topic: "guardrail_detail_height",
      status: "not_found",
      extractedTexts: [],
      provenance: { method: "stage3_detail_spatial_association" },
      limitations: ["not recovered"],
    });
    assert.match(empty, /excerpts: \(none/);
    assert.match(empty, /not proof of absence/i);
  });
});
