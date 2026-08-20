import type { CoordinationRecord } from "@/types/uci";

function lifecycleFields(record: CoordinationRecord) {
  return {
    current_stage: record.current_stage,
    current_stage_state: record.current_stage_state,
    utility_provider_id: record.utility_provider_id,
    updated_at: record.updated_at,
    metadata: record.metadata,
    utility_providers: record.utility_providers,
  };
}

function lifecycleEqual(a: CoordinationRecord, b: CoordinationRecord): boolean {
  const left = lifecycleFields(a);
  const right = lifecycleFields(b);
  return JSON.stringify(left) === JSON.stringify(right);
}

/** Keep coordination list rows aligned with the canonical workspace record. */
export function patchCoordinationRecordInList(
  records: CoordinationRecord[],
  updated: CoordinationRecord,
): CoordinationRecord[] {
  const index = records.findIndex((record) => record.id === updated.id);
  if (index < 0) return records;
  const current = records[index];
  if (lifecycleEqual(current, updated)) return records;
  const next = records.slice();
  next[index] = { ...current, ...updated };
  return next;
}

export function findCoordinationRecordForUtilityType(
  records: CoordinationRecord[],
  utilityType: string,
): CoordinationRecord | null {
  const normalized = utilityType.trim().toLowerCase();
  return (
    records.find(
      (record) => String(record.utility_type ?? "").trim().toLowerCase() === normalized,
    ) ?? null
  );
}
