import { useMemo, useState } from "react";
import { AlertTriangle, ArrowDownRight, ArrowUpRight, Download, MapPin, Printer, ShieldCheck, TrendingUp } from "lucide-react";
import { PageHeader, Panel, StatusPill } from "@/components/permitpilot/ProductPrimitives";
import { cn } from "@/lib/utils";

type Region = "DMV" | "FL" | "NE" | "SE";

const regionMeta: Record<Region, { label: string; utilities: string; pilotSites: number; complexShare: string }> = {
  DMV: { label: "DMV · DC / MD / VA", utilities: "PEPCO · BGE · WGL · Dominion · NOVEC", pilotSites: 5, complexShare: "100%" },
  FL:  { label: "Florida · Mainland + Keys", utilities: "FPL · Duke FL · TECO · FKEC · KEYS", pilotSites: 4, complexShare: "75%" },
  NE:  { label: "Northeast · ME→PA", utilities: "Eversource · National Grid · Con Ed · PSE&G", pilotSites: 2, complexShare: "50%" },
  SE:  { label: "Southeast · NC / SC / GA", utilities: "Duke Carolinas · Georgia Power · Dominion NC", pilotSites: 1, complexShare: "0%" },
};

const quarters = ["Q3-2026", "Q4-2026", "Q1-2027"] as const;
type Quarter = typeof quarters[number];

// Public marketing metrics only — no internal ARR / phase leakage.
const kpiSeries: Record<Quarter, Record<Region, {
  onTime: number;      // % sites hitting predicted CO date within ±5d
  slipDays: number;    // P50 slip vs baseline
  meterFail: number;   // % failed meter-sets (target <3%)
  cycleWeeks: number;  // avg utility coord duration
}>> = {
  "Q3-2026": {
    DMV: { onTime: 78, slipDays: 6,  meterFail: 3.1, cycleWeeks: 28 },
    FL:  { onTime: 71, slipDays: 9,  meterFail: 4.2, cycleWeeks: 32 },
    NE:  { onTime: 82, slipDays: 4,  meterFail: 2.4, cycleWeeks: 24 },
    SE:  { onTime: 88, slipDays: 2,  meterFail: 1.9, cycleWeeks: 20 },
  },
  "Q4-2026": {
    DMV: { onTime: 84, slipDays: 4,  meterFail: 2.6, cycleWeeks: 25 },
    FL:  { onTime: 77, slipDays: 7,  meterFail: 3.4, cycleWeeks: 29 },
    NE:  { onTime: 86, slipDays: 3,  meterFail: 2.1, cycleWeeks: 22 },
    SE:  { onTime: 91, slipDays: 1,  meterFail: 1.4, cycleWeeks: 19 },
  },
  "Q1-2027": {
    DMV: { onTime: 89, slipDays: 2,  meterFail: 2.1, cycleWeeks: 22 },
    FL:  { onTime: 83, slipDays: 5,  meterFail: 2.9, cycleWeeks: 26 },
    NE:  { onTime: 90, slipDays: 2,  meterFail: 1.7, cycleWeeks: 20 },
    SE:  { onTime: 93, slipDays: 1,  meterFail: 1.1, cycleWeeks: 18 },
  },
};

const risks: { region: Region; title: string; horizon: string; severity: "high" | "med" | "low"; body: string }[] = [
  { region: "FL",  title: "Hurricane season utility drawdown", horizon: "Jun–Nov 2026", severity: "high", body: "FPL / Duke FL routinely divert crews for storm response. 4 pilot sites modeled with +7d contingency and pre-storm meter-set batching." },
  { region: "DMV", title: "PEPCO transformer fabrication slip", horizon: "Q3–Q4 2026",   severity: "high", body: "Howard Industries Q3 capacity 14% over plan. Long-lead tracker recommends 6-week earlier order for 750 kVA class." },
  { region: "FL",  title: "Florida Keys FKEC ↔ KEYS handoff",   horizon: "Ongoing",     severity: "med",  body: "Upper/Middle Keys (FKEC) and Lower Keys (KEYS Energy) apply different meter-set rules. Provider Map jurisdiction chips are enforced on intake." },
  { region: "DMV", title: "DDOT Public Space overlap",          horizon: "Q4 2026",     severity: "med",  body: "3 DC sites carry Public Space Committee review; sequencing tied to raze permit issuance to save a re-noticing cycle." },
  { region: "NE",  title: "Con Edison mainline queue",          horizon: "Q1 2027",     severity: "low",  body: "Manhattan / Brooklyn corridors monitored; no NYC pilot sites this quarter." },
];

