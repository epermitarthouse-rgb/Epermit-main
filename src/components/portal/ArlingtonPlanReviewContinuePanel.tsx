import { useCallback, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, Download } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import {
  useScrapeOptional,
  getPersistedScrapeSessionForProject,
  getPersistedAccelaSessionForProject,
} from "@/contexts/ScrapeContext";
import {
  continueAccelaPlanReviewDownloads,
  CLIENT_MISSING_ACCELA_SESSION_MSG,
  shouldClearAccelaBrowserSessionOnError,
  type ArlingtonPlanReviewContinueResponse,
  type ArlingtonPlanReviewContinueScope,
} from "@/lib/arlingtonPlanReviewContinueApi";

const PENDING_DOWNLOAD_STATUSES = new Set([
  "pending_not_attempted",
  "pending_stream_timeout",
  "pending_token_missing",
  "pending_tab_not_resolved",
  "pending_timeout_resume",
  "pending_session_closed",
]);

type PlanReviewDocRow = {
  downloadStatus?: string;
  status?: string;
  storagePath?: string;
  publicUrl?: string;
  downloadUrl?: string;
  documentId?: string;
  action?: { documentId?: string };
};

type PlanReviewTabShape = {
  partialPendingDownloads?: boolean;
  jurisdiction?: string;
  used?: boolean;
};

type NormTabs = {
  plansAndDocuments?: {
    sections?: { planSetDocuments?: { documents?: PlanReviewDocRow[] } };
  };
  reviewResultsAndMarkups?: { documents?: PlanReviewDocRow[] };
  approvedDocuments?: { documents?: PlanReviewDocRow[] };
};

