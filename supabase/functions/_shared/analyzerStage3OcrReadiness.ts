/**
 * Full-coverage Stage 3 OCR preprocessing gate (run-scoped only).
 *
 * Ordinary analyzer runs remain fail-open. When a run opts into
 * `analysis_scope.stage3FullCoverageOcr`, GPT must not start until OCR
 * preprocessing is terminal or an operator sets gateMode=approved_partial.
 */
export const STAGE3_OCR_PREPROCESS_VERSION = "phase3.stage3-ocr-preprocess.v1";

export type Stage3OcrGateMode = "blocking" | "approved_partial" | "released";

export type Stage3OcrPreprocessSummary = {
  version?: string;
  fullCoverage?: boolean;
  gateMode?: Stage3OcrGateMode;
  requiredSheetCount?: number;
  counts?: {
    pending?: number;
    processing?: number;
    completed?: number;
    failed?: number;
    skipped?: number;
  };
  terminal?: boolean;
  missingEvidence?: number;
  /** Relative paths / sheet ids still blocking readiness (bounded for UI). */
  incompleteSheets?: string[];
  macWorkerLastHeartbeat?: string | null;
  updatedAt?: string | null;
  cancelled?: boolean;
};

export type Stage3OcrGateDecision = {
  blockGpt: boolean;
  code: "ok" | "not_full_coverage" | "blocking_incomplete" | "approved_partial" | "released" | "mac_offline_timeout";
  reason: string;
  preprocess: Stage3OcrPreprocessSummary | null;
  incompleteSheets: string[];
};

const DEFAULT_MAC_OFFLINE_MS = 6 * 60 * 60 * 1000;

function readPreprocess(analysisScope: unknown): Stage3OcrPreprocessSummary | null {
  if (!analysisScope || typeof analysisScope !== "object" || Array.isArray(analysisScope)) return null;
  const scope = analysisScope as Record<string, unknown>;
  if (scope.stage3FullCoverageOcr !== true) return null;
  const raw = scope.stage3OcrPreprocess;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { fullCoverage: true, gateMode: "blocking", counts: {}, terminal: false };
  }
  return raw as Stage3OcrPreprocessSummary;
}

export function isStage3FullCoverageRun(analysisScope: unknown): boolean {
  if (!analysisScope || typeof analysisScope !== "object" || Array.isArray(analysisScope)) return false;
  return (analysisScope as Record<string, unknown>).stage3FullCoverageOcr === true;
}

export function mergeStage3FullCoverageRunOptIn(
  analysisScope: Record<string, unknown> | null | undefined,
  enabled: boolean,
  options?: { requiredSheetCount?: number },
): Record<string, unknown> {
  const base = analysisScope && typeof analysisScope === "object" && !Array.isArray(analysisScope)
    ? { ...analysisScope }
    : {};
  if (enabled) {
    base.stage3FullCoverageOcr = true;
    base.stage3VisualEvidence = true;
    base.stage3OcrPreprocess = {
      version: STAGE3_OCR_PREPROCESS_VERSION,
      fullCoverage: true,
      gateMode: "blocking",
      terminal: false,
      macWorkerLastHeartbeat: new Date().toISOString(),
      counts: { pending: 0, processing: 0, completed: 0, failed: 0, skipped: 0 },
      requiredSheetCount: Math.max(0, Number(options?.requiredSheetCount || 0)),
      missingEvidence: 0,
    };
  } else {
    delete base.stage3FullCoverageOcr;
    delete base.stage3OcrPreprocess;
  }
  return base;
}

function incompleteSheetList(preprocess: Stage3OcrPreprocessSummary): string[] {
  const listed = Array.isArray(preprocess.incompleteSheets)
    ? preprocess.incompleteSheets.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
  return listed.slice(0, 120);
}

export function evaluateStage3OcrRunGate(input: {
  analysisScope: unknown;
  now?: number;
  macOfflineMs?: number;
}): Stage3OcrGateDecision {
  const preprocess = readPreprocess(input.analysisScope);
  if (!preprocess) {
    return {
      blockGpt: false,
      code: "not_full_coverage",
      reason: "Run is not full-coverage Stage 3 OCR gated.",
      preprocess: null,
      incompleteSheets: [],
    };
  }

  const incompleteSheets = incompleteSheetList(preprocess);
  const gateMode = (preprocess.gateMode || "blocking") as Stage3OcrGateMode;
  if (gateMode === "released") {
    return {
      blockGpt: false,
      code: "released",
      reason: "Operator released full-coverage OCR gate.",
      preprocess,
      incompleteSheets,
    };
  }
  if (gateMode === "approved_partial") {
    return {
      blockGpt: false,
      code: "approved_partial",
      reason: "Operator approved partial OCR; GPT may proceed with missing packs fail-open per sheet.",
      preprocess,
      incompleteSheets,
    };
  }

  const counts = preprocess.counts || {};
  const required = Number(preprocess.requiredSheetCount || 0);
  const failed = Number(counts.failed || 0);
  const terminalCount = Number(counts.completed || 0) + failed + Number(counts.skipped || 0);
  const terminal = preprocess.terminal === true || (required > 0 && terminalCount >= required);
  const missingEvidence = Number(preprocess.missingEvidence || 0);
  const coverageComplete = terminal
    && missingEvidence === 0
    && failed === 0
    && (required <= 0 || Number(counts.completed || 0) >= required);

  if (coverageComplete) {
    return {
      blockGpt: false,
      code: "ok",
      reason: "Full-coverage OCR preprocessing terminal with evidence recorded for every required sheet.",
      preprocess,
      incompleteSheets: [],
    };
  }

  const now = input.now ?? Date.now();
  const heartbeat = preprocess.macWorkerLastHeartbeat
    ? Date.parse(String(preprocess.macWorkerLastHeartbeat))
    : NaN;
  const offlineMs = input.macOfflineMs ?? DEFAULT_MAC_OFFLINE_MS;
  const macOffline = !Number.isFinite(heartbeat) || now - heartbeat > offlineMs;

  if (macOffline) {
    return {
      blockGpt: true,
      code: "mac_offline_timeout",
      reason: incompleteSheets.length
        ? `Full-coverage OCR gate blocking: Mac worker heartbeat stale. Incomplete sheets: ${incompleteSheets.slice(0, 12).join(", ")}${incompleteSheets.length > 12 ? "…" : ""}`
        : "Full-coverage OCR gate blocking: Mac worker heartbeat stale; operator must approve partial or wait for OCR.",
      preprocess,
      incompleteSheets,
    };
  }

  return {
    blockGpt: true,
    code: "blocking_incomplete",
    reason: incompleteSheets.length
      ? `Full-coverage OCR incomplete (${incompleteSheets.length} sheet(s)); GPT deferred. Missing/invalid: ${incompleteSheets.slice(0, 12).join(", ")}${incompleteSheets.length > 12 ? "…" : ""}`
      : "Full-coverage OCR preprocessing incomplete; GPT deferred (transient retry).",
    preprocess,
    incompleteSheets,
  };
}

export function stage3OcrGateAuditMetadata(decision: Stage3OcrGateDecision): Record<string, unknown> {
  return {
    stage3_ocr_preprocess_version: STAGE3_OCR_PREPROCESS_VERSION,
    stage3_ocr_gate_blocked: decision.blockGpt,
    stage3_ocr_gate_code: decision.code,
    stage3_ocr_gate_reason: decision.reason,
    stage3_ocr_gate_incomplete_sheets: decision.incompleteSheets,
    stage3_ocr_preprocess: decision.preprocess,
  };
}
