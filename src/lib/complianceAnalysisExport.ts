/**
 * Pure helpers to build Code Analyzer PDF/JSON export payloads from the
 * currently displayed result groups (All + score filter, or a single file).
 */

import { computeComplianceOverallScore } from "./complianceBatchProcessor";

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
}

export interface ComplianceExportAnalysisResult {
  issues: ComplianceExportIssue[];
  summary: {
    totalIssues: number;
    critical: number;
    warnings: number;
    advisory: number;
    overallScore: number;
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
    overallScore: 100,
  };
}

function addSummaries(
  a: ComplianceExportAnalysisResult["summary"],
  b: ComplianceExportAnalysisResult["summary"],
): ComplianceExportAnalysisResult["summary"] {
  return {
    totalIssues: (a.totalIssues ?? 0) + (b.totalIssues ?? 0),
    critical: (a.critical ?? 0) + (b.critical ?? 0),
    warnings: (a.warnings ?? 0) + (b.warnings ?? 0),
    advisory: (a.advisory ?? 0) + (b.advisory ?? 0),
    overallScore: 0,
  };
}

function finalizeSummary(
  counts: Omit<ComplianceExportAnalysisResult["summary"], "overallScore"> & {
    overallScore?: number;
  },
): ComplianceExportAnalysisResult["summary"] {
  const critical = counts.critical ?? 0;
  const warnings = counts.warnings ?? 0;
  const advisory = counts.advisory ?? 0;
  const totalIssues = counts.totalIssues ?? critical + warnings + advisory;
  return {
    totalIssues,
    critical,
    warnings,
    advisory,
    overallScore: computeComplianceOverallScore({
      critical,
      warnings,
      advisory,
      totalIssues,
    }),
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
    };
  }

  const results = [group.ibcResult, group.localResult].filter(
    (r): r is ComplianceExportAnalysisResult => Boolean(r),
  );
  if (results.length === 0) return null;

  let summary = emptySummary();
  const issues: ComplianceExportIssue[] = [];
  const notes: string[] = [];

  for (const result of results) {
    summary = addSummaries(summary, result.summary);
    for (const issue of result.issues ?? []) {
      issues.push({
        ...issue,
        codeType: issue.codeType ?? (result.codeType === "local" ? "local" : "ibc"),
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
    summary: finalizeSummary(summary),
    issues,
    jurisdictionNotes: [...new Set(notes)].join("\n\n"),
  };
}

/**
 * Build an export payload from the same groups the results UI displays
 * (`displayedResultGroups` after document + score filters).
 */
export function buildAggregatedComplianceExport(
  groups: ComplianceExportResultGroup[],
): AggregatedComplianceExport {
  const files: ComplianceExportFileSection[] = [];
  let summary = emptySummary();
  let filesAnalyzed = 0;
  const flatIssues: AggregatedComplianceExport["issues"] = [];
  const notes: string[] = [];

  for (const group of groups) {
    const section = sectionFromGroup(group);
    if (!section) continue;
    files.push(section);

    const hasResults = Boolean(group.ibcResult || group.localResult);
    if (hasResults) filesAnalyzed += 1;

    // Match KPI strip: sum each code-type result's summary independently.
    for (const result of [group.ibcResult, group.localResult]) {
      if (!result) continue;
      summary = addSummaries(summary, result.summary);
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
    summary: finalizeSummary(summary),
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
      issues: file.issues.map((issue) => ({
        ...issue,
        response:
          responses[complianceIssueResponseKey(file.fileId, issue.id)] ??
          responses[issue.id] ??
          null,
      })),
      jurisdictionNotes: file.jurisdictionNotes,
    })),
    jurisdictionNotes: aggregated.jurisdictionNotes,
  };
}
