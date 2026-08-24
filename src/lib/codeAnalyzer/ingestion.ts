/**
 * Code Analyzer Async V2 — enqueue and poll durable ingestion jobs.
 */
import { supabase } from "@/lib/supabase";

export type CodeAnalyzerIngestionJobStatus =
  | "pending"
  | "processing"
  | "completed"
  | "partial"
  | "failed"
  | "cancelled";

export interface CodeAnalyzerIngestionJob {
  id: string;
  project_id: string;
  document_id: string;
  status: CodeAnalyzerIngestionJobStatus;
  progress_phase: string;
  total_pages: number | null;
  processed_pages: number;
  failed_pages: number;
  analyzer_class: string | null;
  content_fingerprint: string;
  last_error: string | null;
  error_code: string | null;
  progress_detail: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export async function enqueueCodeAnalyzerIngestion(params: {
  projectId: string;
  documentId: string;
  userId: string;
  contentFingerprint: string;
  analyzerClass?: string | null;
}): Promise<{ job: CodeAnalyzerIngestionJob; reusedExisting: boolean }> {
  const { data, error } = await supabase.rpc("enqueue_code_analyzer_ingestion_job", {
    p_project_id: params.projectId,
    p_document_id: params.documentId,
    p_user_id: params.userId,
    p_content_fingerprint: params.contentFingerprint,
    p_analyzer_class: params.analyzerClass ?? null,
  });

  if (error) throw new Error(error.message);

  const rows = data as Array<{ job: CodeAnalyzerIngestionJob; reused_existing: boolean }> | null;
  const row = rows?.[0];
  if (!row?.job) throw new Error("Failed to enqueue ingestion job");

  return { job: row.job, reusedExisting: Boolean(row.reused_existing) };
}

export async function cancelIngestionJob(jobId: string, userId: string): Promise<void> {
  const { error } = await supabase.rpc("cancel_code_analyzer_ingestion_job", {
    p_job_id: jobId,
    p_user_id: userId,
  });
  if (error) throw new Error(error.message);
}

export async function updateDocumentContentHash(
  documentId: string,
  contentHash: string,
): Promise<void> {
  const { error } = await supabase
    .from("project_documents")
    .update({ content_hash: contentHash })
    .eq("id", documentId);
  if (error) throw new Error(error.message);
}

export function isTerminalIngestionStatus(status: CodeAnalyzerIngestionJobStatus): boolean {
  return status === "completed" || status === "partial" || status === "failed" || status === "cancelled";
}
