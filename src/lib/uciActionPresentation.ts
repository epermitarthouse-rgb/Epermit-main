/**
 * Derive operator action button / badge state from persisted coordination fields.
 * Keep UI labels and disabled states aligned with server truth after mutations.
 */

import type { CoordinationRecord } from "@/types/uci";

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

const STAGE_COMPLETION_HINTS: Record<number, string> = {
  7: "Stage 7 completes when every known cost is approved, paid, and billed to the client. QuickBooks sync is optional.",
  8: "Stage 8 completes when every in-scope item has a current ETA. Installed is not required.",
  9: "Stage 9 is marked complete only after release, scheduled meter set, milestone, and site readiness.",
  10: "Stage 10 completes after energization, closeout artifacts, and the closeout PDF.",
};

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
  if (isCoordinationStageComplete(record, stage)) {
    return { status: "completed", label: `Stage ${stage} completed` };
  }
  const onStage = isCoordinationOnOpenStage(record, stage);
  if (guardCanComplete && onStage) {
    return { status: "actionable", label: `Mark Stage ${stage} complete` };
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
  return Boolean(guardCanComplete && isCoordinationOnOpenStage(record, stage));
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
