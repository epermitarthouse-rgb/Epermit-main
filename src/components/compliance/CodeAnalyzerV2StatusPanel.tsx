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

interface Props {
  projectId: string;
  userId: string;
  activeRun?: CodeAnalyzerRun | null;
  onRefresh?: () => void;
}

export function CodeAnalyzerV2StatusPanel({ projectId, userId, activeRun, onRefresh }: Props) {
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
    Array<{ id: string; status: string; last_error: string | null }>
  >([]);

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
    void fetchSheetJobsForRun(activeRun.id).then(setSheetJobs);
    const timer = setInterval(() => {
      void fetchSheetJobsForRun(activeRun.id).then(setSheetJobs);
    }, 5000);
    return () => clearInterval(timer);
  }, [enabled, activeRun?.id]);

  if (!enabled) return null;

  const failedSheetCount = sheetJobs.filter((j) => j.status === "failed").length;
  const completedSheetCount = sheetJobs.filter((j) => j.status === "completed").length;
  const totalSheetJobs = sheetJobs.length;

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

        {activeRun && totalSheetJobs > 0 && (
          <div className="rounded-md border p-3 space-y-2">
            <div className="font-medium">Sheet analysis</div>
            <div>
              {completedSheetCount} of {totalSheetJobs} complete
              {failedSheetCount > 0 && ` · ${failedSheetCount} failed`}
            </div>
            <Badge variant="outline">Run: {activeRun.status}</Badge>
            {failedSheetCount > 0 && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => void retryFailedSheetJobs(activeRun.id, userId).then(onRefresh)}
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
