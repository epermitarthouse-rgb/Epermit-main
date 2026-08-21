import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  derivePackageBuildAction,
  derivePackageReviewAction,
  deriveStage2HandoffAction,
  deriveStage3ReviewAction,
  deriveStageCompletionAction,
  deriveSubmissionTrackerTransmissionState,
  isCoordinationStageComplete,
  lifecycleGuardAllowsStageCompletion,
} from "./uciActionPresentation";
import type { CoordinationRecord } from "../types/uci";

function record(overrides: Partial<CoordinationRecord>): CoordinationRecord {
  return {
    id: "rec-1",
    project_id: "proj-1",
    current_stage: 7,
    current_stage_state: "IN_PROGRESS",
    ...overrides,
  } as CoordinationRecord;
}

describe("deriveStageCompletionAction", () => {
  it("shows automatic completion label after stage advances past auto-complete stages", () => {
    const action = deriveStageCompletionAction(record({ current_stage: 8 }), 7, true);
    assert.equal(action.status, "completed");
    assert.match(action.label, /CIAC complete/);
  });

  it("blocks manual completion for auto-complete stages while still open", () => {
    const action = deriveStageCompletionAction(record({ current_stage: 7 }), 7, true);
    assert.equal(action.status, "blocked");
  });

  it("shows actionable manual completion on open stages 9 and 10", () => {
    const stage9 = deriveStageCompletionAction(record({ current_stage: 9 }), 9, true);
    assert.equal(stage9.status, "actionable");
    assert.match(stage9.label, /pre-energization complete/i);
  });

  it("blocks when prerequisites are not met on the open stage", () => {
    const action = deriveStageCompletionAction(record({ current_stage: 9 }), 9, false);
    assert.equal(action.status, "blocked");
  });
});

describe("lifecycleGuardAllowsStageCompletion", () => {
  it("returns false for auto-complete stages and after advancement", () => {
    assert.equal(lifecycleGuardAllowsStageCompletion(record({ current_stage: 7 }), 7, true), false);
    assert.equal(
      lifecycleGuardAllowsStageCompletion(record({ current_stage: 8 }), 7, true),
      false,
    );
  });

  it("allows manual completion on open stages 9 and 10", () => {
    assert.equal(
      lifecycleGuardAllowsStageCompletion(record({ current_stage: 9 }), 9, true),
      true,
    );
  });
});

describe("deriveStage2HandoffAction", () => {
  it("shows complete review while Stage 2 is in progress", () => {
    const action = deriveStage2HandoffAction(record({ current_stage: 2, current_stage_state: "IN_PROGRESS" }), {
      currentStage: 2,
      currentStageState: "IN_PROGRESS",
      packageReady: false,
      packageReviewed: false,
    });
    assert.equal(action.status, "actionable");
    if (action.status === "actionable") {
      assert.equal(action.kind, "complete_stage2_review");
      assert.match(action.label, /Complete Stage 2 review/);
    }
  });

  it("shows enter Stage 3 after Stage 2 completes on stage 2", () => {
    const action = deriveStage2HandoffAction(record({ current_stage: 2, current_stage_state: "COMPLETED" }), {
      currentStage: 2,
      currentStageState: "COMPLETED",
      packageReady: true,
      packageReviewed: true,
    });
    assert.equal(action.status, "actionable");
    if (action.status === "actionable") {
      assert.equal(action.kind, "enter_stage3");
      assert.equal(action.label, "Open application preparation");
    }
  });

  it("hides handoff after lifecycle advances past Stage 2", () => {
    const action = deriveStage2HandoffAction(record({ current_stage: 3, current_stage_state: "IN_PROGRESS" }), {
      currentStage: 3,
      currentStageState: "IN_PROGRESS",
      packageReady: false,
      packageReviewed: false,
    });
    assert.equal(action.status, "hidden");
  });
});

describe("deriveStage3ReviewAction", () => {
  it("does not show redundant Stage 4 handoff when review auto-advances lifecycle", () => {
    const presentation = deriveStage3ReviewAction(
      record({ current_stage: 3, current_stage_state: "COMPLETED" }),
      {
        currentStage: 3,
        currentStageState: "COMPLETED",
        packageReviewed: true,
        readyForFinalReview: true,
      },
    );
    assert.equal(presentation.stage4Handoff.status, "hidden");
    assert.equal(presentation.showStage4StatusPanel, false);
  });

  it("hides Stage 4 handoff after entering Stage 4", () => {
    const presentation = deriveStage3ReviewAction(
      record({ current_stage: 4, current_stage_state: "IN_PROGRESS" }),
      {
        currentStage: 4,
        currentStageState: "IN_PROGRESS",
        packageReviewed: true,
        readyForFinalReview: true,
      },
    );
    assert.equal(presentation.stage4Handoff.status, "hidden");
    assert.equal(presentation.showStage4StatusPanel, true);
    assert.equal(presentation.showSubmissionTrackerLink, true);
  });
});

