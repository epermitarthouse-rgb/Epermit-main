/**
 * Pure helpers to build Code Analyzer PDF/JSON export payloads.
 * Export All uses every sheet on the active run. A single sheet payload
 * includes both IBC and Local findings, labeled for the report.
 */

import {
  combineSheetSummaries,
  rollupSheetSummaries,
  type CombinedModeResult,
} from "./codeAnalyzer/combinedSheetSummary";

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
  codeSourceStatus?: string | null;
  sheetFileName?: string;
  sheet?: string;
  codeScope?: string;
  codeEdition?: string;
  citationVerificationStatus?: string;
  reviewerResponse?: string;
}

export interface ComplianceExportAnalysisResult {
  issues: ComplianceExportIssue[];
  summary: {
    totalIssues: number;
    critical: number;
    warnings: number;
    advisory: number;
    overallScore: number | null;
    reviewState?:
      | "not_reviewed"
      | "passed"
      | "reviewed_clear"
      | "reviewed_findings"
      | "reviewed_partial"
      | "failed"
      | null;
    codeCoverageVerified?: boolean;
    limitations?: Array<{ code: string; detail: string }>;
    outcome?: string;
    outcomeLabel?: string;
  };
  jurisdictionNotes: string;
  codeType: "ibc" | "local" | "combined";
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
}

export interface AggregatedComplianceExport {
  filesAnalyzed: number;
  summary: ComplianceExportAnalysisResult["summary"];
  files: ComplianceExportFileSection[];
  /** Flat issue list (for PDF), tagged with source file. */
  issues: Array<ComplianceExportIssue & { sourceFile: string; sourceFileId: string }>;
  jurisdictionNotes: string;
}

export function complianceIssueResponseKey(fileId: string, issueId: string): string {
  return `${fileId}:${issueId}`;
}

function emptySummary(): ComplianceExportAnalysisResult["summary"] {
  return {
    totalIssues: 0,
    critical: 0,
    warnings: 0,
    advisory: 0,
    overallScore: null,
    reviewState: "not_reviewed",
    codeCoverageVerified: false,
  };
}

export type ReviewerResponseLabel = "Accept" | "Modify" | "N/A" | "Unreviewed" | string;

export function mapReviewerResponse(response: { status?: string } | null | undefined): ReviewerResponseLabel {
  if (!response?.status) return "Unreviewed";
  if (response.status === "accepted") return "Accept";
  if (response.status === "modified") return "Modify";
  if (response.status === "rejected") return "N/A";
  return response.status;
}

export function citationVerificationLabel(status: unknown): string {
  if (status === "authoritative") return "Verified";
  if (status === "unverified") return "Unverified";
  if (typeof status === "string" && status.trim()) return status.trim();
  return "Not recorded";
}

export function codeScopeLabel(codeType: string | null | undefined): "General IBC" | "Local Amendments" {
  return codeType === "local" ? "Local Amendments" : "General IBC";
}

export interface ExportFindingLabels {
  codeScope: string;
  codeEdition: string;
  sheet: string;
  citationVerificationStatus: string;
  reviewerResponse: ReviewerResponseLabel;
}

export function describeExportFinding(
  issue: {
    codeType?: string | null;
    codeYear?: string | null;
    codeEdition?: string | null;
    sheet?: string | null;
    sheetFileName?: string | null;
    codeSourceStatus?: string | null;
    citationVerificationStatus?: string | null;
  },
  response: { status?: string } | null | undefined,
): ExportFindingLabels {
  const edition = issue.codeEdition?.trim() || issue.codeYear?.trim() || "Not recorded";
  const sheet = issue.sheet?.trim() || issue.sheetFileName?.trim() || "Not recorded";
  return {
    codeScope: codeScopeLabel(issue.codeType),
    codeEdition: edition,
    sheet,
    citationVerificationStatus:
      issue.citationVerificationStatus?.trim() || citationVerificationLabel(issue.codeSourceStatus),
    reviewerResponse: mapReviewerResponse(response),
  };
}

