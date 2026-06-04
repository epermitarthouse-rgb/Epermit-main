import { createContext, useContext, useState, useRef, useCallback, useEffect, ReactNode } from "react";
import { toast } from "sonner";
import { CheckCircle2, ChevronDown, Circle, XCircle, Minimize2, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { getScraperBaseUrl } from "@/lib/scraperBaseUrl";

const SCRAPER_URL = getScraperBaseUrl();
const SCRAPE_KEYFRAMES = `
  @keyframes scrape-pulse-glow {
    0%, 100% { opacity: 1; box-shadow: 0 0 12px rgba(16, 185, 129, 0.5); }
    50% { opacity: 0.9; box-shadow: 0 0 24px rgba(16, 185, 129, 0.7); }
  }
  @keyframes scrape-spin {
    to { transform: rotate(360deg); }
  }
  @keyframes scrape-fade-in-up {
    from { opacity: 0; transform: translateY(6px); }
    to { opacity: 1; transform: translateY(0); }
  }
  @keyframes scrape-scale-check {
    from { opacity: 0; transform: scale(0.5); }
    to { opacity: 1; transform: scale(1); }
  }
  @keyframes scrape-pulse-dot {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.6; transform: scale(1.2); }
  }
`;

const TAB_STEPS = [
  { key: "status", label: "Status tab" },
  { key: "files", label: "Files tab" },
  { key: "tasks", label: "Tasks tab" },
  { key: "info", label: "Info tab" },
  { key: "reports", label: "Reports tab" },
];

const STORAGE_KEY = "scrape_active_session";
const ACCELA_BROWSER_SESSION_KEY = "accela_browser_session";

export type AccelaBrowserSessionPersisted = {
  sessionId: string;
  projectId: string;
  portalType: "accela";
  permitNumber: string;
  savedAt: number;
};

const SCRAPE_TERMINAL_STATUSES = new Set([
  "done",
  "partial_success_plan_review_pending",
  "partial_success_plan_review_failed",
]);

function isScrapeTerminalStatus(status: string): boolean {
  return SCRAPE_TERMINAL_STATUSES.has(`${status || ""}`.trim());
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

/** Clear legacy scrape_active_session when it belongs to the given project. */
export function clearPersistedScrapeSessionForProject(projectId: string) {
  const p = getPersistedSession();
  if (!p?.projectId) return;
  if (`${p.projectId}`.trim() !== `${projectId}`.trim()) return;
  clearPersistedSession();
}

export type ScrapeOverlay = {
  phase: "scraping" | "done";
  stepText: string;
  progress: number;
  total: number;
  projectNum: string;
  completedSteps: Set<string>;
  currentStepKey: string | null;
};

type ScrapeOutcome = "done" | "cancelled" | "error" | "timeout" | null;

type ScrapeContextType = {
  isScraping: boolean;
  scrapeOverlay: ScrapeOverlay | null;
  scrapeMinimized: boolean;
  setScrapeMinimized: (v: boolean) => void;
  scrapeElapsed: number;
  /** Reactive Accela browser session id (login + continue-downloads). */
  accelaSessionId: string | null;
  /** @deprecated Prefer accelaSessionId — kept for compatibility. */
  activeSessionId: string | null;
  setAccelaSessionId: (
    sessionId: string,
    meta?: { projectId?: string; permitNumber?: string },
  ) => void;
  clearAccelaBrowserSession: (projectId?: string) => void;
  startScrapeSession: (sessionId: string, projectId: string, projectNum: string) => void;
  cancelScrape: () => Promise<void>;
  cleanupScrapeState: () => void;
  onScrapeCompleteRef: React.MutableRefObject<((projectId: string) => void) | null>;
  pendingCompletionProjectId: string | null;
  clearPendingCompletion: () => void;
  lastScrapeOutcome: ScrapeOutcome;
  clearLastScrapeOutcome: () => void;
  setScrapeOverlay: React.Dispatch<React.SetStateAction<ScrapeOverlay | null>>;
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

function formatElapsed(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function persistSession(sessionId: string, projectId: string, projectNum: string) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ sessionId, projectId, projectNum, startedAt: Date.now() }));
  } catch {}
}

