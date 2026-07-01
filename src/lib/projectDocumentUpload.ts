import { supabase } from "@/lib/supabase";
import { logProjectActivity } from "@/lib/activityLogger";
import {
  DOCUMENT_TYPE_LABELS,
  MAX_FILE_SIZE_BYTES,
  MAX_FILE_SIZE_MB,
  buildProjectDocumentStoragePath,
  formatProjectDocumentUploadError,
  resolveProjectDocumentContentType,
  type DocumentType,
  type ProjectDocument,
  type ProjectDocumentUploadResult,
  type ProjectDocumentUploadSubstep,
} from "@/types/document";

export interface ExecuteProjectDocumentUploadParams {
  userId: string;
  projectId: string;
  file: File;
  document_type: DocumentType;
  description?: string;
  parent_document_id?: string;
  version?: number;
  signal?: AbortSignal;
}

let activeUploadSubstep: ProjectDocumentUploadSubstep | null = null;

export function getActiveProjectDocumentUploadSubstep(): ProjectDocumentUploadSubstep | null {
  return activeUploadSubstep;
}

function logUploadStage(
  event: string,
  details: Record<string, string | number | boolean | undefined>,
): void {
  console.info(`[project-documents upload] ${event}`, details);
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException("Upload aborted", "AbortError");
  }
}

async function runAbortable<T>(
  signal: AbortSignal | undefined,
  run: () => Promise<T>,
): Promise<T> {
  throwIfAborted(signal);
  if (!signal) {
    return run();
  }

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      reject(new DOMException("Upload aborted", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    run()
      .then((value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      })
      .catch((error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      });
  });
}

function setActiveSubstep(substep: ProjectDocumentUploadSubstep | null): void {
  activeUploadSubstep = substep;
}

function supabaseErrorMessage(err: unknown): string {
  if (err && typeof err === "object" && "message" in err) {
    return String((err as { message?: string }).message ?? "Unknown error");
  }
  if (err instanceof Error) return err.message;
  return String(err ?? "Unknown error");
}

