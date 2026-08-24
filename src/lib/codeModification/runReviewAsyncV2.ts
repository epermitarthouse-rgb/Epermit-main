/**
 * DC Code Modification Review — async V2 durable job path.
 */
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { computeSheetFingerprint, type CodeAnalyzerSheet } from "@/lib/codeAnalyzer/model";
import { fetchDocumentsByIds } from "@/lib/codeAnalyzer/persistence";
import { persistPendingAnalyzerSourcesAsyncV2 } from "@/lib/codeAnalyzer/persistPendingV2";
import { isCodeAnalyzerAsyncV2Enabled } from "@/lib/codeAnalyzer/featureFlags";
import {
  computeFormsFingerprint,
  computeModificationSourceFingerprint,
  type CodeModificationReview,
} from "@/lib/codeModification/model";
import { fetchModificationForms } from "@/lib/codeModification/persistence";
import {
  buildFormExclusionDocumentIds,
  filterDrawingEvidenceSheets,
} from "@/lib/codeModification/evidenceSources";
import { analyzerWorkflowFor } from "@/lib/codeModification/workflow";
import type { ProjectDocument } from "@/types/document";
import { runDcCodeModificationReview } from "./runReview";

export interface CodeModJobSummary {
  id: string;
  run_id: string | null;
  job_type: string;
  status: string;
  last_error: string | null;
  sheet_id: string | null;
}

export async function fetchCodeModJobsForRun(runId: string): Promise<CodeModJobSummary[]> {
  const { data, error } = await supabase
    .from("code_analyzer_code_mod_jobs")
    .select("id, run_id, job_type, status, last_error, sheet_id")
    .eq("run_id", runId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data as CodeModJobSummary[]) ?? [];
}

export async function createAsyncCodeModificationRun(params: {
  projectId: string;
  userId: string;
  jurisdiction: string;
  projectType: string;
  codeYear: string;
  sourceFingerprint: string;
  formDocumentIds: string[];
  evidenceSheetIds: string[];
  excludedEvidenceDocumentIds: string[];
  formFingerprint: string;
  analysisInstructions?: string | null;
}): Promise<{ runId: string; jobsCreated: number }> {
  const { data, error } = await supabase.rpc("create_code_modification_run_async_v2", {
    p_project_id: params.projectId,
    p_user_id: params.userId,
    p_jurisdiction: params.jurisdiction,
    p_project_type: params.projectType,
    p_code_year: params.codeYear,
    p_source_fingerprint: params.sourceFingerprint,
    p_form_document_ids: params.formDocumentIds,
    p_evidence_sheet_ids: params.evidenceSheetIds,
    p_excluded_evidence_document_ids: params.excludedEvidenceDocumentIds,
    p_analysis_instructions: params.analysisInstructions ?? null,
    p_form_fingerprint: params.formFingerprint,
  });
  if (error) throw new Error(error.message);
  const row = (data as Array<{ run: { id: string }; jobs_created: number }> | null)?.[0];
  if (!row?.run?.id) throw new Error("Failed to create code modification run");
  return { runId: row.run.id, jobsCreated: row.jobs_created ?? 0 };
}

export async function retryFailedCodeModJobs(runId: string, userId: string): Promise<number> {
  const { data, error } = await supabase.rpc("retry_failed_code_mod_jobs_v2", {
    p_run_id: runId,
    p_user_id: userId,
  });
  if (error) throw new Error(error.message);
  return Number(data ?? 0);
}

export function isTerminalCodeModRunStatus(status: string): boolean {
  return status === "current" || status === "partial" || status === "failed" || status === "cancelled";
}

