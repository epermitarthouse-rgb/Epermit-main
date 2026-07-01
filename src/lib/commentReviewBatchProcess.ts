import { markRowsAsParsed, type ParsedRow } from "@/lib/commentReviewUploadRow";
import { prepareCommentLetterExtractionFile } from "@/lib/commentReviewLegacyDocParse";
import {
  batchFileStatusLabel,
  type PendingUploadFile,
} from "@/lib/commentReviewBatchUpload";
import {
  extractDocumentForCommentParse,
  fileToBase64,
  isLegacyDocFile,
} from "@/utils/extractDocumentText";
import { pdfFirstPageToImageFile } from "@/utils/pdfToImage";

export const BATCH_TIMEOUTS = {
  upload: 60_000,
  conversion: 120_000,
  extraction: 60_000,
  parsing: 120_000,
} as const;

export type BatchProcessStage = "upload" | "conversion" | "extraction" | "parsing";

interface ParserSummary {
  total: number;
  by_section: Record<string, number>;
  by_discipline: Record<string, number>;
}

export class BatchStageTimeoutError extends Error {
  readonly stage: BatchProcessStage;

  constructor(stage: BatchProcessStage) {
    super(`Timed out during ${stageDisplayName(stage)}`);
    this.name = "BatchStageTimeoutError";
    this.stage = stage;
  }
}

export class BatchStageError extends Error {
  readonly stage: BatchProcessStage;
  readonly code: string;

  constructor(stage: BatchProcessStage, message: string, code: string) {
    super(message);
    this.name = "BatchStageError";
    this.stage = stage;
    this.code = code;
  }
}

function stageDisplayName(stage: BatchProcessStage): string {
  switch (stage) {
    case "upload":
      return "upload";
    case "conversion":
      return "conversion";
    case "extraction":
      return "extraction";
    case "parsing":
      return "parsing";
    default:
      return stage;
  }
}

export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  stage: BatchProcessStage,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new BatchStageTimeoutError(stage)), ms);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

export function logCommentBatch(
  jobId: string,
  event: string,
  details: Record<string, string | number | undefined>,
): void {
  console.info("[comment-batch]", event, { jobId, ...details });
}

export function pendingFileStatusDisplay(item: PendingUploadFile): string {
  if (item.status === "success" && item.commentCount != null) {
    return `Complete · ${item.commentCount} comment${item.commentCount !== 1 ? "s" : ""}`;
  }
  if (item.status === "failed") {
    if (item.timedOut && item.failedStage) {
      return `Timed out during ${stageDisplayName(item.failedStage)}`;
    }
    if (item.failedStage) {
      const prefix = `Failed during ${stageDisplayName(item.failedStage)}`;
      return item.error ? `${prefix}: ${item.error}` : prefix;
    }
    return item.error || "Failed";
  }
  return batchFileStatusLabel(item.status);
}

export function classifyBatchFailure(err: unknown): {
  stage: BatchProcessStage;
  timedOut: boolean;
  code: string;
  message: string;
} {
  if (err instanceof BatchStageTimeoutError) {
    return {
      stage: err.stage,
      timedOut: true,
      code: "timeout",
      message: err.message,
    };
  }
  if (err instanceof BatchStageError) {
    return {
      stage: err.stage,
      timedOut: false,
      code: err.code,
      message: err.message,
    };
  }

  const message =
    err instanceof Error && err.message.trim()
      ? err.message.trim()
      : "Processing failed";

  const lower = message.toLowerCase();
  if (/auth|unauthorized|401|invalid or expired/i.test(lower)) {
    return { stage: "conversion", timedOut: false, code: "auth_failure", message: "Authentication failed" };
  }
  if (/conversion|libreoffice|legacy word|convert-legacy-word|unavailable on this server/i.test(lower)) {
    return { stage: "conversion", timedOut: false, code: "conversion_failed", message };
  }
  if (/empty|invalid response/i.test(lower)) {
    return { stage: "conversion", timedOut: false, code: "empty_converted_output", message };
  }
  if (/unsupported|extract|mammoth|docx/i.test(lower)) {
    return { stage: "extraction", timedOut: false, code: "extraction_failed", message };
  }
  if (/parse|parser|classification/i.test(lower)) {
    return { stage: "parsing", timedOut: false, code: "parser_failed", message };
  }
  if (/upload|storage|project document|mime|file type/i.test(lower)) {
    return { stage: "upload", timedOut: false, code: "upload_failed", message };
  }

  if (message.length <= 200 && !/stack|supabase|postgres|internal/i.test(message)) {
    return { stage: "parsing", timedOut: false, code: "unknown", message };
  }

  return { stage: "parsing", timedOut: false, code: "unknown", message: "Processing failed" };
}

async function buildParserInvokeBody(
  extraction: Awaited<ReturnType<typeof extractDocumentForCommentParse>>,
  sourceFileName: string,
  sourceDocumentId: string,
): Promise<Record<string, unknown>> {
  const base = { sourceFileName, sourceDocumentId };

  if (extraction.kind === "text") {
    return {
      ...base,
      fullText: extraction.fullText,
      pages: extraction.pages,
    };
  }

  if (extraction.kind === "image") {
    const fileForVision =
      extraction.file.type === "application/pdf"
        ? await pdfFirstPageToImageFile(extraction.file)
        : extraction.file;

    return {
      ...base,
      imageBase64: await fileToBase64(fileForVision),
      imageType: fileForVision.type,
      pageNumber: 1,
    };
  }

  throw new BatchStageError("extraction", extraction.message, "unsupported_doc");
}

