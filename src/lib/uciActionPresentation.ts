/**
 * Derive operator action button / badge state from persisted coordination fields.
 * Keep UI labels and disabled states aligned with server truth after mutations.
 */

import {
  getStage3HandoffButtonLabel,
  isStage2CompletedAwaitingStage3Handoff,
  isStage2EngineeringReviewActive,
} from "@/lib/uciStageHandoff";
import type { CoordinationRecord } from "@/types/uci";

export type StagePresentationStatus =
  | "locked"
  | "active"
  | "awaiting-utility"
  | "needs-attention"
  | "completed"
  | "blocked";

export type StageCompletionActionState =
  | { status: "completed"; label: string }
  | { status: "actionable"; label: string }
  | { status: "blocked"; hint: string };

export type SubmissionTransmissionSummary = {
  label: string;
  sent: boolean;
  uncertain: boolean;
  packageReady: boolean;
  showSendButton: boolean;
  showPrepareButton: boolean;
  prepareBlocked: boolean;
};

export type SubmissionTransmissionInput = {
  prep: { status?: string | null; ready_to_send?: boolean | null; preparation_id?: string | null } | null | undefined;
  transmission: { status?: string | null; ok?: boolean | null; preparation_id?: string | null } | null | undefined;
  transmissionMatchesPrep: boolean;
  transmissionSent: boolean;
  transmissionUncertain: boolean;
  providerSubmitted: boolean;
  priorSent: boolean;
  prepConfirmed: boolean;
  anyBusy: boolean;
  isReviewed: boolean;
};

export type Stage2HandoffActionState =
  | { status: "hidden" }
  | {
      status: "actionable";
      kind: "complete_stage2_review" | "enter_stage3";
      label: string;
      description: string;
    };

export type Stage4HandoffActionState =
  | { status: "hidden" }
  | { status: "actionable"; label: string; description: string };

export type Stage3ReviewActionPresentation = {
  showStatusPanel: boolean;
  statusHint: string;
  stage4Handoff: Stage4HandoffActionState;
  showStage4StatusPanel: boolean;
  stage4StatusHint: string;
  showSubmissionTrackerLink: boolean;
};

export type PackageReviewActionState =
  | { status: "reviewed"; showReopen: boolean }
  | { status: "actionable"; label: string; disabled: boolean }
  | { status: "blocked"; label: string; disabled: boolean; hint: string };

export type PackageBuildActionState =
  | { status: "hidden" }
  | { status: "build"; label: string; disabled: boolean }
  | { status: "repair"; label: string; disabled: boolean };

/** Stage N is finished when the record has advanced past N or N is COMPLETED. */
export function isCoordinationStageComplete(
  record: CoordinationRecord | null | undefined,
  stage: number,
): boolean {
  if (!record) return false;
  const current = Number(record.current_stage);
  if (!Number.isFinite(current)) return false;
  if (current > stage) return true;
  if (current === stage && String(record.current_stage_state || "").toUpperCase() === "COMPLETED") {
    return true;
  }
  return false;
}

/** Record is actively on stage N and not yet marked COMPLETED. */
export function isCoordinationOnOpenStage(
  record: CoordinationRecord | null | undefined,
  stage: number,
): boolean {
  if (!record) return false;
  return (
    Number(record.current_stage) === stage &&
    String(record.current_stage_state || "").toUpperCase() !== "COMPLETED"
  );
}

const STAGE_COMPLETION_LABELS: Record<number, string> = {
  7: "CIAC complete",
  8: "Procurement complete",
  9: "Pre-energization complete",
  10: "Utility coordination complete",
};

const AUTO_COMPLETE_STAGES = new Set([7, 8]);

const STAGE_COMPLETION_HINTS: Record<number, string> = {
  7: "Stage 7 completes automatically when every known cost is approved, paid, and billed to the client. QuickBooks sync is optional.",
  8: "Stage 8 completes automatically when every in-scope item has a current ETA. Installed is not required.",
  9: "Stage 9 is marked complete only after release, scheduled meter set, milestone, and site readiness.",
  10: "Stage 10 completes after energization, closeout artifacts, and the closeout PDF.",
};

