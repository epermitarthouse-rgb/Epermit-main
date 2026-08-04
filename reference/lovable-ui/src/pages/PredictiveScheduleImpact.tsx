import { AlertTriangle, ArrowDownRight, ArrowUpRight, Brain, CalendarRange, CloudRain, GitBranch, Target, TrendingUp } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

type Driver = {
  name: string;
  delta: string;
  direction: "up" | "down";
  confidence: number;
  notes: string;
};

const drivers: Driver[] = [
  { name: "Pepco transformer fabrication slip", delta: "+9 days", direction: "up", confidence: 0.92, notes: "Howard Industries Q3 capacity 14% over plan." },
  { name: "DCRA reviewer reassignment", delta: "+4 days", direction: "up", confidence: 0.78, notes: "Lead reviewer rotated; new reviewer first-pass avg +3.6 d." },
  { name: "Sequenced raze + new build permitting", delta: "−6 days", direction: "down", confidence: 0.81, notes: "Stacking saves a re-noticing cycle." },
  { name: "Storm drain conflict resolved early", delta: "−3 days", direction: "down", confidence: 0.71, notes: "Mitigation routed via conflict hunter on Aug 04." },
  { name: "Inspector release queue backlog", delta: "+2 days", direction: "up", confidence: 0.66, notes: "9 projects ahead in current borough." },
];

const horizons = [
  { label: "Baseline CO", value: "Oct 22", note: "as of contract" },
  { label: "Predicted CO", value: "Oct 28", note: "+6 days slip" },
  { label: "Mitigated CO", value: "Oct 23", note: "if 2 actions taken" },
  { label: "Confidence", value: "0.84", note: "P50 band ±4 d" },
];

const milestones = [
  { name: "Permit issuance", baseline: "Aug 22", predicted: "Aug 26", delta: "+4 d" },
  { name: "Energization", baseline: "Sep 19", predicted: "Sep 28", delta: "+9 d" },
  { name: "Final inspection", baseline: "Oct 15", predicted: "Oct 22", delta: "+7 d" },
  { name: "Certificate of occupancy", baseline: "Oct 22", predicted: "Oct 28", delta: "+6 d" },
];

const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// Hurricane season impact days added to Florida schedules Jun–Nov (peak Aug–Oct).
const hurricaneImpact = [0, 0, 0, 0, 0, 2, 4, 7, 9, 6, 3, 0];

const flSites = [
  { name: "McDonald's · Miami HVHZ",       baseline: "Oct 04", modeled: "Oct 13", buffer: "+9d" },
  { name: "McDonald's · Key West (KEYS)",  baseline: "Sep 22", modeled: "Oct 01", buffer: "+9d" },
  { name: "McDonald's · Orlando Standard", baseline: "Aug 30", modeled: "Sep 06", buffer: "+7d" },
  { name: "McDonald's · Tampa Drive-Thru", baseline: "Jul 18", modeled: "Jul 22", buffer: "+4d" },
];

