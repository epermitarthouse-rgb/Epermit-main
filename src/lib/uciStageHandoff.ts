import type { LifecycleState } from "@/types/uci";

/** Human engineering review still in progress on Stage 2. */
export function isStage2EngineeringReviewActive(
  stage: number,
  state: LifecycleState | string | undefined,
): boolean {
  return stage === 2 && state === "IN_PROGRESS";
}

/** System or operator finished Stage 2; lifecycle handoff to Stage 3 is pending. */
export function isStage2CompletedAwaitingStage3Handoff(
  stage: number,
  state: LifecycleState | string | undefined,
): boolean {
  return stage === 2 && state === "COMPLETED";
}

export function canShowCompleteStage2ReviewButton(
  stage: number,
  state: LifecycleState | string | undefined,
): boolean {
  return isStage2EngineeringReviewActive(stage, state);
}

export function canShowEnterStage3HandoffButton(
  stage: number,
  state: LifecycleState | string | undefined,
): boolean {
  return isStage2CompletedAwaitingStage3Handoff(stage, state);
}

export function canShowStage3StatusPanel(stage: number): boolean {
  return stage >= 3;
}

export function getStage3HandoffButtonLabel(_options: {
  packageReady: boolean;
  packageReviewed: boolean;
}): string {
  return "Open application preparation";
}

/** Stage 3 application preparation finished; Stage 4 submission entry is pending. */
export function isStage3CompletedAwaitingStage4Handoff(
  stage: number,
  state: LifecycleState | string | undefined,
  packageReviewed: boolean,
): boolean {
  return stage === 3 && state === "COMPLETED" && packageReviewed;
}

/** Package review auto-handoffs to Stage 4 — no redundant Enter Stage 4 CTA. */
export function canShowEnterStage4HandoffButton(
  _stage: number,
  _state: LifecycleState | string | undefined,
  _packageReviewed: boolean,
): boolean {
  return false;
}

export function canShowStage4StatusPanel(stage: number): boolean {
  return stage >= 4;
}
