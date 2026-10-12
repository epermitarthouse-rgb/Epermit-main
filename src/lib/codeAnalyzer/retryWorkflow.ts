/**
 * V2 retry helpers — sheet jobs and ingestion (durable, scoped).
 */
import type { CodeAnalyzerSheet } from "./model";
import type { SheetJobSummary } from "./asyncRun";
import { supabase } from "@/lib/supabase";

export async function retryFailedSheetJobsForSheets(
  runId: string,
  userId: string,
  sheetIds: string[],
): Promise<number> {
  if (sheetIds.length === 0) return 0;
  const { data, error } = await supabase.rpc("retry_failed_sheet_jobs_for_sheets_v2", {
    p_run_id: runId,
    p_user_id: userId,
    p_sheet_ids: sheetIds,
  });
  if (error) throw new Error(error.message);
  return Number(data ?? 0);
}

export async function retryFailedIngestionJob(jobId: string, userId: string): Promise<void> {
  const { error } = await supabase.rpc("retry_failed_ingestion_job_v2", {
    p_job_id: jobId,
    p_user_id: userId,
  });
  if (error) throw new Error(error.message);
}

/** Included sheets on this document that have at least one failed job on the run. */
export function failedSheetIdsForDocument(
  documentId: string,
  sheets: CodeAnalyzerSheet[],
  sheetJobs: SheetJobSummary[],
): string[] {
  const failedJobSheetIds = new Set(
    sheetJobs.filter((j) => j.status === "failed").map((j) => j.sheet_id),
  );
  return sheets
    .filter((s) => s.source_document_id === documentId && !s.excluded && failedJobSheetIds.has(s.id))
    .map((s) => s.id);
}

export function countFailedSheetJobs(sheetJobs: SheetJobSummary[]): number {
  return sheetJobs.filter((j) => j.status === "failed").length;
}
