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
  Shield,
  Upload,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { SearchableCombobox } from "@/components/ui/searchable-combobox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useProjects } from "@/hooks/useProjects";
import { useResolvedProjectId } from "@/hooks/useResolvedProjectId";
import {
  AnalyzerProgressStrip,
  AnalyzerSideActions,
  PendingDrawingCards,
  SheetFindings,
  SheetNavigator,
} from "@/components/compliance/supabaseAnalyzerPresentation";
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
  retrySupabaseAnalyzerJobs,
  uploadSupabaseAnalyzerFiles,
  type AnalyzerRunDataset,
  type SupabaseAnalyzerFinding,
  type SupabaseAnalyzerRun,
  type SupabaseAnalyzerSheetJob,
} from "@/lib/supabaseAnalyzer/client";
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
import { exportSupabaseAnalyzerReport } from "@/lib/supabaseAnalyzer/report";
import {
  analyzerSelectionSignature,
  analyzerSubmissionAction,
  clearPendingAnalyzerSheets,
  describeSelectionNotices,
  failedUploadDescriptors,
  mergePendingAnalyzerSheets,
  removePendingAnalyzerSheet,
  retainPendingSelectionForProject,
  selectionNoticeTone,
  type AnalyzerSubmissionDraft,
} from "@/lib/supabaseAnalyzer/pendingSelection";

const ACTIVE_STATUSES = new Set(["uploading", "queued", "processing"]);

