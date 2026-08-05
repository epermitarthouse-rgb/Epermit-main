import {
  createContext,
  useContext,
  useState,
  useRef,
  useCallback,
  useEffect,
  ReactNode,
} from "react";
import { toast } from "sonner";
import { getScraperBaseUrl } from "@/lib/scraperBaseUrl";
import { useScrapeJob } from "@/hooks/useScrapeJob";
import { ScrapeProgressPanel } from "@/components/scrape/ScrapeProgressPanel";
import {
  isScrapeJobTerminal,
  scrapeOutcomeFromJobStatus,
  type ScrapeJob,
} from "@/lib/scrapeJobTypes";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/lib/supabase";
import { canRestorePersistedScrapeJob } from "@/lib/scrapeJobOwnership";
import { terminalAutoCloseDelayMs } from "@/lib/scrapeTerminalLifecycle";
import {
  ACCELA_BROWSER_SESSION_KEY,
  clearAccelaBrowserSessionStorage,
  clearAllPersistedScrapeSessions,
  clearPersistedScrapeSession,
  clearPersistedScrapeSessionForProject,
  getPersistedAccelaSessionForProject,
  getPersistedScrapeSession,
  getPersistedScrapeSessionForProject,
  persistAccelaBrowserSession,
  persistScrapeSession,
  readAccelaBrowserSessionRaw,
  type AccelaBrowserSessionPersisted,
  type PersistedScrapeSession,
} from "@/lib/scrapeActiveSessionStorage";

const SCRAPER_URL = getScraperBaseUrl();

export type { AccelaBrowserSessionPersisted, PersistedScrapeSession };
export {
  ACCELA_BROWSER_SESSION_KEY,
  clearAccelaBrowserSessionStorage,
  getPersistedAccelaSessionForProject,
  getPersistedScrapeSessionForProject,
  clearPersistedScrapeSessionForProject,
};

type ScrapeOutcome = "done" | "cancelled" | "error" | "timeout" | null;

type ScrapeContextType = {
  isScraping: boolean;
  scrapeMinimized: boolean;
  setScrapeMinimized: (v: boolean) => void;
  accelaSessionId: string | null;
  activeSessionId: string | null;
  activeJobId: string | null;
  setAccelaSessionId: (
    sessionId: string,
    meta?: { projectId?: string; permitNumber?: string },
  ) => void;
  clearAccelaBrowserSession: (projectId?: string) => void;
  startScrapeSession: (
    sessionId: string,
    projectId: string,
    projectNum: string,
    jobId?: string | null,
  ) => void;
  cancelScrape: () => Promise<void>;
  /** Full idle reset (persistence, timers, panel, job). Prefer this over partial cleanup. */
  resetScrapeUi: () => void;
  /** Alias for resetScrapeUi — full reset for start failure / sign-out / cancel. */
  cleanupScrapeState: () => void;
  onScrapeCompleteRef: React.MutableRefObject<((projectId: string) => void) | null>;
  pendingCompletionProjectId: string | null;
  clearPendingCompletion: () => void;
  lastScrapeOutcome: ScrapeOutcome;
  clearLastScrapeOutcome: () => void;
  /** Live message from durable scrape job (for Agent Workflow). */
  scrapeLiveMessage: string | null;
  scrapeJobStatus: string | null;
};

const ScrapeContext = createContext<ScrapeContextType | null>(null);

export function useScrape() {
  const ctx = useContext(ScrapeContext);
  if (!ctx) throw new Error("useScrape must be used within ScrapeProvider");
  return ctx;
}

export function useScrapeOptional() {
  return useContext(ScrapeContext);
}

function initialAccelaSessionIdFromStorage(): string | null {
  const raw = readAccelaBrowserSessionRaw();
  return raw?.sessionId ? `${raw.sessionId}`.trim() : null;
}

async function fetchScrapeJobRow(jobId: string): Promise<ScrapeJob | null> {
  const { data, error } = await supabase
    .from("scrape_jobs")
    .select("*")
    .eq("id", jobId)
    .maybeSingle();
  if (error) throw error;
  return (data as ScrapeJob) || null;
}

