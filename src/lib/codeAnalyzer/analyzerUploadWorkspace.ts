/**
 * When to show the Code Analyzer upload / document workflow (avoid empty state during V2 handoff).
 */
import type { CodeAnalyzerIngestionJob } from "./ingestion";
import type { CodeAnalyzerSheet } from "./model";
import type { ProjectDocumentMeta } from "./documentWorkflowModel";
import { isAnalyzerWorkflowDocument } from "./documentWorkflowModel";
import { pruneUploadHandoffsForWorkflow } from "./v2UploadHandoff";

export interface UploadHandoffEntry {
  pendingId: string;
  documentId: string;
  fileName: string;
}

export function shouldShowAnalyzerUploadWorkspace(input: {
  persistedSheetCount: number;
  sessionFileCount: number;
  analyzedDocCount: number;
  uploadHandoffCount: number;
  trackedWorkflowDocumentCount: number;
  /** Set after a successful V2 upload commit — prevents empty-state flash. */
  workflowDocumentsLatch?: boolean;
}): boolean {
  return (
    Boolean(input.workflowDocumentsLatch) ||
    input.persistedSheetCount > 0 ||
    input.sessionFileCount > 0 ||
    input.analyzedDocCount > 0 ||
    input.uploadHandoffCount > 0 ||
    input.trackedWorkflowDocumentCount > 0
  );
}

export function pruneUploadHandoffs(
  handoffs: UploadHandoffEntry[],
  fetched: ProjectDocumentMeta[],
  jobs: Pick<CodeAnalyzerIngestionJob, "document_id" | "status">[],
): UploadHandoffEntry[] {
  return pruneUploadHandoffsForWorkflow(handoffs, fetched, jobs);
}

export interface NormalizedWorkflowDocuments {
  /** Persisted project_documents rows for this project (workflow-eligible only). */
  persisted: ProjectDocumentMeta[];
  /** Synthetic rows for in-flight handoffs not yet returned by PostgREST. */
  placeholders: ProjectDocumentMeta[];
  placeholderDocumentIds: Set<string>;
  /** Union used for card rendering. */
  all: ProjectDocumentMeta[];
}

/** Cards render from persisted rows plus short-lived placeholders tied to active ingestion. */
export function normalizeWorkflowDocuments(
  fetched: ProjectDocumentMeta[],
  handoffs: UploadHandoffEntry[],
): NormalizedWorkflowDocuments {
  const persisted = fetched.filter(isAnalyzerWorkflowDocument);
  const persistedIds = new Set(persisted.map((d) => d.id));
  const placeholders: ProjectDocumentMeta[] = [];
  const placeholderDocumentIds = new Set<string>();

  for (const handoff of handoffs) {
    if (persistedIds.has(handoff.documentId)) continue;
    placeholderDocumentIds.add(handoff.documentId);
    const isPdf = handoff.fileName.toLowerCase().endsWith(".pdf");
    placeholders.push({
      id: handoff.documentId,
      file_name: handoff.fileName,
      document_type: isPdf ? "specification" : "permit_drawing",
      analyzer_class: null,
      analyzer_processing_status: "queued",
    });
  }

  return {
    persisted,
    placeholders,
    placeholderDocumentIds,
    all: [...persisted, ...placeholders],
  };
}

/** @deprecated Use pruneUploadHandoffs */
export function handoffsResolvedByFetchedDocuments(
  handoffs: UploadHandoffEntry[],
  fetched: ProjectDocumentMeta[],
): UploadHandoffEntry[] {
  return pruneUploadHandoffs(handoffs, fetched, []);
}

export function collectAnalyzerWorkflowDocumentIds(documents: ProjectDocumentMeta[]): string[] {
  return documents.filter(isAnalyzerWorkflowDocument).map((d) => d.id);
}

/** Avoid wiping tracked ids when a poll returns an empty document list mid-run. */
export function reconcileTrackedWorkflowDocumentIds(
  previous: string[],
  fetched: ProjectDocumentMeta[],
  options?: { preserveWhenEmpty?: boolean; committedUploadIds?: string[] },
): string[] {
  const committed = options?.committedUploadIds ?? [];
  const next = collectAnalyzerWorkflowDocumentIds(fetched);
  const merged = [...new Set([...previous, ...next, ...committed])];
  if (next.length === 0 && merged.length > 0 && options?.preserveWhenEmpty !== false) {
    return merged;
  }
  return next.length > 0 ? next : merged;
}

/** Keep last good fetch when PostgREST briefly returns []. */
export function mergeProjectDocumentMetaFetch(
  previous: ProjectDocumentMeta[],
  fetched: ProjectDocumentMeta[],
): ProjectDocumentMeta[] {
  if (fetched.length === 0) return previous;
  return fetched;
}

/** Ensure sheet source documents appear as cards even before meta fetch hydrates. */
export function augmentWorkflowDocumentsFromSheets(
  documents: ProjectDocumentMeta[],
  sheets: CodeAnalyzerSheet[],
): ProjectDocumentMeta[] {
  const byId = new Map(documents.map((d) => [d.id, d]));
  for (const sheet of sheets) {
    const sourceId = sheet.source_document_id;
    if (!sourceId || byId.has(sourceId)) continue;
    byId.set(sourceId, {
      id: sourceId,
      file_name: sheet.file_name,
      document_type: "permit_drawing",
      analyzer_class: "drawing_set",
      analyzer_processing_status: "completed",
    });
  }
  return [...byId.values()];
}

export function workflowDatasetCounts(input: {
  normalized: NormalizedWorkflowDocuments;
  includedSheetCount: number;
  /** Unique source documents inferred from persisted sheets (floor for summary line). */
  sheetSourceDocumentCount?: number;
}): { sourceDocumentCount: number; includedSheetCount: number } {
  const fromDocs = input.normalized.all.length;
  const fromSheets = input.sheetSourceDocumentCount ?? 0;
  return {
    sourceDocumentCount: Math.max(fromDocs, fromSheets),
    includedSheetCount: input.includedSheetCount,
  };
}

export function isAsyncStandardRunInProgress(
  enabled: boolean,
  runStatus: string | null | undefined,
): boolean {
  if (!enabled) return false;
  return runStatus === "running" || runStatus === "queued";
}
