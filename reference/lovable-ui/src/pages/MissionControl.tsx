import {
  AlertTriangle, ArrowRight, Bot, BookOpen, Camera, FileSearch, FolderOpen,
  HardHat, Plus, Quote, Share2, Sparkles, Wrench, Building2, Zap, Clock, TrendingUp,
} from "lucide-react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useActiveProject } from "@/state/activeProject";

const phases = ["Investigation", "Filing", "Coordination", "Closeout"];

const Sparkline = ({ data, labels, className }: { data: number[]; labels: string[]; className?: string }) => {
  const w = 100;
  const h = 24;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const step = data.length > 1 ? w / (data.length - 1) : 0;
  const points = data.map((v, i) => `${(i * step).toFixed(2)},${(h - ((v - min) / range) * h).toFixed(2)}`).join(" ");
  const areaPoints = `0,${h} ${points} ${w},${h}`;
  return (
    <div className="mt-2">
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className={cn("h-6 w-full", className)}>
        <polygon points={areaPoints} fill="currentColor" opacity={0.15} />
        <polyline points={points} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
        {data.map((v, i) => (
          <circle key={i} cx={(i * step).toFixed(2)} cy={(h - ((v - min) / range) * h).toFixed(2)} r={1.5} fill="currentColor" />
        ))}
      </svg>
      <div className="mt-1 flex justify-between font-data text-[8px] uppercase tracking-wider text-muted-foreground">
        {labels.map((l) => <span key={l}>{l}</span>)}
      </div>
    </div>
  );
};

const portfolioStats = [
  { label: "Active Sites", value: "12", sub: "East Coast pilot", icon: Building2, tone: "text-primary", delta: "+4", deltaTone: "text-success", deltaLabel: "vs Q2", filter: "sites" },
  { label: "Transformer-Blocked", value: "3", sub: "PEPCO · BGE · WGL", icon: Zap, tone: "text-destructive", delta: "-2", deltaTone: "text-success", deltaLabel: "vs Q2", filter: "blocked" },
  { label: "P90 Slip", value: "14d", sub: "vs baseline schedule", icon: Clock, tone: "text-warning", delta: "-6d", deltaTone: "text-success", deltaLabel: "vs Q2", spark: [32, 26, 20, 14], sparkLabels: ["Q4'25", "Q1'26", "Q2'26", "Q3'26"], filter: "slip" },
  { label: "On-Track", value: "9/12", sub: "meter-set within 6wks", icon: TrendingUp, tone: "text-success", delta: "+3", deltaTone: "text-success", deltaLabel: "vs Q2", filter: "on-track" },
];

const jurisdictions = [
  { region: "DC",  sites: 3, blocked: 1, utility: "PEPCO / WGL" },
  { region: "MD",  sites: 2, blocked: 1, utility: "BGE" },
  { region: "VA",  sites: 2, blocked: 0, utility: "Dominion" },
  { region: "NC",  sites: 2, blocked: 1, utility: "Duke Energy" },
  { region: "GA",  sites: 2, blocked: 0, utility: "Georgia Power" },
  { region: "FL",  sites: 1, blocked: 0, utility: "FPL" },
];

const entryPoints = [
  {
    icon: FileSearch,
    title: "Executive SIR (ESIR)",
    body: "High-level overview of site readiness and risks. Suitable for inline retail, outparcels, and ground-up builds.",
    cta: "Access Report",
    accent: "bg-pilot-cyan/10 text-pilot-cyan",
  },
  {
    icon: HardHat,
    title: "Technical Workspace",
    body: "Detailed engineering data, utility mapping, and constraint analysis with collaborative markup.",
    cta: "Enter Workspace",
    accent: "bg-primary/10 text-primary",
  },
  {
    icon: BookOpen,
    title: "Documentation Annex",
    body: "Central repository for deeds, permits, prior reports, and historical jurisdictional records.",
    cta: "View Archive",
    accent: "bg-pilot-teal/10 text-pilot-teal",
  },
];

import fieldUtilityMarks from "@/assets/field-utility-marks.jpg";
import fieldTransformer from "@/assets/field-transformer.jpg";
import fieldSiteOverview from "@/assets/field-site-overview.jpg";