export interface ProcessOneCommentReviewFileParams {
  jobId: string;
  fileRow: PendingUploadFile;
  projectId: string;
  onStageUpdate: (id: string, patch: Partial<PendingUploadFile>) => void;
  persistCommentLetterForFile: (file: File) => Promise<{ docId: string | null; error?: string }>;
  invokeCommentParser: (
    invokeBody: Record<string, unknown>,
  ) => Promise<{
    comments: Array<Omit<ParsedRow, "row_source" | "_clientId">>;
    parse_method?: string;
    parser_summary?: ParserSummary;
  }>;
  appendRows: (rows: ParsedRow[]) => void;
}

export interface ProcessOneCommentReviewFileResult {
  success: boolean;
  commentCount: number;
  parseMethod?: string;
  parserSummary?: ParserSummary;
}

export async function processOneCommentReviewFile(
  params: ProcessOneCommentReviewFileParams,
): Promise<ProcessOneCommentReviewFileResult> {
  const {
    jobId,
    fileRow,
    projectId,
    onStageUpdate,
    persistCommentLetterForFile,
    invokeCommentParser,
    appendRows,
  } = params;

  const startedAt = Date.now();
  logCommentBatch(jobId, "file started", {
    fileId: fileRow.id,
    fileName: fileRow.file.name,
  });

  try {
    onStageUpdate(fileRow.id, {
      status: "uploading",
      error: undefined,
      failedStage: undefined,
      timedOut: false,
    });

    const uploadResult = await withTimeout(
      persistCommentLetterForFile(fileRow.file),
      BATCH_TIMEOUTS.upload,
      "upload",
    );

    if (!uploadResult.docId) {
      throw new BatchStageError(
        "upload",
        uploadResult.error ?? "Failed to save comment letter to project documents",
        "upload_rejected",
      );
    }

    const docId = uploadResult.docId;
    onStageUpdate(fileRow.id, { sourceDocumentId: docId });
    logCommentBatch(jobId, "upload complete", {
      fileId: fileRow.id,
      sourceDocumentId: docId,
      durationMs: Date.now() - startedAt,
    });

    let extractionFile = fileRow.file;
    if (isLegacyDocFile(fileRow.file)) {
      onStageUpdate(fileRow.id, { status: "converting" });
      extractionFile = await withTimeout(
        prepareCommentLetterExtractionFile({
          projectId,
          sourceDocumentId: docId,
          originalFile: fileRow.file,
          conversionTimeoutMs: BATCH_TIMEOUTS.conversion,
        }),
        BATCH_TIMEOUTS.conversion,
        "conversion",
      );

      if (extractionFile.size === 0) {
        throw new BatchStageError(
          "conversion",
          "Converted document is empty",
          "empty_converted_output",
        );
      }

      logCommentBatch(jobId, "conversion complete", {
        fileId: fileRow.id,
        sourceDocumentId: docId,
        durationMs: Date.now() - startedAt,
      });
    }

    onStageUpdate(fileRow.id, { status: "extracting" });
    const extraction = await withTimeout(
      extractDocumentForCommentParse(extractionFile),
      BATCH_TIMEOUTS.extraction,
      "extraction",
    );

    if (extraction.kind === "unsupported_doc") {
      throw new BatchStageError("extraction", extraction.message, "unsupported_doc");
    }

    logCommentBatch(jobId, "extraction complete", {
      fileId: fileRow.id,
      sourceDocumentId: docId,
      durationMs: Date.now() - startedAt,
    });

    onStageUpdate(fileRow.id, { status: "parsing" });
    const invokeBody = await buildParserInvokeBody(
      extraction,
      fileRow.file.name,
      docId,
    );

    const { comments, parse_method, parser_summary } = await withTimeout(
      invokeCommentParser(invokeBody),
      BATCH_TIMEOUTS.parsing,
      "parsing",
    );

    const parsedRows = markRowsAsParsed(comments, { sourceLabel: fileRow.file.name }).map(
      (row) => ({
        ...row,
        _sourceDocumentId: docId,
        source_file: fileRow.file.name,
      }),
    );

    appendRows(parsedRows);
    onStageUpdate(fileRow.id, {
      status: "success",
      commentCount: parsedRows.length,
      parseMethod: parse_method,
      sourceDocumentId: docId,
      error: undefined,
      failedStage: undefined,
      timedOut: false,
    });

    logCommentBatch(jobId, "parser complete", {
      fileId: fileRow.id,
      sourceDocumentId: docId,
      commentCount: parsedRows.length,
      durationMs: Date.now() - startedAt,
    });

    return {
      success: true,
      commentCount: parsedRows.length,
      parseMethod: parse_method,
      parserSummary: parser_summary,
    };
  } catch (err: unknown) {
    const failure = classifyBatchFailure(err);
    logCommentBatch(jobId, "file failed", {
      fileId: fileRow.id,
      stage: failure.stage,
      errorCode: failure.code,
      durationMs: Date.now() - startedAt,
    });
    onStageUpdate(fileRow.id, {
      status: "failed",
      failedStage: failure.stage,
      timedOut: failure.timedOut,
      error: failure.message,
    });
    return { success: false, commentCount: 0 };
  }
}
