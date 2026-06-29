import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import {
  isScrapeJobTerminal,
  type ScrapeJob,
} from "@/lib/scrapeJobTypes";
import { readPortalCheckpointVersion } from "@/lib/arlingtonPortalCheckpoint";

const ACTIVE_JOB_POLL_MS = 5000;
const PORTAL_POLL_MS = 5000;

export interface ArlingtonLivePortalCounts {
  attachmentsDownloaded: number;
  attachmentsPending: number;
  planReviewDownloaded: number;
}

function readCheckpointVersion(portalData: Record<string, unknown> | null): number {
  return readPortalCheckpointVersion(portalData);
}

function countArlingtonAttachmentRows(portalData: Record<string, unknown> | null) {
  const tabs = portalData?.tabs as Record<string, unknown> | undefined;
  const att = tabs?.attachments as { tables?: { rows?: unknown[] }[] } | undefined;
  const rows = att?.tables?.[0]?.rows;
  if (!Array.isArray(rows)) {
    return { downloaded: 0, pending: 0, total: 0 };
  }
  let downloaded = 0;
  let pending = 0;
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const viewUrl = `${r.viewUrl || r.publicUrl || ""}`.trim();
    const storagePath = `${r.storagePath || ""}`.trim();
    const ds = `${r.downloadStatus || ""}`.trim();
    const isDownloaded =
      /^https?:\/\//i.test(viewUrl) ||
      storagePath.length > 0 ||
      ds === "uploaded" ||
      ds === "success";
    if (isDownloaded) downloaded += 1;
    else pending += 1;
  }
  return { downloaded, pending, total: rows.length };
}

function countArlingtonPlanReviewDownloaded(
  portalData: Record<string, unknown> | null,
): number {
  const tabs = portalData?.tabs as Record<string, unknown> | undefined;
  const pr = tabs?.planReview as Record<string, unknown> | undefined;
  const prTabs = (pr?.tabs || pr) as Record<string, unknown> | undefined;
  if (!prTabs) return 0;

  const collect = (docs: unknown): number => {
    if (!Array.isArray(docs)) return 0;
    return docs.filter((d) => {
      if (!d || typeof d !== "object") return false;
      const doc = d as Record<string, unknown>;
      const url = `${doc.publicUrl || doc.viewUrl || doc.storagePath || ""}`.trim();
      const ds = `${doc.downloadStatus || ""}`.trim();
      return (
        /^https?:\/\//i.test(url) ||
        url.startsWith("projects/") ||
        ds === "uploaded" ||
        ds === "success"
      );
    }).length;
  };

  const planSet = (
    prTabs.plansAndDocuments as
      | { sections?: { planSetDocuments?: { documents?: unknown } } }
      | undefined
  )?.sections?.planSetDocuments?.documents;
  const review = (prTabs.reviewResultsAndMarkups as { documents?: unknown })
    ?.documents;
  const approved = (prTabs.approvedDocuments as { documents?: unknown })
    ?.documents;

  return collect(planSet) + collect(review) + collect(approved);
}

export interface UseArlingtonLivePortalRefreshOptions {
  enabled?: boolean;
  userId?: string | null;
  scrapeJobId?: string | null;
  isScraping?: boolean;
}

export interface UseArlingtonLivePortalRefreshResult {
  activeJob: ScrapeJob | null;
  checkpointVersion: number;
  visibleCounts: ArlingtonLivePortalCounts;
  latestPortalData: Record<string, unknown> | null;
  refetchPortalData: () => Promise<Record<string, unknown> | null>;
}

/**
 * Keeps Arlington portal_data fresh while a scrape job is active.
 * Polls both scrape_jobs and projects.portal_data (checkpointVersion-aware).
 */
