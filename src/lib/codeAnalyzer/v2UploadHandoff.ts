/**
 * Commit V2 upload → ingestion handoff state (single place for UI continuity).
 */
import type { CodeAnalyzerIngestionJob } from "./ingestion";
import type { ProjectDocumentMeta } from "./documentWorkflowModel";
import { isAnalyzerWorkflowDocument } from "./documentWorkflowModel";
import type { UploadHandoffEntry } from "./analyzerUploadWorkspace";
import { collectAnalyzerWorkflowDocumentIds } from "./analyzerUploadWorkspace";

export interface V2IngestionEnqueueResult {
  pendingId: string;
  documentId: string;
  job: CodeAnalyzerIngestionJob;
}

export function buildUploadHandoffsFromEnqueues(
  enqueues: V2IngestionEnqueueResult[],
  pendingFileNameById: Map<string, string>,
): UploadHandoffEntry[] {
  return enqueues.map((entry) => ({
    pendingId: entry.pendingId,
    documentId: entry.documentId,
    fileName: pendingFileNameById.get(entry.pendingId) ?? "Uploaded document",
  }));
}

/** Jobs that were actually inserted (or reused while still active). */
export function countVerifiedIngestionEnqueues(enqueues: V2IngestionEnqueueResult[]): number {
  return enqueues.filter(
    (e) =>
      Boolean(e.job?.id) &&
      (e.job.status === "pending" || e.job.status === "processing" || e.job.status === "completed"),
  ).length;
}

export function mergeTrackedWorkflowDocumentIds(
  previous: string[],
  fetched: ProjectDocumentMeta[],
  committedUploadIds: string[],
): string[] {
  const fromFetch = collectAnalyzerWorkflowDocumentIds(fetched);
  const merged = [...new Set([...previous, ...fromFetch, ...committedUploadIds])];
  if (fromFetch.length === 0) return merged;
  return fromFetch;
}

/** Rows the consolidated card UI can render (parent hydrate + child fetch). */
export function workflowUiDocumentIds(documents: ProjectDocumentMeta[]): Set<string> {
  return new Set(documents.filter(isAnalyzerWorkflowDocument).map((d) => d.id));
}

export function buildOptimisticWorkflowDocumentsFromEnqueues(
  enqueues: V2IngestionEnqueueResult[],
  pendingFileNameById: Map<string, string>,
): ProjectDocumentMeta[] {
  return enqueues.map((entry) => {
    const fileName = pendingFileNameById.get(entry.pendingId) ?? "Uploaded document";
    const isPdf = fileName.toLowerCase().endsWith(".pdf");
    return {
      id: entry.documentId,
      file_name: fileName,
      document_type: isPdf ? "specification" : "permit_drawing",
      analyzer_class: entry.job.analyzer_class ?? null,
      analyzer_processing_status: "queued",
    };
  });
}

export function pruneUploadHandoffsForWorkflow(
  handoffs: UploadHandoffEntry[],
  uiHydratedDocuments: ProjectDocumentMeta[],
  jobs: Pick<CodeAnalyzerIngestionJob, "document_id" | "status">[],
): UploadHandoffEntry[] {
  if (handoffs.length === 0) return handoffs;
  const workflowFetchedIds = workflowUiDocumentIds(uiHydratedDocuments);
  const activeJobDocIds = new Set(
    jobs
      .filter((j) => j.status === "pending" || j.status === "processing")
      .map((j) => j.document_id),
  );

  return handoffs.filter((h) => {
    if (workflowFetchedIds.has(h.documentId)) return false;
    return activeJobDocIds.has(h.documentId);
  });
}

export function isWorkflowOrganizing(
  jobs: Pick<CodeAnalyzerIngestionJob, "status">[],
  documents: Pick<{ analyzer_processing_status: string | null }, "analyzer_processing_status">[],
  uploadHandoffCount: number,
): boolean {
  if (uploadHandoffCount > 0) return true;
  if (jobs.some((j) => j.status === "pending" || j.status === "processing")) return true;
  return documents.some(
    (d) =>
      d.analyzer_processing_status === "queued" || d.analyzer_processing_status === "processing",
  );
}
