import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { MockReimbursable, MockTask } from "@/lib/operations/operations-types";
import { DataSourceBadge } from "./DataSourceBadge";
import type { DataSourceKind } from "@/lib/operations/operations-types";

export const statusStyles: Record<MockTask["status"], string> = {
  Done: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
  Working: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30",
  Stuck: "bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/30",
  "Not Started": "bg-muted/40 text-muted-foreground border-border",
};

export const invoiceStyles: Record<MockReimbursable["invoiced"], string> = {
  Invoiced: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
  Pending: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30",
  "Paid by GC": "bg-violet-500/15 text-violet-700 dark:text-violet-300 border-violet-500/30",
};

export function ProgressBar({ value }: { value: number }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            "h-full rounded-full",
            value >= 100 ? "bg-emerald-500" : value > 0 ? "bg-amber-500" : "bg-muted",
          )}
          style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
        />
      </div>
      <span className="w-9 text-right font-mono text-[11px] text-muted-foreground">{value}%</span>
    </div>
  );
}

export function SectionShell({
  title,
  accentClass,
  source,
  sourceDetail,
  children,
  actions,
}: {
  title: string;
  accentClass: string;
  source: DataSourceKind;
  sourceDetail?: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div
        className={cn(
          "flex flex-wrap items-center gap-2 border-b border-border bg-muted/40 px-4 py-2 text-xs font-semibold uppercase tracking-wider",
          accentClass,
        )}
      >
        <span>{title}</span>
        <DataSourceBadge kind={source} detail={sourceDetail} />
        {actions ? <div className="ml-auto flex items-center gap-2 normal-case tracking-normal">{actions}</div> : null}
      </div>
      {children}
    </div>
  );
}
