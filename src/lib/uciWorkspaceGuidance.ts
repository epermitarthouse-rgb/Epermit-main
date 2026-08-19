/**
 * Presentation helpers for Coordination Record Workspace chrome:
 * stage labels, status copy, and next-step guidance.
 * Does not alter lifecycle rules — display only.
 */

import type { UciDrawerTab } from "@/lib/uciNavSections";
import { getCommunicationsTabLabel } from "@/lib/uciCommunicationPresentation";
import type { LifecycleState } from "@/types/uci";

export const UCI_LIFECYCLE_STAGE_TITLES: Record<number, string> = {
  0: "Setup",
  1: "Provider resolution",
  2: "Load and application preparation",
  3: "Application package",
  4: "Submission",
  5: "Utility communications",
  6: "Class of Service",
  7: "Costs and equipment",
  8: "Meter-set preparation",
  9: "Energization",
  10: "Closeout",
};

/** Primary workspace tab recommended for a lifecycle stage (display guidance only). */
export const UCI_STAGE_RECOMMENDED_TAB: Record<number, UciDrawerTab> = {
  0: "overview",
  1: "overview",
  2: "load-profile",
  3: "application-prep",
  4: "applications",
  5: "communications",
  6: "cos",
  7: "costs",
  8: "energization-closeout",
  9: "energization-closeout",
  10: "energization-closeout",
};

export type WorkflowGroupProgress = "completed" | "current" | "upcoming" | "support";

export function formatUciLifecycleStateLabel(state: string | undefined): string {
  const map: Record<LifecycleState, string> = {
    NOT_STARTED: "Not started",
    IN_PROGRESS: "In progress",
    AWAITING_UTILITY: "Awaiting utility",
    BLOCKED: "Blocked",
    ESCALATED: "Escalated",
    COMPLETED: "Completed",
  };
  return (state && map[state as LifecycleState]) || state || "—";
}

export function getLifecycleStageTitle(stage: number | null | undefined): string {
  if (stage == null || Number.isNaN(Number(stage))) return "Unknown stage";
  return UCI_LIFECYCLE_STAGE_TITLES[Number(stage)] ?? `Stage ${stage}`;
}

export function describeCoordinationStatus(opts: {
  stage: number;
  state: string | undefined;
  acknowledgmentReceivedAt?: string | null;
}): string {
  const stage = Number(opts.stage);
  const title = getLifecycleStageTitle(stage);
  const state = opts.state as LifecycleState | undefined;

  if (state === "COMPLETED" && stage === 5 && opts.acknowledgmentReceivedAt) {
    return `This project is currently in Stage ${stage}: Utility acknowledgment completed.`;
  }
  if (state === "COMPLETED") {
    return `This project is currently in Stage ${stage}: ${title} — completed.`;
  }
  if (state === "AWAITING_UTILITY") {
    return `This project is currently in Stage ${stage}: ${title}. Waiting on the utility.`;
  }
  if (state === "BLOCKED") {
    return `This project is currently in Stage ${stage}: ${title}. Work is blocked until the issue is resolved.`;
  }
  if (state === "ESCALATED") {
    return `This project is currently in Stage ${stage}: ${title}. Escalated for follow-up.`;
  }
  if (state === "IN_PROGRESS") {
    return `This project is currently in Stage ${stage}: ${title} (in progress).`;
  }
  if (state === "NOT_STARTED") {
    return `This project is currently in Stage ${stage}: ${title} — not started yet.`;
  }
  return `This project is currently in Stage ${stage}: ${title}.`;
}

export function getWorkflowGroupProgress(
  stageRange: [number, number] | null | undefined,
  currentStage: number,
): WorkflowGroupProgress {
  if (!stageRange) return "support";
  const [min, max] = stageRange;
  if (currentStage > max) return "completed";
  if (currentStage >= min && currentStage <= max) return "current";
  return "upcoming";
}

export type NextStepNoticeModel = {
  title: string;
  body: string;
  recommendedTab?: UciDrawerTab;
  recommendedLabel?: string;
};

const TAB_CONTEXT: Partial<Record<UciDrawerTab, { title: string; body: string }>> = {
  overview: {
    title: "On Overview",
    body: "Confirm provider mapping and record context before moving into load and package work.",
  },
  documents: {
    title: "On Documents",
    body: "Verify document coverage that Load Profile Analyzer and Application Builder will use.",
  },
  "load-profile": {
    title: "On Load profile",
    body: "Use Load Profile Analyzer to refine connected load before building the application package.",
  },
  "application-prep": {
    title: "On Application package",
    body: "Use Application Builder to assemble, review, and confirm the package for submission.",
  },
  applications: {
    title: "On Utility applications",
    body: "Track submission through Submission and Confirmation Tracker, then watch for utility reply.",
  },
  communications: {
    title: "On Communications",
    body: "Review utility messages, classify inbound items, and confirm acknowledgment when received.",
  },
  cos: {
    title: "On Class of Service",
    body: "Review utility-issued Class of Service decisions and related follow-ups.",
  },
  costs: {
    title: "On Costs & equipment",
    body: "Record CIAC, equipment, and cost items tied to the utility decision.",
  },
  "energization-closeout": {
    title: "On Energization & closeout",
    body: "Plan meter-set, energization, and closeout milestones for Stages 8–10.",
  },
  lifecycle: {
    title: "On Lifecycle history",
    body: "Review transitions and apply or reject portal lifecycle suggestions when present.",
  },
  "portal-sync": {
    title: "On Portal sync",
    body: "Refresh read-only portal discovery for this utility account when available.",
  },
};

