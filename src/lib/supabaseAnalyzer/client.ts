import { supabase } from "@/lib/supabase";
import type { PersistedAnalysisScope, StoredAnalysisMode } from "@/lib/supabaseAnalyzer/analysisMode";
import {
  buildReviewDecisionRecord,
  isReviewDecisionStatus,
  type FindingReviewDecision,
  type ReviewDecisionStatus,
} from "@/lib/supabaseAnalyzer/reviewDecisions";
import { fetchAllPages } from "@/lib/supabaseAnalyzer/pagedFetch";
import {
  exportAuditInvokeFields,
  parseExportAuditRequest,
  type ExportAuditInvokeInput,
} from "../../../supabase/functions/_shared/analyzerExportAudit.ts";

export type { FindingReviewDecision, ReviewDecisionStatus };

export const SUPABASE_ANALYZER_BUCKET = "supabase-analyzer-drawings";
export const SUPABASE_ANALYZER_MAX_SHEETS = 100;
export const SUPABASE_ANALYZER_MAX_FILE_BYTES = 15 * 1024 * 1024;
export const SUPABASE_ANALYZER_MAX_TOTAL_BYTES = 250 * 1024 * 1024;

export type SupabaseAnalyzerRunStatus =
  | "uploading"
  | "queued"
  | "processing"
  | "completed"
  | "completed_with_errors"
  | "cancelled"
  | "failed";

export interface SupabaseAnalyzerRun {
  id: string;
  project_id: string;
  created_by: string;
  status: SupabaseAnalyzerRunStatus;
  jurisdiction_key: string;
  jurisdiction_label: string;
  project_type: string;
  code_edition: string;
  code_context: string;
  analysis_mode?: StoredAnalysisMode | null;
  analysis_scope?: PersistedAnalysisScope | null;
  source_coverage: string;
  ai_provider: string;
  ai_model: string;
  total_sheets: number;
  uploaded_sheets: number;
  queued_sheets: number;
  processing_sheets: number;
  completed_sheets: number;
  failed_sheets: number;
  total_input_tokens: number;
  total_output_tokens: number;
  estimated_cost_usd: number;
  budget_limit_usd: number;
  started_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface SupabaseAnalyzerSheetJob {
  id: string;
  run_id: string;
  project_id: string;
  ordinal: number;
  original_file_name: string;
  object_path: string;
  file_size: number;
  discipline: string | null;
  detected_sheet_number: string | null;
  detected_sheet_title: string | null;
  status: "upload_pending" | "queued" | "processing" | "completed" | "failed" | "cancelled";
  attempt_count: number;
  max_attempts: number;
  last_error: string | null;
  error_code: string | null;
  input_tokens: number;
  output_tokens: number;
  estimated_cost_usd: number;
  analysis_summary: string | null;
  created_at: string;
  updated_at: string;
}

export interface SupabaseAnalyzerFinding {
  id: string;
  run_id: string;
  sheet_job_id: string;
  finding_index: number;
  category: string;
  severity: "critical" | "warning" | "advisory";
  title: string;
  observation: string;
  drawing_evidence: string;
  drawing_location: string | null;
  suggested_code_reference: string | null;
  recommendation: string;
  ai_provider: string;
  ai_model: string;
  jurisdiction_key: string;
  code_edition: string;
  provenance_status: string;
  verification_status: string;
  created_at: string;
}

export interface AnalyzerRunDataset {
  run: SupabaseAnalyzerRun;
  jobs: SupabaseAnalyzerSheetJob[];
  findings: SupabaseAnalyzerFinding[];
  reviews?: FindingReviewDecision[];
}

async function invokeRunAction<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("supabase-analyzer-runs", { body });
  if (error) {
    let message = error.message;
    try {
      const context = (error as { context?: Response }).context;
      if (context) {
        const payload = await context.json();
        if (typeof payload?.error === "string") message = payload.error;
      }
    } catch {
      // The Functions client may not expose a JSON response body for network errors.
    }
    throw new Error(message || "Analyzer request failed");
  }
  if (data?.error) throw new Error(String(data.error));
  return data as T;
}

export async function createSupabaseAnalyzerRun(input: {
  projectId: string;
  files: File[];
  jurisdictionKey: string;
  jurisdictionLabel: string;
  projectType: string;
  codeEdition: string;
  codeContext: string;
  analysisMode?: StoredAnalysisMode;
  budgetLimitUsd?: number;
}) {
  return invokeRunAction<{
    runId: string;
    uploads: Array<{
      jobId: string;
      ordinal: number;
      fileName: string;
      fileSize: number;
      path: string;
      token: string;
    }>;
  }>({
    action: "create",
    projectId: input.projectId,
    jurisdictionKey: input.jurisdictionKey,
    jurisdictionLabel: input.jurisdictionLabel,
    projectType: input.projectType,
    codeEdition: input.codeEdition,
    codeContext: input.codeContext,
    analysisMode: input.analysisMode ?? "both",
    budgetLimitUsd: input.budgetLimitUsd ?? 20,
    files: input.files.map((file) => ({
      name: file.name,
      size: file.size,
      type: file.type || "application/pdf",
    })),
  });
}

