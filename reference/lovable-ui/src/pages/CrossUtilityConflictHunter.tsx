import { AlertTriangle, ArrowRight, Cable, Filter, MapPin, ShieldAlert, Siren, Zap, Building2 } from "lucide-react";
import { Link } from "react-router-dom";

type Conflict = {
  id: string;
  utilities: string;
  location: string;
  station: string;
  severity: "Critical" | "High" | "Medium" | "Low";
  confidence: number;
  detected: string;
  status: "Open" | "Reviewing" | "Mitigated";
  proposed: string;
};

const conflicts: Conflict[] = [
  { id: "MCD-CFL-2401", utilities: "Gas (WGL) ⟷ Sanitary (DC Water)", location: "Grease trap trench · drive-thru side", station: "STA 12+40", severity: "Critical", confidence: 0.97, detected: "12m ago", status: "Open", proposed: "Re-route gas 1.8 ft west of grease trap, drop sanitary invert 0.4 ft" },
  { id: "MCD-CFL-2398", utilities: "Power (PEPCO) ⟷ Fiber (Verizon)", location: "Service entrance · NE corner", station: "STA 04+10", severity: "High", confidence: 0.91, detected: "47m ago", status: "Reviewing", proposed: "Joint trench 18 in offset, shared concrete encasement to canopy" },
  { id: "MCD-CFL-2391", utilities: "Water (DC Water) ⟷ Menu-board conduit", location: "Drive-thru order point OP-1", station: "STA 22+85", severity: "High", confidence: 0.88, detected: "1h ago", status: "Open", proposed: "Pull menu-board low-voltage 3 ft south of 6\" domestic water" },
  { id: "MCD-CFL-2386", utilities: "Sanitary ⟷ Geothermal loop", location: "Kitchen slab · SW quadrant", station: "STA 09+60", severity: "Medium", confidence: 0.74, detected: "3h ago", status: "Mitigated", proposed: "Loop re-bored at -14 ft. Verified by Geo-411." },
  { id: "MCD-CFL-2380", utilities: "Power (PEPCO) ⟷ Stormceptor", location: "Parking lot island B-3", station: "STA 17+20", severity: "Low", confidence: 0.62, detected: "Yesterday", status: "Mitigated", proposed: "No action — clearance verified 2.1 ft." },
];

const stats = [
  { label: "Open conflicts", value: "6", delta: "2 critical", icon: Siren },
  { label: "Avg. confidence", value: "0.86", delta: "across 5 networks", icon: ShieldAlert },
  { label: "Networks monitored", value: "11", delta: "gas · water · power · …", icon: Cable },
  { label: "Auto-mitigations / wk", value: "23", delta: "+4 vs last week", icon: Zap },
];

