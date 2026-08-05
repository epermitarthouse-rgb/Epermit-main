import { Link } from "react-router-dom";
import { ArrowRight, GitBranch, LayoutGrid, ListChecks, Sparkles, Workflow } from "lucide-react";

const tiles = [
  { to: "/matrix/unified", title: "Unified Task Matrix", desc: "Single source of truth across phases, agencies, and disciplines.", icon: LayoutGrid, count: "412 tasks" },
  { to: "/matrix/guided", title: "Guided Flow", desc: "Sequenced wizard for newly-onboarded permit packages.", icon: GitBranch, count: "9 phases" },
  { to: "/matrix/ai-workflow", title: "AI Workflow", desc: "Agent-orchestrated decisions and auto-triaged dependencies.", icon: Sparkles, count: "7 active agents" },
  { to: "/matrix/response", title: "Response Matrix", desc: "Comment reconciliation with AI confidence scoring.", icon: ListChecks, count: "38 open items" },
];

const MasterMatrix = () => (
  <div className="space-y-6">
    <header>
      <div className="pilot-kicker text-primary">Master Workspace</div>
      <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight">Master Task Matrices</h1>
      <p className="mt-1 text-sm text-muted-foreground">Choose the lens that matches how you want to drive the project today.</p>
    </header>

    <div className="grid gap-4 md:grid-cols-2">
      {tiles.map((t) => (
        <Link key={t.to} to={t.to} className="pilot-card group relative flex items-start gap-4 p-5 transition-colors hover:border-primary/50">
          <span className="flex h-12 w-12 items-center justify-center rounded-lg border border-border bg-muted/60 text-primary">
            <t.icon className="h-6 w-6" />
          </span>
          <div className="flex-1">
            <div className="flex items-center justify-between">
              <h2 className="font-tight text-lg font-bold">{t.title}</h2>
              <span className="pilot-kicker text-muted-foreground">{t.count}</span>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{t.desc}</p>
          </div>
          <ArrowRight className="absolute right-5 bottom-5 h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-primary" />
        </Link>
      ))}
    </div>

    <section className="pilot-card flex items-start gap-4 p-5">
      <Workflow className="h-6 w-6 text-pilot-teal" />
      <div>
        <h3 className="font-tight font-bold">Cross-Matrix Intelligence</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          All four matrices share the same task graph; status changes in one view propagate instantly to the others.
        </p>
      </div>
    </section>
  </div>
);

export default MasterMatrix;