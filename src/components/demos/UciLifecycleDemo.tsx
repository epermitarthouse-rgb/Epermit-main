import { useEffect, useMemo, useState } from "react";
import { FlaskConical, Pause, Play, RotateCcw, SkipBack, SkipForward } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RecordLifecycleProgressRail } from "@/components/uci/RecordLifecycleProgressRail";
import { UciStageHistoryPanel } from "@/components/uci/UciStageHistoryPanel";
import { formatUciLifecycleStateLabel, getLifecycleStageTitle } from "@/lib/uciWorkspaceGuidance";
import { UciDemoStageWorkspace } from "./uci/UciDemoStageWorkspaces";
import {
  buildUciDemoSnapshot,
  clampUciDemoStep,
  UCI_DEMO_LABEL,
  UCI_DEMO_PROJECT,
  UCI_DEMO_PROVIDER,
  UCI_DEMO_STEP_COUNT,
  UCI_DEMO_TRANSITIONS,
  uciDemoStepForStage,
} from "./uci/uciDemoScenario";

const LAST_STEP = UCI_DEMO_STEP_COUNT - 1;
const PLAY_INTERVAL_MS = 1600;

export function UciLifecycleDemo() {
  const [step, setStep] = useState(LAST_STEP);
  const [playing, setPlaying] = useState(false);
  const [selectedStage, setSelectedStage] = useState(1);
  const snapshot = useMemo(() => buildUciDemoSnapshot(step), [step]);
  const record = snapshot.detail.record;
  const latest = UCI_DEMO_TRANSITIONS[snapshot.step];

  useEffect(() => {
    if (!playing) return;
    if (step >= LAST_STEP) {
      setPlaying(false);
      return;
    }
    const timer = window.setTimeout(() => {
      const next = clampUciDemoStep(step + 1);
      setStep(next);
      setSelectedStage(UCI_DEMO_TRANSITIONS[next].to_stage);
    }, PLAY_INTERVAL_MS);
    return () => window.clearTimeout(timer);
  }, [playing, step]);

  const goToStep = (next: number) => {
    const clamped = clampUciDemoStep(next);
    setPlaying(false);
    setStep(clamped);
    setSelectedStage(UCI_DEMO_TRANSITIONS[clamped].to_stage);
  };

  const startPlayback = () => {
    if (step >= LAST_STEP) {
      setStep(0);
      setSelectedStage(1);
    }
    setPlaying(true);
  };

  const scrollToWorkspace = () => {
    window.setTimeout(() => {
      document.getElementById("uci-demo-workspace")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
  };

  return (
    <div className="space-y-6" data-testid="uci-lifecycle-demo">
      <div
        className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200"
        data-testid="uci-demo-simulation-label"
      >
        <FlaskConical className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          <strong>{UCI_DEMO_LABEL}.</strong> Names, references, dates, and amounts are illustrative.
        </span>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <div className="rounded-xl border border-border/70 bg-card p-4">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Sample project</p>
          <h3 className="font-display text-xl tracking-tight text-foreground">{UCI_DEMO_PROJECT.name}</h3>
          <p className="text-sm text-muted-foreground">{UCI_DEMO_PROJECT.address}</p>
          <p className="mt-1 text-sm text-foreground">
            {UCI_DEMO_PROJECT.scope} · {UCI_DEMO_PROVIDER}
          </p>
          <div className="mt-4 space-y-2">
            <p className="text-xs font-medium text-foreground">
              Stage {record.current_stage} · {getLifecycleStageTitle(record.current_stage)} ·{" "}
              {formatUciLifecycleStateLabel(record.current_stage_state)}
            </p>
            <RecordLifecycleProgressRail
              currentStage={record.current_stage}
              currentStageState={record.current_stage_state}
            />
          </div>
        </div>

        <div className="rounded-xl border border-border/70 bg-card p-4" data-testid="uci-demo-timeline">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Simulated timeline</p>
          <p className="mt-1 text-sm font-medium text-foreground">
            {formatDemoDate(latest.created_at)} · Step {snapshot.step + 1} of {UCI_DEMO_STEP_COUNT}
          </p>
          <p className="text-xs text-muted-foreground">{latest.reason}</p>
          <input
            type="range"
            min={0}
            max={LAST_STEP}
            value={snapshot.step}
            onChange={(event) => goToStep(Number(event.target.value))}
            className="mt-3 w-full accent-teal"
            aria-label="Simulated timeline position"
            data-testid="uci-demo-timeline-slider"
          />
          <div className="mt-3 flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => goToStep(0)} aria-label="Restart timeline">
              <RotateCcw className="h-4 w-4" />
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => goToStep(snapshot.step - 1)} disabled={snapshot.step <= 0} aria-label="Previous event">
              <SkipBack className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => (playing ? setPlaying(false) : startPlayback())}
              data-testid="uci-demo-play"
            >
              {playing ? <Pause className="mr-1 h-4 w-4" /> : <Play className="mr-1 h-4 w-4" />}
              {playing ? "Pause" : snapshot.step >= LAST_STEP ? "Replay lifecycle" : "Play"}
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => goToStep(snapshot.step + 1)} disabled={snapshot.step >= LAST_STEP} aria-label="Next event">
              <SkipForward className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      <UciStageHistoryPanel
        detail={snapshot.detail}
        providerName={UCI_DEMO_PROVIDER}
        selectedStage={selectedStage}
        onSelectStage={(stage) => setSelectedStage(Math.max(1, Math.min(10, stage)))}
        onOpenTools={scrollToWorkspace}
        preloaded={{ documents: snapshot.documents, communications: snapshot.communications }}
      />

      <UciDemoStageWorkspace
        stage={selectedStage}
        facts={snapshot.facts}
        reached={selectedStage <= record.current_stage}
        onJumpToStage={(stage) => {
          goToStep(uciDemoStepForStage(stage));
          setSelectedStage(stage);
        }}
      />
    </div>
  );
}

function formatDemoDate(value: string): string {
  return new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}
