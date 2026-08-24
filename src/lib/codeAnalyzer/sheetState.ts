/**
 * Explicit sheet/run state semantics for Code Analyzer UI and retry logic.
 * Compare stable sheet identity (source + page), not annotation existence.
 */
import {
  computeSheetFingerprint,
  fingerprintsMatch,
  sheetFingerprintKey,
  type CodeAnalyzerSheet,
  type CodeAnalyzerSheetInput,
} from "./model";

export type SheetFingerprintKey = string;

/** Included sheet keys from a persisted run fingerprint (ignores instruction suffix). */
export function sheetKeysFromRunFingerprint(fingerprint: string | null | undefined): Set<SheetFingerprintKey> {
  if (!fingerprint) return new Set();
  const sheetPart = fingerprint.split("||")[0] ?? "";
  if (!sheetPart.trim()) return new Set();
  return new Set(sheetPart.split("|").filter(Boolean));
}

export function includedSheetKeys(sheets: CodeAnalyzerSheetInput[]): Set<SheetFingerprintKey> {
  return new Set(
    sheets.filter((s) => !s.excluded).map(sheetFingerprintKey),
  );
}

/** Sheets in the current included set that were not part of the previous completed run. */
export function newSincePreviousRun(
  currentIncluded: CodeAnalyzerSheet[],
  previousRunFingerprint: string | null | undefined,
): CodeAnalyzerSheet[] {
  const prevKeys = sheetKeysFromRunFingerprint(previousRunFingerprint);
  if (prevKeys.size === 0) return [...currentIncluded];
  return currentIncluded.filter((s) => !prevKeys.has(sheetFingerprintKey(s)));
}

/** Included sheets that existed in the previous run and have persisted successful analysis. */
export function existingSuccessful(
  currentIncluded: CodeAnalyzerSheet[],
  previousRunFingerprint: string | null | undefined,
  successfulSheetIds: Set<string>,
): CodeAnalyzerSheet[] {
  const prevKeys = sheetKeysFromRunFingerprint(previousRunFingerprint);
  return currentIncluded.filter(
    (s) => prevKeys.has(sheetFingerprintKey(s)) && successfulSheetIds.has(s.id),
  );
}

/** Included sheets that existed in the previous run and failed analysis (retry candidates). */
export function existingFailed(
  currentIncluded: CodeAnalyzerSheet[],
  previousRunFingerprint: string | null | undefined,
  failedSheetIds: Set<string>,
): CodeAnalyzerSheet[] {
  const prevKeys = sheetKeysFromRunFingerprint(previousRunFingerprint);
  return currentIncluded.filter(
    (s) => prevKeys.has(sheetFingerprintKey(s)) && failedSheetIds.has(s.id),
  );
}

/** Sheet keys present in the previous run but absent from the current included set. */
export function removedSincePreviousRun(
  currentIncluded: CodeAnalyzerSheet[],
  previousRunFingerprint: string | null | undefined,
): SheetFingerprintKey[] {
  const prevKeys = sheetKeysFromRunFingerprint(previousRunFingerprint);
  const currentKeys = includedSheetKeys(currentIncluded);
  return [...prevKeys].filter((key) => !currentKeys.has(key));
}

/** True when the included sheet set differs from the last completed run fingerprint. */
export function isDatasetChangedSinceRun(
  currentIncluded: CodeAnalyzerSheet[],
  previousRunFingerprint: string | null | undefined,
): boolean {
  const currentFp = computeSheetFingerprint(currentIncluded);
  return !fingerprintsMatch(currentFp, previousRunFingerprint);
}

export interface AnalyzerDatasetMetrics {
  /** Distinct source documents represented by included sheets. */
  sourceDocumentCount: number;
  /** Included (non-excluded) sheets in the drawing set. */
  includedSheetCount: number;
  /** Sheets with successful analysis in the active/current session. */
  analyzedCompletedCount: number;
  /** Sheets that failed analysis and need retry. */
  analyzedFailedCount: number;
  /** Total included sheets targeted by the last analysis pass. */
  analysisTotalCount: number;
}

export function computeAnalyzerDatasetMetrics(input: {
  includedSheets: CodeAnalyzerSheet[];
  completedSheetIds?: Set<string>;
  failedSheetIds?: Set<string>;
  /** Hydrated historical results count when batch session is empty. */
  hydratedResultCount?: number;
}): AnalyzerDatasetMetrics {
  const included = input.includedSheets.filter((s) => !s.excluded);
  const sourceDocumentCount = countSourceDocuments(input.includedSheets);
  const completed = input.completedSheetIds?.size ?? input.hydratedResultCount ?? 0;
  const failed = input.failedSheetIds?.size ?? 0;
  const analysisTotalCount = included.length;
  return {
    sourceDocumentCount,
    includedSheetCount: included.length,
    analyzedCompletedCount: completed,
    analyzedFailedCount: failed,
    analysisTotalCount,
  };
}

