/**
 * Reanalyze saved Supabase analyzer drawings as a new run.
 * The source run, its jobs, storage objects, and findings are read only.
 * Code Analyzer V2 is not involved.
 */

import {
  ANALYZER_MAX_SHEETS,
  ANALYZER_MAX_TOTAL_BYTES,
  applyCancellation,
  cleanAnalyzerFileName,
  planSheetUpdate,
  runIsWorkerActive,
  type ExistingAnalyzerSheet,
  type IncomingAnalyzerSheet,
} from "./analyzerSheetUpdate.ts";
import {
  normalizeNewRunAnalysisMode,
  type StoredAnalysisMode,
} from "./analyzerReviewScope.ts";

export interface ReanalysisSourceSheet extends ExistingAnalyzerSheet {
  object_path: string;
  detected_sheet_title?: string | null;
  discipline?: string | null;
}

export interface ReanalysisPlanItem {
  action: "reuse" | "upload";
  fileName: string;
  fileSize: number;
  /** Existing storage key for a reused drawing. */
  objectPath?: string;
  sourceJobId?: string;
  replaceJobId?: string;
  existingLabel?: string;
  detectedSheetNumber?: string | null;
  detectedSheetTitle?: string | null;
  discipline?: string | null;
}

export interface MissingStoredDrawing {
  jobId: string;
  fileName: string;
  objectPath: string;
  label: string;
}

export interface ReanalysisPlan {
  sourceRunId: string;
  accepted: boolean;
  needsConfirmation: boolean;
  error: string | null;
  items: ReanalysisPlanItem[];
  reuseCount: number;
  uploadCount: number;
  added: number;
  replaced: number;
  totalSheets: number;
  missing: MissingStoredDrawing[];
  selectedJobIds: string[];
}

export type ReanalysisIntent = "selected" | "all" | "update";

export interface ReanalysisConfirmationCopy {
  title: string;
  confirmLabel: string;
  cancelLabel: "Cancel";
  intro: string;
  adds: string[];
  replacements: string[];
}

export interface MaterializedReanalysisJob {
  id: string;
  run_id: string;
  project_id: string;
  ordinal: number;
  original_file_name: string;
  object_path: string;
  source_object_path: string | null;
  source_job_id: string | null;
  file_size: number;
  status: "queued" | "upload_pending";
  detected_sheet_number: string | null;
  detected_sheet_title: string | null;
  discipline: string | null;
}

export interface MaterializedReanalysis {
  runId: string;
  projectId: string;
  status: "queued" | "uploading";
  analysisMode: StoredAnalysisMode;
  totalSheets: number;
  sourceRunId: string;
  jobs: MaterializedReanalysisJob[];
  uploads: Array<{ jobId: string; fileName: string; fileSize: number; objectPath: string }>;
  queued: number;
}

export interface ReanalysisStoreJob extends ReanalysisSourceSheet {
  run_id: string;
  error_code?: string | null;
}

export interface ReanalysisStoreFinding {
  id: string;
  run_id: string;
  sheet_job_id: string;
  is_published: boolean;
}

export interface ReanalysisStoreRun {
  id: string;
  project_id: string;
  status: string;
  analysis_mode: string | null;
  total_sheets: number;
}

export interface ReanalysisStore {
  runs: ReanalysisStoreRun[];
  jobs: ReanalysisStoreJob[];
  findings: ReanalysisStoreFinding[];
  commits: Map<string, string>;
}

export interface CommitReanalysisResult {
  ok: boolean;
  created: boolean;
  runId: string | null;
  error: string | null;
  uploads: Array<{ jobId: string; fileName: string; fileSize: number; objectPath: string }>;
  queued: number;
}

export function splitStorageObjectPath(objectPath: string): { prefix: string; name: string } | null {
  const parts = objectPath.split("/").filter(Boolean);
  if (parts.length < 2) return null;
  const name = parts[parts.length - 1];
  if (!name) return null;
  return { prefix: parts.slice(0, -1).join("/"), name };
}