export async function runDcCodeModificationReviewWithMode(params: {
  projectId: string;
  userId: string;
  jurisdiction: string;
  projectType: string;
  codeYear: string;
  persistedSheets: CodeAnalyzerSheet[];
  pendingDrawingFiles: Array<{ id: string; file: File; discipline?: "general" }>;
  sheetDocuments: ProjectDocument[];
  modificationForms: ProjectDocument[];
  analysisInstructions?: string | null;
  getDownloadUrl: (doc: ProjectDocument) => Promise<string | null>;
  persistUpload: (opts: {
    file: File;
    document_type: string;
    description: string;
    parent_document_id?: string;
  }) => Promise<ProjectDocument | { id: string; file_name?: string } | null>;
}): Promise<{ runId: string; jobsCreated: number; async: boolean; review?: CodeModificationReview; forms?: ProjectDocument[] }> {
  const workflow = analyzerWorkflowFor("dc_code_modification", params.jurisdiction);
  if (!workflow.ok) {
    throw new Error("DC Code Modification Review is only available for Washington, D.C.");
  }

  if (!isCodeAnalyzerAsyncV2Enabled()) {
    const legacy = await runDcCodeModificationReview(params);
    return { runId: legacy.review.run_id, jobsCreated: 0, async: false, review: legacy.review, forms: legacy.forms };
  }

  let sheets = params.persistedSheets;
  if (params.pendingDrawingFiles.length > 0) {
    const persisted = await persistPendingAnalyzerSourcesAsyncV2({
      projectId: params.projectId,
      userId: params.userId,
      pendingFiles: params.pendingDrawingFiles.map((f) => ({
        id: f.id,
        file: f.file,
        discipline: (f.discipline ?? "general") as never,
      })),
      uploadDocument: params.persistUpload,
    });
    for (const warning of persisted.warnings) toast.warning(warning);
    sheets = await fetchAnalyzerSheetsAfterUpload(params.projectId, sheets, persisted);
  }

  const formDocs = [...params.modificationForms].sort((a, b) => a.created_at.localeCompare(b.created_at));
  if (formDocs.length === 0) {
    throw new Error("Upload at least one DC Code Modification document first");
  }

  const included = sheets.filter((s) => !s.excluded);
  const docsById = new Map(params.sheetDocuments.map((d) => [d.id, d]));
  const missingIds = included
    .flatMap((s) => [s.image_document_id, s.source_document_id])
    .filter((id): id is string => Boolean(id) && !docsById.has(id));
  if (missingIds.length > 0) {
    const fetched = await fetchDocumentsByIds(missingIds);
    for (const doc of fetched) docsById.set(doc.id, doc);
  }

  const modificationForms = await fetchModificationForms(params.projectId);
  const exclusionDocs = [...Array.from(docsById.values()), ...modificationForms].filter(
    (doc, index, arr) => arr.findIndex((other) => other.id === doc.id) === index,
  );
  const excludedEvidenceDocumentIds = buildFormExclusionDocumentIds(exclusionDocs, formDocs);
  const evidenceSheets = filterDrawingEvidenceSheets(included, excludedEvidenceDocumentIds);

  const formFingerprint = computeFormsFingerprint(
    formDocs.map((doc) => ({ formDocumentId: doc.id, updatedAt: doc.updated_at })),
  );
  const sourceFingerprint = computeModificationSourceFingerprint(
    formFingerprint,
    computeSheetFingerprint(sheets),
    params.analysisInstructions,
  );

  const { runId, jobsCreated } = await createAsyncCodeModificationRun({
    projectId: params.projectId,
    userId: params.userId,
    jurisdiction: params.jurisdiction,
    projectType: params.projectType,
    codeYear: params.codeYear,
    sourceFingerprint,
    formDocumentIds: formDocs.map((d) => d.id),
    evidenceSheetIds: evidenceSheets.map((s) => s.id),
    excludedEvidenceDocumentIds: Array.from(excludedEvidenceDocumentIds),
    formFingerprint,
    analysisInstructions: params.analysisInstructions,
  });

  return { runId, jobsCreated, async: true, forms: formDocs };
}

async function fetchAnalyzerSheetsAfterUpload(
  projectId: string,
  existing: CodeAnalyzerSheet[],
  _persisted: unknown,
): Promise<CodeAnalyzerSheet[]> {
  const { fetchAnalyzerSheets } = await import("@/lib/codeAnalyzer/persistence");
  const fresh = await fetchAnalyzerSheets(projectId);
  return fresh.length > 0 ? fresh : existing;
}
