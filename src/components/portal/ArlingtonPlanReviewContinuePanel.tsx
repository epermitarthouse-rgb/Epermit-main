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
  resumeAccelaPlanReviewPendingDownloads,
  ARLINGTON_PLAN_REVIEW_LOGIN_REQUIRED_MSG,
  shouldClearAccelaBrowserSessionOnError,
  type ArlingtonPlanReviewContinueResponse,
} from "@/lib/arlingtonPlanReviewContinueApi";
import { filterArlingtonPlanSetDocumentsForUi } from "@/lib/arlingtonPlanSetDocumentsCleanup";

const PENDING_DOWNLOAD_STATUSES = new Set([
  "pending_not_attempted",
  "pending_stream_timeout",
  "pending_token_missing",
  "pending_tab_not_resolved",
  "pending_timeout_resume",
  "pending_session_closed",
  "pending_retry",
  "failed_retry",
]);

type PlanReviewDocRow = {
  downloadStatus?: string;
  status?: string;
  storagePath?: string;
  publicUrl?: string;
  downloadUrl?: string;
  downloaded?: boolean;
  saved?: boolean;
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
  if (doc.downloaded === true || doc.saved === true) return false;

  const statusLo = `${doc.status ?? ""}`.trim().toLowerCase();
  if (statusLo === "downloaded" || statusLo === "saved") return false;
  if (statusLo === "plan_set_delete_only_inactive") return false;

  const ds = `${doc.downloadStatus ?? ""}`.trim();
  if (ds === "uploaded" || ds === "already_downloaded") return false;
  if (ds === "inactive_delete_only") return false;
  if (docHasStoredFile(doc)) return false;

  if (PENDING_DOWNLOAD_STATUSES.has(ds)) return true;
  if (
    ds === "duplicate_skipped" ||
    ds === "failed_non_retryable" ||
    ds === "metadata_only"
  ) {
    return false;
  }

  const docId = `${doc.documentId ?? doc.action?.documentId ?? ""}`.trim();
  if (!docId) return false;
  return true;
}

function collectPlanReviewDocs(normTabs: NormTabs | null): PlanReviewDocRow[] {
  if (!normTabs) return [];
  const out: PlanReviewDocRow[] = [];
  const ps = normTabs.plansAndDocuments?.sections?.planSetDocuments?.documents;
  if (Array.isArray(ps)) {
    out.push(
      ...(filterArlingtonPlanSetDocumentsForUi(
        ps,
      ) as PlanReviewDocRow[]),
    );
  }
  const rr = normTabs.reviewResultsAndMarkups?.documents;
  if (Array.isArray(rr)) out.push(...rr);
  const ad = normTabs.approvedDocuments?.documents;
  if (Array.isArray(ad)) out.push(...ad);
  return out;
}

export function countArlingtonPlanReviewPendingDownloads(
  normTabs: NormTabs | null,
): number {
  return collectPlanReviewDocs(normTabs).filter(docIsPendingPlanReviewDownload)
    .length;
}

export function arlingtonPlanReviewHasPendingDownloads(
  planReviewTab: PlanReviewTabShape | undefined,
  normTabs: NormTabs | null,
): boolean {
  if (planReviewTab?.partialPendingDownloads === true) return true;
  return countArlingtonPlanReviewPendingDownloads(normTabs) > 0;
}

type Props = {
  projectId: string | null | undefined;
  permitNumber: string | null | undefined;
  userId?: string | null;
  credentialId?: string | null;
  planReviewTab: PlanReviewTabShape | undefined;
  normTabs: NormTabs | null;
  onRefresh?: () => void | Promise<void>;
};

