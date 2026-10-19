import { useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DISCIPLINE_OPTIONS, type DocumentDiscipline } from "@/types/document";
import { Loader2, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Progress } from "@/components/ui/progress";
import { AnalyzerDisclosure } from "@/components/compliance/AnalyzerDisclosure";
import type { CodeAnalyzerRun, CodeAnalyzerSheet } from "@/lib/codeAnalyzer/model";
import {
  augmentWorkflowDocumentsFromSheets,
  mergeProjectDocumentMetaFetch,
  normalizeWorkflowDocuments,
  workflowDatasetCounts,
  type UploadHandoffEntry,
} from "@/lib/codeAnalyzer/analyzerUploadWorkspace";
import {
  buildConsolidatedDocumentCards,
  bulkDeletableDocumentIds,
  isAnalyzerWorkflowDocument,
  isBulkSelectableDocumentCard,
  resolveActiveWorkflowStep,
  WORKFLOW_STEPS,
  type ConsolidatedDocumentCardModel,
  type ProjectDocumentMeta,
} from "@/lib/codeAnalyzer/documentWorkflowModel";
import {
  cancelIngestionJob,
  shouldPollIngestionState,
  type CodeAnalyzerIngestionJob,
} from "@/lib/codeAnalyzer/ingestion";
import { fetchDocumentIngestionJobs, fetchProjectDocumentsWithAnalyzerMeta } from "@/lib/codeAnalyzer/classification";
import { retryFailedSheetJobs, type SheetJobSummary } from "@/lib/codeAnalyzer/asyncRun";
import type { RunAnalysisMetrics } from "@/lib/codeAnalyzer/sheetState";
import {
  countFailedSheetJobs,
  retryFailedIngestionJob,
  retryFailedSheetJobsForSheets,
} from "@/lib/codeAnalyzer/retryWorkflow";
import { toast } from "sonner";
import { resolveAnalyzerRuntimeStatus, type AnalyzerWorkflowMode } from "@/lib/codeAnalyzer/analyzerRuntimeStatus";
import { uniqueSheetAnalysisProgress, formatUniqueSheetProgress } from "@/lib/codeAnalyzer/uniqueSheetProgress";
import {
  reconcileProjectDocumentsDisclosure,
  resolveProjectDocumentsPhase,
  type ProjectDocumentsDisclosureState,
} from "@/lib/codeAnalyzer/projectDocumentsDisclosure";
import type { AnalyzerPendingFile } from "./AnalyzerDrawingSet";

const INGESTION_POLL_MS = 5000;

function statusBadgeVariant(
  status: ConsolidatedDocumentCardModel["status"],
): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "Completed":
    case "Used as analysis context":
    case "Not analyzed":
    case "Excluded from analysis":
      return "secondary";
    case "Failed":
    case "Cancelled":
      return "destructive";
    case "Needs attention":
      return "outline";
    case "Uploading":
    case "Organizing":
    case "Analyzing":
      return "default";
    default:
      return "default";
  }
}

function statusShowsSpinner(status: ConsolidatedDocumentCardModel["status"]): boolean {
  return status === "Uploading" || status === "Organizing" || status === "Analyzing";
}