export function deriveStagePresentation(
  record: CoordinationRecord | null | undefined,
  stage: number,
  options?: { needsAttention?: boolean; blockers?: string[] },
): StagePresentationStatus {
  if (!record) return "locked";
  const current = Number(record.current_stage);
  const state = String(record.current_stage_state || "").toUpperCase();
  if (Number.isFinite(current) && current < stage) return "locked";
  if (isCoordinationStageComplete(record, stage)) return "completed";
  if (options?.needsAttention || (options?.blockers?.length ?? 0) > 0) return "needs-attention";
  if (state === "AWAITING_UTILITY") return "awaiting-utility";
  if (state === "BLOCKED" || state === "ESCALATED") return "blocked";
  if (Number(record.current_stage) === stage) return "active";
  return "locked";
}

/**
 * Maps lifecycle guards + persisted stage to actionable / completed / blocked UI.
 * Guards express readiness; record stage expresses whether completion already happened.
 */
export function deriveStageCompletionAction(
  record: CoordinationRecord | null | undefined,
  stage: 7 | 8 | 9 | 10,
  guardCanComplete: boolean | undefined,
  hintOverride?: string,
): StageCompletionActionState {
  const completionLabel = STAGE_COMPLETION_LABELS[stage] ?? `Stage ${stage} complete`;

  if (isCoordinationStageComplete(record, stage)) {
    return {
      status: "completed",
      label: AUTO_COMPLETE_STAGES.has(stage)
        ? `${completionLabel} ✓ (automatic)`
        : `${completionLabel} ✓`,
    };
  }

  const onStage = isCoordinationOnOpenStage(record, stage);

  if (AUTO_COMPLETE_STAGES.has(stage)) {
    if (guardCanComplete && onStage) {
      return {
        status: "blocked",
        hint:
          hintOverride ??
          "Nothing required — completion finalizes automatically when evidence is recorded.",
      };
    }
    return {
      status: "blocked",
      hint: hintOverride ?? STAGE_COMPLETION_HINTS[stage] ?? "Complete prerequisites before this stage can finish.",
    };
  }

  if (guardCanComplete && onStage) {
    return { status: "actionable", label: `Mark ${completionLabel.toLowerCase()}` };
  }
  return {
    status: "blocked",
    hint: hintOverride ?? STAGE_COMPLETION_HINTS[stage] ?? "Complete prerequisites before marking this stage done.",
  };
}

/** Whether the server guard should expose a complete-stage action for the current record. */
export function lifecycleGuardAllowsStageCompletion(
  record: CoordinationRecord | null | undefined,
  stage: number,
  guardCanComplete: boolean | undefined,
): boolean {
  return Boolean(guardCanComplete && isCoordinationOnOpenStage(record, stage) && !AUTO_COMPLETE_STAGES.has(stage));
}

/** Stage 2 → Stage 3 handoff CTA from persisted lifecycle + package readiness. */
export function deriveStage2HandoffAction(
  record: CoordinationRecord | null | undefined,
  input: {
    currentStage: number;
    currentStageState: string | undefined;
    packageReady: boolean;
    packageReviewed: boolean;
  },
): Stage2HandoffActionState {
  const stage = Number(record?.current_stage ?? input.currentStage);
  const state = String(record?.current_stage_state ?? input.currentStageState ?? "").toUpperCase();

  if (stage > 2) {
    return { status: "hidden" };
  }

  if (isStage2EngineeringReviewActive(stage, state)) {
    return {
      status: "actionable",
      kind: "complete_stage2_review",
      label: "Complete Stage 2 review",
      description:
        "A human must complete Stage 2. This action enters Stage 3; if this package is already reviewed and ready, Stage 3 is completed and becomes ready for Stage 4.",
    };
  }

  if (isStage2CompletedAwaitingStage3Handoff(stage, state)) {
    return {
      status: "actionable",
      kind: "enter_stage3",
      label: getStage3HandoffButtonLabel({
        packageReady: input.packageReady,
        packageReviewed: input.packageReviewed,
      }),
      description: input.packageReady
        ? "Application package is ready. Open application preparation to confirm fields and mark the package reviewed."
        : "Engineering review is complete. Open application preparation to continue.",
    };
  }

  return { status: "hidden" };
}

