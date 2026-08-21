/**
 * Durable Code Analyzer drawing-set + analysis-run model (Phase 1).
 * Pure helpers so fingerprint / stale / legacy hydrate behavior can be unit-tested.
 */

export const CODE_ANALYZER_RUN_STATUSES = [
  "running",
  "current",
  "stale",
  "superseded",
  "failed",
] as const;

export type CodeAnalyzerRunStatus = (typeof CODE_ANALYZER_RUN_STATUSES)[number];

export interface CodeAnalyzerRun {
  id: string;
  project_id: string;
  user_id: string;
  status: CodeAnalyzerRunStatus;
  jurisdiction: string | null;
  project_type: string | null;
  code_year: string | null;
  analysis_mode: string | null;
  source_fingerprint: string;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface CodeAnalyzerSheet {
  id: string;
  project_id: string;
  source_document_id: string;
  image_document_id: string | null;
  page_number: number;
  file_name: string | null;
  excluded: boolean;
  created_at: string;
  updated_at?: string;
}

export interface CodeAnalyzerSheetInput {
  source_document_id: string;
  page_number: number;
  excluded?: boolean;
}

/** Max pages expanded from a single PDF into analyzer sheets. */
export const COMPLIANCE_MAX_PAGES_PER_PDF = 20;

/** Max included (not excluded) sheets analyzed in one run. */
export const COMPLIANCE_MAX_INCLUDED_SHEETS = 24;

export function isPdfFile(file: { type?: string; name?: string }): boolean {
  const type = (file.type ?? "").toLowerCase();
  const name = (file.name ?? "").toLowerCase();
  return type === "application/pdf" || name.endsWith(".pdf");
}

/**
 * Decide which 1-based page numbers to expand from a PDF.
 * Never silently collapses to page 1 when more pages exist.
 */
export function planPdfPageNumbers(
  totalPages: number,
  maxPages: number = COMPLIANCE_MAX_PAGES_PER_PDF,
): { pageNumbers: number[]; truncated: boolean; totalPages: number } {
  const safeTotal = Number.isFinite(totalPages) ? Math.max(0, Math.floor(totalPages)) : 0;
  if (safeTotal <= 0) {
    return { pageNumbers: [], truncated: false, totalPages: 0 };
  }
  const limit = Math.max(1, maxPages);
  const count = Math.min(safeTotal, limit);
  return {
    pageNumbers: Array.from({ length: count }, (_, i) => i + 1),
    truncated: safeTotal > limit,
    totalPages: safeTotal,
  };
}

/** Pages to persist for a source file. Images are always a single page. */
export function planSourceFilePages(file: { type?: string; name?: string }, pdfPageCount?: number): {
  pageNumbers: number[];
  truncated: boolean;
  totalPages: number;
} {
  if (!isPdfFile(file)) {
    return { pageNumbers: [1], truncated: false, totalPages: 1 };
  }
  return planPdfPageNumbers(pdfPageCount ?? 1);
}

export function sheetFingerprintKey(sheet: CodeAnalyzerSheetInput): string {
  return `${sheet.source_document_id}:${sheet.page_number}`;
}

/** Stable fingerprint of the included analyzer dataset (order-independent). */
export function computeSheetFingerprint(sheets: CodeAnalyzerSheetInput[]): string {
  return sheets
    .filter((s) => !s.excluded)
    .map(sheetFingerprintKey)
    .filter(Boolean)
    .sort()
    .join("|");
}

export function fingerprintsMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  return (a ?? "") === (b ?? "");
}

/**
 * Analysis is stale when the persisted included set no longer matches the last
 * completed run, or when new files are waiting to be added.
 */
export function shouldMarkAnalysisStale(input: {
  runStatus?: CodeAnalyzerRunStatus | null;
  runFingerprint?: string | null;
  currentFingerprint: string;
  pendingSourceCount?: number;
}): boolean {
  if ((input.pendingSourceCount ?? 0) > 0) return true;
  if (!input.runStatus) return false;
  if (input.runStatus === "stale") return true;
  if (input.runStatus === "current") {
    return !fingerprintsMatch(input.runFingerprint, input.currentFingerprint);
  }
  return false;
}

