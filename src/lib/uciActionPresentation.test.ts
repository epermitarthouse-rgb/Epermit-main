import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
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
  it("shows completed after stage advances past the target stage", () => {
    const action = deriveStageCompletionAction(record({ current_stage: 8 }), 7, true);
    assert.equal(action.status, "completed");
    assert.match(action.label, /Stage 7 completed/);
  });

  it("shows completed when the target stage is marked COMPLETED", () => {
    const action = deriveStageCompletionAction(
      record({ current_stage: 7, current_stage_state: "COMPLETED" }),
      7,
      true,
    );
    assert.equal(action.status, "completed");
  });

  it("shows actionable only on the open target stage with a true guard", () => {
    const action = deriveStageCompletionAction(record({ current_stage: 7 }), 7, true);
    assert.equal(action.status, "actionable");
    assert.match(action.label, /Mark Stage 7 complete/);
  });

  it("shows completed for an earlier stage after the record advances", () => {
    const action = deriveStageCompletionAction(record({ current_stage: 8 }), 7, true);
    assert.equal(action.status, "completed");
  });

  it("shows actionable on the open stage when guard is true", () => {
    const action = deriveStageCompletionAction(record({ current_stage: 8 }), 8, true);
    assert.equal(action.status, "actionable");
  });

  it("blocks when prerequisites are not met on the open stage", () => {
    const action = deriveStageCompletionAction(record({ current_stage: 7 }), 7, false);
    assert.equal(action.status, "blocked");
  });
});

describe("lifecycleGuardAllowsStageCompletion", () => {
  it("returns false after stage completion even if underlying predicate stays true", () => {
    assert.equal(
      lifecycleGuardAllowsStageCompletion(record({ current_stage: 8 }), 7, true),
      false,
    );
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
