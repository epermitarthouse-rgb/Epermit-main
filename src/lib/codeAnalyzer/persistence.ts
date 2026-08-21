/**
 * Persist Code Analyzer runs and sheets. Drawing-set source of truth lives here,
 * not in the browser batch queue.
 */
import { supabase } from "@/lib/supabase";
import type { ProjectDocument } from "@/types/document";
import {
  ANALYSIS_TYPE_STANDARD,
  computeSheetFingerprint,
  pickCurrentRun,
  pickDisplayRun,
  type CodeAnalyzerRun,
  type CodeAnalyzerRunStatus,
  type CodeAnalyzerSheet,
} from "./model";

export async function fetchAnalyzerRuns(projectId: string): Promise<CodeAnalyzerRun[]> {
  const { data, error } = await supabase
    .from("code_analyzer_runs")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data as CodeAnalyzerRun[]) ?? [];
}

export async function fetchAnalyzerSheets(projectId: string): Promise<CodeAnalyzerSheet[]> {
  const { data, error } = await supabase
    .from("code_analyzer_sheets")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  const rows = (data as CodeAnalyzerSheet[]) ?? [];
  return rows.sort((a, b) => {
    if (a.source_document_id !== b.source_document_id) {
      return a.source_document_id.localeCompare(b.source_document_id);
    }
    return a.page_number - b.page_number;
  });
}

export async function insertAnalyzerSheet(row: {
  project_id: string;
  source_document_id: string;
  image_document_id: string | null;
  page_number: number;
  file_name: string | null;
  excluded: boolean;
}): Promise<CodeAnalyzerSheet> {
  const { data, error } = await supabase
    .from("code_analyzer_sheets")
    .insert(row)
    .select("*")
    .single();
  if (error) throw error;
  return data as CodeAnalyzerSheet;
}

export async function setSheetExcluded(sheetId: string, excluded: boolean): Promise<void> {
  const { error } = await supabase
    .from("code_analyzer_sheets")
    .update({ excluded })
    .eq("id", sheetId);
  if (error) throw error;
}

export async function deleteAnalyzerSheetRow(sheetId: string): Promise<void> {
  const { error } = await supabase.from("code_analyzer_sheets").delete().eq("id", sheetId);
  if (error) throw error;
}

/** If analysisType is omitted, mark every current run stale (drawing-set changes). */
export async function markCurrentRunStale(projectId: string, analysisType?: string): Promise<void> {
  let query = supabase
    .from("code_analyzer_runs")
    .update({ status: "stale" })
    .eq("project_id", projectId)
    .eq("status", "current");
  if (analysisType) {
    query = query.eq("analysis_type", analysisType);
  }
  const { error } = await query;
  if (error) throw error;
}

export async function supersedeOpenRuns(
  projectId: string,
  analysisType: string = ANALYSIS_TYPE_STANDARD,
): Promise<void> {
  const { error } = await supabase
    .from("code_analyzer_runs")
    .update({ status: "superseded" })
    .eq("project_id", projectId)
    .eq("analysis_type", analysisType)
    .in("status", ["current", "stale", "running", "failed"]);
  if (error) throw error;
}

export async function createAnalyzerRun(params: {
  projectId: string;
  userId: string;
  jurisdiction: string;
  projectType: string;
  codeYear: string;
  analysisMode: string;
  sourceFingerprint: string;
  analysisType?: string;
  formDocumentId?: string | null;
}): Promise<CodeAnalyzerRun> {
  const analysisType = params.analysisType || ANALYSIS_TYPE_STANDARD;
  await supersedeOpenRuns(params.projectId, analysisType);
  const insert: Record<string, unknown> = {
    project_id: params.projectId,
    user_id: params.userId,
    status: "running",
    jurisdiction: params.jurisdiction,
    project_type: params.projectType,
    code_year: params.codeYear,
    analysis_mode: params.analysisMode,
    analysis_type: analysisType,
    source_fingerprint: params.sourceFingerprint,
  };
  if (params.formDocumentId) {
    insert.form_document_id = params.formDocumentId;
  }
  const { data, error } = await supabase
    .from("code_analyzer_runs")
    .insert(insert)
    .select("*")
    .single();
  if (error) throw error;
  return data as CodeAnalyzerRun;
}

export async function completeAnalyzerRun(
  runId: string,
  status: Extract<CodeAnalyzerRunStatus, "current" | "failed">,
): Promise<void> {
  const { error } = await supabase
    .from("code_analyzer_runs")
    .update({
      status,
      completed_at: new Date().toISOString(),
    })
    .eq("id", runId);
  if (error) throw error;
}

export function fingerprintFromSheets(sheets: CodeAnalyzerSheet[]): string {
  return computeSheetFingerprint(sheets);
}

export function displayRunFromList(
  runs: CodeAnalyzerRun[],
  analysisType: string = ANALYSIS_TYPE_STANDARD,
): CodeAnalyzerRun | null {
  return pickDisplayRun(runs, analysisType);
}

export function currentRunFromList(
  runs: CodeAnalyzerRun[],
  analysisType: string = ANALYSIS_TYPE_STANDARD,
): CodeAnalyzerRun | null {
  return pickCurrentRun(runs, analysisType);
}

export async function fetchDocumentsByIds(ids: string[]): Promise<ProjectDocument[]> {
  if (ids.length === 0) return [];
  const { data, error } = await supabase
    .from("project_documents")
    .select("*")
    .in("id", ids);
  if (error) throw error;
  return (data as ProjectDocument[]) ?? [];
}