export function ScrapeProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const userId = user?.id ? `${user.id}`.trim() : null;
  const tenantId =
    typeof user?.app_metadata?.tenant_id === "string"
      ? `${user.app_metadata.tenant_id}`.trim()
      : typeof user?.user_metadata?.tenant_id === "string"
        ? `${user.user_metadata.tenant_id}`.trim()
        : null;

  const [scrapeMinimized, setScrapeMinimized] = useState(false);
  const [accelaSessionId, setAccelaSessionIdState] = useState<string | null>(
    initialAccelaSessionIdFromStorage,
  );
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [panelVisible, setPanelVisible] = useState(false);
  const [permitNumber, setPermitNumber] = useState("");
  const [startedAtMs, setStartedAtMs] = useState<number | null>(null);
  const [cancelling, setCancelling] = useState(false);

  const activeSessionIdRef = useRef<string | null>(null);
  const activeProjectIdRef = useRef<string | null>(null);
  const onScrapeCompleteRef = useRef<((projectId: string) => void) | null>(null);
  const reattachUserRef = useRef<string | null>(null);
  const terminalHandledRef = useRef<string | null>(null);
  const legacyPollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const userIdRef = useRef(userId);
  userIdRef.current = userId;

  const [pendingCompletionProjectId, setPendingCompletionProjectId] = useState<string | null>(null);
  const [lastScrapeOutcome, setLastScrapeOutcome] = useState<ScrapeOutcome>(null);
  /** Optimistic terminal status (e.g. after cancel) until job row catches up. */
  const [terminalOverride, setTerminalOverride] = useState<string | null>(null);

  const activeJobIdWatchRef = useRef<string | null>(null);
  activeJobIdWatchRef.current = activeJobId;

  const scrapeHooksEnabled =
    Boolean(userId) && Boolean(activeJobId) && !terminalOverride;

  const jobState = useScrapeJob(activeJobId, startedAtMs, {
    enabled: scrapeHooksEnabled,
    userId,
    tenantId,
  });

  const panelJobState =
    terminalOverride && !jobState.isTerminal
      ? {
          ...jobState,
          isTerminal: true,
          isCancellable: false,
          job: jobState.job
            ? { ...jobState.job, status: terminalOverride as ScrapeJob["status"] }
            : jobState.job,
          currentMessage:
            terminalOverride === "cancelled"
              ? "Scrape cancelled"
              : jobState.currentMessage,
        }
      : jobState;

  const stopLegacyPoll = useCallback(() => {
    if (legacyPollRef.current) {
      clearTimeout(legacyPollRef.current);
      legacyPollRef.current = null;
    }
  }, []);

  const stopAutoCloseTimer = useCallback(() => {
    if (autoCloseTimerRef.current) {
      clearTimeout(autoCloseTimerRef.current);
      autoCloseTimerRef.current = null;
    }
  }, []);

  const resetScrapeUi = useCallback(() => {
    stopLegacyPoll();
    stopAutoCloseTimer();
    clearAllPersistedScrapeSessions();
    clearAccelaBrowserSessionStorage();
    activeSessionIdRef.current = null;
    activeProjectIdRef.current = null;
    terminalHandledRef.current = null;
    setActiveJobId(null);
    setPanelVisible(false);
    setScrapeMinimized(false);
    setPermitNumber("");
    setStartedAtMs(null);
    setCancelling(false);
    setAccelaSessionIdState(null);
    setPendingCompletionProjectId(null);
    setLastScrapeOutcome(null);
    setTerminalOverride(null);
  }, [stopAutoCloseTimer, stopLegacyPoll]);

  const cleanupScrapeState = resetScrapeUi;

  const clearPendingCompletion = useCallback(() => {
    setPendingCompletionProjectId(null);
  }, []);

  const clearLastScrapeOutcome = useCallback(() => {
    setLastScrapeOutcome(null);
  }, []);

  const setAccelaSessionId = useCallback(
    (
      sessionId: string,
      meta?: { projectId?: string; permitNumber?: string },
    ) => {
      if (!userIdRef.current) return;
      const sid = `${sessionId || ""}`.trim();
      if (!sid) return;
      setAccelaSessionIdState(sid);
      activeSessionIdRef.current = sid;
      const projectId = `${meta?.projectId || activeProjectIdRef.current || readAccelaBrowserSessionRaw()?.projectId || ""}`.trim();
      const permit =
        `${meta?.permitNumber || readAccelaBrowserSessionRaw()?.permitNumber || ""}`.trim();
      if (projectId) {
        activeProjectIdRef.current = projectId;
        persistAccelaBrowserSession({
          sessionId: sid,
          projectId,
          portalType: "accela",
          permitNumber: permit,
          savedAt: Date.now(),
        });
      }
    },
    [],
  );

  const clearAccelaBrowserSession = useCallback((projectId?: string) => {
    setAccelaSessionIdState(null);
    clearAccelaBrowserSessionStorage();
    const proj = `${projectId || ""}`.trim();
    if (proj) {
      clearPersistedScrapeSessionForProject(proj, userIdRef.current);
      if (`${activeProjectIdRef.current || ""}`.trim() === proj) {
        activeSessionIdRef.current = null;
        activeProjectIdRef.current = null;
      }
    }
  }, []);

  const finishTerminalAndReset = useCallback(() => {
    stopAutoCloseTimer();
    clearPersistedScrapeSession(userIdRef.current);
    stopLegacyPoll();
    activeSessionIdRef.current = null;
    activeProjectIdRef.current = null;
    setActiveJobId(null);
    setPanelVisible(false);
    setScrapeMinimized(false);
    setPermitNumber("");
    setStartedAtMs(null);
    setCancelling(false);
    setTerminalOverride(null);
  }, [stopAutoCloseTimer, stopLegacyPoll]);

  const handleTerminalJob = useCallback(
    (jobId: string, projectId: string, status: string) => {
      if (terminalHandledRef.current === jobId) return;
      terminalHandledRef.current = jobId;

      // Clear active-job persistence immediately so reload never restores this job.
      clearPersistedScrapeSession(userIdRef.current);
      stopLegacyPoll();

      const outcome = scrapeOutcomeFromJobStatus(status);
      if (outcome === "done") {
        setLastScrapeOutcome("done");
        if (onScrapeCompleteRef.current) {
          onScrapeCompleteRef.current(projectId);
        } else {
          setPendingCompletionProjectId(projectId);
        }
      } else if (outcome === "cancelled") {
        setLastScrapeOutcome("cancelled");
      } else if (outcome === "error") {
        setLastScrapeOutcome("error");
      } else {
        setLastScrapeOutcome("error");
      }

      setCancelling(false);
      stopAutoCloseTimer();
      const delay = terminalAutoCloseDelayMs(status);
      autoCloseTimerRef.current = setTimeout(() => {
        finishTerminalAndReset();
      }, delay);
    },
    [finishTerminalAndReset, stopAutoCloseTimer, stopLegacyPoll],
  );

  useEffect(() => {
    if (!userId || !activeJobId || !jobState.job || !jobState.isTerminal) return;
    handleTerminalJob(activeJobId, jobState.job.project_id, jobState.job.status);
  }, [activeJobId, handleTerminalJob, jobState.isTerminal, jobState.job, userId]);

  // Ownership rejection → clear and hide
  useEffect(() => {
    if (!jobState.ownershipRejected) return;
    clearPersistedScrapeSession(userId);
    setActiveJobId(null);
    setPanelVisible(false);
    stopLegacyPoll();
    stopAutoCloseTimer();
  }, [
    jobState.ownershipRejected,
    stopAutoCloseTimer,
    stopLegacyPoll,
    userId,
  ]);

  // Sign-out / no user → hard reset (no poll, no panel, clear persistence)
  useEffect(() => {
    if (userId) return;
    reattachUserRef.current = null;
    resetScrapeUi();
  }, [resetScrapeUi, userId]);

  // Also listen for explicit SIGNED_OUT / TOKEN_REFRESHED failure paths
  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") {
        reattachUserRef.current = null;
        resetScrapeUi();
      }
    });
    return () => subscription.unsubscribe();
  }, [resetScrapeUi]);

  const monitorLegacySession = useCallback(
    (sessionId: string, projectId: string) => {
      // Never run legacy poll alongside a durable jobId.
      if (activeJobIdWatchRef.current) return;

      const poll = async () => {
        if (!userIdRef.current) return;
        if (activeSessionIdRef.current !== sessionId) return;
        if (activeJobIdWatchRef.current) return;
        try {
          const res = await fetch(`${SCRAPER_URL}/api/data/${sessionId}`);
          if (!res.ok) {
            legacyPollRef.current = setTimeout(poll, 5000);
            return;
          }
          const data = (await res.json()) as {
            status?: string;
            message?: string;
            jobId?: string | null;
          };

          // Prefer durable job if the session reports one.
          if (data.jobId) {
            const jid = `${data.jobId}`.trim();
            stopLegacyPoll();
            setActiveJobId(jid);
            const uid = userIdRef.current;
            if (uid) {
              persistScrapeSession({
                userId: uid,
                tenantId,
                sessionId,
                jobId: jid,
                projectId,
                projectNum: permitNumber,
                startedAt: startedAtMs || Date.now(),
              });
            }
            return;
          }

          const status = `${data.status || ""}`.trim();
          if (status === "done" || status.startsWith("partial_success")) {
            setLastScrapeOutcome("done");
            if (onScrapeCompleteRef.current) {
              onScrapeCompleteRef.current(projectId);
            } else {
              setPendingCompletionProjectId(projectId);
            }
            finishTerminalAndReset();
            return;
          }
          if (status === "cancelled") {
            setLastScrapeOutcome("cancelled");
            finishTerminalAndReset();
            return;
          }
          if (status === "error") {
            setLastScrapeOutcome("error");
            finishTerminalAndReset();
            return;
          }
        } catch {
          /* keep polling */
        }
        legacyPollRef.current = setTimeout(poll, 5000);
      };
      legacyPollRef.current = setTimeout(poll, 5000);
    },
    [finishTerminalAndReset, permitNumber, startedAtMs, stopLegacyPoll, tenantId],
  );

  const startScrapeSession = useCallback(
    (
      sessionId: string,
      projectId: string,
      projectNum: string,
      jobId?: string | null,
    ) => {
      if (!userIdRef.current) return;

      stopLegacyPoll();
      stopAutoCloseTimer();
      setPendingCompletionProjectId(null);
      setLastScrapeOutcome(null);
      setTerminalOverride(null);
      terminalHandledRef.current = null;

      const startedAt = Date.now();
      activeSessionIdRef.current = sessionId;
      activeProjectIdRef.current = projectId;
      setAccelaSessionId(sessionId, { projectId, permitNumber: projectNum });
      setPermitNumber(projectNum);
      setStartedAtMs(startedAt);
      setScrapeMinimized(false);
      setPanelVisible(true);

      const resolvedJobId = jobId ? `${jobId}`.trim() : null;
      setActiveJobId(resolvedJobId);

      persistScrapeSession({
        userId: userIdRef.current,
        tenantId,
        sessionId,
        jobId: resolvedJobId,
        projectId,
        projectNum,
        startedAt,
      });

      // Legacy /api/data poll only when there is no durable jobId.
      if (!resolvedJobId) {
        monitorLegacySession(sessionId, projectId);
      }
    },
    [
      monitorLegacySession,
      setAccelaSessionId,
      stopAutoCloseTimer,
      stopLegacyPoll,
      tenantId,
    ],
  );

  const cancelScrape = useCallback(async () => {
    const jid = activeJobId ? `${activeJobId}`.trim() : "";
    const projectId = `${activeProjectIdRef.current || ""}`.trim();
    const sid = activeSessionIdRef.current;

    if (!jid && !sid) return;

    setCancelling(true);
    try {
      let res: Response;
      if (jid && projectId) {
        res = await fetch(`${SCRAPER_URL}/api/scrape-jobs/${jid}/cancel`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId }),
        });
      } else if (sid) {
        res = await fetch(`${SCRAPER_URL}/api/scrape/cancel/${sid}`, {
          method: "POST",
        });
      } else {
        toast.error("No active scrape to cancel");
        return;
      }

      const payload = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        error?: string;
        message?: string;
      };

      if (!res.ok || payload.success === false) {
        toast.error(payload.error || "Failed to cancel scrape");
        setCancelling(false);
        return;
      }

      setPanelVisible(true);
      setScrapeMinimized(false);
      stopLegacyPoll();
      stopAutoCloseTimer();

      // JobId path: keep polling through `cancelling` until durable `cancelled`.
      // Session-only path: no job row to poll — treat as terminal immediately.
      if (jid) {
        // cancelling stays true until handleTerminalJob sees cancelled
        clearPersistedScrapeSession(userIdRef.current);
      } else {
        setTerminalOverride("cancelled");
        setLastScrapeOutcome("cancelled");
        clearPersistedScrapeSession(userIdRef.current);
        autoCloseTimerRef.current = setTimeout(() => {
          resetScrapeUi();
        }, terminalAutoCloseDelayMs("cancelled"));
        setCancelling(false);
      }
    } catch {
      toast.error("Could not reach scraper to cancel");
      setCancelling(false);
    }
  }, [activeJobId, resetScrapeUi, stopAutoCloseTimer, stopLegacyPoll]);

  const handleDismissPanel = useCallback(() => {
    stopAutoCloseTimer();
    if (panelJobState.isTerminal || terminalOverride || !activeJobId) {
      resetScrapeUi();
      return;
    }
    // Non-terminal dismiss → minimize only (keep watching)
    setPanelVisible(false);
    setScrapeMinimized(true);
  }, [
    activeJobId,
    panelJobState.isTerminal,
    resetScrapeUi,
    stopAutoCloseTimer,
    terminalOverride,
  ]);

  // Restore only for authenticated user + owned non-terminal job
  useEffect(() => {
    if (!userId) {
      reattachUserRef.current = null;
      return;
    }
    if (reattachUserRef.current === userId) return;
    reattachUserRef.current = userId;

    let cancelled = false;

    (async () => {
      const persisted = getPersistedScrapeSession(userId);
      if (!persisted || cancelled) return;

      if (persisted.jobId) {
        try {
          const job = await fetchScrapeJobRow(persisted.jobId);
          if (cancelled) return;
          if (
            !canRestorePersistedScrapeJob(job, {
              userId,
              tenantId: persisted.tenantId ?? tenantId,
              projectId: persisted.projectId,
            })
          ) {
            clearPersistedScrapeSession(userId);
            return;
          }

          activeSessionIdRef.current = persisted.sessionId;
          activeProjectIdRef.current = persisted.projectId;
          setAccelaSessionIdState(persisted.sessionId);
          setPermitNumber(persisted.projectNum);
          setStartedAtMs(persisted.startedAt);
          setActiveJobId(persisted.jobId);
          setPanelVisible(true);
          // Re-write under user-scoped key (migrates legacy).
          persistScrapeSession({
            ...persisted,
            userId,
            tenantId: persisted.tenantId ?? tenantId,
          });
        } catch {
          if (!cancelled) clearPersistedScrapeSession(userId);
        }
        return;
      }

      // Session-only legacy path: confirm still scraping, else clear.
      try {
        const res = await fetch(`${SCRAPER_URL}/api/data/${persisted.sessionId}`);
        if (!res.ok || cancelled) {
          clearPersistedScrapeSession(userId);
          return;
        }
        const data = (await res.json()) as {
          status: string;
          jobId?: string | null;
        };
        if (cancelled) return;

        if (data.jobId) {
          const job = await fetchScrapeJobRow(`${data.jobId}`);
          if (
            !canRestorePersistedScrapeJob(job, {
              userId,
              tenantId: persisted.tenantId ?? tenantId,
              projectId: persisted.projectId,
            })
          ) {
            clearPersistedScrapeSession(userId);
            return;
          }
          setActiveJobId(`${data.jobId}`);
          setPanelVisible(true);
          setPermitNumber(persisted.projectNum);
          setStartedAtMs(persisted.startedAt);
          activeSessionIdRef.current = persisted.sessionId;
          activeProjectIdRef.current = persisted.projectId;
          persistScrapeSession({
            ...persisted,
            userId,
            tenantId: persisted.tenantId ?? tenantId,
            jobId: `${data.jobId}`,
          });
          return;
        }

        if (data.status === "scraping") {
          startScrapeSession(
            persisted.sessionId,
            persisted.projectId,
            persisted.projectNum,
            null,
          );
        } else {
          clearPersistedScrapeSession(userId);
        }
      } catch {
        if (!cancelled) clearPersistedScrapeSession(userId);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [startScrapeSession, tenantId, userId]);

  useEffect(() => {
    return () => {
      stopLegacyPoll();
      stopAutoCloseTimer();
    };
  }, [stopAutoCloseTimer, stopLegacyPoll]);

  const isScraping =
    Boolean(userId) &&
    Boolean(activeJobId) &&
    !terminalOverride &&
    (jobState.loading || Boolean(jobState.job)) &&
    !isScrapeJobTerminal(jobState.job?.status) &&
    !jobState.ownershipRejected;

  const showPanel =
    Boolean(userId) &&
    panelVisible &&
    (Boolean(activeJobId) || Boolean(permitNumber));

  const ctx: ScrapeContextType = {
    isScraping,
    scrapeMinimized,
    setScrapeMinimized,
    accelaSessionId,
    activeSessionId: accelaSessionId,
    activeJobId,
    setAccelaSessionId,
    clearAccelaBrowserSession,
    startScrapeSession,
    cancelScrape,
    resetScrapeUi,
    cleanupScrapeState,
    onScrapeCompleteRef,
    pendingCompletionProjectId,
    clearPendingCompletion,
    lastScrapeOutcome,
    clearLastScrapeOutcome,
    scrapeLiveMessage: panelJobState.currentMessage,
    scrapeJobStatus: panelJobState.job?.status ?? terminalOverride,
  };

  return (
    <ScrapeContext.Provider value={ctx}>
      {children}
      {showPanel && (
        <div
          className="fixed bottom-4 right-4 z-50 w-[min(100vw-2rem,24rem)] sm:w-96"
          role="status"
          aria-label="Scraping progress"
          data-testid="scrape-progress-bar"
        >
          <div className="relative rounded-xl border border-teal/30 bg-card text-foreground shadow-2xl shadow-black/20 overflow-hidden dark:bg-obsidian dark:text-ink-primary-dark dark:shadow-emerald-900/20">
            <div className="absolute inset-0 bg-gradient-to-br from-teal/10 via-transparent to-emerald-600/5 pointer-events-none" />
            <div className="relative">
              {activeJobId ? (
                <ScrapeProgressPanel
                  jobState={panelJobState}
                  permitNumber={permitNumber}
                  minimized={scrapeMinimized}
                  onMinimize={() => setScrapeMinimized(true)}
                  onExpand={() => setScrapeMinimized(false)}
                  onCancel={cancelScrape}
                  onDismiss={handleDismissPanel}
                  cancelling={cancelling}
                />
              ) : (
                <div className="p-4 text-xs text-ink-secondary-dark">
                  Scrape started. Waiting for progress job…
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </ScrapeContext.Provider>
  );
}
