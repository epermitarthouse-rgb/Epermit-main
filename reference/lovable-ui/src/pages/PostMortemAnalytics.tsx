import { Activity, ArrowLeft, CheckCircle2, Cpu, Download, GitBranch, Landmark, TrendingDown, Zap } from "lucide-react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";

type Stage = {
  name: string;
  plannedStart: number;
  plannedWidth: number;
  actualStart: number;
  actualWidth: number;
  deltaDays: number;
  tone: "success" | "destructive" | "warning";
};

const stages: Stage[] = [
  { name: "Site Prep", plannedStart: 0, plannedWidth: 20, actualStart: 0, actualWidth: 18, deltaDays: -2, tone: "success" },
  { name: "Foundation", plannedStart: 20, plannedWidth: 15, actualStart: 18, actualWidth: 20, deltaDays: 5, tone: "destructive" },
  { name: "Transformer Install", plannedStart: 35, plannedWidth: 30, actualStart: 38, actualWidth: 25, deltaDays: -4, tone: "success" },
  { name: "Commissioning", plannedStart: 65, plannedWidth: 20, actualStart: 63, actualWidth: 22, deltaDays: 2, tone: "warning" },
  { name: "Energize & Closeout", plannedStart: 85, plannedWidth: 15, actualStart: 85, actualWidth: 12, deltaDays: -3, tone: "success" },
];

const toneText: Record<Stage["tone"], string> = {
  success: "text-success",
  destructive: "text-destructive",
  warning: "text-warning",
};

const insightNodes = [
  {
    id: "ward6",
    label: "WARD 6 TREND",
    body: "Transformer lead times trending 15% lower.",
    icon: Zap,
    style: { top: "18%", left: "10%" },
    accent: "text-primary",
    ring: "border-primary/40 bg-primary/10",
  },
  {
    id: "cityhall",
    label: "CITY HALL",
    body: "New expedited review path validated.",
    icon: Landmark,
    style: { top: "12%", right: "10%" },
    accent: "text-pilot-teal",
    ring: "border-pilot-teal/40 bg-pilot-teal/10",
  },
  {
    id: "agent",
    label: "AGENT LOOP",
    body: "DesignCheck pre-empted 9 review cycles.",
    icon: Cpu,
    style: { bottom: "12%", left: "18%" },
    accent: "text-success",
    ring: "border-success/40 bg-success/10",
  },
];

