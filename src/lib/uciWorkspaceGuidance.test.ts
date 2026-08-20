import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  UCI_LIFECYCLE_STAGE_TITLES,
  UCI_STAGE_RECOMMENDED_TAB,
  buildNextStepNotice,
  describeCoordinationStatus,
  formatWorkflowStageRange,
  getStageWorkspaceLinksForRange,
  getWorkflowGroupPrerequisite,
  getWorkflowGroupProgress,
} from "./uciWorkspaceGuidance.ts";

describe("uciWorkspaceGuidance", () => {
  it("describes stage 5 acknowledgment completion in plain language", () => {
    const sentence = describeCoordinationStatus({
      stage: 5,
      state: "COMPLETED",
      acknowledgmentReceivedAt: "2026-08-01T12:00:00.000Z",
    });
    assert.match(sentence, /Stage 5/);
    assert.match(sentence, /acknowledgment completed/i);
  });

  it("marks workflow groups completed / current / upcoming from stage alone", () => {
    assert.equal(getWorkflowGroupProgress([0, 1], 5), "completed");
    assert.equal(getWorkflowGroupProgress([5, 6], 5), "current");
    assert.equal(getWorkflowGroupProgress([8, 10], 5), "upcoming");
    assert.equal(getWorkflowGroupProgress(null, 5), "support");
  });

  it("recommends Communications when awaiting utility", () => {
    const notice = buildNextStepNotice({
      stage: 5,
      state: "AWAITING_UTILITY",
      activeTab: "overview",
    });
    assert.equal(notice.recommendedTab, "communications");
    assert.match(notice.body, /Waiting on the utility/i);
  });

  it("points to the next stage after completion", () => {
    const notice = buildNextStepNotice({
      stage: 4,
      state: "COMPLETED",
      activeTab: "applications",
    });
    assert.equal(notice.recommendedTab, "communications");
    assert.match(notice.title, /Stage completed/i);
  });

  it("labels Stages 7–10 per CET-2026 and recommends the costs tab for Stage 8", () => {
    assert.equal(UCI_LIFECYCLE_STAGE_TITLES[7], "CIAC");
    assert.equal(UCI_LIFECYCLE_STAGE_TITLES[8], "Long-lead");
    assert.equal(UCI_LIFECYCLE_STAGE_TITLES[9], "Pre-energization");
    assert.equal(UCI_LIFECYCLE_STAGE_TITLES[10], "Energization & closeout");
    assert.equal(UCI_STAGE_RECOMMENDED_TAB[7], "costs");
    assert.equal(UCI_STAGE_RECOMMENDED_TAB[8], "costs");
    assert.equal(UCI_STAGE_RECOMMENDED_TAB[9], "energization-closeout");
    assert.equal(UCI_STAGE_RECOMMENDED_TAB[10], "energization-closeout");
  });

  it("describes downstream prerequisites for Stages 7–10 groups", () => {
    assert.equal(formatWorkflowStageRange([7, 8]), "Stages 7–8");
    assert.equal(
      getWorkflowGroupPrerequisite({ stageRange: [7, 8], currentStage: 6 }),
      "Blocked until Stage 6 completes",
    );
    assert.equal(
      getWorkflowGroupPrerequisite({ stageRange: [9, 10], currentStage: 6 }),
      "Blocked until Stage 8 completes",
    );
    assert.deepEqual(
      getStageWorkspaceLinksForRange([7, 8]).map((link) => link.label),
      ["Stage 7 · CIAC", "Stage 8 · Long-lead"],
    );
  });
});
