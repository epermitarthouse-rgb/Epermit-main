/**
 * Pure helpers to build Code Analyzer PDF/JSON export payloads from the
 * currently displayed result groups (All + score filter, or a single file).
 */

import { computeComplianceOverallScore } from "./complianceBatchProcessor";
import { reviewStateLabel, type ReviewReportView, type ReviewStateName } from "./codeAnalyzer/reviewReport";

export interface ComplianceExportIssue {
  id: string;
  category: string;
  title: string;
  description: string;
  severity: "critical" | "warning" | "advisory";
  codeReference: string;
  codeYear: string;
  location: string;
  suggestedFix: string;
  codeType?: "ibc" | "local";
  scopeLabel?: "IBC" | "Local";
  findingType?: string;
  validationDisposition?: string;
  sheetFileName?: string;
}

export interface ComplianceExportAnalysisResult {
  issues: ComplianceExportIssue[];
  summary: {
    totalIssues: number;
    critical: number;
    warnings: number;
    advisory: number;
    overallScore: number | null;
    reviewState?: ReviewStateName;
    codeCoverageVerified?: boolean;
  };
  jurisdictionNotes: string;
  codeType: "ibc" | "local" | "combined";
  reviewReport?: ReviewReportView | null;
}

export interface ComplianceExportResultGroup {
  id: string;
  fileName: string;
  documentId?: string | null;
  failed?: boolean;
  error?: string;
  ibcResult: ComplianceExportAnalysisResult | null;
  localResult: ComplianceExportAnalysisResult | null;
}

export interface ComplianceExportFileSection {
  fileId: string;
  fileName: string;
  documentId?: string | null;
  failed?: boolean;
  error?: string;
  codeType: "ibc" | "local" | "combined";
  summary: ComplianceExportAnalysisResult["summary"];
  issues: ComplianceExportIssue[];
  jurisdictionNotes: string;
  scopes: ComplianceExportScopeSection[];
}

export interface AggregatedComplianceExport {
  filesAnalyzed: number;
  summary: ComplianceExportAnalysisResult["summary"];
  files: ComplianceExportFileSection[];
  /** Flat issue list (for PDF), tagged with source file. */
  issues: Array<ComplianceExportIssue & { sourceFile: string; sourceFileId: string }>;
  jurisdictionNotes: string;
}

export interface ComplianceExportScopeSection {
  codeType: "ibc" | "local";
  scopeLabel: "IBC" | "Local";
  summary: ComplianceExportAnalysisResult["summary"];
  issueCount: number;
  evidence: ReviewReportView["evidence"];
  legalApplicability: ReviewReportView["legalApplicability"];
  codeCoverage: ReviewReportView["codeCoverage"];
}

export function complianceIssueResponseKey(fileId: string, issueId: string): string {
  return `${fileId}:${issueId}`;
}

export function selectComplianceExportGroups<T>(groups: T[]): T[] {
  return groups;
}

export function formatComplianceScoreLabel(summary?: {
  overallScore?: number | null;
  reviewState?: string | null;
} | null): string {
  return reviewStateLabel(summary?.reviewState, summary?.overallScore);
}

export function combineComplianceScopeSummaries(
  results: Array<ComplianceExportAnalysisResult | null | undefined>,
): ComplianceExportAnalysisResult["summary"] {
  return finalizeSummary(results.filter((result): result is ComplianceExportAnalysisResult => Boolean(result)));
}

const UNRESOLVED_REVIEW_STATES = new Set(["not_reviewed", "reviewed_partial", "failed"]);

function combinedReviewState(
  results: ComplianceExportAnalysisResult[],
  totalIssues: number,
): ReviewStateName {
  const states = results
    .map((result) => result.summary.reviewState)
    .filter((state): state is Exclude<ReviewStateName, null> => Boolean(state));
  if (states.length === 0) return totalIssues > 0 ? "reviewed_findings" : "not_reviewed";
  if (states.some((state) => state === "failed")) return "failed";
  if (states.some((state) => state === "not_reviewed" || state === "reviewed_partial")) {
    return "reviewed_partial";
  }
  if (totalIssues > 0) return "reviewed_findings";
  if (states.every((state) => state === "reviewed_clear")) return "reviewed_clear";
  if (states.every((state) => state === "passed" || state === "reviewed_clear")) return "passed";
  return "reviewed_partial";
}

