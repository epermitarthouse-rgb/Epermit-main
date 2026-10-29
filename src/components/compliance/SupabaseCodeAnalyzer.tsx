import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { motion } from "framer-motion";
import {
  Building2,
  Calendar,
  Download,
  FileText,
  FolderKanban,
  Loader2,
  MapPin,
  RefreshCw,
  RotateCcw,
  Scale,
  Shield,
  ToggleLeft,
  Upload,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { SearchableCombobox } from "@/components/ui/searchable-combobox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useProjects } from "@/hooks/useProjects";
import { useResolvedProjectId } from "@/hooks/useResolvedProjectId";
import {
  AnalyzerSideActions,
  DrawingReviewList,
  ExistingDrawingsPanel,
  FindingsMatrix,
  PendingDrawingCards,
  type FindingSeverityFilter,
} from "@/components/compliance/supabaseAnalyzerPresentation";
import { SupabaseAnalyzerQualityDrawer } from "@/components/compliance/supabaseAnalyzerQualityDrawer";
import { bytesLabel, statusLabel } from "@/components/compliance/supabaseAnalyzerLabels";
import {
  SUPABASE_ANALYZER_MAX_SHEETS,
  SUPABASE_ANALYZER_MAX_TOTAL_BYTES,
  cancelSupabaseAnalyzerRun,
  createSupabaseAnalyzerRun,
  fetchSupabaseAnalyzerDataset,
  fetchSupabaseAnalyzerRuns,
  finalizeSupabaseAnalyzerRun,
  isActiveSupabaseAnalyzerRun,
  reanalyzeSupabaseAnalyzerRun,
  recordSupabaseAnalyzerExport,
  retrySupabaseAnalyzerJobs,
  saveSupabaseAnalyzerReviewDecision,
  updateSupabaseAnalyzerRun,
  uploadSupabaseAnalyzerFiles,
  type AnalyzerRunDataset,
  type SupabaseAnalyzerFinding,
  type SupabaseAnalyzerRun,
} from "@/lib/supabaseAnalyzer/client";
import {
  expansionForRunSeverity,
  mergeReviewDecision,
  reviewsByFindingForRun,
  type ReviewDecisionStatus,
} from "@/lib/supabaseAnalyzer/reviewDecisions";
import {
  analyzerCodeYears,
  analyzerJurisdictionGroups,
  analyzerProjectTypeGroups,
  codeContextForAnalyzer,
  DC_CODE_EDITION,
  DC_JURISDICTION,
  defaultCodeYearForAnalyzer,
  jurisdictionKeyFor,
} from "@/lib/supabaseAnalyzer/taxonomy";
import {
  analysisModeControlOptions,
  analysisModeShortLabel,
  displayAnalysisMode,
  resolveAnalyzerReviewScope,
  type StoredAnalysisMode,
} from "@/lib/supabaseAnalyzer/analysisMode";
import { countSeverity, downloadSupabaseAnalyzerJson } from "@/lib/supabaseAnalyzer/exportDataset";
import { exportSupabaseAnalyzerReport } from "@/lib/supabaseAnalyzer/report";
import { buildArchitectReviewModel, fingerprintArchitectReview } from "@/lib/supabaseAnalyzer/architectReview";
import { downloadArchitectReviewPdf } from "@/lib/supabaseAnalyzer/brandedReportDownload";
import { withAnalyzerExportAudit, type AnalyzerExportFormat } from "@/lib/supabaseAnalyzer/exportAudit";
import { downloadFindingsRegisterExcel } from "@/lib/supabaseAnalyzer/findingsRegisterDownload";
import {
  analyzerSelectionSignature,
  analyzerSubmissionAction,
  clearPendingAnalyzerSheets,
  describeSelectionNotices,
  failedUploadDescriptors,
  mergePendingAnalyzerSheets,
  removePendingAnalyzerSheet,
  retainPendingSelectionForProject,
  selectionCapacity,
  selectionNoticeTone,
  type AnalyzerSubmissionDraft,
} from "@/lib/supabaseAnalyzer/pendingSelection";
import {
  planReanalysis,
  reanalysisConfirmationCopy,
  reanalysisRequestKey,
  reanalyzeControls,
  type ReanalysisIntent,
  type ReanalysisPlan,
} from "../../../supabase/functions/_shared/analyzerReanalysis.ts";
import {
  analyzerActionPresentation,
  analyzerFileIdentity,
  planSheetUpdate,
  runIsWorkerActive,
  updateConfirmationCopy,
  type SheetUpdatePlan,
} from "../../../supabase/functions/_shared/analyzerSheetUpdate.ts";

const ACTIVE_STATUSES = new Set(["uploading", "queued", "processing"]);
const EMPTY_SHEETS: AnalyzerRunDataset["jobs"] = [];

export function SupabaseCodeAnalyzer() {
  const { projects } = useProjects();
  const { projectId, setSelectedProjectId } = useResolvedProjectId();
  const [jurisdiction, setJurisdiction] = useState(DC_JURISDICTION);
  const [projectType, setProjectType] = useState("Commercial (General)");
  const [codeYear, setCodeYear] = useState(DC_CODE_EDITION);
  const [analysisMode, setAnalysisMode] = useState<StoredAnalysisMode>("both");
  const [files, setFiles] = useState<File[]>([]);
  const [runs, setRuns] = useState<SupabaseAnalyzerRun[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [dataset, setDataset] = useState<AnalyzerRunDataset | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [updatePlan, setUpdatePlan] = useState<SheetUpdatePlan | null>(null);
  const [reanalysisPlan, setReanalysisPlan] = useState<ReanalysisPlan | null>(null);
  const [reanalysisIntent, setReanalysisIntent] = useState<ReanalysisIntent>("selected");
  const [selectedDrawingIds, setSelectedDrawingIds] = useState<Set<string>>(() => new Set());
  const [dragActive, setDragActive] = useState(false);
  const [activeDiscipline, setActiveDiscipline] = useState("all");
  const [severityFilter, setSeverityFilter] = useState<FindingSeverityFilter>("all");
  const [sheetSeverity, setSheetSeverity] = useState<Record<string, FindingSeverityFilter>>({});
  const [savingFindingId, setSavingFindingId] = useState<string | null>(null);
  const [exportingKind, setExportingKind] = useState<"pdf" | "excel" | null>(null);
  const [modifyTarget, setModifyTarget] = useState<SupabaseAnalyzerFinding | null>(null);
  const [modifiedText, setModifiedText] = useState("");
  const [expandedJobIds, setExpandedJobIds] = useState<Set<string>>(() => new Set());
  const [expandedFindingIds, setExpandedFindingIds] = useState<Set<string>>(() => new Set());
  const [existingDrawingsOpen, setExistingDrawingsOpen] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{
    completed: number;
    total: number;
    fileName: string;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const filesRef = useRef<File[]>([]);
  const submittingRef = useRef(false);
  const cancellingRef = useRef(false);
  const selectionLockedRef = useRef(false);
  const updateFilesRef = useRef<File[]>([]);
  const draftRef = useRef<AnalyzerSubmissionDraft | null>(null);
  const selectedDrawingIdsRef = useRef<Set<string>>(new Set());
  const reanalysisRequestRef = useRef<{ key: string; runId: string } | null>(null);
  const reanalysisFilesRef = useRef<File[]>([]);
  const expansionBeforeFilterRef = useRef<Set<string> | null>(null);
  const selectionProjectRef = useRef(projectId);

  const selectedProject = projects.find((project) => project.id === projectId);
  const totalBytes = useMemo(() => files.reduce((sum, file) => sum + file.size, 0), [files]);
  const activeRun = dataset?.run || runs.find((run) => run.id === selectedRunId) || null;
  const progress = activeRun
    ? Math.round(
      ((activeRun.completed_sheets + activeRun.failed_sheets) / Math.max(1, activeRun.total_sheets)) * 100,
    )
    : 0;

  const loadRuns = useCallback(async (targetProjectId: string) => {
    const nextRuns = await fetchSupabaseAnalyzerRuns(targetProjectId);
    setRuns(nextRuns);
    setSelectedRunId((current) => {
      if (current && nextRuns.some((run) => run.id === current)) return current;
      return nextRuns[0]?.id || null;
    });
  }, []);

  const loadDataset = useCallback(async (runId: string) => {
    const nextDataset = await fetchSupabaseAnalyzerDataset(runId);
    setDataset(nextDataset);
    setRuns((current) => current.map((run) => run.id === runId ? nextDataset.run : run));
    return nextDataset;
  }, []);

  useEffect(() => {
    setDataset(null);
    setRuns([]);
    setSelectedRunId(null);
    if (!projectId) return;
    setLoading(true);
    void loadRuns(projectId)
      .catch((error) => toast.error(error instanceof Error ? error.message : "Could not load analyzer runs"))
      .finally(() => setLoading(false));
  }, [projectId, loadRuns]);

  useEffect(() => {
    setActiveDiscipline("all");
    setSeverityFilter("all");
    setSheetSeverity({});
    setModifyTarget(null);
    setModifiedText("");
    setExpandedJobIds(new Set());
    expansionBeforeFilterRef.current = null;
    setExpandedFindingIds(new Set());
    setExistingDrawingsOpen(false);
    setSelectedDrawingIds(new Set());
    selectedDrawingIdsRef.current = new Set();
    reanalysisRequestRef.current = null;
    if (!selectedRunId) {
      setDataset(null);
      return;
    }
    setLoading(true);
    void loadDataset(selectedRunId)
      .catch((error) => toast.error(error instanceof Error ? error.message : "Could not load analysis"))
      .finally(() => setLoading(false));
  }, [selectedRunId, loadDataset]);

  useEffect(() => {
    if (!selectedRunId || !isActiveSupabaseAnalyzerRun(activeRun)) return;
    const timer = window.setInterval(() => {
      void loadDataset(selectedRunId).catch(() => undefined);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [selectedRunId, activeRun, loadDataset]);

  useEffect(() => {
    filesRef.current = files;
  }, [files]);

  useEffect(() => {
    const previousProjectId = selectionProjectRef.current;
    if (previousProjectId === projectId) return;
    selectionProjectRef.current = projectId;
    const retained = retainPendingSelectionForProject(
      previousProjectId,
      projectId,
      filesRef.current,
      submittingRef.current,
    );
    if (retained === filesRef.current) return;
    draftRef.current = null;
    filesRef.current = [];
    setFiles([]);
  }, [projectId]);

  useEffect(() => {
    if (!projectId) return;
    const key = `permitpilot:supabase-analyzer-config:${projectId}`;
    try {
      const saved = JSON.parse(localStorage.getItem(key) || "{}");
      if (typeof saved.jurisdiction === "string") setJurisdiction(saved.jurisdiction);
      if (typeof saved.projectType === "string") setProjectType(saved.projectType);
      if (typeof saved.codeYear === "string") setCodeYear(saved.codeYear);
      if (saved.analysisMode === "both" || saved.analysisMode === "ibc_only" || saved.analysisMode === "local_only") {
        setAnalysisMode(saved.analysisMode);
      }
    } catch {
      // Invalid legacy local storage should not block the analyzer.
    }
  }, [projectId]);

  useEffect(() => {
    if (!projectId) return;
    localStorage.setItem(
      `permitpilot:supabase-analyzer-config:${projectId}`,
      JSON.stringify({ jurisdiction, projectType, codeYear, analysisMode }),
    );
  }, [projectId, jurisdiction, projectType, codeYear, analysisMode]);

  const reportSelection = (notices: Parameters<typeof describeSelectionNotices>[0]) => {
    const message = describeSelectionNotices(notices);
    if (!message) return;
    const tone = selectionNoticeTone(notices);
    if (tone === "info") toast.info(message);
    else toast.warning(message);
  };

  const addFiles = (incoming: FileList | File[] | null) => {
    if (!incoming) return;
    const savedSheets = dataset?.run.id === selectedRunId ? dataset.jobs : EMPTY_SHEETS;
    const merged = mergePendingAnalyzerSheets(filesRef.current, Array.from(incoming), {
      locked: submittingRef.current || selectionLockedRef.current,
      savedSheets,
    });
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (merged.blocked) return;
    if (
      draftRef.current
      && analyzerSelectionSignature(merged.files) !== draftRef.current.signature
    ) {
      draftRef.current = null;
    }
    filesRef.current = merged.files;
    setFiles(merged.files);
    reportSelection(merged.notices);
  };

  const removeSelectedFile = (index: number) => {
    if (submittingRef.current) return;
    const next = removePendingAnalyzerSheet(filesRef.current, index);
    if (draftRef.current && analyzerSelectionSignature(next) !== draftRef.current.signature) {
      draftRef.current = null;
    }
    filesRef.current = next;
    setFiles(next);
  };

  const clearSelectedFiles = () => {
    if (submittingRef.current) return;
    draftRef.current = null;
    filesRef.current = clearPendingAnalyzerSheets<File>();
    setFiles(filesRef.current);
  };

  const handleDrag = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (submittingRef.current) return;
    setDragActive(event.type === "dragenter" || event.type === "dragover");
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setDragActive(false);
    addFiles(event.dataTransfer.files);
  };

  const startAnalysis = async (confirmedPlan?: SheetUpdatePlan) => {
    const activeProjectId = projectId;
    const selected = confirmedPlan ? updateFilesRef.current : filesRef.current;
    const action = analyzerSubmissionAction({
      inFlight: submittingRef.current || cancellingRef.current,
      projectId: activeProjectId,
      files: selected,
      draft: draftRef.current,
      runStatus: activeRun?.status ?? null,
    });
    if (action === "ignore") {
      if (!submittingRef.current && !cancellingRef.current && !activeProjectId) {
        toast.error("Select a project before starting an analysis");
      } else if (!submittingRef.current && !cancellingRef.current && selected.length === 0) {
        toast.error("Select at least one drawing sheet");
      }
      return;
    }
    if (action === "blocked") {
      toast.error("This analysis is still processing. Cancel it before updating drawings.");
      return;
    }
    if (action === "update" && !confirmedPlan) {
      if (!dataset || dataset.run.id !== activeRun?.id) {
        toast.error("Analysis is still loading");
        return;
      }
      const plan = planSheetUpdate(dataset.jobs, selected);
      if (plan.error) {
        toast.error(plan.error);
        return;
      }
      if (!plan.needsConfirmation && plan.resumed === 0) {
        toast.info("Those drawings are already in this analysis and were not changed.");
        return;
      }
      if (plan.needsConfirmation) {
        updateFilesRef.current = selected;
        setUpdatePlan(plan);
        return;
      }
    }

    const submission = confirmedPlan ? "update" as const : action;
    submittingRef.current = true;
    setSubmitting(true);
    setUploadProgress({ completed: 0, total: selected.length, fileName: selected[0]?.name || "drawing.pdf" });
    try {
      let runId: string;
      let uploads = draftRef.current?.uploads || [];
      if (submission === "create") {
        const created = await createSupabaseAnalyzerRun({
          projectId: activeProjectId!,
          files: selected,
          jurisdictionKey: jurisdictionKeyFor(jurisdiction),
          jurisdictionLabel: jurisdiction,
          projectType,
          codeEdition: codeYear,
          codeContext: codeContextForAnalyzer(jurisdiction, codeYear),
          analysisMode,
        });
        runId = created.runId;
        uploads = created.uploads;
        draftRef.current = {
          projectId: activeProjectId!,
          signature: analyzerSelectionSignature(selected),
          runId,
          uploads,
        };
      } else if (submission === "update") {
        const plan = confirmedPlan || planSheetUpdate(dataset?.jobs || [], selected, { confirmed: true });
        const replaceIds = new Map(
          plan.items.flatMap((item) => (
            (item.action === "confirm" || item.action === "replace") && item.jobId
              ? [[analyzerFileIdentity(item.fileName, item.fileSize), item.jobId] as const]
              : []
          )),
        );
        const updated = await updateSupabaseAnalyzerRun({
          projectId: activeProjectId!,
          runId: activeRun?.id || draftRef.current?.runId || "",
          confirmed: true,
          files: selected.map((file) => ({
            name: file.name,
            size: file.size,
            type: file.type || "application/pdf",
            replaceJobId: replaceIds.get(analyzerFileIdentity(file.name, file.size)) || null,
          })),
        });
        runId = updated.runId;
        uploads = updated.uploads;
        if (uploads.length === 0) {
          toast.info("Those drawings are already in this analysis and were not changed.");
          draftRef.current = null;
          filesRef.current = [];
          setFiles([]);
          return;
        }
        draftRef.current = {
          projectId: activeProjectId!,
          signature: analyzerSelectionSignature(selected),
          runId,
          uploads,
        };
      } else {
        runId = draftRef.current!.runId;
      }

      setSelectedRunId(runId);
      if (uploads.length > 0) {
        const uploaded = await uploadSupabaseAnalyzerFiles(
          selected,
          uploads,
          (completed, total, fileName) => setUploadProgress({ completed, total, fileName }),
        );
        const remaining = failedUploadDescriptors(
          uploads,
          uploaded.failures.map((failure) => failure.jobId),
        );
        draftRef.current = {
          projectId: activeProjectId!,
          signature: analyzerSelectionSignature(selected),
          runId,
          uploads: remaining,
        };
        if (remaining.length > 0) {
          if (uploaded.completed > 0) {
            await finalizeSupabaseAnalyzerRun(activeProjectId!, runId);
            await loadRuns(activeProjectId!);
            await loadDataset(runId);
          }
          toast.warning(
            `${remaining.length} sheet${remaining.length === 1 ? "" : "s"} could not be uploaded. They remain selected so you can try again.`,
          );
          return;
        }
      }

      const finalized = await finalizeSupabaseAnalyzerRun(activeProjectId!, runId);
      await loadRuns(activeProjectId!);
      await loadDataset(runId);
      draftRef.current = null;
      filesRef.current = [];
      setFiles([]);
      if (finalized.missing.length) {
        toast.warning(
          `${finalized.queued} sheets queued; ${finalized.missing.length} uploads need attention.`,
        );
      } else if (submission === "update") {
        toast.success(
          finalized.queued === 1
            ? "Updated analysis. 1 drawing queued. Completed sheets were kept."
            : `Updated analysis. ${finalized.queued} drawings queued. Completed sheets were kept.`,
        );
      } else {
        toast.success(`${finalized.queued} drawing sheets queued for analysis`);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not start analysis");
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
      setUploadProgress(null);
    }
  };

  const confirmUpdate = () => {
    if (!updatePlan || submittingRef.current || cancellingRef.current) return;
    const plan = updatePlan;
    setUpdatePlan(null);
    void startAnalysis(plan);
  };

  const retryFailed = async (jobIds?: string[]) => {
    if (!projectId || !activeRun || submittingRef.current || cancellingRef.current) return;
    if (activeRun.status === "cancelled" || ["uploading", "queued", "processing"].includes(activeRun.status)) return;
    try {
      const result = await retrySupabaseAnalyzerJobs(projectId, activeRun.id, jobIds);
      toast.success(result.retried ? `Retrying ${result.retried} sheet(s)` : "No failed sheets to retry");
      await loadDataset(activeRun.id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not retry sheets");
    }
  };

  const cancelRun = async () => {
    if (!projectId || !activeRun || cancellingRef.current || submittingRef.current) return;
    if (!["uploading", "queued", "processing"].includes(activeRun.status)) return;
    cancellingRef.current = true;
    setCancelling(true);
    try {
      await cancelSupabaseAnalyzerRun(projectId, activeRun.id);
      toast.success("Analysis cancelled");
      await loadDataset(activeRun.id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not cancel analysis");
    } finally {
      cancellingRef.current = false;
      setCancelling(false);
    }
  };

  const findingsByJob = useMemo(() => {
    const grouped = new Map<string, SupabaseAnalyzerFinding[]>();
    for (const finding of dataset?.findings || []) {
      const list = grouped.get(finding.sheet_job_id) || [];
      list.push(finding);
      grouped.set(finding.sheet_job_id, list);
    }
    return grouped;
  }, [dataset?.findings]);

  const jurisdictionOptions = useMemo(
    () => analyzerJurisdictionGroups.flatMap((group) =>
      group.items.map((item) => ({ value: item, label: item, group: group.label })),
    ),
    [],
  );
  const projectTypeOptions = useMemo(
    () => analyzerProjectTypeGroups.flatMap((group) =>
      group.items.map((item) => ({ value: item, label: item, group: group.label })),
    ),
    [],
  );
  const codeContext = codeContextForAnalyzer(jurisdiction, codeYear);
  const reviewScope = useMemo(
    () => resolveAnalyzerReviewScope({
      mode: analysisMode,
      jurisdictionKey: jurisdictionKeyFor(jurisdiction),
      jurisdictionLabel: jurisdiction,
      codeEdition: codeYear,
      codeContext,
    }),
    [analysisMode, jurisdiction, codeYear, codeContext],
  );
  const findingCounts = useMemo(
    () => countSeverity(dataset?.findings || []),
    [dataset?.findings],
  );
  const reviewsByFinding = useMemo(
    () => reviewsByFindingForRun(dataset?.reviews || [], dataset?.run.id || ""),
    [dataset],
  );
  const reportModel = useMemo(() => (dataset ? buildArchitectReviewModel(dataset) : null), [dataset]);
  const [reportVersion, setReportVersion] = useState<{ runId: string; label: string } | null>(null);
  useEffect(() => {
    if (!dataset) {
      setReportVersion(null);
      return;
    }
    let current = true;
    fingerprintArchitectReview(dataset)
      .then((fingerprint) => {
        if (current) setReportVersion({ runId: dataset.run.id, label: fingerprint.label });
      })
      .catch((error) => {
        console.error("[supabase-analyzer] report fingerprint failed", error);
        if (current) setReportVersion(null);
      });
    return () => {
      current = false;
    };
  }, [dataset]);
  const auditExport = <T,>(format: AnalyzerExportFormat, generate: () => Promise<T>) => {
    if (!dataset) return generate();
    return withAnalyzerExportAudit({
      send: recordSupabaseAnalyzerExport,
      dataset,
      format,
      generate,
    });
  };
  const downloadArchitectReview = async () => {
    if (!dataset || exportingKind) return;
    setExportingKind("pdf");
    try {
      const result = await auditExport("architect-review-pdf", () => downloadArchitectReviewPdf(dataset, selectedProject?.name));
      if (!result.logoIncluded) toast.warning("The report was created without the Commun-ET logo because the logo could not be loaded.");
    } catch (error) {
      console.error("[supabase-analyzer] architect review export failed", error);
      toast.error("Could not create the architect review PDF");
    } finally {
      setExportingKind(null);
    }
  };
  const downloadFindingsRegister = async () => {
    if (!dataset || exportingKind) return;
    setExportingKind("excel");
    try {
      const result = await auditExport("findings-register-xlsx", () => downloadFindingsRegisterExcel(dataset, selectedProject?.name));
      if (!result.logoIncluded) toast.warning("The register was created without the Commun-ET logo because the logo could not be loaded.");
    } catch (error) {
      console.error("[supabase-analyzer] findings register export failed", error);
      toast.error("Could not create the Excel findings register");
    } finally {
      setExportingKind(null);
    }
  };
  const downloadSheetOrderPdf = () => {
    if (!dataset) return;
    void auditExport("sheet-order-pdf", async () => {
      exportSupabaseAnalyzerReport(dataset, selectedProject?.name);
    }).catch((error) => {
      console.error("[supabase-analyzer] sheet-order PDF export failed", error);
      toast.error("Could not create the sheet-order PDF");
    });
  };
  const downloadAnalyzerJson = () => {
    if (!dataset) return;
    void auditExport("json", async () => {
      downloadSupabaseAnalyzerJson(dataset, selectedProject?.name);
    }).catch((error) => {
      console.error("[supabase-analyzer] JSON export failed", error);
      toast.error("Could not create the JSON export");
    });
  };
  const selectRunSeverity = (filter: FindingSeverityFilter) => {
    const next = expansionForRunSeverity(
      { expandedJobIds, expansionBeforeFilter: expansionBeforeFilterRef.current },
      filter,
      dataset?.findings || [],
    );
    expansionBeforeFilterRef.current = next.expansionBeforeFilter;
    setSeverityFilter(filter);
    setSheetSeverity({});
    setExpandedJobIds(next.expandedJobIds);
  };
  const selectSheetSeverity = (jobId: string, filter: FindingSeverityFilter) => {
    setSheetSeverity((current) => ({ ...current, [jobId]: filter }));
  };
  const persistDecision = async (
    finding: SupabaseAnalyzerFinding,
    decision: ReviewDecisionStatus,
    modifiedResponse?: string | null,
  ) => {
    if (!dataset || dataset.run.id !== finding.run_id) return false;
    setSavingFindingId(finding.id);
    try {
      const saved = await saveSupabaseAnalyzerReviewDecision({
        projectId: dataset.run.project_id,
        runId: finding.run_id,
        sheetJobId: finding.sheet_job_id,
        findingId: finding.id,
        decision,
        modifiedResponse,
        originalRecommendation: finding.recommendation,
      });
      setDataset((current) => (
        current && current.run.id === saved.run_id ? mergeReviewDecision(current, saved) : current
      ));
      toast.success(
        decision === "accepted"
          ? "Marked accepted"
          : decision === "modified"
            ? "Reviewer response saved"
            : "Marked rejected",
      );
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save the review decision");
      return false;
    } finally {
      setSavingFindingId(null);
    }
  };
  const openModify = (finding: SupabaseAnalyzerFinding) => {
    const existing = reviewsByFinding.get(finding.id);
    setModifyTarget(finding);
    setModifiedText(
      existing?.decision === "modified" && existing.modified_response
        ? existing.modified_response
        : finding.recommendation,
    );
  };
  const finishedSheets = activeRun ? activeRun.completed_sheets + activeRun.failed_sheets : 0;
  const runInProgress = Boolean(activeRun && ACTIVE_STATUSES.has(activeRun.status));
  const cancelledSheets = dataset?.jobs.filter((job) => job.status === "cancelled").length || 0;
  const actionPresentation = analyzerActionPresentation({
    hasProject: Boolean(projectId),
    hasRun: Boolean(activeRun),
    runStatus: activeRun?.status ?? null,
    fileCount: files.length,
    selectedSheetCount: selectedDrawingIds.size,
    failedSheets: activeRun?.failed_sheets || 0,
    submitting,
    cancelling,
  });
  selectionLockedRef.current = actionPresentation.lockSelection;
  const updateCopy = updatePlan ? updateConfirmationCopy(updatePlan) : null;
  const savedJobs = dataset?.run.id === selectedRunId ? dataset.jobs : EMPTY_SHEETS;
  const capacity = useMemo(
    () => selectionCapacity({ saved: savedJobs, pending: files }),
    [savedJobs, files],
  );
  const existingDrawings = useMemo(
    () => savedJobs
      .filter((job) => job.status !== "cancelled")
      .sort((left, right) => left.ordinal - right.ordinal),
    [savedJobs],
  );

  const toggleJob = (jobId: string) => {
    setExpandedJobIds((current) => {
      const next = new Set(current);
      if (next.has(jobId)) next.delete(jobId);
      else next.add(jobId);
      return next;
    });
  };
  const toggleFinding = (findingId: string) => {
    setExpandedFindingIds((current) => {
      const next = new Set(current);
      if (next.has(findingId)) next.delete(findingId);
      else next.add(findingId);
      return next;
    });
  };

  const drawingControls = reanalyzeControls({
    hasProject: Boolean(projectId),
    runStatus: activeRun?.status ?? null,
    occupyingCount: capacity.existingCount,
    selectedCount: selectedDrawingIds.size,
    submitting,
    cancelling,
  });
  const reanalysisCopy = reanalysisPlan ? reanalysisConfirmationCopy(reanalysisPlan, reanalysisIntent) : null;

  const setDrawingSelection = (next: Set<string>) => {
    selectedDrawingIdsRef.current = next;
    setSelectedDrawingIds(next);
  };

  const toggleDrawingSelection = (jobId: string, checked: boolean) => {
    if (drawingControls.selectionDisabled) return;
    const next = new Set(selectedDrawingIdsRef.current);
    if (checked) next.add(jobId);
    else next.delete(jobId);
    setDrawingSelection(next);
  };

  const sourceSheets = () => savedJobs.map((job) => ({
    id: job.id,
    ordinal: job.ordinal,
    original_file_name: job.original_file_name,
    file_size: job.file_size,
    detected_sheet_number: job.detected_sheet_number,
    detected_sheet_title: job.detected_sheet_title,
    discipline: job.discipline,
    status: job.status,
    object_path: job.object_path,
  }));

  const openReanalysis = (intent: ReanalysisIntent) => {
    if (submittingRef.current || cancellingRef.current) return;
    if (!projectId || !activeRun || dataset?.run.id !== activeRun.id) {
      toast.error("Analysis is still loading");
      return;
    }
    if (runIsWorkerActive(activeRun.status) || activeRun.status === "uploading") {
      toast.error("This analysis is still processing. Cancel it before reanalyzing drawings.");
      return;
    }
    reanalysisFilesRef.current = [...filesRef.current];
    const plan = planReanalysis({
      sourceRunId: activeRun.id,
      jobs: sourceSheets(),
      selectedJobIds: intent === "all" ? "all" : [...selectedDrawingIdsRef.current],
      incoming: reanalysisFilesRef.current,
      confirmed: false,
    });
    if (plan.error) {
      toast.error(plan.error);
      return;
    }
    if (plan.totalSheets < 1) {
      toast.error("Select at least one saved drawing");
      return;
    }
    setReanalysisIntent(intent);
    setReanalysisPlan(plan);
  };

  const executeReanalysis = async (intent: ReanalysisIntent, preview: ReanalysisPlan) => {
    const activeProjectId = projectId;
    const sourceRunId = activeRun?.id;
    if (!activeProjectId || !sourceRunId) {
      toast.error("Select a project before starting an analysis");
      return;
    }
    const selectedIds = preview.selectedJobIds;
    const replaceIds = new Map(
      preview.items.flatMap((item) => (
        item.replaceJobId
          ? [[analyzerFileIdentity(item.fileName, item.fileSize), item.replaceJobId] as const]
          : []
      )),
    );
    const chosenFiles = reanalysisFilesRef.current;
    const selectedFiles = chosenFiles.map((file) => ({
      name: file.name,
      size: file.size,
      type: file.type || "application/pdf",
      replaceJobId: replaceIds.get(analyzerFileIdentity(file.name, file.size)) || null,
    }));
    const finalPlan = planReanalysis({
      sourceRunId,
      jobs: sourceSheets(),
      selectedJobIds: intent === "all" ? "all" : selectedIds,
      incoming: selectedFiles,
      confirmed: true,
    });
    if (!finalPlan.accepted) {
      toast.error(finalPlan.error || "Confirm the drawing update before reanalyzing");
      return;
    }
    const requestKey = reanalysisRequestKey({
      sourceRunId,
      scope: intent === "all" ? "all" : "selected",
      jobIds: selectedIds,
      files: selectedFiles,
      analysisMode,
    });
    const runId = reanalysisRequestRef.current?.key === requestKey
      ? reanalysisRequestRef.current.runId
      : crypto.randomUUID();
    reanalysisRequestRef.current = { key: requestKey, runId };
    if (finalPlan.uploadCount > 0) {
      setUploadProgress({
        completed: 0,
        total: finalPlan.uploadCount,
        fileName: chosenFiles[0]?.name || "drawing.pdf",
      });
    }
    try {
      const result = await reanalyzeSupabaseAnalyzerRun({
        projectId: activeProjectId,
        sourceRunId,
        runId,
        scope: intent === "all" ? "all" : "selected",
        jobIds: intent === "all" ? [] : selectedIds,
        files: selectedFiles,
        confirmed: true,
        analysisMode,
        jurisdictionKey: jurisdictionKeyFor(jurisdiction),
        jurisdictionLabel: jurisdiction,
        projectType,
        codeEdition: codeYear,
        codeContext: codeContextForAnalyzer(jurisdiction, codeYear),
      });
      setSelectedRunId(result.runId);
      if (result.uploads.length > 0) {
        const uploaded = await uploadSupabaseAnalyzerFiles(
          chosenFiles,
          result.uploads,
          (completed, total, fileName) => setUploadProgress({ completed, total, fileName }),
        );
        const remaining = failedUploadDescriptors(
          result.uploads,
          uploaded.failures.map((failure) => failure.jobId),
        );
        if (remaining.length > 0) {
          if (uploaded.completed > 0) {
            await finalizeSupabaseAnalyzerRun(activeProjectId, result.runId);
            await loadRuns(activeProjectId);
            await loadDataset(result.runId);
          }
          toast.warning(
            `${remaining.length} sheet${remaining.length === 1 ? "" : "s"} could not be uploaded. They remain selected so you can try again.`,
          );
          return;
        }
        await finalizeSupabaseAnalyzerRun(activeProjectId, result.runId);
      }
      await loadRuns(activeProjectId);
      await loadDataset(result.runId);
      filesRef.current = [];
      setFiles([]);
      reanalysisFilesRef.current = [];
      reanalysisRequestRef.current = null;
      toast.success(
        result.uploads.length > 0
          ? "New analysis queued. The current run was kept."
          : result.reused === 1
            ? "1 saved drawing queued in a new analysis. The current run was kept."
            : `${result.reused} saved drawings queued in a new analysis. The current run was kept.`,
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not reanalyze drawings");
    }
  };

  const confirmReanalysis = () => {
    if (!reanalysisPlan || submittingRef.current || cancellingRef.current) return;
    const preview = reanalysisPlan;
    const intent = reanalysisIntent;
    submittingRef.current = true;
    setSubmitting(true);
    setReanalysisPlan(null);
    void executeReanalysis(intent, preview).finally(() => {
      submittingRef.current = false;
      setSubmitting(false);
      setUploadProgress(null);
    });
  };

  return (
    <div className="space-y-6">
      <Card className="pilot-card border-border bg-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-foreground">
            <Shield className="h-5 w-5 text-teal" />
            Code Analyzer
          </CardTitle>
          <CardDescription className="text-muted-foreground">
            Upload up to 100 individual permit drawing PDFs. Processing continues after you leave this page.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label className="flex items-center gap-2 text-foreground">
              <FolderKanban className="h-4 w-4" />
              Project
            </Label>
            <Select
              value={projectId || "__none__"}
              disabled={submitting}
              onValueChange={(value) => setSelectedProjectId(value === "__none__" ? null : value)}
            >
              <SelectTrigger data-testid="select-project">
                <SelectValue placeholder="Select a project" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Select a project</SelectItem>
                {projects.map((project) => (
                  <SelectItem key={project.id} value={project.id}>{project.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <Label className="flex items-center gap-2 text-foreground">
                <MapPin className="h-4 w-4" />
                Jurisdiction
              </Label>
              <SearchableCombobox
                options={jurisdictionOptions}
                value={jurisdiction}
                disabled={submitting}
                onValueChange={(value) => {
                  setJurisdiction(value);
                  setCodeYear(defaultCodeYearForAnalyzer(value));
                }}
                placeholder="Select jurisdiction..."
                searchPlaceholder="Search jurisdictions..."
                emptyText="No jurisdiction found."
                data-testid="select-jurisdiction"
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
                disabled={submitting}
                onValueChange={setProjectType}
                placeholder="Select project type..."
                searchPlaceholder="Search project types..."
                emptyText="No project type found."
                data-testid="select-project-type"
              />
            </div>
            <div className="space-y-2">
              <Label className="flex items-center gap-2 text-foreground">
                <Calendar className="h-4 w-4" />
                Code Year
              </Label>
              <Select value={codeYear} disabled={submitting} onValueChange={setCodeYear}>
                <SelectTrigger data-testid="select-code-year">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {analyzerCodeYears.map((year) => (
                    <SelectItem key={year} value={year}>{year}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <Card className="pilot-card border-border bg-card border-teal/20 shadow-sm" data-testid="analysis-mode-control">
            <CardContent className="pt-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <Scale className="h-5 w-5 shrink-0 text-teal" />
                  <div className="min-w-0">
                    <p className="font-medium text-foreground">Dual Code Analysis</p>
                    <p className="text-sm text-muted-foreground">
                      This jurisdiction has local amendments. Choose analysis mode:
                    </p>
                  </div>
                </div>
                <div className="flex w-full min-w-0 items-center gap-2 sm:w-auto">
                  <Select
                    value={analysisMode}
                    disabled={submitting}
                    onValueChange={(value) => {
                      if (value === "both" || value === "ibc_only" || value === "local_only") {
                        setAnalysisMode(value);
                      }
                    }}
                  >
                    <SelectTrigger className="w-full max-w-full sm:w-[180px]" data-testid="select-analysis-mode">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {analysisModeControlOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.value === "both" ? (
                            <div className="flex items-center gap-2">
                              <ToggleLeft className="h-4 w-4" />
                              {option.label}
                            </div>
                          ) : option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardContent>
          </Card>
          <p className="text-xs text-muted-foreground">{reviewScope.limitation}</p>
          <Badge variant="outline" className="h-auto whitespace-normal text-left font-normal">
            {codeContext}
          </Badge>

          {capacity.existingCount > 0 ? (
            <ExistingDrawingsPanel
              jobs={existingDrawings}
              count={capacity.existingCount}
              remaining={capacity.remaining}
              expanded={existingDrawingsOpen}
              onToggle={() => setExistingDrawingsOpen((open) => !open)}
              selectedIds={selectedDrawingIds}
              onToggleJob={toggleDrawingSelection}
              onSelectAll={() => {
                if (drawingControls.selectionDisabled) return;
                setDrawingSelection(new Set(existingDrawings.map((job) => job.id)));
              }}
              onDeselectAll={() => {
                if (drawingControls.selectionDisabled) return;
                setDrawingSelection(new Set());
              }}
              onReanalyzeSelected={() => openReanalysis("selected")}
              onReanalyzeAll={() => openReanalysis("all")}
              selectionDisabled={drawingControls.selectionDisabled}
              selectedDisabled={drawingControls.selectedDisabled}
              allDisabled={drawingControls.allDisabled}
            />
          ) : null}

          <div className="space-y-2">
            {capacity.existingCount > 0 ? (
              <h3 className="text-sm font-semibold text-foreground">Add New / Revised Drawings</h3>
            ) : null}
            <div
              className={`border-2 border-dashed rounded-xl p-8 text-center transition-colors ${
                dragActive ? "border-teal bg-teal/[0.06]" : "border-primary/35 hover:border-primary/55 bg-muted/25"
              }`}
              onDragEnter={handleDrag}
              onDragLeave={handleDrag}
              onDragOver={handleDrag}
              onDrop={handleDrop}
            >
              <Input
                ref={fileInputRef}
                type="file"
                accept="application/pdf,.pdf"
                multiple
                className="hidden"
                onChange={(event) => addFiles(event.target.files)}
              />
              {files.length === 0 ? (
                <div className="space-y-2">
                  <div className="flex justify-center gap-4 pt-4">
                    <FileText className="h-12 w-12 text-primary-deep/75" />
                    <Upload className="h-12 w-12 text-teal" />
                  </div>
                  <p className="text-lg font-medium text-foreground">Drop drawings here or click to browse</p>
                  <p className="text-sm text-muted-foreground">
                    {capacity.existingCount > 0
                      ? `Add a new drawing or a revised sheet. ${capacity.remaining} sheets available. Replacing a drawing does not use an extra sheet. 15 MB each, 250 MB total.`
                      : "Add drawings in more than one selection. Up to 100 sheets, 15 MB each, 250 MB total."}
                  </p>
                  <Button
                    type="button"
                    variant="outlineGold"
                    className="mt-4"
                    disabled={actionPresentation.lockSelection}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    Choose drawings
                  </Button>
                </div>
              ) : (
                <div className="space-y-4 text-left">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-sm text-muted-foreground" data-testid="analyzer-pending-file-capacity">
                      {capacity.existingCount > 0
                        ? `${files.length} selected · Remaining capacity: ${capacity.remaining} sheets · ${bytesLabel(totalBytes)} of ${bytesLabel(SUPABASE_ANALYZER_MAX_TOTAL_BYTES)}`
                        : `${files.length} of ${SUPABASE_ANALYZER_MAX_SHEETS} sheets · ${bytesLabel(totalBytes)} of ${bytesLabel(SUPABASE_ANALYZER_MAX_TOTAL_BYTES)}`}
                    </p>
                    <Button type="button" variant="ghost" onClick={clearSelectedFiles} disabled={actionPresentation.lockSelection}>
                      <X className="mr-2 h-4 w-4" /> Clear
                    </Button>
                  </div>
                  <PendingDrawingCards
                    files={files}
                    submitting={actionPresentation.lockSelection}
                    onRemove={removeSelectedFile}
                  />
                  {files.length < SUPABASE_ANALYZER_MAX_SHEETS && (capacity.remaining > 0 || capacity.existingCount > 0) ? (
                    <div className="flex justify-center border-t pt-2">
                      <Button
                        type="button"
                        variant="outlineGold"
                        size="sm"
                        disabled={actionPresentation.lockSelection}
                        onClick={() => fileInputRef.current?.click()}
                      >
                        Add More Drawings
                      </Button>
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-wrap justify-center gap-4">
            <Button
              variant="gold"
              size="lg"
              onClick={() => {
                if (selectedDrawingIdsRef.current.size > 0) {
                  openReanalysis("update");
                  return;
                }
                void startAnalysis();
              }}
              disabled={actionPresentation.primaryDisabled}
              className="px-8"
              data-testid="button-analyze-compliance"
            >
              {submitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {uploadProgress
                    ? `Uploading ${uploadProgress.completed} / ${uploadProgress.total}`
                    : "Uploading"}
                </>
              ) : actionPresentation.primaryLabel === "Processing" ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Processing
                </>
              ) : (
                <>
                  <Shield className="mr-2 h-4 w-4" />
                  {actionPresentation.primaryLabel}
                </>
              )}
            </Button>
            {actionPresentation.showCancel ? (
              <Button
                type="button"
                variant="outlineGold"
                size="lg"
                onClick={() => void cancelRun()}
                disabled={actionPresentation.cancelDisabled}
                data-testid="button-cancel-analyzer-run"
                aria-label="Cancel analysis"
              >
                {cancelling ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Cancelling…
                  </>
                ) : (
                  "Cancel Analysis"
                )}
              </Button>
            ) : null}
            {actionPresentation.showRetry ? (
              <Button
                type="button"
                variant="outlineGold"
                size="lg"
                onClick={() => void retryFailed()}
                disabled={actionPresentation.retryDisabled}
              >
                <RotateCcw className="mr-2 h-4 w-4" />
                Retry failed sheets ({activeRun?.failed_sheets || 0})
              </Button>
            ) : null}
          </div>
          {actionPresentation.statusText ? (
            <div className="flex justify-center">
              <Badge variant="outline" data-testid="analyzer-run-status">
                {actionPresentation.statusText}
              </Badge>
            </div>
          ) : null}
          {activeRun && !runInProgress ? (
            <p className="text-center text-xs text-muted-foreground">
              Add a new or revised drawing, then choose Update Analysis, or reanalyze saved drawings without uploading them again. A reanalysis creates a new analysis and keeps this run.
            </p>
          ) : null}

          {uploadProgress ? (
            <div className="space-y-2" data-testid="drawing-upload-progress">
              <Progress
                value={(uploadProgress.completed / Math.max(1, uploadProgress.total)) * 100}
                className="h-2"
              />
              <p className="text-center text-sm text-muted-foreground">
                Uploading {uploadProgress.fileName} · {uploadProgress.completed} / {uploadProgress.total}
              </p>
            </div>
          ) : null}

          {activeRun && activeRun.total_sheets > 0 ? (
            <div className="space-y-2" data-testid="analyzer-sheet-progress">
              <Progress value={progress} className="h-2" />
              <p className="text-center text-sm text-foreground">
                {finishedSheets} of {activeRun.total_sheets} sheets finished
              </p>
              <p className="text-center text-xs text-muted-foreground">
                Queued {activeRun.queued_sheets} · Processing {activeRun.processing_sheets} · Completed {activeRun.completed_sheets} · Failed {activeRun.failed_sheets}{cancelledSheets > 0 ? ` · Cancelled ${cancelledSheets}` : ""} · {progress}%
              </p>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {loading && !dataset ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading analysis
        </div>
      ) : null}

      {activeRun ? (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-6"
          data-testid="supabase-analyzer-results"
        >
          <FindingsMatrix
            counts={findingCounts}
            active={severityFilter}
            processing={runInProgress}
            onSelect={selectRunSeverity}
          />
          {dataset ? <SupabaseAnalyzerQualityDrawer dataset={dataset} /> : null}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2" data-testid="analysis-history-control">
              <Label className="text-sm text-muted-foreground">Analysis history</Label>
              <Select value={selectedRunId || undefined} onValueChange={setSelectedRunId}>
                <SelectTrigger className="w-[280px] max-w-full">
                  <SelectValue placeholder="Select an analysis" />
                </SelectTrigger>
                <SelectContent>
                  {runs.map((run) => (
                    <SelectItem key={run.id} value={run.id}>
                      {new Date(run.created_at).toLocaleString()} · {statusLabel(run.status)} · {analysisModeShortLabel(run.analysis_mode)} · {run.total_sheets} sheets
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="text-right">
              <p className="text-sm text-muted-foreground">
                {activeRun.jurisdiction_label} · {activeRun.code_context} · {displayAnalysisMode(activeRun.analysis_mode)}
              </p>
              {reportModel && reportVersion && reportVersion.runId === activeRun.id ? (
                <p
                  className="text-xs text-muted-foreground"
                  data-testid="analyzer-report-version"
                  title="Finding numbers belong to this report version. They change when findings or reviewer decisions change."
                >
                  Report version <span className="font-mono">{reportVersion.label}</span>
                  {reportModel.isFinal ? "" : " · Draft"}
                </p>
              ) : null}
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div className="space-y-4">
              {dataset && dataset.jobs.length > 0 ? (
                <DrawingReviewList
                  jobs={dataset.jobs}
                  findingsByJob={findingsByJob}
                  severityFilter={severityFilter}
                  sheetSeverity={sheetSeverity}
                  activeDiscipline={activeDiscipline}
                  onDiscipline={setActiveDiscipline}
                  onSheetSeverity={selectSheetSeverity}
                  reviewsByFinding={reviewsByFinding}
                  reportIdByFindingId={reportModel?.reportIdByFindingId}
                  savingFindingId={savingFindingId}
                  onAccept={(finding) => void persistDecision(finding, "accepted")}
                  onModify={openModify}
                  onReject={(finding) => void persistDecision(finding, "rejected")}
                  expandedJobIds={expandedJobIds}
                  onToggleJob={toggleJob}
                  expandedFindingIds={expandedFindingIds}
                  onToggleFinding={toggleFinding}
                  onRetry={(jobId) => void retryFailed([jobId])}
                  retryDisabled={actionPresentation.retryDisabled || runInProgress || cancelling}
                />
              ) : (
                <p className="text-sm text-muted-foreground">
                  {loading ? "Loading sheets" : "Sheets appear here after the drawings are queued."}
                </p>
              )}
            </div>
            <AnalyzerSideActions>
              <Button
                variant="outline"
                className="w-full justify-start"
                onClick={() => selectedRunId && void loadDataset(selectedRunId)}
                disabled={loading || !selectedRunId}
              >
                <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
                Refresh
              </Button>
              <Button
                variant="gold"
                className="w-full justify-start"
                data-testid="download-architect-review"
                onClick={() => void downloadArchitectReview()}
                disabled={!dataset || Boolean(exportingKind)}
              >
                {exportingKind === "pdf" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
                Download Architect Review (PDF)
              </Button>
              <Button
                variant="outlineGold"
                className="w-full justify-start"
                data-testid="download-findings-register"
                onClick={() => void downloadFindingsRegister()}
                disabled={!dataset || Boolean(exportingKind)}
              >
                {exportingKind === "excel" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
                Download Excel Register
              </Button>
              <Button
                variant="outlineGold"
                className="w-full justify-start"
                onClick={downloadSheetOrderPdf}
                disabled={!dataset}
              >
                <Download className="mr-2 h-4 w-4" />
                Download sheet-order PDF
              </Button>
              <Button
                variant="outlineGold"
                className="w-full justify-start"
                data-testid="download-analyzer-json"
                onClick={downloadAnalyzerJson}
                disabled={!dataset}
              >
                <Download className="mr-2 h-4 w-4" />
                Download JSON
              </Button>
            </AnalyzerSideActions>
          </div>
        </motion.div>
      ) : null}
      <Dialog
        open={Boolean(modifyTarget)}
        onOpenChange={(open) => {
          if (!open && !savingFindingId) setModifyTarget(null);
        }}
      >
        <DialogContent data-testid="modify-response-dialog">
          <DialogHeader>
            <DialogTitle>Modify Response</DialogTitle>
            <DialogDescription>
              Edit the recommended action for this finding. The original recommendation stays unchanged.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Original Suggestion</Label>
              <p className="mt-1 text-sm text-muted-foreground">{modifyTarget?.recommendation}</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="reviewer-response">Your Response</Label>
              <Textarea
                id="reviewer-response"
                value={modifiedText}
                onChange={(event) => setModifiedText(event.target.value)}
                rows={4}
                placeholder="Enter your modified response..."
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outlineGold"
                onClick={() => setModifyTarget(null)}
                disabled={Boolean(savingFindingId)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="gold"
                onClick={() => {
                  if (!modifyTarget) return;
                  void persistDecision(modifyTarget, "modified", modifiedText).then((saved) => {
                    if (saved) setModifyTarget(null);
                  });
                }}
                disabled={Boolean(savingFindingId)}
              >
                Save Response
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <AlertDialog
        open={Boolean(updateCopy)}
        onOpenChange={(open) => {
          if (!open && !submitting) setUpdatePlan(null);
        }}
      >
        <AlertDialogContent data-testid="update-analysis-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>{updateCopy?.title || "Update Analysis"}</AlertDialogTitle>
            <AlertDialogDescription>{updateCopy?.intro}</AlertDialogDescription>
          </AlertDialogHeader>
          {updateCopy ? (
            <div className="space-y-3 text-sm text-muted-foreground">
              {updateCopy.replacements.length > 0 ? (
                <ul className="list-disc space-y-1 pl-5">
                  {updateCopy.replacements.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              ) : null}
              {updateCopy.adds.length > 0 ? (
                <div>
                  <p className="text-foreground">
                    Add {updateCopy.adds.length} new drawing{updateCopy.adds.length === 1 ? "" : "s"}
                  </p>
                  <ul className="mt-1 list-disc space-y-1 pl-5">
                    {updateCopy.adds.map((name) => (
                      <li key={name}>{name}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {updateCopy.skipped.length > 0 ? (
                <ul className="list-disc space-y-1 pl-5">
                  {updateCopy.skipped.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={submitting}>{updateCopy?.cancelLabel || "Cancel"}</AlertDialogCancel>
            <AlertDialogAction disabled={submitting} onClick={(event) => {
              event.preventDefault();
              confirmUpdate();
            }}
            >
              {updateCopy?.confirmLabel || "Update Analysis"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog
        open={Boolean(reanalysisCopy)}
        onOpenChange={(open) => {
          if (!open && !submitting) setReanalysisPlan(null);
        }}
      >
        <AlertDialogContent data-testid="reanalyze-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>{reanalysisCopy?.title || "Reanalyze drawings"}</AlertDialogTitle>
            <AlertDialogDescription>{reanalysisCopy?.intro}</AlertDialogDescription>
          </AlertDialogHeader>
          {reanalysisCopy && (reanalysisCopy.replacements.length > 0 || reanalysisCopy.adds.length > 0) ? (
            <div className="space-y-3 text-sm text-muted-foreground">
              {reanalysisCopy.replacements.length > 0 ? (
                <ul className="list-disc space-y-1 pl-5">
                  {reanalysisCopy.replacements.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              ) : null}
              {reanalysisCopy.adds.length > 0 ? (
                <div>
                  <p className="text-foreground">
                    Add {reanalysisCopy.adds.length} new drawing{reanalysisCopy.adds.length === 1 ? "" : "s"}
                  </p>
                  <ul className="mt-1 list-disc space-y-1 pl-5">
                    {reanalysisCopy.adds.map((name) => (
                      <li key={name}>{name}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={submitting}>{reanalysisCopy?.cancelLabel || "Cancel"}</AlertDialogCancel>
            <AlertDialogAction
              disabled={submitting}
              onClick={(event) => {
                event.preventDefault();
                confirmReanalysis();
              }}
            >
              {reanalysisCopy?.confirmLabel || "Reanalyze Selected"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
