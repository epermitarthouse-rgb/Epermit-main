import { format } from "date-fns";
import * as XLSX from "xlsx";
import { parseStoredCodeReferences } from "@/lib/groundedCommentContext";

export interface ResponseMatrixExportEvidence {
  file_name?: string;
  page_number?: number | null;
  sheet_label?: string | null;
  sheet_title?: string | null;
  snippet?: string;
  relevance?: string;
}

export interface ResponseMatrixExportComment {
  id: string;
  project_id: string;
  original_text: string;
  discipline: string;
  code_reference: string | null;
  status: string;
  response_text: string | null;
  assigned_to: string | null;
  sheet_reference: string | null;
  created_at: string;
  reviewer_name?: string | null;
  comment_number?: string | null;
  previous_comment_text?: string | null;
  existing_response_text?: string | null;
  code_references?: string[] | string | null;
  ingest_source?: string | null;
  source_document_id?: string | null;
  grounded_evidence?: ResponseMatrixExportEvidence[] | null;
  required_action?: string | null;
  missing_info_or_risk?: string | null;
  grounded_confidence?: string | null;
  grounded_generated_at?: string | null;
}

export interface ResponseMatrixProjectMeta {
  name: string;
  permit_number: string | null;
  jurisdiction: string | null;
}

export const RESPONSE_MATRIX_EXPORT_HEADERS = [
  "Project Name",
  "Permit Number",
  "Jurisdiction",
  "Status",
  "Discipline",
  "Reviewer Name",
  "Comment Number",
  "City / Reviewer Comment",
  "Previous Reviewer Comment",
  "Existing Response Text",
  "Code Reference",
  "Suggested Response",
  "Required Action",
  "Missing Info / Risk",
  "Confidence",
  "Sheet Reference",
  "Evidence Citations",
  "Assigned To",
  "Markup",
  "Source Type",
  "Source Document",
  "Grounded Generated At",
  "Comment Created At",
] as const;

export type ResponseMatrixExportHeader = (typeof RESPONSE_MATRIX_EXPORT_HEADERS)[number];
export type ResponseMatrixExportRecord = Record<ResponseMatrixExportHeader, string>;

export function ingestSourceExportLabel(source: string | null | undefined): string {
  if (source === "manual_letter") return "Manual uploaded comments";
  if (source === "raw_ref") return "Portal comments";
  if (source === "fallback_llm") return "Parsed comment letter (LLM fallback)";
  return source?.trim() || "";
}

export function formatEvidenceCitations(
  evidence: ResponseMatrixExportEvidence[] | null | undefined,
): string {
  if (!Array.isArray(evidence) || evidence.length === 0) return "";

  return evidence
    .map((item, index) => {
      const lines = [`Citation ${index + 1}:`];
      if (item.file_name) lines.push(`File: ${item.file_name}`);
      if (item.page_number != null) lines.push(`Page: ${item.page_number}`);
      if (item.sheet_label) lines.push(`Sheet: ${item.sheet_label}`);
      if (item.sheet_title) lines.push(`Title: ${item.sheet_title}`);
      if (item.snippet) lines.push(`Snippet: ${item.snippet}`);
      if (item.relevance) lines.push(`Relevance: ${item.relevance}`);
      return lines.join("\n");
    })
    .join("\n\n");
}

export function formatCodeReferences(row: ResponseMatrixExportComment): string {
  const refs = parseStoredCodeReferences(row.code_references);
  const primary = row.code_reference?.trim() || "";
  const all = [...new Set([primary, ...refs].filter(Boolean))];
  return all.join("; ");
}

function formatIsoDate(value: string | null | undefined): string {
  if (!value) return "";
  try {
    return format(new Date(value), "yyyy-MM-dd HH:mm");
  } catch {
    return value;
  }
}

export function markupStatusLabel(status: string | undefined): string {
  if (!status || status === "none") return "None";
  if (status === "approved") return "Marked";
  if (status === "pending") return "Pending";
  if (status === "rejected") return "Rejected";
  return status;
}

export function slugifyForFilename(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72) || "project";
}

export function buildResponseMatrixExportFilename(
  project: ResponseMatrixProjectMeta,
  extension: "csv" | "xlsx",
): string {
  const slug = slugifyForFilename(project.name || project.permit_number || "project");
  const date = format(new Date(), "yyyy-MM-dd");
  return `response-matrix-${slug}-${date}.${extension}`;
}

