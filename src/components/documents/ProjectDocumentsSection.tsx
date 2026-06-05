import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Upload, FolderOpen, Loader2 } from 'lucide-react';
import { useProjectDocuments } from '@/hooks/useProjectDocuments';
import { DocumentUploadDialog } from './DocumentUploadDialog';
import { DocumentList } from './DocumentList';
import { ProjectDocument } from '@/types/document';
import {
  ActiveProjectMismatchBanner,
  UploadMismatchDialog,
  useActiveProjectMismatch,
} from './ActiveProjectMismatchBanner';

interface ProjectDocumentsSectionProps {
  projectId: string;
  projectName?: string;
}

type PendingUploadAction = 'new' | 'version';

export function ProjectDocumentsSection({ projectId, projectName }: ProjectDocumentsSectionProps) {
  const {
    loading,
    uploading,
    preparingId,
    uploadDocument,
    deleteDocument,
    downloadDocument,
    getDocumentVersions,
    getLatestVersions,
    prepareDocumentForAi,
    ingestionProgress,
  } = useProjectDocuments(projectId);

  const { isMismatch } = useActiveProjectMismatch(projectId);

  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [versionDialogOpen, setVersionDialogOpen] = useState(false);
  const [uploadMismatchOpen, setUploadMismatchOpen] = useState(false);
  const [pendingUploadAction, setPendingUploadAction] = useState<PendingUploadAction | null>(null);
  const [parentDocForNewVersion, setParentDocForNewVersion] = useState<ProjectDocument | null>(null);

  const latestVersions = getLatestVersions();

  const aiReadiness = useMemo(() => {
    const prepared = latestVersions.filter((d) =>
      d.ai_ingestion_status === 'completed' || d.ai_ingestion_status === 'partial'
    );
    const totalChunks = latestVersions.reduce((n, d) => n + (d.ai_chunk_count ?? 0), 0);
    const lastPrepared = latestVersions
      .map((d) => d.ai_ingested_at)
      .filter(Boolean)
      .sort()
      .reverse()[0] ?? null;
    return {
      uploadedCount: latestVersions.length,
      preparedCount: prepared.length,
      totalChunks,
      lastPrepared,
    };
  }, [latestVersions]);

  const openAfterMismatchCheck = (action: PendingUploadAction) => {
    if (isMismatch) {
      setPendingUploadAction(action);
      setUploadMismatchOpen(true);
      return;
    }
    if (action === 'new') {
      setUploadDialogOpen(true);
    } else {
      setVersionDialogOpen(true);
    }
  };

  const handleMismatchProceed = () => {
    if (pendingUploadAction === 'new') {
      setUploadDialogOpen(true);
    } else if (pendingUploadAction === 'version') {
      setVersionDialogOpen(true);
    }
    setPendingUploadAction(null);
  };

  const handleUpload = async (data: {
    file: File;
    document_type: import('@/types/document').DocumentType;
    description?: string;
    parent_document_id?: string;
  }) => {
    await uploadDocument({
      file: data.file,
      document_type: data.document_type,
      description: data.description,
      parent_document_id: data.parent_document_id,
    });
  };

  const handleUploadNewVersion = (document: ProjectDocument) => {
    const rootId = document.parent_document_id || document.id;
    setParentDocForNewVersion({ ...document, id: rootId });
    openAfterMismatchCheck('version');
  };

  return (
    <div className="space-y-4">
      <ActiveProjectMismatchBanner
        viewingProjectId={projectId}
        viewingProjectName={projectName}
      />

      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-2">
          <FolderOpen className="h-4 w-4" />
          Documents
        </h3>
        <Button
          size="sm"
          onClick={() => openAfterMismatchCheck('new')}
          data-testid="button-project-docs-upload"
        >
          <Upload className="mr-2 h-4 w-4" />
          Upload
        </Button>
      </div>

      {latestVersions.length > 0 && (
        <p className="text-xs text-muted-foreground">
          AI readiness: {aiReadiness.preparedCount}/{aiReadiness.uploadedCount} documents prepared
          {aiReadiness.totalChunks > 0 ? ` · ${aiReadiness.totalChunks} chunks` : ''}
          {aiReadiness.lastPrepared
            ? ` · last prepared ${new Date(aiReadiness.lastPrepared).toLocaleString()}`
            : ''}
        </p>
      )}

      <Separator />

      {loading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <DocumentList
          documents={latestVersions}
          onDownload={downloadDocument}
          onDelete={deleteDocument}
          onUploadNewVersion={handleUploadNewVersion}
          getVersions={getDocumentVersions}
          onPrepareForAi={prepareDocumentForAi}
          preparingId={preparingId}
          ingestionProgress={ingestionProgress}
        />
      )}

      <UploadMismatchDialog
        open={uploadMismatchOpen}
        onOpenChange={(open) => {
          setUploadMismatchOpen(open);
          if (!open) setPendingUploadAction(null);
        }}
        viewingProjectId={projectId}
        viewingProjectName={projectName}
        onProceed={handleMismatchProceed}
      />

      <DocumentUploadDialog
        open={uploadDialogOpen}
        onOpenChange={setUploadDialogOpen}
        onUpload={handleUpload}
        uploading={uploading}
      />

      {parentDocForNewVersion && (
        <DocumentUploadDialog
          open={versionDialogOpen}
          onOpenChange={(open) => {
            setVersionDialogOpen(open);
            if (!open) setParentDocForNewVersion(null);
          }}
          onUpload={async (data) => {
            await handleUpload({
              ...data,
              document_type: parentDocForNewVersion.document_type,
              parent_document_id: parentDocForNewVersion.id,
            });
            setParentDocForNewVersion(null);
            setVersionDialogOpen(false);
          }}
          uploading={uploading}
          parentDocumentId={parentDocForNewVersion.id}
          isNewVersion
        />
      )}
    </div>
  );
}
