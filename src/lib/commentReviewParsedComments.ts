import { supabase } from "@/lib/supabase";
import { isManualCommentLetter } from "@/lib/commentReviewManualLetter";
import type { ProjectDocument } from "@/types/document";

export interface CommentReviewParsedCommentRow {
  id: string;
  project_id: string;
  original_text: string;
  discipline: string | null;
  code_reference: string | null;
  status: string;
  page_number: number | null;
  ingest_source: "raw_ref" | "fallback_llm" | "manual_letter" | null;
  source_document_id?: string | null;
  previous_comment_text?: string | null;
  existing_response_text?: string | null;
  code_references?: string[] | string | null;
  reviewer_name?: string | null;
  comment_number?: string | null;
}

export interface ManualCommentLetterDocument {
  id: string;
  project_id: string;
  file_name: string;
  document_type: string;
  description: string | null;
}

export interface OrphanedManualLetterComment {
  id: string;
  source_document_id: string | null;
  reason: "missing_document" | "null_source_document";
  original_text_preview: string;
}

export interface OrphanedManualLetterAudit {
  projectId: string;
  validManualLetterDocumentIds: string[];
  orphanedRows: OrphanedManualLetterComment[];
}

const PARSED_COMMENT_SELECT =
  "id, project_id, original_text, discipline, code_reference, status, page_number, ingest_source, source_document_id, previous_comment_text, existing_response_text, code_references, reviewer_name, comment_number";

export async function fetchManualCommentLetterDocuments(
  projectId: string,
): Promise<ManualCommentLetterDocument[]> {
  const { data, error } = await supabase
    .from("project_documents")
    .select("id, project_id, file_name, document_type, description")
    .eq("project_id", projectId);

  if (error) throw error;

  return ((data ?? []) as ManualCommentLetterDocument[]).filter((doc) =>
    isManualCommentLetter(doc as Pick<ProjectDocument, "document_type" | "description">),
  );
}

export function buildValidManualLetterDocumentIdSet(
  documents: ManualCommentLetterDocument[],
): Set<string> {
  return new Set(documents.map((doc) => doc.id));
}

export function isUploadedManualLetterComment(
  row: Pick<CommentReviewParsedCommentRow, "ingest_source" | "source_document_id">,
): boolean {
  return row.ingest_source === "manual_letter";
}

export function isLinkedManualLetterComment(
  row: Pick<CommentReviewParsedCommentRow, "ingest_source" | "source_document_id">,
  validManualLetterDocumentIds: Set<string>,
): boolean {
  if (!isUploadedManualLetterComment(row)) return true;
  if (!row.source_document_id) return false;
  return validManualLetterDocumentIds.has(row.source_document_id);
}

export function filterCommentReviewLoadedComments<T extends CommentReviewParsedCommentRow>(
  rows: T[],
  validManualLetterDocumentIds: Set<string>,
): T[] {
  return rows.filter((row) => isLinkedManualLetterComment(row, validManualLetterDocumentIds));
}

export function findOrphanedManualLetterComments(
  rows: CommentReviewParsedCommentRow[],
  validManualLetterDocumentIds: Set<string>,
): OrphanedManualLetterComment[] {
  const orphans: OrphanedManualLetterComment[] = [];

  for (const row of rows) {
    if (row.ingest_source !== "manual_letter") continue;

    if (!row.source_document_id) {
      orphans.push({
        id: row.id,
        source_document_id: null,
        reason: "null_source_document",
        original_text_preview: (row.original_text ?? "").slice(0, 80),
      });
      continue;
    }

    if (!validManualLetterDocumentIds.has(row.source_document_id)) {
      orphans.push({
        id: row.id,
        source_document_id: row.source_document_id,
        reason: "missing_document",
        original_text_preview: (row.original_text ?? "").slice(0, 80),
      });
    }
  }

  return orphans;
}

export async function auditOrphanedManualLetterComments(
  projectId: string,
): Promise<OrphanedManualLetterAudit> {
  const [{ data: rows, error: rowsError }, manualLetterDocuments] = await Promise.all([
    supabase
      .from("parsed_comments")
      .select(`${PARSED_COMMENT_SELECT}, created_at`)
      .eq("project_id", projectId)
      .eq("ingest_source", "manual_letter")
      .order("created_at", { ascending: true }),
    fetchManualCommentLetterDocuments(projectId),
  ]);

  if (rowsError) throw rowsError;

  const validManualLetterDocumentIds = buildValidManualLetterDocumentIdSet(manualLetterDocuments);
  const orphanedRows = findOrphanedManualLetterComments(
    (rows ?? []) as CommentReviewParsedCommentRow[],
    validManualLetterDocumentIds,
  );

  return {
    projectId,
    validManualLetterDocumentIds: [...validManualLetterDocumentIds],
    orphanedRows,
  };
}

export async function deleteOrphanedManualLetterComments(
  projectId: string,
  orphanIds: string[],
): Promise<number> {
  if (orphanIds.length === 0) return 0;

  const { error, count } = await supabase
    .from("parsed_comments")
    .delete({ count: "exact" })
    .eq("project_id", projectId)
    .eq("ingest_source", "manual_letter")
    .in("id", orphanIds);

  if (error) throw error;
  return count ?? 0;
}

export async function fetchCommentReviewParsedComments(
  projectId: string,
): Promise<CommentReviewParsedCommentRow[]> {
  const [{ data, error }, manualLetterDocuments] = await Promise.all([
    supabase
      .from("parsed_comments")
      .select(PARSED_COMMENT_SELECT)
      .eq("project_id", projectId)
      .order("created_at", { ascending: true }),
    fetchManualCommentLetterDocuments(projectId),
  ]);

  if (error) throw error;

  const validManualLetterDocumentIds = buildValidManualLetterDocumentIdSet(manualLetterDocuments);
  return filterCommentReviewLoadedComments(
    (data ?? []) as CommentReviewParsedCommentRow[],
    validManualLetterDocumentIds,
  );
}

export async function deleteManualLetterCommentsForDocument(
  projectId: string,
  sourceDocumentId: string,
): Promise<number> {
  const { error, count } = await supabase
    .from("parsed_comments")
    .delete({ count: "exact" })
    .eq("project_id", projectId)
    .eq("ingest_source", "manual_letter")
    .eq("source_document_id", sourceDocumentId);

  if (error) throw error;
  return count ?? 0;
}

export async function countManualLetterCommentsForDocument(
  projectId: string,
  sourceDocumentId: string,
): Promise<number> {
  const { count, error } = await supabase
    .from("parsed_comments")
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId)
    .eq("ingest_source", "manual_letter")
    .eq("source_document_id", sourceDocumentId);

  if (error) throw error;
  return count ?? 0;
}

export function uploadRowRequiresSourceDocument(row: {
  row_source: string;
  _sourceDocumentId?: string | null;
  source_file?: string | null;
}): boolean {
  return row.row_source === "parsed" && Boolean(row.source_file?.trim());
}
