/**
 * Run-scoped result grouping for Code Analyzer — keeps active batch findings
 * isolated from superseded/historical hydrated results.
 */

export interface ComplianceResultGroup {
  id: string;
  documentId: string | null;
  fileName: string;
  ibcResult: unknown;
  localResult: unknown;
  failed: boolean;
  error?: string;
}

export interface BuildComplianceResultGroupsInput<T extends ComplianceResultGroup> {
  batchCompleted: T[];
  batchFailed: T[];
  hydrated: T[];
  /** When true, omit DB-hydrated groups (active run in flight or viewing current batch only). */
  isolateCurrentRun: boolean;
}

/** Merge batch session groups with optional hydrated DB results. */
export function buildComplianceResultGroups<T extends ComplianceResultGroup>(
  input: BuildComplianceResultGroupsInput<T>,
): T[] {
  const groups: T[] = [...input.batchCompleted, ...input.batchFailed];
  if (input.isolateCurrentRun) {
    return groups;
  }
  for (const loaded of input.hydrated) {
    const alreadyPresent = groups.some((g) => g.documentId === loaded.documentId);
    if (!alreadyPresent) {
      groups.push(loaded);
    }
  }
  return groups;
}

/** True when UI should show only the in-flight / current-run batch, not prior hydrate. */
export function shouldIsolateCurrentRunResults(input: {
  analyzing: boolean;
  activeBatchRunId: string | null;
  viewingHistoricalRunId: string | null;
}): boolean {
  if (input.viewingHistoricalRunId) return false;
  return input.analyzing || Boolean(input.activeBatchRunId);
}

export interface ActiveRunProgressInput {
  analyzing: boolean;
  total: number;
  completed: number;
  failed: number;
}

export interface ActiveRunProgressMetrics {
  total: number;
  completed: number;
  failed: number;
  pending: number;
  inProgress: boolean;
}

/** Progress counts for the active batch only (never prior-run hydrate). */
export function computeActiveRunProgressMetrics(
  input: ActiveRunProgressInput,
): ActiveRunProgressMetrics {
  const total = Math.max(0, input.total);
  const completed = Math.min(Math.max(0, input.completed), total);
  const failed = Math.min(Math.max(0, input.failed), total);
  const pending = Math.max(0, total - completed);
  return {
    total,
    completed: completed - failed,
    failed,
    pending,
    inProgress: input.analyzing && total > 0,
  };
}

/** Pending session uploads are user-added files not yet persisted as analyzer sheets. */
export function isPendingSessionUpload(file: { status: string; sheetId?: string }): boolean {
  return file.status === "pending" && !file.sheetId;
}
