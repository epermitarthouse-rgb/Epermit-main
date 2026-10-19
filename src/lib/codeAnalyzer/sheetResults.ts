/**
 * Load and group Code Analyzer sheet results for the active run.
 * PostgREST stops at 1000 rows, so callers must page. An unfiltered project
 * read can fill that page with older runs and omit most of the active run.
 */
import type { ComplianceBatchAnalysisResult, ComplianceBatchIssue } from "@/lib/complianceBatchProcessor";
import { computeComplianceOverallScore } from "@/lib/complianceBatchProcessor";
import { buildReviewReportView, reviewLimitations, type ReviewMetadataLike } from "@/lib/codeAnalyzer/reviewReport";
import { supabase } from "@/lib/supabase";

export const ANNOTATION_QUERY_PAGE_SIZE = 1000;
const MAX_ANNOTATION_PAGES = 200;

export interface SheetAnnotationRow {
  id?: string;
  document_id?: string | null;
  analysis_run_id?: string | null;
  data?: unknown;
}

export interface AggregatedSheetAnalysis {
  /** project_documents id used by the results list and finding actions. */
  documentId: string;
  /** Sheet identity. IBC and local rows for the same sheet share this key. */
  sheetId: string;
  fileName: string;
  ibcResult: ComplianceBatchAnalysisResult | null;
  localResult: ComplianceBatchAnalysisResult | null;
}

interface AnnotationData extends ReviewMetadataLike {
  compliance_issue?: boolean;
  compliance_metadata?: boolean;
  codeType?: "ibc" | "local" | string;
  id?: string;
  category?: string;
  title?: string;
  description?: string;
  severity?: ComplianceBatchIssue["severity"];
  codeReference?: string;
  codeYear?: string;
  location?: string;
  suggestedFix?: string;
  sheet_file_name?: string;
  file_name?: string;
  summary?: ComplianceBatchAnalysisResult["summary"];
  jurisdictionNotes?: string;
  findingType?: string;
  validationDisposition?: string;
  codeSourceStatus?: string | null;
  provenance?: { codeSourceStatus?: string | null } | null;
  sheet_id?: string;
}

export async function fetchAllPages<T>(
  loadPage: (from: number, toInclusive: number) => Promise<T[]>,
  pageSize = ANNOTATION_QUERY_PAGE_SIZE,
): Promise<T[]> {
  if (pageSize < 1) {
    throw new Error("pageSize must be at least 1");
  }
  const all: T[] = [];
  let from = 0;
  for (let pageIndex = 0; pageIndex < MAX_ANNOTATION_PAGES; pageIndex += 1) {
    const page = await loadPage(from, from + pageSize - 1);
    all.push(...page);
    if (page.length < pageSize) return all;
    from += pageSize;
  }
  throw new Error("Annotation results exceeded the paged read limit");
}

export async function fetchAnnotationsForSheetResults(input: {
  projectId: string;
  runId: string | null;
}): Promise<SheetAnnotationRow[]> {
  return fetchAllPages(async (from, to) => {
    const base = supabase
      .from("document_annotations")
      .select("id, document_id, analysis_run_id, data, layer_order")
      .eq("project_id", input.projectId)
      .not("document_id", "is", null);
    const scoped = input.runId
      ? base.eq("analysis_run_id", input.runId)
      : base.is("analysis_run_id", null);
    const { data, error } = await scoped
      .order("layer_order", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to);
    if (error) throw error;
    return (data ?? []) as SheetAnnotationRow[];
  });
}

/** Paged scan used only when no current/stale run exists and a historical run must be chosen. */
export async function fetchAnnotationRefsForHydrateResolution(
  projectId: string,
): Promise<SheetAnnotationRow[]> {
  return fetchAllPages(async (from, to) => {
    const { data, error } = await supabase
      .from("document_annotations")
      .select("id, document_id, analysis_run_id, data")
      .eq("project_id", projectId)
      .not("document_id", "is", null)
      .order("id", { ascending: true })
      .range(from, to);
    if (error) throw error;
    return (data ?? []) as SheetAnnotationRow[];
  });
}