export function buildResponseMatrixExportRecords(
  rows: ResponseMatrixExportComment[],
  project: ResponseMatrixProjectMeta,
  markupByCommentId: Record<string, string>,
  sourceDocumentById: Record<string, string>,
): ResponseMatrixExportRecord[] {
  return rows.map((row) => ({
    "Project Name": project.name,
    "Permit Number": project.permit_number ?? "",
    Jurisdiction: project.jurisdiction ?? "",
    Status: row.status ?? "",
    Discipline: row.discipline ?? "",
    "Reviewer Name": row.reviewer_name?.trim() ?? "",
    "Comment Number": row.comment_number?.trim() ?? "",
    "City / Reviewer Comment": row.original_text?.trim() ?? "",
    "Previous Reviewer Comment": row.previous_comment_text?.trim() ?? "",
    "Existing Response Text": row.existing_response_text?.trim() ?? "",
    "Code Reference": formatCodeReferences(row),
    "Suggested Response": row.response_text?.trim() ?? "",
    "Required Action": row.required_action?.trim() ?? "",
    "Missing Info / Risk": row.missing_info_or_risk?.trim() ?? "",
    Confidence: row.grounded_confidence?.trim() ?? "",
    "Sheet Reference": row.sheet_reference?.trim() ?? "",
    "Evidence Citations": formatEvidenceCitations(row.grounded_evidence),
    "Assigned To": row.assigned_to?.trim() ?? "",
    Markup: markupStatusLabel(markupByCommentId[row.id]),
    "Source Type": ingestSourceExportLabel(row.ingest_source),
    "Source Document": row.source_document_id
      ? sourceDocumentById[row.source_document_id] ?? row.source_document_id
      : "",
    "Grounded Generated At": formatIsoDate(row.grounded_generated_at),
    "Comment Created At": formatIsoDate(row.created_at),
  }));
}

export function escapeCsvCell(value: string): string {
  const normalized = value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  return `"${normalized.replace(/"/g, '""')}"`;
}

export function recordsToCsv(records: ResponseMatrixExportRecord[]): string {
  const headerLine = RESPONSE_MATRIX_EXPORT_HEADERS.map((h) => escapeCsvCell(h)).join(",");
  const bodyLines = records.map((record) =>
    RESPONSE_MATRIX_EXPORT_HEADERS.map((header) => escapeCsvCell(record[header] ?? "")).join(","),
  );
  return [headerLine, ...bodyLines].join("\n");
}

export function downloadExportBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.style.visibility = "hidden";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function exportResponseMatrixCsv(
  records: ResponseMatrixExportRecord[],
  filename: string,
): void {
  const csv = recordsToCsv(records);
  const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8;" });
  downloadExportBlob(blob, filename);
}

export function exportResponseMatrixXlsx(
  records: ResponseMatrixExportRecord[],
  filename: string,
): void {
  const rows = [
    [...RESPONSE_MATRIX_EXPORT_HEADERS],
    ...records.map((record) =>
      RESPONSE_MATRIX_EXPORT_HEADERS.map((header) => record[header] ?? ""),
    ),
  ];

  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  worksheet["!cols"] = RESPONSE_MATRIX_EXPORT_HEADERS.map((header, colIndex) => {
    const maxCell = records.reduce((max, record) => {
      const len = String(record[header] ?? "").length;
      return Math.max(max, len);
    }, header.length);
    return { wch: Math.min(60, Math.max(12, Math.ceil(maxCell / 4) + header.length)) };
  });
  worksheet["!views"] = [{ state: "frozen", ySplit: 1, activeCell: "A2" }];

  for (let r = 1; r < rows.length; r += 1) {
    for (let c = 0; c < RESPONSE_MATRIX_EXPORT_HEADERS.length; c += 1) {
      const addr = XLSX.utils.encode_cell({ r, c });
      const cell = worksheet[addr];
      if (cell && typeof cell.v === "string" && cell.v.includes("\n")) {
        cell.s = { alignment: { wrapText: true, vertical: "top" } };
      }
    }
  }

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Response Matrix");
  XLSX.writeFile(workbook, filename);
}
