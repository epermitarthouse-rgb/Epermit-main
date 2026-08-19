import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildNextStepNotice,
  describeCoordinationStatus,
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
});
