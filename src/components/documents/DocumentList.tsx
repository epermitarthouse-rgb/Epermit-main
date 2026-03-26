import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  FileText,
  Image,
  FileArchive,
  File,
  Download,
  Trash2,
  MoreVertical,
  History,
  Upload,
} from 'lucide-react';
import { format } from 'date-fns';
import { ProjectDocument, DOCUMENT_TYPE_LABELS } from '@/types/document';
import { DocumentVersionDialog } from './DocumentVersionDialog';

interface DocumentListProps {
  documents: ProjectDocument[];
  onDownload: (document: ProjectDocument) => void;
  onDelete: (document: ProjectDocument) => Promise<boolean>;
  onUploadNewVersion: (document: ProjectDocument) => void;
  getVersions: (document: ProjectDocument) => ProjectDocument[];
}

export function DocumentList({
  documents,
  onDownload,
  onDelete,
  onUploadNewVersion,
  getVersions,
}: DocumentListProps) {
  const [deleteDoc, setDeleteDoc] = useState<ProjectDocument | null>(null);
  const [versionDoc, setVersionDoc] = useState<ProjectDocument | null>(null);
  const [deleting, setDeleting] = useState(false);

  const getFileIcon = (fileType: string) => {
    if (fileType.startsWith('image/')) {
      return <Image className="h-5 w-5 text-blue-500" />;
    }
    if (fileType === 'application/pdf') {
      return <FileText className="h-5 w-5 text-red-500" />;
    }
    if (fileType.includes('zip')) {
      return <FileArchive className="h-5 w-5 text-yellow-500" />;
    }
    return <File className="h-5 w-5 text-muted-foreground" />;
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const handleDelete = async () => {
    if (!deleteDoc) return;
    setDeleting(true);
    await onDelete(deleteDoc);
    setDeleting(false);
    setDeleteDoc(null);
  };

  if (documents.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <FileText className="h-12 w-12 mx-auto mb-3 opacity-50" />
        <p className="font-medium">No documents yet</p>
        <p className="text-sm">Upload your first document to get started</p>
      </div>
    );
  }

  return (
    <>
      <div className="divide-y">
        {documents.map((doc) => {
          const versions = getVersions(doc);
          const hasVersions = versions.length > 1;

          return (
            <div
              key={doc.id}
              className="flex items-center gap-3 py-3 px-2 hover:bg-muted/50 rounded-lg transition-colors"
            >
              {getFileIcon(doc.file_type)}

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="font-medium truncate">{doc.file_name}</p>
                  {doc.version > 1 && (
                    <Badge variant="secondary" className="text-xs shrink-0">
                      v{doc.version}
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>{DOCUMENT_TYPE_LABELS[doc.document_type]}</span>
                  <span>•</span>
                  <span>{formatFileSize(doc.file_size)}</span>
                  <span>•</span>
                  <span>{format(new Date(doc.created_at), 'MMM d, yyyy')}</span>
                </div>
              </div>

              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => onDownload(doc)}
                  title="Download"
                >
                  <Download className="h-4 w-4" />
                </Button>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon">
                      <MoreVertical className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => onDownload(doc)}>
                      <Download className="mr-2 h-4 w-4" />
                      Download
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => onUploadNewVersion(doc)}>
                      <Upload className="mr-2 h-4 w-4" />
                      Upload New Version
                    </DropdownMenuItem>
                    {hasVersions && (
                      <DropdownMenuItem onClick={() => setVersionDoc(doc)}>
                        <History className="mr-2 h-4 w-4" />
                        View Version History ({versions.length})
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive"
                      onClick={() => setDeleteDoc(doc)}
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          );
        })}
      </div>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteDoc} onOpenChange={(open) => !open && setDeleteDoc(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Document</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{deleteDoc?.file_name}"? This action cannot
              be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Version history dialog */}
      {versionDoc && (
        <DocumentVersionDialog
          open={!!versionDoc}
          onOpenChange={(open) => !open && setVersionDoc(null)}
          document={versionDoc}
          versions={getVersions(versionDoc)}
          onDownload={onDownload}
        />
      )}
    </>
  );
}