function emptySummary(): ComplianceExportAnalysisResult["summary"] {
  return {
    totalIssues: 0,
    critical: 0,
    warnings: 0,
    advisory: 0,
    overallScore: null,
    reviewState: "not_reviewed",
  };
}

function countsFromResults(results: ComplianceExportAnalysisResult[]) {
  return results.reduce(
    (counts, result) => ({
      totalIssues: counts.totalIssues + (result.summary.totalIssues ?? 0),
      critical: counts.critical + (result.summary.critical ?? 0),
      warnings: counts.warnings + (result.summary.warnings ?? 0),
      advisory: counts.advisory + (result.summary.advisory ?? 0),
    }),
    { totalIssues: 0, critical: 0, warnings: 0, advisory: 0 },
  );
}

function overallScoreFromResults(
  results: ComplianceExportAnalysisResult[],
  counts: ReturnType<typeof countsFromResults>,
  reviewState: ReviewStateName,
): number | null {
  const scoreUnknown = results.some((result) => {
    const state = result.summary.reviewState;
    if (state && UNRESOLVED_REVIEW_STATES.has(state)) return true;
    return result.summary.overallScore == null
      && state !== "passed"
      && state !== "reviewed_clear";
  });
  if (scoreUnknown) return null;
  return computeComplianceOverallScore({
    ...counts,
    reviewState,
    codeCoverageVerified: results.length > 0 && results.every((result) => result.summary.codeCoverageVerified === true),
  });
}

function finalizeSummary(
  results: ComplianceExportAnalysisResult[],
): ComplianceExportAnalysisResult["summary"] {
  const counts = countsFromResults(results);
  const reviewState = combinedReviewState(results, counts.totalIssues);
  return {
    ...counts,
    reviewState,
    codeCoverageVerified: results.length > 0 && results.every((result) => result.summary.codeCoverageVerified === true),
    overallScore: overallScoreFromResults(results, counts, reviewState),
  };
}

function scopeLabelFor(codeType: ComplianceExportAnalysisResult["codeType"] | undefined): "IBC" | "Local" {
  return codeType === "local" ? "Local" : "IBC";
}

function scopeSection(result: ComplianceExportAnalysisResult): ComplianceExportScopeSection {
  const codeType = result.codeType === "local" ? "local" : "ibc";
  return {
    codeType,
    scopeLabel: scopeLabelFor(codeType),
    summary: result.summary,
    issueCount: result.summary.totalIssues ?? result.issues?.length ?? 0,
    evidence: result.reviewReport?.evidence ?? [],
    legalApplicability: result.reviewReport?.legalApplicability ?? null,
    codeCoverage: result.reviewReport?.codeCoverage ?? null,
  };
}

/**
 * Merge IBC + local results for one file into a single export section.
 * Matches KPI aggregation (both code types contribute to counts).
 */
function sectionFromGroup(group: ComplianceExportResultGroup): ComplianceExportFileSection | null {
  if (group.failed && !group.ibcResult && !group.localResult) {
    return {
      fileId: group.id,
      fileName: group.fileName,
      documentId: group.documentId ?? null,
      failed: true,
      error: group.error,
      codeType: "combined",
      summary: emptySummary(),
      issues: [],
      jurisdictionNotes: "",
      scopes: [],
    };
  }

  const results = [group.ibcResult, group.localResult].filter(
    (r): r is ComplianceExportAnalysisResult => Boolean(r),
  );
  if (results.length === 0) return null;

  const issues: ComplianceExportIssue[] = [];
  const notes: string[] = [];

  for (const result of results) {
    const codeType = result.codeType === "local" ? "local" : "ibc";
    for (const issue of result.issues ?? []) {
      issues.push({
        ...issue,
        codeType: issue.codeType ?? codeType,
        scopeLabel: scopeLabelFor(issue.codeType ?? codeType),
      });
    }
    if (result.jurisdictionNotes?.trim()) {
      notes.push(result.jurisdictionNotes.trim());
    }
  }

  const codeType =
    group.ibcResult && group.localResult
      ? "combined"
      : group.localResult
        ? "local"
        : "ibc";

  return {
    fileId: group.id,
    fileName: group.fileName,
    documentId: group.documentId ?? null,
    failed: Boolean(group.failed),
    error: group.error,
    codeType,
    summary: finalizeSummary(results),
    issues,
    jurisdictionNotes: [...new Set(notes)].join("\n\n"),
    scopes: results.map(scopeSection),
  };
}