function WorkflowSteps({
  activeStep,
  nextHint,
  showCancelRun = false,
  cancellingRun = false,
  onCancelRun,
}: {
  activeStep: number;
  nextHint: string;
  showCancelRun?: boolean;
  cancellingRun?: boolean;
  onCancelRun?: () => void;
}) {
  return (
    <div className="space-y-3" data-testid="code-analyzer-workflow-steps">
      <ol className="grid gap-2 sm:grid-cols-5">
        {WORKFLOW_STEPS.map((step) => {
          const isActive = step.id === activeStep;
          const isDone = step.id < activeStep;
          return (
            <li
              key={step.id}
              className={cn(
                "rounded-lg border px-3 py-2 text-left transition-colors",
                isActive && "border-teal bg-teal/[0.08] ring-1 ring-teal/30",
                isDone && !isActive && "border-border/60 bg-muted/30 opacity-90",
                !isActive && !isDone && "border-border/40 bg-card",
              )}
              data-workflow-step={step.id}
              data-active={isActive ? "true" : "false"}
            >
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Step {step.id}
              </p>
              <p className="text-xs font-medium text-foreground leading-snug">{step.title}</p>
            </li>
          );
        })}
      </ol>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-foreground" data-testid="workflow-next-hint">
          <span className="font-medium">Next: </span>
          {nextHint}
        </p>
        {showCancelRun && onCancelRun ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={onCancelRun}
            disabled={cancellingRun}
            data-testid="button-cancel-analyzer-run-workflow"
            aria-label="Cancel analysis"
          >
            {cancellingRun ? "Cancelling…" : "Cancel"}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function DocumentWorkflowCard({
  card,
  complianceRunActive,
  selectionMode,
  selected,
  onToggleSelect,
  onRemove,
  onCancelProcessing,
  onRetryFailedAnalysis,
  onRetryOrganizing,
  retryDisabled,
}: {
  card: ConsolidatedDocumentCardModel;
  complianceRunActive: boolean;
  selectionMode: boolean;
  selected: boolean;
  onToggleSelect: () => void;
  onRemove: () => void;
  onCancelProcessing: () => void;
  onRetryFailedAnalysis: () => void;
  onRetryOrganizing: () => void;
  retryDisabled: boolean;
}) {
  const selectable = selectionMode && isBulkSelectableDocumentCard(card);
  return (
    <div
      className={cn(
        "rounded-lg border p-3 flex flex-col gap-2 min-h-0",
        card.borderClass,
        selectionMode && selected && "ring-1 ring-teal/40 border-teal/30",
      )}
      data-testid="analyzer-document-card"
      data-document-purpose={card.purpose}
      data-user-status={card.status}
      data-bulk-selectable={selectable ? "true" : "false"}
    >
      <div className="flex items-start justify-between gap-2">
        {selectable ? (
          <Checkbox
            checked={selected}
            onCheckedChange={() => onToggleSelect()}
            aria-label={`Select ${card.fileName}`}
            className="mt-0.5 shrink-0"
            data-testid="analyzer-document-bulk-checkbox"
          />
        ) : null}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium truncate" title={card.fileName}>
            {card.fileName}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">{card.purpose}</p>
        </div>
        {card.showRemove && !selectionMode && (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0 text-destructive"
            disabled={complianceRunActive && card.documentId !== null}
            onClick={onRemove}
            aria-label={`Remove ${card.fileName}`}
          >
            {card.documentId ? <Trash2 className="h-4 w-4" /> : <X className="h-4 w-4" />}
          </Button>
        )}
      </div>
      {card.countLabel ? (
        <p className="text-xs text-muted-foreground">{card.countLabel}</p>
      ) : null}
      {card.purposeDetail ? (
        <p className="text-[11px] text-muted-foreground leading-snug">{card.purposeDetail}</p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2 mt-auto pt-1">
        <Badge variant={statusBadgeVariant(card.status)} className="text-[10px] font-normal">
          {statusShowsSpinner(card.status) && (
            <Loader2 className="h-3 w-3 mr-1 animate-spin inline" aria-hidden />
          )}
          {card.status}
        </Badge>
      </div>
      {card.statusDetail ? (
        <p className="text-[11px] text-muted-foreground">{card.statusDetail}</p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {card.showCancelProcessing && card.ingestionJobId && (
          <Button size="sm" variant="outline" onClick={onCancelProcessing} disabled={complianceRunActive}>
            Cancel
          </Button>
        )}
        {card.showRetryOrganizing && card.ingestionJobId ? (
          <Button
            size="sm"
            variant="outline"
            onClick={onRetryOrganizing}
            disabled={retryDisabled}
            data-testid="retry-organizing-button"
          >
            Retry organizing
          </Button>
        ) : null}
        {card.showRetryFailedAnalysis ? (
          <Button
            size="sm"
            variant="outline"
            onClick={onRetryFailedAnalysis}
            disabled={retryDisabled}
            data-testid="retry-failed-analysis-button"
          >
            Retry failed analysis
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export interface CodeAnalyzerDocumentWorkflowProps {
  projectId: string;
  userId: string;
  sheets: CodeAnalyzerSheet[];
  uploadQueueFiles: AnalyzerPendingFile[];
  displayRun: CodeAnalyzerRun | null;
  sheetJobs?: SheetJobSummary[];
  runMetrics?: RunAnalysisMetrics;
  /** True only while a compliance run is actively executing (not upload/organize). */
  complianceRunActive: boolean;
  analysisStale: boolean;
  staleActionLabel?: string;
  workflowMode?: AnalyzerWorkflowMode;
  hasModificationReview?: boolean;
  batchProgress?: { completed: number; total: number } | null;
  currentAnalyzingSheetId?: string | null;
  hasResults: boolean;
  uploadHandoffs: UploadHandoffEntry[];
  /** Parent-hydrated project_documents (optimistic + sync); merged with child fetch for cards. */
  parentWorkflowDocuments?: ProjectDocumentMeta[];
  onWorkflowSync?: (payload: {
    documents: ProjectDocumentMeta[];
    jobs: CodeAnalyzerIngestionJob[];
  }) => void;
  onRefresh: () => void;
  onAddClick: () => void;
  onRemovePending: (id: string) => void;
  onPendingDisciplineChange?: (id: string, discipline: DocumentDiscipline) => void;
  onRequestRemoveSource: (sourceDocumentId: string, label: string) => void;
  onBulkDeleteDrawings: (
    sourceDocumentIds: string[],
  ) => Promise<{ removed: string[]; failed: string[] }>;
  canAddMore: boolean;
  pendingUploadCapacityLabel?: string | null;
  /** True while the active mode's V2 run is queued or running (stuck Analyzing). */
  showCancelRun?: boolean;
  cancellingRun?: boolean;
  onCancelRun?: () => void;
}

export function CodeAnalyzerDocumentWorkflow({
  projectId,
  userId,
  sheets,
  uploadQueueFiles,
  displayRun,
  sheetJobs = [],
  runMetrics,
  complianceRunActive,
  analysisStale,
  staleActionLabel = "Update Analysis",
  workflowMode = "standard",
  hasModificationReview = false,
  batchProgress = null,
  currentAnalyzingSheetId,
  hasResults,
  uploadHandoffs,
  parentWorkflowDocuments = [],
  onWorkflowSync,
  onRefresh,
  onAddClick,
  onRemovePending,
  onPendingDisciplineChange,
  onRequestRemoveSource,
  onBulkDeleteDrawings,
  canAddMore,
  pendingUploadCapacityLabel = null,
  showCancelRun = false,
  cancellingRun = false,
  onCancelRun,
}: CodeAnalyzerDocumentWorkflowProps) {
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedDrawingIds, setSelectedDrawingIds] = useState<Set<string>>(() => new Set());
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState<"selected" | "all" | null>(null);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [retryingRunLevel, setRetryingRunLevel] = useState(false);
  const [retryingIngestionJobId, setRetryingIngestionJobId] = useState<string | null>(null);
  const [retryingDocumentId, setRetryingDocumentId] = useState<string | null>(null);

  const [jobs, setJobs] = useState<CodeAnalyzerIngestionJob[]>([]);
  const [documents, setDocuments] = useState<
    Array<{
      id: string;
      file_name: string;
      document_type?: string | null;
      analyzer_class: string | null;
      analyzer_processing_status: string | null;
    }>
  >([]);

  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    let intervalId: ReturnType<typeof setInterval> | null = null;
    let didPoll = false;

    const refresh = async () => {
      const [ingestionJobs, docs] = await Promise.all([
        fetchDocumentIngestionJobs(projectId),
        fetchProjectDocumentsWithAnalyzerMeta(projectId),
      ]);
      if (cancelled) return;
      const typedJobs = ingestionJobs as CodeAnalyzerIngestionJob[];
      setJobs(typedJobs);
      setDocuments((prev) => {
        const merged = mergeProjectDocumentMetaFetch(
          prev as ProjectDocumentMeta[],
          docs as ProjectDocumentMeta[],
        );
        onWorkflowSync?.({ documents: merged, jobs: typedJobs });
        return merged;
      });

      const shouldPoll = shouldPollIngestionState(ingestionJobs as CodeAnalyzerIngestionJob[], docs);
      if (shouldPoll) {
        didPoll = true;
        if (intervalId === null) {
          intervalId = setInterval(() => void refresh(), INGESTION_POLL_MS);
        }
      } else if (intervalId !== null) {
        clearInterval(intervalId);
        intervalId = null;
        if (didPoll) {
          void onRefreshRef.current();
        }
      }
    };

    void refresh();
    return () => {
      cancelled = true;
      if (intervalId !== null) clearInterval(intervalId);
    };
  }, [projectId, onWorkflowSync]);

  const mergedWorkflowDocuments = useMemo(() => {
    const fromChild = documents as ProjectDocumentMeta[];
    const fromParent = parentWorkflowDocuments;
    if (fromParent.length === 0) return fromChild;
    if (fromChild.length === 0) return fromParent;
    const byId = new Map<string, ProjectDocumentMeta>();
    for (const d of fromParent) byId.set(d.id, d);
    for (const d of fromChild) {
      const prev = byId.get(d.id);
      byId.set(d.id, prev ? { ...prev, ...d } : d);
    }
    return [...byId.values()];
  }, [documents, parentWorkflowDocuments]);

  const augmentedDocuments = useMemo(
    () => augmentWorkflowDocumentsFromSheets(mergedWorkflowDocuments, sheets),
    [mergedWorkflowDocuments, sheets],
  );

  const normalizedDocuments = useMemo(
    () => normalizeWorkflowDocuments(augmentedDocuments, uploadHandoffs),
    [augmentedDocuments, uploadHandoffs],
  );

  const handoffPendingIds = useMemo(
    () => new Set(uploadHandoffs.map((h) => h.pendingId)),
    [uploadHandoffs],
  );

  const included = sheets.filter((s) => !s.excluded);
  const failedSheetIds = runMetrics?.failedSheetIds ?? new Set<string>();
  const completedSheetIds =
    runMetrics?.completedSheetIds ??
    new Set(included.filter((s) => !failedSheetIds.has(s.id)).map((s) => s.id));

  const anyOrganizing = useMemo(() => {
    return (
      jobs.some((j) => j.status === "pending" || j.status === "processing") ||
      documents.some(
        (d) =>
          d.analyzer_processing_status === "processing" || d.analyzer_processing_status === "queued",
      ) ||
      uploadQueueFiles.some((f) => f.status === "uploading" || f.status === "preparing")
    );
  }, [jobs, documents, uploadQueueFiles]);

  const hasAnyDocuments =
    normalizedDocuments.all.some(isAnalyzerWorkflowDocument) ||
    uploadQueueFiles.some((f) => !handoffPendingIds.has(f.id));

  const { activeStep, nextHint } = resolveActiveWorkflowStep({
    hasAnyDocuments,
    anyOrganizing,
    includedSheetCount: included.length,
    analyzing: complianceRunActive,
    hasResults,
    analysisStale,
  });

  const analysisSettled =
    activeStep >= 5 &&
    !complianceRunActive &&
    !anyOrganizing &&
    Boolean(displayRun?.status === "current" || displayRun?.status === "partial");

  const cards = useMemo(
    () =>
      buildConsolidatedDocumentCards({
        documents: normalizedDocuments.all,
        jobs,
        sheets,
        pendingUploads: uploadQueueFiles.map((f) => ({
          id: f.id,
          name: f.name,
          status: f.status,
          error: f.error,
        })),
        handoffPendingIds,
        placeholderDocumentIds: normalizedDocuments.placeholderDocumentIds,
        completedSheetIds,
        failedSheetIds,
        analyzing: complianceRunActive,
        currentAnalyzingSheetId,
        analysisStale,
        analysisSettled,
        sheetJobs,
      }),
    [
      normalizedDocuments,
      jobs,
      sheets,
      uploadQueueFiles,
      handoffPendingIds,
      completedSheetIds,
      failedSheetIds,
      complianceRunActive,
      currentAnalyzingSheetId,
      analysisStale,
      analysisSettled,
      sheetJobs,
    ],
  );

  const failedSheetJobCount = useMemo(() => countFailedSheetJobs(sheetJobs), [sheetJobs]);
  const showRunLevelRetry = Boolean(displayRun?.id) && failedSheetJobCount > 0;

  const sheetSourceDocumentCount = useMemo(
    () => new Set(included.map((s) => s.source_document_id).filter(Boolean)).size,
    [included],
  );

  const datasetCounts = useMemo(
    () =>
      workflowDatasetCounts({
        normalized: normalizedDocuments,
        includedSheetCount: included.length,
        sheetSourceDocumentCount,
      }),
    [normalizedDocuments, included.length, sheetSourceDocumentCount],
  );

  const runtimeStatus = resolveAnalyzerRuntimeStatus({
    mode: workflowMode,
    metrics: {
      sourceDocumentCount: datasetCounts.sourceDocumentCount,
      includedSheetCount: datasetCounts.includedSheetCount,
      analyzedCompletedCount: runMetrics?.analyzedCompletedCount ?? 0,
      analyzedFailedCount: runMetrics?.analyzedFailedCount ?? 0,
      analysisTotalCount: datasetCounts.includedSheetCount,
    },
    analyzing: complianceRunActive,
    stale: analysisStale,
    displayRunStatus: displayRun?.status ?? null,
    batchProgress,
    hasModificationReview,
  });

  const handleRetryAllFailedSheets = async () => {
    if (!displayRun?.id || retryingRunLevel) return;
    setRetryingRunLevel(true);
    try {
      const n = await retryFailedSheetJobs(displayRun.id, userId);
      toast.success(n > 0 ? `Retrying ${n} failed sheet job${n === 1 ? "" : "s"}` : "No failed sheet jobs to retry");
      onRefresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Retry failed");
    } finally {
      setRetryingRunLevel(false);
    }
  };

  const handleRetryDocumentAnalysis = async (card: ConsolidatedDocumentCardModel) => {
    if (!displayRun?.id || !card.retryFailedSheetIds.length || retryingDocumentId) return;
    setRetryingDocumentId(card.documentId);
    try {
      const n = await retryFailedSheetJobsForSheets(
        displayRun.id,
        userId,
        card.retryFailedSheetIds,
      );
      toast.success(
        n > 0
          ? `Retrying analysis for ${card.fileName}`
          : "No failed jobs to retry for this document",
      );
      onRefresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Retry failed");
    } finally {
      setRetryingDocumentId(null);
    }
  };

  const handleRetryOrganizing = async (jobId: string, documentId: string | null) => {
    if (retryingIngestionJobId) return;
    setRetryingIngestionJobId(jobId);
    try {
      await retryFailedIngestionJob(jobId, userId);
      toast.success("Re-queued file organization");
      onRefresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not retry organizing");
    } finally {
      setRetryingIngestionJobId(null);
      void documentId;
    }
  };

  const deletableDocumentIds = useMemo(() => bulkDeletableDocumentIds(cards), [cards]);

  const documentsPhase = resolveProjectDocumentsPhase({
    activeStep,
    complianceRunActive,
    anyOrganizing,
  });
  const documentsRunId = displayRun?.id ?? null;
  const [documentsDisclosure, setDocumentsDisclosure] = useState<ProjectDocumentsDisclosureState>(() =>
    reconcileProjectDocumentsDisclosure(null, { phase: documentsPhase, runId: documentsRunId }),
  );
  const nextDocumentsDisclosure = reconcileProjectDocumentsDisclosure(documentsDisclosure, {
    phase: documentsPhase,
    runId: documentsRunId,
  });
  if (nextDocumentsDisclosure !== documentsDisclosure) {
    setDocumentsDisclosure(nextDocumentsDisclosure);
  }
  const documentsExpanded = nextDocumentsDisclosure.expanded;
  const sheetProgress = useMemo(() => {
    const sheetIds = included.map((sheet) => sheet.id);
    if (sheetJobs.length > 0) {
      return uniqueSheetAnalysisProgress({ jobs: sheetJobs, sheetIds });
    }
    return formatUniqueSheetProgress(
      runMetrics?.analyzedCompletedCount ?? 0,
      runMetrics?.analysisTotalCount || sheetIds.length,
    );
  }, [sheetJobs, included, runMetrics]);

  const setDocumentsExpanded = (expanded: boolean) => {
    setDocumentsDisclosure((current) => {
      const base = reconcileProjectDocumentsDisclosure(current, {
        phase: documentsPhase,
        runId: documentsRunId,
      });
      return { ...base, expanded };
    });
  };

  useEffect(() => {
    setSelectedDrawingIds((prev) => {
      const allowed = new Set(deletableDocumentIds);
      const next = new Set([...prev].filter((id) => allowed.has(id)));
      if (next.size === prev.size && [...next].every((id) => prev.has(id))) return prev;
      return next;
    });
  }, [deletableDocumentIds]);

  const exitSelectionMode = () => {
    setSelectionMode(false);
    setSelectedDrawingIds(new Set());
  };

  const toggleDrawingSelection = (documentId: string) => {
    setSelectedDrawingIds((prev) => {
      const next = new Set(prev);
      if (next.has(documentId)) next.delete(documentId);
      else next.add(documentId);
      return next;
    });
  };

  const bulkDeleteTargetIds =
    bulkDeleteConfirm === "all" ? deletableDocumentIds : [...selectedDrawingIds];

  const handleConfirmBulkDelete = async () => {
    if (bulkDeleteTargetIds.length === 0) {
      setBulkDeleteConfirm(null);
      return;
    }
    setBulkDeleting(true);
    try {
      const confirmKind = bulkDeleteConfirm;
      const { removed } = await onBulkDeleteDrawings(bulkDeleteTargetIds);
      if (confirmKind === "all") {
        exitSelectionMode();
      } else if (removed.length > 0) {
        setSelectedDrawingIds((prev) => {
          const next = new Set(prev);
          for (const id of removed) next.delete(id);
          return next;
        });
      }
      setBulkDeleteConfirm(null);
    } finally {
      setBulkDeleting(false);
    }
  };

  return (
    <div className="space-y-4 text-left">
      <WorkflowSteps
        activeStep={activeStep}
        nextHint={nextHint}
        showCancelRun={showCancelRun}
        cancellingRun={cancellingRun}
        onCancelRun={onCancelRun}
      />

      {analysisStale && (
        <Alert>
          <AlertDescription>
            Drawing set changed since the last analysis. Run{" "}
            <span className="font-medium">{staleActionLabel}</span> when ready.
          </AlertDescription>
        </Alert>
      )}

      {showRunLevelRetry ? (
        <Alert variant="destructive" data-testid="run-level-retry-alert">
          <AlertDescription className="flex flex-wrap items-center gap-2">
            <span>
              {failedSheetJobCount} sheet{failedSheetJobCount === 1 ? "" : "s"} failed
              {displayRun?.status === "partial" ? " (partial run)" : ""}.
            </span>
            <Button
              size="sm"
              variant="outline"
              className="h-7 bg-background"
              disabled={retryingRunLevel || Boolean(retryingDocumentId)}
              onClick={() => void handleRetryAllFailedSheets()}
              data-testid="retry-failed-sheets-run-button"
            >
              {retryingRunLevel ? (
                <>
                  <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                  Retrying…
                </>
              ) : (
                "Retry failed sheets"
              )}
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="rounded-lg border border-border/60 bg-muted/15 px-3 py-2 text-xs text-muted-foreground space-y-1">
        <p>
          <span className="font-medium text-foreground">Drawings</span> — plan sheets analyzed visually.{" "}
          <span className="font-medium text-foreground">Supporting documents</span> — specs indexed for
          context only.{" "}
          <span className="font-medium text-foreground">Code modification form</span> — used in Code Mod
          review.
        </p>
        <p data-testid="analyzer-dataset-summary">
          {runtimeStatus.datasetLine}
          {runtimeStatus.statusLine ? ` · ${runtimeStatus.statusLine}` : ""}
        </p>
      </div>

      {cards.length > 0 ? (
        <AnalyzerDisclosure
          expanded={documentsExpanded}
          onExpandedChange={setDocumentsExpanded}
          testId="project-documents-disclosure"
          header={
            <>
              <span className="text-sm font-medium text-foreground" data-testid="project-documents-count">
                Project Documents ({cards.length})
              </span>
              <span className="text-xs text-muted-foreground" data-testid="project-documents-progress">
                {sheetProgress.sheetsAnalyzedLabel}
              </span>
              <span className="text-xs text-muted-foreground">{sheetProgress.breakdownLabel}</span>
              <span className="text-xs tabular-nums text-foreground">{sheetProgress.percent}%</span>
              <Progress
                value={sheetProgress.percent}
                className="h-1.5 w-16 sm:w-24"
                aria-label={sheetProgress.combinedLabel}
              />
            </>
          }
        >
        <div className="space-y-2 pt-2">
          <div
            className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1"
            data-testid="analyzer-document-bulk-actions"
          >
            {deletableDocumentIds.length > 0 ? (
              <div className="flex flex-wrap items-center gap-1">
                {selectionMode ? (
                  <>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs text-destructive/90 hover:text-destructive"
                      disabled={selectedDrawingIds.size === 0 || bulkDeleting || complianceRunActive}
                      onClick={() => setBulkDeleteConfirm("selected")}
                    >
                      Delete selected
                      {selectedDrawingIds.size > 0 ? ` (${selectedDrawingIds.size})` : ""}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs text-muted-foreground"
                      disabled={bulkDeleting}
                      onClick={exitSelectionMode}
                    >
                      Cancel
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs text-muted-foreground"
                      disabled={complianceRunActive || bulkDeleting}
                      onClick={() => {
                        setSelectionMode(true);
                        setDocumentsExpanded(true);
                      }}
                    >
                      Select
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs text-muted-foreground/70 hover:text-muted-foreground"
                      disabled={complianceRunActive || bulkDeleting}
                      onClick={() => setBulkDeleteConfirm("all")}
                    >
                      Delete all uploaded documents
                    </Button>
                  </>
                )}
              </div>
            ) : null}
          </div>
        <div
          className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3"
          data-testid="analyzer-document-workflow-grid"
        >
          {cards.map((card) => {
            const pendingId = card.key.startsWith("pending:") ? card.key.replace(/^pending:/, "") : null;
            const pendingFile = pendingId
              ? uploadQueueFiles.find((f) => f.id === pendingId)
              : undefined;
            return (
              <div key={card.key} className="space-y-2">
                <DocumentWorkflowCard
                  card={card}
                  complianceRunActive={complianceRunActive}
                  selectionMode={selectionMode}
                  selected={Boolean(card.documentId && selectedDrawingIds.has(card.documentId))}
                  onToggleSelect={() => {
                    if (card.documentId) toggleDrawingSelection(card.documentId);
                  }}
                  onRemove={() => {
                    if (card.documentId) {
                      onRequestRemoveSource(card.documentId, card.fileName);
                    } else if (pendingId) {
                      onRemovePending(pendingId);
                    }
                  }}
                  onCancelProcessing={() => {
                    if (card.ingestionJobId) {
                      void cancelIngestionJob(card.ingestionJobId, userId).then(onRefresh);
                    }
                  }}
                  onRetryFailedAnalysis={() => void handleRetryDocumentAnalysis(card)}
                  onRetryOrganizing={() => {
                    if (card.ingestionJobId) {
                      void handleRetryOrganizing(card.ingestionJobId, card.documentId);
                    }
                  }}
                  retryDisabled={
                    retryingRunLevel ||
                    retryingIngestionJobId === card.ingestionJobId ||
                    retryingDocumentId === card.documentId
                  }
                />
                {pendingFile?.status === "pending" && onPendingDisciplineChange && (
                  <Select
                    value={pendingFile.discipline}
                    onValueChange={(value) =>
                      onPendingDisciplineChange(pendingFile.id, value as DocumentDiscipline)
                    }
                  >
                    <SelectTrigger className="h-8 text-xs">
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
          })}
        </div>
        </div>
        </AnalyzerDisclosure>
      ) : (
        <p className="text-sm text-muted-foreground">No documents yet — use the upload area below.</p>
      )}

      <AlertDialog
        open={bulkDeleteConfirm !== null}
        onOpenChange={(open) => {
          if (!open && !bulkDeleting) setBulkDeleteConfirm(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {bulkDeleteConfirm === "all"
                ? "Delete all uploaded documents?"
                : "Delete selected documents?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {bulkDeleteConfirm === "all" ? (
                <>
                  This removes all {deletableDocumentIds.length} uploaded Code Analyzer document
                  {deletableDocumentIds.length === 1 ? "" : "s"} from this project — drawings,
                  supporting specs, and code modification forms — including related sheets, ingestion
                  state, and findings. This cannot be undone.
                </>
              ) : (
                <>
                  Remove {bulkDeleteTargetIds.length} selected document
                  {bulkDeleteTargetIds.length === 1 ? "" : "s"} from this project? Related Code Analyzer
                  sheets, jobs, and findings will also be removed. This cannot be undone.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={bulkDeleting || bulkDeleteTargetIds.length === 0}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(event) => {
                event.preventDefault();
                void handleConfirmBulkDelete();
              }}
            >
              {bulkDeleting ? "Removing…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {canAddMore && (
        <div className="flex flex-wrap items-center justify-center gap-3 pt-2 border-t border-border/50">
          {pendingUploadCapacityLabel ? (
            <p className="text-sm text-muted-foreground">{pendingUploadCapacityLabel}</p>
          ) : null}
          <Button variant="outlineGold" size="sm" onClick={onAddClick} disabled={complianceRunActive}>
            Add documents
          </Button>
        </div>
      )}
    </div>
  );
}