function annotationData(row: SheetAnnotationRow): AnnotationData {
  return (row.data ?? {}) as AnnotationData;
}

function isComplianceRow(row: SheetAnnotationRow): boolean {
  const data = annotationData(row);
  return Boolean(data.compliance_issue || data.compliance_metadata);
}

/** One sheet key for both modes. Prefer the stored sheet id, then the document id. */
export function sheetResultKey(row: SheetAnnotationRow): string | null {
  const data = annotationData(row);
  if (typeof data.sheet_id === "string" && data.sheet_id.length > 0) return data.sheet_id;
  if (typeof row.document_id === "string" && row.document_id.length > 0) return row.document_id;
  return null;
}

function citationStatusFrom(data: AnnotationData): string | undefined {
  if (typeof data.codeSourceStatus === "string" && data.codeSourceStatus.trim()) {
    return data.codeSourceStatus;
  }
  const nested = data.provenance?.codeSourceStatus;
  if (typeof nested === "string" && nested.trim()) return nested;
  return undefined;
}

function preservedIssueScore(
  summary: AnnotationData["summary"] | undefined,
  recomputed: number | null,
): number | null {
  if (!summary) return recomputed;
  if (typeof summary.overallScore === "number") return summary.overallScore;
  if (
    summary.reviewState === "reviewed_partial" ||
    summary.reviewState === "failed" ||
    summary.reviewState === "not_reviewed" ||
    summary.reviewState === "reviewed_clear" ||
    summary.reviewState === "reviewed_findings"
  ) {
    return null;
  }
  return recomputed;
}

function sheetFileName(rows: SheetAnnotationRow[]): string {
  for (const row of rows) {
    const data = annotationData(row);
    const name = data.sheet_file_name || data.file_name || "";
    if (name.trim().length > 0) return name;
  }
  return "";
}

