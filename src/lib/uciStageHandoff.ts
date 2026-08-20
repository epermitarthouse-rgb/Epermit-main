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

export function getStage3HandoffButtonLabel(options: {
  packageReady: boolean;
  packageReviewed: boolean;
}): string {
  if (options.packageReviewed && options.packageReady) {
    return "Complete Stage 3";
  }
  if (options.packageReady) {
    return "Start Stage 3";
  }
  return "Enter Stage 3";
}