/**
 * Build an export payload from every sheet in the selected run.
 * Callers must pass the unfiltered run groups, not the search/score view.
 */
export function buildAggregatedComplianceExport(
  groups: ComplianceExportResultGroup[],
): AggregatedComplianceExport {
  const files: ComplianceExportFileSection[] = [];
  let filesAnalyzed = 0;
  const flatIssues: AggregatedComplianceExport["issues"] = [];
  const notes: string[] = [];
  const scoredResults: ComplianceExportAnalysisResult[] = [];

  for (const group of groups) {
    const section = sectionFromGroup(group);
    if (!section) continue;
    files.push(section);

    const hasResults = Boolean(group.ibcResult || group.localResult);
    if (hasResults) filesAnalyzed += 1;
    for (const result of [group.ibcResult, group.localResult]) {
      if (result) scoredResults.push(result);
    }

    for (const issue of section.issues) {
      flatIssues.push({
        ...issue,
        sourceFile: section.fileName,
        sourceFileId: section.fileId,
        // Keep location readable when flattened for PDF category view.
        location: issue.location
          ? `${section.fileName} — ${issue.location}`
          : section.fileName,
      });
    }

    if (section.jurisdictionNotes) {
      notes.push(`${section.fileName}: ${section.jurisdictionNotes}`);
    }
  }

  return {
    filesAnalyzed,
    summary: finalizeSummary(scoredResults),
    files,
    issues: flatIssues,
    jurisdictionNotes: notes.join("\n\n"),
  };
}

export interface ComplianceExportJsonReport {
  generatedAt: string;
  jurisdiction: string;
  projectType: string;
  codeYear: string;
  filesAnalyzed: number;
  summary: ComplianceExportAnalysisResult["summary"];
  files: Array<{
    fileId: string;
    fileName: string;
    documentId?: string | null;
    failed?: boolean;
    error?: string;
    codeType: "ibc" | "local" | "combined";
    summary: ComplianceExportAnalysisResult["summary"];
    issues: Array<ComplianceExportIssue & { response: unknown }>;
    jurisdictionNotes: string;
    scopes: ComplianceExportScopeSection[];
  }>;
  jurisdictionNotes: string;
}

export function buildComplianceExportJsonReport(opts: {
  aggregated: AggregatedComplianceExport;
  jurisdiction: string;
  projectType: string;
  codeYear: string;
  responses: Record<string, unknown>;
  generatedAt?: string;
}): ComplianceExportJsonReport {
  const { aggregated, jurisdiction, projectType, codeYear, responses } = opts;
  return {
    generatedAt: opts.generatedAt ?? new Date().toISOString(),
    jurisdiction,
    projectType,
    codeYear,
    filesAnalyzed: aggregated.filesAnalyzed,
    summary: aggregated.summary,
    files: aggregated.files.map((file) => ({
      fileId: file.fileId,
      fileName: file.fileName,
      documentId: file.documentId,
      failed: file.failed,
      error: file.error,
      codeType: file.codeType,
      summary: file.summary,
      issues: file.issues.map((issue) => ({
        ...issue,
        response:
          responses[complianceIssueResponseKey(file.fileId, issue.id)] ??
          responses[issue.id] ??
          null,
      })),
      jurisdictionNotes: file.jurisdictionNotes,
      scopes: file.scopes,
    })),
    jurisdictionNotes: aggregated.jurisdictionNotes,
  };
}
