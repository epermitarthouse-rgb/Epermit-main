import type { SupabaseAnalyzerFinding } from "@/lib/supabaseAnalyzer/client";

export type FindingSeverityFilter = "all" | "critical" | "warning" | "advisory";

export type ReviewDecisionStatus = "accepted" | "modified" | "rejected";

export interface FindingReviewDecision {
  id: string;
  project_id: string;
  run_id: string;
  sheet_job_id: string;
  finding_id: string;
  decision: ReviewDecisionStatus;
  modified_response: string | null;
  decided_at: string;
  decided_by: string;
}

export interface ExportedFindingReview {
  decision: ReviewDecisionStatus;
  modifiedResponse: string | null;
  decidedAt: string;
}

export interface ReviewFilterSheet {
  id: string;
  discipline: string;
}

export interface ReviewFilterFinding {
  id: string;
  sheet_job_id: string;
  severity: string;
}

const SEVERITY_LABEL: Record<FindingSeverityFilter, string> = {
  all: "All Findings",
  critical: "Critical",
  warning: "Warning",
  advisory: "Advisory",
};

export function severityFilterLabel(filter: FindingSeverityFilter): string {
  return SEVERITY_LABEL[filter];
}

/** Run-level cards toggle the active severity. All Findings always clears it. */
export function nextRunSeverityFilter(
  current: FindingSeverityFilter,
  clicked: FindingSeverityFilter,
): FindingSeverityFilter {
  if (clicked === "all") return "all";
  return current === clicked ? "all" : clicked;
}

export interface RunSeverityExpansion {
  expandedJobIds: Set<string>;
  /** Sheets the reviewer had open before a severity was selected; restored by All Findings. */
  expansionBeforeFilter: Set<string> | null;
}

/** Opens the drawings that contain the selected severity, and restores the reviewer's own expansion on All. */
export function expansionForRunSeverity(
  current: RunSeverityExpansion,
  target: FindingSeverityFilter,
  findings: readonly ReviewFilterFinding[],
): RunSeverityExpansion {
  if (target === "all") {
    return {
      expandedJobIds: new Set(current.expansionBeforeFilter ?? current.expandedJobIds),
      expansionBeforeFilter: null,
    };
  }
  const matching = new Set<string>();
  for (const finding of findings) {
    if (finding.severity === target) matching.add(finding.sheet_job_id);
  }
  return {
    expandedJobIds: matching,
    expansionBeforeFilter: current.expansionBeforeFilter ?? new Set(current.expandedJobIds),
  };
}

export function isReviewDecisionStatus(value: unknown): value is ReviewDecisionStatus {
  return value === "accepted" || value === "modified" || value === "rejected";
}

export function reviewDecisionKey(runId: string, findingId: string): string {
  return `${runId}:${findingId}`;
}

export function reviewDecisionLabel(decision: ReviewDecisionStatus): string {
  if (decision === "accepted") return "Accepted";
  if (decision === "modified") return "Modified";
  return "Rejected";
}

export function indexReviewDecisions(
  decisions: readonly FindingReviewDecision[],
): Map<string, FindingReviewDecision> {
  const indexed = new Map<string, FindingReviewDecision>();
  for (const decision of decisions) {
    indexed.set(reviewDecisionKey(decision.run_id, decision.finding_id), decision);
  }
  return indexed;
}

export function reviewsByFindingForRun(
  decisions: readonly FindingReviewDecision[],
  runId: string,
): Map<string, FindingReviewDecision> {
  const indexed = new Map<string, FindingReviewDecision>();
  for (const decision of decisions) {
    if (decision.run_id !== runId) continue;
    indexed.set(decision.finding_id, decision);
  }
  return indexed;
}

export function buildReviewDecisionRecord(input: {
  projectId: string;
  runId: string;
  sheetJobId: string;
  findingId: string;
  decision: ReviewDecisionStatus;
  modifiedResponse?: string | null;
  decidedAt: string;
  decidedBy: string;
  originalRecommendation: string;
}): { record: Omit<FindingReviewDecision, "id">; originalRecommendation: string } {
  const edited = (input.modifiedResponse ?? "").trim();
  if (input.decision === "modified" && !edited) {
    throw new Error("Enter a reviewer response before saving.");
  }
  if (edited.length > 8000) {
    throw new Error("Reviewer response is too long.");
  }
  return {
    originalRecommendation: input.originalRecommendation,
    record: {
      project_id: input.projectId,
      run_id: input.runId,
      sheet_job_id: input.sheetJobId,
      finding_id: input.findingId,
      decision: input.decision,
      modified_response: input.decision === "modified" ? edited : null,
      decided_at: input.decidedAt,
      decided_by: input.decidedBy,
    },
  };
}