const CrossUtilityConflictHunter = () => (
  <div className="space-y-6 pb-12">
    <section className="flex flex-wrap items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3">
      <Building2 className="h-4 w-4 text-primary" />
      <div className="flex-1 min-w-[240px]">
        <div className="pilot-kicker text-primary">Active Site</div>
        <div className="font-tight text-sm font-bold text-foreground">McDonald's — 75 New York Ave NE · Washington DC</div>
      </div>
      <Link to="/mission-control" className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground hover:text-primary">← Mission Control</Link>
      <Link to="/utility/meter-set" className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-primary hover:underline">Next · Meter-Set <ArrowRight className="h-3 w-3" /></Link>
    </section>

    <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div>
        <div className="pilot-kicker text-primary">Utility Intelligence</div>
        <h1 className="mt-2 font-tight text-3xl font-black tracking-tight text-foreground md:text-4xl">Cross-Utility Conflict Hunter</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Continuously scans every utility model on the active project for spatial, depth, and
          clearance conflicts. Each finding ships with a proposed mitigation and the agent's
          confidence score.
        </p>
      </div>
      <div className="flex items-center gap-2">
        <button className="pilot-button-ghost"><Filter className="h-4 w-4" /> Filters</button>
        <button className="pilot-button-primary"><Zap className="h-4 w-4" /> Run sweep</button>
      </div>
    </header>

    <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {stats.map((s) => (
        <div key={s.label} className="pilot-card p-5">
          <div className="flex items-center justify-between">
            <div className="pilot-kicker">{s.label}</div>
            <s.icon className="h-4 w-4 text-primary" />
          </div>
          <div className="mt-3 font-data text-2xl font-semibold text-foreground">{s.value}</div>
          <div className="mt-1 text-xs text-muted-foreground">{s.delta}</div>
        </div>
      ))}
    </section>

    <section className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
      <div className="pilot-card overflow-hidden">
        <div className="border-b border-border p-5">
          <div className="pilot-kicker text-primary">Active conflicts</div>
          <h2 className="mt-1 font-tight text-xl font-bold text-foreground">{conflicts.length} findings · sorted by severity</h2>
        </div>
        <ul className="divide-y divide-border">
          {conflicts.map((c) => (
            <li key={c.id} className="p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <SeverityBadge s={c.severity} />
                    <span className="font-data text-[11px] text-muted-foreground">{c.id} · {c.detected}</span>
                  </div>
                  <div className="mt-2 font-tight text-base font-semibold text-foreground">{c.utilities}</div>
                  <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                    <MapPin className="h-3.5 w-3.5" /> {c.location} · <span className="font-data">{c.station}</span>
                  </div>
                </div>
                <div className="text-right">
                  <div className="pilot-kicker">Confidence</div>
                  <div className="mt-1 font-data text-lg font-semibold text-primary">{(c.confidence * 100).toFixed(0)}%</div>
                  <div className="mt-1 text-[10px] uppercase tracking-wider text-muted-foreground">{c.status}</div>
                </div>
              </div>
              <div className="mt-3 rounded-md border border-border bg-muted/30 p-3 text-sm text-foreground">
                <span className="pilot-kicker text-primary">Proposed mitigation · </span>{c.proposed}
              </div>
            </li>
          ))}
        </ul>
      </div>

      <div className="space-y-5">
        <div className="pilot-card p-5">
          <div className="pilot-kicker text-primary">Clearance ruleset</div>
          <h3 className="mt-1 font-tight text-lg font-bold text-foreground">PUC + jurisdictional overlays</h3>
          <ul className="mt-4 space-y-3 text-sm">
            {[
              { label: "Gas ⟷ electric (transmission)", value: "≥ 24 in vertical" },
              { label: "Water ⟷ sanitary (parallel)", value: "≥ 10 ft horizontal" },
              { label: "Fiber ⟷ HV power (crossing)", value: "≥ 12 in + shield" },
              { label: "Storm ⟷ steam main", value: "Insulation required" },
            ].map((r) => (
              <li key={r.label} className="flex items-start justify-between gap-3 border-b border-border pb-2 last:border-0">
                <span className="text-muted-foreground">{r.label}</span>
                <span className="font-data text-foreground">{r.value}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="pilot-card p-5">
          <div className="flex items-center gap-2 text-destructive"><AlertTriangle className="h-5 w-5" /><span className="font-tight font-semibold">Escalation queue</span></div>
          <p className="mt-2 text-sm text-muted-foreground">2 critical conflicts require sign-off from the utility coordinator before submittal.</p>
          <button className="pilot-button-primary mt-4 w-full justify-center">Route to coordinator <ArrowRight className="h-4 w-4" /></button>
        </div>
      </div>
    </section>
  </div>
);

const SeverityBadge = ({ s }: { s: Conflict["severity"] }) => {
  const map = {
    Critical: "border-destructive/40 bg-destructive/10 text-destructive",
    High: "border-primary/40 bg-primary/15 text-primary",
    Medium: "border-accent/40 bg-accent/15 text-accent-foreground",
    Low: "border-border bg-muted text-muted-foreground",
  } as const;
  return <span className={`rounded-full border px-2.5 py-1 font-data text-[11px] font-semibold uppercase tracking-wider ${map[s]}`}>{s}</span>;
};

export default CrossUtilityConflictHunter;