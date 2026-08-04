import type { ReactNode } from "react";
import { ArrowUpRight, LucideIcon } from "lucide-react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";

export const PageHeader = ({
  eyebrow,
  title,
  body,
  action,
}: {
  eyebrow?: string;
  title: string;
  body?: string;
  action?: ReactNode;
}) => (
  <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
    <div className="max-w-3xl">
      {eyebrow && <div className="pilot-kicker text-primary">{eyebrow}</div>}
      <h1 className="mt-2 font-tight text-3xl font-black tracking-tight text-foreground md:text-4xl">{title}</h1>
      {body && <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground md:text-base">{body}</p>}
    </div>
    {action}
  </div>
);

export const StatCard = ({
  label,
  value,
  delta,
  icon: Icon,
}: {
  label: string;
  value: string;
  delta: string;
  icon: LucideIcon;
}) => (
  <article className="pilot-card p-5">
    <div className="flex items-start justify-between gap-3">
      <div>
        <div className="pilot-kicker">{label}</div>
        <div className="mt-3 font-data text-3xl font-semibold text-foreground">{value}</div>
      </div>
      <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10 text-primary">
        <Icon className="h-5 w-5" />
      </div>
    </div>
    <div className="mt-4 text-xs font-medium text-muted-foreground">{delta}</div>
  </article>
);

export const StatusPill = ({ children, tone = "default" }: { children: ReactNode; tone?: "default" | "good" | "warn" | "bad" | "info" }) => (
  <span
    className={cn(
      "inline-flex items-center rounded-full border px-2.5 py-1 font-data text-[11px] uppercase tracking-wider",
      tone === "default" && "border-border bg-muted text-muted-foreground",
      tone === "good" && "border-success/30 bg-success/10 text-success",
      tone === "warn" && "border-warning/30 bg-warning/10 text-warning",
      tone === "bad" && "border-destructive/30 bg-destructive/10 text-destructive",
      tone === "info" && "border-pilot-cyan/30 bg-pilot-cyan/10 text-pilot-cyan",
    )}
  >
    {children}
  </span>
);

export const Panel = ({
  title,
  eyebrow,
  children,
  className,
}: {
  title?: string;
  eyebrow?: string;
  children: ReactNode;
  className?: string;
}) => (
  <section className={cn("pilot-card p-5", className)}>
    {(title || eyebrow) && (
      <div className="mb-5">
        {eyebrow && <div className="pilot-kicker text-primary">{eyebrow}</div>}
        {title && <h2 className="mt-1 font-tight text-xl font-bold text-foreground">{title}</h2>}
      </div>
    )}
    {children}
  </section>
);

export const ProjectLink = ({ to, children }: { to: string; children: ReactNode }) => (
  <Link to={to} className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary transition-colors hover:text-pilot-cyan">
    {children}
    <ArrowUpRight className="h-3.5 w-3.5" />
  </Link>
);

export const ProgressLine = ({ value }: { value: number }) => (
  <div className="h-2 overflow-hidden rounded-full bg-pilot-line/60">
    <div
      className="h-full rounded-full bg-primary transition-[width] duration-500"
      style={{ width: `${value}%`, boxShadow: "0 0 0 1px hsl(var(--primary) / 0.25)" }}
    />
  </div>
);

export const MetricCard = ({
  label,
  value,
  detail,
  icon: Icon,
}: {
  label: string;
  value: string;
  detail?: string;
  icon?: LucideIcon;
}) => (
  <article className="pilot-card-raised p-5">
    <div className="flex items-start justify-between gap-4">
      <div>
        <div className="pilot-kicker">{label}</div>
        <div className="mt-3 font-display text-4xl font-semibold text-foreground">{value}</div>
        {detail && <p className="mt-2 text-xs text-muted-foreground">{detail}</p>}
      </div>
      {Icon && (
        <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10 text-primary">
          <Icon className="h-5 w-5" />
        </div>
      )}
    </div>
  </article>
);

export const ServicePill = ({ service }: { service: "permit-expediting" | "utility-coordination" }) => (
  <span
    className={cn(
      "inline-flex items-center rounded-full border px-2.5 py-1 font-data text-[10px] uppercase tracking-wider",
      service === "permit-expediting"
        ? "border-primary/30 bg-primary/10 text-primary"
        : "border-pilot-teal/30 bg-pilot-teal/10 text-pilot-teal",
    )}
  >
    {service === "permit-expediting" ? "Permit expediting" : "Utility coordination"}
  </span>
);

export const AlertBanner = ({
  title,
  detail,
  tone = "default",
}: {
  title: string;
  detail: string;
  tone?: "default" | "good" | "warn" | "bad" | "info";
}) => (
  <div
    className={cn(
      "rounded-lg border px-4 py-3",
      tone === "default" && "border-border bg-muted/40 text-foreground",
      tone === "good" && "border-success/35 bg-success/10 text-foreground",
      tone === "warn" && "border-warning/35 bg-warning/10 text-foreground",
      tone === "bad" && "border-destructive/40 bg-destructive/10 text-foreground",
      tone === "info" && "border-pilot-cyan/35 bg-pilot-cyan/10 text-foreground",
    )}
  >
    <div className="font-tight text-sm font-bold">{title}</div>
    <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
  </div>
);