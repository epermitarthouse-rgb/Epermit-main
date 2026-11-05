/**
 * Client-facing upload and analysis status for the Supabase Code Analyzer.
 * Derives labels from persisted run + sheet jobs (not temporary counters alone).
 */

export type AnalyzerWorkflowStage =
  | "ready"
  | "uploading"
  | "ocr_prep"
  | "analyzing"
  | "complete"
  | "complete_with_errors"
  | "failed"
  | "cancelled";

export interface AnalyzerJobStatusSlice {
  status: string;
}

export interface AnalyzerRunStatusSlice {
  status: string;
  total_sheets: number;
  uploaded_sheets?: number | null;
  queued_sheets?: number | null;
  processing_sheets?: number | null;
  completed_sheets?: number | null;
  failed_sheets?: number | null;
  analysis_scope?: unknown;
}

export interface LiveUploadProgress {
  completed: number;
  total: number;
  failed?: number;
  fileName?: string;
  phase?: "uploading" | "complete";
}

export interface AnalyzerWorkflowView {
  stage: AnalyzerWorkflowStage;
  /** Primary client-facing status line. */
  headline: string;
  /** Optional secondary detail. */
  detail: string | null;
  /** Progress 0–100 for the active stage bar; null when not applicable. */
  progressPercent: number | null;
  /** True when a prior completed analysis no longer represents the current drawing set. */
  drawingSetOutdated: boolean;
  /** Show prior findings under history rather than as the current run state. */
  treatFindingsAsPrevious: boolean;
  upload: {
    uploaded: number;
    total: number;
    failed: number;
    pending: number;
  } | null;
  ocr: {
    ready: number;
    total: number;
    evidenceVerified?: boolean;
    incompleteSheets?: string[];
  } | null;
  analysis: {
    finished: number;
    total: number;
    /** True only after GPT sheet jobs have finished — never inferred from OCR alone. */
    injectedConfirmed?: boolean;
  } | null;
}

function countableJobs(jobs: readonly AnalyzerJobStatusSlice[]) {
  return jobs.filter((job) => job.status !== "cancelled");
}

function isStage3FullCoverage(scope: unknown): boolean {
  if (!scope || typeof scope !== "object" || Array.isArray(scope)) return false;
  return (scope as Record<string, unknown>).stage3FullCoverageOcr === true;
}

function readOcrCounts(scope: unknown): {
  ready: number;
  total: number;
  terminal: boolean;
  evidenceVerified: boolean;
  incompleteSheets: string[];
  failed: number;
} | null {
  if (!isStage3FullCoverage(scope)) return null;
  const raw = (scope as Record<string, unknown>).stage3OcrPreprocess;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      ready: 0,
      total: 0,
      terminal: false,
      evidenceVerified: false,
      incompleteSheets: [],
      failed: 0,
    };
  }
  const preprocess = raw as {
    requiredSheetCount?: number;
    terminal?: boolean;
    missingEvidence?: number;
    incompleteSheets?: unknown;
    counts?: { completed?: number; failed?: number; skipped?: number; pending?: number; processing?: number };
  };
  const counts = preprocess.counts || {};
  const ready = Number(counts.completed || 0) + Number(counts.skipped || 0);
  const failed = Number(counts.failed || 0);
  const total = Math.max(
    0,
    Number(preprocess.requiredSheetCount || 0)
      || ready + Number(counts.pending || 0) + Number(counts.processing || 0) + failed,
  );
  const terminalCount = ready + failed;
  const terminal = preprocess.terminal === true || (total > 0 && terminalCount >= total);
  const incompleteSheets = Array.isArray(preprocess.incompleteSheets)
    ? preprocess.incompleteSheets.map((item) => String(item || "").trim()).filter(Boolean).slice(0, 120)
    : [];
  const evidenceVerified = terminal
    && failed === 0
    && Number(preprocess.missingEvidence || 0) === 0
    && (total <= 0 || Number(counts.completed || 0) >= total);
  return { ready, total, terminal, evidenceVerified, incompleteSheets, failed };
}

