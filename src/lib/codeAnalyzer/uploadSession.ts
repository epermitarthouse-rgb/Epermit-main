/**
 * Transient upload-session lifecycle for Code Analyzer source-file selection.
 * Separates per-batch upload counts from project document totals and batch caps.
 */
import type { DrawingUploadProgress } from "./uploadBatchProgress";
import { shouldShowUploadProgress } from "./uploadBatchProgress";

export interface UploadSessionState {
  /** True while the user is selecting or uploading files in the current batch. */
  active: boolean;
  /** Source documents in this upload round (not project total or max batch cap). */
  batchTotal: number;
}

export function createUploadSession(batchTotal: number): UploadSessionState {
  const total = Math.max(0, batchTotal);
  return { active: total > 0, batchTotal: total };
}

/** Extend or start a session when the pending queue grows. */
export function extendUploadSession(
  session: UploadSessionState | null | undefined,
  pendingQueueCount: number,
  uploadTotal?: number,
): UploadSessionState | null {
  const batchTotal = Math.max(pendingQueueCount, uploadTotal ?? 0);
  if (batchTotal <= 0) return session?.active ? { ...session, batchTotal: 0 } : null;
  if (!session?.active) return createUploadSession(batchTotal);
  // Never carry forward a stale larger batchTotal (e.g. prior 16-file session).
  return {
    active: true,
    batchTotal,
  };
}

export function resetUploadSession(): null {
  return null;
}

/** Resolve batch total for labels — never project doc count or COMPLIANCE_MAX_BATCH_FILES. */
export function resolveUploadSessionBatchTotal(
  session: UploadSessionState | null | undefined,
  pendingQueueCount: number,
  uploadProgress?: DrawingUploadProgress | null,
): number {
  return Math.max(
    session?.batchTotal ?? 0,
    pendingQueueCount,
    uploadProgress?.total ?? 0,
  );
}

/** True while files are being selected or actively uploading in the current batch. */
export function isUploadSessionActive(
  session: UploadSessionState | null | undefined,
  uploadProgress: DrawingUploadProgress | null | undefined,
  pendingQueueCount: number,
): boolean {
  if (shouldShowUploadProgress(uploadProgress)) return true;
  if (!session?.active) return false;
  return pendingQueueCount > 0;
}

/** Gate the "N of M source documents in this upload" line. */
export function shouldShowPendingUploadCapacityLabel(
  session: UploadSessionState | null | undefined,
  uploadProgress: DrawingUploadProgress | null | undefined,
  pendingQueueCount: number,
): boolean {
  if (!isUploadSessionActive(session, uploadProgress, pendingQueueCount)) return false;
  if (pendingQueueCount <= 0) return false;
  return resolveUploadSessionBatchTotal(session, pendingQueueCount, uploadProgress) > 0;
}

/** Pending upload queue line — null when session inactive or queue empty (never "0 of N"). */
export function formatPendingUploadCapacityLabel(
  queuedCount: number,
  batchTotal: number,
): string | null {
  if (queuedCount <= 0 || batchTotal <= 0) return null;
  const unit = queuedCount === 1 ? "document" : "documents";
  return `${queuedCount} of ${batchTotal} source ${unit} in this upload`;
}

/**
 * Sync session with pending queue + upload progress.
 * Clears on terminal idle; shrinks batch total when files are removed pre-upload.
 */
export function syncUploadSession(
  session: UploadSessionState | null | undefined,
  pendingQueueCount: number,
  uploadProgress?: DrawingUploadProgress | null,
): UploadSessionState | null {
  if (shouldShowUploadProgress(uploadProgress)) {
    return extendUploadSession(session, pendingQueueCount, uploadProgress!.total);
  }
  if (pendingQueueCount <= 0) {
    return resetUploadSession();
  }
  return {
    active: true,
    batchTotal: Math.max(pendingQueueCount, uploadProgress?.total ?? 0),
  };
}
