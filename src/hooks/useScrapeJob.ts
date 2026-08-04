import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import {
  isScrapeHeartbeatEvent,
  isScrapeJobTerminal,
  type ScrapeEvent,
  type ScrapeJob,
} from "@/lib/scrapeJobTypes";
import { resolveScrapeCurrentMessage } from "@/lib/scrapeJobMessage";
import {
  beginPollRequest,
  bumpPollGeneration,
  canApplyPollResult,
  createPollGenerationGate,
  finishPollRequest,
} from "@/lib/scrapePollRaceGuard";
import { isOwnedScrapeJob } from "@/lib/scrapeJobOwnership";

const POLL_INTERVAL_MS = 8000;
const STALE_ACTIVITY_MS = 2 * 60 * 1000;
const MAX_POLL_BACKOFF_MS = 30000;

function eventDedupeKey(event: ScrapeEvent): string {
  const meta = event.metadata as Record<string, unknown> | undefined;
  const fromMeta = meta?.dedupeKey;
  if (typeof fromMeta === "string" && fromMeta.trim()) return fromMeta.trim();
  return `${event.stage || ""}|${event.user_message}`;
}

function dedupeFeedEvents(events: ScrapeEvent[]): ScrapeEvent[] {
  const seen = new Set<string>();
  const out: ScrapeEvent[] = [];
  for (const event of events) {
    const key = eventDedupeKey(event);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(event);
  }
  return out;
}

function mergeEvents(prev: ScrapeEvent[], incoming: ScrapeEvent[]): ScrapeEvent[] {
  const byId = new Map<string, ScrapeEvent>();
  for (const event of [...prev, ...incoming]) {
    byId.set(event.id, event);
  }
  return [...byId.values()].sort((a, b) => a.sequence - b.sequence);
}

export interface UseScrapeJobOptions {
  /** When false, no fetch / poll / realtime. */
  enabled?: boolean;
  /** Current authenticated user — required for ownership filter after fetch. */
  userId?: string | null;
  tenantId?: string | null;
}

export interface UseScrapeJobResult {
  job: ScrapeJob | null;
  events: ScrapeEvent[];
  meaningfulEvents: ScrapeEvent[];
  currentMessage: string;
  currentStage: string | null;
  progress: { current: number; total: number } | null;
  elapsedTime: number;
  lastActivityAt: string | null;
  isStale: boolean;
  isTerminal: boolean;
  isCancellable: boolean;
  reconnecting: boolean;
  error: string | null;
  loading: boolean;
  ownershipRejected: boolean;
  refetch: () => Promise<void>;
}

