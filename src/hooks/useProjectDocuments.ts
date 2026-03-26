import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { ProjectDocument, DocumentType, DOCUMENT_TYPE_LABELS } from '@/types/document';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import { logProjectActivity } from '@/lib/activityLogger';

export interface UploadDocumentData {
  file: File;
  document_type: DocumentType;
  description?: string;
  parent_document_id?: string;
}

export function useProjectDocuments(projectId: string | null) {
  const { user } = useAuth();
  const [documents, setDocuments] = useState<ProjectDocument[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchDocuments = useCallback(async () => {
    if (!user || !projectId) {
      setDocuments([]);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const { data, error: fetchError } = await supabase
        .from('project_documents')
        .select('id, project_id, user_id, file_name, file_path, file_size, file_type, document_type, description, version, parent_document_id, created_at, updated_at')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false });

      if (fetchError) throw fetchError;

      setDocuments((data as ProjectDocument[]) || []);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch documents';
      setError(message);
      console.error('Error fetching documents:', err);
    } finally {
      setLoading(false);
    }
  }, [user, projectId]);

  useEffect(() => {
    fetchDocuments();
  }, [fetchDocuments]);

  const uploadDocument = async (data: UploadDocumentData): Promise<ProjectDocument | null> => {
    if (!user || !projectId) {
      toast.error('You must be logged in to upload documents');
      return null;
    }

    setUploading(true);

    try {
      // Generate unique file path: user_id/project_id/timestamp_filename
      const timestamp = Date.now();
      const filePath = `${user.id}/${projectId}/${timestamp}_${data.file.name}`;

      // Upload file to storage
      const { error: uploadError } = await supabase.storage
        .from('project-documents')
        .upload(filePath, data.file);

      if (uploadError) throw uploadError;

      // Calculate version number
      let version = 1;
      if (data.parent_document_id) {
        const parentDoc = documents.find(d => d.id === data.parent_document_id);
        if (parentDoc) {
          // Find the highest version in the version chain
          const relatedDocs = documents.filter(
            d => d.parent_document_id === data.parent_document_id || d.id === data.parent_document_id
          );
          version = Math.max(...relatedDocs.map(d => d.version), parentDoc.version) + 1;
        }
      }

      // Create document record
      const { data: newDocument, error: insertError } = await supabase
        .from('project_documents')
        .insert({
          project_id: projectId,
          user_id: user.id,
          file_name: data.file.name,
          file_path: filePath,
          file_size: data.file.size,
          file_type: data.file.type,
          document_type: data.document_type,
          version,
          parent_document_id: data.parent_document_id || null,
          description: data.description || null,
        })
        .select()
        .single();

      if (insertError) {
        // Rollback: delete uploaded file
        await supabase.storage.from('project-documents').remove([filePath]);
        throw insertError;
      }

      setDocuments(prev => [newDocument as ProjectDocument, ...prev]);
      
      // Log activity
      const activityType = data.parent_document_id ? 'document_version_uploaded' : 'document_uploaded';
      const docTypeLabel = DOCUMENT_TYPE_LABELS[data.document_type];
      await logProjectActivity(
        projectId,
        user.id,
        activityType,
        data.parent_document_id 
          ? `New version (v${version}) of "${data.file.name}" uploaded`
          : `${docTypeLabel} "${data.file.name}" uploaded`,
        data.description || undefined,
        { document_type: data.document_type, version, file_size: data.file.size }
      );
      
      toast.success('Document uploaded successfully');
      return newDocument as ProjectDocument;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to upload document';
      toast.error(message);
      console.error('Error uploading document:', err);
      return null;
    } finally {
      setUploading(false);
    }
  };

  const deleteDocument = async (document: ProjectDocument): Promise<boolean> => {
    if (!user || !projectId) return false;
    
    try {
      // Delete from storage
      const { error: storageError } = await supabase.storage
        .from('project-documents')
        .remove([document.file_path]);

      if (storageError) {
        console.warn('Storage delete error:', storageError);
        // Continue anyway - file might already be deleted
      }

      // Delete record
      const { error: dbError } = await supabase
        .from('project_documents')
        .delete()
        .eq('id', document.id);

      if (dbError) throw dbError;

      setDocuments(prev => prev.filter(d => d.id !== document.id));
      
      // Log activity
      await logProjectActivity(
        projectId,
        user.id,
        'document_deleted',
        `Document "${document.file_name}" deleted`,
        undefined,
        { document_type: document.document_type }
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
        .createSignedUrl(document.file_path, 3600); // 1 hour expiry

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

  const getDocumentVersions = useCallback((document: ProjectDocument): ProjectDocument[] => {
    // Get all documents in the same version chain
    const rootId = document.parent_document_id || document.id;
    return documents
      .filter(d => d.id === rootId || d.parent_document_id === rootId)
      .sort((a, b) => b.version - a.version);
  }, [documents]);

  const getLatestVersions = useCallback((): ProjectDocument[] => {
    // Group by root document and return only the latest version of each
    const rootDocMap = new Map<string, ProjectDocument>();
    
    documents.forEach(doc => {
      const rootId = doc.parent_document_id || doc.id;
      const existing = rootDocMap.get(rootId);
      if (!existing || doc.version > existing.version) {
        rootDocMap.set(rootId, doc);
      }
    });

    return Array.from(rootDocMap.values()).sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  }, [documents]);

  return {
    documents,
    loading,
    uploading,
    error,
    fetchDocuments,
    uploadDocument,
    deleteDocument,
    downloadDocument,
    getDownloadUrl,
    getDocumentVersions,
    getLatestVersions,
  };
}