export function ArlingtonPlanReviewContinuePanel({
  projectId,
  permitNumber,
  userId: userIdProp,
  credentialId,
  planReviewTab,
  normTabs,
  onRefresh,
}: Props) {
  const { user, session: authSession } = useAuth();
  const scrape = useScrapeOptional();
  const [loading, setLoading] = useState(false);
  const [lastResult, setLastResult] =
    useState<ArlingtonPlanReviewContinueResponse | null>(null);
  const [lastMessage, setLastMessage] = useState<string | null>(null);

  const userId = `${userIdProp || user?.id || ""}`.trim();
  const permit = `${permitNumber || ""}`.trim();
  const projId = `${projectId || ""}`.trim();

  const pendingCount = useMemo(
    () => countArlingtonPlanReviewPendingDownloads(normTabs),
    [normTabs],
  );

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

  const runResume = useCallback(async () => {
    setLastMessage(null);
    if (!userId) {
      const msg = "User ID missing. Refresh the page and try again.";
      setLastMessage(msg);
      toast.error(msg);
      return;
    }
    if (!projId || !permit) {
      const msg = "Project and permit number are required.";
      setLastMessage(msg);
      toast.error(msg);
      return;
    }

    const sessionId = resolveSessionId();
    setLoading(true);
    setLastResult(null);

    try {
      const result = await resumeAccelaPlanReviewPendingDownloads({
        sessionId,
        projectId: projId,
        userId,
        permitNumber: permit,
        credentialId: `${credentialId || ""}`.trim() || undefined,
        accessToken: authSession?.access_token,
      });

      if (result.sessionId) {
        scrape?.setAccelaSessionId(result.sessionId, {
          projectId: projId,
          permitNumber: permit,
        });
      }

      setLastResult(result);

      if (result.loginRequired) {
        const msg =
          result.message?.trim() || ARLINGTON_PLAN_REVIEW_LOGIN_REQUIRED_MSG;
        setLastMessage(msg);
        toast.info(msg);
        return;
      }

      const pendingRemaining =
        (result.planSetPending ?? 0) +
        (result.reviewResultsPending ?? 0) +
        (result.approvedPending ?? 0);

      if (result.status === "complete" || pendingRemaining === 0) {
        toast.success("Plan Review downloads complete.");
      } else if ((result.downloadedThisRun ?? 0) > 0) {
        toast.success(
          `Downloaded ${result.downloadedThisRun} file(s). ${pendingRemaining} still pending.`,
        );
      } else {
        toast.info(`${pendingRemaining} document(s) still pending.`);
      }

      await onRefresh?.();
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Resume downloads failed";
      setLastMessage(msg);
      if (shouldClearAccelaBrowserSessionOnError(msg)) {
        scrape?.clearAccelaBrowserSession(projId);
        toast.info(ARLINGTON_PLAN_REVIEW_LOGIN_REQUIRED_MSG);
      } else {
        toast.error(msg);
      }
    } finally {
      setLoading(false);
    }
  }, [
    userId,
    projId,
    permit,
    credentialId,
    resolveSessionId,
    authSession?.access_token,
    onRefresh,
    scrape,
  ]);

  if (!showPanel) return null;

  const pendingRemainingFromResult = lastResult
    ? (lastResult.planSetPending ?? 0) +
      (lastResult.reviewResultsPending ?? 0) +
      (lastResult.approvedPending ?? 0)
    : null;

  const loginRequiredMessage =
    lastResult?.loginRequired || lastMessage?.includes("Login required")
      ? lastMessage || ARLINGTON_PLAN_REVIEW_LOGIN_REQUIRED_MSG
      : null;

  return (
    <div
      className="rounded-md border border-border bg-muted/20 p-3 space-y-3"
      data-testid="arlington-plan-review-continue-panel"
    >
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div className="space-y-1">
          <p className="text-sm font-medium text-foreground">
            Pending Plan Review downloads
          </p>
          <p className="text-xs text-muted-foreground">
            Some Plan Review documents are not downloaded yet. Resume will only
            fetch missing files and keep already saved files.
          </p>
          {pendingCount > 0 ? (
            <p className="text-xs text-muted-foreground">
              {pendingCount} document{pendingCount === 1 ? "" : "s"} pending
            </p>
          ) : null}
        </div>
        <Button
          size="sm"
          disabled={loading}
          onClick={() => runResume()}
          className="shrink-0"
          data-testid="button-resume-plan-review-downloads"
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
          ) : (
            <Download className="h-4 w-4 mr-2" />
          )}
          {loading ? "Resuming downloads…" : "Resume pending downloads"}
        </Button>
      </div>

      <p className="text-[11px] text-muted-foreground">
        Downloads only missing files. Already saved files will be skipped.
      </p>

      {loginRequiredMessage ? (
        <p
          className="text-xs text-amber-700 dark:text-amber-400"
          data-testid="plan-review-resume-login-required"
        >
          {loginRequiredMessage}
        </p>
      ) : null}

      {lastMessage && !loginRequiredMessage ? (
        <p
          className="text-xs text-destructive"
          data-testid="plan-review-continue-error"
        >
          {lastMessage}
        </p>
      ) : null}

      {lastResult &&
      !lastResult.loginRequired &&
      pendingRemainingFromResult != null &&
      pendingRemainingFromResult > 0 ? (
        <p
          className="text-xs text-muted-foreground"
          data-testid="plan-review-resume-pending-remaining"
        >
          {pendingRemainingFromResult} document
          {pendingRemainingFromResult === 1 ? "" : "s"} still pending
          {(lastResult.downloadedThisRun ?? 0) > 0
            ? ` · ${lastResult.downloadedThisRun} downloaded this run`
            : ""}
        </p>
      ) : null}
    </div>
  );
}
