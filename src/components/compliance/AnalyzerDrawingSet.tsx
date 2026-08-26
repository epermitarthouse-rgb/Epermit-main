import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Clock, FileText, Loader2, Trash2, X } from "lucide-react";
import {
  sheetDisplayName,
  type CodeAnalyzerRun,
  type CodeAnalyzerSheet,
} from "@/lib/codeAnalyzer/model";
import {
  resolveAnalyzerRuntimeStatus,
  type AnalyzerWorkflowMode,
} from "@/lib/codeAnalyzer/analyzerRuntimeStatus";
import {
  computeAnalyzerDatasetMetrics,
  computeRunAnalysisMetrics,
  type RunAnalysisMetrics,
  type RunAnalysisMetricsInput,
} from "@/lib/codeAnalyzer/sheetState";
import {
  deriveDocumentCardStatus,
  deriveSheetChipStatus,
  deriveUploadQueueCardStatus,
  sheetChipClassName,
  type SheetChipStatus,
} from "@/lib/codeAnalyzer/documentCardStatus";
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
  /** User-added source documents not yet persisted (pending session uploads only). */
  uploadQueueFiles: AnalyzerPendingFile[];
  /** Sheets that failed analysis and need retry (status failed only). */
  failedSheetFiles: AnalyzerPendingFile[];
  /** Count of included sheets added since the last completed run (cards remain primary UI). */
  newSinceLastAnalysisCount?: number;
  displayRun: CodeAnalyzerRun | null;
  analysisStale: boolean;
  staleActionLabel?: string;
  workflowMode?: AnalyzerWorkflowMode;
  hasModificationReview?: boolean;
  analyzing: boolean;
  batchProgress?: { completed: number; total: number } | null;
  /** Canonical run metrics from parent — keeps counters aligned with KPI strip. */
  runMetrics?: RunAnalysisMetrics;
  /** Shared inputs for per-document computeRunAnalysisMetrics (same source as KPI strip). */
  runAnalysisContext?: Omit<RunAnalysisMetricsInput, "sheets">;
  completedSheetIds?: Set<string>;
  analysisPendingCount?: number;
  currentAnalyzingSheetName?: string | null;
  currentAnalyzingSheetId?: string | null;
  /** Sheet ids added since the last completed run (for per-document stale badges). */
  newSinceLastAnalysisSheetIds?: Set<string>;
  isLegacy: boolean;
  onAddClick: () => void;
  onRemovePending: (id: string) => void;
  onPendingDisciplineChange: (id: string, discipline: DocumentDiscipline) => void;
  onRequestRemoveSource: (sourceDocumentId: string, label: string) => void;
  onRequestRemoveSheet: (sheet: CodeAnalyzerSheet, label: string) => void;
  canAddMore: boolean;
  /** Session-scoped upload capacity line; null when no active upload selection. */
  pendingUploadCapacityLabel?: string | null;
}

/** Responsive grid for persisted source-document cards (Current drawings). */
export const CURRENT_DRAWINGS_GRID_CLASS =
  "grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4";

export function sheetChipStatusLabel(status: SheetChipStatus): string {
  switch (status) {
    case "completed":
      return "Sheet completed";
    case "failed":
      return "Sheet failed";
    case "analyzing":
      return "Sheet analyzing";
    case "pending":
      return "Sheet pending";
    case "excluded":
      return "Sheet excluded";
  }
}

function SheetChipStatusIndicator({ status }: { status: SheetChipStatus }) {
  const label = sheetChipStatusLabel(status);
  switch (status) {
    case "completed":
      return (
        <span className="text-[11px] leading-none shrink-0" title={label} aria-hidden="true">
          ✅
        </span>
      );
    case "failed":
      return (
        <span className="text-[11px] leading-none shrink-0" title={label} aria-hidden="true">
          ❌
        </span>
      );
    case "analyzing":
      return (
        <Loader2
          className="h-3 w-3 animate-spin shrink-0"
          title={label}
          aria-hidden="true"
        />
      );
    case "pending":
      return (
        <Clock
          className="h-3 w-3 shrink-0 text-muted-foreground"
          title={label}
          aria-hidden="true"
        />
      );
    default:
      return null;
  }
}