export function countPersistedUploadManifest(jobs: readonly AnalyzerJobStatusSlice[]) {
  const active = countableJobs(jobs);
  const pending = active.filter((job) => job.status === "upload_pending").length;
  const failedUploads = 0; // upload failures remain as upload_pending until replaced/retried
  const uploaded = active.length - pending;
  return {
    uploaded: Math.max(0, uploaded),
    total: active.length,
    pending,
    failed: failedUploads,
  };
}

function drawingCountSentence(count: number, total: number, ending: string): string | null {
  if (total <= 0) return null;
  return `${count} of ${total} drawings ${ending}`;
}

function joinStatusSentences(parts: Array<string | null | undefined>): string | null {
  const text = parts.filter((part): part is string => Boolean(part && part.trim())).join(" ");
  return text || null;
}

export function formatUploadingDrawingsLabel(uploaded: number, total: number, _fileName?: string): string {
  return drawingCountSentence(uploaded, total, "have been received.") || "Drawings are being received.";
}

export function formatUploadSuccessLabel(uploaded: number, total: number): string {
  return drawingCountSentence(uploaded, Math.max(total, uploaded), "were received.") || "Drawings were received.";
}

export function formatUploadFailureLabel(uploaded: number, total: number, failed: number): string {
  if (failed <= 0) return formatUploadSuccessLabel(uploaded, total);
  if (uploaded <= 0) return "Drawings could not be received.";
  return "Some drawings could not be received.";
}

/**
 * The status sentence stays mounted for an active run.
 * Sheet selection, list page, and scroll position are not inputs, so paging
 * through drawings cannot hide it. A queued run that has finished reading
 * drawings stays visible too (`stage === "ready"` while the run is still active).
 */
export function isAnalyzerStatusLineVisible(input: {
  stage: AnalyzerWorkflowStage;
  drawingSetOutdated: boolean;
  hasUpload: boolean;
  runInProgress: boolean;
  totalSheets: number;
}): boolean {
  if (input.drawingSetOutdated) return false;
  if (input.stage === "uploading") return input.hasUpload;
  if (input.stage === "ocr_prep" || input.stage === "analyzing") return true;
  if (input.stage === "ready") return input.runInProgress;
  return input.totalSheets > 0;
}

export function drawingSetNeedsFreshAnalysis(input: {
  runStatus: string | null | undefined;
  pendingMutates: boolean;
  submitting?: boolean;
}): boolean {
  if (input.submitting) return false;
  if (!input.pendingMutates) return false;
  const status = input.runStatus || "";
  return ["completed", "completed_with_errors", "cancelled", "failed"].includes(status)
    || status === "";
}

/**
 * Build the client-facing workflow view for the current drawing set.
 * When `pendingMutates` is true and no fresh analysis has started, shows Ready for analysis
 * instead of the previous completed status.
 */