export function missingStorageMessage(missing: readonly { label: string }[]): string {
  const names = missing.map((item) => item.label);
  const preview = names.slice(0, 5).join(", ");
  const extra = names.length > 5 ? ` and ${names.length - 5} more` : "";
  return `These drawings are not in storage and were not queued: ${preview}${extra}`;
}

export function reanalysisStoredObjectPath(input: {
  action: "reuse" | "upload";
  sourceObjectPath: string | null;
  projectId: string;
  runId: string;
  jobId: string;
  reuseSourceKey: boolean;
}): string {
  if (input.action === "reuse" && input.reuseSourceKey && input.sourceObjectPath) {
    return input.sourceObjectPath;
  }
  return `${input.projectId}/${input.runId}/${input.jobId}.pdf`;
}

export interface StorageCopy {
  from: string;
  to: string;
  fileName: string;
}

/** Used when object_path is unique and the source key cannot be stored twice. */
export function rewriteReuseObjectPaths(
  jobs: readonly MaterializedReanalysisJob[],
  projectId: string,
  runId: string,
): { jobs: MaterializedReanalysisJob[]; copies: StorageCopy[] } {
  const copies: StorageCopy[] = [];
  const next = jobs.map((job) => {
    if (job.status !== "queued" || !job.source_object_path) return job;
    const objectPath = reanalysisStoredObjectPath({
      action: "reuse",
      sourceObjectPath: job.source_object_path,
      projectId,
      runId,
      jobId: job.id,
      reuseSourceKey: false,
    });
    if (objectPath === job.source_object_path) return job;
    copies.push({ from: job.source_object_path, to: objectPath, fileName: job.original_file_name });
    return { ...job, object_path: objectPath };
  });
  return { jobs: next, copies };
}

export function isObjectPathConflict(error: { code?: string; message?: string; details?: string }): boolean {
  const text = `${error.code || ""} ${error.message || ""} ${error.details || ""}`.toLowerCase();
  return text.includes("23505") && text.includes("object_path");
}

/** Keep a shared storage object when another sheet job still points at it. */
export function shouldRemoveStoredDrawing(otherReferences: number): boolean {
  return otherReferences === 0;
}

export function reanalysisRequestKey(input: {
  sourceRunId: string;
  scope: "all" | "selected";
  jobIds: readonly string[];
  files: readonly { name: string; size: number }[];
  analysisMode: string;
}): string {
  const jobs = input.scope === "all"
    ? "all"
    : [...input.jobIds].sort().join(",");
  const files = [...input.files]
    .map((file) => `${file.name}:${file.size}`)
    .sort()
    .join("|");
  return [input.sourceRunId, input.scope, input.analysisMode, jobs, files].join("#");
}

export class ReanalysisSubmitLock {
  private inFlight = false;

  tryAcquire(): boolean {
    if (this.inFlight) return false;
    this.inFlight = true;
    return true;
  }

  release(): void {
    this.inFlight = false;
  }
}

export function reanalyzeControls(input: {
  hasProject: boolean;
  runStatus: string | null;
  occupyingCount: number;
  selectedCount: number;
  submitting: boolean;
  cancelling: boolean;
}) {
  const busy = !input.hasProject
    || input.submitting
    || input.cancelling
    || runIsWorkerActive(input.runStatus)
    || input.runStatus === "uploading";
  return {
    selectedDisabled: busy || input.selectedCount < 1,
    allDisabled: busy || input.occupyingCount < 1,
    selectionDisabled: busy,
  };
}

function drawingLabel(job: Pick<ReanalysisSourceSheet, "detected_sheet_number" | "original_file_name">): string {
  if (job.detected_sheet_number) return `${job.detected_sheet_number} (${job.original_file_name})`;
  return job.original_file_name;
}