export function SupabaseCodeAnalyzer() {
  const { projects } = useProjects();
  const { projectId, setSelectedProjectId } = useResolvedProjectId();
  const [jurisdiction, setJurisdiction] = useState(DC_JURISDICTION);
  const [projectType, setProjectType] = useState("Commercial (General)");
  const [codeYear, setCodeYear] = useState(DC_CODE_EDITION);
  const [files, setFiles] = useState<File[]>([]);
  const [runs, setRuns] = useState<SupabaseAnalyzerRun[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [dataset, setDataset] = useState<AnalyzerRunDataset | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [activeDiscipline, setActiveDiscipline] = useState("all");
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<{
    completed: number;
    total: number;
    fileName: string;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const filesRef = useRef<File[]>([]);
  const submittingRef = useRef(false);
  const draftRef = useRef<AnalyzerSubmissionDraft | null>(null);
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
    } catch {
      // Invalid legacy local storage should not block the analyzer.
    }
  }, [projectId]);

  useEffect(() => {
    if (!projectId) return;
    localStorage.setItem(
      `permitpilot:supabase-analyzer-config:${projectId}`,
      JSON.stringify({ jurisdiction, projectType, codeYear }),
    );
  }, [projectId, jurisdiction, projectType, codeYear]);

  const reportSelection = (notices: Parameters<typeof describeSelectionNotices>[0]) => {
    const message = describeSelectionNotices(notices);
    if (!message) return;
    const tone = selectionNoticeTone(notices);
    if (tone === "info") toast.info(message);
    else toast.warning(message);
  };

  const addFiles = (incoming: FileList | File[] | null) => {
    if (!incoming) return;
    const merged = mergePendingAnalyzerSheets(filesRef.current, Array.from(incoming), {
      locked: submittingRef.current,
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

  const startAnalysis = async () => {
    const activeProjectId = projectId;
    const selected = filesRef.current;
    const action = analyzerSubmissionAction({
      inFlight: submittingRef.current,
      projectId: activeProjectId,
      files: selected,
      draft: draftRef.current,
    });
    if (action === "ignore") {
      if (!submittingRef.current && !activeProjectId) {
        toast.error("Select a project before starting an analysis");
      } else if (!submittingRef.current && selected.length === 0) {
        toast.error("Select at least one drawing sheet");
      }
      return;
    }

    submittingRef.current = true;
    setSubmitting(true);
    setUploadProgress({ completed: 0, total: selected.length, fileName: selected[0].name });
    try {
      let runId: string;
      let uploads = draftRef.current?.uploads || [];
      if (action === "create") {
        const created = await createSupabaseAnalyzerRun({
          projectId: activeProjectId,
          files: selected,
          jurisdictionKey: jurisdictionKeyFor(jurisdiction),
          jurisdictionLabel: jurisdiction,
          projectType,
          codeEdition: codeYear,
          codeContext: codeContextForAnalyzer(jurisdiction, codeYear),
        });
        runId = created.runId;
        uploads = created.uploads;
        draftRef.current = {
          projectId: activeProjectId,
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
          projectId: activeProjectId,
          signature: analyzerSelectionSignature(selected),
          runId,
          uploads: remaining,
        };
        if (remaining.length > 0) {
          if (uploaded.completed > 0) {
            await finalizeSupabaseAnalyzerRun(activeProjectId, runId);
            await loadRuns(activeProjectId);
            await loadDataset(runId);
          }
          toast.warning(
            `${remaining.length} sheet${remaining.length === 1 ? "" : "s"} could not be uploaded. They remain selected so you can try again.`,
          );
          return;
        }
      }

      const finalized = await finalizeSupabaseAnalyzerRun(activeProjectId, runId);
      await loadRuns(activeProjectId);
      await loadDataset(runId);
      draftRef.current = null;
      filesRef.current = [];
      setFiles([]);
      if (finalized.missing.length) {
        toast.warning(
          `${finalized.queued} sheets queued; ${finalized.missing.length} uploads need attention.`,
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

  const retryFailed = async (jobIds?: string[]) => {
    if (!projectId || !activeRun) return;
    try {
      const result = await retrySupabaseAnalyzerJobs(projectId, activeRun.id, jobIds);
      toast.success(result.retried ? `Retrying ${result.retried} sheet(s)` : "No failed sheets to retry");
      await loadDataset(activeRun.id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not retry sheets");
    }
  };

  const cancelRun = async () => {
    if (!projectId || !activeRun) return;
    try {
      await cancelSupabaseAnalyzerRun(projectId, activeRun.id);
      toast.success("Analysis cancelled");
      await loadDataset(activeRun.id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not cancel analysis");
    }
  };

  const jobsByDiscipline = useMemo(() => {
    const grouped = new Map<string, SupabaseAnalyzerSheetJob[]>();
    for (const job of dataset?.jobs || []) {
      const discipline = job.discipline || "Pending classification";
      const list = grouped.get(discipline) || [];
      list.push(job);
      grouped.set(discipline, list);
    }
    return [...grouped.entries()].sort(([left], [right]) => left.localeCompare(right));
  }, [dataset?.jobs]);

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
  const selectedJob = dataset?.jobs.find((job) => job.id === selectedJobId) || dataset?.jobs[0] || null;
  const selectedFindings = selectedJob ? findingsByJob.get(selectedJob.id) || [] : [];
  const finishedSheets = activeRun ? activeRun.completed_sheets + activeRun.failed_sheets : 0;

  useEffect(() => {
    const jobs = dataset?.jobs || [];
    setSelectedJobId((current) => {
      if (current && jobs.some((job) => job.id === current)) return current;
      return jobs[0]?.id || null;
    });
  }, [dataset?.jobs]);

  const selectDiscipline = (discipline: string) => {
    setActiveDiscipline(discipline);
    const jobs = discipline === "all"
      ? dataset?.jobs || []
      : jobsByDiscipline.find(([name]) => name === discipline)?.[1] || [];
    setSelectedJobId((current) => (current && jobs.some((job) => job.id === current) ? current : jobs[0]?.id || null));
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
          <Badge variant="outline" className="h-auto whitespace-normal text-left font-normal">
            {codeContext}
          </Badge>

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
                  Add drawings in more than one selection. Up to 100 sheets, 15 MB each, 250 MB total.
                </p>
                <Button
                  type="button"
                  variant="outlineGold"
                  className="mt-4"
                  disabled={submitting}
                  onClick={() => fileInputRef.current?.click()}
                >
                  Choose drawings
                </Button>
              </div>
            ) : (
              <div className="space-y-4 text-left">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm text-muted-foreground" data-testid="analyzer-pending-file-capacity">
                    {files.length} of {SUPABASE_ANALYZER_MAX_SHEETS} sheets · {bytesLabel(totalBytes)} of {bytesLabel(SUPABASE_ANALYZER_MAX_TOTAL_BYTES)}
                  </p>
                  <Button type="button" variant="ghost" onClick={clearSelectedFiles} disabled={submitting}>
                    <X className="mr-2 h-4 w-4" /> Clear
                  </Button>
                </div>
                <PendingDrawingCards
                  files={files}
                  submitting={submitting}
                  onRemove={removeSelectedFile}
                />
                {files.length < SUPABASE_ANALYZER_MAX_SHEETS ? (
                  <div className="flex justify-center border-t pt-2">
                    <Button
                      type="button"
                      variant="outlineGold"
                      size="sm"
                      disabled={submitting}
                      onClick={() => fileInputRef.current?.click()}
                    >
                      Add More Drawings
                    </Button>
                  </div>
                ) : null}
              </div>
            )}
          </div>

          <div className="flex flex-wrap justify-center gap-4">
            <Button
              variant="gold"
              size="lg"
              onClick={() => void startAnalysis()}
              disabled={submitting || !projectId || files.length === 0}
              className="px-8"
            >
              {submitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {uploadProgress
                    ? `Uploading ${uploadProgress.completed} / ${uploadProgress.total}`
                    : "Starting analysis"}
                </>
              ) : (
                <>
                  <Shield className="mr-2 h-4 w-4" />
                  Start analysis
                </>
              )}
            </Button>
            {activeRun && ACTIVE_STATUSES.has(activeRun.status) ? (
              <Button type="button" variant="outlineGold" size="lg" onClick={() => void cancelRun()}>
                Cancel
              </Button>
            ) : null}
            {activeRun && activeRun.failed_sheets > 0 && !submitting ? (
              <Button type="button" variant="outlineGold" size="lg" onClick={() => void retryFailed()}>
                <RotateCcw className="mr-2 h-4 w-4" />
                Retry failed sheets ({activeRun.failed_sheets})
              </Button>
            ) : null}
          </div>

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
                Queued {activeRun.queued_sheets} · Processing {activeRun.processing_sheets} · Completed {activeRun.completed_sheets} · Failed {activeRun.failed_sheets} · {progress}%
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
          <AnalyzerProgressStrip
            total={activeRun.total_sheets}
            queued={activeRun.queued_sheets}
            processing={activeRun.processing_sheets}
            completed={activeRun.completed_sheets}
            failed={activeRun.failed_sheets}
          />
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
                      {new Date(run.created_at).toLocaleString()} · {statusLabel(run.status)} · {run.total_sheets} sheets
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <p className="text-sm text-muted-foreground">
              {activeRun.jurisdiction_label} · {activeRun.code_context}
            </p>
          </div>

          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div className="space-y-4">
              {dataset && dataset.jobs.length > 0 && selectedJob ? (
                <>
                  <SheetNavigator
                    groups={jobsByDiscipline}
                    activeDiscipline={activeDiscipline}
                    onDiscipline={selectDiscipline}
                    selectedJobId={selectedJob.id}
                    onSelectJob={setSelectedJobId}
                  />
                  <SheetFindings
                    job={selectedJob}
                    findings={selectedFindings}
                    onRetry={(jobId) => void retryFailed([jobId])}
                  />
                </>
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
                variant="outlineGold"
                className="w-full justify-start"
                onClick={() => dataset && exportSupabaseAnalyzerReport(dataset, selectedProject?.name)}
                disabled={!dataset || dataset.run.completed_sheets === 0}
              >
                <Download className="mr-2 h-4 w-4" />
                Download report
              </Button>
            </AnalyzerSideActions>
          </div>
        </motion.div>
      ) : null}
    </div>
  );
}
