import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  canShowCompleteStage2ReviewButton,
  canShowEnterStage3HandoffButton,
  canShowEnterStage4HandoffButton,
  canShowStage3StatusPanel,
  canShowStage4StatusPanel,
  getStage3HandoffButtonLabel,
  isStage2CompletedAwaitingStage3Handoff,
  isStage2EngineeringReviewActive,
  isStage3CompletedAwaitingStage4Handoff,
} from "./uciStageHandoff";

describe("uciStageHandoff", () => {
  it("treats active Stage 2 engineering review as in-progress only", () => {
    assert.equal(isStage2EngineeringReviewActive(2, "IN_PROGRESS"), true);
    assert.equal(isStage2EngineeringReviewActive(2, "COMPLETED"), false);
    assert.equal(isStage2EngineeringReviewActive(3, "IN_PROGRESS"), false);
  });

  it("detects completed Stage 2 awaiting Stage 3 handoff", () => {
    assert.equal(isStage2CompletedAwaitingStage3Handoff(2, "COMPLETED"), true);
    assert.equal(isStage2CompletedAwaitingStage3Handoff(2, "IN_PROGRESS"), false);
    assert.equal(isStage2CompletedAwaitingStage3Handoff(3, "COMPLETED"), false);
  });

  it("shows Complete Stage 2 review only while Stage 2 is in progress", () => {
    assert.equal(canShowCompleteStage2ReviewButton(2, "IN_PROGRESS"), true);
    assert.equal(canShowCompleteStage2ReviewButton(2, "COMPLETED"), false);
    assert.equal(canShowCompleteStage2ReviewButton(3, "IN_PROGRESS"), false);
  });

  it("shows Stage 3 handoff CTA when Stage 2 is completed on stage 2", () => {
    assert.equal(canShowEnterStage3HandoffButton(2, "COMPLETED"), true);
    assert.equal(canShowEnterStage3HandoffButton(2, "IN_PROGRESS"), false);
  });

  it("shows Stage 3 status panel once lifecycle has entered Stage 3", () => {
    assert.equal(canShowStage3StatusPanel(2), false);
    assert.equal(canShowStage3StatusPanel(3), true);
    assert.equal(canShowStage3StatusPanel(4), true);
  });

  it("labels Stage 3 handoff based on package readiness", () => {
    assert.equal(
      getStage3HandoffButtonLabel({ packageReady: false, packageReviewed: false }),
      "Enter Stage 3",
    );
    assert.equal(
      getStage3HandoffButtonLabel({ packageReady: true, packageReviewed: false }),
      "Start Stage 3",
    );
    assert.equal(
      getStage3HandoffButtonLabel({ packageReady: true, packageReviewed: true }),
      "Complete Stage 3",
    );
  });

  it("detects completed Stage 3 awaiting Stage 4 handoff", () => {
    assert.equal(isStage3CompletedAwaitingStage4Handoff(3, "COMPLETED", true), true);
    assert.equal(isStage3CompletedAwaitingStage4Handoff(3, "COMPLETED", false), false);
    assert.equal(isStage3CompletedAwaitingStage4Handoff(3, "IN_PROGRESS", true), false);
    assert.equal(isStage3CompletedAwaitingStage4Handoff(4, "IN_PROGRESS", true), false);
  });

  it("shows Stage 4 handoff CTA when Stage 3 is completed with reviewed package", () => {
    assert.equal(canShowEnterStage4HandoffButton(3, "COMPLETED", true), true);
    assert.equal(canShowEnterStage4HandoffButton(3, "IN_PROGRESS", true), false);
  });

  it("shows Stage 4 status panel once lifecycle has entered Stage 4", () => {
    assert.equal(canShowStage4StatusPanel(3), false);
    assert.equal(canShowStage4StatusPanel(4), true);
    assert.equal(canShowStage4StatusPanel(5), true);
  });
});
