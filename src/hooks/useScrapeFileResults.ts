import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import {
  type ScrapeFileResult,
  type ScrapeFileResultStatus,
} from "@/lib/scrapeFileResultTypes";
import { isScrapeJobTerminal } from "@/lib/scrapeJobTypes";

const POLL_INTERVAL_MS = 8000;

export interface LiveScrapeFileStats {
  total: number;
  uploaded: number;
  failed: number;
  inProgress: number;
}

export interface UseScrapeFileResultsResult {
  rows: ScrapeFileResult[];
  loading: boolean;
  error: string | null;
  active: boolean;
  stats: LiveScrapeFileStats;
  reconnecting: boolean;
  refetch: () => Promise<void>;
}

function isInProgressStatus(status: ScrapeFileResultStatus): boolean {
  return (
    status === "discovered" ||
    status === "downloading" ||
    status === "retrying"
  );
}

export function useScrapeFileResults(
  scrapeJobId: string | null | undefined,
  projectId: string | null | undefined,
  jobTerminal: boolean,
): UseScrapeFileResultsResult {
  const [rows, setRows] = useState<ScrapeFileResult[]>([]);
  const [loading, setLoading] = useState(Boolean(scrapeJobId));
  const [error, setError] = useState<string | null>(null);
  const [reconnecting, setReconnecting] = useState(false);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const failuresRef = useRef(0);

  const fetchRows = useCallback(async () => {
    if (!scrapeJobId || !projectId) {
      setRows([]);
      return;
    }
    const { data, error: fetchError } = await supabase
      .from("scrape_file_results")
      .select("*")
      .eq("scrape_job_id", scrapeJobId)
      .eq("project_id", projectId)
      .order("folder_name", { ascending: true })
      .order("file_name", { ascending: true });
    if (fetchError) throw fetchError;
    setRows((data as ScrapeFileResult[]) || []);
    setError(null);
    failuresRef.current = 0;
  }, [scrapeJobId, projectId]);

  const refetch = useCallback(async () => {
    if (!scrapeJobId || !projectId) return;
    try {
      await fetchRows();
    } catch (err) {
      failuresRef.current += 1;
      setError(err instanceof Error ? err.message : "Failed to load file progress");
    }
  }, [fetchRows, scrapeJobId, projectId]);

  useEffect(() => {
    if (!scrapeJobId || !projectId || jobTerminal) {
      setLoading(false);
      if (jobTerminal) return;
      setRows([]);
      return;
    }

    let cancelled = false;
    setLoading(true);
    fetchRows()
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load file progress");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    const channel = supabase
      .channel(`scrape-file-results-${scrapeJobId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "scrape_file_results",
          filter: `scrape_job_id=eq.${scrapeJobId}`,
        },
        () => {
          void refetch();
        },
      )
      .subscribe((status) => {
        setReconnecting(status === "CHANNEL_ERROR" || status === "TIMED_OUT");
      });

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [scrapeJobId, projectId, jobTerminal, fetchRows, refetch]);

  useEffect(() => {
    if (!scrapeJobId || !projectId || jobTerminal) {
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
      return;
    }

    const schedule = () => {
      pollTimerRef.current = setTimeout(async () => {
        await refetch();
        schedule();
      }, POLL_INTERVAL_MS + failuresRef.current * 2000);
    };
    schedule();
    return () => {
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    };
  }, [scrapeJobId, projectId, jobTerminal, refetch]);

  const stats = useMemo<LiveScrapeFileStats>(() => {
    let uploaded = 0;
    let failed = 0;
    let inProgress = 0;
    for (const row of rows) {
      if (row.status === "uploaded" || row.status === "skipped") uploaded += 1;
      else if (row.status === "failed") failed += 1;
      else if (isInProgressStatus(row.status)) inProgress += 1;
    }
    const progressTotal = rows.find((r) => r.progress_total != null)?.progress_total;
    return {
      total: progressTotal ?? rows.length,
      uploaded,
      failed,
      inProgress,
    };
  }, [rows]);

  const active = Boolean(
    scrapeJobId && projectId && !jobTerminal && rows.length > 0,
  );

  return {
    rows,
    loading,
    error,
    active,
    stats,
    reconnecting,
    refetch,
  };
}

export function isLiveScrapeJobActive(
  jobId: string | null | undefined,
  jobStatus: string | null | undefined,
): boolean {
  if (!jobId) return false;
  if (!jobStatus) return true;
  return !isScrapeJobTerminal(jobStatus);
}
