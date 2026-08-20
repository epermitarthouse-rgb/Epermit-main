import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import {
  describeCoordinationStatus,
  formatConservativeP90Chip,
  formatTypicalP50Chip,
  formatUciLifecycleStateLabel,
  getLifecycleStageTitle,
} from "@/lib/uciWorkspaceGuidance";
import { cn } from "@/lib/utils";
import type { CoordinationRecord, LifecycleState } from "@/types/uci";

type CoordinationStatusSummaryProps = {
  record: CoordinationRecord;
  mutedClass: string;
  stateBadgeClassName: (state: string | undefined) => string;
  formatDateOnly: (iso: string | null | undefined) => string;
  className?: string;
};

function StatusTile({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "min-w-0 rounded-lg border border-border/60 bg-background/70 px-3 py-2.5",
        "dark:border-teal/20 dark:bg-muted/25",
        className,
      )}
    >
      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </p>
      <div className="mt-1">{children}</div>
    </div>
  );
}

/**
 * Readable Stage / State / milestone tiles for the record workspace chrome.
 * Values come only from the coordination record — no fake completion.
 */
export function CoordinationStatusSummary({
  record,
  mutedClass,
  stateBadgeClassName,
  formatDateOnly,
  className,
}: CoordinationStatusSummaryProps) {
  const stage = Number(record.current_stage);
  const state = record.current_stage_state as LifecycleState | undefined;
  const statusSentence = describeCoordinationStatus({
    stage,
    state,
    acknowledgmentReceivedAt: record.acknowledgment_received_at,
  });

  const milestoneChips = [
    record.application_submitted_at
      ? { key: "submitted", label: `Submitted ${formatDateOnly(record.application_submitted_at)}` }
      : null,
    record.acknowledgment_received_at
      ? {
          key: "acked",
          label: `Acknowledged ${formatDateOnly(record.acknowledgment_received_at)}`,
        }
      : null,
    record.class_of_service_issued_at
      ? { key: "cos", label: `COS ${formatDateOnly(record.class_of_service_issued_at)}` }
      : null,
    record.energization_target_date
      ? {
          key: "energize-target",
          label: `Energization target ${formatDateOnly(record.energization_target_date)}`,
        }
      : null,
    record.energization_actual_date
      ? {
          key: "energize-actual",
          label: `Energized ${formatDateOnly(record.energization_actual_date)}`,
        }
      : null,
    (() => {
      const label = formatTypicalP50Chip(record, formatDateOnly);
      return label ? { key: "p50", label } : null;
    })(),
    (() => {
      const label = formatConservativeP90Chip(record, formatDateOnly);
      return label ? { key: "p90", label } : null;
    })(),
  ].filter(Boolean) as Array<{ key: string; label: string }>;

  return (
    <section
      className={cn("space-y-3", className)}
      data-testid="uci-coordination-status-summary"
      aria-label="Coordination status"
    >
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="font-display text-base tracking-tight text-foreground">Coordination status</h3>
        <p className={cn("hidden text-[11px] sm:block", mutedClass)}>From record · not estimated</p>
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        <StatusTile label="Stage" className="sm:col-span-1">
          <div className="flex items-baseline gap-2">
            <span className="font-data text-2xl font-semibold tabular-nums text-teal">{stage}</span>
            <span className="min-w-0 truncate text-sm font-medium text-foreground">
              {getLifecycleStageTitle(stage)}
            </span>
          </div>
        </StatusTile>
        <StatusTile label="State">
          <Badge
            className={cn(
              "mt-0.5 rounded-md px-2 py-0.5 text-[11px] font-semibold",
              stateBadgeClassName(state),
            )}
          >
            {formatUciLifecycleStateLabel(state)}
          </Badge>
        </StatusTile>
        <StatusTile label="Acknowledged">
          <p className="text-sm font-medium text-foreground">
            {record.acknowledgment_received_at
              ? formatDateOnly(record.acknowledgment_received_at)
              : "Not yet"}
          </p>
        </StatusTile>
      </div>

      <p className="text-sm leading-relaxed text-foreground">{statusSentence}</p>

      {milestoneChips.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {milestoneChips.map((chip) => (
            <Badge
              key={chip.key}
              variant="secondary"
              className="rounded-md border border-border/50 bg-muted/40 text-[10px] font-medium text-foreground"
            >
              {chip.label}
            </Badge>
          ))}
        </div>
      ) : null}

      {record.last_error ? (
        <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          <span className="font-semibold">Last error:</span> {record.last_error}
        </p>
      ) : null}
    </section>
  );
}
