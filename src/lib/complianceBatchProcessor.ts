import type { DocumentDiscipline } from "@/types/document";

export type ComplianceBatchFileStatus =
  | "pending"
  | "preparing"
  | "uploading"
  | "analyzing"
  | "completed"
  | "failed";

export interface ComplianceBatchIssue {
  id: string;
  category: string;
  title: string;
  description: string;
  severity: "critical" | "warning" | "advisory";
  codeReference: string;
  codeYear: string;
  location: string;
  suggestedFix: string;
  codeType?: "ibc" | "local";
}

export interface ComplianceBatchAnalysisResult {
  issues: ComplianceBatchIssue[];
  summary: {
    totalIssues: number;
    critical: number;
    warnings: number;
    advisory: number;
    overallScore: number;
  };
  jurisdictionNotes: string;
  codeType: "ibc" | "local" | "combined";
}

export interface ComplianceBatchFile {
  id: string;
  /** Omitted when using lazy `fetchSheetImage` until the sheet is loaded. */
  file?: File;
  /** Display name when `file` is not loaded yet (lazy fetch path). */
  fileName?: string;
  discipline: DocumentDiscipline;
  status: ComplianceBatchFileStatus;
  error?: string;
  documentId?: string;
  preparedImageFile?: File;
  ibcResult?: ComplianceBatchAnalysisResult | null;
  localResult?: ComplianceBatchAnalysisResult | null;
  sheetId?: string;
  pageNumber?: number;
  sourceDocumentId?: string;
}

export interface FetchComplianceSheetImageResult {
  file: File;
  preparedImageFile: File;
}

export type FetchComplianceSheetImageFn = (
  item: ComplianceBatchFile,
) => Promise<FetchComplianceSheetImageResult>;

export interface ComplianceBatchProgress {
  /** Total analyzable sheets in this batch. */
  total: number;
  completed: number;
  /** 1-based index of the sheet currently processing. */
  currentIndex: number;
  currentFileName?: string;
  /** Sheets that failed analysis (included in `completed` once finished). */
  failed?: number;
}

export interface UploadDocumentFn {
  (opts: {
    file: File;
    document_type: string;
    description: string;
  }): Promise<{ id: string } | null>;
}

export interface RequestAnalysisFn {
  (opts: {
    imageBase64: string;
    imageType: string;
    jurisdiction: string | null;
    projectType: string;
    codeYear: string;
    codeType: "ibc" | "local" | "both";
    disciplines: DocumentDiscipline[];
  }): Promise<unknown>;
}

export interface ProcessComplianceBatchOptions {
  files: ComplianceBatchFile[];
  /** When true, only process items in `failed` status. */
  onlyFailed?: boolean;
  analysisMode: "both" | "ibc" | "local";
  hasLocalAmendments: boolean;
  jurisdiction: string;
  projectType: string;
  codeYear: string;
  projectId: string | null;
  canPersist: boolean;
  uploadDocument: UploadDocumentFn;
  /** @deprecated PDFs must be expanded to page images before analysis. */
  pdfFirstPageToImageFile?: (file: File) => Promise<File>;
  requestAnalysis: RequestAnalysisFn;
  /** When set, each sheet image is fetched on demand instead of requiring pre-loaded Files. */
  fetchSheetImage?: FetchComplianceSheetImageFn;
  readFileAsBase64?: (file: File) => Promise<string>;
  saveAnalysisToDb: (
    result: ComplianceBatchAnalysisResult,
    documentId: string,
    projectId: string,
    sheet?: { sheetId?: string; pageNumber?: number; sourceDocumentId?: string },
  ) => Promise<void>;
  onFileUpdate: (id: string, patch: Partial<ComplianceBatchFile>) => void;
  onProgress: (progress: ComplianceBatchProgress) => void;
}

export function batchFileDisplayName(item: ComplianceBatchFile): string {
  return item.file?.name ?? item.fileName ?? item.id;
}