export function findingCaptionLines(
  issue: Parameters<typeof describeExportFinding>[0],
  response: { status?: string } | null | undefined,
): string[] {
  const labels = describeExportFinding(issue, response);
  return [
    `Scope: ${labels.codeScope} · Edition: ${labels.codeEdition} · Sheet: ${labels.sheet}`,
    `Citation: ${labels.citationVerificationStatus} · Response: ${labels.reviewerResponse}`,
  ];
}

export function exportReportButtonLabel(format: "pdf" | "json", scope: "all" | "filtered"): string {
  if (scope === "filtered") {
    return format === "pdf"
      ? "Export only the filtered sheets (PDF)"
      : "Export only the filtered sheets (JSON)";
  }
  return format === "pdf" ? "Export All PDF" : "Export All JSON";
}

/** Export All reads the active run. Filtered scope is a separate, explicitly labeled action. */
export function selectSheetsForExport<T>(
  activeRunGroups: T[],
  displayedGroups: T[],
  scope: "all" | "filtered",
): T[] {
  return scope === "filtered" ? displayedGroups : activeRunGroups;
}

function asCombinedMode(result: ComplianceExportAnalysisResult | null): CombinedModeResult | null {
  if (!result) return null;
  return result;
}

/**
 * Merge IBC + local results for one file into a single export section.
 * Findings are concatenated. Shared issue ids stay on both scopes.
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
    };
  }

  const results = [group.ibcResult, group.localResult].filter(
    (result): result is ComplianceExportAnalysisResult => Boolean(result),
  );
  if (results.length === 0) return null;

  const issues: ComplianceExportIssue[] = [];
  const notes: string[] = [];

  for (const result of results) {
    for (const issue of result.issues ?? []) {
      const codeType = issue.codeType === "local" || result.codeType === "local" ? "local" : "ibc";
      const sheet = issue.sheet?.trim() || issue.sheetFileName?.trim() || group.fileName;
      issues.push({
        ...issue,
        codeType,
        sheet,
        sheetFileName: issue.sheetFileName || sheet,
        codeScope: codeScopeLabel(codeType),
        codeEdition: issue.codeYear?.trim() || "Not recorded",
        citationVerificationStatus: citationVerificationLabel(issue.codeSourceStatus),
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
    summary: combineSheetSummaries(asCombinedMode(group.ibcResult), asCombinedMode(group.localResult)),
    issues,
    jurisdictionNotes: [...new Set(notes)].join("\n\n"),
  };
}

/**
 * Build an export payload from the groups the caller selects.
 * Export All passes every sheet on the active run, including filtered-out rows.
 */
export function buildAggregatedComplianceExport(
  groups: ComplianceExportResultGroup[],
): AggregatedComplianceExport {
  const files: ComplianceExportFileSection[] = [];
  let filesAnalyzed = 0;
  const flatIssues: AggregatedComplianceExport["issues"] = [];
  const notes: string[] = [];
  const scoredSummaries: ComplianceExportAnalysisResult["summary"][] = [];

  for (const group of groups) {
    const section = sectionFromGroup(group);
    if (!section) continue;
    files.push(section);

    const hasResults = Boolean(group.ibcResult || group.localResult);
    if (hasResults) {
      filesAnalyzed += 1;
      scoredSummaries.push(section.summary);
    }

    for (const issue of section.issues) {
      flatIssues.push({
        ...issue,
        sourceFile: section.fileName,
        sourceFileId: section.fileId,
        sheet: issue.sheet || section.fileName,
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
    summary: scoredSummaries.length > 0 ? rollupSheetSummaries(scoredSummaries) : emptySummary(),
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
      issues: file.issues.map((issue) => {
        const raw =
          responses[complianceIssueResponseKey(file.fileId, issue.id)] ??
          responses[issue.id] ??
          null;
        const response =
          raw && typeof raw === "object" ? (raw as { status?: string }) : null;
        return {
          ...issue,
          ...describeExportFinding(
            {
              ...issue,
              codeEdition: issue.codeEdition || issue.codeYear || codeYear,
              sheet: issue.sheet || issue.sheetFileName || file.fileName,
            },
            response,
          ),
          response,
        };
      }),
      jurisdictionNotes: file.jurisdictionNotes,
    })),
    jurisdictionNotes: aggregated.jurisdictionNotes,
  };
}
