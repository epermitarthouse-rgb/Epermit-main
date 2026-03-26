import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Download, FileText } from 'lucide-react';
import { format } from 'date-fns';
import { ProjectDocument } from '@/types/document';

interface DocumentVersionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  document: ProjectDocument;
  versions: ProjectDocument[];
  onDownload: (document: ProjectDocument) => void;
}

export function DocumentVersionDialog({
  open,
  onOpenChange,
  document,
  versions,
  onDownload,
}: DocumentVersionDialogProps) {
  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Version History
          </DialogTitle>
          <DialogDescription>
            All versions of this document
          </DialogDescription>
        </DialogHeader>

        <div className="divide-y max-h-[400px] overflow-y-auto">
          {versions.map((version, index) => (
            <div
              key={version.id}
              className="flex items-center justify-between py-3 gap-3"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <Badge variant={index === 0 ? 'default' : 'secondary'}>
                    v{version.version}
                  </Badge>
                  {index === 0 && (
                    <span className="text-xs text-muted-foreground">(Current)</span>
                  )}
                </div>
                <p className="text-sm truncate mt-1">{version.file_name}</p>
                <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                  <span>{formatFileSize(version.file_size)}</span>
                  <span>•</span>
                  <span>{format(new Date(version.created_at), 'MMM d, yyyy h:mm a')}</span>
                </div>
                {version.description && (
                  <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                    {version.description}
                  </p>
                )}
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onDownload(version)}
              >
                <Download className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