export function deriveAnalyzerWorkflowView(input: {
  run: AnalyzerRunStatusSlice | null | undefined;
  jobs: readonly AnalyzerJobStatusSlice[];
  pendingMutates: boolean;
  liveUpload?: LiveUploadProgress | null;
  submitting?: boolean;
}): AnalyzerWorkflowView {
  const { run, jobs, pendingMutates, liveUpload, submitting } = input;
  const outdated = drawingSetNeedsFreshAnalysis({
    runStatus: run?.status,
    pendingMutates,
    submitting,
  });

  const uploadManifest = countPersistedUploadManifest(jobs);
  const liveTotal = liveUpload && liveUpload.total > 0 ? liveUpload.total : null;
  const liveCompleted = liveUpload ? Math.max(0, liveUpload.completed) : null;
  const liveFailed = liveUpload?.failed ?? 0;

  if (outdated) {
    return {
      stage: "ready",
      headline: "Ready for analysis.",
      detail: "The drawing set changed, so earlier results are under Previous analyses.",
      progressPercent: null,
      drawingSetOutdated: true,
      treatFindingsAsPrevious: true,
      upload: uploadManifest.total > 0 ? uploadManifest : null,
      ocr: null,
      analysis: null,
    };
  }

  const runStatus = run?.status || null;
  const ocr = run ? readOcrCounts(run.analysis_scope) : null;

  // Live client upload session (create/update in flight)
  if (submitting || liveUpload || runStatus === "uploading") {
    const total = liveTotal ?? Math.max(uploadManifest.total, run?.total_sheets || 0);
    const uploaded = liveCompleted != null
      ? liveCompleted
      : uploadManifest.uploaded;
    const failed = liveFailed;
    const phaseComplete = liveUpload?.phase === "complete"
      || (liveCompleted != null && total > 0 && liveCompleted + failed >= total);

    if (phaseComplete && failed > 0) {
      return {
        stage: "uploading",
        headline: formatUploadFailureLabel(uploaded, total, failed),
        detail: joinStatusSentences([
          uploaded > 0 ? formatUploadSuccessLabel(uploaded, total) : null,
          "The drawings that did not arrive stay selected so you can retry.",
        ]),
        progressPercent: total > 0 ? Math.round((uploaded / total) * 100) : 0,
        drawingSetOutdated: false,
        treatFindingsAsPrevious: false,
        upload: { uploaded, total, failed, pending: Math.max(0, total - uploaded - failed) },
        ocr: null,
        analysis: null,
      };
    }

    if (phaseComplete && failed === 0 && uploaded >= total && total > 0) {
      return {
        stage: "uploading",
        headline: "Drawings were received.",
        detail: formatUploadSuccessLabel(uploaded, total),
        progressPercent: 100,
        drawingSetOutdated: false,
        treatFindingsAsPrevious: false,
        upload: { uploaded, total, failed: 0, pending: 0 },
        ocr: null,
        analysis: null,
      };
    }

    const couldNotReceive = failed > 0
      ? `${failed} ${failed === 1 ? "drawing" : "drawings"} could not be received.`
      : null;
    return {
      stage: "uploading",
      headline: "Drawings are being received.",
      detail: joinStatusSentences([
        total > 0 ? formatUploadingDrawingsLabel(uploaded, total) : null,
        couldNotReceive,
      ]),
      progressPercent: total > 0 ? Math.round((uploaded / Math.max(1, total)) * 100) : 0,
      drawingSetOutdated: false,
      treatFindingsAsPrevious: false,
      upload: {
        uploaded,
        total: total || Math.max(1, uploaded),
        failed,
        pending: Math.max(0, (total || 0) - uploaded - failed),
      },
      ocr: null,
      analysis: null,
    };
  }

  // OCR prep only when Stage 3 full-coverage is enabled for this run and not yet verified
  if (
    ocr
    && !ocr.evidenceVerified
    && (runStatus === "queued" || runStatus === "processing")
  ) {
    const total = Math.max(ocr.total, run?.total_sheets || 0, uploadManifest.total);
    const ready = Math.min(ocr.ready, total || ocr.ready);
    const incomplete = ocr.incompleteSheets || [];
    return {
      stage: "ocr_prep",
      headline: "Agents are extracting information from the drawings.",
      detail: drawingCountSentence(ready, total, "are ready."),
      progressPercent: total > 0 ? Math.round((ready / total) * 100) : 0,
      drawingSetOutdated: false,
      treatFindingsAsPrevious: false,
      upload: uploadManifest,
      ocr: {
        ready,
        total,
        evidenceVerified: false,
        incompleteSheets: incomplete,
      },
      analysis: null,
    };
  }

  if (
    ocr
    && ocr.evidenceVerified
    && (runStatus === "queued" || (runStatus === "processing" && (run?.completed_sheets || 0) === 0 && (run?.failed_sheets || 0) === 0 && (run?.processing_sheets || 0) === 0))
  ) {
    const total = Math.max(ocr.total, run?.total_sheets || 0, uploadManifest.total);
    return {
      stage: "ready",
      headline: "Ready for analysis.",
      detail: drawingCountSentence(ocr.ready, total, "are ready."),
      progressPercent: 100,
      drawingSetOutdated: false,
      treatFindingsAsPrevious: false,
      upload: uploadManifest.total > 0 ? uploadManifest : null,
      ocr: {
        ready: ocr.ready,
        total,
        evidenceVerified: true,
        incompleteSheets: [],
      },
      analysis: null,
    };
  }

  if (runStatus === "queued" || runStatus === "processing") {
    const total = Math.max(1, run?.total_sheets || uploadManifest.total);
    const finished = Math.min(
      total,
      (run?.completed_sheets || 0) + (run?.failed_sheets || 0),
    );
    const injectedConfirmed = finished > 0;
    return {
      stage: "analyzing",
      headline: "Agents are reviewing the drawings.",
      detail: drawingCountSentence(finished, total, "have been reviewed."),
      progressPercent: Math.round((finished / total) * 100),
      drawingSetOutdated: false,
      treatFindingsAsPrevious: false,
      upload: uploadManifest.total > 0 ? uploadManifest : null,
      ocr: ocr
        ? {
          ready: ocr.ready,
          total: ocr.total,
          evidenceVerified: ocr.evidenceVerified,
          incompleteSheets: ocr.incompleteSheets,
        }
        : null,
      analysis: { finished, total, injectedConfirmed },
    };
  }

  if (runStatus === "completed" || runStatus === "completed_with_errors") {
    const total = Math.max(1, run?.total_sheets || uploadManifest.total);
    const finished = Math.min(
      total,
      (run?.completed_sheets || 0) + (run?.failed_sheets || 0),
    );
    const withErrors = runStatus === "completed_with_errors" || (run?.failed_sheets || 0) > 0;
    return {
      stage: withErrors ? "complete_with_errors" : "complete",
      headline: withErrors
        ? "The review is ready for Accept, Reject, or Modify, though some drawings could not be reviewed."
        : "The review is ready for Accept, Reject, or Modify.",
      detail: drawingCountSentence(finished, total, "have been reviewed."),
      progressPercent: 100,
      drawingSetOutdated: false,
      treatFindingsAsPrevious: false,
      upload: uploadManifest.total > 0 ? uploadManifest : null,
      ocr: ocr
        ? {
          ready: ocr.ready,
          total: ocr.total,
          evidenceVerified: ocr.evidenceVerified,
          incompleteSheets: ocr.incompleteSheets,
        }
        : null,
      analysis: { finished, total, injectedConfirmed: finished > 0 },
    };
  }

  if (runStatus === "cancelled") {
    return {
      stage: "cancelled",
      headline: "The review was cancelled.",
      detail: null,
      progressPercent: null,
      drawingSetOutdated: false,
      treatFindingsAsPrevious: false,
      upload: uploadManifest.total > 0 ? uploadManifest : null,
      ocr: null,
      analysis: null,
    };
  }

  if (runStatus === "failed") {
    return {
      stage: "failed",
      headline: "The review could not be finished.",
      detail: null,
      progressPercent: null,
      drawingSetOutdated: false,
      treatFindingsAsPrevious: false,
      upload: uploadManifest.total > 0 ? uploadManifest : null,
      ocr: null,
      analysis: null,
    };
  }

  // No run yet, or idle with files selected that don't mutate
  if (uploadManifest.total > 0 && uploadManifest.pending === 0) {
    return {
      stage: "ready",
      headline: "Ready for analysis.",
      detail: drawingCountSentence(uploadManifest.uploaded, uploadManifest.total, "have been received."),
      progressPercent: null,
      drawingSetOutdated: false,
      treatFindingsAsPrevious: false,
      upload: uploadManifest,
      ocr: null,
      analysis: null,
    };
  }

  return {
    stage: "ready",
    headline: "Ready for analysis.",
    detail: null,
    progressPercent: null,
    drawingSetOutdated: false,
    treatFindingsAsPrevious: false,
    upload: uploadManifest.total > 0 ? uploadManifest : null,
    ocr: null,
    analysis: null,
  };
}