function buildModeResult(
  rows: SheetAnnotationRow[],
  codeType: "ibc" | "local",
): ComplianceBatchAnalysisResult | null {
  const metadataByCodeType = new Map<string, AnnotationData>();
  const issuesByCodeType = new Map<string, ComplianceBatchIssue[]>();

  for (const row of rows) {
    const data = annotationData(row);
    if (data.compliance_metadata) {
      metadataByCodeType.set(data.codeType || "ibc", data);
    } else if (data.compliance_issue && (data.codeType === "ibc" || data.codeType === "local")) {
      const issue: ComplianceBatchIssue = {
        id: data.id || row.id || `${codeType}-issue`,
        category: data.category || "",
        title: data.title || "",
        description: data.description || "",
        severity: data.severity || "advisory",
        codeReference: data.codeReference || "",
        codeYear: data.codeYear || "",
        location: data.location || "",
        suggestedFix: data.suggestedFix || "",
        codeType: data.codeType,
        sheetFileName: data.sheet_file_name || data.file_name || undefined,
        findingType: data.findingType,
        validationDisposition: data.validationDisposition,
        codeSourceStatus: citationStatusFrom(data),
      };
      const list = issuesByCodeType.get(data.codeType) || [];
      list.push(issue);
      issuesByCodeType.set(data.codeType, list);
    }
  }

  const meta = metadataByCodeType.get(codeType);
  const issues = issuesByCodeType.get(codeType) || [];
  if (!meta && issues.length === 0) return null;

  const critical = issues.filter((issue) => issue.severity === "critical").length;
  const warnings = issues.filter((issue) => issue.severity === "warning").length;
  const advisory = issues.length - critical - warnings;
  const limitations = meta ? reviewLimitations([meta]) : [];

  const buildSummary = (): ComplianceBatchAnalysisResult["summary"] => {
    if (issues.length === 0) {
      const stored = meta?.summary?.reviewState;
      const checklist = Array.isArray(meta?.summary?.checklist) ? meta.summary.checklist : [];
      if (stored === "reviewed_clear") {
        const verified = meta?.summary?.codeCoverageVerified === true && meta?.summary?.overallScore === 100;
        return {
          totalIssues: 0,
          critical: 0,
          warnings: 0,
          advisory: 0,
          overallScore: verified ? 100 : null,
          reviewState: "reviewed_clear",
          checklist,
          cleanChecks: meta?.summary?.cleanChecks,
          codeCoverageVerified: meta?.summary?.codeCoverageVerified === true,
          limitations,
        };
      }
      if (stored === "reviewed_partial" || stored === "failed" || stored === "reviewed_findings") {
        return {
          totalIssues: 0,
          critical: 0,
          warnings: 0,
          advisory: 0,
          overallScore: null,
          reviewState: stored,
          checklist,
          cleanChecks: meta?.summary?.cleanChecks,
          codeCoverageVerified: meta?.summary?.codeCoverageVerified === true,
          limitations,
        };
      }
      const passed = stored === "passed" && checklist.length > 0;
      const verified = passed && meta?.summary?.codeCoverageVerified === true;
      return {
        totalIssues: 0,
        critical: 0,
        warnings: 0,
        advisory: 0,
        overallScore: verified ? 100 : null,
        reviewState: passed ? "passed" : "not_reviewed",
        checklist: passed ? checklist : [],
        codeCoverageVerified: verified,
        ...(passed ? { limitations } : {}),
      };
    }
    const recomputed = computeComplianceOverallScore({
      critical,
      warnings,
      advisory,
      totalIssues: issues.length,
    });
    if (meta?.summary) {
      return {
        ...meta.summary,
        totalIssues: issues.length,
        critical,
        warnings,
        advisory,
        overallScore: preservedIssueScore(meta.summary, recomputed),
        limitations,
      };
    }
    return {
      totalIssues: issues.length,
      critical,
      warnings,
      advisory,
      overallScore: recomputed,
    };
  };

  return {
    issues,
    summary: buildSummary(),
    jurisdictionNotes: meta?.jurisdictionNotes || "",
    codeType,
    reviewReport: buildReviewReportView(meta ? [meta] : [], issues),
  };
}

/**
 * Collapse IBC and local-amendment rows into one entry per sheet.
 * Metadata-only Clear, Partial, and zero-issue sheets are kept.
 */
export function aggregateSheetAnalysisResults(rows: SheetAnnotationRow[]): AggregatedSheetAnalysis[] {
  const groups = new Map<string, SheetAnnotationRow[]>();
  const order: string[] = [];
  for (const row of rows) {
    if (!isComplianceRow(row)) continue;
    const key = sheetResultKey(row);
    if (!key) continue;
    const existing = groups.get(key);
    if (existing) {
      existing.push(row);
    } else {
      groups.set(key, [row]);
      order.push(key);
    }
  }

  const sheets: AggregatedSheetAnalysis[] = [];
  for (const key of order) {
    const grouped = groups.get(key) ?? [];
    const documentId = grouped.find((row) => typeof row.document_id === "string" && row.document_id.length > 0)
      ?.document_id;
    if (!documentId) continue;
    const ibcResult = buildModeResult(grouped, "ibc");
    const localResult = buildModeResult(grouped, "local");
    if (!ibcResult && !localResult) continue;
    sheets.push({
      documentId,
      sheetId: key,
      fileName: sheetFileName(grouped),
      ibcResult,
      localResult,
    });
  }
  return sheets;
}

export function formatSheetResultsCounter(shown: number, total: number): string {
  return `Showing ${shown} of ${total} sheets`;
}

export function filterSheetResultsBySearch<T extends { fileName: string }>(
  groups: T[],
  search: string,
): T[] {
  const query = search.trim().toLowerCase();
  if (!query) return groups;
  return groups.filter((group) => group.fileName.toLowerCase().includes(query));
}
