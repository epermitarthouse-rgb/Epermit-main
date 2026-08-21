import { Check, Lock } from "lucide-react";
import { UCI_LIFECYCLE_STAGES } from "@/lib/uciLifecycleMatrix";
import {
  formatUciLifecycleStateLabel,
  getLifecycleStageTitle,
  getWorkflowGroupProgress,
} from "@/lib/uciWorkspaceGuidance";
import { cn } from "@/lib/utils";

type RecordLifecycleProgressRailProps = {
  currentStage: number;
  currentStageState?: string;
  className?: string;
};

/**
 * Compact per-record lifecycle rail derived from current_stage only.
 * Reuses getWorkflowGroupProgress — same rules as WorkflowStageNavigator.
 */
export function RecordLifecycleProgressRail({
  currentStage,
  currentStageState,
  className,
}: RecordLifecycleProgressRailProps) {
  const stage = Math.max(1, Math.min(10, Number(currentStage) || 1));

  return (
    <div
      className={cn("flex flex-wrap items-center gap-0.5", className)}
      data-testid="record-lifecycle-progress-rail"
      aria-label={`Lifecycle progress: currently at stage ${stage}`}
    >
      {UCI_LIFECYCLE_STAGES.map((s) => {
        const progress = getWorkflowGroupProgress([s, s], stage, currentStageState);
        const isCurrent = progress === "current";
        const isCompleted = progress === "completed";
        const isLocked = progress === "upcoming";
        const stateLabel = isCurrent ? formatUciLifecycleStateLabel(currentStageState) : null;

        return (
          <div
            key={s}
            title={`Stage ${s}: ${getLifecycleStageTitle(s)}${
              isCurrent && stateLabel ? ` · ${stateLabel}` : isCompleted ? " · Completed" : " · Locked"
            }`}
            className={cn(
              "flex h-6 min-w-[1.35rem] items-center justify-center rounded border text-[9px] font-semibold",
              isCompleted && "border-success/30 bg-success/10 text-success",
              isCurrent && "border-teal/50 bg-teal/15 text-teal ring-1 ring-teal/25",
              isLocked && "border-border/50 bg-muted/20 text-muted-foreground opacity-70",
            )}
            data-testid={`lifecycle-stage-${s}`}
            data-progress={progress}
          >
            {isCompleted ? (
              <Check className="h-3 w-3" strokeWidth={2.5} aria-hidden />
            ) : isLocked ? (
              <Lock className="h-2.5 w-2.5" aria-hidden />
            ) : (
              s
            )}
          </div>
        );
      })}
    </div>
  );
}
