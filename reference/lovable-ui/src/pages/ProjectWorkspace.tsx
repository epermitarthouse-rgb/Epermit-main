import { ArrowRight, BookOpen, Camera, ChevronRight, FileSearch, FolderOpen, HardHat, Plus, Share2, Sparkles, Wrench } from "lucide-react";
import { Link } from "react-router-dom";
import { useActiveProject } from "@/state/activeProject";
import { cn } from "@/lib/utils";
import { AlertBanner, ServicePill, StatusPill } from "@/components/permitpilot/ProductPrimitives";

const phases = ["Investigation", "Filing", "Coordination", "Closeout"];

const entryPoints = [
  { icon: FileSearch, title: "Executive SIR (ESIR)", body: "High-level overview of site readiness and risks.", cta: "Access Report", accent: "bg-pilot-cyan/10 text-pilot-cyan" },
  { icon: HardHat, title: "Technical Workspace", body: "Engineering data, utility mapping, and constraint analysis.", cta: "Enter Workspace", accent: "bg-primary/10 text-primary" },
  { icon: BookOpen, title: "Documentation Annex", body: "Central repository for deeds, permits, and historical records.", cta: "View Archive", accent: "bg-pilot-teal/10 text-pilot-teal" },
];

const fieldEvidence = [
  { name: "Util-Mark-01.jpg", tone: "from-pilot-cyan/30 to-primary/20" },
  { name: "Transformer-A.jpg", tone: "from-pilot-teal/30 to-pilot-cyan/20" },
  { name: "Site-Overview.jpg", tone: "from-primary/20 to-pilot-amber/20" },
];

