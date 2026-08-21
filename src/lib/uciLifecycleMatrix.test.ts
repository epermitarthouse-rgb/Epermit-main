import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildStageStateMatrix } from "./uciLifecycleMatrix.js";
import { getWorkflowGroupProgress } from "./uciWorkspaceGuidance.js";

describe("uciLifecycleMatrix current-stage distribution", () => {
  it("counts each record only under its current_stage (Highland Springs shape)", () => {
    const records = [
      { current_stage: 6, current_stage_state: "IN_PROGRESS", utility_type: "electric" },
      { current_stage: "1", current_stage_state: "IN_PROGRESS", utility_type: "gas" },
      { current_stage: 1, current_stage_state: "BLOCKED", utility_type: "water" },
      { current_stage: 1, current_stage_state: "BLOCKED", utility_type: "sewer" },
      { current_stage: 1, current_stage_state: "BLOCKED", utility_type: "telecom" },
    ];
    const matrix = buildStageStateMatrix(records);
    assert.equal(matrix.stages.get(1)?.recordCount, 4);
    assert.equal(matrix.stages.get(6)?.recordCount, 1);
    assert.equal(matrix.stages.get(2)?.recordCount, 0);
    assert.equal(matrix.countedRecords, 5);
  });

  it("does not copy Stage 6 IN_PROGRESS into Stage 1 after gas is BLOCKED", () => {
    const records = [
      { current_stage: 6, current_stage_state: "IN_PROGRESS", utility_type: "electric" },
      { current_stage: 1, current_stage_state: "BLOCKED", utility_type: "gas" },
    ];
    const matrix = buildStageStateMatrix(records);
    assert.equal(matrix.stages.get(1)?.states.IN_PROGRESS ?? 0, 0);
    assert.equal(matrix.stages.get(1)?.states.BLOCKED, 1);
    assert.equal(matrix.stages.get(6)?.states.IN_PROGRESS, 1);
  });

  it("Stage 9 record counts once in distribution while stages 1-8 show completed in progress view", () => {
    const records = [
      { current_stage: 9, current_stage_state: "IN_PROGRESS", utility_type: "electric" },
      { current_stage: 1, current_stage_state: "BLOCKED", utility_type: "gas" },
      { current_stage: 1, current_stage_state: "BLOCKED", utility_type: "water" },
      { current_stage: 1, current_stage_state: "BLOCKED", utility_type: "sewer" },
    ];
    const matrix = buildStageStateMatrix(records);

    assert.equal(matrix.stages.get(9)?.recordCount, 1);
    assert.equal(matrix.stages.get(9)?.states.IN_PROGRESS, 1);
    for (const stage of [2, 3, 4, 5, 6, 7, 8]) {
      assert.equal(matrix.stages.get(stage)?.recordCount, 0, `stage ${stage} should be empty in distribution`);
    }
    assert.equal(matrix.stages.get(1)?.recordCount, 3);

    const currentStage = 9;
    for (let s = 1; s <= 8; s += 1) {
      assert.equal(
        getWorkflowGroupProgress([s, s], currentStage),
        "completed",
        `stage ${s} should read as completed in progress rail`,
      );
    }
    assert.equal(getWorkflowGroupProgress([9, 9], currentStage), "current");
    assert.equal(getWorkflowGroupProgress([10, 10], currentStage), "upcoming");
  });
});