export async function uploadSupabaseAnalyzerFiles(
  files: File[],
  uploads: Array<{
    path: string;
    token: string;
    fileName: string;
    fileSize: number;
    jobId: string;
  }>,
  onProgress?: (completed: number, total: number, fileName: string) => void,
) {
  const fileQueues = new Map<string, File[]>();
  for (const file of files) {
    const key = `${file.name}:${file.size}`;
    const queue = fileQueues.get(key) || [];
    queue.push(file);
    fileQueues.set(key, queue);
  }

  let completed = 0;
  const failures: Array<{ jobId: string; fileName: string; error: string }> = [];
  const queue = [...uploads];
  const worker = async () => {
    while (queue.length) {
      const upload = queue.shift();
      if (!upload) return;
      const file = fileQueues.get(`${upload.fileName}:${upload.fileSize}`)?.shift();
      if (!file) {
        failures.push({ jobId: upload.jobId, fileName: upload.fileName, error: "Local file missing" });
        continue;
      }
      let lastError = "";
      let succeeded = false;
      for (let attempt = 1; attempt <= 3; attempt++) {
        const { error } = await supabase.storage
          .from(SUPABASE_ANALYZER_BUCKET)
          .uploadToSignedUrl(upload.path, upload.token, file, {
            contentType: "application/pdf",
            upsert: false,
          });
        if (!error) {
          succeeded = true;
          break;
        }
        lastError = error.message;
        if (attempt < 3) {
          await new Promise((resolve) => window.setTimeout(resolve, attempt * 750));
        }
      }
      if (succeeded) completed += 1;
      else failures.push({ jobId: upload.jobId, fileName: upload.fileName, error: lastError });
      onProgress?.(completed, uploads.length, upload.fileName);
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, uploads.length) }, worker));
  return { completed, failures };
}

export function finalizeSupabaseAnalyzerRun(projectId: string, runId: string) {
  return invokeRunAction<{
    runId: string;
    queued: number;
    missing: Array<{ jobId: string; fileName: string }>;
  }>({ action: "finalize", projectId, runId });
}

export function retrySupabaseAnalyzerJobs(projectId: string, runId: string, jobIds?: string[]) {
  return invokeRunAction<{ retried: number }>({
    action: "retry",
    projectId,
    runId,
    jobIds: jobIds || [],
  });
}

export function cancelSupabaseAnalyzerRun(projectId: string, runId: string) {
  return invokeRunAction<{ cancelled: boolean; alreadyCancelled?: boolean }>({
    action: "cancel",
    projectId,
    runId,
  });
}

/** Persists an export audit event. Throws on transport/auth errors; callers that must not block a download should use withAnalyzerExportAudit. */
export function recordSupabaseAnalyzerExport(request: ExportAuditInvokeInput & { projectId: string; runId: string }) {
  const parsed = parseExportAuditRequest(exportAuditInvokeFields(request));
  if (parsed.ok === false) return Promise.reject(new Error(parsed.error));
  return invokeRunAction<{
    recorded: boolean;
    eventType: string;
    stage: string;
    clientReceipt: string;
  }>({
    action: "record_export",
    projectId: request.projectId,
    runId: request.runId,
    ...exportAuditInvokeFields(request),
  });
}

export function reanalyzeSupabaseAnalyzerRun(input: {
  projectId: string;
  sourceRunId: string;
  runId: string;
  scope: "all" | "selected";
  jobIds: string[];
  files: Array<{ name: string; size: number; type?: string; replaceJobId?: string | null }>;
  confirmed: boolean;
  analysisMode?: StoredAnalysisMode;
  jurisdictionKey: string;
  jurisdictionLabel: string;
  projectType: string;
  codeEdition: string;
  codeContext: string;
}) {
  return invokeRunAction<{
    runId: string;
    created: boolean;
    uploads: Array<{
      jobId: string;
      ordinal: number;
      fileName: string;
      fileSize: number;
      path: string;
      token: string;
    }>;
    reused: number;
    added: number;
    replaced: number;
  }>({
    action: "reanalyze",
    projectId: input.projectId,
    sourceRunId: input.sourceRunId,
    runId: input.runId,
    scope: input.scope,
    jobIds: input.jobIds,
    confirmed: input.confirmed,
    analysisMode: input.analysisMode ?? "both",
    jurisdictionKey: input.jurisdictionKey,
    jurisdictionLabel: input.jurisdictionLabel,
    projectType: input.projectType,
    codeEdition: input.codeEdition,
    codeContext: input.codeContext,
    files: input.files.map((file) => ({
      name: file.name,
      size: file.size,
      type: file.type || "application/pdf",
      replaceJobId: file.replaceJobId || null,
    })),
  });
}

