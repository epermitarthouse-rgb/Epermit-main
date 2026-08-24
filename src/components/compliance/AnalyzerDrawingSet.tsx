import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FileText, Loader2, Trash2, X } from "lucide-react";
import {
  COMPLIANCE_MAX_INCLUDED_SHEETS,
  sheetDisplayName,
  type CodeAnalyzerRun,
  type CodeAnalyzerSheet,
} from "@/lib/codeAnalyzer/model";
import { COMPLIANCE_MAX_BATCH_FILES } from "@/lib/complianceUploadLimits";
import type { ComplianceBatchFileStatus } from "@/lib/complianceBatchProcessor";
import { DISCIPLINE_OPTIONS, type DocumentDiscipline } from "@/types/document";
import { cn } from "@/lib/utils";

export interface AnalyzerPendingFile {
  id: string;
  name: string;
  sizeLabel: string;
  preview: string | null;
  discipline: DocumentDiscipline;
  status: ComplianceBatchFileStatus;
  error?: string;
}

interface AnalyzerDrawingSetProps {
  sheets: CodeAnalyzerSheet[];
  pendingFiles: AnalyzerPendingFile[];
  displayRun: CodeAnalyzerRun | null;
  analysisStale: boolean;
  staleActionLabel?: string;
  analyzing: boolean;
  isLegacy: boolean;
  onAddClick: () => void;
  onRemovePending: (id: string) => void;
  onPendingDisciplineChange: (id: string, discipline: DocumentDiscipline) => void;
  onRequestRemoveSource: (sourceDocumentId: string, label: string) => void;
  onRequestRemoveSheet: (sheet: CodeAnalyzerSheet, label: string) => void;
  canAddMore: boolean;
}

const statusLabel: Record<ComplianceBatchFileStatus, string> = {
  pending: "Pending",
  preparing: "Preparing",
  uploading: "Uploading",
  analyzing: "Analyzing",
  completed: "Completed",
  failed: "Failed",
};

