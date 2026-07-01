import { supabase } from "@/lib/supabase";
import {
  formatCommentLetterSaveError,
  type ProjectDocument,
  type ProjectDocumentUploadResult,
  type ProjectDocumentUploadSubstep,
} from "@/types/document";

export interface CommentLetterPersistResult {
  docId: string | null;
  error?: string;
  uploadSubstep?: ProjectDocumentUploadSubstep;
  reusedExistingDocument?: boolean;
}

const inFlightByRowId = new Map<string, Promise<CommentLetterPersistResult>>();
const inFlightByFileKey = new Map<string, Promise<CommentLetterPersistResult>>();

/** Recent idempotency window for matching uploads of the same local file. */
const IDEMPOTENCY_WINDOW_MS = 30 * 60 * 1000;

export function buildCommentLetterUploadFileKey(projectId: string, file: File): string {
  return `${projectId}:${file.name}:${file.size}:${file.lastModified}`;
}

export function isCommentLetterUploadInFlight(fileRowId: string): boolean {
  return inFlightByRowId.has(fileRowId);
}

export function isCommentLetterUploadInFlightForFile(
  projectId: string,
  file: File,
): boolean {
  return inFlightByFileKey.has(buildCommentLetterUploadFileKey(projectId, file));
}

function logUploadInFlight(
  event: string,
  details: Record<string, string | number | boolean | undefined>,
): void {
  console.info(`[comment-review upload-inflight] ${event}`, details);
}

export async function findExistingCommentLetterDocument(
  projectId: string,
  file: File,
): Promise<ProjectDocument | null> {
  const { data, error } = await supabase
    .from("project_documents")
    .select("id, project_id, file_name, file_size, file_path, created_at, description, document_type")
    .eq("project_id", projectId)
    .eq("file_name", file.name)
    .eq("file_size", file.size)
    .eq("document_type", "correspondence")
    .order("created_at", { ascending: false })
    .limit(10);

  if (error) {
    console.warn("[comment-review upload-inflight] idempotency lookup failed", error.message);
    return null;
  }

  const cutoff = Date.now() - IDEMPOTENCY_WINDOW_MS;
  const candidates = ((data ?? []) as ProjectDocument[]).filter(
    (row) =>
      row.description?.includes("Manual comment letter upload") &&
      new Date(row.created_at).getTime() >= cutoff,
  );

  return candidates[0] ?? null;
}

export function runDedupedCommentLetterUpload(options: {
  fileRowId: string;
  jobId: string;
  projectId: string;
  file: File;
  upload: () => Promise<ProjectDocumentUploadResult>;
}): Promise<CommentLetterPersistResult> {
  const { fileRowId, jobId, projectId, file, upload } = options;
  const fileKey = buildCommentLetterUploadFileKey(projectId, file);

  const existingRowPromise = inFlightByRowId.get(fileRowId);
  if (existingRowPromise) {
    logUploadInFlight("reusing in-flight upload by row id", { fileRowId, jobId, fileKey });
    return existingRowPromise;
  }

  const existingFilePromise = inFlightByFileKey.get(fileKey);
  if (existingFilePromise) {
    logUploadInFlight("reusing in-flight upload by file key", { fileRowId, jobId, fileKey });
    inFlightByRowId.set(fileRowId, existingFilePromise);
    return existingFilePromise;
  }

  const promise = (async (): Promise<CommentLetterPersistResult> => {
    const existingDocument = await findExistingCommentLetterDocument(projectId, file);
    if (existingDocument?.id) {
      logUploadInFlight("reused existing project_documents row", {
        fileRowId,
        jobId,
        fileKey,
        documentId: existingDocument.id,
      });
      return {
        docId: existingDocument.id,
        reusedExistingDocument: true,
      };
    }

    const result = await upload();
    if (result.document?.id) {
      return { docId: result.document.id };
    }

    return {
      docId: null,
      error: formatCommentLetterSaveError(result),
      uploadSubstep: result.hungSubstep ?? result.substep,
    };
  })().finally(() => {
    inFlightByRowId.delete(fileRowId);
    inFlightByFileKey.delete(fileKey);
    logUploadInFlight("in-flight upload cleared", { fileRowId, jobId, fileKey });
  });

  inFlightByRowId.set(fileRowId, promise);
  inFlightByFileKey.set(fileKey, promise);
  logUploadInFlight("upload registered in-flight", { fileRowId, jobId, fileKey });

  return promise;
}
