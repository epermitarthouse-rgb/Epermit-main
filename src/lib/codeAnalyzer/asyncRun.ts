/**
 * Code Analyzer Async V2 — durable run creation + sheet job enqueue.
 */
import { supabase } from "@/lib/supabase";
import type { CodeAnalyzerRun } from "./model";

export interface AsyncRunCreateParams {
  projectId: string;
  userId: string;
  analysisType: string;
  jurisdiction: string;
  projectType: string;
  codeYear: string;
  analysisMode: string;
  sourceFingerprint: string;
  sheetIds: string[];
  analysisModes?: string[];
  formDocumentId?: string | null;
  analysisInstructions?: string | null;
  indexCompleteness?: Record<string, unknown> | null;
}

export async function createAsyncAnalyzerRun(
  params: AsyncRunCreateParams,
): Promise<{ run: CodeAnalyzerRun; jobsCreated: number }> {
  const { data, error } = await supabase.rpc("create_code_analyzer_run_async_v2", {
    p_project_id: params.projectId,
    p_user_id: params.userId,
    p_analysis_type: params.analysisType,
    p_jurisdiction: params.jurisdiction,
    p_project_type: params.projectType,
    p_code_year: params.codeYear,
    p_analysis_mode: params.analysisMode,
    p_source_fingerprint: params.sourceFingerprint,
    p_sheet_ids: params.sheetIds,
    p_analysis_modes: params.analysisModes ?? ["ibc"],
    p_form_document_id: params.formDocumentId ?? null,
    p_analysis_instructions: params.analysisInstructions ?? null,
    p_index_completeness: params.indexCompleteness ?? null,
  });

  if (error) throw new Error(error.message);

  const row = (data as Array<{ run: CodeAnalyzerRun; jobs_created: number }> | null)?.[0];
  if (!row?.run) throw new Error("Failed to create async run");

  return { run: row.run, jobsCreated: row.jobs_created ?? 0 };
}

export async function cancelAsyncRun(runId: string, userId: string): Promise<void> {
  const { error } = await supabase.rpc("cancel_code_analyzer_run_v2", {
    p_run_id: runId,
    p_user_id: userId,
  });
  if (error) throw new Error(error.message);
}

export async function retryFailedSheetJobs(runId: string, userId: string): Promise<number> {
  const { data, error } = await supabase.rpc("retry_failed_sheet_jobs_v2", {
    p_run_id: runId,
    p_user_id: userId,
  });
  if (error) throw new Error(error.message);
  return Number(data ?? 0);
}

export interface SheetJobSummary {
  id: string;
  run_id: string;
  sheet_id: string;
  analysis_mode: string;
  status: string;
  last_error: string | null;
}

export async function fetchSheetJobsForRun(runId: string): Promise<SheetJobSummary[]> {
  const { data, error } = await supabase
    .from("code_analyzer_sheet_jobs")
    .select("id, run_id, sheet_id, analysis_mode, status, last_error")
    .eq("run_id", runId)
    .order("created_at", { ascending: true });

  if (error) throw new Error(error.message);
  return (data as SheetJobSummary[]) ?? [];
}
