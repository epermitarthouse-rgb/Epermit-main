/**
 * Derive UI progress from durable sheet jobs during async V2 runs.
 * Display counts are unique sheets, not analysis jobs.
 */
import type { SheetJobSummary } from "./asyncRun";
import { uniqueSheetAnalysisProgress } from "./uniqueSheetProgress";

const TERMINAL_JOB_STATUSES = new Set(["completed", "failed", "cancelled"]);

export function isTerminalSheetJobStatus(status: string): boolean {
  return TERMINAL_JOB_STATUSES.has(status);
}

/** First sheet job still queued or running (for card highlight during async V2). */
export function pickActiveSheetJobSheetId(jobs: SheetJobSummary[]): string | null {
  const active = jobs.find((j) => j.status === "processing" || j.status === "pending");
  return active?.sheet_id ?? null;
}

export function metricsFromAsyncSheetJobs(
  jobs: SheetJobSummary[],
  sheetIds?: Iterable<string> | null,
): {
  completed: number;
  failed: number;
  cancelled: number;
  total: number;
  remaining: number;
  percent: number;
  completedSheetIds: Set<string>;
  failedSheetIds: Set<string>;
  cancelledSheetIds: Set<string>;
  sheetsAnalyzedLabel: string;
  breakdownLabel: string;
  combinedLabel: string;
} {
  const progress = uniqueSheetAnalysisProgress({ jobs, sheetIds });
  return {
    completed: progress.completed,
    failed: progress.failedSheetIds.size,
    cancelled: progress.cancelledSheetIds.size,
    total: progress.total,
    remaining: progress.remaining,
    percent: progress.percent,
    completedSheetIds: progress.completedSheetIds,
    failedSheetIds: progress.failedSheetIds,
    cancelledSheetIds: progress.cancelledSheetIds,
    sheetsAnalyzedLabel: progress.sheetsAnalyzedLabel,
    breakdownLabel: progress.breakdownLabel,
    combinedLabel: progress.combinedLabel,
  };
}