const fieldEvidence = [
  {
    name: "Util-Mark-01.jpg",
    tone: "from-pilot-cyan/30 to-primary/20",
    src: fieldUtilityMarks,
    alt: "Spray-painted utility location markings on asphalt",
    caption: "811 utility locates — NE corner",
    capturedAt: "Oct 18, 2025 · 09:42",
  },
  {
    name: "Transformer-A.jpg",
    tone: "from-pilot-teal/30 to-pilot-cyan/20",
    src: fieldTransformer,
    alt: "Pad-mounted electrical transformer at site",
    caption: "Pad-mount transformer A — service entrance",
    capturedAt: "Oct 17, 2025 · 14:08",
  },
  {
    name: "Site-Overview.jpg",
    tone: "from-primary/20 to-pilot-amber/20",
    src: fieldSiteOverview,
    alt: "Aerial overview of graded construction pad",
    caption: "Aerial — rough grade complete",
    capturedAt: "Oct 15, 2025 · 16:51",
  },
];

const MissionControl = () => {
  const { projects: projectsList, activeId, active, setActiveId } = useActiveProject();

  return (
    <div className="space-y-6">
      {/* Page header */}
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="pilot-kicker text-primary">Project Command Center</div>
          <h1 className="mt-2 font-tight text-3xl font-black tracking-tight text-foreground md:text-4xl">Mission Control</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Multi-client orchestration. Switch between active projects to drive Phase 0 investigations through closeout.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="pilot-button-ghost"><Share2 className="h-4 w-4 text-primary" /> Share</button>
          <button className="pilot-button-primary"><Plus className="h-4 w-4" /> New Action</button>
        </div>
      </header>

      {/* Portfolio rollup — McDonald's pilot */}
      <section className="pilot-card relative overflow-hidden">
        <div className="h-1 w-full bg-gradient-to-r from-primary via-pilot-teal to-pilot-cyan" />
        <div className="p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="pilot-kicker text-primary">Portfolio · McDonald's USA</div>
              <h2 className="mt-1 font-tight text-xl font-bold text-foreground">East Coast Rebuild Program — Q3 2026</h2>
              <p className="mt-1 text-xs text-muted-foreground">12-site pilot across DC · MD · VA · NC · GA · FL — utility coordination rollup</p>
            </div>
            <Link
              to="/uci"
              className="inline-flex items-center gap-2 self-start rounded-md border border-primary/30 bg-primary/10 px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-primary transition-colors hover:bg-primary hover:text-primary-foreground"
            >
              Open UCI Hub <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            {portfolioStats.map((s) => (
              <Link
                key={s.label}
                to={`/uci?quarter=Q3-2026&metric=${s.filter}`}
                className="group block rounded-lg border border-border bg-muted/40 p-3 transition-colors hover:border-primary/50 hover:bg-primary/5"
              >
                <div className="flex items-center justify-between">
                  <span className="pilot-kicker">{s.label}</span>
                  <s.icon className={cn("h-3.5 w-3.5", s.tone)} />
                </div>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className={cn("font-data text-2xl font-semibold", s.tone)}>{s.value}</span>
                  <span className={cn("font-data text-[11px] font-semibold", s.deltaTone)}>{s.delta}</span>
                  <span className="font-data text-[9px] uppercase tracking-wider text-muted-foreground">{s.deltaLabel}</span>
                </div>
                <div className="mt-0.5 text-[10px] text-muted-foreground">{s.sub}</div>
                {s.spark && <Sparkline data={s.spark} labels={s.sparkLabels ?? []} className={s.tone} />}
                <div className="mt-2 flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider text-primary opacity-0 transition-opacity group-hover:opacity-100">
                  Drill into UCI <ArrowRight className="h-2.5 w-2.5" />
                </div>
              </Link>
            ))}
          </div>

          {/* Jurisdiction breakdown */}
          <div className="mt-5 rounded-lg border border-border bg-background/60 p-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="pilot-kicker text-primary">Jurisdiction Breakdown</span>
              <span className="font-data text-[10px] uppercase tracking-wider text-muted-foreground">6 states · 12 sites</span>
            </div>
            <div className="grid grid-cols-3 gap-2 md:grid-cols-6">
              {jurisdictions.map((j) => (
                <div key={j.region} className="rounded-md border border-border bg-muted/30 p-2.5">
                  <div className="flex items-baseline justify-between">
                    <span className="font-tight text-sm font-bold text-foreground">{j.region}</span>
                    <span className="font-data text-lg font-semibold text-primary">{j.sites}</span>
                  </div>
                  <div className="mt-1 flex items-center justify-between text-[10px]">
                    <span className="text-muted-foreground">{j.utility}</span>
                    {j.blocked > 0 ? (
                      <span className="font-data font-semibold text-destructive">{j.blocked} blk</span>
                    ) : (
                      <span className="font-data font-semibold text-success">clear</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Multi-client switcher */}
      <section className="pilot-card overflow-hidden p-1">
        <div className="grid gap-1 md:grid-cols-3">
          {projectsList.map((p) => {
            const isActive = p.id === activeId;
            return (
              <button
                key={p.id}
                onClick={() => setActiveId(p.id)}
                className={cn(
                  "rounded-md p-4 text-left transition-colors",
                  isActive ? "bg-primary/10 ring-1 ring-primary/40" : "hover:bg-muted",
                )}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="font-data text-xs text-muted-foreground">{p.id}</span>
                  <span className={cn("text-[10px] font-bold uppercase tracking-wider", isActive ? "text-primary" : "text-muted-foreground")}>
                    {p.client}
                  </span>
                </div>
                <div className="mt-2 font-tight text-sm font-bold text-foreground">{p.name}</div>
                <div className="mt-1 text-xs text-muted-foreground">{p.phase}</div>
              </button>
            );
          })}
        </div>
      </section>

      {/* Active project status row */}
      <section className="flex flex-col gap-3 border-b border-border pb-6 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-data rounded bg-muted px-2 py-1 text-xs text-muted-foreground">{active.id}</span>
            <span className="inline-flex items-center rounded-full border border-pilot-cyan/30 bg-pilot-cyan/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-pilot-cyan">
              {active.phase}
            </span>
          </div>
          <h2 className="mt-2 font-tight text-2xl font-bold text-foreground">
            {active.name}
            <span className="ml-3 text-base font-normal text-muted-foreground">Command Center</span>
          </h2>
        </div>
      </section>

      {/* Roadmap stepper */}
      <section className="pilot-card p-5">
        <div className="relative">
          <div className="absolute left-[10%] right-[10%] top-4 h-0.5 bg-border" />
          <div
            className="absolute left-[10%] top-4 h-0.5 bg-primary transition-all"
            style={{ width: `${(active.phaseIdx / (phases.length - 1)) * 80}%` }}
          />
          <div className="relative flex justify-between">
            {phases.map((label, i) => {
              const done = i < active.phaseIdx;
              const cur = i === active.phaseIdx;
              return (
                <div key={label} className="flex w-1/4 flex-col items-center gap-2">
                  <div
                    className={cn(
                      "flex h-8 w-8 items-center justify-center rounded-full ring-4 ring-background",
                      cur
                        ? "bg-primary text-primary-foreground"
                        : done
                          ? "bg-primary/30 text-primary"
                          : "border-2 border-border bg-muted text-muted-foreground",
                    )}
                  >
                    {cur ? <FileSearch className="h-4 w-4" /> : <span className="font-data text-xs">{i + 1}</span>}
                  </div>
                  <span className={cn("text-[10px] font-bold uppercase tracking-wider", cur ? "text-primary" : "text-muted-foreground")}>
                    {label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Grid: left modules + right intelligence */}
      <div className="grid gap-6 lg:grid-cols-12">
        {/* Left col */}
        <div className="space-y-6 lg:col-span-8">
          {/* Site Investigation module */}
          <section className="pilot-card group relative overflow-hidden">
            <div className="pointer-events-none absolute -right-8 -top-8 h-32 w-32 rounded-full bg-primary/5 transition-transform group-hover:scale-110" />
            <header className="border-b border-border bg-muted/40 p-5">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-background text-primary">
                  <FileSearch className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="font-tight text-lg font-bold">Site Investigation Module</h3>
                  <p className="text-sm text-muted-foreground">Phase 0 data collection and initial analysis hub.</p>
                </div>
              </div>
            </header>
            <div className="grid gap-4 p-5 md:grid-cols-3">
              {entryPoints.map((ep) => (
                <a
                  key={ep.title}
                  href="#"
                  className="group/card block rounded-lg border border-border bg-background p-4 transition-all hover:-translate-y-0.5 hover:border-primary hover:shadow-lg"
                >
                  <div className={cn("mb-4 flex h-8 w-8 items-center justify-center rounded", ep.accent)}>
                    <ep.icon className="h-4 w-4" />
                  </div>
                  <h4 className="font-tight text-base font-bold text-foreground transition-colors group-hover/card:text-primary">{ep.title}</h4>
                  <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{ep.body}</p>
                  <div className="mt-4 flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-primary opacity-0 transition-opacity group-hover/card:opacity-100">
                    {ep.cta} <ArrowRight className="h-3 w-3" />
                  </div>
                </a>
              ))}
            </div>
          </section>

          {/* Recent Field Evidence */}
          <section className="pilot-card p-5">
            <div className="mb-4 flex items-center justify-between border-b border-border pb-4">
              <div className="flex items-center gap-2">
                <Camera className="h-4 w-4 text-muted-foreground" />
                <h3 className="font-tight text-lg font-bold">Recent Field Evidence</h3>
              </div>
              <button className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-primary hover:underline">
                View Gallery <FolderOpen className="h-3 w-3" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              {fieldEvidence.map((p) => (
                <div key={p.name} className="group relative aspect-square cursor-pointer overflow-hidden rounded-lg border border-border">
                  <img
                    src={p.src}
                    alt={p.alt}
                    loading="lazy"
                    width={1024}
                    height={1024}
                    className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                  />
                  <div className={cn("pointer-events-none absolute inset-0 bg-gradient-to-br mix-blend-overlay opacity-40", p.tone)} />
                  <div className="pointer-events-none absolute inset-0 grid-overlay opacity-20" />
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-[hsl(var(--deep-navy)/0.92)] via-[hsl(var(--deep-navy)/0.55)] to-transparent p-2.5">
                    <p className="text-[11px] font-medium leading-tight text-[hsl(var(--background))] line-clamp-2">
                      {p.caption}
                    </p>
                    <div className="mt-1 flex items-center justify-between gap-2 font-data text-[9px] uppercase tracking-wider text-[hsl(var(--background)/0.7)]">
                      <span>{p.capturedAt}</span>
                      <span className="truncate opacity-0 transition-opacity group-hover:opacity-100">{p.name}</span>
                    </div>
                  </div>
                </div>
              ))}
              <button className="group flex aspect-square flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-border bg-muted/40 text-muted-foreground transition-colors hover:border-primary hover:bg-muted hover:text-primary">
                <Camera className="h-7 w-7 transition-transform group-hover:scale-110" />
                <span className="text-[10px] font-bold uppercase tracking-wider">Upload New</span>
              </button>
            </div>
          </section>
        </div>

        {/* Right col */}
        <div className="space-y-6 lg:col-span-4">
          {/* Institutional Memory */}
          <section className="pilot-card relative overflow-hidden">
            <div className="h-1 w-full bg-gradient-to-r from-pilot-cyan via-primary to-pilot-teal" />
            <div className="p-5">
              <div className="mb-4 flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-primary" />
                <h3 className="font-tight text-base font-bold">Institutional Memory</h3>
              </div>
              <div className="relative rounded-lg border border-border bg-muted/40 p-4">
                <Quote className="absolute right-3 top-3 h-8 w-8 rotate-12 text-border opacity-40" />
                <p className="relative text-sm italic leading-relaxed text-muted-foreground">
                  "Previous QSR developments in this corridor face extended review times for drive-thru conditional use permits. Early traffic study submission is highly recommended."
                </p>
                <div className="mt-3 flex items-center justify-between">
                  <span className="pilot-kicker">Source: QSR Portfolio Data</span>
                  <button className="text-[10px] font-bold uppercase tracking-wider text-primary hover:underline">View Source</button>
                </div>
              </div>
              <div className="mt-3 flex gap-2">
                {["#Zoning", "#TrafficStudy"].map((t) => (
                  <span key={t} className="rounded bg-muted px-2 py-1 font-data text-[10px] text-muted-foreground">{t}</span>
                ))}
              </div>
            </div>
          </section>

          {/* Cost Alert */}
          <section className="pilot-card relative overflow-hidden border-warning/40 p-5">
            <div className="pointer-events-none absolute -right-6 -top-6 h-24 w-24 rounded-full bg-warning/10" />
            <div className="relative flex items-start gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-warning/15 text-warning">
                <AlertTriangle className="h-4 w-4" />
              </div>
              <div>
                <h3 className="font-tight text-base font-bold">Cost Alert: Utility Coordination</h3>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                  Based on current investigation delays, the upcoming Utility Coordination phase is at risk of exceeding estimated budget by{" "}
                  <span className="font-data font-bold text-warning">12.5%</span>.
                </p>
                <div className="mt-3 flex items-center gap-2">
                  <button className="rounded border border-border bg-background px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-foreground transition-colors hover:bg-muted">
                    Review Budget
                  </button>
                  <button className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground">
                    Dismiss
                  </button>
                </div>
              </div>
            </div>
          </section>

          {/* AI Assistant CTA */}
          <section className="rounded-lg border border-dashed border-primary/40 bg-primary/5 p-5 text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full border border-border bg-background text-primary shadow-sm">
              <Bot className="h-5 w-5" />
            </div>
            <h4 className="font-tight text-sm font-bold">AI Assistant Available</h4>
            <p className="mt-1 text-xs text-muted-foreground">Need help analyzing site documents?</p>
            <button className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-primary/30 bg-background px-3 py-2 text-xs font-bold uppercase tracking-wider text-primary transition-colors hover:bg-primary hover:text-primary-foreground">
              <Wrench className="h-3.5 w-3.5" /> Ask Project Agent
            </button>
          </section>
        </div>
      </div>
    </div>
  );
};

export default MissionControl;
