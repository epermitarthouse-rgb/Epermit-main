import { useSearchParams } from "react-router-dom";
import { ArrowDownRight, ArrowUpRight, Bot, DollarSign, LineChart, Sparkles, Wallet } from "lucide-react";
import { cn } from "@/lib/utils";

const variances = [
  { phase: "Phase 0 — Investigation", planned: 14, actual: 13, tone: "success" },
  { phase: "Phase 1 — Filing", planned: 28, actual: 34, tone: "warning" },
  { phase: "Phase 2 — Comments", planned: 21, actual: 18, tone: "success" },
  { phase: "Phase 3 — Utilities", planned: 35, actual: 52, tone: "destructive" },
  { phase: "Phase 4 — Inspections", planned: 14, actual: 11, tone: "success" },
];

const lessons = [
  { title: "Health pre-screen unlocked +8 days", body: "Switching to early prescreen meeting saved 8 days on critical path.", tone: "success" },
  { title: "Gas service routing took +17 days", body: "Routing conflict with column C-6 not flagged until civil rev 03.", tone: "destructive" },
  { title: "DesignCheck found 9 issues pre-submittal", body: "Avoided estimated 14 days of agency cycle time.", tone: "success" },
];

const agentImpact = [
  { agent: "DesignCheck", contribution: "+14 days saved", tone: "success" },
  { agent: "Portal Monitor", contribution: "+5 days saved", tone: "success" },
  { agent: "Comment Reconciler", contribution: "+9 days saved", tone: "success" },
  { agent: "Critical Path Solver", contribution: "−3 days drift", tone: "warning" },
];

const financials = [
  { label: "Permit Revenue", value: "$148,200" },
  { label: "Internal Cost (hrs × rate)", value: "$92,400" },
  { label: "Margin", value: "37.7%", tone: "success" },
  { label: "AI Cost Savings vs Baseline", value: "$36,800", tone: "success" },
];

const PostMortem = () => {
  const [params, setParams] = useSearchParams();
  const view = params.get("view") ?? "summary";
  const setView = (v: string) => setParams(v === "summary" ? {} : { view: v }, { replace: true });

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="pilot-kicker text-primary">Closeout Post-Mortem</div>
          <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight">Project Retrospective</h1>
          <p className="mt-1 text-sm text-muted-foreground">Variance, lessons learned, and agent attribution.</p>
        </div>
        <div className="flex rounded-md border border-border bg-card p-0.5 text-xs">
          {[
            { id: "summary", label: "Summary" },
            { id: "analytics", label: "Analytics" },
            { id: "financial", label: "Financial" },
          ].map((v) => {
            const active = view === v.id;
            return (
              <button key={v.id} onClick={() => setView(v.id)} className={cn("rounded px-3 py-1.5 transition-colors", active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>
                {v.label}
              </button>
            );
          })}
        </div>
      </header>

      {view === "summary" && (
        <section className="pilot-card p-5">
          <h2 className="font-tight text-lg font-bold">Lessons</h2>
          <ul className="mt-4 space-y-3">
            {lessons.map((l) => (
              <li key={l.title} className={cn("rounded-lg border p-4 text-sm",
                l.tone === "success" ? "border-success/30 bg-success/5" : "border-destructive/30 bg-destructive/5")}>
                <div className={cn("pilot-kicker", l.tone === "success" ? "text-success" : "text-destructive")}>{l.title}</div>
                <p className="mt-1 text-muted-foreground">{l.body}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {view === "analytics" && (
        <>
          <section className="pilot-card p-5">
            <h2 className="flex items-center gap-2 font-tight text-lg font-bold"><LineChart className="h-5 w-5 text-primary" /> Phase Variance (days)</h2>
            <ul className="mt-4 space-y-3">
              {variances.map((v) => {
                const delta = v.actual - v.planned;
                const isUp = delta > 0;
                const Icon = isUp ? ArrowUpRight : ArrowDownRight;
                const tone = v.tone === "success" ? "text-success" : v.tone === "warning" ? "text-warning" : "text-destructive";
                return (
                  <li key={v.phase} className="grid grid-cols-[1fr_120px_120px_60px] items-center gap-3 text-sm">
                    <span className="font-medium">{v.phase}</span>
                    <span className="text-muted-foreground">plan {v.planned}d</span>
                    <span className="text-foreground">actual <span className="font-data font-bold">{v.actual}d</span></span>
                    <span className={cn("inline-flex items-center gap-1 justify-end font-data text-xs", tone)}><Icon className="h-3.5 w-3.5" />{delta > 0 ? "+" : ""}{delta}</span>
                  </li>
                );
              })}
            </ul>
          </section>
          <section className="pilot-card p-5">
            <h3 className="flex items-center gap-2 font-tight text-base font-bold"><Bot className="h-4 w-4 text-pilot-teal" /> Agent Attribution</h3>
            <ul className="mt-3 grid gap-2 md:grid-cols-2">
              {agentImpact.map((a) => (
                <li key={a.agent} className="flex items-center justify-between rounded border border-border bg-muted/30 px-3 py-2 text-sm">
                  <span className="font-medium">{a.agent}</span>
                  <span className={a.tone === "success" ? "text-success" : "text-warning"}>{a.contribution}</span>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}

      {view === "financial" && (
        <section className="pilot-card p-5">
          <h2 className="flex items-center gap-2 font-tight text-lg font-bold"><Wallet className="h-5 w-5 text-primary" /> Financial Intelligence</h2>
          <div className="mt-4 grid gap-4 md:grid-cols-4">
            {financials.map((f) => (
              <div key={f.label} className="rounded-lg border border-border bg-muted/30 p-4">
                <div className="pilot-kicker text-muted-foreground">{f.label}</div>
                <div className={cn("mt-1 font-display text-2xl font-semibold", f.tone === "success" ? "text-success" : "text-foreground")}>{f.value}</div>
              </div>
            ))}
          </div>
          <p className="mt-4 flex items-center gap-2 text-xs text-muted-foreground"><DollarSign className="h-3.5 w-3.5 text-pilot-teal" /> Cost-to-permit ratio improved 11% vs portfolio baseline.</p>
        </section>
      )}

      <div className="pilot-card flex items-start gap-3 p-5">
        <Sparkles className="h-5 w-5 text-primary" />
        <div className="text-sm">
          <span className="font-medium">AI retrospective:</span> "Two of the three slippages trace back to incomplete utility data at intake. Recommend hardening Phase 0 utility verification."
        </div>
      </div>
    </div>
  );
};

export default PostMortem;