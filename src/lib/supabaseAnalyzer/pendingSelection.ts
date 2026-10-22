import { mergeComplianceFiles } from "../complianceUploadLimits";
import {
  countPersistedSheets,
  planSheetUpdate,
  type ExistingAnalyzerSheet,
} from "../../../supabase/functions/_shared/analyzerSheetUpdate.ts";
import {
  SUPABASE_ANALYZER_MAX_FILE_BYTES,
  SUPABASE_ANALYZER_MAX_SHEETS,
  SUPABASE_ANALYZER_MAX_TOTAL_BYTES,
} from "./client";

export interface AnalyzerSheetFile {
  name: string;
  size: number;
  type?: string;
}

export type SelectionNoticeCode =
  | "duplicate"
  | "unsupported"
  | "oversized"
  | "sheet_limit"
  | "total_limit";

export interface SelectionNotice {
  code: SelectionNoticeCode;
  fileName: string;
}

export interface MergePendingSelectionResult<T extends AnalyzerSheetFile> {
  files: T[];
  added: T[];
  notices: SelectionNotice[];
  blocked: boolean;
}

export interface SelectionCapacity {
  existingCount: number;
  remaining: number;
  newSheetCount: number;
  replacementCount: number;
}

export interface AnalyzerUploadDescriptor {
  path: string;
  token: string;
  fileName: string;
  fileSize: number;
  jobId: string;
}

export interface AnalyzerSubmissionDraft {
  projectId: string;
  signature: string;
  runId: string;
  uploads: AnalyzerUploadDescriptor[];
}

export function analyzerSheetKey(file: AnalyzerSheetFile): string {
  return `${file.name.trim().toLowerCase()}:${file.size}`;
}