export async function executeProjectDocumentUpload(
  params: ExecuteProjectDocumentUploadParams,
): Promise<ProjectDocumentUploadResult> {
  const {
    userId,
    projectId,
    file,
    document_type,
    description,
    parent_document_id,
    version = 1,
    signal,
  } = params;

  const startedAt = Date.now();
  setActiveSubstep(null);

  try {
    throwIfAborted(signal);

    if (file.size > MAX_FILE_SIZE_BYTES) {
      return {
        document: null,
        step: "validation",
        error: `"${file.name}" exceeds the ${MAX_FILE_SIZE_MB}MB limit`,
      };
    }

    const contentType = resolveProjectDocumentContentType(file);
    if (!contentType) {
      return {
        document: null,
        step: "validation",
        error: `"${file.name}" is not a supported file type for project documents`,
      };
    }

    const { filePath, storageFileName, objectId } = buildProjectDocumentStoragePath(
      userId,
      projectId,
      file.name,
    );

    logUploadStage("prepared", {
      originalFileName: file.name,
      storageFileName,
      objectId,
      browserFileType: file.type || "(empty)",
      resolvedContentType: contentType,
      filePath,
      fileSizeBytes: file.size,
      document_type,
      projectId,
      upsert: false,
    });

    setActiveSubstep("file_read");
    logUploadStage("file read started", {
      filePath,
      fileSizeBytes: file.size,
    });
    await runAbortable(signal, async () => {
      await file.arrayBuffer();
    });
    logUploadStage("file read completed", {
      filePath,
      durationMs: Date.now() - startedAt,
    });

    setActiveSubstep("storage_upload");
    logUploadStage("storage upload started", {
      filePath,
      contentType,
      upsert: false,
    });

    const { error: uploadError } = await runAbortable(signal, async () =>
      supabase.storage.from("project-documents").upload(filePath, file, {
        contentType,
        upsert: false,
      }),
    );

    if (uploadError) {
      logUploadStage("storage upload failed", {
        filePath,
        error: uploadError.message,
        durationMs: Date.now() - startedAt,
      });
      return {
        document: null,
        step: "storage",
        substep: "storage_upload",
        error: formatProjectDocumentUploadError(uploadError),
      };
    }

    logUploadStage("storage upload completed", {
      filePath,
      durationMs: Date.now() - startedAt,
    });

    setActiveSubstep("database_insert");
    logUploadStage("project_documents insert started", {
      filePath,
      projectId,
    });

    const { data: newDocument, error: insertError } = await runAbortable(signal, async () =>
      supabase
        .from("project_documents")
        .insert({
          project_id: projectId,
          user_id: userId,
          file_name: file.name,
          file_path: filePath,
          file_size: file.size,
          file_type: contentType,
          document_type,
          version,
          parent_document_id: parent_document_id || null,
          description: description || null,
        })
        .select()
        .single(),
    );

    if (insertError) {
      logUploadStage("project_documents insert failed", {
        filePath,
        error: insertError.message,
        durationMs: Date.now() - startedAt,
      });
      await supabase.storage.from("project-documents").remove([filePath]);
      return {
        document: null,
        step: "database",
        substep: "database_insert",
        error: supabaseErrorMessage(insertError),
      };
    }

    logUploadStage("project_documents insert completed", {
      filePath,
      documentId: newDocument.id,
      durationMs: Date.now() - startedAt,
    });

    setActiveSubstep("activity_log");
    logUploadStage("activity log started", {
      documentId: newDocument.id,
      filePath,
    });
    const activityType = parent_document_id ? "document_version_uploaded" : "document_uploaded";
    const docTypeLabel = DOCUMENT_TYPE_LABELS[document_type];
    await runAbortable(signal, async () =>
      logProjectActivity(
        projectId,
        userId,
        activityType,
        parent_document_id
          ? `New version (v${version}) of "${file.name}" uploaded`
          : `${docTypeLabel} "${file.name}" uploaded`,
        description || undefined,
        { document_type, version, file_size: file.size },
      ),
    );
    logUploadStage("activity log completed", {
      documentId: newDocument.id,
      durationMs: Date.now() - startedAt,
    });

    logUploadStage("completed", {
      documentId: newDocument.id,
      filePath,
      durationMs: Date.now() - startedAt,
    });

    return { document: newDocument as ProjectDocument };
  } catch (err) {
    const hungSubstep = activeUploadSubstep ?? undefined;
    if (err instanceof DOMException && err.name === "AbortError") {
      logUploadStage("aborted", {
        hungSubstep,
        durationMs: Date.now() - startedAt,
      });
      return {
        document: null,
        step: hungSubstep === "database_insert" ? "database" : "storage",
        substep: hungSubstep,
        hungSubstep,
        error:
          hungSubstep === "database_insert"
            ? "Upload timed out while creating the document record"
            : "Upload timed out during storage upload",
      };
    }

    logUploadStage("unexpected error", {
      hungSubstep,
      error: supabaseErrorMessage(err),
      durationMs: Date.now() - startedAt,
    });
    return {
      document: null,
      step: hungSubstep === "database_insert" ? "database" : "storage",
      substep: hungSubstep,
      hungSubstep,
      error: formatProjectDocumentUploadError(err),
    };
  } finally {
    setActiveSubstep(null);
  }
}

export function uploadFailureMessage(result: ProjectDocumentUploadResult): string {
  if (!result.error) {
    return "Failed to save comment letter to project documents";
  }
  if (result.step === "storage") {
    return result.error.startsWith("Failed during storage upload")
      ? result.error
      : `Failed during storage upload: ${result.error}`;
  }
  if (result.step === "database") {
    return result.error.startsWith("Failed creating document record")
      ? result.error
      : `Failed creating document record: ${result.error}`;
  }
  if (result.step === "validation") {
    return `Failed to save comment letter: ${result.error}`;
  }
  if (result.step === "auth") {
    return `Failed to save comment letter: ${result.error}`;
  }
  return `Failed to save comment letter: ${result.error}`;
}

export function uploadTimeoutMessage(substep: ProjectDocumentUploadSubstep | null | undefined): string {
  if (substep === "database_insert" || substep === "activity_log") {
    return "Timed out creating document record";
  }
  return "Timed out during storage upload";
}