function emptyPlan(sourceRunId: string, error: string | null): ReanalysisPlan {
  return {
    sourceRunId,
    accepted: false,
    needsConfirmation: false,
    error,
    items: [],
    reuseCount: 0,
    uploadCount: 0,
    added: 0,
    replaced: 0,
    totalSheets: 0,
    missing: [],
    selectedJobIds: [],
  };
}

function occupyingSheets(jobs: readonly ReanalysisSourceSheet[]): ReanalysisSourceSheet[] {
  return jobs.filter((job) => job.status !== "cancelled");
}

export function planReanalysis(input: {
  sourceRunId: string;
  jobs: readonly ReanalysisSourceSheet[];
  selectedJobIds: readonly string[] | "all";
  incoming?: readonly IncomingAnalyzerSheet[];
  confirmed?: boolean;
  storageExists?: (objectPath: string) => boolean;
}): ReanalysisPlan {
  const saved = occupyingSheets(input.jobs);
  const savedById = new Map(saved.map((job) => [job.id, job]));
  let chosen: ReanalysisSourceSheet[];
  if (input.selectedJobIds === "all") {
    chosen = saved;
  } else {
    const unique = [...new Set(input.selectedJobIds.filter(Boolean))];
    const unknown = unique.filter((id) => !savedById.has(id));
    if (unknown.length > 0) {
      return emptyPlan(
        input.sourceRunId,
        "Select only saved drawings that still occupy a sheet slot",
      );
    }
    chosen = unique.map((id) => savedById.get(id)!);
  }

  const incoming = input.incoming ?? [];
  const uploads: ReanalysisPlanItem[] = [];
  const excluded = new Set<string>();
  let needsConfirmation = false;
  let added = 0;
  let replaced = 0;

  if (incoming.length > 0) {
    const filePlan = planSheetUpdate(input.jobs, incoming, { confirmed: input.confirmed === true });
    if (filePlan.error || filePlan.items.some((item) => item.action === "reject")) {
      return emptyPlan(input.sourceRunId, filePlan.error || "A drawing could not be added");
    }
    needsConfirmation = filePlan.needsConfirmation;
    for (const item of filePlan.items) {
      if (item.action === "add") {
        added += 1;
        uploads.push({ action: "upload", fileName: item.fileName, fileSize: item.fileSize });
      } else if (item.action === "replace" || item.action === "confirm") {
        replaced += 1;
        if (item.jobId) excluded.add(item.jobId);
        uploads.push({
          action: "upload",
          fileName: item.fileName,
          fileSize: item.fileSize,
          replaceJobId: item.jobId,
          sourceJobId: item.jobId,
          existingLabel: item.existingLabel,
        });
      } else if (item.action === "resume" && item.jobId) {
        excluded.add(item.jobId);
        uploads.push({
          action: "upload",
          fileName: item.fileName,
          fileSize: item.fileSize,
          sourceJobId: item.jobId,
        });
      }
    }
  }

  const reuseItems: ReanalysisPlanItem[] = chosen
    .filter((job) => !excluded.has(job.id))
    .sort((left, right) => left.ordinal - right.ordinal)
    .map((job) => ({
      action: "reuse" as const,
      fileName: job.original_file_name,
      fileSize: job.file_size,
      objectPath: job.object_path,
      sourceJobId: job.id,
      detectedSheetNumber: job.detected_sheet_number,
      detectedSheetTitle: job.detected_sheet_title ?? null,
      discipline: job.discipline ?? null,
    }));

  const items = [...reuseItems, ...uploads];
  const totalSheets = items.length;
  const totalBytes = items.reduce((sum, item) => sum + item.fileSize, 0);
  let error: string | null = null;
  if (totalSheets < 1) error = "Select at least one saved drawing or a new PDF sheet";
  else if (totalSheets > ANALYZER_MAX_SHEETS) error = `This analysis cannot exceed ${ANALYZER_MAX_SHEETS} drawings`;
  else if (totalBytes > ANALYZER_MAX_TOTAL_BYTES) error = "Drawing set exceeds the 250 MB run limit";

  const missing: MissingStoredDrawing[] = [];
  if (!error) {
    for (const item of reuseItems) {
      const source = item.sourceJobId ? savedById.get(item.sourceJobId) : undefined;
      const objectPath = item.objectPath || "";
      const located = splitStorageObjectPath(objectPath);
      const present = Boolean(objectPath)
        && Boolean(located)
        && (input.storageExists ? input.storageExists(objectPath) : true);
      if (!present && source) {
        missing.push({
          jobId: source.id,
          fileName: source.original_file_name,
          objectPath,
          label: drawingLabel(source),
        });
      }
    }
    if (missing.length > 0) error = missingStorageMessage(missing);
  }

  return {
    sourceRunId: input.sourceRunId,
    accepted: !error && !needsConfirmation,
    needsConfirmation,
    error,
    items,
    reuseCount: reuseItems.length,
    uploadCount: uploads.length,
    added,
    replaced,
    totalSheets,
    missing,
    selectedJobIds: chosen.map((job) => job.id),
  };
}