const ProjectWorkspace = () => {
  const { active } = useActiveProject();

  return (
    <div className="space-y-6">
      {/* Status header */}
      <header className="flex flex-col gap-4 border-b border-border pb-6 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-data rounded bg-muted px-2 py-1 text-xs text-muted-foreground">{active.id}</span>
            <span className="rounded-full border border-pilot-cyan/30 bg-pilot-cyan/10 px-2.5 py-1 pilot-kicker text-pilot-cyan">
              {active.phase}
            </span>
          </div>
          <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-foreground md:text-4xl">
            {active.name}
            <span className="ml-3 text-base font-normal text-muted-foreground">Command Center</span>
          </h1>
          <div className="mt-3 flex flex-wrap gap-2">
            {active.services.map((service) => <ServicePill key={service} service={service} />)}
          </div>
        </div>
        <div className="flex gap-2">
          <button className="pilot-button-ghost"><Share2 className="h-4 w-4" /> Share</button>
          <button className="pilot-button-primary"><Plus className="h-4 w-4" /> New Action</button>
        </div>
      </header>

      {/* Roadmap stepper */}
      <section className="pilot-card p-5">
        <div className="relative">
          <div className="absolute left-[10%] right-[10%] top-4 h-0.5 bg-border" />
          <div className="absolute left-[10%] top-4 h-0.5 bg-primary transition-all" style={{ width: `${(active.phaseIdx / (phases.length - 1)) * 80}%` }} />
          <div className="relative flex justify-between">
            {phases.map((label, i) => {
              const done = i < active.phaseIdx;
              const cur = i === active.phaseIdx;
              return (
                <div key={label} className="flex w-1/4 flex-col items-center gap-2">
                  <div className={cn("flex h-8 w-8 items-center justify-center rounded-full ring-4 ring-background", cur ? "bg-primary text-primary-foreground" : done ? "bg-primary/30 text-primary" : "border-2 border-border bg-muted text-muted-foreground")}>
                    {cur ? <FileSearch className="h-4 w-4" /> : <span className="font-data text-xs">{i + 1}</span>}
                  </div>
                  <span className={cn("pilot-kicker", cur ? "text-primary" : "text-muted-foreground")}>{label}</span>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <AlertBanner
        tone="warn"
        title="Shared client workspace"
        detail={`${active.serviceSummary} for ${active.client}. Permit blockers and provider dependencies are tracked together so issuance risk is visible in one place.`}
      />

      <div className="grid gap-6 lg:grid-cols-12">
        <div className="space-y-6 lg:col-span-8">
          {/* Site Investigation Module */}
          <section className="pilot-card group relative overflow-hidden">
            <div className="pointer-events-none absolute -right-8 -top-8 h-32 w-32 rounded-full bg-primary/5" />
            <header className="border-b border-border bg-muted/40 p-5">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-background text-primary">
                  <FileSearch className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="font-tight text-lg font-bold">Site Investigation Module</h2>
                  <p className="text-sm text-muted-foreground">Phase 0 data collection and initial analysis hub.</p>
                </div>
              </div>
            </header>
            <div className="grid gap-4 p-5 md:grid-cols-3">
              {entryPoints.map((ep) => (
                <a key={ep.title} href="#" className="group/card block rounded-lg border border-border bg-background p-4 transition-all hover:-translate-y-0.5 hover:border-primary hover:shadow-lg">
                  <div className={cn("mb-4 flex h-8 w-8 items-center justify-center rounded", ep.accent)}>
                    <ep.icon className="h-4 w-4" />
                  </div>
                  <h3 className="font-tight text-base font-bold text-foreground transition-colors group-hover/card:text-primary">{ep.title}</h3>
                  <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{ep.body}</p>
                  <div className="mt-4 flex items-center gap-1 pilot-kicker text-primary opacity-0 transition-opacity group-hover/card:opacity-100">
                    {ep.cta} <ArrowRight className="h-3 w-3" />
                  </div>
                </a>
              ))}
            </div>
          </section>

          {/* Field evidence */}
          <section className="pilot-card p-5">
            <div className="mb-4 flex items-center justify-between border-b border-border pb-4">
              <div className="flex items-center gap-2">
                <Camera className="h-4 w-4 text-muted-foreground" />
                <h3 className="font-tight text-lg font-bold">Recent Field Evidence</h3>
              </div>
              <button className="inline-flex items-center gap-1 pilot-kicker text-primary hover:underline">
                View Gallery <FolderOpen className="h-3 w-3" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              {fieldEvidence.map((p) => (
                <div key={p.name} className="group relative aspect-square cursor-pointer overflow-hidden rounded-lg border border-border">
                  <div className={cn("absolute inset-0 bg-gradient-to-br", p.tone)} />
                  <div className="absolute inset-x-0 bottom-0 flex items-end bg-gradient-to-t from-[hsl(var(--deep-navy)/0.7)] to-transparent p-2 opacity-0 transition-opacity group-hover:opacity-100">
                    <span className="font-data text-[10px] text-[hsl(var(--background))]">{p.name}</span>
                  </div>
                </div>
              ))}
              <button className="group flex aspect-square flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-border bg-muted/40 text-muted-foreground transition-colors hover:border-primary hover:text-primary">
                <Camera className="h-7 w-7 transition-transform group-hover:scale-110" />
                <span className="pilot-kicker">Upload New</span>
              </button>
            </div>
          </section>

          {/* Quick jump to timeline tools */}
          <section className="pilot-card p-5">
            <h3 className="mb-3 font-tight text-lg font-bold">Schedule Intelligence</h3>
            <div className="grid gap-3 md:grid-cols-3">
              <QuickLink to={`/projects/${active.id}/timeline`} title="Milestone Timeline" />
              <QuickLink to={`/projects/${active.id}/gantt`} title="Gantt View" />
              <QuickLink to="/critical-path" title="Critical Path" />
            </div>
          </section>

          <section className="pilot-card p-5">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="font-tight text-lg font-bold">Current blockers</h3>
              <StatusPill tone={active.risk === "High" ? "bad" : active.risk === "Medium" ? "warn" : "good"}>{active.risk} risk</StatusPill>
            </div>
            <div className="flex flex-wrap gap-2">
              {active.blockers.map((blocker) => (
                <span key={blocker} className="rounded-full border border-destructive/30 bg-destructive/10 px-2.5 py-1 font-data text-[10px] uppercase tracking-wider text-destructive">
                  {blocker}
                </span>
              ))}
            </div>
            <p className="mt-4 text-sm text-muted-foreground">Providers in scope: <span className="text-foreground">{active.providers.join(" · ")}</span></p>
          </section>
        </div>

        {/* Right rail */}
        <div className="space-y-6 lg:col-span-4">
          <section className="pilot-card relative overflow-hidden">
            <div className="h-1 w-full bg-gradient-to-r from-pilot-cyan via-primary to-pilot-teal" />
            <div className="p-5">
              <div className="mb-4 flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-primary" />
                <h3 className="font-tight text-base font-bold">Institutional Memory</h3>
              </div>
              <p className="rounded-lg border border-border bg-muted/40 p-4 text-sm italic leading-relaxed text-muted-foreground">
                "Previous {active.client} developments in this corridor face extended review times for drive-thru
                conditional use permits. Early traffic study submission is highly recommended."
              </p>
            </div>
          </section>

          <section className="rounded-lg border border-dashed border-primary/40 bg-primary/5 p-5 text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full border border-border bg-background text-primary shadow-sm">
              <Wrench className="h-5 w-5" />
            </div>
            <h4 className="font-tight text-sm font-bold">AI Assistant Available</h4>
            <p className="mt-1 text-xs text-muted-foreground">Need help analyzing site documents?</p>
            <button className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-primary/30 bg-background px-3 py-2 pilot-kicker text-primary transition-colors hover:bg-primary hover:text-primary-foreground">
              Ask Project Agent
            </button>
          </section>
        </div>
      </div>
    </div>
  );
};

const QuickLink = ({ to, title }: { to: string; title: string }) => (
  <Link to={to} className="group flex items-center justify-between rounded-md border border-border bg-background p-3 transition-colors hover:border-primary">
    <span className="text-sm font-medium">{title}</span>
    <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
  </Link>
);

export default ProjectWorkspace;