export function isAnalyzerPdf(file: AnalyzerSheetFile): boolean {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

/** Saved jobs that still occupy a sheet slot. Cancelled jobs do not. */
export function savedSheetCount(jobs: readonly { status: string }[]): number {
  return countPersistedSheets(jobs).total;
}

export function existingDrawingsLabel(count: number): string {
  return `${count} drawing${count === 1 ? "" : "s"} already uploaded`;
}

/** Slots left for drawings that are not replacements of a saved sheet. */
export function remainingDrawingCapacity(existingCount: number): number {
  return Math.max(0, SUPABASE_ANALYZER_MAX_SHEETS - existingCount);
}

/**
 * Remaining capacity after the current selection.
 * Uses the sheet-update plan: a replacement keeps the saved sheet count,
 * and only a new drawing reduces the slots left under the 100-sheet cap.
 */
export function selectionCapacity(input: {
  saved: readonly ExistingAnalyzerSheet[];
  pending: readonly AnalyzerSheetFile[];
}): SelectionCapacity {
  const existingCount = savedSheetCount(input.saved);
  if (input.pending.length === 0) {
    return {
      existingCount,
      remaining: remainingDrawingCapacity(existingCount),
      newSheetCount: 0,
      replacementCount: 0,
    };
  }
  const plan = planSheetUpdate(input.saved, input.pending.map(toIncomingSheet));
  const newSheetCount = plan.items.filter((item) => item.action === "add").length;
  const replacementCount = plan.items.filter((item) => (
    item.action === "confirm" || item.action === "replace"
  )).length;
  const occupied = plan.error ? SUPABASE_ANALYZER_MAX_SHEETS : plan.totalSheetsAfter;
  return {
    existingCount,
    remaining: remainingDrawingCapacity(occupied),
    newSheetCount,
    replacementCount,
  };
}

function toIncomingSheet(file: AnalyzerSheetFile) {
  return { name: file.name, size: file.size, type: file.type };
}

/**
 * Accepts new drawings only while the update plan stays within 100 sheets.
 * A replacement is kept and does not use an extra slot. Saved jobs are not modified.
 */
function acceptWithinSavedCapacity<T extends AnalyzerSheetFile>(
  existing: readonly T[],
  eligible: readonly T[],
  savedSheets: readonly ExistingAnalyzerSheet[],
  notices: SelectionNotice[],
): T[] {
  const accepted: T[] = [];
  for (const file of eligible) {
    if (existing.length + accepted.length >= SUPABASE_ANALYZER_MAX_SHEETS) {
      notices.push({ code: "sheet_limit", fileName: file.name });
      continue;
    }
    const probe = planSheetUpdate(
      savedSheets,
      [...existing, ...accepted, file].map(toIncomingSheet),
    );
    const item = probe.items[probe.items.length - 1];
    if (!item || item.action === "reject") {
      notices.push({ code: "duplicate", fileName: file.name });
      continue;
    }
    if (probe.error) {
      notices.push({
        code: probe.error.includes("250 MB") ? "total_limit" : "sheet_limit",
        fileName: file.name,
      });
      continue;
    }
    accepted.push(file);
  }
  return accepted;
}

/**
 * Appends valid PDFs to an existing selection.
 * Sheet capacity uses the shared V2 count helper with the Supabase limit.
 * Previously accepted files are never removed to make room for a new batch.
 * When saved sheets are supplied, only new drawings consume remaining capacity.
 */
export function mergePendingAnalyzerSheets<T extends AnalyzerSheetFile>(
  existing: readonly T[],
  incoming: readonly T[],
  options?: { locked?: boolean; savedSheets?: readonly ExistingAnalyzerSheet[] },
): MergePendingSelectionResult<T> {
  if (options?.locked) {
    return { files: [...existing], added: [], notices: [], blocked: true };
  }

  const notices: SelectionNotice[] = [];
  const seen = new Set(existing.map(analyzerSheetKey));
  let usedBytes = existing.reduce((sum, file) => sum + file.size, 0);
  const eligible: T[] = [];

  for (const file of incoming) {
    if (!isAnalyzerPdf(file)) {
      notices.push({ code: "unsupported", fileName: file.name });
      continue;
    }
    if (file.size > SUPABASE_ANALYZER_MAX_FILE_BYTES) {
      notices.push({ code: "oversized", fileName: file.name });
      continue;
    }
    const key = analyzerSheetKey(file);
    if (seen.has(key)) {
      notices.push({ code: "duplicate", fileName: file.name });
      continue;
    }
    if (usedBytes + file.size > SUPABASE_ANALYZER_MAX_TOTAL_BYTES) {
      notices.push({ code: "total_limit", fileName: file.name });
      continue;
    }
    seen.add(key);
    usedBytes += file.size;
    eligible.push(file);
  }

  let acceptedFiles: T[];
  if (options?.savedSheets) {
    acceptedFiles = acceptWithinSavedCapacity(existing, eligible, options.savedSheets, notices);
  } else {
    const { accepted } = mergeComplianceFiles(
      existing.length,
      eligible as unknown as File[],
      SUPABASE_ANALYZER_MAX_SHEETS,
    );
    acceptedFiles = accepted as unknown as T[];
    for (const file of eligible.slice(acceptedFiles.length)) {
      notices.push({ code: "sheet_limit", fileName: file.name });
    }
  }

  return {
    files: [...existing, ...acceptedFiles],
    added: acceptedFiles,
    notices,
    blocked: false,
  };
}

export function removePendingAnalyzerSheet<T>(files: readonly T[], index: number): T[] {
  if (!Number.isInteger(index) || index < 0 || index >= files.length) return [...files];
  return files.filter((_, current) => current !== index);
}

export function clearPendingAnalyzerSheets<T>(): T[] {
  return [];
}

export function describeSelectionNotices(notices: readonly SelectionNotice[]): string | null {
  if (notices.length === 0) return null;
  const labels: Record<SelectionNoticeCode, string> = {
    duplicate: "already selected",
    unsupported: "not PDF sheets",
    oversized: "over 15 MB",
    sheet_limit: "beyond the 100-sheet limit",
    total_limit: "beyond the 250 MB limit",
  };
  const groups = new Map<SelectionNoticeCode, string[]>();
  for (const notice of notices) {
    const names = groups.get(notice.code) || [];
    names.push(notice.fileName);
    groups.set(notice.code, names);
  }
  return [...groups.entries()].map(([code, names]) => {
    const preview = names.slice(0, 3).join(", ");
    const extra = names.length > 3 ? ` and ${names.length - 3} more` : "";
    return `${names.length} ${labels[code]}: ${preview}${extra}`;
  }).join(". ");
}

export function selectionNoticeTone(
  notices: readonly SelectionNotice[],
): "info" | "warning" | null {
  if (notices.length === 0) return null;
  return notices.every((notice) => notice.code === "duplicate") ? "info" : "warning";
}

export function analyzerSelectionSignature(files: readonly AnalyzerSheetFile[]): string {
  return files.map((file) => `${file.name}:${file.size}`).join("\n");
}

export function analyzerSubmissionPlan(files: readonly AnalyzerSheetFile[]) {
  return {
    runs: files.length > 0 ? 1 : 0,
    jobs: files.length,
  };
}

export function analyzerSubmissionAction(input: {
  inFlight: boolean;
  projectId: string | null;
  files: readonly AnalyzerSheetFile[];
  draft: Pick<AnalyzerSubmissionDraft, "projectId" | "signature"> | null;
  runStatus?: string | null;
}): "ignore" | "resume" | "create" | "update" | "blocked" {
  if (input.inFlight || !input.projectId || input.files.length === 0) return "ignore";
  const signature = analyzerSelectionSignature(input.files);
  if (
    input.draft
    && input.draft.projectId === input.projectId
    && input.draft.signature === signature
  ) {
    return "resume";
  }
  if (input.runStatus === "queued" || input.runStatus === "processing") return "blocked";
  if (
    input.runStatus === "uploading"
    || input.runStatus === "completed"
    || input.runStatus === "completed_with_errors"
    || input.runStatus === "cancelled"
    || input.runStatus === "failed"
  ) {
    return "update";
  }
  return "create";
}

export function failedUploadDescriptors(
  uploads: readonly AnalyzerUploadDescriptor[],
  failedJobIds: readonly string[],
): AnalyzerUploadDescriptor[] {
  const failed = new Set(failedJobIds);
  return uploads.filter((upload) => failed.has(upload.jobId));
}

export function retainPendingSelectionForProject<T>(
  previousProjectId: string | null,
  nextProjectId: string | null,
  files: readonly T[],
  inFlight: boolean,
): readonly T[] {
  if (inFlight || previousProjectId === nextProjectId) return files;
  return [];
}
