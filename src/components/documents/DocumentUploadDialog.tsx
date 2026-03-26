import { useState, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Upload, File, X, Loader2, AlertCircle } from 'lucide-react';
import { 
  DocumentType, 
  DocumentDiscipline, 
  DOCUMENT_TYPE_OPTIONS, 
  DISCIPLINE_OPTIONS,
  MAX_FILE_SIZE_MB,
  MAX_FILE_SIZE_BYTES 
} from '@/types/document';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';

interface DocumentUploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpload: (data: {
    file: File;
    document_type: DocumentType;
    discipline?: DocumentDiscipline;
    description?: string;
    parent_document_id?: string;
  }) => Promise<void>;
  uploading: boolean;
  parentDocumentId?: string;
  isNewVersion?: boolean;
}

export function DocumentUploadDialog({
  open,
  onOpenChange,
  onUpload,
  uploading,
  parentDocumentId,
  isNewVersion = false,
}: DocumentUploadDialogProps) {
  const [files, setFiles] = useState<File[]>([]);
  const [documentType, setDocumentType] = useState<DocumentType>('other');
  const [discipline, setDiscipline] = useState<DocumentDiscipline>('general');
  const [description, setDescription] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [currentUploadIndex, setCurrentUploadIndex] = useState(0);

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  }, []);

  const validateFiles = (fileList: FileList | File[]): { valid: File[]; errors: string[] } => {
    const valid: File[] = [];
    const errors: string[] = [];
    const filesArray = Array.from(fileList);

    for (const file of filesArray) {
      if (file.size > MAX_FILE_SIZE_BYTES) {
        errors.push(`${file.name} exceeds ${MAX_FILE_SIZE_MB}MB limit`);
      } else {
        valid.push(file);
      }
    }

    return { valid, errors };
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    setUploadError(null);

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const { valid, errors } = validateFiles(e.dataTransfer.files);
      if (errors.length > 0) {
        setUploadError(errors.join(', '));
      }
      setFiles(prev => [...prev, ...valid]);
    }
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setUploadError(null);
    if (e.target.files && e.target.files.length > 0) {
      const { valid, errors } = validateFiles(e.target.files);
      if (errors.length > 0) {
        setUploadError(errors.join(', '));
      }
      setFiles(prev => [...prev, ...valid]);
    }
  };

  const removeFile = (index: number) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async () => {
    if (files.length === 0) return;

    setCurrentUploadIndex(0);
    
    for (let i = 0; i < files.length; i++) {
      setCurrentUploadIndex(i);
      await onUpload({
        file: files[i],
        document_type: documentType,
        discipline,
        description: description || undefined,
        parent_document_id: parentDocumentId,
      });
    }

    // Reset form
    setFiles([]);
    setDocumentType('other');
    setDiscipline('general');
    setDescription('');
    setUploadError(null);
    onOpenChange(false);
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const totalSize = files.reduce((sum, f) => sum + f.size, 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {isNewVersion ? 'Upload New Version' : 'Upload Documents'}
          </DialogTitle>
          <DialogDescription>
            {isNewVersion
              ? 'Upload a new version of this document'
              : 'Add one or more documents to this project (max 50MB per file)'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {uploadError && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{uploadError}</AlertDescription>
            </Alert>
          )}

          {/* Drop zone */}
          <div
            className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors ${
              dragActive
                ? 'border-primary bg-primary/5'
                : 'border-muted-foreground/25 hover:border-muted-foreground/50'
            }`}
            onDragEnter={handleDrag}
            onDragLeave={handleDrag}
            onDragOver={handleDrag}
            onDrop={handleDrop}
          >
            {files.length > 0 ? (
              <div className="space-y-2">
                {files.map((file, index) => (
                  <div key={index} className="flex items-center justify-between bg-muted/50 p-2 rounded">
                    <div className="flex items-center gap-2 min-w-0">
                      <File className="h-5 w-5 text-muted-foreground shrink-0" />
                      <div className="text-left min-w-0">
                        <p className="font-medium text-sm truncate">{file.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatFileSize(file.size)}
                        </p>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => removeFile(index)}
                      className="shrink-0 h-8 w-8"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                <div className="flex items-center justify-between pt-2 border-t">
                  <p className="text-sm text-muted-foreground">
                    {files.length} file{files.length !== 1 ? 's' : ''} • {formatFileSize(totalSize)} total
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => document.getElementById('file-upload')?.click()}
                  >
                    Add More
                  </Button>
                </div>
              </div>
            ) : (
              <>
                <Upload className="h-10 w-10 mx-auto text-muted-foreground mb-2" />
                <p className="text-sm font-medium">
                  Drag & drop files here, or click to browse
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  PDF, images, DWG, DXF, or ZIP (max {MAX_FILE_SIZE_MB}MB per file)
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3"
                  onClick={() => document.getElementById('file-upload')?.click()}
                >
                  Browse Files
                </Button>
              </>
            )}
            <Input
              type="file"
              className="hidden"
              id="file-upload"
              onChange={handleFileChange}
              accept=".pdf,.png,.jpg,.jpeg,.dwg,.dxf,.zip"
              multiple
            />
          </div>

          {/* Document type */}
          {!isNewVersion && (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="document-type">Document Type</Label>
                <Select value={documentType} onValueChange={(v) => setDocumentType(v as DocumentType)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DOCUMENT_TYPE_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="discipline">
                  Discipline <Badge variant="secondary" className="ml-1 text-xs">Optional</Badge>
                </Label>
                <Select value={discipline} onValueChange={(v) => setDiscipline(v as DocumentDiscipline)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DISCIPLINE_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="description">Description (optional)</Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Add notes about these documents..."
              rows={2}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={files.length === 0 || uploading}>
            {uploading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Uploading {currentUploadIndex + 1}/{files.length}...
              </>
            ) : (
              <>
                <Upload className="mr-2 h-4 w-4" />
                Upload {files.length > 1 ? `${files.length} Files` : 'File'}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}