/** Prefer the current run; otherwise the most recently completed stale run (last results). */
export function pickDisplayRun(runs: CodeAnalyzerRun[]): CodeAnalyzerRun | null {
  const current = runs.find((r) => r.status === "current");
  if (current) return current;
  const stale = runs
    .filter((r) => r.status === "stale")
    .sort((a, b) => {
      const aTime = a.completed_at || a.updated_at || a.created_at;
      const bTime = b.completed_at || b.updated_at || b.created_at;
      return bTime.localeCompare(aTime);
    });
  return stale[0] ?? null;
}

export function pickCurrentRun(runs: CodeAnalyzerRun[]): CodeAnalyzerRun | null {
  return runs.find((r) => r.status === "current") ?? null;
}

export interface AnalyzerAnnotationRef {
  id?: string;
  analysis_run_id?: string | null;
  data?: unknown;
}

function annotationRunId(ann: AnalyzerAnnotationRef): string | null {
  if (typeof ann.analysis_run_id === "string" && ann.analysis_run_id.length > 0) {
    return ann.analysis_run_id;
  }
  const data = (ann.data ?? {}) as { analysis_run_id?: unknown };
  if (typeof data.analysis_run_id === "string" && data.analysis_run_id.length > 0) {
    return data.analysis_run_id;
  }
  return null;
}

export function isComplianceAnnotationData(data: unknown): boolean {
  const d = (data ?? {}) as { compliance_issue?: boolean; compliance_metadata?: boolean };
  return Boolean(d.compliance_issue || d.compliance_metadata);
}

/**
 * Active findings for DesignCheck / current results.
 *
 * - If `currentRunId` is set: only that run.
 * - If the project has analyzer runs but none are current: empty (stale/historical excluded).
 * - If the project has never used runs (`hasAnalyzerRuns` false): legacy annotations
 *   without a run id still count as current.
 */
export function filterAnnotationsForActiveAnalysis<T extends AnalyzerAnnotationRef>(
  annotations: T[],
  opts: { currentRunId: string | null; hasAnalyzerRuns: boolean },
): T[] {
  const compliance = annotations.filter((a) => isComplianceAnnotationData(a.data));
  if (opts.currentRunId) {
    return compliance.filter((a) => annotationRunId(a) === opts.currentRunId);
  }
  if (opts.hasAnalyzerRuns) {
    return [];
  }
  return compliance.filter((a) => annotationRunId(a) == null);
}

export type IncludedSheetAllocation = {
  includedKeys: Set<string>;
  excludedNewCount: number;
};

/**
 * Keep already-included sheets, then include new pages until the cap.
 * Extra new pages are excluded so they remain in the dataset but are not analyzed.
 */
export function allocateIncludedSheetKeys(
  existingIncluded: CodeAnalyzerSheetInput[],
  incoming: CodeAnalyzerSheetInput[],
  maxIncluded: number = COMPLIANCE_MAX_INCLUDED_SHEETS,
): IncludedSheetAllocation {
  const includedKeys = new Set(
    existingIncluded.filter((s) => !s.excluded).map(sheetFingerprintKey),
  );
  let excludedNewCount = 0;
  for (const sheet of incoming) {
    const key = sheetFingerprintKey(sheet);
    if (includedKeys.has(key)) continue;
    if (includedKeys.size < maxIncluded) {
      includedKeys.add(key);
    } else {
      excludedNewCount += 1;
    }
  }
  return { includedKeys, excludedNewCount };
}

export function sheetDisplayName(sheet: {
  file_name?: string | null;
  page_number: number;
  sourceIsPdf?: boolean;
}): string {
  const base = (sheet.file_name ?? "Drawing").trim() || "Drawing";
  if (sheet.sourceIsPdf || sheet.page_number > 1) {
    const withoutPageSuffix = base.replace(/-page\d+\.png$/i, "").replace(/\.pdf$/i, "");
    return `${withoutPageSuffix} · p.${sheet.page_number}`;
  }
  return base;
}
