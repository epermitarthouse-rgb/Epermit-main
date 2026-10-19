/**
 * User-facing Code Analyzer progress.
 * One sheet counts once, and only after every required analysis job for that sheet succeeds.
 * Job totals stay internal and are never shown.
 */

export type SheetAnalysisJobLike = {
  sheet_id: string;
  status: string;
};

export type UniqueSheetProgress = {
  /** Sheets whose required jobs all succeeded. */
  completed: number;
  /** Included sheets, or unique sheets on the jobs when no sheet list is given. */
  total: number;
  /** total − completed. Failed and cancelled sheets stay in this remainder. */
  remaining: number;
  percent: number;
  completedSheetIds: Set<string>;
  failedSheetIds: Set<string>;
  cancelledSheetIds: Set<string>;
  sheetsAnalyzedLabel: string;
  breakdownLabel: string;
  combinedLabel: string;
};

const SUCCEEDED = "completed";
const FAILED = "failed";
const CANCELLED = "cancelled";

export function formatUniqueSheetProgress(completed: number, total: number): Pick<
  UniqueSheetProgress,
  "completed" | "total" | "remaining" | "percent" | "sheetsAnalyzedLabel" | "breakdownLabel" | "combinedLabel"
> {
  const safeTotal = Math.max(0, total);
  const safeCompleted = Math.max(0, Math.min(completed, safeTotal));
  const remaining = safeTotal - safeCompleted;
  const percent = safeTotal === 0 ? 0 : Math.round((safeCompleted / safeTotal) * 100);
  const sheetsAnalyzedLabel = `Sheets Analyzed: ${safeCompleted} / ${safeTotal}`;
  const breakdownLabel = `${safeCompleted} completed · ${remaining} remaining`;
  return {
    completed: safeCompleted,
    total: safeTotal,
    remaining,
    percent,
    sheetsAnalyzedLabel,
    breakdownLabel,
    combinedLabel: `${sheetsAnalyzedLabel} · ${breakdownLabel} · ${percent}%`,
  };
}

function classifySheet(statuses: string[]): "completed" | "failed" | "cancelled" | "open" {
  if (statuses.length === 0) return "open";
  if (statuses.every((status) => status === SUCCEEDED)) return "completed";
  if (statuses.some((status) => status === FAILED)) return "failed";
  if (statuses.some((status) => status === CANCELLED)) return "cancelled";
  return "open";
}

/**
 * X / Y sheet progress from analysis jobs.
 * A sheet is complete only when every job for that sheet succeeded.
 * One finished mode, or any failed or cancelled job, does not count the sheet.
 */
export function uniqueSheetAnalysisProgress(input: {
  jobs: SheetAnalysisJobLike[];
  /** Included sheet ids. When omitted, Y is the unique sheet ids present on jobs. */
  sheetIds?: Iterable<string> | null;
}): UniqueSheetProgress {
  const jobsBySheet = new Map<string, string[]>();
  for (const job of input.jobs) {
    if (!job.sheet_id) continue;
    const statuses = jobsBySheet.get(job.sheet_id) ?? [];
    statuses.push(job.status);
    jobsBySheet.set(job.sheet_id, statuses);
  }

  const declared = input.sheetIds
    ? [...new Set([...input.sheetIds].filter((id) => Boolean(id)))]
    : null;
  const sheetIds = declared && declared.length > 0 ? declared : [...jobsBySheet.keys()];

  const completedSheetIds = new Set<string>();
  const failedSheetIds = new Set<string>();
  const cancelledSheetIds = new Set<string>();

  for (const sheetId of sheetIds) {
    const outcome = classifySheet(jobsBySheet.get(sheetId) ?? []);
    if (outcome === "completed") completedSheetIds.add(sheetId);
    else if (outcome === "failed") failedSheetIds.add(sheetId);
    else if (outcome === "cancelled") cancelledSheetIds.add(sheetId);
  }

  const labels = formatUniqueSheetProgress(completedSheetIds.size, sheetIds.length);
  return {
    ...labels,
    completedSheetIds,
    failedSheetIds,
    cancelledSheetIds,
  };
}
