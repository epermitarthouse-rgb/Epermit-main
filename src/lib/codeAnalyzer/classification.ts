/**
 * Document classification override for Code Analyzer Async V2.
 */
import { supabase } from "@/lib/supabase";

export type AnalyzerDocumentClass =
  | "drawing_set"
  | "specification"
  | "code_modification_form"
  | "schedule"
  | "report"
  | "supporting"
  | "mixed"
  | "unknown";

export interface DocumentSegment {
  page_start: number;
  page_end: number;
  analyzer_class: AnalyzerDocumentClass;
}

export async function setDocumentAnalyzerClass(params: {
  documentId: string;
  projectId: string;
  userId: string;
  analyzerClass: AnalyzerDocumentClass;
  segments?: DocumentSegment[];
}): Promise<void> {
  const { error } = await supabase.rpc("set_document_analyzer_class", {
    p_document_id: params.documentId,
    p_project_id: params.projectId,
    p_user_id: params.userId,
    p_analyzer_class: params.analyzerClass,
    p_segments: params.segments ?? null,
  });
  if (error) throw new Error(error.message);
}

export async function fetchDocumentIngestionJobs(projectId: string) {
  const { data, error } = await supabase
    .from("code_analyzer_ingestion_jobs")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function fetchProjectDocumentsWithAnalyzerMeta(projectId: string) {
  const { data, error } = await supabase
    .from("project_documents")
    .select(
      "id, file_name, document_type, content_hash, analyzer_class, analyzer_class_source, analyzer_processing_status",
    )
    .eq("project_id", projectId)
    .is("parent_document_id", null)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return data ?? [];
}