function clearPersistedSession() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {}
}

function getPersistedSession(): { sessionId: string; projectId: string; projectNum: string; startedAt: number } | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Active scrape session from localStorage when it matches the given project. */
export function getPersistedScrapeSessionForProject(projectId: string): {
  sessionId: string;
  projectId: string;
  projectNum: string;
} | null {
  const p = getPersistedSession();
  if (!p?.sessionId || !p.projectId) return null;
  if (`${p.projectId}`.trim() !== `${projectId}`.trim()) return null;
  return {
    sessionId: `${p.sessionId}`.trim(),
    projectId: `${p.projectId}`.trim(),
    projectNum: `${p.projectNum || ""}`.trim(),
  };
}

function initialAccelaSessionIdFromStorage(): string | null {
  const raw = readAccelaBrowserSessionRaw();
  return raw?.sessionId ? `${raw.sessionId}`.trim() : null;
}

export function ScrapeProvider({ children }: { children: ReactNode }) {
  const [scrapeOverlay, setScrapeOverlay] = useState<ScrapeOverlay | null>(null);
  const [scrapeMinimized, setScrapeMinimized] = useState(false);
  const [scrapeElapsed, setScrapeElapsed] = useState(0);
  const [accelaSessionId, setAccelaSessionIdState] = useState<string | null>(
    initialAccelaSessionIdFromStorage,
  );

  const eventSourceRef = useRef<EventSource | null>(null);
  const activeSessionIdRef = useRef<string | null>(null);
  const activeProjectIdRef = useRef<string | null>(null);
  const elapsedIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const doneDismissTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onScrapeCompleteRef = useRef<((projectId: string) => void) | null>(null);
  const reattachAttemptedRef = useRef(false);
  const [pendingCompletionProjectId, setPendingCompletionProjectId] = useState<string | null>(null);
  const [lastScrapeOutcome, setLastScrapeOutcome] = useState<ScrapeOutcome>(null);

  const clearPendingCompletion = useCallback(() => {
    setPendingCompletionProjectId(null);
  }, []);

  const clearLastScrapeOutcome = useCallback(() => {
    setLastScrapeOutcome(null);
  }, []);

  const cleanupScrapeState = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    if (elapsedIntervalRef.current) {
      clearInterval(elapsedIntervalRef.current);
      elapsedIntervalRef.current = null;
    }
    activeSessionIdRef.current = null;
    activeProjectIdRef.current = null;
  }, []);

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
      const permitNumber =
        `${meta?.permitNumber || readAccelaBrowserSessionRaw()?.permitNumber || ""}`.trim();
      if (projectId) {
        activeProjectIdRef.current = projectId;
        persistAccelaBrowserSession({
          sessionId: sid,
          projectId,
          portalType: "accela",
          permitNumber,
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

  const cancelScrape = useCallback(async () => {
    const sid = activeSessionIdRef.current;
    if (!sid) return;
    try {
      const res = await fetch(`${SCRAPER_URL}/api/scrape/cancel/${sid}`, { method: "POST" });
      if (!res.ok) {
        toast.error("Failed to cancel scrape");
        return;
      }
    } catch {
      toast.error("Could not reach scraper to cancel");
      return;
    }
    cleanupScrapeState();
    clearPersistedSession();
    clearAccelaBrowserSession();
    setScrapeOverlay(null);
    setScrapeMinimized(false);
    setLastScrapeOutcome("cancelled");
    toast.info("Scrape cancelled");
  }, [cleanupScrapeState, clearAccelaBrowserSession]);

  const finishTerminalScrapePoll = useCallback(
    (
      sessionId: string,
      projectId: string,
      data: {
        status: string;
        message?: string;
        progress?: number;
        total?: number;
      },
    ) => {
      cleanupScrapeState();
      clearPersistedSession();

      const total = data.total ?? 0;
      const progress = data.progress ?? 0;
      const tabsExtracted = Math.max(progress, total, 1);
      const status = `${data.status || ""}`.trim();

      if (status === "partial_success_plan_review_pending") {
        setScrapeOverlay((prev) =>
          prev
            ? {
                ...prev,
                phase: "done",
                stepText:
                  data.message ||
                  "Plan Review partially complete — downloads pending",
                progress: total,
                total,
                completedSteps: new Set(TAB_STEPS.map((t) => t.key)),
                currentStepKey: null,
              }
            : null,
        );
        toast.info(
          "Scrape partially complete — Plan Review downloads can be continued.",
        );
        setLastScrapeOutcome("done");
      } else if (status === "partial_success_plan_review_failed") {
        setScrapeOverlay((prev) =>
          prev
            ? {
                ...prev,
                phase: "done",
                stepText:
                  data.message || "Plan Review unavailable for this record",
                progress: total,
                total,
                completedSteps: new Set(prev.completedSteps),
                currentStepKey: null,
              }
            : null,
        );
        toast.warning(data.message || "Plan Review scrape did not complete.");
        setLastScrapeOutcome("error");
      } else {
        setScrapeOverlay((prev) =>
          prev
            ? {
                ...prev,
                phase: "done",
                stepText: `Scraping complete! ${tabsExtracted}/${Math.max(total, 1)} tabs extracted`,
                progress: total,
                total,
                completedSteps: new Set(TAB_STEPS.map((t) => t.key)),
                currentStepKey: null,
              }
            : null,
        );
        toast.success(
          `Scraping complete! ${tabsExtracted} tab${tabsExtracted === 1 ? "" : "s"} extracted. Data saved.`,
        );
        setLastScrapeOutcome("done");
      }

      if (onScrapeCompleteRef.current) {
        onScrapeCompleteRef.current(projectId);
      } else {
        setPendingCompletionProjectId(projectId);
      }
    },
    [cleanupScrapeState],
  );

  const monitorScrapeInBackground = useCallback((sessionId: string, projectId: string) => {
    const pollInterval = 1500;
    let attempts = 0;
    const maxAttempts = 600;

    const poll = async () => {
      if (!activeSessionIdRef.current || activeSessionIdRef.current !== sessionId) return;
      try {
        const dataRes = await fetch(`${SCRAPER_URL}/api/data/${sessionId}`);
        if (!dataRes.ok) {
          if (attempts++ < maxAttempts) setTimeout(poll, pollInterval);
          return;
        }
        const data = (await dataRes.json()) as {
          status: string;
          message?: string;
          progress?: number;
          total?: number;
        };

        if (isScrapeTerminalStatus(data.status)) {
          finishTerminalScrapePoll(sessionId, projectId, data);
          return;
        }
        if (data.status === "cancelled") {
          cleanupScrapeState();
          clearPersistedSession();
          clearAccelaBrowserSession();
          setScrapeOverlay(null);
          setScrapeMinimized(false);
          setLastScrapeOutcome("cancelled");
          return;
        }
        if (data.status === "error") {
          cleanupScrapeState();
          clearPersistedSession();
          setScrapeOverlay(null);
          setScrapeMinimized(false);
          setLastScrapeOutcome("error");
          toast.error(data.message || "Scraping failed");
          return;
        }
        const total = data.total ?? 0;
        const progressVal = data.progress ?? 0;

        setScrapeOverlay((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            progress: progressVal,
            total: total || prev.total,
          };
        });
      } catch {
      }
      if (attempts++ < maxAttempts) {
        setTimeout(poll, pollInterval);
      } else {
        cleanupScrapeState();
        clearPersistedSession();
        setScrapeOverlay(null);
        setScrapeMinimized(false);
        setLastScrapeOutcome("timeout");
        toast.warning("Scraping took longer than expected. Check back shortly.");
      }
    };
    setTimeout(poll, pollInterval);
  }, [
    cleanupScrapeState,
    clearAccelaBrowserSession,
    finishTerminalScrapePoll,
  ]);

  const startScrapeSession = useCallback((sessionId: string, projectId: string, projectNum: string) => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    if (elapsedIntervalRef.current) {
      clearInterval(elapsedIntervalRef.current);
      elapsedIntervalRef.current = null;
    }
    if (doneDismissTimeoutRef.current) {
      clearTimeout(doneDismissTimeoutRef.current);
      doneDismissTimeoutRef.current = null;
    }
    setPendingCompletionProjectId(null);
    setLastScrapeOutcome(null);

    activeSessionIdRef.current = sessionId;
    activeProjectIdRef.current = projectId;
    setAccelaSessionId(sessionId, { projectId, permitNumber: projectNum });

    const completedSteps = new Set<string>();
    setScrapeOverlay({
      phase: "scraping",
      stepText: "Logging in...",
      progress: 0,
      total: 5,
      projectNum,
      completedSteps,
      currentStepKey: null,
    });
    setScrapeMinimized(false);
    setScrapeElapsed(0);
    elapsedIntervalRef.current = setInterval(() => {
      setScrapeElapsed((s) => s + 1);
    }, 1000);

    persistSession(sessionId, projectId, projectNum);

    const progressUrl = `${SCRAPER_URL}/api/progress/${sessionId}`;
    const es = new EventSource(progressUrl);
    eventSourceRef.current = es;
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data) as {
          status?: string;
          message?: string;
          progress?: number;
          total?: number;
        };
        const total = data.total ?? 0;
        const progress = data.progress ?? 0;
        const msg = (data.message ?? "").trim();
        setScrapeOverlay((prev) => {
          if (!prev) return prev;
          const nextCompleted = new Set(prev.completedSteps);
          if (msg.includes("→ Info")) {
            nextCompleted.add("info");
            nextCompleted.add("status");
            nextCompleted.add("files");
            nextCompleted.add("tasks");
          }
          if (msg.includes("→ Reports")) nextCompleted.add("reports");
          if (msg.includes("→ Status")) nextCompleted.add("status");
          if (msg.includes("→ Files")) nextCompleted.add("files");
          if (msg.includes("→ Tasks")) nextCompleted.add("tasks");
          let stepText = prev.stepText;
          if (data.status === "done") {
            stepText = "Saving to database...";
          } else if (msg) {
            if (msg.includes("→ Info")) stepText = "Scraping Info tab...";
            else if (msg.includes("→ Reports")) stepText = "Scraping Reports tab...";
            else if (msg.includes("→ Status")) stepText = "Scraping Status tab...";
            else if (msg.includes("→ Files")) stepText = "Scraping Files tab...";
            else if (msg.includes("→ Tasks")) stepText = "Scraping Tasks tab...";
            else stepText = msg;
          }
          const currentKey = msg.includes("→ Reports")
            ? "reports"
            : msg.includes("→ Info")
              ? "info"
              : msg.includes("→ Status")
                ? "status"
                : msg.includes("→ Files")
                  ? "files"
                  : msg.includes("→ Tasks")
                    ? "tasks"
                    : prev.currentStepKey;
          return {
            ...prev,
            stepText,
            progress,
            total: total || prev.total,
            completedSteps: nextCompleted,
            currentStepKey: currentKey,
          };
        });
      } catch {}
    };
    es.onerror = () => es.close();

    monitorScrapeInBackground(sessionId, projectId);
  }, [monitorScrapeInBackground, setAccelaSessionId]);

  useEffect(() => {
    if (!reattachAttemptedRef.current) {
      reattachAttemptedRef.current = true;
      const persisted = getPersistedSession();
      if (persisted) {
        const elapsed = Math.floor((Date.now() - persisted.startedAt) / 1000);
        if (elapsed > 900) {
          clearPersistedSession();
          return;
        }
        (async () => {
          try {
            const res = await fetch(`${SCRAPER_URL}/api/data/${persisted.sessionId}`);
            if (!res.ok) {
              clearPersistedSession();
              return;
            }
            const data = await res.json() as { status: string; progress?: number; total?: number; message?: string };
            if (data.status === "scraping") {
              toast.info("Re-attaching to active scrape session...");
              activeSessionIdRef.current = persisted.sessionId;
              activeProjectIdRef.current = persisted.projectId;
              setAccelaSessionIdState(persisted.sessionId);
              setScrapeElapsed(elapsed);
              setScrapeOverlay({
                phase: "scraping",
                stepText: data.message || "Scraping...",
                progress: data.progress ?? 0,
                total: data.total ?? 5,
                projectNum: persisted.projectNum,
                completedSteps: new Set<string>(),
                currentStepKey: null,
              });
              elapsedIntervalRef.current = setInterval(() => {
                setScrapeElapsed((s) => s + 1);
              }, 1000);
              monitorScrapeInBackground(persisted.sessionId, persisted.projectId);
            } else if (isScrapeTerminalStatus(data.status)) {
              clearPersistedSession();
              setAccelaSessionIdState(persisted.sessionId);
              persistAccelaBrowserSession({
                sessionId: persisted.sessionId,
                projectId: persisted.projectId,
                portalType: "accela",
                permitNumber: persisted.projectNum,
                savedAt: Date.now(),
              });
              if (onScrapeCompleteRef.current) {
                onScrapeCompleteRef.current(persisted.projectId);
              } else {
                setPendingCompletionProjectId(persisted.projectId);
              }
            } else {
              clearPersistedSession();
            }
          } catch {
            clearPersistedSession();
          }
        })();
      }
    }
  }, [monitorScrapeInBackground]);

  useEffect(() => {
    if (scrapeOverlay?.phase !== "done") return;
    doneDismissTimeoutRef.current = setTimeout(() => {
      setScrapeOverlay(null);
      setScrapeMinimized(false);
      doneDismissTimeoutRef.current = null;
    }, 5000);
    return () => {
      if (doneDismissTimeoutRef.current) {
        clearTimeout(doneDismissTimeoutRef.current);
        doneDismissTimeoutRef.current = null;
      }
    };
  }, [scrapeOverlay?.phase]);

  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      if (elapsedIntervalRef.current) {
        clearInterval(elapsedIntervalRef.current);
        elapsedIntervalRef.current = null;
      }
      if (doneDismissTimeoutRef.current) {
        clearTimeout(doneDismissTimeoutRef.current);
        doneDismissTimeoutRef.current = null;
      }
    };
  }, []);

  const handleDismissOverlay = useCallback(() => {
    if (doneDismissTimeoutRef.current) {
      clearTimeout(doneDismissTimeoutRef.current);
      doneDismissTimeoutRef.current = null;
    }
    setScrapeOverlay(null);
    setScrapeMinimized(false);
  }, []);

  const handleHideToBackground = useCallback(() => {
    setScrapeMinimized(true);
  }, []);

  const isScraping = scrapeOverlay?.phase === "scraping";

  const ctx: ScrapeContextType = {
    isScraping,
    scrapeOverlay,
    scrapeMinimized,
    setScrapeMinimized,
    scrapeElapsed,
    accelaSessionId,
    activeSessionId: accelaSessionId,
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
    setScrapeOverlay,
  };

  return (
    <ScrapeContext.Provider value={ctx}>
      <style>{SCRAPE_KEYFRAMES}</style>
      {children}
      {scrapeOverlay && (
        <div
          className="fixed bottom-4 right-4 z-50 w-80"
          role="status"
          aria-label="Scraping progress"
          data-testid="scrape-progress-bar"
        >
          <div className="relative rounded-xl border border-teal/30 bg-obsidian shadow-2xl shadow-emerald-900/20 overflow-hidden text-ink-primary-dark">
            <div className="absolute inset-0 bg-gradient-to-br from-teal/10 via-transparent to-emerald-600/5 pointer-events-none" />
            <div className="relative">
              {scrapeOverlay.phase === "scraping" ? (
                scrapeMinimized ? (
                  <button
                    className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-obsidian-raised transition-colors"
                    onClick={() => setScrapeMinimized(false)}
                    data-testid="button-expand-scrape"
                  >
                    <div
                      className="h-4 w-4 shrink-0 rounded-full border-2 border-teal border-t-transparent"
                      style={{ animation: "scrape-spin 0.8s linear infinite" }}
                    />
                    <span className="text-xs text-ink-secondary-dark truncate flex-1">
                      {scrapeOverlay.stepText}
                    </span>
                    <span className="text-xs font-mono text-teal tabular-nums shrink-0">
                      {formatElapsed(scrapeElapsed)}
                    </span>
                  </button>
                ) : (
                  <div className="p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div
                          className="h-4 w-4 shrink-0 rounded-full border-2 border-teal border-t-transparent"
                          style={{ animation: "scrape-spin 0.8s linear infinite" }}
                        />
                        <h3 className="text-sm font-semibold text-ink-primary-dark">
                          Scraping portal
                        </h3>
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="text-xs font-mono text-teal tabular-nums">
                          {formatElapsed(scrapeElapsed)}
                        </span>
                        <button
                          className="ml-1 p-1 rounded hover:bg-obsidian-raised text-ink-tertiary-dark hover:text-ink-primary-dark transition-colors"
                          onClick={handleHideToBackground}
                          title="Hide to background"
                          data-testid="button-hide-scrape-background"
                        >
                          <Minimize2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                    <p className="text-xs text-ink-tertiary-dark">
                      Permit:{" "}
                      <span className="font-medium text-teal">
                        {scrapeOverlay.projectNum}
                      </span>
                    </p>
                    <p className="text-xs text-ink-secondary-dark">
                      {scrapeOverlay.stepText}
                    </p>
                    <div className="h-1.5 rounded-full bg-obsidian-raised overflow-hidden">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-emerald-600 to-teal transition-all duration-500 ease-out"
                        style={{
                          width: `${scrapeOverlay.total > 0 ? Math.round((scrapeOverlay.progress / scrapeOverlay.total) * 100) : 0}%`,
                        }}
                      />
                    </div>
                    <ul className="space-y-1">
                      {TAB_STEPS.map((tab) => {
                        const done = scrapeOverlay.completedSteps.has(tab.key);
                        const current = scrapeOverlay.currentStepKey === tab.key;
                        return (
                          <li key={tab.key} className="flex items-center gap-2 text-xs">
                            {done ? (
                              <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-teal" />
                            ) : current ? (
                              <span
                                className="h-2 w-2 shrink-0 rounded-full bg-teal"
                                style={{ animation: "scrape-pulse-dot 1s ease-in-out infinite" }}
                              />
                            ) : (
                              <Circle className="h-3.5 w-3.5 shrink-0 text-ink-tertiary-dark" />
                            )}
                            <span className={done ? "text-ink-tertiary-dark" : current ? "text-teal font-medium" : "text-ink-tertiary-dark"}>
                              {tab.label}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-1 h-7 text-xs border-obsidian-raised text-ink-secondary-dark hover:bg-obsidian-raised hover:text-ink-primary-dark"
                        onClick={handleHideToBackground}
                        data-testid="button-hide-to-background"
                      >
                        <Minimize2 className="h-3.5 w-3.5 mr-1.5" />
                        Hide to Background
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        className="h-7 text-xs px-3"
                        onClick={cancelScrape}
                        data-testid="button-cancel-scrape-overlay"
                      >
                        <XCircle className="h-3.5 w-3.5 mr-1" />
                        Cancel
                      </Button>
                    </div>
                  </div>
                )
              ) : (
                <div className="p-4 space-y-2">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-5 w-5 text-teal" />
                    <h3 className="text-sm font-semibold text-ink-primary-dark">
                      Scraping complete!
                    </h3>
                  </div>
                  <p className="text-xs text-ink-tertiary-dark">
                    {scrapeOverlay.stepText}
                  </p>
                  <p className="text-xs text-teal">
                    Launching agent chain...
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full h-7 text-xs border-teal/40 text-teal hover:bg-teal/10"
                    onClick={handleDismissOverlay}
                    data-testid="button-dismiss-scraping"
                  >
                    Dismiss
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </ScrapeContext.Provider>
  );
}