export function createComplianceBatchFileId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `batch-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/** Score from issue severities. Empty issues always score 100 (ignore AI-echoed exemplars). */
export function computeComplianceOverallScore(counts: {
  critical: number;
  warnings: number;
  advisory: number;
  totalIssues: number;
}): number {
  if (counts.totalIssues === 0) return 100;
  return Math.max(0, 100 - counts.critical * 15 - counts.warnings * 5 - counts.advisory * 2);
}

export function normalizeComplianceAnalysisResult(
  raw: unknown,
  codeType: "ibc" | "local",
): ComplianceBatchAnalysisResult {
  const d = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const issues = Array.isArray(d.issues) ? (d.issues as ComplianceBatchIssue[]) : [];
  const sum = d.summary && typeof d.summary === "object"
    ? (d.summary as ComplianceBatchAnalysisResult["summary"])
    : null;
  const critical = issues.filter((i) => i.severity === "critical").length;
  const warnings = issues.filter((i) => i.severity === "warning").length;
  const advisory = issues.filter((i) => i.severity === "advisory").length;
  const recomputedScore = computeComplianceOverallScore({
    critical,
    warnings,
    advisory,
    totalIssues: issues.length,
  });
  // Always reconcile counts from the issues array. Never trust an AI/summary score
  // when there are zero issues (prompt exemplars often echo overallScore: 85).
  const summary: ComplianceBatchAnalysisResult["summary"] = {
    totalIssues: issues.length,
    critical,
    warnings,
    advisory,
    overallScore:
      issues.length === 0
        ? 100
        : typeof sum?.overallScore === "number"
          ? sum.overallScore
          : recomputedScore,
  };
  return {
    issues,
    summary,
    jurisdictionNotes: typeof d.jurisdictionNotes === "string" ? d.jurisdictionNotes : "",
    codeType,
  };
}

async function fileToBase64(file: File): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(",")[1] ?? "");
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function filesToProcess(files: ComplianceBatchFile[], onlyFailed?: boolean): ComplianceBatchFile[] {
  if (onlyFailed) {
    return files.filter((f) => f.status === "failed");
  }
  return files.filter((f) => f.status === "pending");
}

/**
 * Processes compliance batch files sequentially (prepare → upload → analyze → save).
 * Failed files do not stop the batch. Retry passes `onlyFailed: true` to skip completed rows.
 */
export async function processComplianceBatch(
  options: ProcessComplianceBatchOptions,
): Promise<{ succeeded: number; failed: number }> {
  const queue = filesToProcess(options.files, options.onlyFailed);
  const total = queue.length;
  let completed = 0;
  let succeeded = 0;
  let failed = 0;

  if (total === 0) {
    options.onProgress({ total: 0, completed: 0, currentIndex: 0 });
    return { succeeded: 0, failed: 0 };
  }

  for (let index = 0; index < queue.length; index++) {
    const item = queue[index];
    const currentIndex = index + 1;
    options.onProgress({
      total,
      completed,
      currentIndex,
      currentFileName: batchFileDisplayName(item),
      failed,
    });

    let working: ComplianceBatchFile = { ...item };
    const lazyFetch = Boolean(options.fetchSheetImage);

    try {
      if (!working.preparedImageFile) {
        options.onFileUpdate(working.id, { status: "preparing", error: undefined });
        if (options.fetchSheetImage) {
          const fetched = await options.fetchSheetImage(working);
          working = {
            ...working,
            file: fetched.file,
            preparedImageFile: fetched.preparedImageFile,
            fileName: fetched.file.name,
          };
          options.onFileUpdate(working.id, {
            file: fetched.file,
            preparedImageFile: fetched.preparedImageFile,
            fileName: fetched.file.name,
            status: "preparing",
          });
        } else if (!working.file) {
          throw new Error("Missing drawing file for analysis");
        } else {
          const isPdf =
            working.file.type === "application/pdf" ||
            working.file.name.toLowerCase().endsWith(".pdf");
          if (isPdf) {
            throw new Error(
              "PDF must be expanded into individual page images before analysis. Page 1 is not used as a stand-in for the full drawing set.",
            );
          }
          working = { ...working, preparedImageFile: working.file };
          options.onFileUpdate(working.id, {
            preparedImageFile: working.file,
            status: "preparing",
          });
        }
      }

      if (!working.documentId && options.canPersist && options.projectId) {
        options.onFileUpdate(working.id, { status: "uploading" });
        const newDoc = await options.uploadDocument({
          file: working.preparedImageFile!,
          document_type: "permit_drawing",
          description: `AI compliance analysis - ${options.jurisdiction} ${options.projectType}`,
        });
        if (!newDoc) {
          throw new Error("Failed to upload document to project");
        }
        working = { ...working, documentId: newDoc.id };
        options.onFileUpdate(working.id, { documentId: newDoc.id, status: "uploading" });
      }

      options.onFileUpdate(working.id, { status: "analyzing" });
      const readBase64 = options.readFileAsBase64 ?? fileToBase64;
      const base64 = await readBase64(working.preparedImageFile!);
      const imageType = working.preparedImageFile!.type;

      let ibcResult: ComplianceBatchAnalysisResult | null = null;
      let localResult: ComplianceBatchAnalysisResult | null = null;

      if (options.analysisMode === "both" && options.hasLocalAmendments) {
        const data = await requestAnalysisWithRetry(options.requestAnalysis, {
          imageBase64: base64,
          imageType,
          jurisdiction: options.jurisdiction === "general" ? null : options.jurisdiction,
          projectType: options.projectType,
          codeYear: options.codeYear,
          codeType: "both",
          disciplines: [working.discipline],
        });
        const payload = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
        ibcResult = normalizeComplianceAnalysisResult(payload.ibc, "ibc");
        localResult = normalizeComplianceAnalysisResult(payload.local, "local");
      } else if (options.analysisMode === "local" && options.hasLocalAmendments) {
        localResult = normalizeComplianceAnalysisResult(
          await requestAnalysisWithRetry(options.requestAnalysis, {
            imageBase64: base64,
            imageType,
            jurisdiction: options.jurisdiction === "general" ? null : options.jurisdiction,
            projectType: options.projectType,
            codeYear: options.codeYear,
            codeType: "local",
            disciplines: [working.discipline],
          }),
          "local",
        );
      } else {
        ibcResult = normalizeComplianceAnalysisResult(
          await requestAnalysisWithRetry(options.requestAnalysis, {
            imageBase64: base64,
            imageType,
            jurisdiction: options.jurisdiction === "general" ? null : options.jurisdiction,
            projectType: options.projectType,
            codeYear: options.codeYear,
            codeType: "ibc",
            disciplines: [working.discipline],
          }),
          "ibc",
        );
      }

      if (working.documentId && options.projectId && options.canPersist) {
        const sheetMeta = {
          sheetId: working.sheetId,
          pageNumber: working.pageNumber,
          sourceDocumentId: working.sourceDocumentId,
        };
        if (ibcResult) {
          await options.saveAnalysisToDb(ibcResult, working.documentId, options.projectId, sheetMeta);
        }
        if (localResult) {
          await options.saveAnalysisToDb(localResult, working.documentId, options.projectId, sheetMeta);
        }
      }

      options.onFileUpdate(working.id, {
        status: "completed",
        error: undefined,
        ibcResult,
        localResult,
        fileName: batchFileDisplayName(working),
        documentId: working.documentId,
        ...(lazyFetch
          ? { file: undefined, preparedImageFile: undefined }
          : { preparedImageFile: working.preparedImageFile }),
      });
      succeeded += 1;
    } catch (err) {
      const rawMessage = err instanceof Error ? err.message : "Failed to analyze drawing";
      const message = formatAnalysisErrorMessage(rawMessage);
      options.onFileUpdate(working.id, {
        status: "failed",
        error: message,
        fileName: batchFileDisplayName(working),
        documentId: working.documentId,
        ...(lazyFetch
          ? { file: undefined, preparedImageFile: undefined }
          : { preparedImageFile: working.preparedImageFile }),
      });
      failed += 1;
    }

    completed += 1;
    options.onProgress({
      total,
      completed,
      currentIndex,
      currentFileName: batchFileDisplayName(item),
      failed,
    });
  }

  options.onProgress({ total, completed: total, currentIndex: total, failed });
  return { succeeded, failed };
}

export function canRemoveBatchFile(status: ComplianceBatchFileStatus): boolean {
  return status === "pending" || status === "failed";
}

export function countFailedBatchFiles(files: ComplianceBatchFile[]): number {
  return files.filter((f) => f.status === "failed").length;
}

export function countCompletedBatchFiles(files: ComplianceBatchFile[]): number {
  return files.filter((f) => f.status === "completed").length;
}

export type AnalysisFailureCategory =
  | "unsupported_image"
  | "transient"
  | "timeout"
  | "parse"
  | "rate_limit"
  | "unknown";

const TRANSIENT_ANALYSIS_MAX_RETRIES = 2;
const TRANSIENT_RETRY_BASE_MS = 800;

/** Map raw API/processor errors to a user-facing category. */
export function categorizeAnalysisError(message: string): AnalysisFailureCategory {
  const lower = message.toLowerCase();
  if (
    lower.includes("unsupported") ||
    lower.includes("invalid image") ||
    lower.includes("image format") ||
    lower.includes("corrupt")
  ) {
    return "unsupported_image";
  }
  if (lower.includes("rate limit") || lower.includes("429") || lower.includes("too many requests")) {
    return "rate_limit";
  }
  if (lower.includes("timeout") || lower.includes("timed out") || lower.includes("deadline")) {
    return "timeout";
  }
  if (
    lower.includes("invalid response") ||
    lower.includes("parse") ||
    lower.includes("json") ||
    lower.includes("unexpected token")
  ) {
    return "parse";
  }
  if (
    lower.includes("network") ||
    lower.includes("fetch failed") ||
    lower.includes("econnreset") ||
    lower.includes("502") ||
    lower.includes("503") ||
    lower.includes("504") ||
    lower.includes("service unavailable") ||
    lower.includes("internal server error")
  ) {
    return "transient";
  }
  return "unknown";
}

/** User-facing message reflecting the failure category. */
export function formatAnalysisErrorMessage(message: string): string {
  const category = categorizeAnalysisError(message);
  switch (category) {
    case "unsupported_image":
      return "Unsupported or unreadable image — check the sheet export format.";
    case "rate_limit":
      return "Analysis rate limit reached — wait a moment and retry.";
    case "timeout":
      return "Analysis timed out — retry this sheet.";
    case "parse":
      return "Analysis returned an invalid response — retry this sheet.";
    case "transient":
      return "Temporary analysis service error — retry this sheet.";
    default:
      return message || "Failed to analyze drawing";
  }
}

function isRetriableAnalysisCategory(category: AnalysisFailureCategory): boolean {
  return category === "transient" || category === "rate_limit" || category === "timeout";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function requestAnalysisWithRetry(
  requestAnalysis: RequestAnalysisFn,
  opts: Parameters<RequestAnalysisFn>[0],
): Promise<unknown> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= TRANSIENT_ANALYSIS_MAX_RETRIES; attempt += 1) {
    try {
      return await requestAnalysis(opts);
    } catch (err) {
      lastError = err;
      const message = err instanceof Error ? err.message : String(err);
      const category = categorizeAnalysisError(message);
      if (!isRetriableAnalysisCategory(category) || attempt >= TRANSIENT_ANALYSIS_MAX_RETRIES) {
        throw err;
      }
      await sleep(TRANSIENT_RETRY_BASE_MS * (attempt + 1));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Analysis failed");
}

export function batchProgressPercent(progress: ComplianceBatchProgress): number {
  if (progress.total === 0) return 0;
  return Math.round((progress.completed / progress.total) * 100);
}

export function formatBatchProgressLabel(progress: ComplianceBatchProgress): string {
  if (progress.total === 0) return "";
  const unit = progress.total === 1 ? "sheet" : "sheets";
  if (progress.completed >= progress.total) {
    const failed = progress.failed ?? 0;
    if (failed > 0) {
      const succeeded = progress.total - failed;
      return `${succeeded} completed, ${failed} failed — ${progress.total} total ${unit}`;
    }
    return `${progress.completed} of ${progress.total} ${unit} analyzed`;
  }
  return `Analyzing ${progress.currentIndex} of ${progress.total} ${unit}`;
}

export function formatAnalysisCompletionToast(params: {
  total: number;
  succeeded: number;
  failed: number;
}): { type: "success" | "warning" | "error"; message: string } {
  const { total, succeeded, failed } = params;
  const unit = total === 1 ? "sheet" : "sheets";
  if (failed === 0) {
    return {
      type: "success",
      message: `${total} of ${total} ${unit} analyzed`,
    };
  }
  if (succeeded === 0) {
    return {
      type: "error",
      message: `Analysis failed: all ${failed} ${unit} failed (${total} total)`,
    };
  }
  return {
    type: "warning",
    message: `${succeeded} completed, ${failed} failed — ${total} total ${unit}`,
  };
}
