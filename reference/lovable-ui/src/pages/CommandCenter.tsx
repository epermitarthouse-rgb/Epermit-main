import { ArrowRight, ChevronRight, Plus, Share2 } from "lucide-react";
import { Link } from "react-router-dom";
import { useActiveProject } from "@/state/activeProject";
import { cn } from "@/lib/utils";

const phases = ["Investigation", "Filing", "Coordination", "Closeout"];

const CommandCenter = () => {
  const { projects, activeId, setActiveId } = useActiveProject();

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="pilot-kicker text-primary">Multi-Client Mission Control</div>
          <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight text-foreground">Project Command Center</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Active permits across all clients. Select a project to drill into its command center, timeline, and critical path.
          </p>
        </div>
        <div className="flex gap-2">
          <button className="pilot-button-ghost"><Share2 className="h-4 w-4" /> Share</button>
          <button className="pilot-button-primary"><Plus className="h-4 w-4" /> New Project</button>
        </div>
      </header>

      {/* Portfolio KPIs */}
      <section className="grid gap-4 md:grid-cols-4">
        {[
          { label: "Active Projects", value: projects.length.toString(), tone: "text-foreground" },
          { label: "On-Track", value: "2", tone: "text-success" },
          { label: "At Risk", value: "1", tone: "text-warning" },
          { label: "Critical Path Items", value: "4", tone: "text-destructive" },
        ].map((k) => (
          <article key={k.label} className="pilot-card p-5">
            <div className="pilot-kicker">{k.label}</div>
            <div className={cn("mt-2 font-display text-3xl font-semibold", k.tone)}>{k.value}</div>
          </article>
        ))}
      </section>

      {/* Project grid */}
      <section className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {projects.map((p) => {
          const isActive = p.id === activeId;
          return (
            <article
              key={p.id}
              className={cn(
                "pilot-card flex flex-col p-5 transition-all hover:-translate-y-0.5 hover:shadow-lg",
                isActive && "ring-2 ring-primary/40",
              )}
            >
              <div className="flex items-center justify-between">
                <span className="font-data rounded bg-muted px-2 py-1 text-xs text-muted-foreground">{p.id}</span>
                <span className="pilot-kicker text-primary">{p.client}</span>
              </div>
              <h2 className="mt-3 font-tight text-lg font-bold text-foreground">{p.name}</h2>
              <p className="mt-1 text-xs text-muted-foreground">{p.phase}</p>

              {/* mini stepper */}
              <div className="relative my-5">
                <div className="absolute left-0 right-0 top-1/2 h-0.5 -translate-y-1/2 bg-border" />
                <div className="absolute left-0 top-1/2 h-0.5 -translate-y-1/2 bg-primary" style={{ width: `${(p.phaseIdx / (phases.length - 1)) * 100}%` }} />
                <div className="relative flex justify-between">
                  {phases.map((_, i) => (
                    <span
                      key={i}
                      className={cn(
                        "h-3 w-3 rounded-full ring-4 ring-background",
                        i < p.phaseIdx ? "bg-primary/40" : i === p.phaseIdx ? "bg-primary" : "bg-border",
                      )}
                    />
                  ))}
                </div>
              </div>

              <div className="mt-auto flex items-center gap-2 border-t border-border pt-4">
                <button
                  onClick={() => setActiveId(p.id)}
                  className={cn("flex-1 rounded border px-3 py-1.5 pilot-kicker transition-colors", isActive ? "border-primary bg-primary text-primary-foreground" : "border-border hover:border-primary hover:text-primary")}
                >
                  {isActive ? "Selected" : "Set Active"}
                </button>
                <Link
                  to="/projects/alpha"
                  onClick={() => setActiveId(p.id)}
                  className="group flex items-center gap-1 rounded border border-border px-3 py-1.5 pilot-kicker text-foreground hover:border-primary hover:text-primary"
                >
                  Open <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
                </Link>
              </div>
            </article>
          );
        })}
      </section>

      {/* Quick links */}
      <section className="pilot-card p-5">
        <h3 className="mb-3 font-tight text-lg font-bold">Portfolio tools</h3>
        <div className="grid gap-3 md:grid-cols-3">
          <QuickLink to="/critical-path" title="Critical Path Intelligence" />
          <QuickLink to="/mission-control" title="Mission Control Detail" />
          <QuickLink to="/dashboard" title="Operations Dashboard" />
        </div>
      </section>
    </div>
  );
};

const QuickLink = ({ to, title }: { to: string; title: string }) => (
  <Link to={to} className="group flex items-center justify-between rounded-md border border-border bg-background p-3 transition-colors hover:border-primary">
    <span className="text-sm font-medium">{title}</span>
    <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
  </Link>
);

export default CommandCenter;