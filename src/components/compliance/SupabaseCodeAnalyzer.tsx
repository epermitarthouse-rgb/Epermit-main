import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Download,
  Loader2,
  Play,
  RefreshCw,
  RotateCcw,
  Upload,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { useProjects } from "@/hooks/useProjects";
import { useResolvedProjectId } from "@/hooks/useResolvedProjectId";
import {
  cancelSupabaseAnalyzerRun,
  createSupabaseAnalyzerRun,
  fetchSupabaseAnalyzerDataset,
  fetchSupabaseAnalyzerRuns,
  finalizeSupabaseAnalyzerRun,
  isActiveSupabaseAnalyzerRun,
  retrySupabaseAnalyzerJobs,
  SUPABASE_ANALYZER_MAX_FILE_BYTES,
  SUPABASE_ANALYZER_MAX_SHEETS,
  SUPABASE_ANALYZER_MAX_TOTAL_BYTES,
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
import { cn } from "@/lib/utils";

const ACTIVE_STATUSES = new Set(["uploading", "queued", "processing"]);

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    upload_pending: "Awaiting upload",
    uploading: "Uploading drawings",
    queued: "Queued",
    processing: "In review",
    completed: "Complete",
    completed_with_errors: "Complete with sheet errors",
    failed: "Needs attention",
    cancelled: "Cancelled",
  };
  return labels[status] || status.replace(/_/g, " ");
}

function statusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  if (status === "completed") return "default";
  if (status === "failed" || status === "completed_with_errors") return "destructive";
  if (status === "processing" || status === "queued") return "secondary";
  return "outline";
}

function findingTone(severity: string) {
  if (severity === "critical") return "border-red-200 bg-red-50/50 dark:border-red-900 dark:bg-red-950/20";
  if (severity === "warning") return "border-amber-200 bg-amber-50/50 dark:border-amber-900 dark:bg-amber-950/20";
  return "border-blue-200 bg-blue-50/50 dark:border-blue-900 dark:bg-blue-950/20";
}

