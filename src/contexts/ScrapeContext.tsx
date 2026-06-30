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
} from "@/lib/scrapeJobTypes";

const SCRAPER_URL = getScraperBaseUrl();
const STORAGE_KEY = "scrape_active_session";
const ACCELA_BROWSER_SESSION_KEY = "accela_browser_session";

export type AccelaBrowserSessionPersisted = {
  sessionId: string;
  projectId: string;
  portalType: "accela";
  permitNumber: string;
  savedAt: number;
};

type PersistedScrapeSession = {
  sessionId: string;
  jobId: string | null;
  projectId: string;
  projectNum: string;
  startedAt: number;
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

function persistAccelaBrowserSession(payload: AccelaBrowserSessionPersisted) {
  try {
    localStorage.setItem(ACCELA_BROWSER_SESSION_KEY, JSON.stringify(payload));
  } catch {}
}

function readAccelaBrowserSessionRaw(): AccelaBrowserSessionPersisted | null {
  try {
    const raw = localStorage.getItem(ACCELA_BROWSER_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AccelaBrowserSessionPersisted;
    if (!parsed?.sessionId || !parsed?.projectId) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function getPersistedAccelaSessionForProject(
  projectId: string,
): AccelaBrowserSessionPersisted | null {
  const p = readAccelaBrowserSessionRaw();
  if (!p?.sessionId || !p.projectId) return null;
  if (`${p.projectId}`.trim() !== `${projectId}`.trim()) return null;
  return {
    sessionId: `${p.sessionId}`.trim(),
    projectId: `${p.projectId}`.trim(),
    portalType: "accela",
    permitNumber: `${p.permitNumber || ""}`.trim(),
    savedAt: Number(p.savedAt) || 0,
  };
}

export function clearAccelaBrowserSessionStorage() {
  try {
    localStorage.removeItem(ACCELA_BROWSER_SESSION_KEY);
  } catch {}
}

function getPersistedSession(): PersistedScrapeSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedScrapeSession;
    if (!parsed?.sessionId || !parsed?.projectId) return null;
    return {
      sessionId: `${parsed.sessionId}`.trim(),
      jobId: parsed.jobId ? `${parsed.jobId}`.trim() : null,
      projectId: `${parsed.projectId}`.trim(),
      projectNum: `${parsed.projectNum || ""}`.trim(),
      startedAt: Number(parsed.startedAt) || Date.now(),
    };
  } catch {
    return null;
  }
}

function persistSession(payload: PersistedScrapeSession) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {}
}

function clearPersistedSession() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {}
}

export function clearPersistedScrapeSessionForProject(projectId: string) {
  const p = getPersistedSession();
  if (!p?.projectId) return;
  if (`${p.projectId}`.trim() !== `${projectId}`.trim()) return;
  clearPersistedSession();
}

export function getPersistedScrapeSessionForProject(projectId: string): {
  sessionId: string;
  jobId: string | null;
  projectId: string;
  projectNum: string;
} | null {
  const p = getPersistedSession();
  if (!p?.sessionId || !p.projectId) return null;
  if (`${p.projectId}`.trim() !== `${projectId}`.trim()) return null;
  return {
    sessionId: p.sessionId,
    jobId: p.jobId,
    projectId: p.projectId,
    projectNum: p.projectNum,
  };
}

function initialAccelaSessionIdFromStorage(): string | null {
  const raw = readAccelaBrowserSessionRaw();
  return raw?.sessionId ? `${raw.sessionId}`.trim() : null;
}

