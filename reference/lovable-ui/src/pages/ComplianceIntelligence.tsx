import { AlertTriangle, AlertOctagon, Brain, CalendarClock, Filter, MoreVertical, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

const findings = [
  { severity: "Critical", citation: "IBC 1006.3", issue: "Insufficient exit discharge width on Sheet A1.02", confidence: 98, status: "Shadow Match", statusTone: "muted" as const },
  { severity: "High", citation: "IFC 903.2.1.1", issue: "Sprinkler coverage gap in north storage corridor", confidence: 89, status: "Audit Required", statusTone: "warn" as const },
  { severity: "Standard", citation: "IBC 107.2.1", issue: "Missing seal on Sheet S2.1", confidence: 100, status: "Shadow Match", statusTone: "muted" as const },
];

const severityTone: Record<string, string> = {
  Critical: "bg-destructive/10 text-destructive border-destructive/20",
  High: "bg-warning/10 text-warning border-warning/20",
  Standard: "bg-pilot-cyan/10 text-pilot-cyan border-pilot-cyan/20",
};

const statusTone = {
  muted: "text-muted-foreground",
  warn: "text-warning",
} as const;

const score = 91.5;
const circumference = 2 * Math.PI * 45;

const ComplianceIntelligence = () => (
  <div className="space-y-6">
    {/* Header */}
    <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div>
        <nav className="flex items-center gap-1 pilot-kicker text-muted-foreground">
          <span>Mission Control</span>
          <span>›</span>
          <span>Code Analyzer</span>
          <span>›</span>
          <span className="text-primary">Analysis Results</span>
        </nav>
        <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight text-foreground">
          Compliance Scoring Dashboard
        </h1>
      </div>
      <button className="pilot-button-primary self-start md:self-auto">
        <Sparkles className="h-4 w-4" /> Run AI Analysis
      </button>
    </header>

    {/* Bento row */}
    <section className="grid gap-6 lg:grid-cols-12">
      {/* Submittal readiness gauge */}
      <div className="pilot-card relative flex flex-col items-center justify-center overflow-hidden p-6 text-center lg:col-span-4">
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent" />
        <h2 className="font-tight text-lg font-bold">Submittal Readiness</h2>
        <div className="relative my-4 h-40 w-40">
          <svg className="h-full w-full -rotate-90" viewBox="0 0 100 100">
            <circle cx="50" cy="50" r="45" fill="none" stroke="hsl(var(--border))" strokeWidth="8" />
            <circle
              cx="50" cy="50" r="45" fill="none" stroke="hsl(var(--primary))"
              strokeWidth="8" strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={circumference * (1 - score / 100)}
              className="transition-all duration-1000"
            />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="font-display text-5xl font-semibold text-primary">
              {score}<span className="text-2xl">%</span>
            </span>
          </div>
        </div>
        <div className="rounded-full bg-muted px-4 py-1.5">
          <p className="pilot-kicker">
            Pass-Gate: <span className="text-success">98%</span> (Montgomery Co.)
          </p>
        </div>
      </div>

      {/* Weighted impact + delay */}
      <div className="grid gap-6 lg:col-span-8 md:grid-cols-2">
        <article className="pilot-card p-6">
          <h3 className="mb-5 flex items-center gap-2 font-tight text-lg font-bold">
            <AlertOctagon className="h-5 w-5 text-accent" /> Weighted Impact
          </h3>
          <ul className="space-y-4 text-sm">
            {[
              { label: "Life Safety", count: "3 Critical", dot: "bg-destructive", text: "text-destructive" },
              { label: "Accessibility", count: "5 High", dot: "bg-warning", text: "text-warning" },
              { label: "Administrative", count: "12 Standard", dot: "bg-pilot-cyan", text: "text-pilot-cyan" },
            ].map((row) => (
              <li key={row.label} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className={cn("h-3 w-3 rounded-full", row.dot)} />
                  <span>{row.label}</span>
                </div>
                <span className={cn("font-data text-sm font-bold", row.text)}>{row.count}</span>
              </li>
            ))}
          </ul>
        </article>

        <article className="pilot-card relative flex flex-col justify-between overflow-hidden p-6">
          <CalendarClock className="pointer-events-none absolute -right-4 -top-4 h-32 w-32 text-muted opacity-40" />
          <div className="relative">
            <h3 className="font-tight text-lg font-bold">Predictive Delay Analysis</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              AI-estimated timeline impact based on historical jurisdictional data.
            </p>
          </div>
          <div className="relative mt-4 rounded-lg border border-destructive/30 bg-destructive/10 p-4">
            <p className="pilot-kicker text-destructive">Estimated Delay Risk</p>
            <p className="mt-1 font-display text-2xl font-bold text-destructive">+22 Business Days</p>
            <p className="mt-1 text-xs text-muted-foreground">if submitted as-is</p>
          </div>
        </article>
      </div>
    </section>

    {/* Findings table + reasoning */}
    <section className="grid gap-6 lg:grid-cols-12">
      <div className="pilot-card overflow-hidden lg:col-span-9">
        <header className="flex items-center justify-between border-b border-border bg-muted/40 p-5">
          <h3 className="font-tight text-lg font-bold">AI Code Citation Findings</h3>
          <div className="flex gap-2">
            <button className="rounded border border-border bg-background p-1.5 text-muted-foreground transition-colors hover:text-primary">
              <Filter className="h-4 w-4" />
            </button>
            <button className="rounded border border-border bg-background p-1.5 text-muted-foreground transition-colors hover:text-primary">
              <MoreVertical className="h-4 w-4" />
            </button>
          </div>
        </header>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted/60">
              <tr className="pilot-kicker">
                <th className="px-4 py-3 font-medium">Severity</th>
                <th className="px-4 py-3 font-medium">Code Citation</th>
                <th className="w-full px-4 py-3 font-medium">Issue Description</th>
                <th className="px-4 py-3 text-right font-medium">AI Confidence</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {findings.map((f) => (
                <tr key={f.citation} className="transition-colors hover:bg-muted/40">
                  <td className="px-4 py-4">
                    <span className={cn("inline-flex rounded border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider", severityTone[f.severity])}>
                      {f.severity}
                    </span>
                  </td>
                  <td className="px-4 py-4 font-data text-xs text-foreground">{f.citation}</td>
                  <td className="px-4 py-4 text-foreground">{f.issue}</td>
                  <td className="px-4 py-4 text-right">
                    <span className="inline-flex items-center justify-end gap-1 text-primary">
                      <Sparkles className="h-3.5 w-3.5" />
                      <span className="font-data text-xs font-bold">{f.confidence}%</span>
                    </span>
                  </td>
                  <td className={cn("px-4 py-4 text-xs", statusTone[f.statusTone])}>
                    <span className="inline-flex items-center gap-1 whitespace-nowrap">
                      {f.statusTone === "warn" && <AlertTriangle className="h-3.5 w-3.5" />}
                      {f.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <aside className="pilot-card flex h-full flex-col p-5 lg:col-span-3">
        <header className="mb-4 flex items-center gap-2 border-b border-border pb-3">
          <Brain className="h-5 w-5 text-primary" />
          <h3 className="font-tight text-lg font-bold">AI Reasoning Engine</h3>
        </header>
        <div className="flex-1 space-y-4 overflow-y-auto">
          <div className="rounded-md border border-border bg-muted/40 p-3">
            <div className="flex items-center justify-between">
              <span className="pilot-kicker">Snippet Logic</span>
              <span className="font-data text-[10px] text-muted-foreground">IBC 1006.3</span>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              "Visual match confirmed egress width of 32 inches against required 36 inches per IBC Chapter 10."
            </p>
            <div className="mt-3 flex justify-end">
              <button className="pilot-kicker text-primary hover:underline">View Source Image</button>
            </div>
          </div>
        </div>
      </aside>
    </section>
  </div>
);

export default ComplianceIntelligence;