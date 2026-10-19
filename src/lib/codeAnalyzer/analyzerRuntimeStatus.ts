/**
 * Canonical Code Analyzer / Code Modification runtime status lines.
 * Single source for drawing-set summary UI — avoids overlapping counters.
 */
import { COMPLIANCE_MAX_INCLUDED_SHEETS, type CodeAnalyzerRunStatus } from "./model";
import type { AnalyzerDatasetMetrics } from "./sheetState";
import { formatUniqueSheetProgress } from "./uniqueSheetProgress";

/** Show capacity usage only when approaching the included-sheet cap. */
export const ANALYZER_CAPACITY_WARNING_THRESHOLD = 35;

export type AnalyzerWorkflowMode = "standard" | "code_modification";

export interface AnalyzerRuntimeStatusInput {
  mode: AnalyzerWorkflowMode;
  metrics: AnalyzerDatasetMetrics;
  analyzing: boolean;
  stale: boolean;
  displayRunStatus?: CodeAnalyzerRunStatus | null;
  /** Standard or Code Mod sheet-level progress when available. */
  batchProgress?: { completed: number; total: number } | null;
  /** Loaded Code Mod review for the active display run. */
  hasModificationReview?: boolean;
  /** Included sheets reviewed when Code Mod review completed. */
  reviewedSheetCount?: number;
  excludedSheetCount?: number;
}

export interface AnalyzerRuntimeStatusLines {
  datasetLine: string;
  statusLine: string | null;
  capacityLine: string | null;
}

export function formatCompactDatasetLine(metrics: AnalyzerDatasetMetrics): string {
  return `Documents ${metrics.sourceDocumentCount} · Sheets ${metrics.includedSheetCount}`;
}

/** Shown under the drawing-set counter — specs/forms are not missing from analysis by accident. */
export const ANALYZER_DRAWING_SET_ROLE_HINT =
  "Counts are plan sheets in the drawing set only. Specification and supporting PDFs are indexed for context during analysis; code modification forms and non-drawing pages are not vision-analyzed as sheets.";

export function formatCapacityLine(
  includedCount: number,
  excludedCount: number,
  maxIncluded: number = COMPLIANCE_MAX_INCLUDED_SHEETS,
): string | null {
  if (excludedCount > 0 && includedCount < ANALYZER_CAPACITY_WARNING_THRESHOLD) {
    return `${excludedCount} excluded — over the ${maxIncluded}-sheet analysis cap`;
  }
  if (includedCount < ANALYZER_CAPACITY_WARNING_THRESHOLD) {
    return null;
  }
  const line = `${includedCount} of ${maxIncluded} sheet capacity used`;
  if (excludedCount > 0) {
    return `${line} · ${excludedCount} excluded`;
  }
  return line;
}

export function resolveAnalyzerRuntimeStatus(
  input: AnalyzerRuntimeStatusInput,
): AnalyzerRuntimeStatusLines {
  const datasetLine = formatCompactDatasetLine(input.metrics);
  const capacityLine = formatCapacityLine(
    input.metrics.includedSheetCount,
    input.excludedSheetCount ?? 0,
  );
  const { analyzedCompletedCount, analyzedFailedCount, analysisTotalCount } = input.metrics;

  if (input.stale) {
    return {
      datasetLine,
      statusLine:
        input.mode === "code_modification" ? "Review needs update" : "Analysis needs update",
      capacityLine,
    };
  }

  if (input.analyzing) {
    const progress = input.batchProgress;
    if (input.mode === "code_modification") {
      if (progress && progress.total > 0) {
        return {
          datasetLine,
          statusLine: `Reviewing ${progress.completed} of ${progress.total} sheets…`,
          capacityLine,
        };
      }
      return { datasetLine, statusLine: "Reviewing evidence…", capacityLine };
    }
    if (progress && progress.total > 0) {
      return {
        datasetLine,
        statusLine: formatUniqueSheetProgress(progress.completed, progress.total).combinedLabel,
        capacityLine,
      };
    }
    return { datasetLine, statusLine: "Analyzing…", capacityLine };
  }

  if (input.mode === "code_modification") {
    if (input.hasModificationReview) {
      const reviewed = input.reviewedSheetCount ?? input.metrics.includedSheetCount;
      const statusLine =
        reviewed > 0
          ? `Review complete · ${reviewed} sheet${reviewed === 1 ? "" : "s"} reviewed`
          : "Review complete";
      return { datasetLine, statusLine, capacityLine };
    }
    if (input.metrics.includedSheetCount > 0 || input.metrics.sourceDocumentCount > 0) {
      return { datasetLine, statusLine: "Ready for review", capacityLine };
    }
    return { datasetLine, statusLine: null, capacityLine };
  }

  if (analyzedFailedCount > 0 && analyzedCompletedCount > 0) {
    return {
      datasetLine,
      statusLine: `${analyzedCompletedCount} reviewed · ${analyzedFailedCount} failed`,
      capacityLine,
    };
  }

  if (analyzedFailedCount > 0) {
    return {
      datasetLine,
      statusLine: `${analyzedFailedCount} failed`,
      capacityLine,
    };
  }

  if (
    input.displayRunStatus === "current" &&
    analyzedCompletedCount > 0 &&
    analyzedCompletedCount === analysisTotalCount
  ) {
    return { datasetLine, statusLine: "Analysis complete", capacityLine };
  }

  return { datasetLine, statusLine: null, capacityLine };
}
