/**
 * Sheet summary counts for the results header.
 * IBC and Local findings are added together. Matching issue ids are kept,
 * so the header does not depend on which code tab is selected.
 */
import { computeComplianceOverallScore } from "@/lib/complianceBatchProcessor";
import { reviewStateLabel, type ReviewStateName } from "@/lib/codeAnalyzer/reviewReport";

export interface CombinedIssueRef {
  id: string;
  severity?: "critical" | "warning" | "advisory" | string;
  codeType?: "ibc" | "local" | string;
  codeYear?: string;
  codeSourceStatus?: string | null;
  sheetFileName?: string;
}

export interface CombinedModeSummary {
  totalIssues: number;
  critical: number;
  warnings: number;
  advisory: number;
  overallScore: number | null;
  reviewState?: ReviewStateName;
  codeCoverageVerified?: boolean;
}

export interface CombinedModeResult {
  issues?: CombinedIssueRef[];
  summary?: CombinedModeSummary | null;
  codeType?: "ibc" | "local" | "combined" | string;
  jurisdictionNotes?: string;
}

export interface CombinedSheetSummary extends CombinedModeSummary {
  reviewState: ReviewStateName;
  codeCoverageVerified: boolean;
}

const REVIEW_RANK: Record<string, number> = {
  failed: 6,
  reviewed_partial: 5,
  reviewed_findings: 4,
  not_reviewed: 3,
  reviewed_clear: 2,
  passed: 1,
};

function countsFromMode(result: CombinedModeResult | null | undefined): {
  totalIssues: number;
  critical: number;
  warnings: number;
  advisory: number;
} {
  if (!result) return { totalIssues: 0, critical: 0, warnings: 0, advisory: 0 };
  if (Array.isArray(result.issues)) {
    const issues = result.issues;
    return {
      totalIssues: issues.length,
      critical: issues.filter((issue) => issue.severity === "critical").length,
      warnings: issues.filter((issue) => issue.severity === "warning").length,
      advisory: issues.filter((issue) => issue.severity === "advisory").length,
    };
  }
  const summary = result.summary;
  return {
    totalIssues: summary?.totalIssues ?? 0,
    critical: summary?.critical ?? 0,
    warnings: summary?.warnings ?? 0,
    advisory: summary?.advisory ?? 0,
  };
}

/** A stored review state with no numeric score stays unscored. Legacy rows without a review state can still be scored from severities. */
export function explicitlyUnscored(
  summary: CombinedModeSummary | null | undefined,
): boolean {
  if (!summary) return false;
  if (typeof summary.overallScore === "number") return false;
  return (
    summary.reviewState === "reviewed_partial" ||
    summary.reviewState === "failed" ||
    summary.reviewState === "not_reviewed" ||
    summary.reviewState === "reviewed_clear" ||
    summary.reviewState === "reviewed_findings"
  );
}

function worstReviewState(states: Array<string | null | undefined>): ReviewStateName {
  let rank = 0;
  let chosen: ReviewStateName = null;
  for (const state of states) {
    if (!state || REVIEW_RANK[state] == null) continue;
    if (REVIEW_RANK[state] > rank) {
      rank = REVIEW_RANK[state];
      chosen = state as ReviewStateName;
    }
  }
  return chosen;
}

