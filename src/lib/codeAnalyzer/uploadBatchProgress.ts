/** Progress for Code Analyzer source-file uploads (counts files, not PDF pages). */
export interface DrawingUploadProgress {
  total: number;
  completed: number;
  /** 1-based index of the source file currently uploading. */
  currentIndex: number;
  currentFileName?: string;
  /** Optional secondary line while rasterizing a multi-page PDF. */
  pdfProcessing?: { fileName: string; pageCount: number };
  phase: "uploading" | "complete";
}

export interface UploadCompletionToast {
  type: "success" | "warning" | "error";
  message: string;
}

export function uploadProgressPercent(progress: DrawingUploadProgress): number {
  if (progress.total === 0) return 0;
  return Math.round((progress.completed / progress.total) * 100);
}

export function formatUploadProgressLabel(progress: DrawingUploadProgress): string {
  if (progress.total === 0) return "";
  const unit = progress.total === 1 ? "document" : "documents";
  const countLabel =
    progress.completed >= progress.total
      ? `${progress.completed} of ${progress.total} ${unit} uploaded`
      : `${progress.currentIndex} of ${progress.total} ${unit}`;
  if (progress.currentFileName && progress.phase === "uploading") {
    return `Uploading ${progress.currentFileName} — ${countLabel}`;
  }
  return `Uploading documents — ${countLabel}`;
}

export function formatPdfProcessingDetail(progress: DrawingUploadProgress): string | null {
  if (!progress.pdfProcessing) return null;
  const { fileName, pageCount } = progress.pdfProcessing;
  return `Processing ${pageCount} page${pageCount === 1 ? "" : "s"} from ${fileName}`;
}

export function formatUploadCompletionToast(params: {
  total: number;
  succeeded: number;
  failed: number;
  singleFileName?: string;
}): UploadCompletionToast | null {
  const { total, succeeded, failed, singleFileName } = params;
  if (total === 0) return null;

  if (total === 1 && singleFileName) {
    if (failed === 1) {
      return { type: "error", message: `Failed to upload ${singleFileName}` };
    }
    return { type: "success", message: `${singleFileName} uploaded successfully` };
  }

  if (failed === 0) {
    return {
      type: "success",
      message:
        total === 1
          ? "1 document uploaded successfully"
          : `All ${total} documents uploaded successfully`,
    };
  }

  if (succeeded === 0) {
    return {
      type: "error",
      message: `Upload failed: none of ${total} document${total === 1 ? "" : "s"} uploaded`,
    };
  }

  return {
    type: "warning",
    message: `${succeeded} of ${total} documents uploaded — ${failed} failed`,
  };
}

/** Hide the progress bar once every source file has finished (success or failure). */
export function shouldClearUploadProgress(progress: DrawingUploadProgress): boolean {
  return progress.phase === "complete" && progress.completed >= progress.total;
}
