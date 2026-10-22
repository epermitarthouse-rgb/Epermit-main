import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { buildUciStageHistory } from "@/lib/uciStageHistory";
import {
  buildUciDemoSnapshot,
  UCI_DEMO_LABEL,
  UCI_DEMO_STEP_COUNT,
  UCI_DEMO_TRANSITIONS,
  uciDemoStepForStage,
} from "./uciDemoScenario";

const __dirname = dirname(fileURLToPath(import.meta.url));

function historyAt(step: number) {
  const snapshot = buildUciDemoSnapshot(step);
  return buildUciStageHistory({
    detail: snapshot.detail,
    providerName: "Demo provider",
    documents: snapshot.documents,
    communications: snapshot.communications,
  });
}

describe("UCI interactive demo scenario", () => {
  it("is labeled as simulated", () => {
    assert.match(UCI_DEMO_LABEL, /Simulated demo/);
    const record = buildUciDemoSnapshot(UCI_DEMO_STEP_COUNT - 1).detail.record;
    assert.equal(record.metadata.simulated, true);
  });

  it("advances one stage at a time in chronological order", () => {
    const times = UCI_DEMO_TRANSITIONS.map((row) => row.created_at);
    assert.deepEqual(times, [...times].sort());
    const advances = UCI_DEMO_TRANSITIONS.filter(
      (row) => row.from_stage !== null && row.from_stage !== row.to_stage,
    ).map((row) => [row.from_stage, row.to_stage]);
    assert.deepEqual(advances, [1, 2, 3, 4, 5, 6, 7, 8, 9].map((stage) => [stage, stage + 1]));
  });

  it("shows every stage completed with evidence at the end of the timeline", () => {
    const model = historyAt(UCI_DEMO_STEP_COUNT - 1);
    assert.equal(model.savedStage, 10);
    for (const stage of model.stages) {
      assert.equal(stage.position, "completed", `stage ${stage.stage}`);
      assert.ok(stage.completionEvidence.length > 0, `stage ${stage.stage} has evidence`);
    }
  });

  it("hides later evidence earlier in the timeline", () => {
    const step = uciDemoStepForStage(4);
    const snapshot = buildUciDemoSnapshot(step);
    assert.equal(snapshot.detail.record.current_stage, 4);
    assert.equal(snapshot.facts.submitted, true);
    assert.equal(snapshot.facts.acknowledged, false);
    assert.equal(snapshot.detail.costs.length, 0);
    assert.ok(snapshot.communications.every((row) => String(row.message_timestamp) <= snapshot.cutoff));

    const model = historyAt(step);
    assert.deepEqual(
      model.stages.map((stage) => stage.position),
      ["completed", "completed", "completed", "completed", ...Array(6).fill("not_reached")],
    );
  });

  it("does not use live UCI APIs, storage, or Supabase", () => {
    for (const file of [
      join(__dirname, "uciDemoScenario.ts"),
      join(__dirname, "UciDemoStageWorkspaces.tsx"),
      join(__dirname, "..", "UciLifecycleDemo.tsx"),
    ]) {
      const source = readFileSync(file, "utf8");
      assert.doesNotMatch(source, /uciApi|supabase|fetch\(/, file);
    }
    const demoSource = readFileSync(join(__dirname, "..", "UciLifecycleDemo.tsx"), "utf8");
    assert.match(demoSource, /preloaded=\{/);
  });
});