function renderSessionFileCard(
  f: AnalyzerPendingFile,
  onRemove: (id: string) => void,
  onDisciplineChange: (id: string, discipline: DocumentDiscipline) => void,
) {
  const presentation = deriveUploadQueueCardStatus(f.status);
  return (
    <div
      key={f.id}
      className={cn("relative rounded-lg border bg-card p-3", presentation.borderClass)}
      data-testid="analyzer-upload-card"
      data-document-status={presentation.status}
    >
      {(f.status === "pending" || f.status === "failed") && (
        <Button
          variant="ghost"
          size="icon"
          className="absolute -top-2 -right-2 h-6 w-6 rounded-full bg-destructive text-destructive-foreground"
          onClick={() => onRemove(f.id)}
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
      <p className="text-[10px] text-muted-foreground mt-1">{presentation.progressLabel}</p>
      <Badge variant={presentation.badgeVariant} className="mt-2 text-[10px]">
        {(f.status === "analyzing" || f.status === "uploading") && (
          <Loader2 className="h-3 w-3 mr-1 animate-spin inline" />
        )}
        {presentation.badgeLabel}
      </Badge>
      {f.error && <p className="text-[10px] text-destructive mt-1">{f.error}</p>}
      {f.status === "pending" && (
        <Select
          value={f.discipline}
          onValueChange={(value) => onDisciplineChange(f.id, value as DocumentDiscipline)}
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
      )}
    </div>
  );
}

export function AnalyzerDrawingSet({
  sheets,
  uploadQueueFiles,
  failedSheetFiles,
  newSinceLastAnalysisCount = 0,
  displayRun,
  analysisStale,
  staleActionLabel = "Update Analysis",
  workflowMode = "standard",
  hasModificationReview = false,
  analyzing,
  batchProgress = null,
  runMetrics,
  runAnalysisContext,
  completedSheetIds,
  analysisPendingCount,
  currentAnalyzingSheetName,
  currentAnalyzingSheetId,
  newSinceLastAnalysisSheetIds,
  isLegacy,
  onAddClick,
  onRemovePending,
  onPendingDisciplineChange,
  onRequestRemoveSource,
  onRequestRemoveSheet,
  canAddMore,
  pendingUploadCapacityLabel = null,
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

  const failedSheetIds =
    runMetrics?.failedSheetIds ?? new Set(failedSheetFiles.map((f) => f.id));
  const canonicalMetrics =
    runMetrics ??
    (() => {
      const completedIds =
        completedSheetIds && completedSheetIds.size > 0
          ? completedSheetIds
          : new Set(included.filter((s) => !failedSheetIds.has(s.id)).map((s) => s.id));
      const datasetMetrics = computeAnalyzerDatasetMetrics({
        includedSheets: sheets,
        failedSheetIds,
        completedSheetIds: completedIds,
      });
      return {
        ...datasetMetrics,
        completedSheetIds: completedIds,
        failedSheetIds,
      };
    })();
  const analyzedCompletedCount = canonicalMetrics.analyzedCompletedCount;
  const analyzedFailedCount = canonicalMetrics.analyzedFailedCount;
  const datasetMetrics = {
    sourceDocumentCount: canonicalMetrics.sourceDocumentCount,
    includedSheetCount: canonicalMetrics.includedSheetCount,
    analyzedCompletedCount,
    analyzedFailedCount,
    analysisTotalCount: canonicalMetrics.analysisTotalCount,
  };
  const codeModReviewComplete =
    workflowMode === "code_modification" && hasModificationReview && !analysisStale;
  const effectiveCompletedSheetIds = codeModReviewComplete
    ? new Set(included.map((s) => s.id))
    : canonicalMetrics.completedSheetIds;

  const runtimeStatus = resolveAnalyzerRuntimeStatus({
    mode: workflowMode,
    metrics: datasetMetrics,
    analyzing,
    stale: analysisStale,
    displayRunStatus: displayRun?.status ?? null,
    batchProgress,
    hasModificationReview,
    reviewedSheetCount: codeModReviewComplete ? included.length : undefined,
    excludedSheetCount: excluded.length,
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
      <p className="text-xs text-muted-foreground" data-testid="analyzer-dataset-summary">
        {runtimeStatus.datasetLine}
        {runtimeStatus.statusLine ? ` · ${runtimeStatus.statusLine}` : ""}
      </p>
      {runtimeStatus.capacityLine ? (
        <p className="text-xs text-muted-foreground" data-testid="analyzer-included-sheet-capacity">
          {runtimeStatus.capacityLine}
        </p>
      ) : null}
      {isLegacy && sheets.length === 0 && (
        <p className="text-xs text-muted-foreground">
          These drawings were analyzed before sheet-level tracking. Add or remove files, then update
          analysis to migrate them onto the new drawing set.
        </p>
      )}

      {grouped.length > 0 && (
        <div className="space-y-3">
          <p className="text-sm font-medium text-foreground">Current drawings</p>
          <div
            className={CURRENT_DRAWINGS_GRID_CLASS}
            data-testid="analyzer-current-drawings-grid"
          >
            {grouped.map((group) => {
              const includedPages = group.pages.filter((s) => !s.excluded);
              const docRunMetrics = runAnalysisContext
                ? computeRunAnalysisMetrics({
                    sheets: group.pages,
                    ...runAnalysisContext,
                  })
                : null;
              const docCompletedSheetIds =
                docRunMetrics?.completedSheetIds ?? effectiveCompletedSheetIds;
              const docFailedSheetIds = docRunMetrics?.failedSheetIds ?? failedSheetIds;
              const cardStatus = deriveDocumentCardStatus({
                includedSheets: group.pages,
                completedSheetIds: docCompletedSheetIds,
                failedSheetIds: docFailedSheetIds,
                analyzing,
                currentAnalyzingSheetId,
                analysisStale,
                newSheetIds: newSinceLastAnalysisSheetIds,
              });
              return (
              <div
                key={group.sourceId}
                className={cn("rounded-lg border p-3", cardStatus.borderClass)}
                data-testid="analyzer-current-drawing-card"
                data-document-status={cardStatus.status}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{group.fileName}</p>
                    <p className="text-xs text-muted-foreground">
                      {includedPages.length} sheet{includedPages.length === 1 ? "" : "s"}
                      {group.isPdf ? " from PDF" : ""}
                    </p>
                    <p className="text-[11px] text-muted-foreground mt-1">{cardStatus.progressLabel}</p>
                    <Badge variant={cardStatus.badgeVariant} className="mt-1.5 text-[10px]">
                      {cardStatus.status === "analyzing" && (
                        <Loader2 className="h-3 w-3 mr-1 animate-spin inline" />
                      )}
                      {cardStatus.badgeLabel}
                    </Badge>
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
                    const chipStatus = deriveSheetChipStatus(sheet, {
                      completedSheetIds: docCompletedSheetIds,
                      failedSheetIds: docFailedSheetIds,
                      analyzing,
                      currentAnalyzingSheetId,
                    });
                    const pageLabel = group.isPdf ? `p.${sheet.page_number}` : label;
                    const statusLabel = sheetChipStatusLabel(chipStatus);
                    return (
                      <div
                        key={sheet.id}
                        className={cn(
                          "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs",
                          sheetChipClassName(chipStatus),
                        )}
                        data-sheet-status={chipStatus}
                        title={statusLabel}
                        aria-label={`${pageLabel}: ${statusLabel}`}
                      >
                        <span>{pageLabel}</span>
                        {chipStatus !== "excluded" && (
                          <SheetChipStatusIndicator status={chipStatus} />
                        )}
                        <span className="sr-only">{statusLabel}</span>
                        {sheet.excluded && <Badge variant="outline">Excluded</Badge>}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
            })}
          </div>
        </div>
      )}

      {newSinceLastAnalysisCount > 0 && (
        <p className="text-xs text-muted-foreground" data-testid="analyzer-new-since-last">
          {newSinceLastAnalysisCount} new sheet{newSinceLastAnalysisCount === 1 ? "" : "s"} since
          last analysis
        </p>
      )}

      {uploadQueueFiles.length > 0 && (
        <div className="space-y-2" data-testid="analyzer-new-uploads">
          <p className="text-sm font-medium text-foreground">New uploads (not yet analyzed)</p>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {uploadQueueFiles.map((f) =>
              renderSessionFileCard(f, onRemovePending, onPendingDisciplineChange),
            )}
          </div>
        </div>
      )}

      {excluded.length > 0 && grouped.length === 0 && (
        <p className="text-xs text-muted-foreground">{excluded.length} excluded sheet(s).</p>
      )}

      {canAddMore && (
        <div className="flex flex-wrap items-center justify-center gap-3 pt-2 border-t">
          {pendingUploadCapacityLabel ? (
            <p className="text-sm text-muted-foreground" data-testid="analyzer-pending-file-capacity">
              {pendingUploadCapacityLabel}
            </p>
          ) : null}
          <Button variant="outlineGold" size="sm" onClick={onAddClick} disabled={analyzing}>
            Add More Drawings
          </Button>
        </div>
      )}
    </div>
  );
}
