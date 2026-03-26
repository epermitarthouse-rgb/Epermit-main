import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Upload, FolderOpen, Loader2 } from 'lucide-react';
import { useProjectDocuments } from '@/hooks/useProjectDocuments';
import { DocumentUploadDialog } from './DocumentUploadDialog';
import { DocumentList } from './DocumentList';
import { ProjectDocument } from '@/types/document';

interface ProjectDocumentsSectionProps {
  projectId: string;
}

export function ProjectDocumentsSection({ projectId }: ProjectDocumentsSectionProps) {
  const {
    loading,
    uploading,
    uploadDocument,
    deleteDocument,
    downloadDocument,
    getDocumentVersions,
    getLatestVersions,
  } = useProjectDocuments(projectId);

  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [parentDocForNewVersion, setParentDocForNewVersion] = useState<ProjectDocument | null>(null);

  const latestVersions = getLatestVersions();

  const handleUpload = async (data: {
    file: File;
    document_type: any;
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
    // Get the root document ID for version chain
    const rootId = document.parent_document_id || document.id;
    setParentDocForNewVersion({ ...document, id: rootId });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-2">
          <FolderOpen className="h-4 w-4" />
          Documents
        </h3>
        <Button size="sm" onClick={() => setUploadDialogOpen(true)}>
          <Upload className="mr-2 h-4 w-4" />
          Upload
        </Button>
      </div>

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
        />
      )}

      {/* Upload dialog for new documents */}
      <DocumentUploadDialog
        open={uploadDialogOpen}
        onOpenChange={setUploadDialogOpen}
        onUpload={handleUpload}
        uploading={uploading}
      />

      {/* Upload dialog for new versions */}
      {parentDocForNewVersion && (
        <DocumentUploadDialog
          open={!!parentDocForNewVersion}
          onOpenChange={(open) => !open && setParentDocForNewVersion(null)}
          onUpload={async (data) => {
            await handleUpload({
              ...data,
              document_type: parentDocForNewVersion.document_type,
              parent_document_id: parentDocForNewVersion.id,
            });
            setParentDocForNewVersion(null);
          }}
          uploading={uploading}
          parentDocumentId={parentDocForNewVersion.id}
          isNewVersion
        />
      )}
    </div>
  );
}
