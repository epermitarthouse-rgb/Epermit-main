/**
 * Durable Code Analyzer drawing-set + analysis-run model (Phase 1).
 * Pure helpers so fingerprint / stale / legacy hydrate behavior can be unit-tested.
 */
import type { DocumentDiscipline } from "@/types/document";
import type { IndexCompletenessResult } from "./indexCompleteness";

export type IndexCompletenessSnapshot = IndexCompletenessResult;

export const CODE_ANALYZER_RUN_STATUSES = [
  "running",
  "current",
  "stale",
  "superseded",
  "failed",
] as const;

export type CodeAnalyzerRunStatus = (typeof CODE_ANALYZER_RUN_STATUSES)[number];

export const ANALYSIS_TYPE_STANDARD = "standard_compliance";
export const ANALYSIS_TYPE_DC_MODIFICATION = "dc_code_modification";

export type CodeAnalyzerAnalysisType =
  | typeof ANALYSIS_TYPE_STANDARD
  | typeof ANALYSIS_TYPE_DC_MODIFICATION;

export interface CodeAnalyzerRun {
  id: string;
  project_id: string;
  user_id: string;
  status: CodeAnalyzerRunStatus;
  jurisdiction: string | null;
  project_type: string | null;
  code_year: string | null;
  analysis_mode: string | null;
  analysis_type?: string | null;
  form_document_id?: string | null;
  /** Staff guidance captured at run time; historical runs retain the text used. */
  analysis_instructions?: string | null;
  /** Deterministic drawing index prescreen snapshot for this run. */
  index_completeness?: IndexCompletenessSnapshot | null;
  source_fingerprint: string;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

/** Missing / blank analysis_type is treated as a Phase 1 standard compliance run. */
export function runAnalysisType(run: { analysis_type?: string | null }): string {
  const raw = typeof run.analysis_type === "string" ? run.analysis_type.trim() : "";
  return raw || ANALYSIS_TYPE_STANDARD;
}

export function isStandardComplianceRun(run: { analysis_type?: string | null }): boolean {
  return runAnalysisType(run) === ANALYSIS_TYPE_STANDARD;
}

export interface CodeAnalyzerSheet {
  id: string;
  project_id: string;
  source_document_id: string;
  image_document_id: string | null;
  page_number: number;
  file_name: string | null;
  discipline?: DocumentDiscipline | null;
  sheet_label?: string | null;
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

/** Trim and normalize run-scoped staff guidance for fingerprinting. */
export function normalizeAnalysisInstructions(value: string | null | undefined): string {
  if (typeof value !== "string") return "";
  return value.trim().replace(/\r\n/g, "\n");
}

export function instructionsFingerprint(instructions: string | null | undefined): string {
  const normalized = normalizeAnalysisInstructions(instructions);
  if (!normalized) return "";
  return `instr:${normalized}`;
}

/** Sheet fingerprint plus optional staff guidance (standard compliance runs). */
export function computeStandardRunFingerprint(
  sheets: CodeAnalyzerSheetInput[],
  instructions?: string | null,
): string {
  const sheetFp = computeSheetFingerprint(sheets);
  const instrFp = instructionsFingerprint(instructions);
  return instrFp ? `${sheetFp}||${instrFp}` : sheetFp;
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

type RunPickFields = {
  status: string;
  analysis_type?: string | null;
  completed_at?: string | null;
  updated_at?: string;
  created_at?: string;
};

/** Prefer the current run; otherwise the most recently completed stale run (last results). */
export function pickDisplayRun<T extends RunPickFields>(
  runs: T[],
  analysisType: string = ANALYSIS_TYPE_STANDARD,
): T | null {
  const scoped = runs.filter((r) => runAnalysisType(r) === analysisType);
  const current = scoped.find((r) => r.status === "current");
  if (current) return current;
  const stale = scoped
    .filter((r) => r.status === "stale")
    .sort((a, b) => {
      const aTime = a.completed_at || a.updated_at || a.created_at || "";
      const bTime = b.completed_at || b.updated_at || b.created_at || "";
      return bTime.localeCompare(aTime);
    });
  return stale[0] ?? null;
}

export function pickCurrentRun<T extends { status: string; analysis_type?: string | null }>(
  runs: T[],
  analysisType: string = ANALYSIS_TYPE_STANDARD,
): T | null {
  return runs.find((r) => r.status === "current" && runAnalysisType(r) === analysisType) ?? null;
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