describe("derivePackageReviewAction", () => {
  it("disables mark reviewed until canonical readiness is true", () => {
    const blocked = derivePackageReviewAction({
      reviewPersisted: false,
      readyForFinalReview: false,
      reviewBusy: false,
    });
    assert.equal(blocked.status, "blocked");
    assert.equal(blocked.disabled, true);

    const actionable = derivePackageReviewAction({
      reviewPersisted: false,
      readyForFinalReview: true,
      reviewBusy: false,
    });
    assert.equal(actionable.status, "actionable");
    assert.equal(actionable.disabled, false);
  });

  it("shows reopen only after persisted review", () => {
    const reviewed = derivePackageReviewAction({
      reviewPersisted: true,
      readyForFinalReview: true,
      reviewBusy: false,
    });
    assert.equal(reviewed.status, "reviewed");
    assert.equal(reviewed.showReopen, true);
  });

  it("respects loading state during mutation", () => {
    const loading = derivePackageReviewAction({
      reviewPersisted: false,
      readyForFinalReview: true,
      reviewBusy: true,
    });
    assert.equal(loading.status, "actionable");
    if (loading.status === "actionable") {
      assert.equal(loading.disabled, true);
    }
  });
});

describe("derivePackageBuildAction", () => {
  it("hides build after review is persisted unless repair is eligible", () => {
    const hidden = derivePackageBuildAction({
      hasLoadProfile: true,
      hasPackage: true,
      reviewPersisted: true,
      repairEligible: false,
      prepBusy: false,
      repairBusy: false,
      pepcoRequiresApplication: false,
      hasSelectedPepcoApplication: false,
    });
    assert.equal(hidden.status, "hidden");

    const repair = derivePackageBuildAction({
      hasLoadProfile: true,
      hasPackage: true,
      reviewPersisted: true,
      repairEligible: true,
      prepBusy: false,
      repairBusy: false,
      pepcoRequiresApplication: false,
      hasSelectedPepcoApplication: false,
    });
    assert.equal(repair.status, "repair");
  });
});

describe("deriveSubmissionTrackerTransmissionState", () => {
  it("labels sent after a successful transmission for the current prep", () => {
    const state = deriveSubmissionTrackerTransmissionState({
      prep: { status: "confirmed_for_transmission", ready_to_send: true, preparation_id: "p1" },
      transmissionMatchesPrep: true,
      transmissionSent: true,
      transmissionUncertain: false,
      providerSubmitted: false,
      priorSent: false,
      prepConfirmed: true,
      anyBusy: false,
      isReviewed: true,
    });
    assert.equal(state.label, "Sent");
    assert.equal(state.sent, true);
    assert.equal(state.showSendButton, false);
  });

  it("does not show ready to send from global readiness when prep is not ready", () => {
    const state = deriveSubmissionTrackerTransmissionState({
      prep: { status: "confirmed_for_transmission", ready_to_send: false, preparation_id: "p1" },
      transmissionMatchesPrep: true,
      transmissionSent: false,
      transmissionUncertain: false,
      providerSubmitted: false,
      priorSent: false,
      prepConfirmed: true,
      anyBusy: false,
      isReviewed: true,
    });
    assert.equal(state.label, "Prepared");
    assert.equal(state.packageReady, false);
    assert.equal(state.showSendButton, false);
  });

  it("shows ready to send only when the prep itself is ready", () => {
    const state = deriveSubmissionTrackerTransmissionState({
      prep: { status: "confirmed_for_transmission", ready_to_send: true, preparation_id: "p1" },
      transmissionMatchesPrep: true,
      transmissionSent: false,
      transmissionUncertain: false,
      providerSubmitted: false,
      priorSent: false,
      prepConfirmed: true,
      anyBusy: false,
      isReviewed: true,
    });
    assert.equal(state.label, "Ready to send");
    assert.equal(state.showSendButton, true);
  });
});

describe("isCoordinationStageComplete", () => {
  it("treats advanced stages as completion for earlier stages", () => {
    assert.equal(isCoordinationStageComplete(record({ current_stage: 9 }), 7), true);
    assert.equal(isCoordinationStageComplete(record({ current_stage: 7 }), 7), false);
  });
});