const PredictiveScheduleImpact = () => {
  const [hurricane, setHurricane] = useState(true);
  return (
  <div className="space-y-6 pb-12">
    <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div>
        <div className="pilot-kicker text-primary">Scheduling Intelligence</div>
        <h1 className="mt-2 font-tight text-3xl font-black tracking-tight text-foreground md:text-4xl">Predictive Schedule Impact Report</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Bayesian model that re-forecasts every milestone nightly. Reads from permit cycle data,
          vendor signals, AHJ reviewer patterns, and the conflict hunter to give one defensible
          number to share with the owner.
        </p>
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={() => setHurricane((v) => !v)}
          className={cn(
            "inline-flex items-center gap-2 rounded-md border px-3 py-2 text-xs font-bold uppercase tracking-wider transition-colors",
            hurricane
              ? "border-warning bg-warning/10 text-warning"
              : "border-border bg-card text-muted-foreground hover:text-foreground"
          )}
        >
          <CloudRain className="h-4 w-4" /> Hurricane overlay {hurricane ? "on" : "off"}
        </button>
        <button className="pilot-button-primary"><Brain className="h-4 w-4" /> Re-run forecast</button>
      </div>
    </header>

    {hurricane && (
      <section className="pilot-card overflow-hidden border-warning/40 bg-warning/5 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="pilot-kicker text-warning">Florida · Hurricane season overlay</div>
            <h2 className="mt-1 font-tight text-xl font-bold text-foreground">Jun–Nov utility crew drawdown modeled into project schedules</h2>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              FPL, Duke Energy Florida, and TECO systematically divert crews for storm response.
              PermitPilot applies a per-month impact factor (peak Aug–Oct) to every FL milestone and
              propagates the buffer into P50 / P90 dates.
            </p>
          </div>
          <div className="rounded-lg border border-warning/30 bg-background px-3 py-2 text-right">
            <div className="pilot-kicker text-warning">Peak impact</div>
            <div className="mt-0.5 font-data text-2xl font-semibold text-warning">+9 d</div>
            <div className="font-data text-[10px] uppercase tracking-wider text-muted-foreground">September</div>
          </div>
        </div>

        <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_1.3fr]">
          <div>
            <div className="pilot-kicker">Monthly buffer applied (days)</div>
            <div className="mt-3 flex h-32 items-end gap-1">
              {hurricaneImpact.map((d, i) => {
                const inSeason = d > 0;
                return (
                  <div key={i} className="flex flex-1 flex-col items-center gap-1">
                    <div
                      className={cn("w-full rounded-t-sm", inSeason ? "bg-warning" : "bg-muted")}
                      style={{ height: `${Math.max(4, (d / 9) * 100)}%`, opacity: inSeason ? 0.4 + (d / 9) * 0.6 : 0.4 }}
                      title={`${months[i]} · +${d}d`}
                    />
                    <span className={cn("font-data text-[9px]", inSeason ? "text-warning" : "text-muted-foreground")}>{months[i]}</span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="rounded-lg border border-border bg-background/60">
            <table className="w-full text-left text-sm">
              <thead className="bg-muted/40 text-muted-foreground">
                <tr>{["FL pilot site", "Baseline CO", "Hurricane-modeled CO", "Buffer"].map((h) => <th key={h} className="pilot-kicker px-3 py-2 font-semibold">{h}</th>)}</tr>
              </thead>
              <tbody>
                {flSites.map((s) => (
                  <tr key={s.name} className="border-t border-border">
                    <td className="px-3 py-2 font-tight font-semibold text-foreground">{s.name}</td>
                    <td className="px-3 py-2 font-data text-muted-foreground">{s.baseline}</td>
                    <td className="px-3 py-2 font-data text-warning">{s.modeled}</td>
                    <td className="px-3 py-2 font-data font-semibold text-warning">{s.buffer}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    )}

    <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {horizons.map((h) => (
        <div key={h.label} className="pilot-card p-5">
          <div className="flex items-center justify-between">
            <div className="pilot-kicker">{h.label}</div>
            <Target className="h-4 w-4 text-primary" />
          </div>
          <div className="mt-3 font-data text-2xl font-semibold text-foreground">{h.value}</div>
          <div className="mt-1 text-xs text-muted-foreground">{h.note}</div>
        </div>
      ))}
    </section>

    <section className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
      <div className="pilot-card overflow-hidden">
        <div className="border-b border-border p-5">
          <div className="pilot-kicker text-primary">Driver attribution</div>
          <h2 className="mt-1 font-tight text-xl font-bold text-foreground">What's moving the date</h2>
        </div>
        <ul className="divide-y divide-border">
          {drivers.map((d) => (
            <li key={d.name} className="flex items-start gap-4 p-5">
              <span className={`flex h-9 w-9 flex-none items-center justify-center rounded-md ${d.direction === "up" ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary"}`}>
                {d.direction === "up" ? <ArrowUpRight className="h-5 w-5" /> : <ArrowDownRight className="h-5 w-5" />}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-tight font-semibold text-foreground">{d.name}</span>
                  <span className="pilot-kicker">{(d.confidence * 100).toFixed(0)}% confidence</span>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{d.notes}</p>
              </div>
              <div className={`font-data text-sm font-semibold ${d.direction === "up" ? "text-destructive" : "text-primary"}`}>{d.delta}</div>
            </li>
          ))}
        </ul>
      </div>

      <div className="space-y-5">
        <div className="pilot-card p-5">
          <div className="pilot-kicker text-primary">Milestone deltas</div>
          <h3 className="mt-1 font-tight text-lg font-bold text-foreground">Baseline vs predicted</h3>
          <ul className="mt-4 space-y-3 text-sm">
            {milestones.map((m) => (
              <li key={m.name} className="flex items-center justify-between border-b border-border pb-2 last:border-0">
                <div>
                  <div className="text-foreground">{m.name}</div>
                  <div className="font-data text-[11px] text-muted-foreground">{m.baseline} → {m.predicted}</div>
                </div>
                <span className={`font-data text-sm font-semibold ${m.delta.startsWith("+") ? "text-destructive" : "text-primary"}`}>{m.delta}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="pilot-card p-5">
          <div className="flex items-center gap-2 text-primary"><GitBranch className="h-5 w-5" /><span className="font-tight font-semibold">Recommended mitigations</span></div>
          <ul className="mt-3 space-y-2 text-sm">
            <li className="flex gap-2"><TrendingUp className="mt-0.5 h-4 w-4 flex-none text-primary" /> Pre-pour transformer pad in week of Sep 02 — recovers 4 days.</li>
            <li className="flex gap-2"><CalendarRange className="mt-0.5 h-4 w-4 flex-none text-primary" /> Submit revised storm drain plan ahead of next DCRA batch — recovers 2 days.</li>
            <li className="flex gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 flex-none text-destructive" /> If neither is taken, CO slips to Oct 28 (P50).</li>
          </ul>
        </div>
      </div>
    </section>
  </div>
);
};

export default PredictiveScheduleImpact;