export function reanalysisConfirmationCopy(
  plan: ReanalysisPlan,
  intent: ReanalysisIntent,
): ReanalysisConfirmationCopy {
  const countLabel = `${plan.reuseCount} saved drawing${plan.reuseCount === 1 ? "" : "s"} will be reanalyzed. A new analysis will be created. The current run will be kept.`;
  return {
    title: intent === "update" ? "Update Analysis" : "Reanalyze drawings",
    confirmLabel: intent === "all"
      ? "Reanalyze All"
      : intent === "selected"
        ? "Reanalyze Selected"
        : "Update Analysis",
    cancelLabel: "Cancel",
    intro: countLabel,
    adds: plan.items
      .filter((item) => item.action === "upload" && !item.replaceJobId)
      .map((item) => item.fileName),
    replacements: plan.items
      .filter((item) => item.action === "upload" && item.replaceJobId)
      .map((item) => `Replace ${item.existingLabel || "the existing drawing"} with ${item.fileName}. The revised PDF is included once in the new analysis.`),
  };
}

export function materializeReanalysis(
  plan: ReanalysisPlan,
  input: {
    runId: string;
    projectId: string;
    analysisMode: unknown;
    createJobId: () => string;
    reuseSourceKey?: boolean;
  },
): { ok: true; value: MaterializedReanalysis } | { ok: false; error: string } {
  if (!plan.accepted || plan.error || plan.missing.length > 0) {
    return { ok: false, error: plan.error || "Reanalysis was not confirmed" };
  }
  const mode = normalizeNewRunAnalysisMode(input.analysisMode);
  if (typeof mode !== "string") return { ok: false, error: mode.error };
  const reuseSourceKey = input.reuseSourceKey !== false;
  const jobs: MaterializedReanalysisJob[] = plan.items.map((item, index) => {
    const id = input.createJobId();
    const sourceObjectPath = item.action === "reuse" ? item.objectPath || null : null;
    return {
      id,
      run_id: input.runId,
      project_id: input.projectId,
      ordinal: index + 1,
      original_file_name: cleanAnalyzerFileName(item.fileName).trim() || "drawing.pdf",
      object_path: reanalysisStoredObjectPath({
        action: item.action,
        sourceObjectPath,
        projectId: input.projectId,
        runId: input.runId,
        jobId: id,
        reuseSourceKey,
      }),
      source_object_path: sourceObjectPath,
      source_job_id: item.sourceJobId || null,
      file_size: item.fileSize,
      status: item.action === "reuse" ? "queued" : "upload_pending",
      detected_sheet_number: item.detectedSheetNumber ?? null,
      detected_sheet_title: item.detectedSheetTitle ?? null,
      discipline: item.discipline ?? null,
    };
  });
  const uploads = jobs
    .filter((job) => job.status === "upload_pending")
    .map((job) => ({
      jobId: job.id,
      fileName: job.original_file_name,
      fileSize: job.file_size,
      objectPath: job.object_path,
    }));
  return {
    ok: true,
    value: {
      runId: input.runId,
      projectId: input.projectId,
      status: jobs.some((job) => job.status === "queued") ? "queued" : "uploading",
      analysisMode: mode,
      totalSheets: jobs.length,
      sourceRunId: plan.sourceRunId,
      jobs,
      uploads,
      queued: jobs.filter((job) => job.status === "queued").length,
    },
  };
}

