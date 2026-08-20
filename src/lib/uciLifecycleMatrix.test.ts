import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  assertStageStateMatrixInvariants,
  buildStageStateMatrix,
  isUnassignedRequiredProvider,
  providerNeedsConfirmationReason,
  stageStateEntries,
} from "./uciLifecycleMatrix.ts";

describe("uciLifecycleMatrix", () => {
  it("counts each record only under its current_stage (Highland Springs shape)", () => {
    const records = [
      { id: "electric", current_stage: 6, current_stage_state: "IN_PROGRESS", utility_provider_id: "dom" },
      { id: "gas", current_stage: "1", current_stage_state: "IN_PROGRESS", utility_provider_id: null },
      { id: "water", current_stage: 1, current_stage_state: "NOT_STARTED", utility_provider_id: "w" },
      { id: "sewer", current_stage: 1, current_stage_state: "NOT_STARTED", utility_provider_id: "s" },
      { id: "telecom", current_stage: 1, current_stage_state: "NOT_STARTED", utility_provider_id: "t" },
    ];
    const matrix = buildStageStateMatrix(records);
    const invariants = assertStageStateMatrixInvariants(matrix);
    assert.equal(invariants.totalMatches, true);
    assert.equal(invariants.perStageMatches, true);
    assert.equal(matrix.stages.get(1)?.recordCount, 4);
    assert.equal(matrix.stages.get(6)?.recordCount, 1);
    assert.equal(matrix.stages.get(1)?.states.IN_PROGRESS, 1);
    assert.equal(matrix.stages.get(1)?.states.NOT_STARTED, 3);
    assert.equal(matrix.stages.get(6)?.states.IN_PROGRESS, 1);
    assert.equal(matrix.stages.get(1)?.states.BLOCKED ?? 0, 0);
    const stage1States = Object.fromEntries(stageStateEntries(matrix.stages.get(1)));
    assert.equal(stage1States.IN_PROGRESS, 1);
    assert.equal(stage1States.NOT_STARTED, 3);
  });

  it("does not copy Stage 6 IN_PROGRESS into Stage 1 after gas is BLOCKED", () => {
    const records = [
      { current_stage: 6, current_stage_state: "IN_PROGRESS" },
      { current_stage: 1, current_stage_state: "BLOCKED" },
      { current_stage: 1, current_stage_state: "NOT_STARTED" },
      { current_stage: 1, current_stage_state: "NOT_STARTED" },
      { current_stage: 1, current_stage_state: "NOT_STARTED" },
    ];
    const matrix = buildStageStateMatrix(records);
    assert.equal(matrix.stages.get(1)?.states.IN_PROGRESS ?? 0, 0);
    assert.equal(matrix.stages.get(1)?.states.BLOCKED, 1);
    assert.equal(matrix.stages.get(6)?.states.IN_PROGRESS, 1);
    assert.equal(assertStageStateMatrixInvariants(matrix).totalMatches, true);
  });

  it("labels unassigned required types for operator copy", () => {
    assert.equal(isUnassignedRequiredProvider({ utility_provider_id: null }), true);
    assert.equal(isUnassignedRequiredProvider({ utility_provider_id: "abc" }), false);
    assert.equal(providerNeedsConfirmationReason("gas"), "Gas provider needs confirmation");
  });
});
