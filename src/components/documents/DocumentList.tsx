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
  Loader2,
  Sparkles,
} from 'lucide-react';
import { format } from 'date-fns';
import { ProjectDocument, type IngestionProgressInfo } from '@/types/document';
import { DocumentVersionDialog } from './DocumentVersionDialog';
import {
  canShowPrepareButton,
  formatAiStatusDisplay,
  getPrepareButtonLabel,
  isIngestSupportedDocument,
  isPrepareActionDisabled,
} from '@/utils/documentIngestionUi';

interface DocumentListProps {
  documents: ProjectDocument[];
  onDownload: (document: ProjectDocument) => void;
  onDelete: (document: ProjectDocument) => Promise<boolean>;
  onUploadNewVersion: (document: ProjectDocument) => void;
  getVersions: (document: ProjectDocument) => ProjectDocument[];
  onPrepareForAi?: (document: ProjectDocument) => void;
  preparingId?: string | null;
  ingestionProgress?: Record<string, IngestionProgressInfo>;
}

export function DocumentList({
  documents,
  onDownload,
  onDelete,
  onUploadNewVersion,
  getVersions,
  onPrepareForAi,
  preparingId,
  ingestionProgress = {},
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
          const progress = ingestionProgress[doc.id];
          const statusDisplay = formatAiStatusDisplay(doc, progress);
          const showPrepareButton = onPrepareForAi && canShowPrepareButton(doc);
          const prepareDisabled = isPrepareActionDisabled(doc, preparingId, progress);
          const prepareLabel = getPrepareButtonLabel(doc.ai_ingestion_status, progress?.isStuck);
          const isPreparing = preparingId === doc.id;

          return (
            <div
              key={doc.id}
              className="flex items-start gap-3 py-3 px-2 min-w-0 hover:bg-muted/50 rounded-lg transition-colors"
            >
              <span className="shrink-0 mt-0.5">{getFileIcon(doc.file_type)}</span>

              <div className="flex-1 min-w-0 overflow-hidden">
                <div className="flex items-center gap-2 min-w-0">
                  <p className="font-medium truncate min-w-0" title={doc.file_name}>
                    {doc.file_name}
                  </p>
                  {doc.version > 1 && (
                    <Badge variant="secondary" className="text-xs shrink-0">
                      v{doc.version}
                    </Badge>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                  <span>{format(new Date(doc.created_at), 'MMM d, yyyy')}</span>
                  <span>•</span>
                  <span>{formatFileSize(doc.file_size)}</span>
                </div>

                {statusDisplay && (
                  <div className="mt-1.5 space-y-0.5">
                    <div className="flex flex-wrap items-center gap-1.5 text-xs">
                      {statusDisplay.showSpinner && (
                        <Loader2 className="h-3 w-3 animate-spin text-muted-foreground shrink-0" />
                      )}
                      <span
                        className={
                          statusDisplay.isStuck || doc.ai_ingestion_status === 'failed'
                            ? 'text-amber-700 dark:text-amber-400'
                            : doc.ai_ingestion_status === 'completed'
                              ? 'text-emerald-700 dark:text-emerald-400 font-medium'
                              : 'text-foreground'
                        }
                      >
                        {statusDisplay.primary}
                      </span>
                    </div>
                    {statusDisplay.secondary && (
                      <p
                        className={`text-[11px] leading-snug ${
                          statusDisplay.isStuck
                            ? 'text-amber-700/90 dark:text-amber-400/90'
                            : 'text-muted-foreground'
                        }`}
                      >
                        {statusDisplay.secondary}
                      </p>
                    )}
                  </div>
                )}
              </div>

              <div className="flex items-center gap-1 shrink-0">
                {showPrepareButton && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs shrink-0 max-w-[9.5rem]"
                    disabled={prepareDisabled}
                    onClick={() => onPrepareForAi(doc)}
                    title={prepareLabel}
                  >
                    {isPreparing ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin mr-1 shrink-0" />
                    ) : (
                      <Sparkles className="h-3.5 w-3.5 mr-1 shrink-0" />
                    )}
                    <span className="truncate">{isPreparing ? 'Queuing…' : prepareLabel}</span>
                  </Button>
                )}

                <Button
                  variant="ghost"
                  size="icon"
                  className="shrink-0"
                  onClick={() => onDownload(doc)}
                  title="Download"
                >
                  <Download className="h-4 w-4" />
                </Button>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="shrink-0">
                      <MoreVertical className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => onDownload(doc)}>
                      <Download className="mr-2 h-4 w-4" />
                      Download
                    </DropdownMenuItem>
                    {onPrepareForAi && isIngestSupportedDocument(doc) && (
                      <DropdownMenuItem
                        onClick={() => onPrepareForAi(doc)}
                        disabled={prepareDisabled}
                      >
                        <Sparkles className="mr-2 h-4 w-4" />
                        {doc.ai_ingestion_status === 'completed'
                          ? 'Re-run AI Prep'
                          : getPrepareButtonLabel(doc.ai_ingestion_status, progress?.isStuck)}
                      </DropdownMenuItem>
                    )}
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

      <AlertDialog open={!!deleteDoc} onOpenChange={(open) => !open && setDeleteDoc(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Document</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{deleteDoc?.file_name}"? This action cannot be
              undone.
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
