import {
  displayAnalysisMode,
  type PersistedAnalysisScope,
} from "@/lib/supabaseAnalyzer/analysisMode";
import type {
  AnalyzerRunDataset,
  SupabaseAnalyzerFinding,
  SupabaseAnalyzerRun,
} from "@/lib/supabaseAnalyzer/client";
import {
  displayDisciplineForSheet,
  disciplineSortIndex,
} from "@/lib/supabaseAnalyzer/disciplineDisplay";

export const SUPABASE_ANALYZER_EXPORT_SCHEMA = "supabase-analyzer-export.v1";

export interface SeverityTotals {
  all: number;
  critical: number;
  warning: number;
  advisory: number;
}

export function countSeverity(
  findings: Array<Pick<SupabaseAnalyzerFinding, "severity">>,
): SeverityTotals {
  const totals: SeverityTotals = { all: findings.length, critical: 0, warning: 0, advisory: 0 };
  for (const finding of findings) {
    if (finding.severity === "critical") totals.critical += 1;
    else if (finding.severity === "warning") totals.warning += 1;
    else if (finding.severity === "advisory") totals.advisory += 1;
  }
  return totals;
}

function findingsForJob(findings: SupabaseAnalyzerFinding[], jobId: string) {
  return findings
    .filter((finding) => finding.sheet_job_id === jobId)
    .sort((left, right) => left.finding_index - right.finding_index);
}

function scopeLimitation(run: SupabaseAnalyzerRun): string | null {
  const scope = run.analysis_scope as PersistedAnalysisScope | null | undefined;
  return scope?.limitation || null;
}

export interface SupabaseAnalyzerJsonExport {
  schemaVersion: typeof SUPABASE_ANALYZER_EXPORT_SCHEMA;
  exportedAt: string;
  project: { id: string; name: string | null };
  run: {
    id: string;
    status: string;
    analysisMode: SupabaseAnalyzerRun["analysis_mode"];
    analysisModeLabel: string;
    jurisdictionKey: string;
    jurisdictionLabel: string;
    projectType: string;
    codeEdition: string;
    codeContext: string;
    sourceCoverage: string;
    sourceLimitation: string | null;
    sheetCounts: {
      total: number;
      uploaded: number;
      queued: number;
      processing: number;
      completed: number;
      failed: number;
    };
    severityTotals: SeverityTotals;
    disciplineBreakdown: Array<{
      discipline: string;
      sheetCount: number;
      findingCount: number;
    }>;
  };
  sheets: Array<{
    id: string;
    ordinal: number;
    sheetNumber: string | null;
    title: string | null;
    fileName: string;
    status: string;
    discipline: { display: string; raw: string | null };
    summary: string | null;
    severityTotals: SeverityTotals;
    findings: Array<{
      id: string;
      findingIndex: number;
      severity: string;
      title: string;
      observation: string;
      drawingEvidence: string;
      drawingLocation: string | null;
      codeReference: string | null;
      recommendation: string;
      category: string;
      provenanceStatus: string;
      verificationStatus: string;
      jurisdictionKey: string;
      codeEdition: string;
    }>;
  }>;
}

