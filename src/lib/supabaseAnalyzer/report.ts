import jsPDF from "jspdf";
import type { AnalyzerRunDataset, SupabaseAnalyzerFinding } from "./client";
import { displayDisciplineForSheet } from "./disciplineDisplay";
import { reportSummaryLines, supabaseAnalyzerExportFileName } from "./exportDataset";

const severityColor: Record<string, [number, number, number]> = {
  critical: [185, 28, 28],
  warning: [180, 83, 9],
  advisory: [30, 64, 175],
};

function wrap(doc: jsPDF, text: string, width: number): string[] {
  return doc.splitTextToSize(text || "—", width) as string[];
}

export function exportSupabaseAnalyzerReport(
  dataset: AnalyzerRunDataset,
  projectName?: string,
) {
  const { run, jobs, findings } = dataset;
  const doc = new jsPDF();
  const margin = 18;
  const width = doc.internal.pageSize.getWidth() - margin * 2;
  const pageHeight = doc.internal.pageSize.getHeight();
  let y = 20;

  const ensure = (height: number) => {
    if (y + height > pageHeight - 18) {
      doc.addPage();
      y = 20;
    }
  };
  const text = (value: string, size = 10, color: [number, number, number] = [31, 41, 55]) => {
    doc.setFontSize(size);
    doc.setTextColor(...color);
    const lines = wrap(doc, value, width);
    ensure(lines.length * (size * 0.45) + 3);
    doc.text(lines, margin, y);
    y += lines.length * (size * 0.45) + 3;
  };

  doc.setFont("helvetica", "bold");
  text("PermitPilot Code Analyzer", 20, [15, 76, 92]);
  doc.setFont("helvetica", "normal");
  text("Preliminary Drawing Review Observations", 13);
  y += 2;
  for (const line of reportSummaryLines(dataset, projectName)) text(line);
  text(`Generated: ${new Date().toLocaleString()}`);
  y += 3;
  doc.setFillColor(240, 249, 255);
  doc.rect(margin, y, width, 23, "F");
  y += 6;
  text(
    "Review basis: observations are generated from the submitted drawings to support professional review. Code references should be confirmed against the adopted source text and project-specific applicability.",
    9,
    [30, 64, 80],
  );
  y += 5;

  const findingsByJob = new Map<string, SupabaseAnalyzerFinding[]>();
  for (const finding of findings) {
    const list = findingsByJob.get(finding.sheet_job_id) || [];
    list.push(finding);
    findingsByJob.set(finding.sheet_job_id, list);
  }

  const orderedJobs = [...jobs].sort((left, right) => left.ordinal - right.ordinal);
  for (const job of orderedJobs) {
    const sheetFindings = (findingsByJob.get(job.id) || [])
      .sort((left, right) => left.finding_index - right.finding_index);
    const discipline = displayDisciplineForSheet(job);
    ensure(28);
    doc.setFont("helvetica", "bold");
    text(
      `${job.detected_sheet_number || `Sheet ${job.ordinal}`} — ${job.detected_sheet_title || job.original_file_name}`,
      13,
      [15, 76, 92],
    );
    doc.setFont("helvetica", "normal");
    text(`${discipline.display} · ${job.status.replace(/_/g, " ")} · ${sheetFindings.length} findings`, 9, [75, 85, 99]);
    if (job.analysis_summary) text(job.analysis_summary, 9);
    if (job.status === "failed") {
      text("Processing note: This sheet could not be completed. Retry the sheet or contact support.", 9, [153, 27, 27]);
    } else if (sheetFindings.length === 0 && job.status === "completed") {
      text("No supported review observations were returned for this sheet.", 9);
    }

    for (const finding of sheetFindings) {
      ensure(38);
      const color = severityColor[finding.severity] || severityColor.advisory;
      doc.setFont("helvetica", "bold");
      text(`${finding.severity.toUpperCase()} · ${finding.title}`, 10, color);
      doc.setFont("helvetica", "normal");
      text(`Observation: ${finding.observation}`, 9);
      text(`Drawing evidence: ${finding.drawing_evidence}`, 9);
      if (finding.drawing_location) text(`Location: ${finding.drawing_location}`, 9);
      if (finding.suggested_code_reference) {
        text(`Code reference: ${finding.suggested_code_reference}`, 9);
      }
      text(`Recommended action: ${finding.recommendation}`, 9);
      y += 3;
    }
    y += 5;
  }

  doc.save(supabaseAnalyzerExportFileName(run.id, "pdf"));
}