const PostMortemAnalytics = () => {
  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <Link to="/closeout/post-mortem" className="pilot-kicker inline-flex items-center gap-1 text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-3 w-3" />
            Back to Post-Mortem
          </Link>
          <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight">Post-Mortem Performance Analytics</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Final performance metrics and system intelligence updates · North Main Substation Closeout.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded border border-success/30 bg-success/10 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-success">
            <CheckCircle2 className="h-3.5 w-3.5" /> Project Closed
          </span>
          <span className="font-data text-xs text-muted-foreground">ID: COMBUILD-1140088</span>
          <button className="pilot-button-secondary text-xs">
            <Download className="h-3.5 w-3.5" />
            Export
          </button>
        </div>
      </header>

      <div className="grid gap-6 md:grid-cols-12">
        <section className="pilot-card relative overflow-hidden p-5 md:col-span-8">
          <div className="pointer-events-none absolute right-0 top-0 h-32 w-32 rounded-bl-[100px] bg-primary/5" />
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Activity className="h-5 w-5 text-primary" />
              <h2 className="font-tight text-lg font-bold">Timeline Performance</h2>
            </div>
            <div className="flex items-center gap-3 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span className="h-3 w-3 rounded-sm border border-border bg-muted" />
                Planned
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-3 w-3 rounded-sm bg-primary" />
                Actual
              </span>
            </div>
          </div>

          <div className="mt-6 space-y-4">
            {stages.map((s) => (
              <div key={s.name} className="grid grid-cols-[140px_1fr_72px] items-center gap-3 text-sm">
                <span className="truncate text-muted-foreground">{s.name}</span>
                <div className="relative h-6 overflow-hidden rounded-full bg-muted/40">
                  <div
                    className="absolute top-0 h-full rounded-full border border-border bg-muted"
                    style={{ left: `${s.plannedStart}%`, width: `${s.plannedWidth}%` }}
                  />
                  <div
                    className="absolute top-1 h-4 rounded-full bg-primary shadow-sm"
                    style={{ left: `${s.actualStart}%`, width: `${s.actualWidth}%` }}
                  />
                </div>
                <span className={cn("text-right font-data text-xs", toneText[s.tone])}>
                  {s.deltaDays > 0 ? "+" : ""}
                  {s.deltaDays} d
                </span>
              </div>
            ))}
          </div>

          <div className="mt-6 grid grid-cols-3 gap-3 border-t border-border pt-4 text-xs">
            <Stat label="Days saved" value="9" tone="success" />
            <Stat label="Days lost" value="7" tone="destructive" />
            <Stat label="Net schedule" value="−2 days" tone="success" />
          </div>
        </section>

        <section className="pilot-card relative flex flex-col overflow-hidden p-5 md:col-span-4">
          <div className="pointer-events-none absolute right-0 top-0 h-32 w-32 rounded-bl-[100px] bg-pilot-teal/5" />
          <h3 className="font-tight text-lg font-bold">CIAC Cost Variance</h3>
          <div className="flex flex-1 flex-col items-center justify-center py-6">
            <span className="font-display text-5xl font-semibold leading-none text-primary">−$12.4k</span>
            <span className="mt-2 inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-success">
              <TrendingDown className="h-3.5 w-3.5" /> Under Budget
            </span>
          </div>
          <div className="mt-auto flex justify-between border-t border-border pt-4">
            <div>
              <div className="pilot-kicker text-muted-foreground">Estimated</div>
              <div className="font-data text-sm">$145,000</div>
            </div>
            <div className="text-right">
              <div className="pilot-kicker text-muted-foreground">Actual</div>
              <div className="font-data text-sm">$132,600</div>
            </div>
          </div>
        </section>

        <section className="pilot-card p-5 md:col-span-12">
          <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
            <div>
              <h3 className="flex items-center gap-2 font-tight text-lg font-bold">
                <GitBranch className="h-5 w-5 text-primary" />
                Institutional Memory Updates
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Insights extracted and fed back into PermitPilot's planning models.
              </p>
            </div>
            <span className="pilot-kicker text-pilot-teal">3 nodes committed</span>
          </div>

          <div className="relative mt-4 h-72 overflow-hidden rounded-lg border border-border bg-muted/20">
            <svg className="pointer-events-none absolute inset-0 h-full w-full opacity-30">
              <line x1="22%" y1="32%" x2="50%" y2="50%" stroke="hsl(var(--primary))" strokeWidth="2" strokeDasharray="4" />
              <line x1="78%" y1="26%" x2="50%" y2="50%" stroke="hsl(var(--pilot-teal))" strokeWidth="2" />
              <line x1="30%" y1="80%" x2="50%" y2="50%" stroke="hsl(var(--success))" strokeWidth="2" />
            </svg>

            {insightNodes.map((n) => {
              const Icon = n.icon;
              return (
                <div key={n.id} className="absolute flex w-40 flex-col items-center" style={n.style}>
                  <div className={cn("flex h-12 w-12 items-center justify-center rounded-full border-2 shadow-sm", n.ring)}>
                    <Icon className={cn("h-5 w-5", n.accent)} />
                  </div>
                  <div className="mt-2 w-full rounded-md border border-border bg-card p-2 text-center shadow-sm">
                    <div className={cn("pilot-kicker", n.accent)}>{n.label}</div>
                    <div className="mt-1 text-[11px] leading-tight text-foreground">{n.body}</div>
                  </div>
                </div>
              );
            })}

            <div className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-full border-2 border-primary bg-primary/15">
                <Cpu className="h-7 w-7 text-primary" />
              </div>
              <span className="mt-2 rounded bg-card px-2 py-0.5 font-data text-[10px] uppercase tracking-wider text-foreground">
                Project Model
              </span>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};

const Stat = ({ label, value, tone }: { label: string; value: string; tone: "success" | "destructive" | "warning" }) => (
  <div className="rounded-md border border-border bg-muted/30 p-3">
    <div className="pilot-kicker text-muted-foreground">{label}</div>
    <div className={cn("mt-1 font-data text-base font-bold", toneText[tone])}>{value}</div>
  </div>
);

export default PostMortemAnalytics;