export function commitReanalysis(
  store: ReanalysisStore,
  plan: ReanalysisPlan,
  input: {
    requestId: string;
    runId: string;
    projectId: string;
    analysisMode: unknown;
    createJobId: () => string;
    reuseSourceKey?: boolean;
  },
): CommitReanalysisResult {
  const prior = store.commits.get(input.requestId);
  if (prior) {
    const existing = store.runs.find((run) => run.id === prior);
    const jobs = store.jobs.filter((job) => job.run_id === prior);
    return {
      ok: Boolean(existing),
      created: false,
      runId: prior,
      error: existing ? null : "Reanalysis already exists",
      uploads: jobs
        .filter((job) => job.status === "upload_pending")
        .map((job) => ({
          jobId: job.id,
          fileName: job.original_file_name,
          fileSize: job.file_size,
          objectPath: job.object_path,
        })),
      queued: jobs.filter((job) => job.status === "queued").length,
    };
  }

  const materialized = materializeReanalysis(plan, input);
  if (materialized.ok === false) {
    return {
      ok: false,
      created: false,
      runId: null,
      error: materialized.error,
      uploads: [],
      queued: 0,
    };
  }

  const value = materialized.value;
  store.runs.push({
    id: value.runId,
    project_id: value.projectId,
    status: value.status,
    analysis_mode: value.analysisMode,
    total_sheets: value.totalSheets,
  });
  for (const job of value.jobs) {
    store.jobs.push({
      id: job.id,
      run_id: job.run_id,
      ordinal: job.ordinal,
      original_file_name: job.original_file_name,
      object_path: job.object_path,
      file_size: job.file_size,
      detected_sheet_number: job.detected_sheet_number,
      detected_sheet_title: job.detected_sheet_title,
      discipline: job.discipline,
      status: job.status,
    });
  }
  store.commits.set(input.requestId, value.runId);
  return {
    ok: true,
    created: true,
    runId: value.runId,
    error: null,
    uploads: value.uploads,
    queued: value.queued,
  };
}

export function cancelQueuedReanalysis(store: ReanalysisStore, runId: string) {
  const target = store.jobs.filter((job) => job.run_id === runId);
  const kept = store.jobs.filter((job) => job.run_id !== runId);
  const runFindings = store.findings.filter((finding) => finding.run_id === runId);
  const effect = applyCancellation(
    target.map((job) => ({ id: job.id, status: job.status })),
    runFindings,
  );
  const cancelledById = new Map(effect.jobs.map((job) => [job.id, job]));
  const nextTarget = target.map((job) => {
    const cancelled = cancelledById.get(job.id);
    if (!cancelled || cancelled.status === job.status) return job;
    return {
      ...job,
      status: cancelled.status,
      error_code: cancelled.error_code ?? null,
    };
  });
  store.jobs = [...kept, ...nextTarget];
  const publishedById = new Map(runFindings.map((finding, index) => [
    finding.id,
    effect.findings[index]?.is_published ?? finding.is_published,
  ]));
  store.findings = store.findings.map((finding) => {
    const published = publishedById.get(finding.id);
    if (published == null || published === finding.is_published) return finding;
    return { ...finding, is_published: published };
  });
  const run = store.runs.find((item) => item.id === runId);
  if (run) run.status = "cancelled";
  return {
    cancelledJobIds: effect.cancelledJobIds,
    runId,
  };
}