export function useScrapeJob(
  jobId: string | null | undefined,
  startedAtMs?: number | null,
  options?: UseScrapeJobOptions,
): UseScrapeJobResult {
  const enabled = options?.enabled !== false && Boolean(jobId);
  const userId = `${options?.userId || ""}`.trim() || null;
  const tenantId = options?.tenantId ?? null;

  const [job, setJob] = useState<ScrapeJob | null>(null);
  const [events, setEvents] = useState<ScrapeEvent[]>([]);
  const [loading, setLoading] = useState(Boolean(enabled));
  const [reconnecting, setReconnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ownershipRejected, setOwnershipRejected] = useState(false);
  const [elapsedTime, setElapsedTime] = useState(0);
  const lastSequenceRef = useRef(0);
  const pollBackoffRef = useRef(POLL_INTERVAL_MS);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollGateRef = useRef(createPollGenerationGate());
  const consecutiveFailuresRef = useRef(0);
  const jobIdRef = useRef(jobId);
  jobIdRef.current = jobId;

  const applyJobIfOwned = useCallback(
    (row: ScrapeJob | null): ScrapeJob | null => {
      if (!row) return null;
      if (userId && !isOwnedScrapeJob(row, { userId, tenantId })) {
        setOwnershipRejected(true);
        return null;
      }
      setOwnershipRejected(false);
      return row;
    },
    [tenantId, userId],
  );

  const fetchJob = useCallback(async () => {
    if (!jobId) return null;
    const { data, error: jobError } = await supabase
      .from("scrape_jobs")
      .select("*")
      .eq("id", jobId)
      .maybeSingle();
    if (jobError) throw jobError;
    return (data as ScrapeJob) || null;
  }, [jobId]);

  const fetchEventsSince = useCallback(
    async (afterSequence: number) => {
      if (!jobId) return [] as ScrapeEvent[];
      let query = supabase
        .from("scrape_events")
        .select("*")
        .eq("job_id", jobId)
        .order("sequence", { ascending: true });
      if (afterSequence > 0) {
        query = query.gt("sequence", afterSequence);
      }
      const { data, error: eventsError } = await query;
      if (eventsError) throw eventsError;
      return (data as ScrapeEvent[]) || [];
    },
    [jobId],
  );

  const refetch = useCallback(async () => {
    if (!enabled || !jobId) return;
    const generation = pollGateRef.current.generation;
    const controller = beginPollRequest(pollGateRef.current, generation);
    if (!controller) return;
    try {
      const [jobRow, eventRows] = await Promise.all([
        fetchJob(),
        fetchEventsSince(0),
      ]);
      if (
        !canApplyPollResult(
          pollGateRef.current,
          generation,
          jobId,
          jobIdRef.current,
        )
      ) {
        return;
      }
      const owned = applyJobIfOwned(jobRow);
      if (owned) setJob(owned);
      else if (jobRow && userId) {
        setJob(null);
        setError("Scrape job is not owned by the current user");
      } else if (jobRow) {
        setJob(jobRow);
      }
      if (eventRows.length > 0) {
        setEvents((prev) => mergeEvents(prev, eventRows));
        lastSequenceRef.current = Math.max(
          lastSequenceRef.current,
          ...eventRows.map((e) => e.sequence),
        );
      }
      setError(null);
      setReconnecting(false);
      consecutiveFailuresRef.current = 0;
      pollBackoffRef.current = POLL_INTERVAL_MS;
    } catch (err: unknown) {
      if (
        !canApplyPollResult(
          pollGateRef.current,
          generation,
          jobId,
          jobIdRef.current,
        )
      ) {
        return;
      }
      setError(err instanceof Error ? err.message : "Failed to load scrape progress");
      setReconnecting(true);
    } finally {
      finishPollRequest(pollGateRef.current, controller);
      if (
        canApplyPollResult(
          pollGateRef.current,
          generation,
          jobId,
          jobIdRef.current,
        )
      ) {
        setLoading(false);
      }
    }
  }, [applyJobIfOwned, enabled, fetchEventsSince, fetchJob, jobId, userId]);

  useEffect(() => {
    if (!enabled || !jobId) {
      bumpPollGeneration(pollGateRef.current);
      setJob(null);
      setEvents([]);
      setLoading(false);
      setOwnershipRejected(false);
      setError(null);
      setReconnecting(false);
      return;
    }
    bumpPollGeneration(pollGateRef.current);
    lastSequenceRef.current = 0;
    setEvents([]);
    setLoading(true);
    setOwnershipRejected(false);
    void refetch();
  }, [enabled, jobId, refetch]);

  const isTerminal = isScrapeJobTerminal(job?.status);

  // Realtime — tear down when terminal or disabled
  useEffect(() => {
    if (!enabled || !jobId || isTerminal) return;

    const expectedJobId = jobId;
    const generationAtSubscribe = pollGateRef.current.generation;

    const jobChannel = supabase
      .channel(`scrape-job-${jobId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "scrape_jobs",
          filter: `id=eq.${jobId}`,
        },
        (payload) => {
          if (
            !canApplyPollResult(
              pollGateRef.current,
              generationAtSubscribe,
              expectedJobId,
              jobIdRef.current,
            )
          ) {
            return;
          }
          const next = applyJobIfOwned(payload.new as ScrapeJob);
          if (next) {
            setJob(next);
            setReconnecting(false);
            consecutiveFailuresRef.current = 0;
          }
        },
      )
      .subscribe((status) => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          setReconnecting(true);
        }
      });

    const eventsChannel = supabase
      .channel(`scrape-events-${jobId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "scrape_events",
          filter: `job_id=eq.${jobId}`,
        },
        (payload) => {
          if (
            !canApplyPollResult(
              pollGateRef.current,
              generationAtSubscribe,
              expectedJobId,
              jobIdRef.current,
            )
          ) {
            return;
          }
          const row = payload.new as ScrapeEvent;
          setEvents((prev) => mergeEvents(prev, [row]));
          lastSequenceRef.current = Math.max(lastSequenceRef.current, row.sequence);
          setReconnecting(false);
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(jobChannel);
      void supabase.removeChannel(eventsChannel);
    };
  }, [applyJobIfOwned, enabled, isTerminal, jobId]);

  // Durable poll — single poller; stop when terminal
  useEffect(() => {
    if (!enabled || !jobId || isTerminal) {
      if (pollTimerRef.current) {
        clearTimeout(pollTimerRef.current);
        pollTimerRef.current = null;
      }
      return;
    }

    const expectedJobId = jobId;
    let cancelled = false;

    const schedulePoll = () => {
      pollTimerRef.current = setTimeout(async () => {
        if (cancelled) return;
        const generation = pollGateRef.current.generation;
        const controller = beginPollRequest(pollGateRef.current, generation);
        if (!controller) {
          if (!cancelled) schedulePoll();
          return;
        }

        let jobRow: ScrapeJob | null = null;
        try {
          const [fetchedJob, newEvents] = await Promise.all([
            fetchJob(),
            fetchEventsSince(lastSequenceRef.current),
          ]);
          if (
            cancelled ||
            !canApplyPollResult(
              pollGateRef.current,
              generation,
              expectedJobId,
              jobIdRef.current,
            )
          ) {
            return;
          }
          jobRow = applyJobIfOwned(fetchedJob);
          if (jobRow) setJob(jobRow);
          else if (fetchedJob && userId) {
            setOwnershipRejected(true);
            setJob(null);
          }
          if (newEvents.length > 0) {
            setEvents((prev) => mergeEvents(prev, newEvents));
            lastSequenceRef.current = Math.max(
              lastSequenceRef.current,
              ...newEvents.map((e) => e.sequence),
            );
          }
          consecutiveFailuresRef.current = 0;
          pollBackoffRef.current = POLL_INTERVAL_MS;
          setReconnecting(false);
        } catch {
          if (
            cancelled ||
            !canApplyPollResult(
              pollGateRef.current,
              generation,
              expectedJobId,
              jobIdRef.current,
            )
          ) {
            return;
          }
          consecutiveFailuresRef.current += 1;
          setReconnecting(true);
          pollBackoffRef.current = Math.min(
            MAX_POLL_BACKOFF_MS,
            POLL_INTERVAL_MS * 2 ** Math.min(consecutiveFailuresRef.current, 3),
          );
        } finally {
          finishPollRequest(pollGateRef.current, controller);
        }

        const terminalNow = isScrapeJobTerminal(jobRow?.status);
        if (!cancelled && !terminalNow) {
          schedulePoll();
        }
      }, pollBackoffRef.current);
    };

    schedulePoll();
    return () => {
      cancelled = true;
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    };
  }, [
    applyJobIfOwned,
    enabled,
    fetchEventsSince,
    fetchJob,
    isTerminal,
    jobId,
    userId,
  ]);

  useEffect(() => {
    const startMs =
      startedAtMs || (job?.started_at ? Date.parse(job.started_at) : Date.now());
    const terminal = isScrapeJobTerminal(job?.status);
    const endMs = terminal
      ? job?.completed_at
        ? Date.parse(job.completed_at)
        : job?.cancelled_at
          ? Date.parse(job.cancelled_at)
          : null
      : null;

    const computeElapsed = () => {
      const end = endMs ?? Date.now();
      return Math.max(0, Math.floor((end - startMs) / 1000));
    };

    setElapsedTime(computeElapsed());
    if (endMs != null || !enabled) return;

    const id = setInterval(() => setElapsedTime(computeElapsed()), 1000);
    return () => clearInterval(id);
  }, [
    enabled,
    job?.cancelled_at,
    job?.completed_at,
    job?.started_at,
    job?.status,
    startedAtMs,
  ]);

  const meaningfulEvents = useMemo(
    () => dedupeFeedEvents(events.filter((e) => !isScrapeHeartbeatEvent(e.event_type))),
    [events],
  );

  const latestMeaningfulEvent = useMemo(() => {
    if (meaningfulEvents.length === 0) return null;
    return meaningfulEvents[meaningfulEvents.length - 1];
  }, [meaningfulEvents]);

  const lastActivityAt = useMemo(() => {
    return (
      job?.last_activity_at ??
      latestMeaningfulEvent?.created_at ??
      job?.started_at ??
      null
    );
  }, [job?.last_activity_at, job?.started_at, latestMeaningfulEvent?.created_at]);

  const isStale = useMemo(() => {
    if (!job || isScrapeJobTerminal(job.status)) return false;
    if (!lastActivityAt) return false;
    return Date.now() - Date.parse(lastActivityAt) > STALE_ACTIVITY_MS;
  }, [job, lastActivityAt]);

  const isCancellable = Boolean(
    job &&
      !isTerminal &&
      job.status !== "waiting_user" &&
      job.status !== "cancelling",
  );

  const progress =
    job?.progress_current != null &&
    job?.progress_total != null &&
    job.progress_total > 0
      ? { current: job.progress_current, total: job.progress_total }
      : null;

  const currentMessage = resolveScrapeCurrentMessage({
    job,
    latestMeaningfulEvent,
    loading,
    isStale,
    isTerminal,
  });

  return {
    job,
    events,
    meaningfulEvents,
    currentMessage,
    currentStage: job?.current_stage ?? null,
    progress,
    elapsedTime,
    lastActivityAt,
    isStale,
    isTerminal,
    isCancellable,
    reconnecting,
    error,
    loading,
    ownershipRejected,
    refetch,
  };
}