export function AnalyzerDrawingSet({
  sheets,
  pendingFiles,
  displayRun,
  analysisStale,
  staleActionLabel = "Update Analysis",
  analyzing,
  isLegacy,
  onAddClick,
  onRemovePending,
  onPendingDisciplineChange,
  onRequestRemoveSource,
  onRequestRemoveSheet,
  canAddMore,
}: AnalyzerDrawingSetProps) {
  const included = sheets.filter((s) => !s.excluded);
  const excluded = sheets.filter((s) => s.excluded);
  const sourceIds = [...new Set(included.map((s) => s.source_document_id))];
  const grouped = sourceIds.map((sourceId) => {
    const pages = sheets.filter((s) => s.source_document_id === sourceId);
    const first = pages[0];
    const isPdf = pages.length > 1 || (first?.file_name ?? "").toLowerCase().endsWith(".pdf");
    return { sourceId, pages, isPdf, fileName: first?.file_name ?? "Drawing" };
  });

  return (
    <div className="space-y-4 text-left">
      {analysisStale && (
        <Alert>
          <AlertDescription>
            Drawing set changed since the last analysis. Current findings are out of date until you
            run <span className="font-medium">{staleActionLabel}</span>.
          </AlertDescription>
        </Alert>
      )}
      {displayRun?.status === "current" && !analysisStale && included.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Analysis is current for {included.length} included sheet{included.length === 1 ? "" : "s"}.
        </p>
      )}
      <p
        className="text-xs text-muted-foreground"
        data-testid="analyzer-included-sheet-capacity"
      >
        {included.length} of {COMPLIANCE_MAX_INCLUDED_SHEETS} included sheet
        {COMPLIANCE_MAX_INCLUDED_SHEETS === 1 ? "" : "s"}
        {excluded.length > 0
          ? ` (${excluded.length} excluded — over the ${COMPLIANCE_MAX_INCLUDED_SHEETS}-sheet analysis cap)`
          : ""}
      </p>
      {isLegacy && sheets.length === 0 && (
        <p className="text-xs text-muted-foreground">
          These drawings were analyzed before sheet-level tracking. Add or remove files, then update
          analysis to migrate them onto the new drawing set.
        </p>
      )}

      {grouped.length > 0 && (
        <div className="space-y-3">
          <p className="text-sm font-medium text-foreground">Current drawings</p>
          {grouped.map((group) => (
            <div key={group.sourceId} className="rounded-lg border border-border bg-card p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{group.fileName}</p>
                  <p className="text-xs text-muted-foreground">
                    {group.pages.length} sheet{group.pages.length === 1 ? "" : "s"}
                    {group.isPdf ? " from PDF" : ""}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0 text-destructive"
                  disabled={analyzing}
                  onClick={() => onRequestRemoveSource(group.sourceId, group.fileName)}
                  aria-label={`Remove ${group.fileName}`}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {group.pages.map((sheet) => {
                  const label = sheetDisplayName({
                    file_name: sheet.file_name,
                    page_number: sheet.page_number,
                    sourceIsPdf: group.isPdf,
                  });
                  return (
                    <div
                      key={sheet.id}
                      className={cn(
                        "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs",
                        sheet.excluded ? "opacity-60" : "border-border bg-muted/40",
                      )}
                    >
                      <FileText className="h-3 w-3" />
                      <span>{group.isPdf ? `p.${sheet.page_number}` : label}</span>
                      {sheet.excluded && <Badge variant="outline">Excluded</Badge>}
                      {group.isPdf && (
                        <button
                          type="button"
                          className="ml-1 text-muted-foreground hover:text-destructive"
                          disabled={analyzing}
                          onClick={() => onRequestRemoveSheet(sheet, label)}
                          aria-label={`Remove ${label} from analysis`}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {pendingFiles.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium text-foreground">New drawings (not in last analysis)</p>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {pendingFiles.map((f) => (
              <div key={f.id} className="relative rounded-lg border border-dashed border-teal/50 bg-card p-3">
                {(f.status === "pending" || f.status === "failed") && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="absolute -top-2 -right-2 h-6 w-6 rounded-full bg-destructive text-destructive-foreground"
                    onClick={() => onRemovePending(f.id)}
                    aria-label={`Remove ${f.name}`}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                )}
                {f.preview ? (
                  <img src={f.preview} alt={f.name} className="h-20 w-full object-cover rounded mb-2" />
                ) : (
                  <div className="h-20 flex items-center justify-center bg-muted rounded mb-2">
                    <FileText className="h-8 w-8 text-muted-foreground" />
                  </div>
                )}
                <p className="text-xs font-medium truncate">{f.name}</p>
                <p className="text-xs text-muted-foreground">{f.sizeLabel}</p>
                <Badge className="mt-2 text-[10px]">
                  {f.status === "analyzing" && <Loader2 className="h-3 w-3 mr-1 animate-spin inline" />}
                  {statusLabel[f.status]}
                </Badge>
                {f.error && <p className="text-[10px] text-destructive mt-1">{f.error}</p>}
                <Select
                  value={f.discipline}
                  onValueChange={(value) => onPendingDisciplineChange(f.id, value as DocumentDiscipline)}
                  disabled={f.status !== "pending"}
                >
                  <SelectTrigger className="h-7 mt-2 text-xs">
                    <SelectValue placeholder="Discipline" />
                  </SelectTrigger>
                  <SelectContent>
                    {DISCIPLINE_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value} className="text-xs">
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ))}
          </div>
        </div>
      )}

      {excluded.length > 0 && grouped.length === 0 && (
        <p className="text-xs text-muted-foreground">{excluded.length} excluded sheet(s).</p>
      )}

      {canAddMore && (
        <div className="flex flex-wrap items-center justify-center gap-3 pt-2 border-t">
          <p className="text-sm text-muted-foreground" data-testid="analyzer-pending-file-capacity">
            {pendingFiles.length} of {COMPLIANCE_MAX_BATCH_FILES} new file
            {pendingFiles.length === 1 ? "" : "s"} in this upload
          </p>
          <Button variant="outlineGold" size="sm" onClick={onAddClick} disabled={analyzing}>
            Add More Drawings
          </Button>
        </div>
      )}
    </div>
  );
}