/** Distinct source documents in the drawing set (included + excluded sheets). */
export function countSourceDocuments(sheets: CodeAnalyzerSheet[]): number {
  return new Set(sheets.map((s) => s.source_document_id).filter(Boolean)).size;
}

export interface RunAnalysisMetricsInput {
  /** All persisted sheets (included and excluded). */
  sheets: CodeAnalyzerSheet[];
  failedSheetIds: Set<string>;
  /** Active batch session completed sheet ids. */
  sessionCompletedSheetIds?: Set<string>;
  /** Image document ids with hydrated analysis for the current run. */
  hydratedImageDocumentIds?: Set<string>;
}

export interface RunAnalysisMetrics extends AnalyzerDatasetMetrics {
  completedSheetIds: Set<string>;
}

/**
 * Canonical run analysis counts — one source for KPI strip and drawing-set summary.
 * Prefers session completed ids, then hydrate match, then included-minus-failed inference.
 */
export function computeRunAnalysisMetrics(input: RunAnalysisMetricsInput): RunAnalysisMetrics {
  const included = input.sheets.filter((s) => !s.excluded);
  const failedSheetIds = input.failedSheetIds;
  const analysisTotalCount = included.length;

  let completedSheetIds: Set<string>;
  if (input.sessionCompletedSheetIds && input.sessionCompletedSheetIds.size > 0) {
    completedSheetIds = new Set(input.sessionCompletedSheetIds);
  } else if (input.hydratedImageDocumentIds && input.hydratedImageDocumentIds.size > 0) {
    completedSheetIds = new Set<string>();
    for (const sheet of included) {
      if (failedSheetIds.has(sheet.id)) continue;
      const imageDocId = sheet.image_document_id ?? sheet.source_document_id;
      if (imageDocId && input.hydratedImageDocumentIds.has(imageDocId)) {
        completedSheetIds.add(sheet.id);
      }
    }
  } else if (failedSheetIds.size > 0 && analysisTotalCount > 0) {
    completedSheetIds = new Set(
      included.filter((s) => !failedSheetIds.has(s.id)).map((s) => s.id),
    );
  } else {
    completedSheetIds = new Set<string>();
  }

  return {
    sourceDocumentCount: countSourceDocuments(input.sheets),
    includedSheetCount: analysisTotalCount,
    analyzedCompletedCount: completedSheetIds.size,
    analyzedFailedCount: failedSheetIds.size,
    analysisTotalCount,
    completedSheetIds,
  };
}

export function formatAnalyzerDatasetSummary(metrics: AnalyzerDatasetMetrics): string {
  const docLabel = metrics.sourceDocumentCount === 1 ? "source document" : "source documents";
  const sheetLabel = metrics.includedSheetCount === 1 ? "included sheet" : "included sheets";
  return `Documents: ${metrics.sourceDocumentCount} ${docLabel} · Sheets: ${metrics.includedSheetCount} ${sheetLabel}`;
}

export function formatAnalysisProgressSummary(
  metrics: AnalyzerDatasetMetrics,
  opts?: { inProgress?: boolean; pendingCount?: number; currentSheetName?: string | null },
): string {
  const { analyzedCompletedCount, analyzedFailedCount, analysisTotalCount } = metrics;
  if (analysisTotalCount === 0) return "Analysis: no sheets";
  if (opts?.inProgress) {
    const pending =
      opts.pendingCount ??
      Math.max(0, analysisTotalCount - analyzedCompletedCount - analyzedFailedCount);
    const parts = [
      "Analysis in progress",
      `${analyzedCompletedCount} completed`,
      analyzedFailedCount > 0 ? `${analyzedFailedCount} failed` : null,
      `${pending} pending`,
      `${analysisTotalCount} total`,
    ].filter(Boolean);
    const line = parts.join(" · ");
    return opts.currentSheetName ? `${line} — ${opts.currentSheetName}` : line;
  }
  if (analyzedFailedCount === 0) {
    return `Analysis: ${analyzedCompletedCount} completed, ${analysisTotalCount} total`;
  }
  return `Analysis: ${analyzedCompletedCount} completed, ${analyzedFailedCount} failed, ${analysisTotalCount} total`;
}
