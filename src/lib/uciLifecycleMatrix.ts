/**
 * Project-workspace current-stage distribution.
 * Counts come only from coordination_records.current_stage + current_stage_state.
 * Never mix project-wide state totals into a stage column.
 * This is a snapshot of where records sit today — not lifecycle completion history.
 */

/** Shared helper copy for current-position rollups (hub, portfolio, sidebar). */
export const CURRENT_STAGE_DISTRIBUTION_HELPER =
  "Shows where coordination records are currently positioned — not which stages were previously completed.";

import type { LifecycleState } from "@/types/uci";

export const UCI_LIFECYCLE_STAGES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;

export const UCI_LIFECYCLE_STATE_ORDER: LifecycleState[] = [
  "NOT_STARTED",
  "IN_PROGRESS",
  "AWAITING_UTILITY",
  "BLOCKED",
  "ESCALATED",
  "COMPLETED",
];

export type StageStateBucket = {
  recordCount: number;
  states: Record<string, number>;
};

export type StageStateMatrix = {
  stages: Map<number, StageStateBucket>;
  totalRecords: number;
  countedRecords: number;
};

export type LifecycleRecordLike = {
  current_stage?: number | string | null;
  current_stage_state?: string | null;
  utility_provider_id?: string | null;
  utility_type?: string | null;
};

function emptyBucket(): StageStateBucket {
  const states: Record<string, number> = {};
  for (const state of UCI_LIFECYCLE_STATE_ORDER) states[state] = 0;
  return { recordCount: 0, states };
}

export function normalizeLifecycleStage(value: unknown): number | null {
  const stage = Number(value);
  if (!Number.isInteger(stage) || stage < 1 || stage > 10) return null;
  return stage;
}

/** True when a required-type coverage row has no configured provider. */
export function isUnassignedRequiredProvider(record: LifecycleRecordLike): boolean {
  return record.utility_provider_id == null || String(record.utility_provider_id).trim() === "";
}

export function providerNeedsConfirmationReason(utilityType: string | null | undefined): string {
  const type = String(utilityType || "utility").trim().toLowerCase() || "utility";
  const label = type.charAt(0).toUpperCase() + type.slice(1);
  return `${label} provider needs confirmation`;
}

/**
 * Build per-stage counts from the same records the coordination table uses.
 * Stage N only includes rows where Number(current_stage) === N.
 */
export function buildStageStateMatrix(records: LifecycleRecordLike[]): StageStateMatrix {
  const stages = new Map<number, StageStateBucket>();
  for (const stage of UCI_LIFECYCLE_STAGES) {
    stages.set(stage, emptyBucket());
  }

  for (const record of records) {
    const stage = normalizeLifecycleStage(record.current_stage);
    if (stage == null) continue;
    const bucket = stages.get(stage) ?? emptyBucket();
    bucket.recordCount += 1;
    const state = String(record.current_stage_state || "").trim() || "UNKNOWN";
    bucket.states[state] = (bucket.states[state] ?? 0) + 1;
    stages.set(stage, bucket);
  }

  const countedRecords = [...stages.values()].reduce((sum, bucket) => sum + bucket.recordCount, 0);
  return {
    stages,
    totalRecords: records.length,
    countedRecords,
  };
}

export function stageStateEntries(bucket: StageStateBucket | undefined): Array<[string, number]> {
  if (!bucket) return [];
  const known = UCI_LIFECYCLE_STATE_ORDER.filter((state) => (bucket.states[state] ?? 0) > 0).map(
    (state) => [state, bucket.states[state]] as [string, number],
  );
  const extras = Object.entries(bucket.states).filter(
    ([state, count]) => count > 0 && !UCI_LIFECYCLE_STATE_ORDER.includes(state as LifecycleState),
  );
  return [...known, ...extras];
}

export function assertStageStateMatrixInvariants(matrix: StageStateMatrix): {
  totalMatches: boolean;
  perStageMatches: boolean;
} {
  const totalMatches = matrix.countedRecords === matrix.totalRecords;
  const perStageMatches = [...matrix.stages.values()].every((bucket) => {
    const stateSum = Object.values(bucket.states).reduce((sum, count) => sum + count, 0);
    return stateSum === bucket.recordCount;
  });
  return { totalMatches, perStageMatches };
}