function bytesLabel(bytes: number) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.ceil(bytes / 1024)} KB`;
}

function sheetErrorMessage(errorCode: string | null) {
  if (errorCode === "drawing_download_failed") {
    return "The drawing file could not be opened. Retry this sheet or upload it again.";
  }
  if (errorCode === "budget_limit_reached") {
    return "This analysis reached its processing limit. Contact support before retrying.";
  }
  if (errorCode === "run_cancelled") {
    return "This sheet was not completed because the analysis was cancelled.";
  }
  if (errorCode?.startsWith("openai_")) {
    return "The analysis service was temporarily unavailable. Retry this sheet.";
  }
  return "This sheet could not be completed. Retry the sheet or contact support.";
}

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
  const [uploadProgress, setUploadProgress] = useState<{
    completed: number;
    total: number;
    fileName: string;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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

  const chooseFiles = (incoming: FileList | null) => {
    if (!incoming) return;
    const next = Array.from(incoming);
    const invalid = next.find((file) =>
      file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")
    );
    if (invalid) {
      toast.error(`${invalid.name}: only individual PDF sheets are accepted`);
      return;
    }
    const oversized = next.find((file) => file.size > SUPABASE_ANALYZER_MAX_FILE_BYTES);
    if (oversized) {
      toast.error(`${oversized.name}: each sheet must be 15 MB or smaller`);
      return;
    }
    if (next.length > SUPABASE_ANALYZER_MAX_SHEETS) {
      toast.error(`Select no more than ${SUPABASE_ANALYZER_MAX_SHEETS} sheets`);
      return;
    }
    const bytes = next.reduce((sum, file) => sum + file.size, 0);
    if (bytes > SUPABASE_ANALYZER_MAX_TOTAL_BYTES) {
      toast.error("The selected drawing set exceeds 250 MB");
      return;
    }
    const keys = new Set<string>();
    const duplicate = next.find((file) => {
      const key = `${file.name.toLowerCase()}:${file.size}`;
      if (keys.has(key)) return true;
      keys.add(key);
      return false;
    });
    if (duplicate) {
      toast.error(`${duplicate.name}: duplicate sheet selected`);
      return;
    }
    setFiles(next);
  };

  const startAnalysis = async () => {
    if (!projectId) {
      toast.error("Select a project before starting an analysis");
      return;
    }
    if (files.length === 0) {
      toast.error("Select at least one drawing sheet");
      return;
    }
    setSubmitting(true);
    setUploadProgress({ completed: 0, total: files.length, fileName: files[0].name });
    try {
      const created = await createSupabaseAnalyzerRun({
        projectId,
        files,
        jurisdictionKey: jurisdictionKeyFor(jurisdiction),
        jurisdictionLabel: jurisdiction,
        projectType,
        codeEdition: codeYear,
        codeContext: codeContextForAnalyzer(jurisdiction, codeYear),
      });
      setSelectedRunId(created.runId);
      const uploaded = await uploadSupabaseAnalyzerFiles(
        files,
        created.uploads,
        (completed, total, fileName) => setUploadProgress({ completed, total, fileName }),
      );
      const finalized = await finalizeSupabaseAnalyzerRun(projectId, created.runId);
      await loadRuns(projectId);
      await loadDataset(created.runId);
      setFiles([]);
      if (uploaded.failures.length || finalized.missing.length) {
        toast.warning(
          `${finalized.queued} sheets queued; ${finalized.missing.length} uploads need attention.`,
        );
      } else {
        toast.success(`${finalized.queued} drawing sheets queued for analysis`);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not start analysis");
    } finally {
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

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>New analysis</CardTitle>
          <CardDescription>
            Upload up to 100 individual permit drawing PDFs. Processing continues after you leave this page.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <div className="space-y-2">
              <Label>Project</Label>
              <select
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={projectId || ""}
                onChange={(event) => setSelectedProjectId(event.target.value || null)}
              >
                <option value="">Select project</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>{project.name}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label>Jurisdiction</Label>
              <select
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={jurisdiction}
                onChange={(event) => {
                  const value = event.target.value;
                  setJurisdiction(value);
                  setCodeYear(defaultCodeYearForAnalyzer(value));
                }}
              >
                {analyzerJurisdictionGroups.map((group) => (
                  <optgroup key={group.label} label={group.label}>
                    {group.items.map((item) => <option key={item}>{item}</option>)}
                  </optgroup>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label>Project type</Label>
              <select
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={projectType}
                onChange={(event) => setProjectType(event.target.value)}
              >
                {analyzerProjectTypeGroups.map((group) => (
                  <optgroup key={group.label} label={group.label}>
                    {group.items.map((item) => <option key={item}>{item}</option>)}
                  </optgroup>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label>Code year</Label>
              <select
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={codeYear}
                onChange={(event) => setCodeYear(event.target.value)}
              >
                {analyzerCodeYears.map((year) => <option key={year}>{year}</option>)}
              </select>
            </div>
          </div>
          <p className="text-sm text-muted-foreground">
            Code context: {codeContextForAnalyzer(jurisdiction, codeYear)}
          </p>

          <div className="rounded-lg border border-dashed p-6 text-center">
            <Input
              ref={fileInputRef}
              type="file"
              accept="application/pdf,.pdf"
              multiple
              className="hidden"
              onChange={(event) => chooseFiles(event.target.files)}
            />
            <Upload className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
            <p className="font-medium">Select individual PDF drawing sheets</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Up to 100 sheets, 15 MB each, 250 MB total
            </p>
            <Button
              type="button"
              variant="outline"
              className="mt-4"
              disabled={submitting}
              onClick={() => fileInputRef.current?.click()}
            >
              Choose drawings
            </Button>
          </div>

          {files.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-muted/40 p-4">
              <div>
                <p className="font-medium">{files.length} sheets selected</p>
                <p className="text-sm text-muted-foreground">{bytesLabel(totalBytes)}</p>
              </div>
              <div className="flex gap-2">
                <Button variant="ghost" onClick={() => setFiles([])} disabled={submitting}>
                  <X className="mr-2 h-4 w-4" /> Clear
                </Button>
                <Button onClick={startAnalysis} disabled={submitting || !projectId}>
                  {submitting
                    ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    : <Play className="mr-2 h-4 w-4" />}
                  Start analysis
                </Button>
              </div>
            </div>
          )}

          {uploadProgress && (
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="truncate">Uploading {uploadProgress.fileName}</span>
                <span>{uploadProgress.completed} / {uploadProgress.total}</span>
              </div>
              <Progress value={(uploadProgress.completed / Math.max(1, uploadProgress.total)) * 100} />
            </div>
          )}
        </CardContent>
      </Card>

      {runs.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle>Analysis History</CardTitle>
                <CardDescription>Saved results remain available by project.</CardDescription>
              </div>
              <select
                className="h-10 max-w-full rounded-md border border-input bg-background px-3 text-sm"
                value={selectedRunId || ""}
                onChange={(event) => setSelectedRunId(event.target.value)}
              >
                {runs.map((run) => (
                  <option key={run.id} value={run.id}>
                    {new Date(run.created_at).toLocaleString()} · {statusLabel(run.status)} · {run.total_sheets} sheets
                  </option>
                ))}
              </select>
            </div>
          </CardHeader>
          {activeRun && (
            <CardContent className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                {[
                  ["Total", activeRun.total_sheets],
                  ["Queued", activeRun.queued_sheets],
                  ["In review", activeRun.processing_sheets],
                  ["Complete", activeRun.completed_sheets],
                  ["Needs attention", activeRun.failed_sheets],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-lg border p-3">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
                    <p className="mt-1 text-2xl font-semibold">{value}</p>
                  </div>
                ))}
              </div>
              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <div className="flex items-center gap-2">
                    <Badge variant={statusVariant(activeRun.status)}>{statusLabel(activeRun.status)}</Badge>
                    <span>{progress}%</span>
                  </div>
                  <span className="text-muted-foreground">
                    {activeRun.jurisdiction_label} · {activeRun.code_context}
                  </span>
                </div>
                <Progress value={progress} />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  onClick={() => selectedRunId && void loadDataset(selectedRunId)}
                  disabled={loading}
                >
                  <RefreshCw className={cn("mr-2 h-4 w-4", loading && "animate-spin")} />
                  Refresh
                </Button>
                {activeRun.failed_sheets > 0 && (
                  <Button variant="outline" onClick={() => void retryFailed()}>
                    <RotateCcw className="mr-2 h-4 w-4" /> Retry failed sheets
                  </Button>
                )}
                {dataset && dataset.run.completed_sheets > 0 && (
                  <Button
                    variant="outline"
                    onClick={() => exportSupabaseAnalyzerReport(dataset, selectedProject?.name)}
                  >
                    <Download className="mr-2 h-4 w-4" /> Download report
                  </Button>
                )}
                {ACTIVE_STATUSES.has(activeRun.status) && (
                  <Button variant="ghost" onClick={() => void cancelRun()}>Cancel run</Button>
                )}
              </div>
            </CardContent>
          )}
        </Card>
      )}

      {loading && !dataset && (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading analysis
        </div>
      )}

      {dataset && jobsByDiscipline.map(([discipline, jobs]) => (
        <Card key={discipline}>
          <CardHeader>
            <CardTitle>{discipline}</CardTitle>
            <CardDescription>{jobs.length} drawing sheet{jobs.length === 1 ? "" : "s"}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {jobs.map((job) => {
              const findings = findingsByJob.get(job.id) || [];
              return (
                <div key={job.id} className="rounded-lg border">
                  <div className="flex flex-wrap items-start justify-between gap-3 border-b p-4">
                    <div>
                      <p className="font-semibold">
                        {job.detected_sheet_number || `Sheet ${job.ordinal}`}
                        {job.detected_sheet_title ? ` — ${job.detected_sheet_title}` : ""}
                      </p>
                      <p className="text-sm text-muted-foreground">{job.original_file_name}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={statusVariant(job.status)}>{statusLabel(job.status)}</Badge>
                      {job.status === "failed" && (
                        <Button size="sm" variant="outline" onClick={() => void retryFailed([job.id])}>
                          <RotateCcw className="mr-1 h-3.5 w-3.5" /> Retry
                        </Button>
                      )}
                    </div>
                  </div>
                  <div className="space-y-3 p-4">
                    {job.status === "processing" && (
                      <div className="flex items-center text-sm text-muted-foreground">
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Reviewing drawing content
                      </div>
                    )}
                    {job.status === "failed" && (
                      <Alert variant="destructive">
                        <AlertCircle className="h-4 w-4" />
                        <AlertDescription>{sheetErrorMessage(job.error_code)}</AlertDescription>
                      </Alert>
                    )}
                    {job.status === "completed" && (
                      <div className="flex items-center text-sm text-muted-foreground">
                        <CheckCircle2 className="mr-2 h-4 w-4 text-emerald-600" />
                        {job.analysis_summary || "Drawing review completed."}
                      </div>
                    )}
                    {job.status === "completed" && findings.length === 0 && (
                      <p className="text-sm text-muted-foreground">
                        No supported review observations were returned for this sheet.
                      </p>
                    )}
                    {findings.map((finding) => (
                      <div key={finding.id} className={cn("rounded-lg border p-4", findingTone(finding.severity))}>
                        <div className="mb-2 flex flex-wrap items-center gap-2">
                          <Badge variant="outline">{finding.severity}</Badge>
                          <Badge variant="secondary">{finding.category}</Badge>
                          <h4 className="font-semibold">{finding.title}</h4>
                        </div>
                        <div className="grid gap-3 text-sm lg:grid-cols-2">
                          <div>
                            <p className="font-medium">Observation</p>
                            <p className="mt-1 text-muted-foreground">{finding.observation}</p>
                          </div>
                          <div>
                            <p className="font-medium">Drawing evidence</p>
                            <p className="mt-1 text-muted-foreground">{finding.drawing_evidence}</p>
                            {finding.drawing_location && (
                              <p className="mt-1 text-muted-foreground">Location: {finding.drawing_location}</p>
                            )}
                          </div>
                          <div>
                            <p className="font-medium">Code Reference</p>
                            <p className="mt-1 text-muted-foreground">
                              {finding.suggested_code_reference || "Not specified"}
                            </p>
                          </div>
                          <div>
                            <p className="font-medium">Recommended action</p>
                            <p className="mt-1 text-muted-foreground">{finding.recommendation}</p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