const TAB_LABELS: Record<UciDrawerTab, string> = {
  overview: "Overview",
  "portal-sync": "Portal sync",
  documents: "Documents",
  "load-profile": "Load profile",
  "application-prep": "Application package",
  applications: "Utility applications",
  communications: "Communications",
  cos: "Class of Service",
  costs: "Costs & equipment",
  "energization-closeout": "Energization & closeout",
  lifecycle: "Lifecycle history",
};

function recommendedForStage(stage: number): { tab: UciDrawerTab; label: string; capabilityHint?: string } {
  const tab = UCI_STAGE_RECOMMENDED_TAB[stage] ?? "overview";
  const capabilityByStage: Partial<Record<number, string>> = {
    1: "Utility Provider Mapper",
    2: "Load Profile Analyzer",
    3: "Application Builder",
    4: "Submission and Confirmation Tracker",
  };
  return {
    tab,
    label: TAB_LABELS[tab],
    capabilityHint: capabilityByStage[stage],
  };
}

/** Next recommended step from backend stage/state — no invented completion. */
export function buildNextStepNotice(opts: {
  stage: number;
  state: string | undefined;
  activeTab: UciDrawerTab;
  lastError?: string | null;
}): NextStepNoticeModel {
  const stage = Number(opts.stage);
  const state = opts.state as LifecycleState | undefined;
  const tabContext = TAB_CONTEXT[opts.activeTab];

  if (state === "BLOCKED") {
    return {
      title: "Resolve the blocker first",
      body: opts.lastError
        ? `This stage is blocked. Review the recorded error, then continue from Lifecycle history or the recommended workspace for Stage ${stage}.`
        : `This stage is blocked. Open Lifecycle history to inspect transitions, then return to the recommended workspace for Stage ${stage}.`,
      recommendedTab: "lifecycle",
      recommendedLabel: TAB_LABELS.lifecycle,
    };
  }

  if (state === "ESCALATED") {
    return {
      title: "Escalation needs attention",
      body: `Stage ${stage} is escalated. Review Communications and Lifecycle history before advancing other work.`,
      recommendedTab: stage >= 5 ? "communications" : "lifecycle",
      recommendedLabel: stage >= 5 ? TAB_LABELS.communications : TAB_LABELS.lifecycle,
    };
  }

  if (state === "AWAITING_UTILITY") {
    return {
      title: "Next recommended step",
      body:
        stage >= 5
          ? "Waiting on the utility. Check Communications for replies and acknowledgment before advancing."
          : "Waiting on the utility. Monitor Communications and keep package data current while you wait.",
      recommendedTab: "communications",
      recommendedLabel: TAB_LABELS.communications,
    };
  }

  if (state === "COMPLETED") {
    const nextStage = Math.min(10, stage + 1);
    if (stage >= 10) {
      return {
        title: "Next recommended step",
        body: "Closeout for this coordination is complete. Use Lifecycle history for the audit trail.",
        recommendedTab: "lifecycle",
        recommendedLabel: TAB_LABELS.lifecycle,
      };
    }
    const next = recommendedForStage(nextStage);
    return {
      title: "Stage completed — where next",
      body: next.capabilityHint
        ? `Stage ${stage} is complete. Continue to Stage ${nextStage} (${getLifecycleStageTitle(nextStage)}) via ${next.label} — ${next.capabilityHint}.`
        : `Stage ${stage} is complete. Continue to Stage ${nextStage} (${getLifecycleStageTitle(nextStage)}) in ${next.label}.`,
      recommendedTab: next.tab,
      recommendedLabel: next.label,
    };
  }

  const current = recommendedForStage(stage);
  const priorDependency =
    stage >= 3 && opts.activeTab === "application-prep"
      ? " Confirm Documents and Load profile coverage first if package fields look incomplete."
      : stage >= 4 && opts.activeTab === "applications"
        ? " Application package should be reviewed before submission."
        : stage >= 5 && opts.activeTab === "communications"
          ? " Submission should be recorded before expecting utility acknowledgment."
          : "";

  if (tabContext && opts.activeTab !== current.tab) {
    return {
      title: "Next recommended step",
      body: `${tabContext.body} Recommended for Stage ${stage}: ${current.label}${
        current.capabilityHint ? ` (${current.capabilityHint})` : ""
      }.${priorDependency}`,
      recommendedTab: current.tab,
      recommendedLabel: current.label,
    };
  }

  if (tabContext) {
    const title =
      opts.activeTab === "communications" && stage === 5
        ? `On ${getCommunicationsTabLabel({ current_stage: 5 } as import("@/types/uci").CoordinationRecord)}`
        : tabContext.title;
    return {
      title,
      body: `${tabContext.body}${priorDependency}`,
      recommendedTab: current.tab,
      recommendedLabel:
        current.tab === "communications" && stage === 5
          ? getCommunicationsTabLabel({ current_stage: 5 } as import("@/types/uci").CoordinationRecord)
          : current.label,
    };
  }

  return {
    title: "Next recommended step",
    body: current.capabilityHint
      ? `Continue Stage ${stage} (${getLifecycleStageTitle(stage)}) in ${current.label} — ${current.capabilityHint}.`
      : `Continue Stage ${stage} (${getLifecycleStageTitle(stage)}) in ${current.label}.`,
    recommendedTab: current.tab,
    recommendedLabel: current.label,
  };
}
