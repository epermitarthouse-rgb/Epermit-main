/**
 * Derive UI progress from durable sheet jobs during async V2 runs.
 */
import type { SheetJobSummary } from "./asyncRun";

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
): {
  completed: number;
  failed: number;
  total: number;
  completedSheetIds: Set<string>;
  failedSheetIds: Set<string>;
} {
  const completedSheetIds = new Set<string>();
  const failedSheetIds = new Set<string>();
  for (const job of jobs) {
    if (job.status === "completed") completedSheetIds.add(job.sheet_id);
    if (job.status === "failed") failedSheetIds.add(job.sheet_id);
  }
  return {
    completed: completedSheetIds.size,
    failed: failedSheetIds.size,
    total: jobs.length,
    completedSheetIds,
    failedSheetIds,
  };
}
