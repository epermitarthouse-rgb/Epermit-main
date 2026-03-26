import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  FileText,
  CheckCircle2,
  XCircle,
  AlertCircle,
  FileWarning,
  Upload,
} from 'lucide-react';

interface DocumentResult {
  document_name?: string;
  document_type?: string;
  validation_status?: string;
  validation_notes?: string;
  file_format?: string;
  file_size_bytes?: number;
  upload_order?: number;
}

interface DocumentPreparationData {
  total_documents?: number;
  valid_count?: number;
  invalid_count?: number;
  missing_count?: number;
  deficiencies?: string[];
  checklist_results?: Array<{ item?: string; status?: string; note?: string }>;
  eif_status?: string;
  documents?: DocumentResult[];
}

interface DocumentChecklistCardProps {
  data: DocumentPreparationData | null | undefined;
  error?: string | null;
}

const DOC_STATUS_CONFIG: Record<string, { icon: typeof CheckCircle2; className: string }> = {
  valid: { icon: CheckCircle2, className: 'text-emerald-600 dark:text-emerald-400' },
  invalid: { icon: XCircle, className: 'text-destructive' },
  missing: { icon: AlertCircle, className: 'text-amber-600 dark:text-amber-400' },
  oversized: { icon: FileWarning, className: 'text-amber-600 dark:text-amber-400' },
  pending: { icon: Upload, className: 'text-muted-foreground' },
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function DocumentChecklistCard({ data, error }: DocumentChecklistCardProps) {
  if (error) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2 flex-wrap">
            <FileText className="h-4 w-4" />
            Document Package
            <Badge variant="destructive">Failed</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-destructive" data-testid="text-document-error">{error}</p>
        </CardContent>
      </Card>
    );
  }

  if (!data) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2 flex-wrap">
            <FileText className="h-4 w-4" />
            Document Package
            <Badge variant="secondary">Pending</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Awaiting document validation data...</p>
        </CardContent>
      </Card>
    );
  }

  const hasIssues = (data.invalid_count ?? 0) > 0 || (data.missing_count ?? 0) > 0;
  const documents = data.documents ?? [];

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2 flex-wrap">
          <FileText className="h-4 w-4" />
          Document Package
          {hasIssues ? (
            <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300 border-0">Issues Found</Badge>
          ) : (
            <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300 border-0">Complete</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-3 text-sm">
          <div className="flex items-center gap-1" data-testid="text-doc-total">
            <span className="text-muted-foreground">Total:</span>
            <span className="font-medium">{data.total_documents ?? 0}</span>
          </div>
          <div className="flex items-center gap-1" data-testid="text-doc-valid">
            <CheckCircle2 className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
            <span className="font-medium">{data.valid_count ?? 0} valid</span>
          </div>
          {(data.invalid_count ?? 0) > 0 && (
            <div className="flex items-center gap-1" data-testid="text-doc-invalid">
              <XCircle className="h-3 w-3 text-destructive" />
              <span className="font-medium text-destructive">{data.invalid_count} invalid</span>
            </div>
          )}
          {(data.missing_count ?? 0) > 0 && (
            <div className="flex items-center gap-1" data-testid="text-doc-missing">
              <AlertCircle className="h-3 w-3 text-amber-600 dark:text-amber-400" />
              <span className="font-medium text-amber-700 dark:text-amber-300">{data.missing_count} missing</span>
            </div>
          )}
        </div>

        {data.eif_status && (
          <div className="text-sm" data-testid="text-eif-status">
            <span className="text-muted-foreground">Environmental Intake Form: </span>
            <span className="font-medium">{data.eif_status}</span>
          </div>
        )}

        {(data.deficiencies ?? []).length > 0 && (
          <div className="space-y-1" data-testid="section-deficiencies">
            <p className="text-xs font-medium text-destructive uppercase tracking-wide">Deficiencies</p>
            {data.deficiencies!.map((def, i) => (
              <div key={i} className="flex items-center gap-2 text-sm text-destructive" data-testid={`text-deficiency-${i}`}>
                <XCircle className="h-3 w-3 shrink-0" />
                {def}
              </div>
            ))}
          </div>
        )}

        {documents.length > 0 && (
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Documents</p>
            <div className="space-y-1">
              {documents.map((doc, i) => {
                const config = DOC_STATUS_CONFIG[doc.validation_status ?? 'pending'] ?? DOC_STATUS_CONFIG.pending;
                const StatusIcon = config.icon;
                return (
                  <div
                    key={i}
                    className="flex items-center justify-between gap-2 p-2 rounded-md bg-muted/30 text-sm"
                    data-testid={`row-document-${i}`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <StatusIcon className={`h-4 w-4 shrink-0 ${config.className}`} />
                      <span className="truncate">{doc.document_name ?? 'Unnamed'}</span>
                      {doc.document_type && (
                        <Badge variant="outline" className="text-[10px] shrink-0">{doc.document_type}</Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0 text-xs text-muted-foreground">
                      {doc.file_format && <span>{doc.file_format}</span>}
                      {doc.file_size_bytes != null && <span>{formatBytes(doc.file_size_bytes)}</span>}
                      {doc.upload_order != null && <span>#{doc.upload_order}</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {(data.checklist_results ?? []).length > 0 && (
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Checklist</p>
            {data.checklist_results!.map((item, i) => (
              <div key={i} className="flex items-center gap-2 text-sm" data-testid={`row-checklist-${i}`}>
                {item.status === 'pass' ? (
                  <CheckCircle2 className="h-3 w-3 text-emerald-600 dark:text-emerald-400 shrink-0" />
                ) : (
                  <XCircle className="h-3 w-3 text-destructive shrink-0" />
                )}
                <span>{item.item}</span>
                {item.note && <span className="text-xs text-muted-foreground">({item.note})</span>}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
