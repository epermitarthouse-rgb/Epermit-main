import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { isCodeAnalyzerAsyncV2Enabled } from "@/lib/codeAnalyzer/featureFlags";
import {
  cancelIngestionJob,
  isTerminalIngestionStatus,
  type CodeAnalyzerIngestionJob,
} from "@/lib/codeAnalyzer/ingestion";
import { fetchDocumentIngestionJobs, fetchProjectDocumentsWithAnalyzerMeta } from "@/lib/codeAnalyzer/classification";
import { cancelAsyncRun, fetchSheetJobsForRun, retryFailedSheetJobs } from "@/lib/codeAnalyzer/asyncRun";
import type { CodeAnalyzerRun } from "@/lib/codeAnalyzer/model";
import {
  fetchCodeModJobsForRun,
  retryFailedCodeModJobs,
  type CodeModJobSummary,
} from "@/lib/codeModification/runReviewAsyncV2";

interface Props {
  projectId: string;
  userId: string;
  activeRun?: CodeAnalyzerRun | null;
  isModificationMode?: boolean;
  onRefresh?: () => void;
}

export function CodeAnalyzerV2StatusPanel({
  projectId,
  userId,
  activeRun,
  isModificationMode = false,
  onRefresh,
}: Props) {
  const [jobs, setJobs] = useState<CodeAnalyzerIngestionJob[]>([]);
  const [documents, setDocuments] = useState<
    Array<{
      id: string;
      file_name: string;
      analyzer_class: string | null;
      analyzer_processing_status: string;
    }>
  >([]);
  const [sheetJobs, setSheetJobs] = useState<
    Array<{ id: string; status: string; last_error: string | null; job_type?: string }>
  >([]);
  const [codeModJobs, setCodeModJobs] = useState<CodeModJobSummary[]>([]);

  const enabled = isCodeAnalyzerAsyncV2Enabled();

  useEffect(() => {
    if (!enabled || !projectId) return;
    void (async () => {
      const [ingestionJobs, docs] = await Promise.all([
        fetchDocumentIngestionJobs(projectId),
        fetchProjectDocumentsWithAnalyzerMeta(projectId),
      ]);
      setJobs(ingestionJobs as CodeAnalyzerIngestionJob[]);
      setDocuments(docs);
    })();
  }, [enabled, projectId, activeRun?.id]);

  useEffect(() => {
    if (!enabled || !activeRun?.id) return;

    const refreshJobs = () => {
      if (isModificationMode) {
        void fetchCodeModJobsForRun(activeRun.id).then(setCodeModJobs);
      } else {
        void fetchSheetJobsForRun(activeRun.id).then(setSheetJobs);
      }
    };

    refreshJobs();
    const timer = setInterval(refreshJobs, 5000);
    return () => clearInterval(timer);
  }, [enabled, activeRun?.id, isModificationMode]);

  if (!enabled) return null;

  const activeJobs = isModificationMode ? codeModJobs : sheetJobs;
  const failedCount = activeJobs.filter((j) => j.status === "failed").length;
  const completedCount = activeJobs.filter((j) => j.status === "completed").length;
  const totalJobs = activeJobs.length;
  const runLabel = isModificationMode ? "Code modification review" : "Sheet analysis";

  const formJob = codeModJobs.find((j) => j.job_type === "form_extraction");
  const evidenceJobs = codeModJobs.filter((j) => j.job_type === "evidence_sheet");
  const mergeJob = codeModJobs.find((j) => j.job_type === "merge_findings");

  return (
    <Card className="border-dashed">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Async V2 Processing</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {documents.map((doc) => {
          const job = jobs.find((j) => j.document_id === doc.id && !isTerminalIngestionStatus(j.status));
          const progress =
            job?.total_pages && job.total_pages > 0
              ? Math.round(((job.processed_pages ?? 0) / job.total_pages) * 100)
              : job?.status === "completed"
                ? 100
                : 0;

          return (
            <div key={doc.id} className="rounded-md border p-3 space-y-1">
              <div className="font-medium">{doc.file_name}</div>
              {job?.total_pages != null && (
                <div className="text-muted-foreground">{job.total_pages} pages detected</div>
              )}
              <div className="flex flex-wrap gap-2 items-center">
                <Badge variant="outline">Classification: {doc.analyzer_class ?? "pending"}</Badge>
                <Badge variant="secondary">Status: {doc.analyzer_processing_status}</Badge>
              </div>
              {job && !isTerminalIngestionStatus(job.status) && (
                <>
                  <Progress value={progress} className="h-2" />
                  <div className="text-muted-foreground capitalize">{job.progress_phase}</div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void cancelIngestionJob(job.id, userId).then(onRefresh)}
                  >
                    Cancel ingestion
                  </Button>
                </>
              )}
            </div>
          );
        })}

        {activeRun && totalJobs > 0 && (
          <div className="rounded-md border p-3 space-y-2">
            <div className="font-medium">{runLabel}</div>
            {isModificationMode ? (
              <div className="space-y-1 text-muted-foreground">
                {formJob && (
                  <div>
                    Form extraction: <span className="capitalize">{formJob.status}</span>
                    {formJob.last_error && ` — ${formJob.last_error}`}
                  </div>
                )}
                <div>
                  Evidence sheets: {evidenceJobs.filter((j) => j.status === "completed").length} of{" "}
                  {evidenceJobs.length} complete
                </div>
                {mergeJob && (
                  <div>
                    Merge findings: <span className="capitalize">{mergeJob.status}</span>
                  </div>
                )}
              </div>
            ) : (
              <div>
                {completedCount} of {totalJobs} complete
                {failedCount > 0 && ` · ${failedCount} failed`}
              </div>
            )}
            <Badge variant="outline">Run: {activeRun.status}</Badge>
            {failedCount > 0 && (
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  void (isModificationMode
                    ? retryFailedCodeModJobs(activeRun.id, userId)
                    : retryFailedSheetJobs(activeRun.id, userId)
                  ).then(onRefresh)
                }
              >
                Retry failed
              </Button>
            )}
            {["running", "queued", "partial"].includes(activeRun.status) && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => void cancelAsyncRun(activeRun.id, userId).then(onRefresh)}
              >
                Cancel run
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
