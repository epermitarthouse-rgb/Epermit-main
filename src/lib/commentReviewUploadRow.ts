export const COMMENT_REVIEW_DISCIPLINES = [
  "Architecture",
  "MEP",
  "Structural",
  "Zoning",
  "Fire",
  "DOEE",
  "Energy",
] as const;

export type UploadRowSource = "parsed" | "manual";

export interface ParsedRow {
  original_text: string;
  discipline: string;
  code_reference: string | null;
  reviewer_name?: string | null;
  comment_number?: string | null;
  previous_comment_text?: string | null;
  existing_response_text?: string | null;
  code_references?: string[];
  source_page?: number | null;
  source_file?: string | null;
  confidence?: number;
  row_source: UploadRowSource;
  source_label?: string | null;
  _clientId: string;
  /** Set when a row was hydrated from an already-saved parsed_comments record. */
  _savedCommentId?: string | null;
  /** Set when a row was parsed from a batch upload with its own project_documents record. */
  _sourceDocumentId?: string | null;
}

export interface SavedCommentRowInput {
  id: string;
  original_text: string;
  discipline: string | null;
  code_reference: string | null;
  page_number: number | null;
  reviewer_name?: string | null;
  comment_number?: string | null;
  previous_comment_text?: string | null;
  existing_response_text?: string | null;
  code_references?: string[] | string | null;
}

export interface ManualCommentFormValues {
  discipline: string;
  reviewer_name: string;
  comment_number: string;
  original_text: string;
  previous_comment_text: string;
  existing_response_text: string;
  code_reference: string;
  code_references: string;
  source_label: string;
}

export function newUploadRowClientId(): string {
  return crypto.randomUUID();
}

export function emptyManualCommentForm(): ManualCommentFormValues {
  return {
    discipline: "Architecture",
    reviewer_name: "",
    comment_number: "",
    original_text: "",
    previous_comment_text: "",
    existing_response_text: "",
    code_reference: "",
    code_references: "",
    source_label: "",
  };
}

export const PASTED_COMMENTS_SOURCE_LABEL = "Pasted comments";

export function markRowsAsParsed(
  rows: Array<Omit<ParsedRow, "row_source" | "_clientId">>,
  options?: { sourceLabel?: string | null },
): ParsedRow[] {
  const sourceLabel = options?.sourceLabel?.trim() || null;
  return rows.map((row) => ({
    ...row,
    row_source: "parsed",
    source_label: row.source_label?.trim() || sourceLabel,
    _clientId: newUploadRowClientId(),
  }));
}

export function createPastedSingleCommentRow(options: {
  text: string;
  discipline?: string;
  sourceLabel?: string;
}): ParsedRow {
  const text = options.text.trim();
  return {
    _clientId: newUploadRowClientId(),
    row_source: "manual",
    original_text: text,
    discipline: options.discipline?.trim() || "Architecture",
    code_reference: null,
    source_label: options.sourceLabel?.trim() || PASTED_COMMENTS_SOURCE_LABEL,
  };
}

export function parsedRowToFormValues(row: ParsedRow): ManualCommentFormValues {
  return {
    discipline: row.discipline || "Architecture",
    reviewer_name: row.reviewer_name ?? "",
    comment_number: row.comment_number ?? "",
    original_text: row.original_text ?? "",
    previous_comment_text: row.previous_comment_text ?? "",
    existing_response_text: row.existing_response_text ?? "",
    code_reference: row.code_reference ?? "",
    code_references: row.code_references?.join(", ") ?? "",
    source_label: row.source_label ?? "",
  };
}

function parseCodeReferencesInput(raw: string): string[] {
  return raw
    .split(/[,;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function formValuesToParsedRow(
  values: ManualCommentFormValues,
  options: { row_source: UploadRowSource; existing?: ParsedRow },
): ParsedRow {
  const codeRefs = parseCodeReferencesInput(values.code_references);
  const primaryCode = values.code_reference.trim() || codeRefs[0] || null;

  return {
    _clientId: options.existing?._clientId ?? newUploadRowClientId(),
    _savedCommentId: options.existing?._savedCommentId ?? null,
    row_source: options.row_source,
    discipline: values.discipline,
    reviewer_name: values.reviewer_name.trim() || null,
    comment_number: values.comment_number.trim() || null,
    original_text: values.original_text.trim(),
    previous_comment_text: values.previous_comment_text.trim() || null,
    existing_response_text: values.existing_response_text.trim() || null,
    code_reference: primaryCode,
    code_references: codeRefs.length > 0 ? codeRefs : undefined,
    source_label: values.source_label.trim() || null,
    source_page: options.existing?.source_page ?? null,
    source_file: options.existing?.source_file ?? null,
    confidence: options.existing?.confidence,
  };
}

export function parseStoredCodeReferences(value: unknown): string[] | undefined {
  if (value == null || value === "") return undefined;
  if (Array.isArray(value)) {
    const refs = value.map(String).map((s) => s.trim()).filter(Boolean);
    return refs.length > 0 ? refs : undefined;
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (Array.isArray(parsed)) {
        const refs = parsed.map(String).map((s) => s.trim()).filter(Boolean);
        return refs.length > 0 ? refs : undefined;
      }
    } catch {
      const refs = value
        .split(/[,;\n]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      return refs.length > 0 ? refs : undefined;
    }
  }
  return undefined;
}

export function savedCommentToUploadRow(row: SavedCommentRowInput): ParsedRow {
  const codeRefs = parseStoredCodeReferences(row.code_references);
  return {
    _clientId: `saved-${row.id}`,
    _savedCommentId: row.id,
    row_source: "parsed",
    original_text: row.original_text ?? "",
    discipline: row.discipline?.trim() || "Architecture",
    code_reference: row.code_reference ?? null,
    reviewer_name: row.reviewer_name ?? null,
    comment_number: row.comment_number ?? null,
    previous_comment_text: row.previous_comment_text ?? null,
    existing_response_text: row.existing_response_text ?? null,
    code_references: codeRefs,
    source_page: row.page_number ?? null,
    source_file: null,
    source_label: null,
  };
}

export function uploadRowSourceLabel(row: ParsedRow): string {
  return row.row_source === "manual" ? "Manual" : "Parsed";
}

export function uploadRowCommentPreview(row: ParsedRow): string {
  return (
    row.original_text?.trim() ||
    row.previous_comment_text?.trim() ||
    "—"
  );
}
