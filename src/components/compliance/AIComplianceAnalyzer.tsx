import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableCombobox, ComboboxOption } from "@/components/ui/searchable-combobox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { toast } from "sonner";
import {
  Upload,
  FileImage,
  AlertTriangle,
  AlertCircle,
  Info,
  CheckCircle2,
  Shield,
  Loader2,
  FileText,
  Download,
  Building2,
  MapPin,
  Calendar,
  XCircle,
  Check,
  Edit,
  FileDown,
  X,
  File as FileIcon,
  Scale,
  ToggleLeft,
  FolderKanban,
  Plus,
  BookOpen,
  Table as TableIcon,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { supabase } from "@/lib/supabase";
import { getScraperBaseUrl } from "@/lib/scraperBaseUrl";
import { exportComplianceReportPDF } from "@/lib/complianceReportPDF";
import { pdfPagesToImageFiles } from "@/lib/pdfToImage";
import {
  COMPLIANCE_MAX_BATCH_FILES,
  mergeComplianceFiles,
} from "@/lib/complianceUploadLimits";
import {
  batchProgressPercent,
  computeComplianceOverallScore,
  countFailedBatchFiles,
  canRemoveBatchFile,
  createComplianceBatchFileId,
  batchFileDisplayName,
  formatBatchProgressLabel,
  formatAnalysisCompletionToast,
  processComplianceBatch,
  type ComplianceBatchAnalysisResult,
  type ComplianceBatchFile,
  type ComplianceBatchFileStatus,
  type ComplianceBatchProgress,
} from "@/lib/complianceBatchProcessor";
import {
  COMPLIANCE_RESULTS_FILTER_ALL,
  COMPLIANCE_SCORE_FILTER_ALL,
  COMPLIANCE_SCORE_FILTER_NOT_100,
  filterComplianceGroupsByScore,
  filterComplianceResultGroups,
  type ComplianceScoreFilter,
} from "@/lib/complianceResultFilter";
import {
  complianceDocsHydrateKey,
  complianceHistoricalResultsMessage,
  complianceResultsEmptyMessage,
  createGenerationGuard,
  mergeLoadedExistingAnalyses,
  resolveComplianceHydrateSource,
  resolveComplianceResultsEmptyKind,
  shouldShowComplianceKpiStrip,
} from "@/lib/complianceAnalysisHydrate";
import {
  buildComplianceResultGroups,
  isPendingSessionUpload,
  shouldIsolateCurrentRunResults,
} from "@/lib/complianceRunResults";
import {
  buildAggregatedComplianceExport,
  buildComplianceExportJsonReport,
  complianceIssueResponseKey,
} from "@/lib/complianceAnalysisExport";
import { cn } from "@/lib/utils";
import { MetricCard, Panel } from "@/components/design/ProductPrimitives";
import { useRecentlyUsed } from "@/hooks/useRecentlyUsed";
import { useProjects } from "@/hooks/useProjects";
import { useProjectDocuments } from "@/hooks/useProjectDocuments";
import { useResolvedProjectId } from "@/hooks/useResolvedProjectId";
import { useAuth } from "@/hooks/useAuth";
import { DocumentDiscipline, coerceDocumentDiscipline, MAX_FILE_SIZE_MB, MAX_FILE_SIZE_BYTES } from "@/types/document";
import type { ProjectDocument } from "@/types/document";
import {
  ANALYSIS_TYPE_DC_MODIFICATION,
  ANALYSIS_TYPE_STANDARD,
  collectRunIdsWithComplianceFindings,
  complianceDocumentIdsFromAnnotations,
  computeSheetFingerprint,
  COMPLIANCE_MAX_INCLUDED_SHEETS,
  computeStandardRunFingerprint,
  filterAnnotationsForActiveAnalysis,
  isStandardComplianceRun,
  resolveHydrateRun,
  shouldMarkAnalysisStale,
  type CodeAnalyzerRun,
  type CodeAnalyzerSheet,
} from "@/lib/codeAnalyzer/model";
import type { IndexCompletenessResult } from "@/lib/codeAnalyzer/indexCompleteness";
import { runDrawingIndexPrescreen } from "@/lib/codeAnalyzer/runIndexPrescreen";
import {
  analyzerSheetFingerprint,
  indexPrescreenEffectKey,
  sheetDocumentIdsKey,
  shouldClearPrescreenOnDatasetReload,
  shouldRunIndexPrescreen,
  shouldShowIndexCompletenessPanel,
  shouldWipePrescreenResultInEffect,
} from "@/lib/codeAnalyzer/analyzerUiStability";
import {
  computeRunAnalysisMetrics,
  formatAnalysisProgressSummary,
  newSincePreviousRun,
} from "@/lib/codeAnalyzer/sheetState";
import {
  completeAnalyzerRun,
  createAnalyzerRun,
  deleteAnalyzerSheetRow,
  fetchAnalyzerRuns,
  fetchAnalyzerSheets,
  fetchDocumentsByIds,
  insertAnalyzerSheet,
  markCurrentRunStale,
  displayRunFromList,
  currentRunFromList,
} from "@/lib/codeAnalyzer/persistence";
import { persistPendingAnalyzerSources } from "@/lib/codeAnalyzer/persistPending";
import {
  formatPdfProcessingDetail,
  formatUploadCompletionToast,
  formatUploadProgressLabel,
  shouldClearUploadProgress,
  shouldShowUploadProgress,
  uploadProgressPercent,
  type DrawingUploadProgress,
} from "@/lib/codeAnalyzer/uploadBatchProgress";
import { replaceComplianceFindingsForSheet } from "@/lib/codeAnalyzer/findings";
import { deleteAnalyzerSheet, deleteAnalyzerSourceDrawing } from "@/lib/codeAnalyzer/deleteDrawings";
import { AnalyzerDrawingSet } from "@/components/compliance/AnalyzerDrawingSet";
import { IndexCompletenessPanel } from "@/components/compliance/IndexCompletenessPanel";
import { CodeModificationReviewResults } from "@/components/compliance/CodeModificationReviewResults";
import {
  computeFormsFingerprint,
  computeModificationSourceFingerprint,
  formDocumentIdsMatch,
  shouldMarkModificationReviewStale,
  type CodeModificationReview,
} from "@/lib/codeModification/model";
import {
  fetchModificationForms,
  fetchModificationReviewForRun,
} from "@/lib/codeModification/persistence";
import { runDcCodeModificationReview } from "@/lib/codeModification/runReview";
import { isDcJurisdiction } from "@/lib/codeModification/workflow";

interface ComplianceIssue {
  id: string;
  category: string;
  title: string;
  description: string;
  severity: "critical" | "warning" | "advisory";
  codeReference: string;
  codeYear: string;
  location: string;
  suggestedFix: string;
  codeType?: "ibc" | "local";
}

type AnalysisResult = ComplianceBatchAnalysisResult;

interface IssueResponse {
  status: "accepted" | "modified" | "rejected";
  originalFix: string;
  modifiedResponse?: string;
}

interface UploadedFile extends ComplianceBatchFile {
  preview: string | null;
}

const batchStatusLabels: Record<ComplianceBatchFileStatus, string> = {
  pending: "Pending",
  preparing: "Preparing",
  uploading: "Uploading",
  analyzing: "Analyzing",
  completed: "Completed",
  failed: "Failed",
};

const batchStatusColors: Record<ComplianceBatchFileStatus, string> = {
  pending: "bg-muted text-muted-foreground",
  preparing: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  uploading: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  analyzing: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
  completed: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200",
  failed: "bg-destructive/15 text-destructive",
};

// Jurisdictions with local amendments
const JURISDICTIONS_WITH_AMENDMENTS = [
  "dc",
  "new-york-city",
  "california",
  "los-angeles",
  "san-francisco",
  "florida",
  "miami-dade",
  "chicago",
  "boston",
  "massachusetts",
  "seattle",
  "portland",
];

const severityConfig = {
  critical: {
    icon: AlertCircle,
    color: "text-destructive",
    bg: "bg-muted/30 dark:bg-muted/40",
    border: "border-destructive",
    stripe: "bg-destructive",
    iconBg: "bg-destructive/15",
    label: "Critical",
  },
  warning: {
    icon: AlertTriangle,
    color: "text-amber-600 dark:text-amber-400",
    bg: "bg-muted/30 dark:bg-muted/40",
    border: "border-amber-500 dark:border-amber-400",
    stripe: "bg-amber-500 dark:bg-amber-400",
    iconBg: "bg-amber-500/15",
    label: "Warning",
  },
  advisory: {
    icon: Info,
    color: "text-blue-600 dark:text-blue-400",
    bg: "bg-muted/30 dark:bg-muted/40",
    border: "border-blue-500 dark:border-blue-400",
    stripe: "bg-blue-500 dark:bg-blue-400",
    iconBg: "bg-blue-500/15",
    label: "Advisory",
  },
};

const categoryIcons: Record<string, string> = {
  Egress: "🚪",
  "Fire Safety": "🔥",
  Accessibility: "♿",
  Structural: "🏗️",
  MEP: "⚡",
  Zoning: "📐",
  "Life Safety": "🛡️",
};

/** Annotation data shape for AI compliance findings stored in document_annotations */
interface ComplianceAnnotationData {
  compliance_issue?: boolean;
  compliance_metadata?: boolean;
  codeType?: "ibc" | "local";
  id?: string;
  category?: string;
  title?: string;
  description?: string;
  severity?: "critical" | "warning" | "advisory";
  codeReference?: string;
  codeYear?: string;
  location?: string;
  suggestedFix?: string;
  summary?: AnalysisResult["summary"];
  jurisdictionNotes?: string;
  jurisdiction?: string;
  projectType?: string;
  codeYear_meta?: string;
}

export function AIComplianceAnalyzer() {
  const { user } = useAuth();
  const { projects, loading: projectsLoading, createProject } = useProjects();
  const { projectId: selectedProjectId, setSelectedProjectId } = useResolvedProjectId();
  const [showNewProjectInput, setShowNewProjectInput] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [creatingProject, setCreatingProject] = useState(false);
  const { documents, uploadDocument, fetchDocuments, deleteDocument, getDownloadUrl } = useProjectDocuments(selectedProjectId);
  /** Results view filter: `all` shows every analyzed file; a document id filters to that file. */
  const [resultsDocumentFilter, setResultsDocumentFilter] = useState<string>(
    COMPLIANCE_RESULTS_FILTER_ALL,
  );
  /** Score filter: `all` (default) or only groups that are not 100% compliant / failed. */
  const [complianceScoreFilter, setComplianceScoreFilter] = useState<ComplianceScoreFilter>(
    COMPLIANCE_SCORE_FILTER_ALL,
  );
  const [loadingExisting, setLoadingExisting] = useState(false);

  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [batchProgress, setBatchProgress] = useState<ComplianceBatchProgress | null>(null);
  const [drawingUploadProgress, setDrawingUploadProgress] = useState<DrawingUploadProgress | null>(
    null,
  );
  const [persistedSheets, setPersistedSheets] = useState<CodeAnalyzerSheet[]>([]);
  const [displayRun, setDisplayRun] = useState<CodeAnalyzerRun | null>(null);
  const [currentRun, setCurrentRun] = useState<CodeAnalyzerRun | null>(null);
  const [modificationDisplayRun, setModificationDisplayRun] = useState<CodeAnalyzerRun | null>(null);
  const [modificationCurrentRun, setModificationCurrentRun] = useState<CodeAnalyzerRun | null>(null);
  const [modificationForms, setModificationForms] = useState<ProjectDocument[]>([]);
  const [uploadingFormNames, setUploadingFormNames] = useState<string[]>([]);
  const [modificationReview, setModificationReview] = useState<CodeModificationReview | null>(null);
  const [hasAnalyzerRuns, setHasAnalyzerRuns] = useState(false);
  const [sheetDocuments, setSheetDocuments] = useState<ProjectDocument[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<{
    kind: "source" | "sheet";
    sourceDocumentId: string;
    sheet?: CodeAnalyzerSheet;
    label: string;
  } | null>(null);
  const [deletingDrawing, setDeletingDrawing] = useState(false);
  const analysisRunIdRef = useRef<string | null>(null);
  const [batchRetrying, setBatchRetrying] = useState(false);
  type LoadedExistingAnalysis = {
    documentId: string;
    fileName: string;
    ibcResult: AnalysisResult | null;
    localResult: AnalysisResult | null;
  };
  /** Hydrated prior analyses from DB (All loads every project doc; single-file may load one). */
  const [loadedExistingResults, setLoadedExistingResults] = useState<LoadedExistingAnalysis[]>([]);
  const [activeResultFileId, setActiveResultFileId] = useState<string | null>(null);
  const completedBatchFiles = useMemo(
    () => files.filter((f) => f.status === "completed"),
    [files],
  );
  const failedBatchFiles = useMemo(
    () => files.filter((f) => f.status === "failed"),
    [files],
  );
  const uploadQueueFiles = useMemo(
    () => files.filter(isPendingSessionUpload),
    [files],
  );

  const activeResultFile = useMemo(() => {
    if (activeResultFileId) {
      return completedBatchFiles.find((f) => f.id === activeResultFileId) ?? completedBatchFiles[0] ?? null;
    }
    return completedBatchFiles[0] ?? null;
  }, [activeResultFileId, completedBatchFiles]);

  const activeLoadedExisting = useMemo(() => {
    if (activeResultFileId) {
      return loadedExistingResults.find((l) => l.documentId === activeResultFileId) ?? null;
    }
    if (resultsDocumentFilter !== COMPLIANCE_RESULTS_FILTER_ALL) {
      return (
        loadedExistingResults.find((l) => l.documentId === resultsDocumentFilter) ??
        loadedExistingResults[0] ??
        null
      );
    }
    return loadedExistingResults[0] ?? null;
  }, [activeResultFileId, loadedExistingResults, resultsDocumentFilter]);

  const [responses, setResponses] = useState<Record<string, IssueResponse>>({});
  const [selectedIssue, setSelectedIssue] = useState<ComplianceIssue | null>(null);
  const [modifyDialogOpen, setModifyDialogOpen] = useState(false);
  const [modifiedText, setModifiedText] = useState("");
  const [dragActive, setDragActive] = useState(false);

  // Analysis options
  const [jurisdiction, setJurisdiction] = useState("general");
  const [projectType, setProjectType] = useState("commercial");
  const [codeYear, setCodeYear] = useState("2021");
  const [analysisKind, setAnalysisKind] = useState<"standard" | "dc_code_modification">("standard");

  // Dual code analysis options
  const [analysisMode, setAnalysisMode] = useState<"both" | "ibc" | "local">("both");
  const [analysisInstructions, setAnalysisInstructions] = useState("");
  const [indexCompleteness, setIndexCompleteness] = useState<IndexCompletenessResult | null>(null);
  const [indexPrescreenLoading, setIndexPrescreenLoading] = useState(false);
  const [activeResultTab, setActiveResultTab] = useState<"ibc" | "local">("ibc");

  const hasLocalAmendments = JURISDICTIONS_WITH_AMENDMENTS.includes(jurisdiction);
  const isModificationMode =
    analysisKind === "dc_code_modification" && isDcJurisdiction(jurisdiction);

  // Documents that have compliance annotations (for "Load existing")
  const [documentsWithAnalysis, setDocumentsWithAnalysis] = useState<ProjectDocument[]>([]);
  const [loadingDocsWithAnalysis, setLoadingDocsWithAnalysis] = useState(false);
  const [analysisSavedAt, setAnalysisSavedAt] = useState<number>(0);
  /** True when All/per-doc hydrate failed after analyzed docs were found. */
  const [hydrateLoadFailed, setHydrateLoadFailed] = useState(false);
  /** Run id whose compliance annotations are shown (display or historical fallback). */
  const [hydrateRunId, setHydrateRunId] = useState<string | null>(null);
  const [resultsFromHistoricalRun, setResultsFromHistoricalRun] = useState(false);
  /** Run id for an in-flight batch — isolates findings from prior hydrate. */
  const [activeBatchRunId, setActiveBatchRunId] = useState<string | null>(null);
  /** When set, results panel shows a superseded run via Analysis history. */
  const [viewingHistoricalRunId, setViewingHistoricalRunId] = useState<string | null>(null);
  const [analyzerRuns, setAnalyzerRuns] = useState<CodeAnalyzerRun[]>([]);
  const [indexPrescreenError, setIndexPrescreenError] = useState<string | null>(null);
  const docsFetchGuardRef = useRef(createGenerationGuard());
  const hydrateGuardRef = useRef(createGenerationGuard());
  const selectedProjectIdRef = useRef(selectedProjectId);
  selectedProjectIdRef.current = selectedProjectId;

  useEffect(() => {
    setUploadingFormNames([]);
  }, [selectedProjectId]);

  // Restore run-scoped staff guidance when switching projects or analysis kind.
  useEffect(() => {
    const activeRun = isModificationMode ? modificationDisplayRun : displayRun;
    setAnalysisInstructions(activeRun?.analysis_instructions ?? "");
  }, [
    selectedProjectId,
    isModificationMode,
    displayRun?.id,
    displayRun?.analysis_instructions,
    modificationDisplayRun?.id,
    modificationDisplayRun?.analysis_instructions,
  ]);

  const sheetFingerprint = useMemo(
    () => analyzerSheetFingerprint(persistedSheets),
    [persistedSheets],
  );
  const sheetDocIdsKey = useMemo(
    () => sheetDocumentIdsKey(sheetDocuments.map((d) => d.id)),
    [sheetDocuments],
  );
  const indexPrescreenKeyRef = useRef("");

  // Drawing index completeness prescreen (deterministic diff; vision only when index text is sparse).
  useEffect(() => {
    const includedCount = persistedSheets.filter((s) => !s.excluded).length;
    if (includedCount === 0) {
      indexPrescreenKeyRef.current = "";
      setIndexPrescreenLoading(false);
      if (shouldWipePrescreenResultInEffect(includedCount)) {
        setIndexCompleteness(null);
        setIndexPrescreenError(null);
      }
      return;
    }

    const prescreenKey = indexPrescreenEffectKey({
      sheetFingerprint,
      sheetDocIdsKey,
      isModificationMode,
    });
    if (!shouldRunIndexPrescreen(indexPrescreenKeyRef.current, prescreenKey)) {
      setIndexPrescreenLoading(false);
      return;
    }
    indexPrescreenKeyRef.current = prescreenKey;

    let cancelled = false;
    setIndexPrescreenLoading(true);
    setIndexPrescreenError(null);
    void (async () => {
      try {
        const result = await runDrawingIndexPrescreen({
          sheets: persistedSheets,
          getDownloadUrl: async (documentId) => {
            const doc = sheetDocuments.find((d) => d.id === documentId);
            if (doc) return getDownloadUrl(doc);
            const fetched = await fetchDocumentsByIds([documentId]);
            return fetched[0] ? getDownloadUrl(fetched[0]) : null;
          },
        });
        if (!cancelled) {
          setIndexCompleteness(result);
          setIndexPrescreenError(null);
        }
      } catch (err) {
        console.error("Index prescreen failed:", err);
        if (!cancelled) {
          setIndexPrescreenError(err instanceof Error ? err.message : "Prescreen failed");
        }
      } finally {
        if (!cancelled) setIndexPrescreenLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    sheetFingerprint,
    sheetDocIdsKey,
    getDownloadUrl,
    isModificationMode,
    persistedSheets,
    sheetDocuments,
  ]);

  const pendingDrawingCount = files.filter(isPendingSessionUpload).length;
  const standardCurrentFingerprint = computeStandardRunFingerprint(
    persistedSheets,
    analysisInstructions,
  );
  const analysisStale = shouldMarkAnalysisStale({
    runStatus: displayRun?.status ?? currentRun?.status,
    runFingerprint: displayRun?.source_fingerprint ?? currentRun?.source_fingerprint,
    currentFingerprint: standardCurrentFingerprint,
    pendingSourceCount: pendingDrawingCount,
  });
  const modificationFormsFingerprint = computeFormsFingerprint(
    modificationForms.map((form) => ({
      formDocumentId: form.id,
      updatedAt: form.updated_at,
    })),
  );
  const reviewFormDocumentIds =
    modificationReview?.form_document_ids ??
    (modificationReview?.form_document_id ? [modificationReview.form_document_id] : []);
  const modificationFormsChanged = !formDocumentIdsMatch(
    reviewFormDocumentIds,
    modificationForms.map((form) => form.id),
  );
  const modificationStale = shouldMarkModificationReviewStale({
    runStatus: modificationDisplayRun?.status ?? modificationCurrentRun?.status,
    runFingerprint:
      modificationDisplayRun?.source_fingerprint ?? modificationCurrentRun?.source_fingerprint,
    currentFingerprint: computeModificationSourceFingerprint(
      modificationFormsFingerprint,
      computeSheetFingerprint(persistedSheets),
      analysisInstructions,
    ),
    formChanged: modificationFormsChanged || uploadingFormNames.length > 0,
    pendingSourceCount: pendingDrawingCount,
  });

  const reloadAnalyzerDataset = useCallback(async (projectId: string) => {
    const runs = await fetchAnalyzerRuns(projectId);
    const sheets = await fetchAnalyzerSheets(projectId);
    const display = displayRunFromList(runs, ANALYSIS_TYPE_STANDARD);
    const current = currentRunFromList(runs, ANALYSIS_TYPE_STANDARD);
    const modificationDisplay = displayRunFromList(runs, ANALYSIS_TYPE_DC_MODIFICATION);
    const modificationCurrent = currentRunFromList(runs, ANALYSIS_TYPE_DC_MODIFICATION);
    const hasStandardRuns = runs.some(isStandardComplianceRun);
    setHasAnalyzerRuns(hasStandardRuns);
    setAnalyzerRuns(runs.filter(isStandardComplianceRun));
    setDisplayRun(display);
    setCurrentRun(current);
    setModificationDisplayRun(modificationDisplay);
    setModificationCurrentRun(modificationCurrent);
    setPersistedSheets(sheets);
    const includedCount = sheets.filter((s) => !s.excluded).length;
    if (shouldClearPrescreenOnDatasetReload(includedCount)) {
      setIndexCompleteness(null);
      setIndexPrescreenError(null);
      indexPrescreenKeyRef.current = "";
    } else if (display?.index_completeness) {
      setIndexCompleteness((prev) => prev ?? display.index_completeness ?? null);
    }
    const ids = [
      ...new Set(
        sheets.flatMap((s) => [s.source_document_id, s.image_document_id].filter(Boolean) as string[]),
      ),
    ];
    setSheetDocuments(await fetchDocumentsByIds(ids));
    try {
      const forms = await fetchModificationForms(projectId);
      setModificationForms(forms);
    } catch (err) {
      console.error("Error loading code modification forms:", err);
      setModificationForms([]);
    }
    try {
      setModificationReview(
        modificationDisplay ? await fetchModificationReviewForRun(modificationDisplay.id) : null,
      );
    } catch (err) {
      console.error("Error loading code modification review:", err);
      setModificationReview(null);
    }
    return { runs, sheets, display, current, hasAnalyzerRuns: hasStandardRuns };
  }, []);

  // Load runs/sheets once when the active project changes (or user becomes available).
  useEffect(() => {
    if (!selectedProjectId || !user) return;
    void reloadAnalyzerDataset(selectedProjectId);
  }, [selectedProjectId, user, reloadAnalyzerDataset]);

  // Fetch documents that have compliance annotations when project changes or after save
  useEffect(() => {
    if (!selectedProjectId || !user) {
      docsFetchGuardRef.current.invalidate();
      setDocumentsWithAnalysis([]);
      setLoadingDocsWithAnalysis(false);
      return;
    }
    const projectId = selectedProjectId;
    const fetchGen = docsFetchGuardRef.current.next();
    const fetchDocsWithAnalysis = async () => {
      setLoadingDocsWithAnalysis(true);
      try {
        const runs = await fetchAnalyzerRuns(projectId);
        if (!docsFetchGuardRef.current.isCurrent(fetchGen)) return;
        if (selectedProjectIdRef.current !== projectId) return;

        const { data: annotations, error } = await supabase
          .from("document_annotations")
          .select("document_id, data, analysis_run_id")
          .eq("project_id", projectId)
          .not("document_id", "is", null);

        if (error) throw error;
        if (!docsFetchGuardRef.current.isCurrent(fetchGen)) return;
        if (selectedProjectIdRef.current !== projectId) return;

        const hasStandardRuns = runs.some(isStandardComplianceRun);
        const standardRuns = runs.filter(isStandardComplianceRun);
        const runIdsWithFindings = collectRunIdsWithComplianceFindings(annotations ?? []);
        const hydrateResolution = resolveHydrateRun(
          standardRuns,
          ANALYSIS_TYPE_STANDARD,
          runIdsWithFindings,
        );
        setHydrateRunId(hydrateResolution.runId);
        setResultsFromHistoricalRun(hydrateResolution.isHistorical);

        const complianceDocIds = complianceDocumentIdsFromAnnotations(annotations ?? [], {
          hydrateRunId: hydrateResolution.runId,
          hasAnalyzerRuns: hasStandardRuns,
        });
        const docIds = Array.from(complianceDocIds);
        if (docIds.length === 0) {
          setDocumentsWithAnalysis([]);
          return;
        }

        const { data: docs, error: docsError } = await supabase
          .from("project_documents")
          .select("*")
          .eq("project_id", projectId)
          .in("id", docIds)
          .order("created_at", { ascending: false });

        if (docsError) throw docsError;
        if (!docsFetchGuardRef.current.isCurrent(fetchGen)) return;
        if (selectedProjectIdRef.current !== projectId) return;
        setDocumentsWithAnalysis((docs as ProjectDocument[]) || []);
      } catch (err) {
        console.error("Error fetching documents with analysis:", err);
        if (!docsFetchGuardRef.current.isCurrent(fetchGen)) return;
        if (selectedProjectIdRef.current !== projectId) return;
        setDocumentsWithAnalysis([]);
      } finally {
        if (docsFetchGuardRef.current.isCurrent(fetchGen)) {
          setLoadingDocsWithAnalysis(false);
        }
      }
    };
    void fetchDocsWithAnalysis();
  }, [selectedProjectId, user, analysisSavedAt]);

  const buildResultsFromAnnotations = useCallback(
    (complianceAnnotations: Array<{ id: string; data: unknown }>) => {
      const metadataByCodeType = new Map<string, ComplianceAnnotationData>();
      const issuesByCodeType = new Map<string, ComplianceIssue[]>();

      for (const ann of complianceAnnotations) {
        const d = ann.data as ComplianceAnnotationData;
        if (d.compliance_metadata) {
          metadataByCodeType.set(d.codeType || "ibc", d);
        } else if (d.compliance_issue && d.codeType) {
          const issue: ComplianceIssue = {
            id: d.id || ann.id,
            category: d.category || "",
            title: d.title || "",
            description: d.description || "",
            severity: (d.severity as ComplianceIssue["severity"]) || "advisory",
            codeReference: d.codeReference || "",
            codeYear: d.codeYear || "",
            location: d.location || "",
            suggestedFix: d.suggestedFix || "",
            codeType: d.codeType,
          };
          const list = issuesByCodeType.get(d.codeType) || [];
          list.push(issue);
          issuesByCodeType.set(d.codeType, list);
        }
      }

      const ibcMeta = metadataByCodeType.get("ibc");
      const localMeta = metadataByCodeType.get("local");
      const ibcIssues = issuesByCodeType.get("ibc") || [];
      const localIssues = issuesByCodeType.get("local") || [];

      const buildSummary = (issues: ComplianceIssue[], meta?: ComplianceAnnotationData) => {
        const critical = issues.filter((i) => i.severity === "critical").length;
        const warnings = issues.filter((i) => i.severity === "warning").length;
        const advisory = issues.filter((i) => i.severity === "advisory").length;
        // Never surface a stored/AI-echoed score (e.g. 85) when there are zero issues.
        if (issues.length === 0) {
          return { totalIssues: 0, critical: 0, warnings: 0, advisory: 0, overallScore: 100 };
        }
        const recomputed = computeComplianceOverallScore({
          critical,
          warnings,
          advisory,
          totalIssues: issues.length,
        });
        if (meta?.summary) {
          return {
            ...meta.summary,
            totalIssues: issues.length,
            critical,
            warnings,
            advisory,
            overallScore:
              typeof meta.summary.overallScore === "number"
                ? meta.summary.overallScore
                : recomputed,
          };
        }
        return {
          totalIssues: issues.length,
          critical,
          warnings,
          advisory,
          overallScore: recomputed,
        };
      };

      let loadedIbc: AnalysisResult | null = null;
      let loadedLocal: AnalysisResult | null = null;

      if (ibcIssues.length > 0 || ibcMeta) {
        loadedIbc = {
          issues: ibcIssues,
          summary: buildSummary(ibcIssues, ibcMeta),
          jurisdictionNotes: ibcMeta?.jurisdictionNotes || "",
          codeType: "ibc",
        };
      }
      if (localIssues.length > 0 || localMeta) {
        loadedLocal = {
          issues: localIssues,
          summary: buildSummary(localIssues, localMeta),
          jurisdictionNotes: localMeta?.jurisdictionNotes || "",
          codeType: "local",
        };
      }

      return { loadedIbc, loadedLocal, ibcIssues, localIssues };
    },
    [],
  );

  /**
   * Hydrate prior analyses from DB into resultGroups.
   * - Omit `documentIds` (or pass every analyzed id) to load All for the project.
   * - Pass a single id to ensure that document is available for the per-file filter.
   * Stale completions (after project switch / superseded request) are ignored.
   */
  const hydrateExistingAnalyses = useCallback(
    async (documentIds?: string[], opts?: { toastOnEmpty?: boolean }) => {
      if (!selectedProjectId || !user) return false;
      const projectId = selectedProjectId;
      const ids =
        documentIds && documentIds.length > 0
          ? documentIds
          : documentsWithAnalysis.map((d) => d.id);
      if (ids.length === 0) {
        if (!documentIds) {
          setLoadedExistingResults([]);
          setHydrateLoadFailed(false);
        }
        return false;
      }

      const hydrateGen = hydrateGuardRef.current.next();
      const isFullAllHydrate = !documentIds;
      setLoadingExisting(true);
      setHydrateLoadFailed(false);
      try {
        const { data: annotations, error } = await supabase
          .from("document_annotations")
          .select("*")
          .eq("project_id", projectId)
          .in("document_id", ids)
          .order("layer_order", { ascending: true });

        if (error) throw error;
        if (!hydrateGuardRef.current.isCurrent(hydrateGen)) return false;
        if (selectedProjectIdRef.current !== projectId) return false;

        const displayRunId = viewingHistoricalRunId ?? hydrateRunId;
        const filtered = filterAnnotationsForActiveAnalysis(
          (annotations || []).map((ann) => ({
            id: ann.id,
            analysis_run_id: (ann as { analysis_run_id?: string | null }).analysis_run_id ?? null,
            data: ann.data,
            document_id: ann.document_id,
          })),
          {
            currentRunId: displayRunId,
            hasAnalyzerRuns,
          },
        );

        const byDoc = new Map<string, Array<{ id: string; data: unknown }>>();
        for (const ann of filtered) {
          const documentId = (ann as { document_id?: string | null }).document_id;
          if (!documentId) continue;
          const list = byDoc.get(documentId) || [];
          list.push({ id: ann.id ?? documentId, data: ann.data });
          byDoc.set(documentId, list);
        }

        const loaded: LoadedExistingAnalysis[] = [];
        for (const documentId of ids) {
          const complianceAnnotations = byDoc.get(documentId) || [];
          if (complianceAnnotations.length === 0) continue;
          const { loadedIbc, loadedLocal } = buildResultsFromAnnotations(complianceAnnotations);
          if (!loadedIbc && !loadedLocal) continue;
          const doc = documentsWithAnalysis.find((d) => d.id === documentId);
          loaded.push({
            documentId,
            fileName: doc?.file_name ?? "Loaded document",
            ibcResult: loadedIbc,
            localResult: loadedLocal,
          });
        }

        if (!hydrateGuardRef.current.isCurrent(hydrateGen)) return false;
        if (selectedProjectIdRef.current !== projectId) return false;

        if (loaded.length === 0) {
          if (opts?.toastOnEmpty) {
            toast.info("No previous analysis found for this document");
          }
          if (isFullAllHydrate) {
            setLoadedExistingResults([]);
            setHydrateLoadFailed(true);
          }
          return false;
        }

        if (isFullAllHydrate) {
          // Full All hydrate — replace the hydrated set.
          setLoadedExistingResults(
            mergeLoadedExistingAnalyses([], loaded, "replace"),
          );
        } else {
          // Merge specific docs into the existing hydrate set.
          setLoadedExistingResults((prev) =>
            mergeLoadedExistingAnalyses(prev, loaded, "merge", ids),
          );
        }
        setHydrateLoadFailed(false);

        const primary = loaded[0];
        setActiveResultFileId(null);
        setActiveResultTab(primary.ibcResult ? "ibc" : "local");
        return true;
      } catch (err) {
        console.error("Error loading existing analysis:", err);
        if (!hydrateGuardRef.current.isCurrent(hydrateGen)) return false;
        if (selectedProjectIdRef.current !== projectId) return false;
        toast.error("Failed to load previous analysis");
        if (isFullAllHydrate) {
          setHydrateLoadFailed(true);
        }
        return false;
      } finally {
        if (hydrateGuardRef.current.isCurrent(hydrateGen)) {
          setLoadingExisting(false);
        }
      }
    },
    [selectedProjectId, user, documentsWithAnalysis, buildResultsFromAnnotations, hydrateRunId, viewingHistoricalRunId, hasAnalyzerRuns],
  );

  // When landing on / switching to All, hydrate every saved analysis for the project.
  // Keyed by document-id set so mid-batch re-renders do not wipe/refetch unnecessarily.
  // Only mark the key after a successful hydrate so failures can retry.
  const lastAllHydrateKeyRef = useRef<string>("");
  const documentsWithAnalysisHydrateKey = useMemo(
    () => complianceDocsHydrateKey(documentsWithAnalysis.map((d) => d.id)),
    [documentsWithAnalysis],
  );

  // Reset analyzer results when Active Project / ?projectId= changes (header or DesignCheck link).
  const previousProjectIdRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (previousProjectIdRef.current === undefined) {
      previousProjectIdRef.current = selectedProjectId;
      return;
    }
    if (previousProjectIdRef.current === selectedProjectId) return;
    previousProjectIdRef.current = selectedProjectId;
    docsFetchGuardRef.current.invalidate();
    hydrateGuardRef.current.invalidate();
    setShowNewProjectInput(false);
    setResultsDocumentFilter(COMPLIANCE_RESULTS_FILTER_ALL);
    setComplianceScoreFilter(COMPLIANCE_SCORE_FILTER_ALL);
    setLoadedExistingResults([]);
    setDocumentsWithAnalysis([]);
    setPersistedSheets([]);
    setSheetDocuments([]);
    setDisplayRun(null);
    setCurrentRun(null);
    setHasAnalyzerRuns(false);
    setFiles([]);
    setHydrateLoadFailed(false);
    setHydrateRunId(null);
    setResultsFromHistoricalRun(false);
    setActiveBatchRunId(null);
    setViewingHistoricalRunId(null);
    setAnalyzerRuns([]);
    setIndexCompleteness(null);
    setIndexPrescreenError(null);
    indexPrescreenKeyRef.current = "";
    lastAllHydrateKeyRef.current = "";
    setActiveResultFileId(null);
  }, [selectedProjectId]);

  useEffect(() => {
    if (!selectedProjectId || !user) {
      hydrateGuardRef.current.invalidate();
      setLoadedExistingResults([]);
      setHydrateLoadFailed(false);
      lastAllHydrateKeyRef.current = "";
      return;
    }
    if (resultsDocumentFilter !== COMPLIANCE_RESULTS_FILTER_ALL) return;
    // Wait for the analyzed-doc list before deciding All is empty (avoids mount race).
    if (loadingDocsWithAnalysis) return;
    const hydrateKey = documentsWithAnalysisHydrateKey;
    if (!hydrateKey) {
      setLoadedExistingResults([]);
      setHydrateLoadFailed(false);
      lastAllHydrateKeyRef.current = "";
      return;
    }
    if (lastAllHydrateKeyRef.current === hydrateKey) return;
    void hydrateExistingAnalyses().then((ok) => {
      if (ok && selectedProjectIdRef.current === selectedProjectId) {
        lastAllHydrateKeyRef.current = hydrateKey;
      }
    });
  }, [
    selectedProjectId,
    user,
    documentsWithAnalysisHydrateKey,
    resultsDocumentFilter,
    loadingDocsWithAnalysis,
    hydrateExistingAnalyses,
  ]);

  const handleResultsDocumentFilterChange = useCallback(
    async (value: string) => {
      const next = value || COMPLIANCE_RESULTS_FILTER_ALL;
      setResultsDocumentFilter(next);

      if (next === COMPLIANCE_RESULTS_FILTER_ALL) {
        // Explicit hydrate so selecting All always shows every saved analysis.
        const hydrateKey = complianceDocsHydrateKey(
          documentsWithAnalysis.map((d) => d.id),
        );
        if (documentsWithAnalysis.length > 0) {
          const ok = await hydrateExistingAnalyses();
          if (ok) lastAllHydrateKeyRef.current = hydrateKey;
          else lastAllHydrateKeyRef.current = "";
        } else {
          setLoadedExistingResults([]);
          setHydrateLoadFailed(false);
          lastAllHydrateKeyRef.current = "";
        }
        return;
      }

      const batchMatch = completedBatchFiles.find(
        (f) => f.documentId === next || f.id === next,
      );
      if (batchMatch) {
        setActiveResultFileId(batchMatch.id);
        return;
      }

      if (loadedExistingResults.some((l) => l.documentId === next)) {
        setActiveResultFileId(null);
        return;
      }

      // Not in the current session — load from DB so the filter has something to show.
      await hydrateExistingAnalyses([next], { toastOnEmpty: true });
    },
    [
      completedBatchFiles,
      loadedExistingResults,
      hydrateExistingAnalyses,
      documentsWithAnalysis,
    ],
  );

  /** Clear the upload queue for a new batch round; prior DB analyses stay in the dropdown. */
  const clearBatchForNewRound = useCallback(() => {
    setFiles([]);
    setBatchProgress(null);
    setDrawingUploadProgress(null);
    setActiveResultFileId(null);
    setResponses({});
    setResultsDocumentFilter(COMPLIANCE_RESULTS_FILTER_ALL);
    setComplianceScoreFilter(COMPLIANCE_SCORE_FILTER_ALL);
    // Re-show every saved analysis under All after clearing the session queue.
    lastAllHydrateKeyRef.current = "";
    if (documentsWithAnalysis.length > 0) {
      void hydrateExistingAnalyses().then((ok) => {
        if (ok) {
          lastAllHydrateKeyRef.current = complianceDocsHydrateKey(
            documentsWithAnalysis.map((d) => d.id),
          );
        }
      });
    } else {
      setLoadedExistingResults([]);
      setHydrateLoadFailed(false);
    }
    toast.info(
      "Selection cleared — prior analyses remain available under Load previously analyzed document",
    );
  }, [documentsWithAnalysis, hydrateExistingAnalyses]);

  // Recently used tracking
  const { recentItems: recentJurisdictions, addRecentItem: addRecentJurisdiction } = useRecentlyUsed(
    "compliance-recent-jurisdictions",
  );
  const { recentItems: recentProjectTypes, addRecentItem: addRecentProjectType } = useRecentlyUsed(
    "compliance-recent-project-types",
  );

  const handleCreateNewProject = async () => {
    if (!newProjectName.trim() || !user) return;
    setCreatingProject(true);
    try {
      const newProject = await createProject({ name: newProjectName.trim() });
      if (newProject) {
        setSelectedProjectId(newProject.id);
        setShowNewProjectInput(false);
        setNewProjectName("");
      }
    } finally {
      setCreatingProject(false);
    }
  };

  // Handle jurisdiction change with recent tracking
  const handleJurisdictionChange = useCallback(
    (value: string) => {
      setJurisdiction(value);
      addRecentJurisdiction(value);
      if (!isDcJurisdiction(value)) {
        setAnalysisKind("standard");
      }
      // Auto-set mode to both if jurisdiction has amendments
      if (JURISDICTIONS_WITH_AMENDMENTS.includes(value)) {
        setAnalysisMode("both");
      } else {
        setAnalysisMode("ibc");
      }
    },
    [addRecentJurisdiction],
  );

  // Handle project type change with recent tracking
  const handleProjectTypeChange = useCallback(
    (value: string) => {
      setProjectType(value);
      addRecentProjectType(value);
    },
    [addRecentProjectType],
  );

  // Base jurisdiction options with grouping
  const baseJurisdictionOptions: ComboboxOption[] = useMemo(
    () => [
      // General
      { value: "general", label: "General IBC (International Building Code)", group: "General" },

      // Northeast
      { value: "new-york-city", label: "New York City (NYC Building Code)", group: "Northeast" },
      { value: "new-york-state", label: "New York State (Uniform Code)", group: "Northeast" },
      { value: "boston", label: "Boston, MA", group: "Northeast" },
      { value: "massachusetts", label: "Massachusetts (780 CMR)", group: "Northeast" },
      { value: "philadelphia", label: "Philadelphia, PA", group: "Northeast" },
      { value: "pittsburgh", label: "Pittsburgh, PA", group: "Northeast" },
      { value: "new-jersey", label: "New Jersey (UCC)", group: "Northeast" },
      { value: "connecticut", label: "Connecticut (State Building Code)", group: "Northeast" },
      { value: "rhode-island", label: "Rhode Island", group: "Northeast" },
      { value: "vermont", label: "Vermont", group: "Northeast" },
      { value: "new-hampshire", label: "New Hampshire", group: "Northeast" },
      { value: "maine", label: "Maine", group: "Northeast" },

      // Mid-Atlantic / DC Area
      { value: "dc", label: "Washington D.C. (12A DCMR)", group: "Mid-Atlantic" },
      { value: "maryland", label: "Maryland (MSBC)", group: "Mid-Atlantic" },
      { value: "montgomery-county-md", label: "Montgomery County, MD", group: "Mid-Atlantic" },
      { value: "prince-georges-county-md", label: "Prince George's County, MD", group: "Mid-Atlantic" },
      { value: "baltimore", label: "Baltimore City, MD", group: "Mid-Atlantic" },
      { value: "arlington-va", label: "Arlington County, VA", group: "Mid-Atlantic" },
      { value: "fairfax-va", label: "Fairfax County, VA", group: "Mid-Atlantic" },
      { value: "virginia", label: "Virginia (USBC)", group: "Mid-Atlantic" },
      { value: "delaware", label: "Delaware", group: "Mid-Atlantic" },

      // Southeast
      { value: "florida", label: "Florida Building Code (FBC)", group: "Southeast" },
      { value: "miami-dade", label: "Miami-Dade County, FL (HVHZ)", group: "Southeast" },
      { value: "broward", label: "Broward County, FL", group: "Southeast" },
      { value: "orlando", label: "Orlando, FL", group: "Southeast" },
      { value: "tampa", label: "Tampa, FL", group: "Southeast" },
      { value: "jacksonville", label: "Jacksonville, FL", group: "Southeast" },
      { value: "georgia", label: "Georgia (State Codes)", group: "Southeast" },
      { value: "atlanta", label: "Atlanta, GA", group: "Southeast" },
      { value: "north-carolina", label: "North Carolina", group: "Southeast" },
      { value: "charlotte", label: "Charlotte, NC", group: "Southeast" },
      { value: "raleigh", label: "Raleigh, NC", group: "Southeast" },
      { value: "south-carolina", label: "South Carolina", group: "Southeast" },
      { value: "charleston", label: "Charleston, SC", group: "Southeast" },
      { value: "tennessee", label: "Tennessee", group: "Southeast" },
      { value: "nashville", label: "Nashville, TN", group: "Southeast" },
      { value: "alabama", label: "Alabama", group: "Southeast" },
      { value: "louisiana", label: "Louisiana", group: "Southeast" },
      { value: "new-orleans", label: "New Orleans, LA", group: "Southeast" },
      { value: "mississippi", label: "Mississippi", group: "Southeast" },

      // Midwest
      { value: "chicago", label: "Chicago (Chicago Building Code)", group: "Midwest" },
      { value: "illinois", label: "Illinois", group: "Midwest" },
      { value: "ohio", label: "Ohio", group: "Midwest" },
      { value: "columbus", label: "Columbus, OH", group: "Midwest" },
      { value: "cleveland", label: "Cleveland, OH", group: "Midwest" },
      { value: "cincinnati", label: "Cincinnati, OH", group: "Midwest" },
      { value: "michigan", label: "Michigan", group: "Midwest" },
      { value: "detroit", label: "Detroit, MI", group: "Midwest" },
      { value: "indiana", label: "Indiana", group: "Midwest" },
      { value: "indianapolis", label: "Indianapolis, IN", group: "Midwest" },
      { value: "wisconsin", label: "Wisconsin", group: "Midwest" },
      { value: "milwaukee", label: "Milwaukee, WI", group: "Midwest" },
      { value: "minnesota", label: "Minnesota", group: "Midwest" },
      { value: "minneapolis", label: "Minneapolis, MN", group: "Midwest" },
      { value: "missouri", label: "Missouri", group: "Midwest" },
      { value: "kansas-city", label: "Kansas City, MO", group: "Midwest" },
      { value: "st-louis", label: "St. Louis, MO", group: "Midwest" },
      { value: "iowa", label: "Iowa", group: "Midwest" },
      { value: "kansas", label: "Kansas", group: "Midwest" },
      { value: "nebraska", label: "Nebraska", group: "Midwest" },
      { value: "north-dakota", label: "North Dakota", group: "Midwest" },
      { value: "south-dakota", label: "South Dakota", group: "Midwest" },

      // Southwest
      { value: "texas", label: "Texas", group: "Southwest" },
      { value: "houston", label: "Houston, TX", group: "Southwest" },
      { value: "dallas", label: "Dallas, TX", group: "Southwest" },
      { value: "austin", label: "Austin, TX", group: "Southwest" },
      { value: "san-antonio", label: "San Antonio, TX", group: "Southwest" },
      { value: "fort-worth", label: "Fort Worth, TX", group: "Southwest" },
      { value: "arizona", label: "Arizona", group: "Southwest" },
      { value: "phoenix", label: "Phoenix, AZ", group: "Southwest" },
      { value: "tucson", label: "Tucson, AZ", group: "Southwest" },
      { value: "scottsdale", label: "Scottsdale, AZ", group: "Southwest" },
      { value: "new-mexico", label: "New Mexico", group: "Southwest" },
      { value: "albuquerque", label: "Albuquerque, NM", group: "Southwest" },
      { value: "oklahoma", label: "Oklahoma", group: "Southwest" },
      { value: "oklahoma-city", label: "Oklahoma City, OK", group: "Southwest" },
      { value: "arkansas", label: "Arkansas", group: "Southwest" },

      // West
      { value: "california", label: "California (CBC/Title 24)", group: "West" },
      { value: "los-angeles", label: "Los Angeles, CA (LAMC)", group: "West" },
      { value: "san-francisco", label: "San Francisco, CA", group: "West" },
      { value: "san-diego", label: "San Diego, CA", group: "West" },
      { value: "san-jose", label: "San Jose, CA", group: "West" },
      { value: "sacramento", label: "Sacramento, CA", group: "West" },
      { value: "oakland", label: "Oakland, CA", group: "West" },
      { value: "long-beach", label: "Long Beach, CA", group: "West" },
      { value: "nevada", label: "Nevada", group: "West" },
      { value: "las-vegas", label: "Las Vegas, NV (Clark County)", group: "West" },
      { value: "reno", label: "Reno, NV", group: "West" },
      { value: "colorado", label: "Colorado", group: "West" },
      { value: "denver", label: "Denver, CO", group: "West" },
      { value: "utah", label: "Utah", group: "West" },
      { value: "salt-lake-city", label: "Salt Lake City, UT", group: "West" },
      { value: "idaho", label: "Idaho", group: "West" },
      { value: "boise", label: "Boise, ID", group: "West" },
      { value: "montana", label: "Montana", group: "West" },
      { value: "wyoming", label: "Wyoming", group: "West" },

      // Pacific Northwest
      { value: "washington", label: "Washington State", group: "Pacific Northwest" },
      { value: "seattle", label: "Seattle, WA", group: "Pacific Northwest" },
      { value: "tacoma", label: "Tacoma, WA", group: "Pacific Northwest" },
      { value: "oregon", label: "Oregon", group: "Pacific Northwest" },
      { value: "portland", label: "Portland, OR", group: "Pacific Northwest" },
      { value: "alaska", label: "Alaska", group: "Pacific Northwest" },
      { value: "anchorage", label: "Anchorage, AK", group: "Pacific Northwest" },

      // Hawaii & Territories
      { value: "hawaii", label: "Hawaii", group: "Hawaii & Territories" },
      { value: "honolulu", label: "Honolulu, HI", group: "Hawaii & Territories" },
      { value: "puerto-rico", label: "Puerto Rico", group: "Hawaii & Territories" },
      { value: "guam", label: "Guam", group: "Hawaii & Territories" },
    ],
    [],
  );

  // Jurisdiction options with recently used at top
  const jurisdictionOptions: ComboboxOption[] = useMemo(() => {
    if (recentJurisdictions.length === 0) return baseJurisdictionOptions;

    const recentOptions: ComboboxOption[] = [];
    for (const value of recentJurisdictions) {
      const option = baseJurisdictionOptions.find((o) => o.value === value);
      if (option) {
        recentOptions.push({ value: option.value, label: option.label, group: "⏱️ Recently Used" });
      }
    }

    return [...recentOptions, ...baseJurisdictionOptions];
  }, [baseJurisdictionOptions, recentJurisdictions]);

  // Base project type options with grouping
  const baseProjectTypeOptions: ComboboxOption[] = useMemo(
    () => [
      // Residential
      { value: "single-family", label: "Single-Family Residential", group: "Residential" },
      { value: "two-family", label: "Two-Family / Duplex", group: "Residential" },
      { value: "townhouse", label: "Townhouse / Rowhouse", group: "Residential" },
      { value: "multi-family", label: "Multi-Family Residential (3+ units)", group: "Residential" },
      { value: "apartment", label: "Apartment Building", group: "Residential" },
      { value: "condominium", label: "Condominium", group: "Residential" },
      { value: "adu", label: "Accessory Dwelling Unit (ADU)", group: "Residential" },
      { value: "residential-addition", label: "Residential Addition", group: "Residential" },
      { value: "residential-renovation", label: "Residential Renovation/Alteration", group: "Residential" },

      // Commercial
      { value: "commercial", label: "Commercial (General)", group: "Commercial" },
      { value: "office", label: "Office Building", group: "Commercial" },
      { value: "retail", label: "Retail / Mercantile", group: "Commercial" },
      { value: "restaurant", label: "Restaurant / Food Service", group: "Commercial" },
      { value: "hotel", label: "Hotel / Motel", group: "Commercial" },
      { value: "mixed-use", label: "Mixed-Use Development", group: "Commercial" },
      { value: "tenant-improvement", label: "Tenant Improvement (TI)", group: "Commercial" },
      { value: "shell-core", label: "Shell & Core", group: "Commercial" },

      // Industrial
      { value: "industrial", label: "Industrial (General)", group: "Industrial" },
      { value: "warehouse", label: "Warehouse / Distribution", group: "Industrial" },
      { value: "manufacturing", label: "Manufacturing Facility", group: "Industrial" },
      { value: "data-center", label: "Data Center", group: "Industrial" },
      { value: "laboratory", label: "Laboratory / R&D", group: "Industrial" },
      { value: "cold-storage", label: "Cold Storage / Refrigerated", group: "Industrial" },

      // Healthcare
      { value: "healthcare", label: "Healthcare (General)", group: "Healthcare" },
      { value: "hospital", label: "Hospital", group: "Healthcare" },
      { value: "medical-office", label: "Medical Office Building", group: "Healthcare" },
      { value: "urgent-care", label: "Urgent Care / Clinic", group: "Healthcare" },
      { value: "assisted-living", label: "Assisted Living / Senior Care", group: "Healthcare" },
      { value: "nursing-home", label: "Nursing Home / Skilled Nursing", group: "Healthcare" },

      // Educational
      { value: "education", label: "Educational (General)", group: "Educational" },
      { value: "k12-school", label: "K-12 School", group: "Educational" },
      { value: "university", label: "University / College", group: "Educational" },
      { value: "daycare", label: "Daycare / Childcare Center", group: "Educational" },

      // Institutional
      { value: "religious", label: "Religious / Place of Worship", group: "Institutional" },
      { value: "government", label: "Government Building", group: "Institutional" },
      { value: "courthouse", label: "Courthouse", group: "Institutional" },
      { value: "library", label: "Library", group: "Institutional" },
      { value: "museum", label: "Museum / Gallery", group: "Institutional" },
      { value: "community-center", label: "Community Center", group: "Institutional" },

      // Assembly
      { value: "assembly", label: "Assembly (General)", group: "Assembly" },
      { value: "theater", label: "Theater / Performing Arts", group: "Assembly" },
      { value: "arena", label: "Arena / Stadium", group: "Assembly" },
      { value: "convention-center", label: "Convention Center", group: "Assembly" },
      { value: "nightclub", label: "Nightclub / Bar", group: "Assembly" },
      { value: "recreation", label: "Recreation / Fitness Center", group: "Assembly" },

      // Specialty
      { value: "parking-garage", label: "Parking Garage / Structure", group: "Specialty" },
      { value: "gas-station", label: "Gas Station / Auto Service", group: "Specialty" },
      { value: "car-wash", label: "Car Wash", group: "Specialty" },
      { value: "self-storage", label: "Self-Storage Facility", group: "Specialty" },
      { value: "agricultural", label: "Agricultural Building", group: "Specialty" },
      { value: "utility", label: "Utility / Infrastructure", group: "Specialty" },

      // Site Work
      { value: "deck", label: "Deck / Patio", group: "Site Work" },
      { value: "fence", label: "Fence / Retaining Wall", group: "Site Work" },
      { value: "pool", label: "Swimming Pool / Spa", group: "Site Work" },
      { value: "solar", label: "Solar Panel Installation", group: "Site Work" },
      { value: "ev-charger", label: "EV Charger Installation", group: "Site Work" },
      { value: "demolition", label: "Demolition", group: "Site Work" },
      { value: "grading", label: "Grading / Excavation", group: "Site Work" },
    ],
    [],
  );

  // Project type options with recently used at top
  const projectTypeOptions: ComboboxOption[] = useMemo(() => {
    if (recentProjectTypes.length === 0) return baseProjectTypeOptions;

    const recentOptions: ComboboxOption[] = [];
    for (const value of recentProjectTypes) {
      const option = baseProjectTypeOptions.find((o) => o.value === value);
      if (option) {
        recentOptions.push({ value: option.value, label: option.label, group: "⏱️ Recently Used" });
      }
    }

    return [...recentOptions, ...baseProjectTypeOptions];
  }, [baseProjectTypeOptions, recentProjectTypes]);

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  }, []);

  const markAllCurrentRunsStaleInUi = useCallback(() => {
    setDisplayRun((prev) => (prev && prev.status === "current" ? { ...prev, status: "stale" } : prev));
    setCurrentRun(null);
    setModificationDisplayRun((prev) =>
      prev && prev.status === "current" ? { ...prev, status: "stale" } : prev,
    );
    setModificationCurrentRun(null);
  }, []);

  const appendBatchFile = useCallback((file: File, preview: string | null) => {
    setFiles((prev) => [
      ...prev,
      {
        id: createComplianceBatchFileId(),
        file,
        preview,
        discipline: "general",
        status: "pending",
      },
    ]);
    if (
      selectedProjectId &&
      (currentRun ||
        displayRun ||
        modificationCurrentRun ||
        modificationDisplayRun ||
        persistedSheets.length > 0)
    ) {
      void markCurrentRunStale(selectedProjectId).then(() => {
        markAllCurrentRunsStaleInUi();
      });
    }
  }, [
    selectedProjectId,
    currentRun,
    displayRun,
    modificationCurrentRun,
    modificationDisplayRun,
    persistedSheets.length,
    markAllCurrentRunsStaleInUi,
  ]);

  const processFiles = useCallback(
    (fileList: FileList | File[]) => {
      const validTypes = ["image/png", "image/jpeg", "image/jpg", "image/webp", "application/pdf"];
      const incoming = Array.from(fileList);
      const { accepted, rejectedCount } = mergeComplianceFiles(files.length, incoming);

      if (rejectedCount > 0) {
        toast.error(
          `Upload limit is ${COMPLIANCE_MAX_BATCH_FILES} source documents per drop. ${rejectedCount} document(s) were not added.`,
        );
      }

      for (const file of accepted) {
        if (!validTypes.includes(file.type)) {
          toast.error(`${file.name}: Invalid file type. Use PNG, JPEG, or PDF.`);
          continue;
        }

        if (file.size > MAX_FILE_SIZE_BYTES) {
          toast.error(`${file.name}: File exceeds ${MAX_FILE_SIZE_MB}MB limit`);
          continue;
        }

        if (file.type.startsWith("image/")) {
          const reader = new FileReader();
          reader.onload = (e) => {
            appendBatchFile(file, e.target?.result as string);
          };
          reader.readAsDataURL(file);
        } else {
          appendBatchFile(file, null);
        }
      }
    },
    [appendBatchFile, files.length],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragActive(false);

      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        processFiles(e.dataTransfer.files);
      }
    },
    [processFiles],
  );

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files.length > 0) {
        processFiles(e.target.files);
      }
    },
    [processFiles],
  );

  const removeFile = (id: string) => {
    setFiles((prev) => {
      const target = prev.find((f) => f.id === id);
      if (!target || !canRemoveBatchFile(target.status)) {
        return prev;
      }
      return prev.filter((f) => f.id !== id);
    });
  };

  const updateFileDiscipline = useCallback((id: string, discipline: DocumentDiscipline) => {
    setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, discipline } : f)));
  }, []);

  /** Save AI analysis results to document_annotations for the active run (replace, don't append). */
  const saveAnalysisToDb = useCallback(
    async (
      result: AnalysisResult,
      docId: string,
      projId: string,
      sheet?: { sheetId?: string; pageNumber?: number; sourceDocumentId?: string },
    ) => {
      if (!user) return;
      const runId = analysisRunIdRef.current;
      if (!runId) {
        toast.error("Analysis run is missing; results were not saved");
        return;
      }
      try {
        await replaceComplianceFindingsForSheet({
          userId: user.id,
          projectId: projId,
          documentId: docId,
          runId,
          result,
          jurisdiction,
          projectType,
          codeYear,
          sheetId: sheet?.sheetId,
          pageNumber: sheet?.pageNumber,
          sourceDocumentId: sheet?.sourceDocumentId,
        });
      } catch (err) {
        console.error("Error saving analysis to DB:", err);
        toast.error("Analysis saved to UI but failed to persist to database");
      }
    },
    [user, jurisdiction, projectType, codeYear]
  );

  const requestDrawingAnalysis = useCallback(
    async (opts: {
      imageBase64: string;
      imageType: string;
      codeType: "ibc" | "local" | "both";
      disciplines: DocumentDiscipline[];
    }): Promise<unknown> => {
      const {
        data: { session: authSession },
      } = await supabase.auth.getSession();
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (authSession?.access_token) {
        headers.Authorization = `Bearer ${authSession.access_token}`;
      }
      const API_BASE_URL = getScraperBaseUrl();
      const response = await fetch(`${API_BASE_URL}/api/analyze-drawing`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          imageBase64: opts.imageBase64,
          imageType: opts.imageType,
          jurisdiction: jurisdiction === "general" ? null : jurisdiction,
          projectType,
          codeYear,
          codeType: opts.codeType,
          disciplines: opts.disciplines,
          analysisInstructions: analysisInstructions.trim() || undefined,
        }),
      });

      let data: { error?: string };
      try {
        data = await response.json();
      } catch {
        throw new Error(`Analysis service returned an invalid response (HTTP ${response.status})`);
      }

      if (!response.ok) {
        throw new Error(data?.error || `Analysis failed (HTTP ${response.status})`);
      }

      if (data && typeof data === "object" && "error" in data && data.error) {
        throw new Error(typeof data.error === "string" ? data.error : "Analysis failed");
      }

      return data;
    },
    [jurisdiction, projectType, codeYear, analysisInstructions],
  );

  const runBatchAnalysis = useCallback(
    async (onlyFailed = false) => {
      if (selectedProjectId && !user) {
        toast.error("You must be logged in to save analysis to a project");
        return;
      }

      const pendingFiles = files.filter((f) => f.status === "pending");
      const failedFiles = files.filter((f) => f.status === "failed");
      if (onlyFailed && failedFiles.length === 0) {
        toast.info("No failed sheets to retry");
        return;
      }
      if (
        !onlyFailed &&
        pendingFiles.length === 0 &&
        persistedSheets.filter((s) => !s.excluded).length === 0 &&
        documentsWithAnalysis.length === 0
      ) {
        toast.info("No sheets ready to analyze");
        return;
      }

      setAnalyzing(true);
      if (!onlyFailed) {
        setResponses({});
        setActiveResultFileId(null);
        setResultsDocumentFilter(COMPLIANCE_RESULTS_FILTER_ALL);
        setComplianceScoreFilter(COMPLIANCE_SCORE_FILTER_ALL);
        setLoadedExistingResults([]);
        setViewingHistoricalRunId(null);
        setResultsFromHistoricalRun(false);
        lastAllHydrateKeyRef.current = "";
      }

      try {
        let sheets = persistedSheets;

        if (!onlyFailed && selectedProjectId && user && pendingFiles.length > 0) {
          if (sheets.length === 0 && documentsWithAnalysis.length > 0) {
            for (const doc of documentsWithAnalysis) {
              const already = sheets.some((s) => s.source_document_id === doc.id);
              if (already) continue;
              await insertAnalyzerSheet({
                project_id: selectedProjectId,
                source_document_id: doc.id,
                image_document_id: doc.id,
                page_number: 1,
                file_name: doc.file_name,
                discipline: "general",
                excluded: false,
              });
            }
            sheets = await fetchAnalyzerSheets(selectedProjectId);
          }

          const persistUpload = async (opts: {
            file: File;
            document_type: string;
            description: string;
            parent_document_id?: string;
          }) => {
            const doc = await uploadDocument({
              file: opts.file,
              document_type: opts.document_type as ProjectDocument["document_type"],
              description: opts.description,
              parent_document_id: opts.parent_document_id,
              suppressToasts: true,
            });
            if (doc) await fetchDocuments();
            return doc;
          };

          setDrawingUploadProgress({
            total: pendingFiles.length,
            completed: 0,
            currentIndex: 1,
            currentFileName: pendingFiles[0]?.file.name,
            phase: "uploading",
          });

          const persisted = await persistPendingAnalyzerSources({
            projectId: selectedProjectId,
            pendingFiles,
            existingSheets: sheets,
            uploadDocument: persistUpload,
            renderPdfPages: pdfPagesToImageFiles,
            onUploadProgress: setDrawingUploadProgress,
          });
          for (const warning of persisted.warnings) toast.warning(warning);

          const uploadSucceeded = pendingFiles.length - persisted.failedSources.length;
          const uploadToast = formatUploadCompletionToast({
            total: pendingFiles.length,
            succeeded: uploadSucceeded,
            failed: persisted.failedSources.length,
            singleFileName:
              pendingFiles.length === 1 ? pendingFiles[0]?.file.name : undefined,
          });
          if (uploadToast) {
            if (uploadToast.type === "success") toast.success(uploadToast.message);
            else if (uploadToast.type === "warning") toast.warning(uploadToast.message);
            else toast.error(uploadToast.message);
          }

          if (shouldClearUploadProgress({
            total: pendingFiles.length,
            completed: pendingFiles.length,
            currentIndex: pendingFiles.length,
            phase: "complete",
          })) {
            setDrawingUploadProgress(null);
          }

          if (uploadSucceeded === 0) {
            setFiles((prev) =>
              prev.map((f) => {
                const failed = persisted.failedSources.find((fs) => fs.id === f.id);
                if (failed) return { ...f, status: "failed" as const, error: failed.error };
                return f;
              }),
            );
            return;
          }

          sheets = [...sheets, ...persisted.sheets];
          setPersistedSheets(sheets);
          setFiles((prev) =>
            prev
              .map((f) => {
                const failed = persisted.failedSources.find((fs) => fs.id === f.id);
                if (failed) return { ...f, status: "failed" as const, error: failed.error };
                return f;
              })
              .filter((f) => f.status === "failed"),
          );
        }

        const included = sheets.filter((s) => !s.excluded);
        const canPersist = Boolean(selectedProjectId && user);

        let batchFiles: UploadedFile[] = [];
        let lazySheetDocsById: Map<string, ProjectDocument> | null = null;

        const buildPersistedBatchFiles = async (
          targetSheets: CodeAnalyzerSheet[],
          status: ComplianceBatchFileStatus,
        ): Promise<Map<string, ProjectDocument>> => {
          const docsById = new Map(sheetDocuments.map((d) => [d.id, d]));
          const missingIds = targetSheets
            .flatMap((s) => [s.image_document_id, s.source_document_id])
            .filter((id): id is string => Boolean(id) && !docsById.has(id));
          if (missingIds.length > 0) {
            const fetched = await fetchDocumentsByIds(missingIds);
            for (const doc of fetched) docsById.set(doc.id, doc);
            setSheetDocuments((prev) => {
              const next = new Map(prev.map((d) => [d.id, d]));
              for (const doc of fetched) next.set(doc.id, doc);
              return Array.from(next.values());
            });
          }
          batchFiles = targetSheets.map((sheet) => {
            const imageDoc =
              (sheet.image_document_id && docsById.get(sheet.image_document_id)) ||
              (sheet.source_document_id ? docsById.get(sheet.source_document_id) : undefined);
            const fileName = sheet.file_name ?? imageDoc?.file_name ?? `Sheet p.${sheet.page_number}`;
            return {
              id: sheet.id,
              fileName,
              preview: null,
              discipline: coerceDocumentDiscipline(sheet.discipline),
              status,
              documentId: imageDoc?.id,
              sheetId: sheet.id,
              pageNumber: sheet.page_number,
              sourceDocumentId: sheet.source_document_id,
            };
          });
          return docsById;
        };

        if (onlyFailed && canPersist && included.length > 0) {
          const failedIds = new Set(failedFiles.map((f) => f.id));
          const failedSheets = included.filter((s) => failedIds.has(s.id));
          if (failedSheets.length === 0) {
            toast.info("No failed sheets to retry");
            return;
          }
          lazySheetDocsById = await buildPersistedBatchFiles(failedSheets, "failed");
        } else if (onlyFailed) {
          batchFiles = failedFiles;
        } else if (canPersist && included.length > 0) {
          lazySheetDocsById = await buildPersistedBatchFiles(included, "pending");
        } else {
          // No project: expand PDFs in memory so we still do not drop pages 2+.
          const expanded: UploadedFile[] = [];
          for (const pending of pendingFiles) {
            const isPdf =
              pending.file.type === "application/pdf" || pending.file.name.toLowerCase().endsWith(".pdf");
            if (isPdf) {
              const rendered = await pdfPagesToImageFiles(pending.file);
              if (rendered.truncated) {
                toast.warning(
                  `${pending.file.name} has ${rendered.totalPages} pages; analyzing the first ${rendered.pages.length}.`,
                );
              }
              for (const page of rendered.pages) {
                expanded.push({
                  id: `${pending.id}-p${page.pageNumber}`,
                  file: page.file,
                  preview: null,
                  discipline: pending.discipline,
                  status: "pending",
                  preparedImageFile: page.file,
                  pageNumber: page.pageNumber,
                });
              }
            } else {
              expanded.push({ ...pending, preparedImageFile: pending.file });
            }
          }
          batchFiles = expanded;
        }

        if (batchFiles.length === 0) {
          toast.info("No included sheets to analyze");
          return;
        }

        if (canPersist && selectedProjectId && user && !onlyFailed) {
          const run = await createAnalyzerRun({
            projectId: selectedProjectId,
            userId: user.id,
            jurisdiction,
            projectType,
            codeYear,
            analysisMode,
            sourceFingerprint: computeStandardRunFingerprint(sheets, analysisInstructions),
            analysisInstructions,
            indexCompleteness: indexCompleteness ?? undefined,
          });
          analysisRunIdRef.current = run.id;
          setActiveBatchRunId(run.id);
          setHydrateRunId(run.id);
          setDisplayRun(run);
          setCurrentRun(null);
        } else if (onlyFailed && !analysisRunIdRef.current && displayRun?.id) {
          analysisRunIdRef.current = displayRun.id;
          setActiveBatchRunId(displayRun.id);
          setHydrateRunId(displayRun.id);
        }

        setBatchRetrying(onlyFailed);
        setBatchProgress({ total: batchFiles.length, completed: 0, currentIndex: 1 });
        setFiles(batchFiles);

        const fetchSheetImage =
          lazySheetDocsById && canPersist
            ? async (item: ComplianceBatchFile) => {
                const imageDoc =
                  (item.documentId && lazySheetDocsById!.get(item.documentId)) ||
                  (item.sourceDocumentId ? lazySheetDocsById!.get(item.sourceDocumentId) : undefined);
                if (!imageDoc) {
                  throw new Error(
                    `Missing image for ${item.fileName ?? "drawing"}${item.pageNumber ? ` p.${item.pageNumber}` : ""}`,
                  );
                }
                const url = await getDownloadUrl(imageDoc);
                if (!url) throw new Error(`Could not download ${imageDoc.file_name}`);
                const response = await fetch(url);
                const blob = await response.blob();
                const imageFile = new File([blob], imageDoc.file_name, {
                  type: imageDoc.file_type || blob.type || "image/png",
                });
                return { file: imageFile, preparedImageFile: imageFile };
              }
            : undefined;

        const { succeeded, failed } = await processComplianceBatch({
          files: batchFiles,
          onlyFailed,
          fetchSheetImage,
          analysisMode,
          hasLocalAmendments,
          jurisdiction,
          projectType,
          codeYear,
          projectId: selectedProjectId,
          canPersist,
          uploadDocument: async () => null,
          requestAnalysis: requestDrawingAnalysis,
          saveAnalysisToDb: saveAnalysisToDb,
          onFileUpdate: (id, patch) => {
            setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, ...patch } : f)));
          },
          onProgress: setBatchProgress,
        });

        if (canPersist && analysisRunIdRef.current) {
          await completeAnalyzerRun(analysisRunIdRef.current, succeeded > 0 ? "current" : "failed");
        }

        setFiles((prev) => prev.filter((f) => f.status === "failed"));
        setActiveBatchRunId(null);
        analysisRunIdRef.current = null;
        setAnalysisSavedAt(Date.now());
        if (selectedProjectId) {
          await reloadAnalyzerDataset(selectedProjectId);
          lastAllHydrateKeyRef.current = "";
          void hydrateExistingAnalyses();
        }

        const completionToast = formatAnalysisCompletionToast({
          total: batchFiles.length,
          succeeded,
          failed,
        });
        if (completionToast.type === "success") toast.success(completionToast.message);
        else if (completionToast.type === "warning") toast.warning(completionToast.message);
        else toast.error(completionToast.message);
      } catch (err) {
        console.error("Batch analysis error:", err);
        toast.error(err instanceof Error ? err.message : "Failed to analyze drawings");
        setDrawingUploadProgress(null);
        const failedRunId = analysisRunIdRef.current;
        setActiveBatchRunId(null);
        analysisRunIdRef.current = null;
        if (failedRunId && selectedProjectId) {
          await completeAnalyzerRun(failedRunId, "failed").catch(() => undefined);
        }
      } finally {
        setBatchRetrying(false);
        setAnalyzing(false);
        setDrawingUploadProgress(null);
      }
    },
    [
      analysisMode,
      analysisInstructions,
      indexCompleteness,
      codeYear,
      displayRun?.id,
      documentsWithAnalysis,
      fetchDocuments,
      files,
      getDownloadUrl,
      hasLocalAmendments,
      jurisdiction,
      persistedSheets,
      projectType,
      reloadAnalyzerDataset,
      requestDrawingAnalysis,
      saveAnalysisToDb,
      hydrateExistingAnalyses,
      selectedProjectId,
      sheetDocuments,
      uploadDocument,
      user,
    ],
  );

  const runModificationReview = useCallback(async () => {
    if (!selectedProjectId || !user) {
      toast.error("Select a project and log in to run Code Modification Review");
      return;
    }
    if (!isDcJurisdiction(jurisdiction)) {
      toast.error("DC Code Modification Review is only available for Washington, D.C.");
      return;
    }
    if (modificationForms.length === 0) {
      toast.error("Upload at least one DC Code Modification document first");
      return;
    }

    setAnalyzing(true);
    try {
      const persistUpload = async (opts: {
        file: File;
        document_type: string;
        description: string;
        parent_document_id?: string;
      }) => {
        const doc = await uploadDocument({
          file: opts.file,
          document_type: opts.document_type as ProjectDocument["document_type"],
          description: opts.description,
          parent_document_id: opts.parent_document_id,
        });
        if (doc) await fetchDocuments();
        return doc;
      };

      const { review, forms } = await runDcCodeModificationReview({
        projectId: selectedProjectId,
        userId: user.id,
        jurisdiction,
        projectType,
        codeYear,
        persistedSheets,
        pendingDrawingFiles: files
          .filter((f) => f.status === "pending")
          .map((f) => ({ id: f.id, file: f.file, discipline: f.discipline })),
        sheetDocuments,
        modificationForms,
        analysisInstructions,
        getDownloadUrl,
        persistUpload,
      });
      setModificationReview(review);
      setModificationForms(forms);
      setFiles((prev) => prev.filter((f) => f.status === "failed"));
      await reloadAnalyzerDataset(selectedProjectId);
      toast.success("Code Modification Review complete");
    } catch (err) {
      console.error("Code modification review error:", err);
      toast.error(err instanceof Error ? err.message : "Failed to run Code Modification Review");
    } finally {
      setAnalyzing(false);
    }
  }, [
    codeYear,
    fetchDocuments,
    files,
    getDownloadUrl,
    jurisdiction,
    modificationForms,
    analysisInstructions,
    persistedSheets,
    projectType,
    reloadAnalyzerDataset,
    selectedProjectId,
    sheetDocuments,
    uploadDocument,
    user,
  ]);

  const markModificationReviewStale = useCallback(async () => {
    if (!selectedProjectId) return;
    await markCurrentRunStale(selectedProjectId, ANALYSIS_TYPE_DC_MODIFICATION);
    setModificationDisplayRun((prev) =>
      prev && prev.status === "current" ? { ...prev, status: "stale" } : prev,
    );
    setModificationCurrentRun(null);
  }, [selectedProjectId]);

  const handleModificationFormChange = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const selectedFiles = Array.from(event.target.files ?? []);
      event.target.value = "";
      if (!selectedFiles.length || !selectedProjectId) return;

      for (const file of selectedFiles) {
        setUploadingFormNames((prev) => [...prev, file.name]);
        try {
          const doc = await uploadDocument({
            file,
            document_type: "code_modification_application",
            description: "DC Code Modification application",
          });
          if (!doc) continue;
          setModificationForms((prev) =>
            [...prev, doc].sort((a, b) => a.created_at.localeCompare(b.created_at)),
          );
          if (modificationCurrentRun || modificationDisplayRun) {
            await markModificationReviewStale();
          }
        } catch (err) {
          console.error("Code modification document upload error:", err);
          toast.error(err instanceof Error ? err.message : "Failed to upload document");
        } finally {
          setUploadingFormNames((prev) => prev.filter((name) => name !== file.name));
        }
      }
      await fetchDocuments();
    },
    [
      fetchDocuments,
      markModificationReviewStale,
      modificationCurrentRun,
      modificationDisplayRun,
      selectedProjectId,
      uploadDocument,
    ],
  );

  const handleRemoveModificationForm = useCallback(
    async (document: ProjectDocument) => {
      const removed = await deleteDocument(document);
      if (!removed) return;
      setModificationForms((prev) => prev.filter((doc) => doc.id !== document.id));
      await markModificationReviewStale();
      await reloadAnalyzerDataset(selectedProjectId!);
    },
    [deleteDocument, markModificationReviewStale, reloadAnalyzerDataset, selectedProjectId],
  );

  const analyzeDrawings = () => {
    if (isModificationMode) {
      void runModificationReview();
      return;
    }
    void runBatchAnalysis(false);
  };
  const retryFailedFiles = () => runBatchAnalysis(true);

  const issueResponseKey = (fileId: string, issueId: string) => `${fileId}:${issueId}`;

  const handleAccept = (fileId: string, issue: ComplianceIssue) => {
    setResponses((prev) => ({
      ...prev,
      [issueResponseKey(fileId, issue.id)]: { status: "accepted", originalFix: issue.suggestedFix },
    }));
    toast.success("Fix accepted");
  };

  const handleReject = (fileId: string, issue: ComplianceIssue) => {
    setResponses((prev) => ({
      ...prev,
      [issueResponseKey(fileId, issue.id)]: { status: "rejected", originalFix: issue.suggestedFix },
    }));
    toast.info("Issue marked as not applicable");
  };

  const handleModify = (fileId: string, issue: ComplianceIssue) => {
    setSelectedIssue(issue);
    setModifiedText(issue.suggestedFix);
    setModifyDialogOpen(true);
    setActiveResultFileId(fileId);
  };

  const saveModification = () => {
    if (selectedIssue && activeResultFile) {
      setResponses((prev) => ({
        ...prev,
        [issueResponseKey(activeResultFile.id, selectedIssue.id)]: {
          status: "modified",
          originalFix: selectedIssue.suggestedFix,
          modifiedResponse: modifiedText,
        },
      }));
      setModifyDialogOpen(false);
      toast.success("Response modified");
    } else if (selectedIssue && activeLoadedExisting) {
      setResponses((prev) => ({
        ...prev,
        [issueResponseKey(activeLoadedExisting.documentId, selectedIssue.id)]: {
          status: "modified",
          originalFix: selectedIssue.suggestedFix,
          modifiedResponse: modifiedText,
        },
      }));
      setModifyDialogOpen(false);
      toast.success("Response modified");
    } else if (selectedIssue && activeResultFileId) {
      setResponses((prev) => ({
        ...prev,
        [issueResponseKey(activeResultFileId, selectedIssue.id)]: {
          status: "modified",
          originalFix: selectedIssue.suggestedFix,
          modifiedResponse: modifiedText,
        },
      }));
      setModifyDialogOpen(false);
      toast.success("Response modified");
    }
  };

  const isolateCurrentRun = shouldIsolateCurrentRunResults({
    analyzing,
    activeBatchRunId,
    viewingHistoricalRunId,
  });

  const resultGroups = useMemo(() => {
    const batchCompleted = completedBatchFiles.map((f) => ({
      id: f.id,
      documentId: f.documentId ?? null,
      fileName: batchFileDisplayName(f),
      ibcResult: f.ibcResult ?? null,
      localResult: f.localResult ?? null,
      failed: false as boolean,
    }));
    const batchFailed = failedBatchFiles.map((f) => ({
      id: f.id,
      documentId: f.documentId ?? null,
      fileName: batchFileDisplayName(f),
      ibcResult: f.ibcResult ?? null,
      localResult: f.localResult ?? null,
      failed: true as boolean,
      error: f.error,
    }));
    const hydrated = loadedExistingResults.map((loaded) => ({
      id: loaded.documentId,
      documentId: loaded.documentId,
      fileName: loaded.fileName,
      ibcResult: loaded.ibcResult,
      localResult: loaded.localResult,
      failed: false as boolean,
    }));
    return buildComplianceResultGroups({
      batchCompleted,
      batchFailed,
      hydrated,
      isolateCurrentRun,
    });
  }, [completedBatchFiles, failedBatchFiles, loadedExistingResults, isolateCurrentRun]);

  const filterMatchFileName = useMemo(() => {
    if (resultsDocumentFilter === COMPLIANCE_RESULTS_FILTER_ALL) return null;
    return (
      documentsWithAnalysis.find((d) => d.id === resultsDocumentFilter)?.file_name ?? null
    );
  }, [resultsDocumentFilter, documentsWithAnalysis]);

  const displayedResultGroups = useMemo(() => {
    const byDocument = filterComplianceResultGroups(
      resultGroups,
      resultsDocumentFilter,
      filterMatchFileName,
    );
    return filterComplianceGroupsByScore(byDocument, complianceScoreFilter);
  }, [resultGroups, resultsDocumentFilter, filterMatchFileName, complianceScoreFilter]);

  /** Aggregate KPI strip across displayed analyzed sheets' real results — never seeded. */
  const aggregateFindingStats = useMemo(() => {
    let critical = 0;
    let warnings = 0;
    let advisory = 0;
    let sheetsWithResults = 0;
    for (const group of displayedResultGroups) {
      if (group.failed) continue;
      const groupResults = [group.ibcResult, group.localResult].filter(
        (r): r is AnalysisResult => Boolean(r),
      );
      if (groupResults.length > 0) sheetsWithResults += 1;
      for (const result of groupResults) {
        critical += result.summary.critical ?? 0;
        warnings += result.summary.warnings ?? 0;
        advisory += result.summary.advisory ?? 0;
      }
    }
    return { critical, warnings, advisory, sheetsWithResults };
  }, [displayedResultGroups]);

  const runAnalysisContext = useMemo(() => {
    const failedIds = new Set(failedBatchFiles.map((f) => f.id));
    const sessionCompletedIds = new Set(completedBatchFiles.map((f) => f.id));
    const hydratedImageDocumentIds = new Set(loadedExistingResults.map((r) => r.documentId));
    return {
      failedSheetIds: failedIds,
      sessionCompletedSheetIds:
        sessionCompletedIds.size > 0 ? sessionCompletedIds : undefined,
      hydratedImageDocumentIds:
        sessionCompletedIds.size > 0 || isolateCurrentRun
          ? undefined
          : hydratedImageDocumentIds,
    };
  }, [completedBatchFiles, failedBatchFiles, loadedExistingResults, isolateCurrentRun]);

  const analyzerMetrics = useMemo(() => {
    const sheetsForMetrics =
      persistedSheets.length > 0
        ? persistedSheets
        : documentsWithAnalysis.map((d) => ({
            id: d.id,
            project_id: d.project_id,
            source_document_id: d.id,
            image_document_id: d.id,
            page_number: 1,
            file_name: d.file_name,
            excluded: false,
            created_at: d.created_at,
          }));
    return computeRunAnalysisMetrics({
      sheets: sheetsForMetrics,
      ...runAnalysisContext,
    });
  }, [persistedSheets, documentsWithAnalysis, runAnalysisContext]);

  const completedSheetIdsForDrawingSet = analyzerMetrics.completedSheetIds;

  const previousRunFingerprint = useMemo(() => {
    const active =
      displayRun?.source_fingerprint
        ? displayRun
        : currentRun?.source_fingerprint
          ? currentRun
          : null;
    if (active?.source_fingerprint) return active.source_fingerprint;
    const latestWithFingerprint = [...analyzerRuns]
      .filter((run) => Boolean(run.source_fingerprint))
      .sort((a, b) =>
        (b.completed_at ?? b.updated_at ?? b.created_at).localeCompare(
          a.completed_at ?? a.updated_at ?? a.created_at,
        ),
      )[0];
    return latestWithFingerprint?.source_fingerprint ?? null;
  }, [analyzerRuns, currentRun, displayRun]);
  const includedPersistedSheets = useMemo(
    () => persistedSheets.filter((s) => !s.excluded),
    [persistedSheets],
  );
  const newSinceLastAnalysis = useMemo(
    () => newSincePreviousRun(includedPersistedSheets, previousRunFingerprint),
    [includedPersistedSheets, previousRunFingerprint],
  );
  const newSinceLastAnalysisSheetIds = useMemo(
    () => new Set(newSinceLastAnalysis.map((s) => s.id)),
    [newSinceLastAnalysis],
  );
  const currentAnalyzingSheetId = useMemo(() => {
    if (!analyzing) return null;
    const active = files.find((f) => f.status === "analyzing");
    if (active) return active.id;
    if (batchProgress?.currentFileName) {
      const match = files.find(
        (f) => batchFileDisplayName(f) === batchProgress.currentFileName,
      );
      return match?.id ?? null;
    }
    return null;
  }, [analyzing, files, batchProgress]);

  const historicalAnalysisRuns = useMemo(
    () =>
      analyzerRuns.filter(
        (run) => run.status === "superseded" && Boolean(run.completed_at),
      ),
    [analyzerRuns],
  );

  const handleAnalysisHistoryChange = useCallback(
    async (value: string) => {
      if (value === "current") {
        setViewingHistoricalRunId(null);
        setResultsFromHistoricalRun(false);
        const currentId =
          displayRun?.status === "current"
            ? displayRun.id
            : currentRun?.id ?? displayRun?.id ?? null;
        setHydrateRunId(currentId);
        lastAllHydrateKeyRef.current = "";
        if (documentsWithAnalysis.length > 0) {
          await hydrateExistingAnalyses();
        } else {
          setLoadedExistingResults([]);
        }
        return;
      }
      setViewingHistoricalRunId(value);
      setResultsFromHistoricalRun(true);
      setHydrateRunId(value);
      lastAllHydrateKeyRef.current = "";
      await hydrateExistingAnalyses();
    },
    [
      displayRun?.id,
      displayRun?.status,
      currentRun?.id,
      documentsWithAnalysis.length,
      hydrateExistingAnalyses,
    ],
  );

  const documentFilterOptions = useMemo(() => {
    const opts: { id: string; label: string }[] = [];
    const seen = new Set<string>();
    for (const d of documentsWithAnalysis) {
      opts.push({ id: d.id, label: d.file_name });
      seen.add(d.id);
    }
    for (const f of completedBatchFiles) {
      const key = f.documentId ?? f.id;
      if (seen.has(key)) continue;
      opts.push({ id: key, label: batchFileDisplayName(f) });
      seen.add(key);
    }
    return opts;
  }, [documentsWithAnalysis, completedBatchFiles]);

  const [fileResultTabs, setFileResultTabs] = useState<Record<string, "ibc" | "local">>({});
  const [expandedResultGroups, setExpandedResultGroups] = useState<Record<string, boolean>>({});

  const toggleResultGroupExpanded = (groupId: string) => {
    setExpandedResultGroups((prev) => ({ ...prev, [groupId]: !prev[groupId] }));
  };

  const renderFileResultGroup = (group: {
    id: string;
    fileName: string;
    ibcResult: AnalysisResult | null;
    localResult: AnalysisResult | null;
    failed?: boolean;
    error?: string;
  }) => {
    if (group.failed) {
      return (
        <div key={group.id} className="space-y-2">
          <p className="text-sm font-medium text-foreground">{group.fileName}</p>
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              Analysis failed{group.error ? `: ${group.error}` : ". Retry from the batch controls above."}
            </AlertDescription>
          </Alert>
        </div>
      );
    }

    const tab = fileResultTabs[group.id] ?? (group.ibcResult ? "ibc" : "local");
    const groupResult =
      (tab === "local" ? group.localResult : group.ibcResult) ?? group.localResult ?? group.ibcResult;
    if (!groupResult) return null;

    const groupIssues = groupResult.issues ?? [];
    const resolvedInGroup = groupIssues.filter((issue) => responses[issueResponseKey(group.id, issue.id)]).length;
    const isExpanded = expandedResultGroups[group.id] ?? false;

    return (
      <div key={group.id} className="space-y-4">
        <button
          type="button"
          onClick={() => toggleResultGroupExpanded(group.id)}
          className="flex w-full items-center justify-between gap-3 rounded-lg border border-border/60 bg-muted/20 px-4 py-3 text-left transition-colors hover:bg-muted/40"
        >
          <div className="flex min-w-0 items-center gap-2">
            <FileIcon className="h-4 w-4 shrink-0 text-teal" />
            <span className="truncate text-sm font-medium text-foreground">{group.fileName}</span>
          </div>
          <div className="flex shrink-0 items-center gap-3 text-xs text-muted-foreground">
            <span>{groupResult.summary.totalIssues ?? 0} issues</span>
            <span className={`font-semibold ${getScoreColor(groupResult.summary.overallScore ?? 0)}`}>
              {groupResult.summary.overallScore ?? 0}%
            </span>
            <span>{isExpanded ? "Hide" : "Show"}</span>
          </div>
        </button>

        {isExpanded ? (
          <div className="space-y-6">
        {group.ibcResult && group.localResult && (
          <Tabs
            value={tab}
            onValueChange={(v) => setFileResultTabs((prev) => ({ ...prev, [group.id]: v as "ibc" | "local" }))}
          >
            <div className={cn("pilot-card border-border bg-card", "p-2")}>
              <TabsList className="grid w-full grid-cols-2 gap-2 bg-transparent p-0 h-auto shadow-none border-0">
                <TabsTrigger value="ibc" className="flex items-center gap-2">
                  <Scale className="h-4 w-4" />
                  General IBC ({group.ibcResult.summary.totalIssues} issues)
                </TabsTrigger>
                <TabsTrigger value="local" className="flex items-center gap-2">
                  <MapPin className="h-4 w-4" />
                  Local Amendments ({group.localResult.summary.totalIssues} issues)
                </TabsTrigger>
              </TabsList>
            </div>
          </Tabs>
        )}

        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <Card className={cn("pilot-card border-border bg-card", "!bg-gradient-to-br from-teal/[0.07] to-gold/[0.08] !border-teal/30")}>
            <CardContent className="pt-6 text-center">
              <div className={`text-4xl font-bold ${getScoreColor(groupResult.summary.overallScore ?? 0)}`}>
                {groupResult.summary.overallScore ?? 0}%
              </div>
              <p className="text-sm text-muted-foreground mt-1 dark:text-muted-foreground">Compliance Score</p>
            </CardContent>
          </Card>
          <Card className={"pilot-card border-border bg-card"}>
            <CardContent className="pt-6 text-center">
              <div className="text-4xl font-bold text-foreground dark:text-foreground">
                {groupResult.summary.totalIssues ?? 0}
              </div>
              <p className="text-sm text-muted-foreground mt-1 dark:text-muted-foreground">Total Issues</p>
            </CardContent>
          </Card>
          <Card className={cn("pilot-card border-border bg-card", "border-l-4 border-l-destructive")}>
            <CardContent className="pt-6 text-center">
              <div className="text-4xl font-bold text-destructive">{groupResult.summary.critical ?? 0}</div>
              <p className="text-sm text-muted-foreground mt-1 dark:text-muted-foreground">Critical</p>
            </CardContent>
          </Card>
          <Card className={cn("pilot-card border-border bg-card", "border-l-4 border-l-amber-500 dark:border-l-amber-400")}>
            <CardContent className="pt-6 text-center">
              <div className="text-4xl font-bold text-amber-600 dark:text-amber-400">{groupResult.summary.warnings ?? 0}</div>
              <p className="text-sm text-muted-foreground mt-1 dark:text-muted-foreground">Warnings</p>
            </CardContent>
          </Card>
          <Card className={cn("pilot-card border-border bg-card", "border-l-4 border-l-blue-500 dark:border-l-blue-400")}>
            <CardContent className="pt-6 text-center">
              <div className="text-4xl font-bold text-blue-600 dark:text-blue-400">{groupResult.summary.advisory ?? 0}</div>
              <p className="text-sm text-muted-foreground mt-1 dark:text-muted-foreground">Advisory</p>
            </CardContent>
          </Card>
        </div>

        {groupIssues.length > 0 && (
          <Card className={"pilot-card border-border bg-card"}>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-foreground dark:text-foreground">Resolution Progress</span>
                <span className="text-sm text-muted-foreground dark:text-muted-foreground">
                  {resolvedInGroup} / {groupIssues.length} resolved
                </span>
              </div>
              <Progress value={(resolvedInGroup / groupIssues.length) * 100} className="h-2" />
            </CardContent>
          </Card>
        )}

        {groupResult.jurisdictionNotes && (
          <Card className={cn("pilot-card border-border bg-card", "border-teal/25 shadow-sm")}>
            <CardContent className="pt-6">
              <div className="flex items-start gap-3">
                <Info className="h-5 w-5 text-teal mt-0.5 shrink-0" />
                <div>
                  <p className="font-medium mb-1 text-foreground">Jurisdiction Notes</p>
                  <p className="text-sm text-muted-foreground">{groupResult.jurisdictionNotes}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {renderIssuesList(group.id, groupResult, group.fileName)}
          </div>
        ) : null}
      </div>
    );
  };

  /** Export uses the same filtered set as the results UI / KPI strip. */
  const exportAggregated = useMemo(
    () => buildAggregatedComplianceExport(displayedResultGroups),
    [displayedResultGroups],
  );
  const canExportReport = exportAggregated.filesAnalyzed > 0 || exportAggregated.files.some((f) => f.failed);

  const selectedProjectName = useMemo(() => {
    if (!selectedProjectId) return null;
    return projects.find((p) => p.id === selectedProjectId)?.name ?? null;
  }, [projects, selectedProjectId]);

  const exportReportJSON = () => {
    if (!canExportReport) return;

    const report = buildComplianceExportJsonReport({
      aggregated: exportAggregated,
      jurisdiction,
      projectType,
      codeYear,
      responses,
    });

    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const scope =
      resultsDocumentFilter === COMPLIANCE_RESULTS_FILTER_ALL
        ? `all-${exportAggregated.filesAnalyzed}files`
        : (exportAggregated.files[0]?.codeType ?? "combined");
    a.download = `compliance-report-${scope}-${new Date().toISOString().split("T")[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(
      resultsDocumentFilter === COMPLIANCE_RESULTS_FILTER_ALL
        ? `JSON report exported (${exportAggregated.filesAnalyzed} files)`
        : "JSON report exported",
    );
  };

  const exportReportPDF = () => {
    if (!canExportReport) {
      toast.error("No analysis results to export. Please run an analysis first.");
      return;
    }

    try {
      const singleFileName =
        exportAggregated.files.length === 1
          ? exportAggregated.files[0].fileName.replace(/\.[^/.]+$/, "")
          : null;
      // PDF response lookup uses bare issue ids; remap file-scoped UI keys.
      const pdfResponses: Record<string, IssueResponse> = { ...responses };
      for (const file of exportAggregated.files) {
        for (const issue of file.issues) {
          const scoped = responses[complianceIssueResponseKey(file.fileId, issue.id)];
          if (scoped && !pdfResponses[issue.id]) {
            pdfResponses[issue.id] = scoped;
          }
        }
      }

      exportComplianceReportPDF({
        jurisdiction,
        projectType,
        codeYear,
        summary: exportAggregated.summary,
        issues: exportAggregated.issues,
        responses: pdfResponses,
        jurisdictionNotes: exportAggregated.jurisdictionNotes,
        projectName:
          selectedProjectName ||
          singleFileName ||
          (activeResultFile
            ? batchFileDisplayName(activeResultFile).replace(/\.[^/.]+$/, "")
            : activeLoadedExisting?.fileName?.replace(/\.[^/.]+$/, "")) ||
          "Compliance Analysis",
        filesAnalyzed: exportAggregated.filesAnalyzed,
        fileSections: exportAggregated.files.map((file) => ({
          fileId: file.fileId,
          fileName: file.fileName,
          summary: file.summary,
          issues: file.issues,
          failed: file.failed,
          error: file.error,
        })),
        responseKeyForIssue: (issue, fileId) =>
          fileId ? complianceIssueResponseKey(fileId, issue.id) : issue.id,
      });
      toast.success(
        resultsDocumentFilter === COMPLIANCE_RESULTS_FILTER_ALL
          ? `PDF report exported (${exportAggregated.filesAnalyzed} files)`
          : "PDF report exported",
      );
    } catch (err) {
      console.error("PDF export error:", err);
      toast.error("Failed to export PDF. Please try again.");
    }
  };

  const getScoreColor = (score: number) => {
    if (score >= 80) return "text-emerald-600";
    if (score >= 60) return "text-amber-600";
    return "text-destructive";
  };

  const failedFileCount = countFailedBatchFiles(files);
  const batchProgressValue = batchProgress ? batchProgressPercent(batchProgress) : 0;
  const batchProgressLabel = batchProgress
    ? formatBatchProgressLabel(batchProgress, { retrying: batchRetrying })
    : "";
  const drawingUploadProgressValue = drawingUploadProgress
    ? uploadProgressPercent(drawingUploadProgress)
    : 0;
  const drawingUploadProgressLabel = drawingUploadProgress
    ? formatUploadProgressLabel(drawingUploadProgress)
    : "";
  const drawingUploadPdfDetail = drawingUploadProgress
    ? formatPdfProcessingDetail(drawingUploadProgress)
    : null;
  const showDrawingUploadProgress = shouldShowUploadProgress(drawingUploadProgress);
  const hasAnyResults =
    completedBatchFiles.length > 0 ||
    failedBatchFiles.length > 0 ||
    loadedExistingResults.length > 0;
  /** Keep the results panel visible while All hydrates or when analyzed docs exist. */
  const showResultsPanel =
    hasAnyResults ||
    loadingExisting ||
    loadingDocsWithAnalysis ||
    (Boolean(selectedProjectId) && documentsWithAnalysis.length > 0);
  // Avoid a one-frame "load failed" flash between docs-list resolve and hydrate start.
  const awaitingAllHydrate =
    Boolean(selectedProjectId) &&
    resultsDocumentFilter === COMPLIANCE_RESULTS_FILTER_ALL &&
    documentsWithAnalysis.length > 0 &&
    loadedExistingResults.length === 0 &&
    !hydrateLoadFailed &&
    !loadingDocsWithAnalysis;
  const resultsEmptyKind = resolveComplianceResultsEmptyKind({
    loading: loadingExisting || loadingDocsWithAnalysis || awaitingAllHydrate,
    loadFailed: hydrateLoadFailed,
    analyzedDocCount: documentsWithAnalysis.length,
    resultGroupCount: resultGroups.length,
    displayedGroupCount: displayedResultGroups.length,
    documentFilterIsAll: resultsDocumentFilter === COMPLIANCE_RESULTS_FILTER_ALL,
    scoreFilterIsNot100: complianceScoreFilter === COMPLIANCE_SCORE_FILTER_NOT_100,
  });
  const resultsEmptyMessage = complianceResultsEmptyMessage(
    resultsEmptyKind,
    documentsWithAnalysis.length,
  );
  const complianceHydrateSource = resolveComplianceHydrateSource(
    hasAnalyzerRuns,
    displayRun?.status,
    resultsFromHistoricalRun || Boolean(viewingHistoricalRunId),
  );
  const showComplianceKpiStrip = shouldShowComplianceKpiStrip({
    loading: loadingExisting || loadingDocsWithAnalysis || awaitingAllHydrate,
    loadFailed: hydrateLoadFailed,
    displayedGroupCount: displayedResultGroups.length,
    analyzedDocCount: documentsWithAnalysis.length,
    hydratedGroupCount: loadedExistingResults.length + completedBatchFiles.length,
  });

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const renderIssuesList = (fileId: string, result: AnalysisResult, fileName: string) => {
    const issues = result?.issues ?? [];
    const summary = result?.summary ?? { totalIssues: 0, critical: 0, warnings: 0, advisory: 0, overallScore: 0 };
    const filteredIssues = (tab: string) =>
      issues.filter((issue) => tab === "all" || issue.severity === tab);

    const resolvedInResult = issues.filter((issue) => responses[issueResponseKey(fileId, issue.id)]).length;
    const progressPercent = issues.length > 0 ? (resolvedInResult / issues.length) * 100 : 0;

    return (
      <Card className={cn("pilot-card border-border bg-card", "overflow-hidden shadow-lg")}>
        {/* Header with progress */}
        <CardHeader className="pb-4 border-b border-border/40 bg-muted/20 dark:border-[hsl(var(--border-obsidian-strong)/0.35)] dark:bg-muted/35">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1">Source file</p>
              <CardTitle className="flex items-center gap-2 text-lg text-foreground dark:text-foreground">
                <FileIcon className="h-4 w-4 text-teal shrink-0" />
                <span className="truncate">{fileName}</span>
              </CardTitle>
              <CardDescription className="mt-1 text-muted-foreground dark:text-muted-foreground">
                Review each finding and take action on suggested fixes
              </CardDescription>
            </div>
            <div className="text-right">
              <div className="text-2xl font-bold text-primary-deep">{resolvedInResult}/{issues.length}</div>
              <div className="text-xs text-muted-foreground dark:text-muted-foreground">Issues Resolved</div>
            </div>
          </div>
          {/* Progress bar */}
          <div className="mt-4">
            <Progress value={progressPercent} className="h-2" />
            <p className="text-xs text-muted-foreground mt-1">{Math.round(progressPercent)}% complete</p>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          <Tabs defaultValue="all" className="w-full">
            {/* Severity filter tabs */}
            <div className="border-b border-border/40 bg-muted/15 px-4 py-3 dark:border-[hsl(var(--border-obsidian-strong)/0.35)] dark:bg-muted/25">
              <TabsList className="grid w-full grid-cols-4 h-auto p-1 bg-muted/50 border border-border/50 dark:bg-card/40 dark:border-[hsl(var(--border-obsidian-strong)/0.28)]">
                <TabsTrigger 
                  value="all" 
                  className="data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm py-2 dark:data-[state=active]:bg-obsidian-sunken dark:data-[state=active]:text-foreground"
                >
                  <span className="flex items-center gap-1.5">
                    <span className="hidden sm:inline">All</span>
                    <Badge variant="secondary" className="h-5 px-1.5 text-xs">{issues.length}</Badge>
                  </span>
                </TabsTrigger>
                <TabsTrigger 
                  value="critical" 
                  className="data-[state=active]:bg-destructive/10 data-[state=active]:text-destructive py-2"
                >
                  <span className="flex items-center gap-1.5">
                    <AlertCircle className="h-3.5 w-3.5 text-destructive" />
                    <span className="hidden sm:inline">Critical</span>
                    <Badge variant="destructive" className="h-5 px-1.5 text-xs">{summary.critical}</Badge>
                  </span>
                </TabsTrigger>
                <TabsTrigger 
                  value="warning" 
                  className="data-[state=active]:bg-amber-50 data-[state=active]:text-amber-700 dark:data-[state=active]:bg-amber-950 dark:data-[state=active]:text-amber-400 py-2"
                >
                  <span className="flex items-center gap-1.5">
                    <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
                    <span className="hidden sm:inline">Warning</span>
                    <Badge className="h-5 px-1.5 text-xs bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300 border-0">{summary.warnings}</Badge>
                  </span>
                </TabsTrigger>
                <TabsTrigger 
                  value="advisory" 
                  className="data-[state=active]:bg-blue-50 data-[state=active]:text-blue-700 dark:data-[state=active]:bg-blue-950 dark:data-[state=active]:text-blue-400 py-2"
                >
                  <span className="flex items-center gap-1.5">
                    <Info className="h-3.5 w-3.5 text-blue-600" />
                    <span className="hidden sm:inline">Advisory</span>
                    <Badge className="h-5 px-1.5 text-xs bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300 border-0">{summary.advisory}</Badge>
                  </span>
                </TabsTrigger>
              </TabsList>
            </div>

            {["all", "critical", "warning", "advisory"].map((tab) => (
              <TabsContent key={tab} value={tab} className="mt-0">
                <ScrollArea className="h-[520px]">
                  <div className="p-4 space-y-3">
                    {filteredIssues(tab).length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                        <CheckCircle2 className="h-12 w-12 mb-3 text-teal" />
                        <p className="font-medium text-foreground">No {tab === "all" ? "" : tab} issues found</p>
                        <p className="text-sm">Great work! This section is clear.</p>
                      </div>
                    ) : (
                      filteredIssues(tab).map((issue, index) => {
                        const config = severityConfig[issue.severity];
                        const Icon = config.icon;
                        const response = responses[issueResponseKey(fileId, issue.id)];

                        return (
                          <motion.div
                            key={issue.id}
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: index * 0.03, duration: 0.2 }}
                            className={`group relative rounded-xl border-l-4 border shadow-sm transition-all duration-200 ${
                              response
                                ? "border-l-teal/25 border-border/40 bg-muted/20 opacity-70 dark:border-[hsl(var(--border-obsidian-strong)/0.28)] dark:bg-muted/20"
                                : `${config.border} border-l-4 ${config.bg} hover:shadow-lg`
                            }`}
                          >
                            <div className="p-4">
                              {/* Header row */}
                              <div className="flex items-start justify-between gap-3">
                                <div className="flex-1 min-w-0">
                                  {/* Title and badges */}
                                  <div className="flex items-start gap-3 mb-2">
                                    <div className={`p-2.5 rounded-lg ${config.iconBg} shrink-0`}>
                                      <Icon className={`h-5 w-5 ${config.color}`} />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                      <h4 className="font-semibold text-foreground leading-tight">{issue.title}</h4>
                                      <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                                        <Badge variant="outline" className="text-xs font-normal gap-1">
                                          <span>{categoryIcons[issue.category]}</span>
                                          {issue.category}
                                        </Badge>
                                        <Badge variant="secondary" className="text-xs font-mono">
                                          {issue.codeReference}
                                        </Badge>
                                        {response && (
                                          <Badge
                                            className={`text-xs gap-1 ${
                                              response.status === "accepted" 
                                                ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300" 
                                                : response.status === "modified"
                                                  ? "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300"
                                                  : "bg-muted text-muted-foreground"
                                            }`}
                                          >
                                            {response.status === "accepted" && <Check className="h-3 w-3" />}
                                            {response.status === "modified" && <Edit className="h-3 w-3" />}
                                            {response.status === "rejected" && <X className="h-3 w-3" />}
                                            {response.status === "accepted" ? "Accepted" : 
                                             response.status === "modified" ? "Modified" : "Marked N/A"}
                                          </Badge>
                                        )}
                                      </div>
                                    </div>
                                  </div>

                                  {/* Description */}
                                  <p className="text-sm text-muted-foreground leading-relaxed mb-3">
                                    {issue.description}
                                  </p>

                                  {/* Location and Code info */}
                                  <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm mb-3">
                                    <div className="flex items-center gap-1.5">
                                      <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                                      <span className="text-muted-foreground">{issue.location}</span>
                                    </div>
                                    <div className="flex items-center gap-1.5">
                                      <Scale className="h-3.5 w-3.5 text-muted-foreground" />
                                      <span className="text-muted-foreground">{issue.codeReference} ({issue.codeYear})</span>
                                    </div>
                                  </div>

                                  {/* Suggested fix box */}
                                  <div className="p-3 rounded-lg bg-muted/40 border border-border/50 dark:bg-card/35 dark:border-[hsl(var(--border-obsidian-strong)/0.35)]">
                                    <div className="flex items-center gap-2 mb-1.5">
                                      <CheckCircle2 className="h-4 w-4 text-teal" />
                                      <span className="text-sm font-medium text-foreground">Suggested Fix</span>
                                    </div>
                                    <p className="text-sm text-muted-foreground leading-relaxed">
                                      {response?.modifiedResponse || issue.suggestedFix}
                                    </p>
                                  </div>
                                </div>

                                {/* Action buttons */}
                                {!response && (
                                  <div className="flex flex-col gap-1.5 shrink-0">
                                    <Button
                                      size="sm"
                                      variant="gold"
                                      onClick={() => handleAccept(fileId, issue)}
                                      className="gap-1.5"
                                    >
                                      <Check className="h-3.5 w-3.5" />
                                      Accept
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="outlineGold"
                                      onClick={() => handleModify(fileId, issue)}
                                      className="gap-1.5"
                                    >
                                      <Edit className="h-3.5 w-3.5" />
                                      Modify
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      onClick={() => handleReject(fileId, issue)}
                                      className="gap-1.5 text-muted-foreground hover:text-foreground"
                                    >
                                      <X className="h-3.5 w-3.5" />
                                      N/A
                                    </Button>
                                  </div>
                                )}
                              </div>
                            </div>
                          </motion.div>
                        );
                      })
                    )}
                  </div>
                </ScrollArea>
              </TabsContent>
            ))}
          </Tabs>
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="space-y-6">
      {/* Upload & Configuration Card */}
      <Card className={"pilot-card border-border bg-card"}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-foreground">
            <Shield className="h-5 w-5 text-teal" />
            AI Code Analyzer
          </CardTitle>
          <CardDescription className="text-muted-foreground">
            Upload architectural drawings to automatically detect building code violations using AI vision analysis
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Project Selection - Required for saving */}
          <div className="space-y-2">
            <Label className="flex items-center gap-2 text-foreground">
              <FolderKanban className="h-4 w-4" />
              Project (required to save analysis)
            </Label>
            <Select
              value={selectedProjectId ?? "__none__"}
              onValueChange={(v) => {
                if (v === "__create_new__") {
                  setShowNewProjectInput(true);
                  return;
                }
                setShowNewProjectInput(false);
                setSelectedProjectId(v === "__none__" ? null : v);
              }}
            >
              <SelectTrigger data-testid="select-project">
                <SelectValue placeholder="Select project to save analysis..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">
                  <span className="text-muted-foreground">No project (analysis won&apos;t be saved)</span>
                </SelectItem>
                <SelectItem value="__create_new__">
                  <span className="flex items-center gap-1.5 text-teal">
                    <Plus className="h-3.5 w-3.5" />
                    Create new project
                  </span>
                </SelectItem>
                {(projects ?? []).map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {showNewProjectInput && (
              <div className="flex items-center gap-2 mt-2">
                <Input
                  data-testid="input-new-project-name"
                  placeholder="Enter new project name..."
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && newProjectName.trim()) {
                      e.preventDefault();
                      handleCreateNewProject();
                    }
                  }}
                  disabled={creatingProject}
                  autoFocus
                />
                <Button
                  data-testid="button-create-project"
                  size="sm"
                  variant="gold"
                  disabled={!newProjectName.trim() || creatingProject}
                  onClick={handleCreateNewProject}
                >
                  {creatingProject ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    "Create"
                  )}
                </Button>
                <Button
                  data-testid="button-cancel-create-project"
                  size="sm"
                  variant="outlineGold"
                  onClick={() => {
                    setShowNewProjectInput(false);
                    setNewProjectName("");
                  }}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            )}
            {!selectedProjectId && !showNewProjectInput && (
              <p className="text-xs text-muted-foreground mt-1">
                Select a project to save the file and AI results to the database
              </p>
            )}
            {selectedProjectId &&
              !loadingDocsWithAnalysis &&
              documentsWithAnalysis.length === 0 &&
              documents.length > 0 && (
                <p className="text-xs text-muted-foreground mt-1" data-testid="text-docs-not-yet-analyzed">
                  This project has {documents.length} uploaded document
                  {documents.length === 1 ? "" : "s"}, but none have Code Analyzer results yet.
                  Upload drawings below to analyze — Project Documents lists every file, while this
                  dropdown only shows previously analyzed ones.
                </p>
              )}
          </div>

          {isDcJurisdiction(jurisdiction) && (
            <div className="space-y-2">
              <Label className="text-foreground">Analysis Type</Label>
              <Select
                value={analysisKind}
                onValueChange={(value) =>
                  setAnalysisKind(value === "dc_code_modification" ? "dc_code_modification" : "standard")
                }
              >
                <SelectTrigger className="w-full md:w-[320px]" data-testid="select-analysis-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="standard">Standard Code Compliance</SelectItem>
                  <SelectItem value="dc_code_modification">DC Code Modification Review</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          {isModificationMode && (
            <div className="space-y-2">
              <Label htmlFor="code-modification-form-input" className="text-foreground">
                Code Modification documents
              </Label>
              <Input
                id="code-modification-form-input"
                type="file"
                accept="application/pdf,.pdf"
                multiple
                data-testid="code-modification-form-input"
                onChange={(event) => void handleModificationFormChange(event)}
                disabled={uploadingFormNames.length > 0 || analyzing}
              />
              {(modificationForms.length > 0 || uploadingFormNames.length > 0) && (
                <ul
                  className="space-y-1 rounded-md border border-border bg-muted/20 p-2"
                  data-testid="code-modification-form-list"
                >
                  {modificationForms.map((form) => (
                    <li
                      key={form.id}
                      className="flex items-center justify-between gap-2 text-xs"
                      data-testid={`code-modification-form-item-${form.id}`}
                    >
                      <div className="min-w-0 flex items-center gap-2">
                        <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <span className="truncate">{form.file_name}</span>
                        <Badge variant="outline" className="text-[10px]">
                          Stored
                        </Badge>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 shrink-0 text-destructive"
                        disabled={analyzing || uploadingFormNames.length > 0}
                        onClick={() => void handleRemoveModificationForm(form)}
                        aria-label={`Remove ${form.file_name}`}
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </li>
                  ))}
                  {uploadingFormNames.map((name) => (
                    <li key={`uploading-${name}`} className="flex items-center justify-between gap-2 text-xs">
                      <div className="min-w-0 flex items-center gap-2">
                        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
                        <span className="truncate">{name}</span>
                        <Badge variant="outline" className="text-[10px]">
                          Uploading
                        </Badge>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* View / filter previously analyzed documents */}
          {!isModificationMode && (documentFilterOptions.length > 0 || hasAnyResults) && (
            <Card className={cn("pilot-card border-border bg-card", "bg-background/80")}>
              <CardContent className="pt-4">
                <div className="space-y-3">
                  <p className="font-medium text-sm text-foreground">Load previously analyzed document</p>
                  <div className="flex flex-wrap gap-2 items-center">
                    {documentFilterOptions.length > 0 && (
                      <Select
                        value={resultsDocumentFilter}
                        onValueChange={(v) => void handleResultsDocumentFilterChange(v)}
                        disabled={loadingExisting}
                      >
                        <SelectTrigger className="w-[280px]" data-testid="select-analyzed-document">
                          <SelectValue placeholder="All documents" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={COMPLIANCE_RESULTS_FILTER_ALL}>All</SelectItem>
                          {documentFilterOptions.map((d) => (
                            <SelectItem key={d.id} value={d.id}>
                              {d.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                    <Select
                      value={complianceScoreFilter}
                      onValueChange={(v) =>
                        setComplianceScoreFilter(
                          v === COMPLIANCE_SCORE_FILTER_NOT_100
                            ? COMPLIANCE_SCORE_FILTER_NOT_100
                            : COMPLIANCE_SCORE_FILTER_ALL,
                        )
                      }
                    >
                      <SelectTrigger className="w-[220px]" data-testid="select-compliance-score-filter">
                        <SelectValue placeholder="All results" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={COMPLIANCE_SCORE_FILTER_ALL}>All results</SelectItem>
                        <SelectItem value={COMPLIANCE_SCORE_FILTER_NOT_100}>
                          Not 100% compliant
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    {loadingExisting && (
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Configuration Row */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label className="flex items-center gap-2 text-foreground">
                <MapPin className="h-4 w-4" />
                Jurisdiction
              </Label>
              <SearchableCombobox
                options={jurisdictionOptions}
                value={jurisdiction}
                onValueChange={handleJurisdictionChange}
                placeholder="Select jurisdiction..."
                searchPlaceholder="Search jurisdictions..."
                emptyText="No jurisdiction found."
              />
            </div>

            <div className="space-y-2">
              <Label className="flex items-center gap-2 text-foreground">
                <Building2 className="h-4 w-4" />
                Project Type
              </Label>
              <SearchableCombobox
                options={projectTypeOptions}
                value={projectType}
                onValueChange={handleProjectTypeChange}
                placeholder="Select project type..."
                searchPlaceholder="Search project types..."
                emptyText="No project type found."
              />
            </div>

            <div className="space-y-2">
              <Label className="flex items-center gap-2 text-foreground">
                <Calendar className="h-4 w-4" />
                Code Year
              </Label>
              <Select value={codeYear} onValueChange={setCodeYear}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="2024">2024</SelectItem>
                  <SelectItem value="2021">2021</SelectItem>
                  <SelectItem value="2018">2018</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Analysis Mode Toggle - only show for jurisdictions with amendments */}
          {hasLocalAmendments && !isModificationMode && (
            <Card className={cn("pilot-card border-border bg-card", "border-teal/20 shadow-sm")}>
              <CardContent className="pt-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Scale className="h-5 w-5 text-teal" />
                    <div>
                      <p className="font-medium text-foreground">Dual Code Analysis</p>
                      <p className="text-sm text-muted-foreground">
                        This jurisdiction has local amendments. Choose analysis mode:
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Select value={analysisMode} onValueChange={(v) => setAnalysisMode(v as "both" | "ibc" | "local")}>
                      <SelectTrigger className="w-[180px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="both">
                          <div className="flex items-center gap-2">
                            <ToggleLeft className="h-4 w-4" />
                            Both (Recommended)
                          </div>
                        </SelectItem>
                        <SelectItem value="ibc">IBC Only</SelectItem>
                        <SelectItem value="local">Local Only</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          <div className="space-y-2">
            <Label htmlFor="analysis-instructions">Analysis instructions (optional)</Label>
            <Textarea
              id="analysis-instructions"
              data-testid="analysis-instructions-input"
              placeholder="Staff guidance for this review — focus areas, occupancy assumptions, etc. Not treated as evidence."
              value={analysisInstructions}
              onChange={(e) => setAnalysisInstructions(e.target.value)}
              rows={3}
              className="resize-y min-h-[72px]"
            />
            <p className="text-xs text-muted-foreground">
              Saved with each run. Changing instructions marks the current analysis stale until you re-run.
            </p>
          </div>

          {shouldShowIndexCompletenessPanel({
            persistedSheetCount: persistedSheets.length,
            result: indexCompleteness,
            loading: indexPrescreenLoading,
            recheckError: indexPrescreenError,
          }) && (
            <IndexCompletenessPanel
              result={indexCompleteness}
              loading={indexPrescreenLoading}
              recheckError={indexPrescreenError}
            />
          )}

          {/* Upload Area */}
          <div
            className={`border-2 border-dashed rounded-xl p-8 text-center transition-colors ${
              dragActive ? "border-teal bg-teal/[0.06]" : "border-primary/35 hover:border-primary/55 bg-muted/25"
            }`}
            onDragEnter={handleDrag}
            onDragLeave={handleDrag}
            onDragOver={handleDrag}
            onDrop={handleDrop}
          >
            <input
              type="file"
              id="drawing-upload"
              className="hidden"
              accept="image/png,image/jpeg,image/jpg,image/webp,application/pdf"
              multiple
              onChange={handleFileChange}
            />

            {persistedSheets.length > 0 || files.length > 0 || documentsWithAnalysis.length > 0 ? (
              <AnalyzerDrawingSet
                sheets={
                  persistedSheets.length > 0
                    ? persistedSheets
                    : documentsWithAnalysis.map((d) => ({
                        id: d.id,
                        project_id: d.project_id,
                        source_document_id: d.id,
                        image_document_id: d.id,
                        page_number: 1,
                        file_name: d.file_name,
                        excluded: false,
                        created_at: d.created_at,
                      }))
                }
                uploadQueueFiles={uploadQueueFiles.map((f) => ({
                  id: f.id,
                  name: batchFileDisplayName(f),
                  sizeLabel: f.file ? formatFileSize(f.file.size) : "—",
                  preview: f.preview,
                  discipline: f.discipline,
                  status: f.status,
                  error: f.error,
                }))}
                failedSheetFiles={failedBatchFiles.map((f) => ({
                  id: f.id,
                  name: batchFileDisplayName(f),
                  sizeLabel: f.file ? formatFileSize(f.file.size) : "—",
                  preview: f.preview,
                  discipline: f.discipline,
                  status: f.status,
                  error: f.error,
                }))}
                newSinceLastAnalysisCount={newSinceLastAnalysis.length}
                runMetrics={analyzerMetrics}
                runAnalysisContext={runAnalysisContext}
                completedSheetIds={completedSheetIdsForDrawingSet}
                analysisPendingCount={
                  batchProgress
                    ? Math.max(0, batchProgress.total - batchProgress.completed)
                    : undefined
                }
                currentAnalyzingSheetName={batchProgress?.currentFileName ?? null}
                currentAnalyzingSheetId={currentAnalyzingSheetId}
                newSinceLastAnalysisSheetIds={newSinceLastAnalysisSheetIds}
                displayRun={isModificationMode ? modificationDisplayRun : displayRun}
                analysisStale={isModificationMode ? modificationStale : analysisStale}
                staleActionLabel={isModificationMode ? "Update Review" : "Update Analysis"}
                analyzing={analyzing}
                isLegacy={hasAnalyzerRuns === false && persistedSheets.length === 0 && documentsWithAnalysis.length > 0}
                onAddClick={() => document.getElementById("drawing-upload")?.click()}
                onRemovePending={removeFile}
                onPendingDisciplineChange={updateFileDiscipline}
                onRequestRemoveSource={(sourceDocumentId, label) =>
                  setDeleteTarget({ kind: "source", sourceDocumentId, label })
                }
                onRequestRemoveSheet={(sheet, label) =>
                  setDeleteTarget({
                    kind: "sheet",
                    sourceDocumentId: sheet.source_document_id,
                    sheet,
                    label,
                  })
                }
                canAddMore={uploadQueueFiles.length < COMPLIANCE_MAX_BATCH_FILES}
              />
            ) : (
              <label htmlFor="drawing-upload" className="cursor-pointer">
                <div className="space-y-2">
                  <div className="flex justify-center gap-4 pt-4">
                    <FileImage className="h-12 w-12 text-primary-deep/75" />
                    <Upload className="h-12 w-12 text-teal" />
                  </div>
                  <p className="text-lg font-medium text-foreground">Drop drawings here or click to browse</p>
                  <p className="text-sm text-muted-foreground">
                    Up to {COMPLIANCE_MAX_INCLUDED_SHEETS} included sheets per analysis ({COMPLIANCE_MAX_BATCH_FILES} source documents per upload). Supports PNG, JPEG, WebP, or PDF (max {MAX_FILE_SIZE_MB}MB each).
                    Multi-page PDFs are expanded into individual sheets.
                  </p>
                </div>
              </label>
            )}
          </div>

          {/* Analyze Button */}
          <div className="flex flex-wrap justify-center gap-4">
            <Button
              variant="gold"
              size="lg"
              onClick={analyzeDrawings}
              disabled={
                analyzing ||
                (isModificationMode
                  ? modificationForms.length === 0 || uploadingFormNames.length > 0
                  : (
                    files.filter((f) => f.status === "pending").length === 0 &&
                    persistedSheets.filter((s) => !s.excluded).length === 0 &&
                    files.filter((f) => f.status === "failed").length === 0
                  ))
              }
              className="px-8"
            >
              {analyzing ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  {isModificationMode
                    ? "Running review..."
                    : showDrawingUploadProgress
                      ? drawingUploadProgressLabel || "Uploading documents..."
                      : batchProgressLabel || "Analyzing..."}
                </>
              ) : (
                <>
                  <Shield className="h-4 w-4 mr-2" />
                  {isModificationMode
                    ? modificationDisplayRun || modificationReview
                      ? "Update Review"
                      : "Run Code Modification Review"
                    : persistedSheets.length > 0 || displayRun
                      ? "Update Analysis"
                      : "Analyze for Compliance"}
                </>
              )}
            </Button>
            {failedFileCount > 0 && !analyzing && !isModificationMode && (
              <Button variant="outlineGold" size="lg" onClick={retryFailedFiles}>
                Retry failed sheets ({failedFileCount})
              </Button>
            )}
          </div>

          {/* Progress Bar */}
          <AnimatePresence>
            {showDrawingUploadProgress && drawingUploadProgress && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="space-y-2"
                data-testid="drawing-upload-progress"
              >
                <Progress value={drawingUploadProgressValue} className="h-2" />
                <p className="text-sm text-center text-muted-foreground">
                  {drawingUploadProgressLabel}
                </p>
                {drawingUploadPdfDetail ? (
                  <p className="text-xs text-center text-muted-foreground">{drawingUploadPdfDetail}</p>
                ) : null}
              </motion.div>
            )}
            {analyzing && batchProgress && !showDrawingUploadProgress && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="space-y-2"
              >
                <Progress value={batchProgressValue} className="h-2" />
                <p className="text-sm text-center text-muted-foreground">
                  {batchProgressLabel}
                  {batchProgress.currentFileName ? ` — ${batchProgress.currentFileName}` : ""}
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </CardContent>
      </Card>

      {/* Results — visible on All land/hydrate so prior analyses are never a silent blank */}
      {isModificationMode && modificationReview && (
        <CodeModificationReviewResults review={modificationReview} stale={modificationStale} />
      )}
      <AnimatePresence>
        {!isModificationMode && showResultsPanel && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="space-y-6"
            data-testid="compliance-results-panel"
          >
            {/* Findings KPI strip — aggregated across every analyzed file's real results */}
            {showComplianceKpiStrip ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <MetricCard
                label="Critical"
                value={aggregateFindingStats.critical}
                icon={AlertCircle}
                detail="Blocking issues across all analyzed files"
              />
              <MetricCard
                label="Warnings"
                value={aggregateFindingStats.warnings}
                icon={AlertTriangle}
                detail="Should be resolved before submission"
              />
              <MetricCard
                label="Advisory"
                value={aggregateFindingStats.advisory}
                icon={Info}
                detail="Informational, non-blocking notes"
              />
              <MetricCard
                label="Sheets analyzed"
                value={analyzerMetrics.analyzedCompletedCount}
                icon={FileText}
                detail={formatAnalysisProgressSummary(analyzerMetrics, {
                  inProgress: analyzing,
                  pendingCount: batchProgress
                    ? Math.max(0, batchProgress.total - batchProgress.completed)
                    : undefined,
                  currentSheetName: batchProgress?.currentFileName ?? null,
                })}
              />
            </div>
            ) : null}

            {historicalAnalysisRuns.length > 0 && !analyzing && (
              <div className="flex flex-wrap items-center gap-2" data-testid="analysis-history-control">
                <Label className="text-sm text-muted-foreground">Analysis history</Label>
                <Select
                  value={viewingHistoricalRunId ?? "current"}
                  onValueChange={(value) => void handleAnalysisHistoryChange(value)}
                >
                  <SelectTrigger className="w-[280px]">
                    <SelectValue placeholder="Current analysis" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="current">Current analysis</SelectItem>
                    {historicalAnalysisRuns.map((run) => (
                      <SelectItem key={run.id} value={run.id}>
                        {run.completed_at
                          ? `Previous · ${new Date(run.completed_at).toLocaleString()}`
                          : `Previous · ${run.id.slice(0, 8)}`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {complianceHydrateSource === "historical" && displayedResultGroups.length > 0 && (
              <Alert data-testid="compliance-historical-results-banner">
                <Info className="h-4 w-4" />
                <AlertDescription>{complianceHistoricalResultsMessage()}</AlertDescription>
              </Alert>
            )}

            <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
              <div className="space-y-10">
                {displayedResultGroups.length === 0 ? (
                  <div className="space-y-3" data-testid="compliance-results-empty">
                    <p className="text-sm text-muted-foreground">
                      {resultsEmptyMessage}
                    </p>
                    {resultsEmptyKind === "load_failed" && documentsWithAnalysis.length > 0 && (
                      <Button
                        variant="outlineGold"
                        size="sm"
                        data-testid="button-retry-all-hydrate"
                        onClick={() => {
                          lastAllHydrateKeyRef.current = "";
                          void handleResultsDocumentFilterChange(COMPLIANCE_RESULTS_FILTER_ALL);
                        }}
                      >
                        Retry loading All analyses
                      </Button>
                    )}
                  </div>
                ) : (
                  displayedResultGroups.map((group) => renderFileResultGroup(group))
                )}
              </div>

              <aside className="space-y-4 lg:self-start">
                <Panel eyebrow="Actions" title="Export report">
                  <div className="space-y-2">
                    <Button
                      variant="outlineGold"
                      className="w-full justify-start"
                      onClick={exportReportPDF}
                      disabled={!canExportReport}
                    >
                      <FileDown className="h-4 w-4 mr-2" />
                      Export PDF
                    </Button>
                    <Button
                      variant="ghost"
                      className="w-full justify-start"
                      onClick={exportReportJSON}
                      disabled={!canExportReport}
                    >
                      <Download className="h-4 w-4 mr-2" />
                      Export JSON
                    </Button>
                  </div>
                </Panel>

                <Panel eyebrow="Cross-reference" title="Related tools">
                  <div className="space-y-2 text-sm">
                    <Link
                      to="/code-reference"
                      className="flex items-center gap-2 rounded-md border border-border/60 px-3 py-2 text-foreground transition-colors hover:border-primary/60 hover:text-primary"
                    >
                      <BookOpen className="h-4 w-4 text-primary" />
                      Code Reference Library
                    </Link>
                    <Link
                      to="/response-matrix"
                      className="flex items-center gap-2 rounded-md border border-border/60 px-3 py-2 text-foreground transition-colors hover:border-primary/60 hover:text-primary"
                    >
                      <TableIcon className="h-4 w-4 text-primary" />
                      Response Matrix
                    </Link>
                  </div>
                </Panel>
              </aside>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Modify Dialog */}
      <Dialog open={modifyDialogOpen} onOpenChange={setModifyDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Modify Response</DialogTitle>
            <DialogDescription>Edit the suggested fix to match your design approach</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Original Suggestion</Label>
              <p className="text-sm text-muted-foreground mt-1">{selectedIssue?.suggestedFix}</p>
            </div>
            <div className="space-y-2">
              <Label>Your Response</Label>
              <Textarea
                value={modifiedText}
                onChange={(e) => setModifiedText(e.target.value)}
                rows={4}
                placeholder="Enter your modified response..."
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outlineGold" onClick={() => setModifyDialogOpen(false)}>
                Cancel
              </Button>
              <Button variant="gold" onClick={saveModification}>Save Response</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open && !deletingDrawing) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {deleteTarget?.kind === "sheet" ? "Remove sheet from analysis" : "Remove drawing"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget?.kind === "sheet"
                ? `Remove "${deleteTarget.label || "this sheet"}" from this project's Code Analyzer drawing set? Related findings for that sheet will be removed or invalidated. The original PDF is kept unless you remove the whole drawing.`
                : `Delete "${deleteTarget?.label || "this drawing"}" from this project? This cannot be undone. Related Code Analyzer findings for this drawing will also be removed.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingDrawing}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={deletingDrawing}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={async (event) => {
                event.preventDefault();
                const target = deleteTarget;
                if (!target || !selectedProjectId) {
                  setDeleteTarget(null);
                  return;
                }
                setDeletingDrawing(true);
                try {
                  if (target.kind === "sheet" && target.sheet) {
                    const sheet = target.sheet;
                    const source = sheetDocuments.find((d) => d.id === sheet.source_document_id) ?? null;
                    const image = sheet.image_document_id
                      ? sheetDocuments.find((d) => d.id === sheet.image_document_id) ?? null
                      : source;
                    const ok = await deleteAnalyzerSheet({
                      sheet,
                      sourceDocument: source,
                      imageDocument: image,
                      deleteDocument,
                      deleteSheetRow: deleteAnalyzerSheetRow,
                    });
                    if (!ok) return;
                  } else {
                    const source =
                      sheetDocuments.find((d) => d.id === target.sourceDocumentId) ??
                      documentsWithAnalysis.find((d) => d.id === target.sourceDocumentId);
                    if (!source) {
                      toast.error("Could not find that drawing to delete");
                      setDeleteTarget(null);
                      return;
                    }
                    const relatedSheets = persistedSheets.filter(
                      (s) => s.source_document_id === source.id,
                    );
                    const imageDocs = sheetDocuments.filter((d) =>
                      relatedSheets.some((s) => s.image_document_id === d.id),
                    );
                    const ok = await deleteAnalyzerSourceDrawing({
                      sourceDocument: source,
                      sheets: relatedSheets,
                      imageDocuments: imageDocs,
                      deleteDocument,
                    });
                    if (!ok) return;
                  }
                  await markCurrentRunStale(selectedProjectId);
                  await reloadAnalyzerDataset(selectedProjectId);
                  setAnalysisSavedAt(Date.now());
                  toast.success(
                    isModificationMode
                      ? "Drawing set updated — run Update Review to refresh findings"
                      : "Drawing set updated — run Update Analysis to refresh findings",
                  );
                  setDeleteTarget(null);
                } catch (err) {
                  console.error(err);
                  toast.error(err instanceof Error ? err.message : "Failed to remove drawing");
                } finally {
                  setDeletingDrawing(false);
                }
              }}
            >
              {deletingDrawing ? "Removing…" : "Remove"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