/** Stage 3 lifecycle panels and Stage 4 submission handoff from persisted record state. */
export function deriveStage3ReviewAction(
  record: CoordinationRecord | null | undefined,
  input: {
    currentStage: number;
    currentStageState: string | undefined;
    packageReviewed: boolean;
    readyForFinalReview: boolean;
  },
): Stage3ReviewActionPresentation {
  const stage = Number(record?.current_stage ?? input.currentStage);
  const state = String(record?.current_stage_state ?? input.currentStageState ?? "").toUpperCase();
  const showStatusPanel = stage >= 3;

  let statusHint = "Confirm every required field and document, then mark the package reviewed.";
  if (state === "COMPLETED") {
    statusHint = "Stage 3 is complete — this coordination is ready for Stage 4 submission.";
  } else if (input.readyForFinalReview) {
    statusHint = "All required items are confirmed. Mark the package reviewed to complete Stage 3.";
  }

  let stage4Handoff: Stage4HandoffActionState = { status: "hidden" };
  if (stage === 3 && state === "COMPLETED" && input.packageReviewed) {
    stage4Handoff = {
      status: "actionable",
      label: "Enter Stage 4 submission",
      description:
        "Enter Stage 4 to open the submission workflow — prepare, preview, and transmit the reviewed package.",
    };
  }

  const showStage4StatusPanel = stage >= 4;
  const stage4StatusHint = input.packageReviewed
    ? "Submission controls are enabled on the Submission Tracker — prepare and send the reviewed package."
    : "Complete package review before preparing submission.";

  return {
    showStatusPanel,
    statusHint,
    stage4Handoff,
    showStage4StatusPanel,
    stage4StatusHint,
    showSubmissionTrackerLink: showStage4StatusPanel,
  };
}

/** Mark reviewed / reopen from persisted draft_status + canonical review summary. */
export function derivePackageReviewAction(input: {
  reviewPersisted: boolean;
  readyForFinalReview: boolean;
  reviewBusy: boolean;
}): PackageReviewActionState {
  if (input.reviewPersisted) {
    return { status: "reviewed", showReopen: true };
  }
  if (input.readyForFinalReview) {
    return {
      status: "actionable",
      label: "Mark package reviewed",
      disabled: input.reviewBusy,
    };
  }
  return {
    status: "blocked",
    label: "Mark package reviewed",
    disabled: true,
    hint: "Confirm every required field and document before final review.",
  };
}

/** Build / rebuild / repair package CTA from persisted package + review state. */
export function derivePackageBuildAction(input: {
  hasLoadProfile: boolean;
  hasPackage: boolean;
  reviewPersisted: boolean;
  repairEligible: boolean;
  prepBusy: boolean;
  repairBusy: boolean;
  pepcoRequiresApplication: boolean;
  hasSelectedPepcoApplication: boolean;
}): PackageBuildActionState {
  if (!input.hasLoadProfile) {
    return { status: "hidden" };
  }
  if (input.repairEligible) {
    return {
      status: "repair",
      label: "Repair package",
      disabled: input.repairBusy,
    };
  }
  if (input.reviewPersisted) {
    return { status: "hidden" };
  }
  return {
    status: "build",
    label: input.hasPackage ? "Rebuild package" : "Prepare application draft",
    disabled:
      input.prepBusy ||
      (input.pepcoRequiresApplication && !input.hasSelectedPepcoApplication),
  };
}

export function deriveSubmissionTrackerTransmissionState(
  input: SubmissionTransmissionInput,
): SubmissionTransmissionSummary {
  const {
    prep,
    transmissionSent,
    transmissionUncertain,
    providerSubmitted,
    priorSent,
    prepConfirmed,
    anyBusy,
    isReviewed,
  } = input;

  const prepSent = transmissionSent;
  const packageReady = prep?.ready_to_send === true;
  const sent = prepSent || providerSubmitted;

  let label: string;
  if (sent) {
    label = "Sent";
  } else if (transmissionUncertain) {
    label = "Send outcome uncertain";
  } else if (priorSent) {
    label = "Sent (prior)";
  } else if (prepConfirmed) {
    label = packageReady ? "Ready to send" : "Prepared";
  } else if (prep) {
    label = "Prepared";
  } else {
    label = "Not prepared";
  }

  const showSendButton = Boolean(
    prep && !sent && !transmissionUncertain && packageReady,
  );
  const showPrepareButton = isReviewed && !anyBusy;
  const prepareBlocked = prepConfirmed && !sent && !providerSubmitted;

  return {
    label,
    sent,
    uncertain: transmissionUncertain,
    packageReady,
    showSendButton,
    showPrepareButton,
    prepareBlocked,
  };
}
