import { ArrowRight, Bot, Building2, Gauge, Gavel, Zap } from "lucide-react";
import { cn } from "@/lib/utils";

const score = 78;
const circumference = 2 * Math.PI * 44;

const tiles = [
  {
    icon: Building2, accent: "text-pilot-cyan",
    title: "Zoning Fit", status: "Favorable", statusTone: "success" as const,
    rows: [["Designation", "C-3 Commercial"], ["Variance Needed", "None"]],
  },
  {
    icon: Zap, accent: "text-primary",
    title: "Utility Proximity", status: "Review Req.", statusTone: "warning" as const,
    rows: [["Main Distance", "~450 ft"], ["Capacity Flag", "Substation Load"]],
  },
  {
    icon: Gavel, accent: "text-pilot-teal",
    title: "Entitlement Path", status: "Standard", statusTone: "info" as const,
    rows: [["Est. Timeline", "12-18 Months"], ["Public Hearing", "Likely"]],
  },
];

const statusTone = {
  success: "bg-success/10 text-success",
  warning: "bg-warning/10 text-warning",
  info: "bg-pilot-cyan/10 text-pilot-cyan",
} as const;

const comparables = [
  { name: "Southside Retail Hub", zoning: "C-3 Commercial", duration: "14 Months", hurdle: "Traffic Study Revision", match: 92, matchTone: "success" as const },
  { name: "West End Mixed Use", zoning: "C-2 (Variance Granted)", duration: "19 Months", hurdle: "Utility Coordination Delay", match: 85, matchTone: "success" as const },
  { name: "Oak Street Logistics Annex", zoning: "M-1 Industrial", duration: "11 Months", hurdle: "Environmental Review", match: 71, matchTone: "warning" as const },
];

const matchTone = {
  success: "bg-success/10 text-success",
  warning: "bg-warning/10 text-warning",
} as const;

const SiteFeasibility = () => (
  <div className="space-y-6">
    <header>
      <div className="flex items-center gap-2">
        <span className="rounded-full bg-primary/10 px-2.5 py-1 pilot-kicker text-primary">Phase 0</span>
        <span className="text-sm text-muted-foreground">Strategic Review</span>
      </div>
      <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight text-foreground">Site Feasibility Analyzer</h1>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
        Evaluate early-stage project viability through automated zoning, utility, and entitlement risk assessment.
      </p>
    </header>

    <div className="grid gap-6 xl:grid-cols-12">
      {/* Risk score gauge */}
      <section className="pilot-card relative flex flex-col justify-between overflow-hidden p-6 xl:col-span-4">
        <div className="pointer-events-none absolute -right-12 -top-12 h-32 w-32 rounded-full bg-primary/5 blur-2xl" />
        <header>
          <h3 className="flex items-center gap-2 font-tight text-lg font-bold">
            <Gauge className="h-5 w-5 text-primary" /> Preliminary Risk Score
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">Composite score based on historical data and AI analysis.</p>
        </header>
        <div className="my-6 flex items-center justify-center">
          <div className="relative h-44 w-44">
            <svg className="h-full w-full -rotate-90" viewBox="0 0 100 100">
              <circle cx="50" cy="50" r="44" fill="none" stroke="hsl(var(--border))" strokeWidth="10" />
              <circle
                cx="50" cy="50" r="44" fill="none" stroke="hsl(var(--primary))" strokeWidth="10" strokeLinecap="round"
                strokeDasharray={circumference} strokeDashoffset={circumference * (1 - score / 100)}
                className="transition-all duration-1000"
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
              <span className="font-display text-5xl font-bold">{score}</span>
              <span className="pilot-kicker mt-1 text-success">Moderate Viability</span>
            </div>
          </div>
        </div>
        <div className="flex items-center justify-between rounded-lg border border-border bg-muted/40 p-3">
          <span className="text-sm text-muted-foreground">Confidence Level</span>
          <span className="font-data text-sm">82.4%</span>
        </div>
      </section>

      {/* Secondary insights + AI narrative */}
      <div className="grid gap-6 xl:col-span-8 md:grid-cols-3">
        {tiles.map((t) => (
          <article key={t.title} className="pilot-card flex flex-col p-5">
            <div className="mb-4 flex items-start justify-between">
              <div className={cn("flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-muted", t.accent)}>
                <t.icon className="h-5 w-5" />
              </div>
              <span className={cn("rounded-full px-2.5 py-0.5 pilot-kicker", statusTone[t.statusTone])}>{t.status}</span>
            </div>
            <h4 className="font-tight text-lg font-bold">{t.title}</h4>
            <dl className="mt-auto space-y-2 pt-4 text-sm">
              {t.rows.map(([k, v]) => (
                <div key={k} className="flex justify-between border-b border-border pb-2 last:border-0 last:pb-0">
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd className="font-semibold text-foreground">{v}</dd>
                </div>
              ))}
            </dl>
          </article>
        ))}

        <article className="pilot-card p-5 md:col-span-3">
          <header className="mb-3 flex items-center gap-2">
            <Bot className="h-5 w-5 text-primary" />
            <h3 className="font-display text-xl font-semibold">AI Feasibility Narrative</h3>
          </header>
          <div className="rounded-lg border border-border bg-muted/40 p-4 text-sm leading-relaxed">
            <p className="mb-3">
              Based on the preliminary analysis of <strong>1200 North Main Street</strong>, the site presents a generally
              favorable path for commercial development under current C-3 zoning. The primary constraint identified is
              utility capacity, specifically regarding the proximity to the nearest high-voltage substation main (~450ft)
              and potential load limitations noted in municipal records.
            </p>
            <p>
              We recommend prioritizing an early electrical load study and initiating preliminary discussions with the
              local utility provider to mitigate timeline risks. Standard entitlement procedures apply, though neighborhood
              density suggests preparing for public comment phases.
            </p>
          </div>
        </article>
      </div>

      {/* Past performance */}
      <section className="pilot-card overflow-hidden xl:col-span-12">
        <header className="flex items-center justify-between border-b border-border bg-muted/40 p-5">
          <div>
            <h3 className="font-tight text-lg font-bold">Similar Past Performance</h3>
            <p className="text-sm text-muted-foreground">Comparable Commun-ET managed projects within a 10-mile radius.</p>
          </div>
          <button className="inline-flex items-center gap-1 pilot-kicker text-primary hover:underline">
            View All <ArrowRight className="h-3 w-3" />
          </button>
        </header>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted/30">
              <tr className="pilot-kicker">
                <th className="px-5 py-3 font-medium">Project Reference</th>
                <th className="px-5 py-3 font-medium">Zoning</th>
                <th className="px-5 py-3 font-medium">Permit Duration</th>
                <th className="px-5 py-3 font-medium">Major Hurdles</th>
                <th className="px-5 py-3 text-right font-medium">Similarity</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {comparables.map((c) => (
                <tr key={c.name} className="transition-colors hover:bg-muted/40">
                  <td className="px-5 py-4 font-medium text-foreground">{c.name}</td>
                  <td className="px-5 py-4 text-muted-foreground">{c.zoning}</td>
                  <td className="px-5 py-4 font-data text-xs text-muted-foreground">{c.duration}</td>
                  <td className="px-5 py-4 text-muted-foreground">{c.hurdle}</td>
                  <td className="px-5 py-4 text-right">
                    <span className={cn("rounded-full px-2.5 py-0.5 font-data text-xs", matchTone[c.matchTone])}>
                      {c.match}% Match
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  </div>
);

export default SiteFeasibility;