export function useArlingtonLivePortalRefresh(
  projectId: string | null | undefined,
  options: UseArlingtonLivePortalRefreshOptions = {},
): UseArlingtonLivePortalRefreshResult {
  const { enabled = true, userId, scrapeJobId, isScraping = false } = options;
  const [activeJob, setActiveJob] = useState<ScrapeJob | null>(null);
  const [checkpointVersion, setCheckpointVersion] = useState(0);
  const [visibleCounts, setVisibleCounts] = useState<ArlingtonLivePortalCounts>({
    attachmentsDownloaded: 0,
    attachmentsPending: 0,
    planReviewDownloaded: 0,
  });
  const [latestPortalData, setLatestPortalData] = useState<Record<
    string,
    unknown
  > | null>(null);
  const lastVersionRef = useRef(0);
  const lastCountsRef = useRef<ArlingtonLivePortalCounts>({
    attachmentsDownloaded: 0,
    attachmentsPending: 0,
    planReviewDownloaded: 0,
  });

  const fetchActiveJob = useCallback(async () => {
    if (!projectId) return null;
    if (scrapeJobId) {
      const { data } = await supabase
        .from("scrape_jobs")
        .select("*")
        .eq("id", scrapeJobId)
        .maybeSingle();
      return (data as ScrapeJob) || null;
    }
    const { data } = await supabase
      .from("scrape_jobs")
      .select("*")
      .eq("project_id", projectId)
      .in("status", [
        "queued",
        "running",
        "resuming",
        "rate_limited",
        "partial",
        "waiting_user",
      ])
      .order("created_at", { ascending: false })
      .limit(1);
    return (data?.[0] as ScrapeJob) || null;
  }, [projectId, scrapeJobId]);

  const refetchPortalData = useCallback(async () => {
    if (!enabled || !projectId || !userId) return null;
    const { data, error } = await supabase
      .from("projects")
      .select("portal_data")
      .eq("id", projectId)
      .eq("user_id", userId)
      .maybeSingle();
    if (error || !data?.portal_data) return null;

    const pd = data.portal_data as Record<string, unknown>;
    const version = readCheckpointVersion(pd);
    if (version < lastVersionRef.current && lastVersionRef.current > 0) {
      if (import.meta.env.DEV) {
        console.log(
          "[ArlingtonLivePortal] ignored stale portal_data",
          version,
          "<",
          lastVersionRef.current,
        );
      }
      return null;
    }

    const att = countArlingtonAttachmentRows(pd);
    const prDownloaded = countArlingtonPlanReviewDownloaded(pd);
    const nextCounts: ArlingtonLivePortalCounts = {
      attachmentsDownloaded: att.downloaded,
      attachmentsPending: att.pending,
      planReviewDownloaded: prDownloaded,
    };

    const countsChanged =
      nextCounts.attachmentsDownloaded !== lastCountsRef.current.attachmentsDownloaded ||
      nextCounts.attachmentsPending !== lastCountsRef.current.attachmentsPending ||
      nextCounts.planReviewDownloaded !== lastCountsRef.current.planReviewDownloaded;

    if (version !== lastVersionRef.current) {
      lastVersionRef.current = version;
      setCheckpointVersion(version);
      setLatestPortalData(pd);
      if (import.meta.env.DEV) {
        console.log("[ArlingtonLivePortal] checkpoint version changed", version);
      }
    } else if (countsChanged) {
      setLatestPortalData(pd);
    }

    if (countsChanged) {
      lastCountsRef.current = nextCounts;
      setVisibleCounts(nextCounts);
      if (import.meta.env.DEV) {
        console.log(
          "[ArlingtonLivePortal] visible downloaded counts changed",
          nextCounts,
        );
      }
    }

    if (import.meta.env.DEV) {
      console.log("[ArlingtonLivePortal] portal data refetched", {
        checkpointVersion: version,
        counts: nextCounts,
      });
    }

    return pd;
  }, [enabled, projectId, userId]);

  const jobIsLive = useCallback((job: ScrapeJob | null) => {
    if (!job) return false;
    return !isScrapeJobTerminal(job.status);
  }, []);

  useEffect(() => {
    if (!enabled || !projectId) return;

    let cancelled = false;

    const tick = async () => {
      try {
        const job = await fetchActiveJob();
        if (cancelled) return;
        setActiveJob(job);
        const live = jobIsLive(job) || isScraping;
        if (live) {
          if (import.meta.env.DEV && job) {
            console.log("[ArlingtonLivePortal] active job detected", job.id, job.status);
          }
          await refetchPortalData();
        }
      } catch {
        /* ignore transient poll errors */
      }
    };

    void tick();
    const interval = setInterval(tick, ACTIVE_JOB_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [
    enabled,
    projectId,
    fetchActiveJob,
    jobIsLive,
    isScraping,
    refetchPortalData,
  ]);

  useEffect(() => {
    if (!enabled || !projectId || !userId) return;
    const live = jobIsLive(activeJob) || isScraping;
    if (!live) return;
    const interval = setInterval(() => {
      void refetchPortalData();
    }, PORTAL_POLL_MS);
    return () => clearInterval(interval);
  }, [enabled, projectId, userId, activeJob, isScraping, jobIsLive, refetchPortalData]);

  return {
    activeJob,
    checkpointVersion,
    visibleCounts,
    latestPortalData,
    refetchPortalData,
  };
}