const targets = {
  onTime: { target: 85, dir: "up" as const, label: "On-time CO %" },
  slipDays: { target: 5, dir: "down" as const, label: "P50 slip (d)" },
  meterFail: { target: 3, dir: "down" as const, label: "Meter-set fail %" },
  cycleWeeks: { target: 26, dir: "down" as const, label: "Cycle (wks)" },
};

const fmt = (k: keyof typeof targets, v: number) =>
  k === "onTime" ? `${v}%` : k === "meterFail" ? `${v.toFixed(1)}%` : k === "cycleWeeks" ? `${v}w` : `${v}d`;

const meetsTarget = (k: keyof typeof targets, v: number) =>
  targets[k].dir === "up" ? v >= targets[k].target : v <= targets[k].target;

const PortfolioExecutive = () => {
  const [quarter, setQuarter] = useState<Quarter>("Q3-2026");
  const prevIdx = quarters.indexOf(quarter) - 1;
  const prev = prevIdx >= 0 ? quarters[prevIdx] : null;

  const rows = useMemo(() => (Object.keys(regionMeta) as Region[]).map((r) => ({
    region: r,
    ...kpiSeries[quarter][r],
    prev: prev ? kpiSeries[prev][r] : null,
  })), [quarter, prev]);

  const portfolio = useMemo(() => {
    const cur = rows.map((r) => r);
    return {
      onTime: Math.round(cur.reduce((s, r) => s + r.onTime, 0) / cur.length),
      slipDays: Math.round(cur.reduce((s, r) => s + r.slipDays, 0) / cur.length),
      meterFail: Number((cur.reduce((s, r) => s + r.meterFail, 0) / cur.length).toFixed(1)),
      cycleWeeks: Math.round(cur.reduce((s, r) => s + r.cycleWeeks, 0) / cur.length),
    };
  }, [rows]);

  return (
    <div className="space-y-6 pb-12 print:space-y-4">
      <PageHeader
        eyebrow="McDonald's East Coast · Quarterly Executive Report"
        title="Portfolio-level utility coordination performance"
        body="Regional KPIs, pilot progress, and forward-looking risk across DMV, Florida, Northeast, and Southeast markets. Print-ready for leadership review — Master Services Agreement CET-2026-MCD-UC-001."
        action={
          <div className="flex items-center gap-2 print:hidden">
            <select
              value={quarter}
              onChange={(e) => setQuarter(e.target.value as Quarter)}
              className="rounded-md border border-border bg-card px-3 py-2 text-sm font-medium text-foreground outline-none focus:border-primary"
            >
              {quarters.map((q) => <option key={q} value={q}>{q}</option>)}
            </select>
            <button className="pilot-button-ghost" onClick={() => window.print()}><Printer className="h-4 w-4" /> Print</button>
            <button className="pilot-button-primary"><Download className="h-4 w-4" /> Export PDF</button>
          </div>
        }
      />

      {/* Portfolio KPI strip */}
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {(Object.keys(targets) as (keyof typeof targets)[]).map((k) => {
          const v = portfolio[k];
          const ok = meetsTarget(k, v);
          return (
            <div key={k} className="pilot-card p-5">
              <div className="flex items-center justify-between">
                <div className="pilot-kicker">{targets[k].label}</div>
                <StatusPill tone={ok ? "good" : "warn"}>{ok ? "on target" : "watch"}</StatusPill>
              </div>
              <div className="mt-3 font-data text-3xl font-semibold text-foreground">{fmt(k, v)}</div>
              <div className="mt-1 text-xs text-muted-foreground">
                Target {targets[k].dir === "up" ? "≥" : "≤"} {fmt(k, targets[k].target)} · portfolio avg
              </div>
            </div>
          );
        })}
      </section>

      {/* Regional benchmark table */}
      <Panel eyebrow="Regional benchmarks" title={`${quarter} — DMV / FL / NE / SE`}>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted/40 text-muted-foreground">
              <tr>
                {["Region", "Pilot sites", "On-time CO", "P50 slip", "Meter-set fail", "Cycle", "vs prior Q"].map((h) => (
                  <th key={h} className="pilot-kicker px-4 py-3 font-semibold">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const meta = regionMeta[r.region];
                const cellTone = (k: keyof typeof targets, v: number) => meetsTarget(k, v) ? "text-success" : "text-warning";
                const deltaCycle = r.prev ? r.cycleWeeks - r.prev.cycleWeeks : 0;
                return (
                  <tr key={r.region} className="border-t border-border align-top hover:bg-muted/20">
                    <td className="px-4 py-4">
                      <div className="font-tight font-semibold text-foreground">{meta.label}</div>
                      <div className="mt-0.5 text-[11px] text-muted-foreground">{meta.utilities}</div>
                      <div className="mt-1 font-data text-[10px] uppercase tracking-wider text-muted-foreground">
                        Complex tier: {meta.complexShare}
                      </div>
                    </td>
                    <td className="px-4 py-4 font-data text-foreground">{meta.pilotSites}</td>
                    <td className={cn("px-4 py-4 font-data font-semibold", cellTone("onTime", r.onTime))}>{fmt("onTime", r.onTime)}</td>
                    <td className={cn("px-4 py-4 font-data font-semibold", cellTone("slipDays", r.slipDays))}>{fmt("slipDays", r.slipDays)}</td>
                    <td className={cn("px-4 py-4 font-data font-semibold", cellTone("meterFail", r.meterFail))}>{fmt("meterFail", r.meterFail)}</td>
                    <td className={cn("px-4 py-4 font-data font-semibold", cellTone("cycleWeeks", r.cycleWeeks))}>{fmt("cycleWeeks", r.cycleWeeks)}</td>
                    <td className="px-4 py-4 font-data text-xs">
                      {r.prev ? (
                        <span className={cn("inline-flex items-center gap-1", deltaCycle <= 0 ? "text-success" : "text-destructive")}>
                          {deltaCycle <= 0 ? <ArrowDownRight className="h-3.5 w-3.5" /> : <ArrowUpRight className="h-3.5 w-3.5" />}
                          {deltaCycle === 0 ? "flat" : `${deltaCycle > 0 ? "+" : ""}${deltaCycle}w cycle`}
                        </span>
                      ) : <span className="text-muted-foreground">—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>

      {/* Forward-looking risk table */}
      <Panel eyebrow="Forward-looking risk" title="Named risks tracked across the East Coast portfolio">
        <ul className="divide-y divide-border">
          {risks.map((r) => (
            <li key={r.title} className="flex items-start gap-4 py-4 first:pt-0 last:pb-0">
              <span className={cn(
                "flex h-9 w-9 flex-none items-center justify-center rounded-md",
                r.severity === "high" ? "bg-destructive/10 text-destructive"
                : r.severity === "med" ? "bg-warning/10 text-warning"
                : "bg-success/10 text-success",
              )}>
                {r.severity === "low" ? <ShieldCheck className="h-5 w-5" /> : <AlertTriangle className="h-5 w-5" />}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-tight font-semibold text-foreground">{r.title}</span>
                  <StatusPill tone={r.severity === "high" ? "bad" : r.severity === "med" ? "warn" : "good"}>
                    {r.severity}
                  </StatusPill>
                  <span className="inline-flex items-center gap-1 font-data text-[10px] uppercase tracking-wider text-muted-foreground">
                    <MapPin className="h-3 w-3" /> {r.region}
                  </span>
                  <span className="font-data text-[10px] uppercase tracking-wider text-muted-foreground">· {r.horizon}</span>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{r.body}</p>
              </div>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel eyebrow="Trend" title="Cycle-time compression across quarters">
        <div className="grid gap-4 md:grid-cols-4">
          {(Object.keys(regionMeta) as Region[]).map((r) => {
            const series = quarters.map((q) => kpiSeries[q][r].cycleWeeks);
            const max = Math.max(...series);
            return (
              <div key={r} className="rounded-lg border border-border bg-muted/20 p-4">
                <div className="pilot-kicker">{r}</div>
                <div className="mt-1 font-tight text-sm font-bold text-foreground">{regionMeta[r].label}</div>
                <div className="mt-4 flex items-end gap-2">
                  {series.map((v, i) => (
                    <div key={i} className="flex flex-1 flex-col items-center gap-1">
                      <div className="w-full rounded-t-sm bg-primary" style={{ height: `${(v / max) * 80}px`, opacity: 0.4 + (i / series.length) * 0.6 }} />
                      <span className="font-data text-[10px] text-muted-foreground">{quarters[i].slice(0, 2)}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-3 inline-flex items-center gap-1 font-data text-[11px] text-success">
                  <TrendingUp className="h-3 w-3" /> −{series[0] - series[series.length - 1]}w over 3Q
                </div>
              </div>
            );
          })}
        </div>
      </Panel>
    </div>
  );
};

export default PortfolioExecutive;