/** Progress for Code Analyzer source-file uploads (counts files, not PDF pages). */
export interface DrawingUploadProgress {
  total: number;
  completed: number;
  /** 1-based index of the source file currently uploading. */
  currentIndex: number;
  currentFileName?: string;
  /** Optional secondary line while rasterizing or server-side processing a PDF. */
  pdfProcessing?: { fileName: string; pageCount?: number; serverSide?: boolean };
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
  const countLabel =
    progress.completed >= progress.total
      ? `${progress.completed} of ${progress.total} uploaded`
      : `${progress.currentIndex} of ${progress.total}`;
  if (progress.currentFileName && progress.phase === "uploading") {
    return `Uploading ${progress.currentFileName} — ${countLabel}`;
  }
  return `Uploading drawings — ${countLabel}`;
}

export function formatPdfProcessingDetail(progress: DrawingUploadProgress): string | null {
  if (!progress.pdfProcessing) return null;
  const { fileName, pageCount, serverSide } = progress.pdfProcessing;
  if (serverSide) {
    return `Queued ${fileName} for server-side processing`;
  }
  if (pageCount != null) {
    return `Processing ${pageCount} page${pageCount === 1 ? "" : "s"} from ${fileName}`;
  }
  return `Processing ${fileName}`;
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
          ? "1 drawing uploaded successfully"
          : `All ${total} drawings uploaded successfully`,
    };
  }

  if (succeeded === 0) {
    return {
      type: "error",
      message: `Upload failed: none of ${total} drawing${total === 1 ? "" : "s"} uploaded`,
    };
  }

  return {
    type: "warning",
    message: `${succeeded} of ${total} uploaded — ${failed} failed`,
  };
}

/** Hide the progress bar once every source file has finished (success or failure). */
export function shouldClearUploadProgress(progress: DrawingUploadProgress): boolean {
  return progress.phase === "complete" && progress.completed >= progress.total;
}
