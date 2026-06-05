import type {
  AiIngestionStatus,
  DocumentIngestionJob,
  IngestionProgressInfo,
  ProjectDocument,
} from '@/types/document';

const STUCK_PENDING_MS = 2 * 60 * 1000;
const STUCK_PROCESSING_MS = 3 * 60 * 1000;

export function isIngestSupportedDocument(doc: ProjectDocument): boolean {
  const lower = doc.file_name.toLowerCase();
  if (lower.endsWith('.doc') && !lower.endsWith('.docx')) return false;
  return (
    doc.file_type === 'application/pdf' ||
    lower.endsWith('.pdf') ||
    doc.file_type ===
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    lower.endsWith('.docx')
  );
}

export function isActiveDocumentStatus(status?: AiIngestionStatus | null): boolean {
  return status === 'queued' || status === 'processing';
}

export function isActiveJobStatus(status?: string): boolean {
  return status === 'pending' || status === 'processing' || status === 'queued';
}

export function isTerminalDocumentStatus(status?: AiIngestionStatus | null): boolean {
  return (
    status === 'completed' ||
    status === 'failed' ||
    status === 'partial' ||
    status === 'low_text' ||
    status === 'unsupported'
  );
}

export function detectStuckJob(job: DocumentIngestionJob): boolean {
  const now = Date.now();

  if (job.status === 'pending') {
    const created = new Date(job.created_at).getTime();
    return now - created > STUCK_PENDING_MS;
  }

  if (job.status === 'processing') {
    const updated = new Date(job.updated_at).getTime();
    return now - updated > STUCK_PROCESSING_MS;
  }

  return false;
}

export function jobToProgressInfo(job: DocumentIngestionJob): IngestionProgressInfo {
  const progress = (job.progress ?? {}) as Record<string, unknown>;

  return {
    jobId: job.id,
    status: job.status === 'pending' ? 'queued' : job.status,
    phase: typeof progress.phase === 'string' ? progress.phase : undefined,
    currentPage: typeof progress.page === 'number' ? progress.page : undefined,
    processedPages: job.processed_pages,
    totalPages: job.total_pages ?? undefined,
    totalChunks: job.total_chunks,
    error: job.error ?? undefined,
    updatedAt: job.updated_at,
    isStuck: detectStuckJob(job),
  };
}

export function shortErrorMessage(error?: string | null, maxLen = 120): string {
  if (!error) return 'Unknown error';
  const trimmed = error.trim();
  if (trimmed.length <= maxLen) return trimmed;
  return `${trimmed.slice(0, maxLen - 1)}…`;
}

export interface AiStatusDisplay {
  primary: string;
  secondary?: string;
  isStuck?: boolean;
  showSpinner?: boolean;
}

