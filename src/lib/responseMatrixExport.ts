import { format } from "date-fns";
import * as XLSX from "xlsx";
import { parseStoredCodeReferences } from "@/lib/groundedCommentContext";
import { exportResponseApprovalLabel, formatResponseForExport } from "@/lib/responseApproval";

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
  grounded_evidence?: ResponseMatrixExportEvidence[] | string | null;
  required_action?: string | null;
  missing_info_or_risk?: string | null;
  grounded_confidence?: string | null;
  grounded_generated_at?: string | null;
  response_status?: string | null;
  ai_generated_response_text?: string | null;
  approved_at?: string | null;
  approved_by?: string | null;
  change_request_note?: string | null;
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
  "Response Approval Status",
  "Change Request Note",
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

/** Coerce any value to a safe export string. Never throws. */
export function safeText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    return value.map((item) => safeText(item)).filter(Boolean).join("; ");
  }
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return "";
    }
  }
  return "";
}

export function formatConfidence(value: unknown): string {
  return safeText(value);
}

export function normalizeGroundedEvidence(
  raw: unknown,
): ResponseMatrixExportEvidence[] {
  if (raw == null || raw === "") return [];

  let parsed: unknown = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return [];
    }
  }

  if (!Array.isArray(parsed)) return [];

  return parsed
    .filter((item) => item && typeof item === "object")
    .map((item) => item as ResponseMatrixExportEvidence);
}

export function ingestSourceExportLabel(source: unknown): string {
  const text = safeText(source);
  if (text === "manual_letter") return "Manual uploaded comments";
  if (text === "raw_ref") return "Portal comments";
  if (text === "fallback_llm") return "Parsed comment letter (LLM fallback)";
  return text;
}

export function formatEvidenceCitations(evidence: unknown): string {
  const items = normalizeGroundedEvidence(evidence);
  if (items.length === 0) return "";

  return items
    .map((item, index) => {
      const lines = [`Citation ${index + 1}:`];
      const fileName = safeText(item.file_name);
      if (fileName) lines.push(`File: ${fileName}`);
      if (item.page_number != null) lines.push(`Page: ${item.page_number}`);
      const sheetLabel = safeText(item.sheet_label);
      if (sheetLabel) lines.push(`Sheet: ${sheetLabel}`);
      const sheetTitle = safeText(item.sheet_title);
      if (sheetTitle) lines.push(`Title: ${sheetTitle}`);
      const snippet = safeText(item.snippet);
      if (snippet) lines.push(`Snippet: ${snippet}`);
      const relevance = safeText(item.relevance);
      if (relevance) lines.push(`Relevance: ${relevance}`);
      return lines.join("\n");
    })
    .join("\n\n");
}

export function formatCodeReferences(row: ResponseMatrixExportComment): string {
  const refs = parseStoredCodeReferences(row.code_references);
  const primary = safeText(row.code_reference);
  const all = [...new Set([primary, ...refs].filter(Boolean))];
  return all.join("; ");
}

function formatIsoDate(value: unknown): string {
  const text = safeText(value);
  if (!text) return "";
  try {
    return format(new Date(text), "yyyy-MM-dd HH:mm");
  } catch {
    return text;
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

function emptyExportRecord(project: ResponseMatrixProjectMeta): ResponseMatrixExportRecord {
  return RESPONSE_MATRIX_EXPORT_HEADERS.reduce((acc, header) => {
    if (header === "Project Name") acc[header] = project.name;
    else if (header === "Permit Number") acc[header] = project.permit_number ?? "";
    else if (header === "Jurisdiction") acc[header] = project.jurisdiction ?? "";
    else acc[header] = "";
    return acc;
  }, {} as ResponseMatrixExportRecord);
}

export function flattenExportRow(
  row: ResponseMatrixExportComment,
  project: ResponseMatrixProjectMeta,
  markupByCommentId: Record<string, string>,
  sourceDocumentById: Record<string, string>,
): ResponseMatrixExportRecord {
  try {
    return {
      "Project Name": project.name,
      "Permit Number": project.permit_number ?? "",
      Jurisdiction: project.jurisdiction ?? "",
      Status: safeText(row.status),
      Discipline: safeText(row.discipline),
      "Reviewer Name": safeText(row.reviewer_name),
      "Comment Number": safeText(row.comment_number),
      "City / Reviewer Comment": safeText(row.original_text),
      "Previous Reviewer Comment": safeText(row.previous_comment_text),
      "Existing Response Text": safeText(row.existing_response_text),
      "Code Reference": formatCodeReferences(row),
      "Suggested Response": formatResponseForExport(row),
      "Response Approval Status": exportResponseApprovalLabel(row),
      "Change Request Note": safeText(row.change_request_note),
      "Required Action": safeText(row.required_action),
      "Missing Info / Risk": safeText(row.missing_info_or_risk),
      Confidence: formatConfidence(row.grounded_confidence),
      "Sheet Reference": safeText(row.sheet_reference),
      "Evidence Citations": formatEvidenceCitations(row.grounded_evidence),
      "Assigned To": safeText(row.assigned_to),
      Markup: markupStatusLabel(markupByCommentId[row.id]),
      "Source Type": ingestSourceExportLabel(row.ingest_source),
      "Source Document": row.source_document_id
        ? sourceDocumentById[row.source_document_id] ?? safeText(row.source_document_id)
        : "",
      "Grounded Generated At": formatIsoDate(row.grounded_generated_at),
      "Comment Created At": formatIsoDate(row.created_at),
    };
  } catch (error) {
    console.warn("[ResponseMatrixExport] Skipped malformed row:", row.id, error);
    const fallback = emptyExportRecord(project);
    fallback["City / Reviewer Comment"] = safeText(row.original_text) || `[Export error for comment ${row.id}]`;
    return fallback;
  }
}

export function buildResponseMatrixExportRecords(
  rows: ResponseMatrixExportComment[],
  project: ResponseMatrixProjectMeta,
  markupByCommentId: Record<string, string>,
  sourceDocumentById: Record<string, string>,
): ResponseMatrixExportRecord[] {
  return rows.map((row) =>
    flattenExportRow(row, project, markupByCommentId, sourceDocumentById),
  );
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
      RESPONSE_MATRIX_EXPORT_HEADERS.map((header) => safeText(record[header])),
    ),
  ];

  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  worksheet["!cols"] = RESPONSE_MATRIX_EXPORT_HEADERS.map((header) => {
    const maxCell = records.reduce((max, record) => {
      const len = safeText(record[header]).length;
      return Math.max(max, len);
    }, header.length);
    return { wch: Math.min(60, Math.max(12, Math.ceil(maxCell / 4) + header.length)) };
  });
  worksheet["!views"] = [{ state: "frozen", ySplit: 1, activeCell: "A2" }];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Response Matrix");
  XLSX.writeFile(workbook, filename);
}

export const EXPORT_BATCH_SIZE = 150;

export function chunkArray<T>(items: T[], size: number): T[][] {
  if (items.length === 0) return [];
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}
