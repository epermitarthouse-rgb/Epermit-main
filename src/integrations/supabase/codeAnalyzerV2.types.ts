/**
 * Supabase types for Code Analyzer Async V2 tables and RPCs.
 * Derived from supabase/migrations/202608241*.sql — regenerate when migrations change.
 */
import type { Json } from "./types";

export type CodeAnalyzerJobStatus = "queued" | "processing" | "completed" | "failed" | "cancelled";

export type CodeAnalyzerIngestionJobStatus =
  | "pending"
  | "processing"
  | "completed"
  | "partial"
  | "failed"
  | "cancelled";

export type CodeAnalyzerClass =
  | "drawing_set"
  | "specification"
  | "code_modification_form"
  | "schedule"
  | "report"
  | "supporting"
  | "mixed"
  | "unknown";

export interface CodeAnalyzerDerivedAssetRow {
  id: string;
  project_id: string;
  document_id: string;
  page_number: number;
  asset_type: "raster" | "thumbnail" | "ocr_text" | "title_block_crop";
  content_hash: string;
  storage_path: string;
  mime_type: string | null;
  width: number | null;
  height: number | null;
  byte_size: number | null;
  source_content_hash: string | null;
  metadata: Json;
  created_at: string;
  updated_at: string;
}

export interface CodeAnalyzerIngestionJobRow {
  id: string;
  project_id: string;
  document_id: string;
  user_id: string;
  content_fingerprint: string;
  analyzer_class: string | null;
  status: CodeAnalyzerIngestionJobStatus;
  progress_phase: string;
  progress_detail: Json;
  total_pages: number | null;
  processed_pages: number;
  failed_pages: number;
  attempt_count: number;
  max_attempts: number;
  priority: number;
  available_at: string;
  lease_owner: string | null;
  lease_expires_at: string | null;
  last_heartbeat_at: string | null;
  last_error: string | null;
  error_code: string | null;
  worker_version: string | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface CodeAnalyzerDocumentSegmentRow {
  id: string;
  project_id: string;
  document_id: string;
  page_start: number;
  page_end: number;
  analyzer_class: CodeAnalyzerClass;
  class_source: "auto" | "user" | "filename" | "sampled_ai";
  confidence: number | null;
  created_at: string;
  updated_at: string;
}

export interface CodeAnalyzerSheetJobRow {
  id: string;
  project_id: string;
  run_id: string;
  sheet_id: string;
  analysis_mode: string;
  status: CodeAnalyzerJobStatus;
  attempt_count: number;
  max_attempts: number;
  priority: number;
  available_at: string;
  lease_owner: string | null;
  lease_expires_at: string | null;
  last_heartbeat_at: string | null;
  last_error: string | null;
  error_code: string | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  completed_at: string | null;
}

export interface CodeAnalyzerCodeModJobRow {
  id: string;
  project_id: string;
  run_id: string | null;
  review_id: string | null;
  job_type: "form_extraction" | "evidence_sheet" | "merge_findings";
  document_id: string | null;
  sheet_id: string | null;
  status: CodeAnalyzerJobStatus;
  payload: Json;
  result: Json | null;
  attempt_count: number;
  max_attempts: number;
  available_at: string;
  lease_owner: string | null;
  lease_expires_at: string | null;
  last_error: string | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface CodeAnalyzerSpecSectionRow {
  id: string;
  project_id: string;
  document_id: string;
  section_key: string;
  title: string | null;
  page_start: number | null;
  page_end: number | null;
  content_fingerprint: string;
  metadata: Json;
  created_at: string;
  updated_at: string;
}

/** V2 RPC argument/return shapes used by the frontend and workers. */
export interface CodeAnalyzerV2Functions {
  enqueue_code_analyzer_ingestion_job: {
    Args: {
      p_project_id: string;
      p_document_id: string;
      p_user_id: string;
      p_content_fingerprint: string;
      p_analyzer_class?: string | null;
    };
    Returns: Array<{ job: CodeAnalyzerIngestionJobRow; reused_existing: boolean }>;
  };
  create_code_analyzer_run_async_v2: {
    Args: {
      p_project_id: string;
      p_user_id: string;
      p_analysis_type: string;
      p_jurisdiction: string;
      p_project_type: string;
      p_code_year: string;
      p_analysis_mode: string;
      p_source_fingerprint: string;
      p_sheet_ids: string[];
      p_analysis_modes?: string[];
      p_form_document_id?: string | null;
      p_analysis_instructions?: string | null;
      p_index_completeness?: Json | null;
    };
    Returns: Array<{ run: Record<string, unknown>; jobs_created: number }>;
  };
  create_code_modification_run_async_v2: {
    Args: {
      p_project_id: string;
      p_user_id: string;
      p_jurisdiction: string;
      p_project_type: string;
      p_code_year: string;
      p_source_fingerprint: string;
      p_form_document_ids: string[];
      p_evidence_sheet_ids: string[];
      p_excluded_evidence_document_ids?: string[];
      p_analysis_instructions?: string | null;
      p_form_fingerprint?: string | null;
    };
    Returns: Array<{ run: Record<string, unknown>; jobs_created: number }>;
  };
  cancel_code_analyzer_run_v2: {
    Args: { p_run_id: string; p_user_id: string };
    Returns: Record<string, unknown>;
  };
  retry_failed_sheet_jobs_v2: {
    Args: { p_run_id: string; p_user_id: string };
    Returns: number;
  };
  retry_failed_code_mod_jobs_v2: {
    Args: { p_run_id: string; p_user_id: string };
    Returns: number;
  };
  set_document_analyzer_class: {
    Args: {
      p_document_id: string;
      p_project_id: string;
      p_user_id: string;
      p_analyzer_class: string;
      p_segments?: Json | null;
    };
    Returns: Record<string, unknown>;
  };
  claim_code_analyzer_code_mod_job: {
    Args: { p_worker_id: string; p_lease_ttl_seconds?: number };
    Returns: CodeAnalyzerCodeModJobRow | null;
  };
  complete_code_analyzer_code_mod_job: {
    Args: {
      p_job_id: string;
      p_worker_id: string;
      p_status: CodeAnalyzerJobStatus;
      p_result?: Json | null;
      p_last_error?: string | null;
      p_available_at?: string | null;
    };
    Returns: CodeAnalyzerCodeModJobRow | null;
  };
}