export function buildSupabaseAnalyzerJsonExport(
  dataset: AnalyzerRunDataset,
  projectName?: string | null,
  exportedAt = new Date().toISOString(),
): SupabaseAnalyzerJsonExport {
  const { run, jobs, findings } = dataset;
  const disciplineCounts = new Map<string, { sheetCount: number; findingCount: number }>();
  const sheets = [...jobs]
    .sort((left, right) => left.ordinal - right.ordinal)
    .map((job) => {
      const discipline = displayDisciplineForSheet(job);
      const sheetFindings = findingsForJob(findings, job.id);
      const bucket = disciplineCounts.get(discipline.display) || { sheetCount: 0, findingCount: 0 };
      bucket.sheetCount += 1;
      bucket.findingCount += sheetFindings.length;
      disciplineCounts.set(discipline.display, bucket);
      return {
        id: job.id,
        ordinal: job.ordinal,
        sheetNumber: job.detected_sheet_number,
        title: job.detected_sheet_title,
        fileName: job.original_file_name,
        status: job.status,
        discipline: { display: discipline.display, raw: discipline.raw },
        summary: job.analysis_summary,
        severityTotals: countSeverity(sheetFindings),
        findings: sheetFindings.map((finding) => ({
          id: finding.id,
          findingIndex: finding.finding_index,
          severity: finding.severity,
          title: finding.title,
          observation: finding.observation,
          drawingEvidence: finding.drawing_evidence,
          drawingLocation: finding.drawing_location,
          codeReference: finding.suggested_code_reference,
          recommendation: finding.recommendation,
          category: finding.category,
          provenanceStatus: finding.provenance_status,
          verificationStatus: finding.verification_status,
          jurisdictionKey: finding.jurisdiction_key,
          codeEdition: finding.code_edition,
        })),
      };
    });

  return {
    schemaVersion: SUPABASE_ANALYZER_EXPORT_SCHEMA,
    exportedAt,
    project: { id: run.project_id, name: projectName || null },
    run: {
      id: run.id,
      status: run.status,
      analysisMode: run.analysis_mode ?? null,
      analysisModeLabel: displayAnalysisMode(run.analysis_mode),
      jurisdictionKey: run.jurisdiction_key,
      jurisdictionLabel: run.jurisdiction_label,
      projectType: run.project_type,
      codeEdition: run.code_edition,
      codeContext: run.code_context,
      sourceCoverage: run.source_coverage,
      sourceLimitation: scopeLimitation(run),
      sheetCounts: {
        total: run.total_sheets,
        uploaded: run.uploaded_sheets,
        queued: run.queued_sheets,
        processing: run.processing_sheets,
        completed: run.completed_sheets,
        failed: run.failed_sheets,
      },
      severityTotals: countSeverity(findings),
      disciplineBreakdown: [...disciplineCounts.entries()]
        .sort((left, right) => disciplineSortIndex(left[0]) - disciplineSortIndex(right[0]) || left[0].localeCompare(right[0]))
        .map(([discipline, counts]) => ({ discipline, ...counts })),
    },
    sheets,
  };
}

export function supabaseAnalyzerExportFileName(runId: string, extension: "pdf" | "json"): string {
  const shortId = runId.replace(/[^a-zA-Z0-9-]/g, "").slice(0, 8) || "run";
  return `PermitPilot-Code-Analyzer-${shortId}.${extension}`;
}

export function downloadSupabaseAnalyzerJson(
  dataset: AnalyzerRunDataset,
  projectName?: string | null,
) {
  const payload = buildSupabaseAnalyzerJsonExport(dataset, projectName);
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = supabaseAnalyzerExportFileName(dataset.run.id, "json");
  link.click();
  URL.revokeObjectURL(url);
}

export function reportSummaryLines(
  dataset: AnalyzerRunDataset,
  projectName?: string | null,
): string[] {
  const payload = buildSupabaseAnalyzerJsonExport(dataset, projectName, new Date().toISOString());
  const totals = payload.run.severityTotals;
  const lines = [
    `Project: ${payload.project.name || payload.project.id}`,
    `Run: ${payload.run.id}`,
    `Status: ${payload.run.status}`,
    `Analysis mode: ${payload.run.analysisModeLabel}`,
    `Jurisdiction: ${payload.run.jurisdictionLabel}`,
    `Code edition: ${payload.run.codeEdition}`,
    `Code context: ${payload.run.codeContext}`,
    `Sheets: ${payload.run.sheetCounts.completed} completed, ${payload.run.sheetCounts.failed} failed, ${payload.run.sheetCounts.total} total`,
    `Findings: ${totals.all} (Critical ${totals.critical}, Warning ${totals.warning}, Advisory ${totals.advisory})`,
  ];
  if (payload.run.sourceLimitation) lines.push(`Source note: ${payload.run.sourceLimitation}`);
  if (payload.run.disciplineBreakdown.length) {
    lines.push("Discipline breakdown:");
    for (const row of payload.run.disciplineBreakdown) {
      lines.push(`- ${row.discipline}: ${row.sheetCount} sheets, ${row.findingCount} findings`);
    }
  }
  return lines;
}