export function ScrapeProvider({ children }: { children: ReactNode }) {
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
  const reattachAttemptedRef = useRef(false);
  const terminalHandledRef = useRef<string | null>(null);
  const legacyPollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [pendingCompletionProjectId, setPendingCompletionProjectId] = useState<string | null>(null);
  const [lastScrapeOutcome, setLastScrapeOutcome] = useState<ScrapeOutcome>(null);

  const jobState = useScrapeJob(activeJobId, startedAtMs);

  const clearPendingCompletion = useCallback(() => {
    setPendingCompletionProjectId(null);
  }, []);

  const clearLastScrapeOutcome = useCallback(() => {
    setLastScrapeOutcome(null);
  }, []);

  const stopLegacyPoll = useCallback(() => {
    if (legacyPollRef.current) {
      clearTimeout(legacyPollRef.current);
      legacyPollRef.current = null;
    }
  }, []);

  const cleanupScrapeState = useCallback(() => {
    stopLegacyPoll();
    activeSessionIdRef.current = null;
    activeProjectIdRef.current = null;
  }, [stopLegacyPoll]);

  const setAccelaSessionId = useCallback(
    (
      sessionId: string,
      meta?: { projectId?: string; permitNumber?: string },
    ) => {
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
      clearPersistedScrapeSessionForProject(proj);
      if (`${activeProjectIdRef.current || ""}`.trim() === proj) {
        activeSessionIdRef.current = null;
        activeProjectIdRef.current = null;
      }
    }
  }, []);

  const handleTerminalJob = useCallback(
    (jobId: string, projectId: string, status: string) => {
      if (terminalHandledRef.current === jobId) return;
      terminalHandledRef.current = jobId;

      const outcome = scrapeOutcomeFromJobStatus(status);
      if (outcome === "done") {
        toast.success("Scraping complete. Data saved to your project.");
        setLastScrapeOutcome("done");
        if (onScrapeCompleteRef.current) {
          onScrapeCompleteRef.current(projectId);
        } else {
          setPendingCompletionProjectId(projectId);
        }
      } else if (outcome === "cancelled") {
        setLastScrapeOutcome("cancelled");
      } else if (outcome === "error") {
        toast.error(jobState.job?.error_user_message || "Scraping failed");
        setLastScrapeOutcome("error");
      }
    },
    [jobState.job?.error_user_message],
  );

  useEffect(() => {
    if (!activeJobId || !jobState.job || !jobState.isTerminal) return;
    handleTerminalJob(activeJobId, jobState.job.project_id, jobState.job.status);
  }, [activeJobId, handleTerminalJob, jobState.isTerminal, jobState.job]);

  const monitorLegacySession = useCallback((sessionId: string, projectId: string) => {
    const poll = async () => {
      if (activeSessionIdRef.current !== sessionId) return;
      try {
        const res = await fetch(`${SCRAPER_URL}/api/data/${sessionId}`);
        if (!res.ok) {
          legacyPollRef.current = setTimeout(poll, 5000);
          return;
        }
        const data = (await res.json()) as { status?: string; message?: string };
        const status = `${data.status || ""}`.trim();
        if (status === "done" || status.startsWith("partial_success")) {
          setLastScrapeOutcome("done");
          if (onScrapeCompleteRef.current) {
            onScrapeCompleteRef.current(projectId);
          } else {
            setPendingCompletionProjectId(projectId);
          }
          setPanelVisible(false);
          cleanupScrapeState();
          clearPersistedSession();
          return;
        }
        if (status === "cancelled") {
          setLastScrapeOutcome("cancelled");
          setPanelVisible(false);
          cleanupScrapeState();
          clearPersistedSession();
          return;
        }
        if (status === "error") {
          setLastScrapeOutcome("error");
          toast.error(data.message || "Scraping failed");
          setPanelVisible(false);
          cleanupScrapeState();
          clearPersistedSession();
          return;
        }
      } catch {
        /* keep polling */
      }
      legacyPollRef.current = setTimeout(poll, 5000);
    };
    legacyPollRef.current = setTimeout(poll, 5000);
  }, [cleanupScrapeState]);

  const startScrapeSession = useCallback(
    (
      sessionId: string,
      projectId: string,
      projectNum: string,
      jobId?: string | null,
    ) => {
      stopLegacyPoll();
      setPendingCompletionProjectId(null);
      setLastScrapeOutcome(null);
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

      persistSession({
        sessionId,
        jobId: resolvedJobId,
        projectId,
        projectNum,
        startedAt,
      });

      if (!resolvedJobId) {
        monitorLegacySession(sessionId, projectId);
      }
    },
    [monitorLegacySession, setAccelaSessionId, stopLegacyPoll],
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
        return;
      }

      if (jid) {
        terminalHandledRef.current = jid;
      }
      setLastScrapeOutcome("cancelled");
      clearPersistedSession();
      clearAccelaBrowserSession(projectId || undefined);
      cleanupScrapeState();
      setActiveJobId(null);
      setPanelVisible(false);
      toast.info("Scrape cancelled");
    } catch {
      toast.error("Could not reach scraper to cancel");
    } finally {
      setCancelling(false);
    }
  }, [activeJobId, cleanupScrapeState, clearAccelaBrowserSession]);

  const handleDismissPanel = useCallback(() => {
    setPanelVisible(false);
    setScrapeMinimized(false);
    if (jobState.isTerminal) {
      clearPersistedSession();
      setActiveJobId(null);
      cleanupScrapeState();
    }
  }, [cleanupScrapeState, jobState.isTerminal]);

  useEffect(() => {
    if (!reattachAttemptedRef.current) {
      reattachAttemptedRef.current = true;
      const persisted = getPersistedSession();
      if (!persisted) return;

      if (persisted.jobId) {
        toast.info("Restoring scrape progress…");
        activeSessionIdRef.current = persisted.sessionId;
        activeProjectIdRef.current = persisted.projectId;
        setAccelaSessionIdState(persisted.sessionId);
        setPermitNumber(persisted.projectNum);
        setStartedAtMs(persisted.startedAt);
        setActiveJobId(persisted.jobId);
        setPanelVisible(true);
        return;
      }

      (async () => {
        try {
          const res = await fetch(`${SCRAPER_URL}/api/data/${persisted.sessionId}`);
          if (!res.ok) {
            clearPersistedSession();
            return;
          }
          const data = (await res.json()) as {
            status: string;
            jobId?: string | null;
          };
          if (data.jobId) {
            setActiveJobId(`${data.jobId}`);
            setPanelVisible(true);
            setPermitNumber(persisted.projectNum);
            setStartedAtMs(persisted.startedAt);
            activeSessionIdRef.current = persisted.sessionId;
            activeProjectIdRef.current = persisted.projectId;
            return;
          }
          if (data.status === "scraping") {
            toast.info("Re-attaching to active scrape session…");
            startScrapeSession(
              persisted.sessionId,
              persisted.projectId,
              persisted.projectNum,
              null,
            );
          } else if (
            data.status === "done" ||
            data.status?.startsWith("partial_success")
          ) {
            clearPersistedSession();
            if (onScrapeCompleteRef.current) {
              onScrapeCompleteRef.current(persisted.projectId);
            } else {
              setPendingCompletionProjectId(persisted.projectId);
            }
          } else {
            clearPersistedSession();
          }
        } catch {
          if (persisted.jobId) {
            setActiveJobId(persisted.jobId);
            setPanelVisible(true);
          } else {
            clearPersistedSession();
          }
        }
      })();
    }
  }, [startScrapeSession]);

  useEffect(() => {
    return () => stopLegacyPoll();
  }, [stopLegacyPoll]);

  const isScraping =
    panelVisible &&
    Boolean(activeJobId) &&
    (jobState.loading || Boolean(jobState.job)) &&
    !isScrapeJobTerminal(jobState.job?.status);

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
    cleanupScrapeState,
    onScrapeCompleteRef,
    pendingCompletionProjectId,
    clearPendingCompletion,
    lastScrapeOutcome,
    clearLastScrapeOutcome,
    scrapeLiveMessage: jobState.currentMessage,
    scrapeJobStatus: jobState.job?.status ?? null,
  };

  return (
    <ScrapeContext.Provider value={ctx}>
      {children}
      {panelVisible && (activeJobId || permitNumber) && (
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
                  jobState={jobState}
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