export function mergeReviewDecision<T extends { findings: SupabaseAnalyzerFinding[]; reviews?: FindingReviewDecision[] }>(
  dataset: T,
  review: FindingReviewDecision,
): T {
  const reviews = (dataset.reviews || []).filter(
    (existing) => existing.run_id !== review.run_id || existing.finding_id !== review.finding_id,
  );
  return {
    ...dataset,
    findings: dataset.findings,
    reviews: [...reviews, review],
  };
}

export function reviewForExport(
  reviews: readonly FindingReviewDecision[] | undefined,
  runId: string,
  findingId: string,
): ExportedFindingReview | null {
  const match = (reviews || []).find((review) => review.run_id === runId && review.finding_id === findingId);
  if (!match) return null;
  return {
    decision: match.decision,
    modifiedResponse: match.modified_response,
    decidedAt: match.decided_at,
  };
}

export function reviewReportLines(review: ExportedFindingReview | null): string[] {
  if (!review) return [];
  const lines = [`Reviewer decision: ${reviewDecisionLabel(review.decision)}`];
  if (review.modifiedResponse) lines.push(`Reviewer response: ${review.modifiedResponse}`);
  return lines;
}

export interface AnalyzerFilterView<T extends ReviewFilterFinding> {
  sheets: ReviewFilterSheet[];
  findingsBySheet: Map<string, T[]>;
  visibleFindings: T[];
  emptyMessage: string | null;
}

export function projectAnalyzerReview<T extends ReviewFilterFinding>(input: {
  sheets: readonly ReviewFilterSheet[];
  findings: readonly T[];
  discipline: string;
  runSeverity: FindingSeverityFilter;
  sheetSeverity?: Readonly<Record<string, FindingSeverityFilter | undefined>>;
}): AnalyzerFilterView<T> {
  const disciplineSheets = input.discipline === "all"
    ? [...input.sheets]
    : input.sheets.filter((sheet) => sheet.discipline === input.discipline);
  const findingsOnSheet = new Map<string, T[]>();
  for (const finding of input.findings) {
    const list = findingsOnSheet.get(finding.sheet_job_id) || [];
    list.push(finding);
    findingsOnSheet.set(finding.sheet_job_id, list);
  }
  const sheets: ReviewFilterSheet[] = [];
  const findingsBySheet = new Map<string, T[]>();
  const visibleFindings: T[] = [];
  for (const sheet of disciplineSheets) {
    const onSheet = findingsOnSheet.get(sheet.id) || [];
    // A run-level severity keeps only the drawings that contain that severity.
    if (input.runSeverity !== "all" && !onSheet.some((finding) => finding.severity === input.runSeverity)) continue;
    const severity = effectiveSheetSeverity(input.runSeverity, input.sheetSeverity, sheet.id);
    const matched = severity === "all" ? [...onSheet] : onSheet.filter((finding) => finding.severity === severity);
    sheets.push(sheet);
    findingsBySheet.set(sheet.id, matched);
    visibleFindings.push(...matched);
  }

  let emptyMessage: string | null = null;
  if (disciplineSheets.length === 0 && input.sheets.length > 0 && input.discipline !== "all") {
    emptyMessage = "No drawings in this discipline.";
  } else if (
    disciplineSheets.length > 0
    && visibleFindings.length === 0
    && disciplineSheets.some((sheet) => (findingsOnSheet.get(sheet.id) || []).length > 0)
    && (input.runSeverity !== "all" || sheetOverrideActive(input.sheetSeverity))
  ) {
    const label = severityFilterLabel(input.runSeverity).toLowerCase();
    emptyMessage = input.runSeverity === "all"
      ? "No findings match the current filters."
      : `No ${label} findings match the current filters.`;
  }

  return { sheets, findingsBySheet, visibleFindings, emptyMessage };
}

function sheetOverrideActive(
  sheetSeverity: Readonly<Record<string, FindingSeverityFilter | undefined>> | undefined,
): boolean {
  if (!sheetSeverity) return false;
  return Object.values(sheetSeverity).some((filter) => filter && filter !== "all");
}

export function sheetFilterEmptyMessage(
  totalOnSheet: number,
  visibleOnSheet: number,
  severity: FindingSeverityFilter,
): string | null {
  if (totalOnSheet === 0 || visibleOnSheet > 0 || severity === "all") return null;
  return `No ${severityFilterLabel(severity).toLowerCase()} findings on this sheet.`;
}

export function effectiveSheetSeverity(
  runSeverity: FindingSeverityFilter,
  sheetSeverity: Readonly<Record<string, FindingSeverityFilter | undefined>> | undefined,
  sheetId: string,
): FindingSeverityFilter {
  return sheetSeverity?.[sheetId] ?? runSeverity;
}
