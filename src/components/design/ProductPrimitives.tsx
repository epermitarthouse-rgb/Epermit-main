import type { LucideIcon } from "lucide-react";
import { ArrowUpRight } from "lucide-react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";

export type StatusTone = "default" | "good" | "warn" | "bad" | "info";

const toneClasses: Record<StatusTone, string> = {
  default: "border-border/60 bg-muted/40 text-muted-foreground",
  good: "border-success/30 bg-success/10 text-success",
  warn: "border-warning/30 bg-warning/10 text-warning",
  bad: "border-destructive/30 bg-destructive/10 text-destructive",
  info: "border-[hsl(var(--pilot-cyan)/0.3)] bg-[hsl(var(--pilot-cyan)/0.1)] text-[hsl(var(--pilot-cyan))]",
};

export function PageHeader({
  eyebrow,
  title,
  body,
  action,
  className,
}: {
  eyebrow?: string;
  title: React.ReactNode;
  body?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between", className)}>
      <div className="min-w-0 space-y-1.5">
        {eyebrow ? <p className="pilot-kicker">{eyebrow}</p> : null}
        <h1 className="font-tight text-3xl font-black tracking-tight text-foreground md:text-4xl">{title}</h1>
        {body ? <div className="max-w-2xl text-sm leading-6 text-muted-foreground md:text-base">{body}</div> : null}
      </div>
      {action ? <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div> : null}
    </div>
  );
}

export function StatCard({
  label,
  value,
  icon: Icon,
  hint,
  className,
}: {
  label: string;
  value: React.ReactNode;
  icon?: LucideIcon;
  hint?: string;
  className?: string;
}) {
  return (
    <div className={cn("pilot-card p-5", className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="pilot-kicker">{label}</p>
          <p className="mt-2 font-data text-3xl font-semibold tabular-nums text-foreground">{value}</p>
          {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
        </div>
        {Icon ? (
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
            <Icon className="h-5 w-5" aria-hidden />
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function MetricCard({
  label,
  value,
  icon: Icon,
  className,
}: {
  label: string;
  value: React.ReactNode;
  icon?: LucideIcon;
  className?: string;
}) {
  return (
    <div className={cn("pilot-card-raised p-5", className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="pilot-kicker">{label}</p>
          <p className="mt-2 font-display text-3xl font-semibold tracking-tight text-foreground md:text-4xl">{value}</p>
        </div>
        {Icon ? (
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
            <Icon className="h-5 w-5" aria-hidden />
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function Panel({
  title,
  eyebrow,
  children,
  className,
  action,
}: {
  title?: React.ReactNode;
  eyebrow?: string;
  children: React.ReactNode;
  className?: string;
  action?: React.ReactNode;
}) {
  return (
    <section className={cn("pilot-card p-5", className)}>
      {(title || eyebrow || action) && (
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            {eyebrow ? <p className="pilot-kicker mb-1">{eyebrow}</p> : null}
            {title ? <h2 className="font-tight text-xl font-bold text-foreground">{title}</h2> : null}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function StatusPill({
  tone = "default",
  children,
  className,
}: {
  tone?: StatusTone;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wider",
        toneClasses[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function ProgressLine({ value, className }: { value: number; className?: string }) {
  const clamped = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
  return (
    <div className={cn("h-0.5 w-full overflow-hidden rounded-full bg-[hsl(var(--pilot-line)/0.6)]", className)}>
      <div className="h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${clamped}%` }} />
    </div>
  );
}

export function ProjectLink({ to, children, className }: { to: string; children: React.ReactNode; className?: string }) {
  return (
    <Link
      to={to}
      className={cn(
        "inline-flex items-center gap-1 font-tight text-sm font-semibold text-primary transition-colors hover:text-[hsl(var(--pilot-cyan))]",
        className,
      )}
    >
      {children}
      <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
    </Link>
  );
}

export function ServicePill({
  kind,
  children,
  className,
}: {
  kind: "permit" | "utility";
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wider",
        kind === "permit"
          ? "border-primary/30 bg-primary/10 text-primary"
          : "border-[hsl(var(--pilot-teal)/0.3)] bg-[hsl(var(--pilot-teal)/0.1)] text-[hsl(var(--pilot-teal))]",
        className,
      )}
    >
      {children}
    </span>
  );
}

export function AlertBanner({
  title,
  detail,
  tone = "info",
  className,
}: {
  title: React.ReactNode;
  detail?: React.ReactNode;
  tone?: StatusTone;
  className?: string;
}) {
  return (
    <div className={cn("rounded-lg border px-4 py-3", toneClasses[tone], className)}>
      <p className="font-tight text-sm font-semibold">{title}</p>
      {detail ? <div className="mt-1 text-sm opacity-90">{detail}</div> : null}
    </div>
  );
}