export function updateSupabaseAnalyzerRun(input: {
  projectId: string;
  runId: string;
  files: Array<{ name: string; size: number; type?: string; replaceJobId?: string | null }>;
  confirmed: boolean;
}) {
  return invokeRunAction<{
    runId: string;
    uploads: Array<{
      jobId: string;
      ordinal: number;
      fileName: string;
      fileSize: number;
      path: string;
      token: string;
    }>;
    added: number;
    replaced: number;
    resumed: number;
    skipped: Array<{ fileName: string; reason: string }>;
  }>({
    action: "update",
    projectId: input.projectId,
    runId: input.runId,
    confirmed: input.confirmed,
    files: input.files.map((file) => ({
      name: file.name,
      size: file.size,
      type: file.type || "application/pdf",
      replaceJobId: file.replaceJobId || null,
    })),
  });
}

export async function fetchSupabaseAnalyzerRuns(projectId: string) {
  const { data, error } = await supabase
    .from("supabase_analyzer_runs")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) throw error;
  return (data || []) as SupabaseAnalyzerRun[];
}

const REVIEW_COLUMNS = "id, project_id, run_id, sheet_job_id, finding_id, decision, modified_response, decided_at, decided_by";

function reviewFromRow(row: Record<string, unknown>): FindingReviewDecision | null {
  if (!isReviewDecisionStatus(row.decision)) return null;
  if (typeof row.id !== "string" || typeof row.run_id !== "string" || typeof row.finding_id !== "string") return null;
  return {
    id: row.id,
    project_id: String(row.project_id || ""),
    run_id: row.run_id,
    sheet_job_id: String(row.sheet_job_id || ""),
    finding_id: row.finding_id,
    decision: row.decision,
    modified_response: typeof row.modified_response === "string" ? row.modified_response : null,
    decided_at: String(row.decided_at || ""),
    decided_by: String(row.decided_by || ""),
  };
}

export async function fetchSupabaseAnalyzerDataset(runId: string): Promise<AnalyzerRunDataset> {
  const [runResult, jobRows, findingRows, reviewRows] = await Promise.all([
    supabase.from("supabase_analyzer_runs").select("*").eq("id", runId).single(),
    fetchAllPages((from, to) => supabase
      .from("supabase_analyzer_sheet_jobs")
      .select("*", { count: "exact" })
      .eq("run_id", runId)
      .order("ordinal")
      .order("id")
      .range(from, to)),
    fetchAllPages((from, to) => supabase
      .from("supabase_analyzer_findings")
      .select("*", { count: "exact" })
      .eq("run_id", runId)
      .eq("is_published", true)
      .order("sheet_job_id")
      .order("finding_index")
      .order("id")
      .range(from, to)),
    fetchAllPages((from, to) => supabase
      .from("supabase_analyzer_finding_reviews")
      .select(REVIEW_COLUMNS, { count: "exact" })
      .eq("run_id", runId)
      .order("finding_id")
      .order("id")
      .range(from, to)),
  ]);
  if (runResult.error) throw runResult.error;
  const reviews = (reviewRows as Array<Record<string, unknown>>)
    .map(reviewFromRow)
    .filter((review): review is FindingReviewDecision => review !== null && review.run_id === runId);
  return {
    run: runResult.data as SupabaseAnalyzerRun,
    jobs: jobRows as SupabaseAnalyzerSheetJob[],
    findings: findingRows as SupabaseAnalyzerFinding[],
    reviews,
  };
}

export async function saveSupabaseAnalyzerReviewDecision(input: {
  projectId: string;
  runId: string;
  sheetJobId: string;
  findingId: string;
  decision: ReviewDecisionStatus;
  modifiedResponse?: string | null;
  originalRecommendation: string;
}) {
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) throw new Error("Authentication required");
  const { record } = buildReviewDecisionRecord({
    projectId: input.projectId,
    runId: input.runId,
    sheetJobId: input.sheetJobId,
    findingId: input.findingId,
    decision: input.decision,
    modifiedResponse: input.modifiedResponse,
    decidedAt: new Date().toISOString(),
    decidedBy: userData.user.id,
    originalRecommendation: input.originalRecommendation,
  });
  const { data, error } = await supabase
    .from("supabase_analyzer_finding_reviews")
    .upsert(record, { onConflict: "run_id,finding_id" })
    .select(REVIEW_COLUMNS)
    .single();
  if (error) {
    const message = error.message || "Could not save the review decision";
    if (/row-level security|permission|not allowed/i.test(message)) {
      throw new Error("You do not have permission to review findings on this project");
    }
    throw new Error(message);
  }
  const saved = reviewFromRow(data as Record<string, unknown>);
  if (!saved || saved.run_id !== input.runId || saved.finding_id !== input.findingId) {
    throw new Error("Could not save the review decision");
  }
  return saved;
}

export function isActiveSupabaseAnalyzerRun(run: SupabaseAnalyzerRun | null | undefined) {
  return Boolean(run && ["uploading", "queued", "processing"].includes(run.status));
}