export function formatAiStatusDisplay(
  doc: ProjectDocument,
  progress?: IngestionProgressInfo | null,
): AiStatusDisplay | null {
  const status = doc.ai_ingestion_status ?? 'not_started';
  const activeProgress =
    progress && isActiveJobStatus(progress.status) ? progress : null;

  if (activeProgress || isActiveDocumentStatus(status)) {
    const p = activeProgress;
    const stuck = p?.isStuck ?? false;

    if (
      p?.status === 'queued' ||
      p?.phase === 'queued' ||
      status === 'queued' ||
      p?.status === 'pending'
    ) {
      return {
        primary: 'Queued for AI preparation',
        secondary: stuck
          ? 'Waiting for the ingestion worker. Make sure the worker is running.'
          : p?.updatedAt
            ? `Updated ${formatRelativeTime(p.updatedAt)}`
            : undefined,
        isStuck: stuck,
        showSpinner: true,
      };
    }

    if (p?.phase === 'embedding') {
      return {
        primary: 'Embedding chunks…',
        secondary: p.totalChunks ? `${p.totalChunks} chunks created` : undefined,
        showSpinner: true,
      };
    }

    if (p?.phase === 'downloading') {
      return {
        primary: 'Downloading document…',
        showSpinner: true,
      };
    }

    const page = p?.currentPage ?? p?.processedPages;
    if (p?.totalPages && page != null && page > 0) {
      return {
        primary: `Processing page ${page} of ${p.totalPages}`,
        secondary: [
          p.totalChunks ? `${p.totalChunks} chunks created` : null,
          p.updatedAt ? `Updated ${formatRelativeTime(p.updatedAt)}` : null,
        ]
          .filter(Boolean)
          .join(' · ') || undefined,
        isStuck: stuck,
        showSpinner: true,
      };
    }

    return {
      primary: 'Processing document…',
      secondary: [
        p?.totalChunks ? `${p.totalChunks} chunks created` : null,
        stuck
          ? 'Waiting for the ingestion worker. Make sure the worker is running.'
          : p?.updatedAt
            ? `Updated ${formatRelativeTime(p.updatedAt)}`
            : null,
      ]
        .filter(Boolean)
        .join(' · ') || undefined,
      isStuck: stuck,
      showSpinner: true,
    };
  }

  if (status === 'completed') {
    return {
      primary: 'Ready for AI',
      secondary:
        typeof doc.ai_chunk_count === 'number' && doc.ai_chunk_count > 0
          ? `${doc.ai_chunk_count} chunks`
          : undefined,
    };
  }

  if (status === 'partial') {
    return {
      primary: 'Partially prepared',
      secondary: doc.ai_ingestion_error
        ? shortErrorMessage(doc.ai_ingestion_error)
        : doc.ai_chunk_count
          ? `${doc.ai_chunk_count} chunks`
          : undefined,
    };
  }

  if (status === 'low_text') {
    return {
      primary: 'OCR may be needed',
      secondary:
        doc.ai_ingestion_error ??
        'Document prepared with limited text. OCR may be needed for scanned/image-based sheets.',
    };
  }

  if (status === 'failed') {
    return {
      primary: `Failed: ${shortErrorMessage(doc.ai_ingestion_error ?? progress?.error)}`,
    };
  }

  if (status === 'unsupported') {
    return {
      primary: 'Unsupported file type',
      secondary: doc.ai_ingestion_error ?? 'Use PDF or DOCX for AI preparation.',
    };
  }

  if (status !== 'not_started') {
    return { primary: status };
  }

  return null;
}

export function getPrepareButtonLabel(
  status?: AiIngestionStatus | null,
  stuck?: boolean,
): string {
  if (stuck) return 'Retry AI Prep';
  if (status === 'failed') return 'Retry AI Prep';
  if (status === 'partial' || status === 'low_text') return 'Re-run AI Prep';
  return 'Prepare for AI';
}

export function canShowPrepareButton(doc: ProjectDocument): boolean {
  if (!isIngestSupportedDocument(doc)) return false;
  if (doc.ai_ingestion_status === 'unsupported') return false;
  if (doc.ai_ingestion_status === 'completed') return false;
  return true;
}

export function isPrepareActionDisabled(
  doc: ProjectDocument,
  preparingId: string | null | undefined,
  progress?: IngestionProgressInfo | null,
): boolean {
  if (preparingId === doc.id) return true;

  const stuck = progress?.isStuck ?? false;
  if (isActiveDocumentStatus(doc.ai_ingestion_status) && !stuck) return true;

  if (progress && isActiveJobStatus(progress.status) && !stuck) return true;

  return false;
}

export function formatRelativeTime(iso: string): string {
  const date = new Date(iso);
  const diffSec = Math.round((Date.now() - date.getTime()) / 1000);
  if (diffSec < 60) return 'just now';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export async function parseIngestInvokeError(
  invokeError: { message?: string; context?: Response } | null,
  data: unknown,
): Promise<string> {
  if (data && typeof data === 'object' && data !== null && 'error' in data) {
    const errMsg = (data as { error?: string }).error;
    if (errMsg) return errMsg;
  }

  if (invokeError?.context && typeof invokeError.context.json === 'function') {
    try {
      const body = (await invokeError.context.json()) as { error?: string; message?: string };
      if (body?.error) return body.error;
      if (body?.message) return body.message;
    } catch {
      // ignore parse errors
    }
  }

  const msg = invokeError?.message ?? '';
  if (/non-2xx|2xx status code/i.test(msg)) {
    return 'Failed to queue AI preparation. Check your connection and try again.';
  }

  return msg.trim() || 'Failed to prepare document for AI';
}
