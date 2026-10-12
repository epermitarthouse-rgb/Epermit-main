/**
 * V2 upload path: source PDF only + durable ingestion enqueue (no browser rasterization).
 */
import type { CodeAnalyzerSheet } from "./model";
import type { DrawingUploadProgress } from "./uploadBatchProgress";
import { isPdfFile } from "./model";
import { computeFileContentHash } from "./contentHash";
import {
  enqueueCodeAnalyzerIngestion,
  updateDocumentContentHash,
  type CodeAnalyzerIngestionJob,
} from "./ingestion";
import type { PersistPendingFailedSource, PersistPendingUploadDocument, PersistPendingSourceFile } from "./persistPending";

export interface PersistPendingAsyncV2Result {
  sheets: CodeAnalyzerSheet[];
  warnings: string[];
  failedSources: PersistPendingFailedSource[];
  ingestionJobs: Array<{ pendingId: string; job: CodeAnalyzerIngestionJob; documentId: string }>;
}

export async function persistPendingAnalyzerSourcesAsyncV2(params: {
  projectId: string;
  userId: string;
  pendingFiles: PersistPendingSourceFile[];
  uploadDocument: PersistPendingUploadDocument;
  onUploadProgress?: (progress: DrawingUploadProgress) => void;
}): Promise<PersistPendingAsyncV2Result> {
  const warnings: string[] = [];
  const failedSources: PersistPendingFailedSource[] = [];
  const ingestionJobs: PersistPendingAsyncV2Result["ingestionJobs"] = [];
  const totalSources = params.pendingFiles.length;
  let completedSources = 0;

  const emitProgress = (patch: Partial<DrawingUploadProgress>) => {
    params.onUploadProgress?.({
      total: totalSources,
      completed: completedSources,
      currentIndex: Math.min(completedSources + 1, Math.max(totalSources, 1)),
      phase: completedSources >= totalSources ? "complete" : "uploading",
      ...patch,
    });
  };

  if (totalSources > 0) {
    emitProgress({ currentFileName: params.pendingFiles[0]?.file.name });
  }

  for (let sourceIndex = 0; sourceIndex < params.pendingFiles.length; sourceIndex++) {
    const pending = params.pendingFiles[sourceIndex];
    emitProgress({
      currentIndex: sourceIndex + 1,
      currentFileName: pending.file.name,
      pdfProcessing: isPdfFile(pending.file)
        ? { fileName: pending.file.name, serverSide: true }
        : undefined,
    });

    try {
      const contentHash = await computeFileContentHash(pending.file);
      const isPdf = isPdfFile(pending.file);
      const sourceDoc = await params.uploadDocument({
        file: pending.file,
        document_type: isPdf ? "specification" : "permit_drawing",
        description: isPdf
          ? "AI Code Analyzer source document (PDF, server-side ingestion)"
          : "AI Code Analyzer source drawing",
      });

      if (!sourceDoc) throw new Error(`Failed to upload ${pending.file.name}`);

      await updateDocumentContentHash(sourceDoc.id, contentHash);

      const { job, reusedExisting } = await enqueueCodeAnalyzerIngestion({
        projectId: params.projectId,
        documentId: sourceDoc.id,
        userId: params.userId,
        contentFingerprint: contentHash,
      });

      if (reusedExisting) {
        warnings.push(`${pending.file.name}: reusing active ingestion job.`);
      }

      ingestionJobs.push({ pendingId: pending.id, job, documentId: sourceDoc.id });
    } catch (err) {
      failedSources.push({
        id: pending.id,
        fileName: pending.file.name,
        error: err instanceof Error ? err.message : `Failed to upload ${pending.file.name}`,
      });
    } finally {
      completedSources += 1;
      emitProgress({
        completed: completedSources,
        currentIndex: Math.min(completedSources + 1, totalSources),
        currentFileName:
          completedSources < totalSources
            ? params.pendingFiles[completedSources]?.file.name
            : undefined,
        pdfProcessing: undefined,
        phase: completedSources >= totalSources ? "complete" : "uploading",
      });
    }
  }

  return { sheets: [], warnings, failedSources, ingestionJobs };
}
