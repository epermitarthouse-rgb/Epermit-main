/**
 * Client-facing upload / OCR / analysis status for the Supabase Code Analyzer.
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

export function formatUploadingDrawingsLabel(uploaded: number, total: number, fileName?: string): string {
  if (total <= 0) return "Uploading drawings";
  const base = `Uploading drawings — ${uploaded}/${total} uploaded`;
  if (fileName && uploaded < total) return `${base} · ${fileName}`;
  return base;
}

export function formatUploadSuccessLabel(uploaded: number, total: number): string {
  const n = Math.max(uploaded, total);
  if (n <= 0) return "Drawings uploaded successfully";
  return `${uploaded}/${Math.max(total, uploaded)} drawings uploaded successfully`;
}

export function formatUploadFailureLabel(uploaded: number, total: number, failed: number): string {
  if (failed <= 0) return formatUploadSuccessLabel(uploaded, total);
  if (uploaded <= 0) {
    return `Upload failed — 0/${total} drawings uploaded`;
  }
  return `${uploaded}/${total} drawings uploaded — ${failed} failed`;
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
      headline: "Ready for analysis",
      detail: "Drawing set changed — previous analysis results are under Previous analyses.",
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
        detail: "Failed drawings stay selected so you can retry.",
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
        headline: formatUploadSuccessLabel(uploaded, total),
        detail: null,
        progressPercent: 100,
        drawingSetOutdated: false,
        treatFindingsAsPrevious: false,
        upload: { uploaded, total, failed: 0, pending: 0 },
        ocr: null,
        analysis: null,
      };
    }

    return {
      stage: "uploading",
      headline: formatUploadingDrawingsLabel(uploaded, total || Math.max(1, uploaded), liveUpload?.fileName),
      detail: failed > 0 ? `${failed} upload${failed === 1 ? "" : "s"} failed` : null,
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
    const incompleteDetail = incomplete.length
      ? `Incomplete: ${incomplete.slice(0, 8).join(", ")}${incomplete.length > 8 ? "…" : ""}`
      : null;
    return {
      stage: "ocr_prep",
      headline: total > 0
        ? `OCR processed — ${ready}/${total} · evidence verification pending`
        : "Preparing drawing evidence",
      detail: [
        `${uploadManifest.uploaded}/${uploadManifest.total || total} drawings uploaded`,
        incompleteDetail,
        "Paid analysis stays blocked until every sheet has verified OCR evidence (or an explicit override).",
      ].filter(Boolean).join(" · "),
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
      headline: total > 0
        ? `Evidence verified — ready for analysis (${ocr.ready}/${total})`
        : "Evidence verified — ready for analysis",
      detail: `${uploadManifest.uploaded}/${uploadManifest.total || total} drawings uploaded · OCR injection is confirmed only after analysis starts`,
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
      headline: `Analyzing drawings — ${finished}/${total}`,
      detail: ocr
        ? `${uploadManifest.uploaded}/${uploadManifest.total || total} drawings uploaded · OCR packs available for this run (injection confirmed per completed sheet)`
        : null,
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
        ? `Analysis complete — ${finished}/${total} (with sheet errors)`
        : `Analysis complete — ${finished}/${total}`,
      detail: uploadManifest.total > 0
        ? `${uploadManifest.uploaded}/${uploadManifest.total} drawings uploaded`
        : null,
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
      headline: "Analysis cancelled",
      detail: uploadManifest.total > 0
        ? `${uploadManifest.uploaded}/${uploadManifest.total} drawings uploaded`
        : null,
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
      headline: "Analysis failed",
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
      headline: `${uploadManifest.uploaded}/${uploadManifest.total} drawings uploaded`,
      detail: "Ready for analysis",
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
    headline: "Ready for analysis",
    detail: null,
    progressPercent: null,
    drawingSetOutdated: false,
    treatFindingsAsPrevious: false,
    upload: uploadManifest.total > 0 ? uploadManifest : null,
    ocr: null,
    analysis: null,
  };
}
