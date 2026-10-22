import { useEffect, useId, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Pause, Play, RotateCcw, Square, Volume2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  UCI_DEMO_GUIDE_CHAPTERS,
  UCI_DEMO_GUIDE_FRAMING,
  UCI_DEMO_STAGE_COUNT,
  formatUciDemoOrientation,
  getUciDemoStageGuide,
  previousUciDemoGuideStage,
  restartUciDemoGuideStage,
  uciDemoGuidePrimaryAction,
} from "./uciDemoGuidance";
import {
  browserNarrationSupport,
  createBrowserNarration,
  type UciDemoNarrationController,
  type UciDemoNarrationStatus,
} from "./uciDemoNarration";

type UciDemoGuidedTourProps = {
  stage: number;
  timelineNote: string;
  onGoToStage: (stage: number) => void;
  onNarrationStart?: () => void;
};

export function UciDemoGuidedTour({ stage, timelineNote, onGoToStage, onNarrationStart }: UciDemoGuidedTourProps) {
  const guide = getUciDemoStageGuide(stage);
  const previous = previousUciDemoGuideStage(guide.stage);
  const primary = uciDemoGuidePrimaryAction(guide.stage);
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const narrationRef = useRef<UciDemoNarrationController | null>(null);
  const [tourActive, setTourActive] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [narrationStatus, setNarrationStatus] = useState<UciDemoNarrationStatus>(() =>
    browserNarrationSupport() ? "idle" : "unsupported",
  );

  const ensureNarration = () => {
    if (!narrationRef.current) {
      narrationRef.current = createBrowserNarration(setNarrationStatus);
    }
    return narrationRef.current;
  };

  useEffect(() => {
    if (!narrationRef.current) {
      narrationRef.current = createBrowserNarration(setNarrationStatus);
    }
    return () => {
      narrationRef.current?.stop();
      narrationRef.current = null;
    };
  }, []);

  useEffect(() => {
    // Cancel narration when the stage changes or the tour unmounts. Never start speech here.
    narrationRef.current?.stop();
    return () => {
      narrationRef.current?.stop();
    };
  }, [stage]);

  const focusHeading = () => {
    window.requestAnimationFrame(() => headingRef.current?.focus());
  };

  const scrollToId = (id: string) => {
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    document.getElementById(id)?.scrollIntoView({
      behavior: reduce ? "auto" : "smooth",
      block: "start",
    });
  };

  const scrollGuideIntoView = () => scrollToId("uci-demo-guided-tour");
  const scrollWorkspaceIntoView = () => scrollToId("uci-demo-workspace");

  const goToStage = (nextStage: number) => {
    const next = getUciDemoStageGuide(nextStage);
    setTourActive(true);
    ensureNarration().stop();
    setAnnouncement(`Stage ${next.stage} of ${UCI_DEMO_STAGE_COUNT}, ${next.title}. ${next.transition}`);
    onGoToStage(next.stage);
    focusHeading();
    scrollGuideIntoView();
  };

  const exitTour = () => {
    setTourActive(false);
    ensureNarration().stop();
    setAnnouncement("Guided tour off. You can keep exploring from the current stage.");
  };

  const playNarration = () => {
    onNarrationStart?.();
    const narration = ensureNarration();
    if (narration.status() === "paused") {
      narration.resume();
      return;
    }
    narration.play(guide.narration);
  };

  const pauseNarration = () => ensureNarration().pause();
  const stopNarration = () => ensureNarration().stop();
  const narrationSupported = narrationStatus !== "unsupported";
  const narrationStatusText =
    narrationStatus === "playing"
      ? "Narration is playing."
      : narrationStatus === "paused"
        ? "Narration is paused."
        : "Narration is off. Audio starts only when you press Play narration.";

  return (
    <section
      id="uci-demo-guided-tour"
      aria-labelledby={headingId}
      data-testid="uci-demo-guided-tour"
      data-tour-active={tourActive ? "true" : "false"}
      data-orientation={formatUciDemoOrientation(guide.stage)}
      className={cn(
        "scroll-mt-20 space-y-4 rounded-xl border border-teal/40 bg-card p-4 shadow-sm",
        tourActive && "ring-2 ring-teal/30",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-teal">
            {tourActive ? "Guided tour" : "Guided walkthrough"} · simulated
          </p>
          <p className="text-sm font-semibold text-foreground" data-testid="uci-demo-stage-orientation">
            Stage {guide.stage} of {UCI_DEMO_STAGE_COUNT}
          </p>
          <h2
            id={headingId}
            ref={headingRef}
            tabIndex={-1}
            className="font-display text-2xl tracking-tight text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {guide.title}
          </h2>
        </div>
        <p
          className="max-w-sm rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200"
          data-testid="uci-demo-guide-framing"
        >
          {UCI_DEMO_GUIDE_FRAMING}
        </p>
      </div>

      <div
        role="progressbar"
        aria-valuemin={1}
        aria-valuemax={UCI_DEMO_STAGE_COUNT}
        aria-valuenow={guide.stage}
        aria-valuetext={formatUciDemoOrientation(guide.stage)}
        aria-label="Walkthrough progress"
        className="h-2 overflow-hidden rounded-full bg-muted"
      >
        <div className="h-full bg-teal transition-all" style={{ width: `${(guide.stage / UCI_DEMO_STAGE_COUNT) * 100}%` }} />
      </div>

      <ol className="flex flex-wrap gap-2" aria-label="Where you are in the story">
        {UCI_DEMO_GUIDE_CHAPTERS.map((chapter) => {
          const current = chapter.index === guide.chapterIndex;
          return (
            <li
              key={chapter.index}
              aria-current={current ? "step" : undefined}
              className={cn(
                "rounded-full border px-2.5 py-1 text-xs",
                current ? "border-teal bg-teal/10 font-semibold text-foreground" : "border-border text-muted-foreground",
              )}
            >
              Part {chapter.index} of 3 · {chapter.name}
            </li>
          );
        })}
      </ol>

      <div className="space-y-1" data-testid="uci-demo-flow-context">
        <p className="text-sm text-muted-foreground">{guide.chapterSummary}</p>
        <p className="text-sm text-foreground">{guide.whereYouAre}</p>
        <p className="text-sm text-muted-foreground">{timelineNote}</p>
      </div>

      <dl className="grid gap-3 md:grid-cols-3">
        <GuidePoint term="Why this stage matters" detail={guide.outcome} />
        <GuidePoint term="What the platform does" detail={guide.platform} />
        <GuidePoint
          term={guide.stage === UCI_DEMO_STAGE_COUNT ? "What completes closeout" : "What allows the next stage"}
          detail={guide.progression}
        />
      </dl>

      <p className="rounded-lg bg-muted/50 px-3 py-2 text-sm font-medium text-foreground" data-testid="uci-demo-stage-transition">
        {guide.transition}
      </p>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Guided tour controls">
        {tourActive ? (
          <Button type="button" variant="outline" onClick={exitTour}>
            Exit guided tour
          </Button>
        ) : (
          <Button type="button" onClick={() => goToStage(restartUciDemoGuideStage())} data-testid="uci-demo-start-tour">
            Start guided tour
          </Button>
        )}
        <Button
          type="button"
          variant="outline"
          onClick={() => previous && goToStage(previous)}
          disabled={previous == null}
          aria-label={previous ? `Previous stage, Stage ${previous}` : "Previous stage"}
          data-testid="uci-demo-tour-previous"
        >
          <ChevronLeft className="h-4 w-4" />
          Previous
        </Button>
        {primary.action === "next" ? (
          <Button type="button" onClick={() => goToStage(primary.stage)} aria-label={primary.ariaLabel} data-testid="uci-demo-tour-next">
            {primary.label}
            <ChevronRight className="h-4 w-4" />
          </Button>
        ) : (
          <Button type="button" onClick={() => goToStage(primary.stage)} aria-label={primary.ariaLabel} data-testid="uci-demo-tour-restart">
            <RotateCcw className="h-4 w-4" />
            {primary.label}
          </Button>
        )}
        <Button type="button" variant="ghost" onClick={scrollWorkspaceIntoView} aria-label={`Show the simulated workspace for Stage ${guide.stage}`}>
          Show this stage’s workspace
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Optional narration">
        {narrationSupported ? (
          <>
            {narrationStatus === "playing" ? (
              <Button type="button" variant="outline" onClick={pauseNarration} aria-pressed="true" aria-label="Pause narration" data-testid="uci-demo-pause-narration">
                <Pause className="h-4 w-4" />
                Pause narration
              </Button>
            ) : (
              <Button
                type="button"
                variant="outline"
                onClick={playNarration}
                aria-pressed="false"
                data-testid={narrationStatus === "paused" ? "uci-demo-resume-narration" : "uci-demo-play-narration"}
              >
                {narrationStatus === "paused" ? <Play className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
                {narrationStatus === "paused" ? "Resume narration" : "Play narration"}
              </Button>
            )}
            {narrationStatus === "playing" || narrationStatus === "paused" ? (
              <Button type="button" variant="outline" onClick={stopNarration} aria-label="Stop narration" data-testid="uci-demo-stop-narration">
                <Square className="h-4 w-4" />
                Stop narration
              </Button>
            ) : null}
            <p className="text-sm text-muted-foreground" role="status" aria-live="polite" data-testid="uci-demo-narration-status">
              {narrationStatusText} Narration uses this browser’s voice. It is not sent to a service.
            </p>
          </>
        ) : (
          <p className="text-sm text-muted-foreground" data-testid="uci-demo-narration-unsupported">
            Spoken narration is not available in this browser. Read the guide above — it covers the same points. No voice service is contacted.
          </p>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        The stage cards below stay available, so you can leave this path and open any stage. Nothing in this demo contacts a utility.
      </p>
      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>
    </section>
  );
}

function GuidePoint({ term, detail }: { term: string; detail: string }) {
  return (
    <div className="rounded-lg border border-border/70 bg-background p-3">
      <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{term}</dt>
      <dd className="mt-1 text-sm leading-6 text-foreground">{detail}</dd>
    </div>
  );
}
