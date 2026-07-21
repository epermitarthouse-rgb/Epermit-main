import { useEffect, useRef, useState } from "react";
import { format } from "date-fns";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Loader2,
  Minimize2,
  WifiOff,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ProgressLine, StatusPill } from "@/components/design/ProductPrimitives";
import { scrapeStatusTone } from "@/adapters/scrapeStatusAdapter";
import {
  scrapeJobStatusLabel,
  type ScrapeEvent,
  type ScrapeJob,
} from "@/lib/scrapeJobTypes";
import type { UseScrapeJobResult } from "@/hooks/useScrapeJob";

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function formatEventTime(iso: string): string {
  try {
    return format(new Date(iso), "HH:mm:ss");
  } catch {
    return "";
  }
}

function EventFeed({
  events,
  autoScroll,
}: {
  events: ScrapeEvent[];
  autoScroll: boolean;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [userScrolledUp, setUserScrolledUp] = useState(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onScroll = () => {
      const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
      setUserScrolledUp(!nearBottom);
    };
    el.addEventListener("scroll", onScroll);
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (autoScroll && !userScrolledUp) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [events.length, autoScroll, userScrolledUp]);

  if (events.length === 0) {
    return (
      <p className="text-xs text-ink-tertiary-dark italic py-2">
        Activity will appear here as the scrape progresses.
      </p>
    );
  }

  return (
    <div
      ref={containerRef}
      className="max-h-44 overflow-y-auto space-y-1.5 pr-1 scrollbar-thin"
      data-testid="scrape-event-feed"
    >
      {events.map((event) => (
        <div key={event.id} className="flex gap-2 text-xs leading-snug">
          <span className="font-mono text-ink-tertiary-dark shrink-0 tabular-nums">
            {formatEventTime(event.created_at)}
          </span>
          <span className="text-ink-secondary-dark">—</span>
          <span className="text-ink-primary-dark">{event.user_message}</span>
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  );
}

export interface ScrapeProgressPanelProps {
  jobState: UseScrapeJobResult;
  permitNumber: string;
  minimized: boolean;
  onMinimize: () => void;
  onExpand: () => void;
  onCancel?: () => void;
  onDismiss?: () => void;
  cancelling?: boolean;
}

export function ScrapeProgressPanel({
  jobState,
  permitNumber,
  minimized,
  onMinimize,
  onExpand,
  onCancel,
  onDismiss,
  cancelling = false,
}: ScrapeProgressPanelProps) {
  const {
    job,
    events,
    meaningfulEvents,
    currentMessage,
    progress,
    elapsedTime,
    lastActivityAt,
    isStale,
    isTerminal,
    isCancellable,
    reconnecting,
  } = jobState;

  const [feedExpanded, setFeedExpanded] = useState(true);
  const [showTechnical, setShowTechnical] = useState(false);

  const status = job?.status ?? "running";
  const jurisdiction = job?.jurisdiction ?? "Portal";
  const progressPct =
    progress && progress.total > 0
      ? Math.round((progress.current / progress.total) * 100)
      : null;

  const technicalEvents = meaningfulEvents.filter((e) => e.technical_message?.trim());

  if (minimized) {
    return (
      <button
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-muted transition-colors dark:hover:bg-obsidian-raised"
        onClick={onExpand}
        data-testid="button-expand-scrape"
      >
        {!isTerminal ? (
          <div
            className="h-4 w-4 shrink-0 rounded-full border-2 border-teal border-t-transparent animate-spin"
          />
        ) : status === "completed" || status === "completed_with_warnings" || status === "partial_external_blocker" ? (
          <CheckCircle2 className="h-4 w-4 text-teal shrink-0" />
        ) : (
          <XCircle className="h-4 w-4 text-red-400 shrink-0" />
        )}
        <span className="text-xs text-muted-foreground truncate flex-1 dark:text-ink-secondary-dark">
          {currentMessage}
        </span>
        <span className="text-xs font-mono text-teal tabular-nums shrink-0">
          {formatElapsed(elapsedTime)}
        </span>
      </button>
    );
  }

  return (
    <div className="p-4 space-y-3" data-testid="scrape-progress-panel">
      <div className="flex items-start justify-between gap-2">
        <div className="space-y-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {!isTerminal ? (
              <div className="h-4 w-4 shrink-0 rounded-full border-2 border-teal border-t-transparent animate-spin" />
            ) : status === "completed" || status === "completed_with_warnings" || status === "partial_external_blocker" ? (
              <CheckCircle2 className="h-4 w-4 text-teal shrink-0" />
            ) : (
              <XCircle className="h-4 w-4 text-red-400 shrink-0" />
            )}
            <h3 className="text-sm font-semibold text-foreground truncate dark:text-ink-primary-dark">
              Portal scrape
            </h3>
            <StatusPill tone={scrapeStatusTone(status)}>
              {scrapeJobStatusLabel(status)}
            </StatusPill>
          </div>
          <p className="text-xs text-muted-foreground dark:text-ink-tertiary-dark">
            Permit{" "}
            <span className="font-medium text-teal">{permitNumber || "—"}</span>
            {" · "}
            {jurisdiction}
          </p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <span className="text-xs font-mono text-teal tabular-nums">
            {formatElapsed(elapsedTime)}
          </span>
          <button
            className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground dark:hover:bg-obsidian-raised dark:text-ink-tertiary-dark dark:hover:text-ink-primary-dark"
            onClick={onMinimize}
            title="Minimize"
            type="button"
          >
            <Minimize2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {reconnecting && !isTerminal && (
        <div className="flex items-center gap-2 text-xs text-amber-200 bg-amber-500/10 border border-amber-500/25 rounded-md px-2 py-1.5">
          <WifiOff className="h-3.5 w-3.5 shrink-0" />
          Reconnecting to live progress…
        </div>
      )}

      {isStale && !isTerminal && (
        <div className="flex items-center gap-2 text-xs text-amber-200 bg-amber-500/10 border border-amber-500/25 rounded-md px-2 py-1.5">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          Still working… The portal may be on a slow step.
        </div>
      )}

      <div className="rounded-md bg-muted/50 border border-teal/15 px-3 py-2 dark:bg-obsidian-raised/60">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1 dark:text-ink-tertiary-dark">
          Current activity
        </p>
        <p className="text-sm text-foreground leading-snug dark:text-ink-primary-dark">{currentMessage}</p>
        {lastActivityAt && (
          <p className="text-[10px] text-muted-foreground mt-1 dark:text-ink-tertiary-dark">
            Last activity {format(new Date(lastActivityAt), "MMM d, h:mm:ss a")}
          </p>
        )}
      </div>

      {progressPct != null && (
        <div className="space-y-1">
          <div className="flex justify-between text-[10px] text-muted-foreground dark:text-ink-tertiary-dark">
            <span>Progress</span>
            <span>
              {progress!.current} / {progress!.total} ({progressPct}%)
            </span>
          </div>
          <ProgressLine value={progressPct} className="h-1.5" />
        </div>
      )}

      <div className="border border-teal/15 rounded-md overflow-hidden">
        <button
          type="button"
          className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-muted/50 dark:text-ink-secondary-dark dark:hover:bg-obsidian-raised/50"
          onClick={() => setFeedExpanded((v) => !v)}
        >
          <span>Activity feed ({meaningfulEvents.length})</span>
          {feedExpanded ? (
            <ChevronUp className="h-3.5 w-3.5" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5" />
          )}
        </button>
        {feedExpanded && (
          <div className="px-3 pb-3 border-t border-teal/10">
            <EventFeed events={meaningfulEvents} autoScroll={!isTerminal} />
          </div>
        )}
      </div>

      {technicalEvents.length > 0 && (
        <div>
          <button
            type="button"
            className="text-[10px] text-ink-tertiary-dark hover:text-ink-secondary-dark underline"
            onClick={() => setShowTechnical((v) => !v)}
          >
            {showTechnical ? "Hide" : "Show"} technical details
          </button>
          {showTechnical && (
            <div className="mt-1 max-h-24 overflow-y-auto text-[10px] font-mono text-ink-tertiary-dark space-y-1">
              {technicalEvents.slice(-8).map((e) => (
                <p key={e.id}>{e.technical_message}</p>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="flex gap-2 pt-1">
        {!isTerminal && isCancellable && onCancel && (
          <Button
            size="sm"
            variant="destructive"
            className="flex-1 h-8 text-xs"
            onClick={onCancel}
            disabled={cancelling}
            data-testid="button-cancel-scrape"
          >
            {cancelling ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
            ) : (
              <XCircle className="h-3.5 w-3.5 mr-1" />
            )}
            Cancel
          </Button>
        )}
        {isTerminal && onDismiss && (
          <Button
            size="sm"
            variant="outline"
            className="flex-1 h-8 text-xs border-border dark:border-obsidian-raised"
            onClick={onDismiss}
            data-testid="button-dismiss-scrape"
          >
            Dismiss
          </Button>
        )}
        {!isTerminal && (
          <Button
            size="sm"
            variant="outline"
            className="h-8 text-xs border-border dark:border-obsidian-raised"
            onClick={onMinimize}
          >
            <Minimize2 className="h-3.5 w-3.5 mr-1" />
            Minimize
          </Button>
        )}
      </div>
    </div>
  );
}