function docHasStoredFile(doc: PlanReviewDocRow): boolean {
  for (const u of [doc.publicUrl, doc.downloadUrl]) {
    if (/^https?:\/\//i.test(`${u ?? ""}`.trim())) return true;
  }
  return !!`${doc.storagePath ?? ""}`.trim();
}

export function docIsPendingPlanReviewDownload(doc: PlanReviewDocRow): boolean {
  const ds = `${doc.downloadStatus ?? ""}`.trim();
  if (PENDING_DOWNLOAD_STATUSES.has(ds)) return true;
  if (
    ds === "uploaded" ||
    ds === "already_downloaded" ||
    ds === "duplicate_skipped" ||
    ds === "failed_non_retryable"
  ) {
    return false;
  }
  if (docHasStoredFile(doc)) return false;
  const docId = `${doc.documentId ?? doc.action?.documentId ?? ""}`.trim();
  if (!docId) return false;
  if (ds === "metadata_only") return false;
  return true;
}

function collectPlanReviewDocs(normTabs: NormTabs | null): PlanReviewDocRow[] {
  if (!normTabs) return [];
  const out: PlanReviewDocRow[] = [];
  const ps = normTabs.plansAndDocuments?.sections?.planSetDocuments?.documents;
  if (Array.isArray(ps)) out.push(...ps);
  const rr = normTabs.reviewResultsAndMarkups?.documents;
  if (Array.isArray(rr)) out.push(...rr);
  const ad = normTabs.approvedDocuments?.documents;
  if (Array.isArray(ad)) out.push(...ad);
  return out;
}

export function arlingtonPlanReviewHasPendingDownloads(
  planReviewTab: PlanReviewTabShape | undefined,
  normTabs: NormTabs | null,
): boolean {
  if (planReviewTab?.partialPendingDownloads === true) return true;
  return collectPlanReviewDocs(normTabs).some(docIsPendingPlanReviewDownload);
}

function isPartialContinueStatus(status: string): boolean {
  return (
    status === "partial_success_plan_review_pending" ||
    status === "partial_success_no_downloads"
  );
}

function formatPendingByReason(
  pendingByReason: Record<string, number> | undefined,
): string {
  if (!pendingByReason || typeof pendingByReason !== "object") return "";
  const parts = Object.entries(pendingByReason)
    .filter(([, n]) => Number(n) > 0)
    .map(([k, n]) => `${k}: ${n}`);
  return parts.join(", ");
}

type Props = {
  projectId: string | null | undefined;
  permitNumber: string | null | undefined;
  userId?: string | null;
  planReviewTab: PlanReviewTabShape | undefined;
  normTabs: NormTabs | null;
  onRefresh?: () => void | Promise<void>;
};

export function ArlingtonPlanReviewContinuePanel({
  projectId,
  permitNumber,
  userId: userIdProp,
  planReviewTab,
  normTabs,
  onRefresh,
}: Props) {
  const { user } = useAuth();
  const scrape = useScrapeOptional();
  const [loading, setLoading] = useState(false);
  const [lastResult, setLastResult] =
    useState<ArlingtonPlanReviewContinueResponse | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);

  const userId = `${userIdProp || user?.id || ""}`.trim();
  const permit = `${permitNumber || ""}`.trim();
  const projId = `${projectId || ""}`.trim();

  const showPanel = useMemo(
    () => arlingtonPlanReviewHasPendingDownloads(planReviewTab, normTabs),
    [planReviewTab, normTabs],
  );

  const resolveSessionId = useCallback((): string | null => {
    const fromState = `${scrape?.accelaSessionId || ""}`.trim();
    if (fromState) return fromState;
    if (projId) {
      const accelaPersisted = getPersistedAccelaSessionForProject(projId);
      if (accelaPersisted?.sessionId) return accelaPersisted.sessionId;
    }
    const legacyActive = `${scrape?.activeSessionId || ""}`.trim();
    if (legacyActive) return legacyActive;
    if (projId) {
      const legacyScrape = getPersistedScrapeSessionForProject(projId);
      if (legacyScrape?.sessionId) return legacyScrape.sessionId;
    }
    return null;
  }, [scrape?.accelaSessionId, scrape?.activeSessionId, projId]);

  const runContinue = useCallback(
    async (scope: ArlingtonPlanReviewContinueScope) => {
      if (import.meta.env.DEV) {
        console.log("[PlanReviewContinue] clicked", { scope });
      }

      setLastError(null);
      if (!userId) {
        const msg = "User ID missing. Refresh the page and try again.";
        setLastError(msg);
        toast.error(msg);
        return;
      }
      if (!projId || !permit) {
        const msg = "Project and permit number are required.";
        setLastError(msg);
        toast.error(msg);
        return;
      }
      const sessionId = resolveSessionId();

      if (import.meta.env.DEV) {
        console.log("[PlanReviewContinue] resolved inputs", {
          hasSessionId: !!sessionId,
          sessionIdPrefix: sessionId ? `${sessionId.slice(0, 10)}...` : "",
          hasProjectId: !!projId,
          hasUserId: !!userId,
          hasPermitNumber: !!permit,
          scope,
        });
      }

      if (!sessionId) {
        const msg = CLIENT_MISSING_ACCELA_SESSION_MSG;
        setLastError(msg);
        toast.error(msg);
        return;
      }

      setLoading(true);
      setLastResult(null);
      try {
        if (import.meta.env.DEV) {
          console.log(
            "[PlanReviewContinue] posting to /api/accela/plan-review/continue-downloads",
          );
        }
        const result = await continueAccelaPlanReviewDownloads({
          sessionId,
          projectId: projId,
          userId,
          permitNumber: permit,
          scope,
        });
        setLastResult(result);
        if (isPartialContinueStatus(result.status)) {
          toast.info("Downloads checkpointed. More files remain.");
        } else if (result.status === "complete") {
          toast.success("Plan Review downloads complete for this scope.");
        } else {
          toast.success(
            `Continue finished (${result.status || "ok"}). Downloaded ${result.downloadedThisRun ?? 0} this run.`,
          );
        }
        await onRefresh?.();
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : "Continue downloads failed";
        setLastError(msg);
        toast.error(msg);
        if (shouldClearAccelaBrowserSessionOnError(msg)) {
          scrape?.clearAccelaBrowserSession();
        }
      } finally {
        setLoading(false);
      }
    },
    [
      userId,
      projId,
      permit,
      resolveSessionId,
      onRefresh,
      scrape?.clearAccelaBrowserSession,
    ],
  );

  if (!showPanel) return null;

  const pendingSummary = formatPendingByReason(lastResult?.pendingByReason);

  return (
    <div
      className="rounded-md border border-border bg-muted/20 p-3 space-y-3"
      data-testid="arlington-plan-review-continue-panel"
    >
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-foreground">
            Pending Plan Review downloads
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Resume file downloads from saved metadata without a full re-scrape.
          </p>
        </div>
        <Button
          size="sm"
          disabled={loading}
          onClick={() => runContinue("allPending")}
          className="shrink-0"
          data-testid="button-continue-plan-review-downloads"
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
          ) : (
            <Download className="h-4 w-4 mr-2" />
          )}
          {loading
            ? "Continuing Plan Review downloads..."
            : "Continue pending Plan Review downloads"}
        </Button>
      </div>

      {import.meta.env.DEV ? (
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={loading}
            onClick={() => runContinue("secondary")}
            data-testid="button-continue-plan-review-secondary"
          >
            Retry Review Results / Approved Docs
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={loading}
            onClick={() => runContinue("planSet")}
            data-testid="button-continue-plan-review-plan-set"
          >
            Continue Plan Set only
          </Button>
        </div>
      ) : null}

      {lastError ? (
        <p className="text-xs text-destructive" data-testid="plan-review-continue-error">
          {lastError}
        </p>
      ) : null}

      {lastResult ? (
        <div
          className="text-xs text-muted-foreground space-y-1 font-mono"
          data-testid="plan-review-continue-result"
        >
          <p>
            status={lastResult.status} downloadedThisRun=
            {lastResult.downloadedThisRun ?? 0} stoppedReason=
            {lastResult.stoppedReason || "—"} next=
            {lastResult.nextRecommendedScope || "—"}
          </p>
          {pendingSummary ? <p>pendingByReason: {pendingSummary}</p> : null}
          <p>
            Plan Set: {lastResult.planSetDownloaded ?? 0}/
            {lastResult.planSetTotal ?? 0} (pending {lastResult.planSetPending ?? 0})
            {" · "}
            Review Results: {lastResult.reviewResultsDownloaded ?? 0}/
            {lastResult.reviewResultsTotal ?? 0} (pending{" "}
            {lastResult.reviewResultsPending ?? 0}){" · "}
            Approved: {lastResult.approvedDownloaded ?? 0}/
            {lastResult.approvedTotal ?? 0} (pending{" "}
            {lastResult.approvedPending ?? 0})
          </p>
        </div>
      ) : null}
    </div>
  );
}
