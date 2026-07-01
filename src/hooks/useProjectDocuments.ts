import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import {
  ProjectDocument,
  DocumentType,
  formatProjectDocumentUploadError,
  type DocumentIngestionJob,
  type IngestionProgressInfo,
  type ProjectDocumentUploadResult,
} from '@/types/document';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import { logProjectActivity } from '@/lib/activityLogger';
import {
  isActiveDocumentStatus,
  isActiveJobStatus,
  isTerminalDocumentStatus,
  jobToProgressInfo,
  parseIngestInvokeError,
} from '@/utils/documentIngestionUi';
import { executeProjectDocumentUpload } from '@/lib/projectDocumentUpload';

export interface UploadDocumentData {
  file: File;
  document_type: DocumentType;
  description?: string;
  parent_document_id?: string;
  /** When true, caller handles success/error toasts (e.g. Comment Review parse flow). */
  suppressToasts?: boolean;
  signal?: AbortSignal;
}

const TERMINAL_JOB_STATUSES = new Set(['completed', 'failed', 'partial', 'cancelled']);
const POLL_INTERVAL_MS = 2500;

const DOCUMENT_SELECT =
  'id, project_id, user_id, file_name, file_path, file_size, file_type, document_type, description, version, parent_document_id, created_at, updated_at, ai_ingestion_status, ai_ingested_at, ai_ingestion_error, ai_chunk_count';

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function useProjectDocuments(projectId: string | null) {
  const { user } = useAuth();
  const [documents, setDocuments] = useState<ProjectDocument[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [preparingId, setPreparingId] = useState<string | null>(null);
  const [ingestionProgress, setIngestionProgress] = useState<Record<string, IngestionProgressInfo>>({});
  const [error, setError] = useState<string | null>(null);

  const pollAbortRef = useRef(false);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const userInitiatedPrepRef = useRef<Set<string>>(new Set());

  const syncLatestIngestionJobs = useCallback(
    async (documentIds: string[]): Promise<Map<string, DocumentIngestionJob>> => {
      if (!projectId || documentIds.length === 0) {
        return new Map();
      }

      const { data: jobs, error: jobsError } = await supabase
        .from('document_ingestion_jobs')
        .select('*')
        .eq('project_id', projectId)
        .in('document_id', documentIds)
        .order('created_at', { ascending: false });

      if (jobsError) {
        console.warn('Failed to fetch ingestion jobs:', jobsError.message);
        return new Map();
      }

      const latestByDoc = new Map<string, DocumentIngestionJob>();
      for (const job of (jobs ?? []) as DocumentIngestionJob[]) {
        if (!latestByDoc.has(job.document_id)) {
          latestByDoc.set(job.document_id, job);
        }
      }

      setIngestionProgress((prev) => {
        const next = { ...prev };

        for (const docId of documentIds) {
          const job = latestByDoc.get(docId);
          if (!job) continue;

          if (isActiveJobStatus(job.status)) {
            next[docId] = jobToProgressInfo(job);
          } else if (prev[docId]?.jobId === job.id) {
            delete next[docId];
          }
        }

        return next;
      });

      return latestByDoc;
    },
    [projectId],
  );

  const fetchDocuments = useCallback(
    async (options?: { silent?: boolean }) => {
      if (!user || !projectId) {
        setDocuments([]);
        return [];
      }

      if (!options?.silent) {
        setLoading(true);
      }
      setError(null);

      try {
        const { data, error: fetchError } = await supabase
          .from('project_documents')
          .select(DOCUMENT_SELECT)
          .eq('project_id', projectId)
          .order('created_at', { ascending: false });

        if (fetchError) throw fetchError;

        const docs = (data as ProjectDocument[]) || [];
        setDocuments(docs);

        const docIds = docs.map((d) => d.id);
        await syncLatestIngestionJobs(docIds);

        return docs;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to fetch documents';
        setError(message);
        console.error('Error fetching documents:', err);
        return [];
      } finally {
        if (!options?.silent) {
          setLoading(false);
        }
      }
    },
    [user, projectId, syncLatestIngestionJobs],
  );

  useEffect(() => {
    void fetchDocuments();
  }, [fetchDocuments]);

  useEffect(() => {
    pollAbortRef.current = false;
    return () => {
      pollAbortRef.current = true;
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, [projectId]);

  const stopBackgroundPoll = useCallback(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  }, []);

  const runBackgroundPollTick = useCallback(async () => {
    if (pollAbortRef.current || !user || !projectId) return;

    const docs = await fetchDocuments({ silent: true });
    const docIds = docs.map((d) => d.id);
    const latestJobs = await syncLatestIngestionJobs(docIds);

    const stillActive =
      docs.some((d) => isActiveDocumentStatus(d.ai_ingestion_status)) ||
      [...latestJobs.values()].some((j) => isActiveJobStatus(j.status));

    if (!stillActive) {
      stopBackgroundPoll();

      for (const docId of userInitiatedPrepRef.current) {
        const doc = docs.find((d) => d.id === docId);
        if (!doc || !isTerminalDocumentStatus(doc.ai_ingestion_status)) continue;

        const job = latestJobs.get(docId);
        const chunkCount = doc.ai_chunk_count ?? job?.total_chunks ?? 0;

        if (doc.ai_ingestion_status === 'completed') {
          toast.success(`Document prepared for AI (${chunkCount} chunks)`);
        } else if (doc.ai_ingestion_status === 'partial') {
          toast.warning(
            doc.ai_ingestion_error ?? 'Document partially prepared — some pages may need OCR',
          );
        } else if (doc.ai_ingestion_status === 'low_text') {
          toast.warning(doc.ai_ingestion_error ?? 'Very little text extracted — OCR may be needed');
        } else if (doc.ai_ingestion_status === 'failed') {
          toast.error(job?.error ?? doc.ai_ingestion_error ?? 'Ingestion failed');
        }

        userInitiatedPrepRef.current.delete(docId);
      }
    }
  }, [user, projectId, fetchDocuments, syncLatestIngestionJobs, stopBackgroundPoll]);

  const ensureBackgroundPoll = useCallback(() => {
    if (pollIntervalRef.current) return;
    void runBackgroundPollTick();
    pollIntervalRef.current = setInterval(() => {
      void runBackgroundPollTick();
    }, POLL_INTERVAL_MS);
  }, [runBackgroundPollTick]);

  useEffect(() => {
    if (!user || !projectId) return;

    const hasActiveDocs = documents.some((d) => isActiveDocumentStatus(d.ai_ingestion_status));
    const hasActiveProgress = Object.values(ingestionProgress).some((p) =>
      isActiveJobStatus(p.status),
    );

    if (hasActiveDocs || hasActiveProgress) {
      ensureBackgroundPoll();
    } else {
      stopBackgroundPoll();
    }
  }, [
    user,
    projectId,
    documents,
    ingestionProgress,
    ensureBackgroundPoll,
    stopBackgroundPoll,
  ]);

  const pollIngestionJob = useCallback(
    async (documentId: string, jobId: string) => {
      for (let round = 0; round < 600; round++) {
        if (pollAbortRef.current) return null;

        const { data: job, error: jobError } = await supabase
          .from('document_ingestion_jobs')
          .select('*')
          .eq('id', jobId)
          .single();

        if (jobError) {
          console.warn('Job poll error:', jobError.message);
        }

        const j = job as DocumentIngestionJob | null;
        if (j) {
          setIngestionProgress((prev) => ({
            ...prev,
            [documentId]: jobToProgressInfo(j),
          }));
        }

        await fetchDocuments({ silent: true });

        if (j && TERMINAL_JOB_STATUSES.has(j.status)) {
          setIngestionProgress((prev) => {
            const next = { ...prev };
            delete next[documentId];
            return next;
          });
          return j;
        }

        await sleep(POLL_INTERVAL_MS);
      }
      return null;
    },
    [fetchDocuments],
  );

  const uploadDocumentWithResult = async (
    data: UploadDocumentData,
  ): Promise<ProjectDocumentUploadResult> => {
    if (!user || !projectId) {
      return {
        document: null,
        step: 'auth',
        error: 'You must be logged in and have a project selected to upload documents',
      };
    }

    setUploading(true);

    try {
      let version = 1;
      if (data.parent_document_id) {
        const parentDoc = documents.find((d) => d.id === data.parent_document_id);
        if (parentDoc) {
          const relatedDocs = documents.filter(
            (d) =>
              d.parent_document_id === data.parent_document_id ||
              d.id === data.parent_document_id,
          );
          version = Math.max(...relatedDocs.map((d) => d.version), parentDoc.version) + 1;
        }
      }

      const result = await executeProjectDocumentUpload({
        userId: user.id,
        projectId,
        file: data.file,
        document_type: data.document_type,
        description: data.description,
        parent_document_id: data.parent_document_id,
        version,
        signal: data.signal,
      });

      if (result.document) {
        setDocuments((prev) => [result.document as ProjectDocument, ...prev]);
      }

      return result;
    } catch (err) {
      console.error('[project-documents upload] unexpected error:', err);
      return {
        document: null,
        step: 'storage',
        error: formatProjectDocumentUploadError(err),
      };
    } finally {
      setUploading(false);
    }
  };

  const uploadDocument = async (data: UploadDocumentData): Promise<ProjectDocument | null> => {
    const result = await uploadDocumentWithResult(data);

    if (result.document) {
      if (!data.suppressToasts) {
        toast.success('Document uploaded successfully');
      }
      return result.document;
    }

    if (result.error && !data.suppressToasts) {
      toast.error(result.error);
    }

    return null;
  };

  const deleteDocument = async (document: ProjectDocument): Promise<boolean> => {
    if (!user || !projectId) return false;

    try {
      const { error: storageError } = await supabase.storage
        .from('project-documents')
        .remove([document.file_path]);

      if (storageError) {
        console.warn('Storage delete error:', storageError);
      }

      const { error: dbError } = await supabase
        .from('project_documents')
        .delete()
        .eq('id', document.id);

      if (dbError) throw dbError;

      setDocuments((prev) => prev.filter((d) => d.id !== document.id));
      setIngestionProgress((prev) => {
        const next = { ...prev };
        delete next[document.id];
        return next;
      });

      await logProjectActivity(
        projectId,
        user.id,
        'document_deleted',
        `Document "${document.file_name}" deleted`,
        undefined,
        { document_type: document.document_type },
      );

      toast.success('Document deleted successfully');
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete document';
      toast.error(message);
      console.error('Error deleting document:', err);
      return false;
    }
  };

  const getDownloadUrl = async (document: ProjectDocument): Promise<string | null> => {
    try {
      const { data, error } = await supabase.storage
        .from('project-documents')
        .createSignedUrl(document.file_path, 3600);

      if (error) throw error;
      return data.signedUrl;
    } catch (err) {
      console.error('Error getting download URL:', err);
      toast.error('Failed to get download link');
      return null;
    }
  };

  const downloadDocument = async (document: ProjectDocument) => {
    const url = await getDownloadUrl(document);
    if (url) {
      window.open(url, '_blank');
    }
  };

  const getDocumentVersions = useCallback(
    (document: ProjectDocument): ProjectDocument[] => {
      const rootId = document.parent_document_id || document.id;
      return documents
        .filter((d) => d.id === rootId || d.parent_document_id === rootId)
        .sort((a, b) => b.version - a.version);
    },
    [documents],
  );

  const getLatestVersions = useCallback((): ProjectDocument[] => {
    const rootDocMap = new Map<string, ProjectDocument>();

    documents.forEach((doc) => {
      const rootId = doc.parent_document_id || doc.id;
      const existing = rootDocMap.get(rootId);
      if (!existing || doc.version > existing.version) {
        rootDocMap.set(rootId, doc);
      }
    });

    return Array.from(rootDocMap.values()).sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );
  }, [documents]);

  const prepareDocumentForAi = async (
    document: ProjectDocument,
  ): Promise<{
    status?: string;
    job_id?: string;
    chunk_count?: number;
    error?: string;
  } | null> => {
    if (!user || !projectId) {
      toast.error('You must be logged in to prepare documents for AI');
      return null;
    }

    setPreparingId(document.id);
    userInitiatedPrepRef.current.add(document.id);
    setIngestionProgress((prev) => ({
      ...prev,
      [document.id]: {
        jobId: '',
        status: 'queued',
        phase: 'queued',
      },
    }));

    try {
      const { data, error: invokeError } = await supabase.functions.invoke('ingest-project-document', {
        body: {
          project_id: projectId,
          document_id: document.id,
        },
      });

      if (invokeError) {
        const message = await parseIngestInvokeError(invokeError, data);
        throw new Error(message);
      }

      const payload = data as {
        job_id?: string;
        status?: string;
        error?: string;
        message?: string;
      } | null;

      if (payload?.error) throw new Error(payload.error);
      if (!payload?.job_id) throw new Error('No ingestion job was created');

      toast.info('Document queued for AI preparation…');

      await fetchDocuments({ silent: true });
      ensureBackgroundPoll();

      const finalJob = await pollIngestionJob(document.id, payload.job_id);

      await fetchDocuments({ silent: true });

      const updatedDoc = (
        await supabase
          .from('project_documents')
          .select('ai_ingestion_status, ai_chunk_count, ai_ingestion_error')
          .eq('id', document.id)
          .single()
      ).data;

      const docStatus = updatedDoc?.ai_ingestion_status;
      const chunkCount = updatedDoc?.ai_chunk_count ?? finalJob?.total_chunks ?? 0;

      if (docStatus === 'completed') {
        toast.success(`Document prepared for AI (${chunkCount} chunks)`);
        userInitiatedPrepRef.current.delete(document.id);
      } else if (docStatus === 'partial') {
        toast.warning(
          updatedDoc?.ai_ingestion_error ?? 'Document partially prepared — some pages may need OCR',
        );
        userInitiatedPrepRef.current.delete(document.id);
      } else if (docStatus === 'low_text') {
        toast.warning(
          updatedDoc?.ai_ingestion_error ?? 'Very little text extracted — OCR may be needed',
        );
        userInitiatedPrepRef.current.delete(document.id);
      } else if (docStatus === 'failed' || finalJob?.status === 'failed') {
        toast.error(finalJob?.error ?? updatedDoc?.ai_ingestion_error ?? 'Ingestion failed');
        userInitiatedPrepRef.current.delete(document.id);
      } else if (!finalJob) {
        toast.info('Ingestion is running in the background. Progress will update here.');
      }

      return {
        status: docStatus ?? finalJob?.status,
        job_id: payload.job_id,
        chunk_count: chunkCount,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to prepare document for AI';
      toast.error(message);
      userInitiatedPrepRef.current.delete(document.id);
      setIngestionProgress((prev) => {
        const next = { ...prev };
        delete next[document.id];
        return next;
      });
      await fetchDocuments({ silent: true });
      return null;
    } finally {
      setPreparingId(null);
    }
  };

  return {
    documents,
    loading,
    uploading,
    preparingId,
    ingestionProgress,
    error,
    fetchDocuments,
    uploadDocument,
    uploadDocumentWithResult,
    deleteDocument,
    downloadDocument,
    getDownloadUrl,
    getDocumentVersions,
    getLatestVersions,
    prepareDocumentForAi,
  };
}