export function combineModeSummaries(
  modes: Array<CombinedModeResult | null | undefined>,
): CombinedSheetSummary {
  const present = modes.filter((mode): mode is CombinedModeResult => Boolean(mode));
  const counts = present.map((mode) => countsFromMode(mode));
  const totalIssues = counts.reduce((sum, count) => sum + count.totalIssues, 0);
  const critical = counts.reduce((sum, count) => sum + count.critical, 0);
  const warnings = counts.reduce((sum, count) => sum + count.warnings, 0);
  const advisory = counts.reduce((sum, count) => sum + count.advisory, 0);
  const summaries = present.map((mode) => mode.summary);
  const unscored = summaries.some((summary) => explicitlyUnscored(summary));
  const codeCoverageVerified =
    present.length > 0 && present.every((mode) => mode.summary?.codeCoverageVerified === true);
  let reviewState = worstReviewState(summaries.map((summary) => summary?.reviewState));
  if (
    totalIssues > 0 &&
    (reviewState == null || reviewState === "reviewed_clear" || reviewState === "passed")
  ) {
    reviewState = "reviewed_findings";
  }
  if (reviewState == null) {
    reviewState = totalIssues > 0 ? "reviewed_findings" : "not_reviewed";
  }

  const storedScores = summaries
    .map((summary) => summary?.overallScore)
    .filter((score): score is number => typeof score === "number");
  // A legacy zero-issue row can carry a numeric score and no review state.
  // Keep that number so a later rollup does not treat the row as unscored.
  const preserveStoredScore =
    !unscored &&
    totalIssues === 0 &&
    storedScores.length > 0 &&
    reviewState !== "reviewed_clear" &&
    reviewState !== "passed";

  const overallScore = unscored
    ? null
    : preserveStoredScore
      ? storedScores[storedScores.length - 1]
      : computeComplianceOverallScore({
          critical,
          warnings,
          advisory,
          totalIssues,
          reviewState,
          codeCoverageVerified,
        });

  return {
    totalIssues,
    critical,
    warnings,
    advisory,
    overallScore,
    reviewState,
    codeCoverageVerified,
  };
}

export function combineSheetSummaries(
  ibcResult: CombinedModeResult | null | undefined,
  localResult: CombinedModeResult | null | undefined,
): CombinedSheetSummary {
  return combineModeSummaries([ibcResult, localResult]);
}

export function rollupSheetSummaries(summaries: CombinedModeSummary[]): CombinedSheetSummary {
  return combineModeSummaries(summaries.map((summary) => ({ summary, issues: undefined })));
}

export function combinedSheetIssues(
  ibcResult: CombinedModeResult | null | undefined,
  localResult: CombinedModeResult | null | undefined,
): CombinedIssueRef[] {
  return [...(ibcResult?.issues ?? []), ...(localResult?.issues ?? [])];
}

export function combinedResolutionProgress(
  fileId: string,
  issues: Array<{ id: string }>,
  responses: Record<string, unknown>,
): { resolved: number; total: number; percent: number } {
  const total = issues.length;
  const resolved = issues.filter((issue) => responses[`${fileId}:${issue.id}`] != null).length;
  return {
    resolved,
    total,
    percent: total === 0 ? 0 : (resolved / total) * 100,
  };
}

export function sheetResultPresentation<T extends CombinedModeResult>(
  group: { ibcResult: T | null; localResult: T | null },
  tab: "ibc" | "local",
  responses: Record<string, unknown>,
  fileId: string,
): {
  summary: CombinedSheetSummary;
  combinedIssues: CombinedIssueRef[];
  findingsResult: T | null;
  findings: CombinedIssueRef[];
  resolution: { resolved: number; total: number; percent: number };
  ibcCount: number;
  localCount: number;
} {
  const summary = combineSheetSummaries(group.ibcResult, group.localResult);
  const combinedIssues = combinedSheetIssues(group.ibcResult, group.localResult);
  const selected = tab === "local" ? group.localResult : group.ibcResult;
  const findingsResult = selected ?? group.localResult ?? group.ibcResult ?? null;
  return {
    summary,
    combinedIssues,
    findingsResult,
    findings: findingsResult?.issues ?? [],
    resolution: combinedResolutionProgress(fileId, combinedIssues, responses),
    ibcCount: countsFromMode(group.ibcResult).totalIssues,
    localCount: countsFromMode(group.localResult).totalIssues,
  };
}

/** Score text for headers and exports. Absent scores stay words such as Clear, Partial, or Findings. */
export function exportScoreText(summary?: {
  overallScore?: number | null;
  reviewState?: string | null;
} | null): string {
  return reviewStateLabel(summary?.reviewState, summary?.overallScore);
}

export function fileSectionScoreLabel(summary?: {
  overallScore?: number | null;
  reviewState?: string | null;
  totalIssues?: number;
} | null): string {
  const issues = summary?.totalIssues ?? 0;
  return `${exportScoreText(summary)} · ${issues} issues`;
}
