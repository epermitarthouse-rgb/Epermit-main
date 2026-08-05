import { useEffect, useMemo, useState } from "react";
import { Bolt, CircuitBoard, Compass, FileWarning, Flame, Search, ShieldCheck, Wrench, Zap } from "lucide-react";
import { Link } from "react-router-dom";
import { UciEmpty, UciLoading } from "@/components/permitpilot/UciStates";

type Determination = {
  id: string;
  project: string;
  utility: string;
  service: string;
  voltage: string;
  transformer: string;
  ciac: string;
  confidence: number;
  risks: string[];
  status: "Predicted" | "Confirmed" | "Under review";
};

const determinations: Determination[] = [
  { id: "COS-441", project: "McDonald's · 75 NY Ave NE", utility: "PEPCO", service: "Secondary — pad-mount", voltage: "208Y/120V · 3ph · 800A", transformer: "500 kVA · shared vault", ciac: "$118,240 (est.)", confidence: 0.92, risks: ["Vault access requires DDOT permit"], status: "Predicted" },
  { id: "COS-438", project: "Wonder · Federal Hill", utility: "BGE", service: "Primary — customer-owned", voltage: "13.2 kV · 3ph · 1,200A", transformer: "1,500 kVA · dedicated pad", ciac: "$247,880 (est.)", confidence: 0.87, risks: ["Customer-owned primary triggers switchgear pre-approval", "Longer commissioning window"], status: "Under review" },
  { id: "COS-434", project: "Retail · Ballston Quarter", utility: "Dominion Energy", service: "Secondary — shared", voltage: "480Y/277V · 3ph · 400A", transformer: "300 kVA · existing vault", ciac: "$41,200 (est.)", confidence: 0.94, risks: [], status: "Confirmed" },
  { id: "COS-427", project: "McDonald's · Rockville MD", utility: "Washington Gas", service: "Medium pressure", voltage: "60 psig · 2 psi delivery", transformer: "Regulator + meter set", ciac: "$18,900 (est.)", confidence: 0.81, risks: ["Peak MBH load table pending", "Landowner signature outstanding"], status: "Under review" },
];

const kpis = [
  { label: "Determinations shipped", value: "26", delta: "Q3 YTD", icon: CircuitBoard },
  { label: "Prediction accuracy", value: "91%", delta: "vs utility letters", icon: ShieldCheck },
  { label: "Avg confidence", value: "0.89", delta: "n = last 30", icon: Compass },
  { label: "Design triggers", value: "4", delta: "primary · vault · switchgear", icon: FileWarning },
];

const iconFor = (u: string) => (u.includes("Gas") ? Flame : u.includes("PEPCO") || u.includes("BGE") || u.includes("Dominion") ? Bolt : Zap);

const UciClassOfService = () => {
  const [query, setQuery] = useState("");
  const [utility, setUtility] = useState("all");
  const [status, setStatus] = useState<string>("all");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setLoading(false), 500);
    return () => clearTimeout(t);
  }, []);
  const utilities = useMemo(() => Array.from(new Set(determinations.map((d) => d.utility))), []);
  const filtered = determinations.filter((d) => {
    const q = query.trim().toLowerCase();
    const matchesQ = !q || [d.project, d.utility, d.service, d.voltage, d.transformer, ...d.risks].some((v) => v.toLowerCase().includes(q));
    return matchesQ && (utility === "all" || d.utility === utility) && (status === "all" || d.status === status);
  });
  if (loading) {
    return (
      <UciLoading
        kicker="Agent 6 · Class of Service Analysis"
        title="Class of Service"
        description="Predicting utility service determinations and risk triggers across your active projects…"
      />
    );
  }
  return (
  <div className="space-y-6 pb-12">
    <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div>
        <div className="pilot-kicker text-primary">Agent 6 · Class of Service Analysis</div>
        <h1 className="mt-2 font-tight text-3xl font-black tracking-tight text-foreground md:text-4xl">Class of Service</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Predicts each utility's service determination — primary vs. secondary, voltage class, transformer
          sizing, and CIAC exposure — so design teams stop guessing 8 weeks before the letter arrives.
        </p>
      </div>
      <Link to="/uci/ciac" className="pilot-button-primary"><Wrench className="h-4 w-4" /> CIAC tracker</Link>
    </header>

    <section className="pilot-card flex flex-wrap items-center gap-2 p-3">
      <div className="relative min-w-[240px] flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search project, service, voltage, risks…" className="w-full rounded-md border border-border bg-card py-2 pl-9 pr-3 text-xs text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none" />
      </div>
      <select value={utility} onChange={(e) => setUtility(e.target.value)} className="rounded-md border border-border bg-card px-3 py-2 text-xs text-foreground focus:border-primary focus:outline-none">
        <option value="all">All utilities</option>
        {utilities.map((u) => <option key={u} value={u}>{u}</option>)}
      </select>
      <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-md border border-border bg-card px-3 py-2 text-xs text-foreground focus:border-primary focus:outline-none">
        <option value="all">All statuses</option>
        <option value="Predicted">Predicted</option>
        <option value="Under review">Under review</option>
        <option value="Confirmed">Confirmed</option>
      </select>
      {(query || utility !== "all" || status !== "all") && (
        <button onClick={() => { setQuery(""); setUtility("all"); setStatus("all"); }} className="pilot-kicker text-muted-foreground hover:text-primary">Clear</button>
      )}
      <span className="pilot-kicker text-muted-foreground">{filtered.length}/{determinations.length}</span>
    </section>

    <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {kpis.map((k) => (
        <div key={k.label} className="pilot-card p-5">
          <div className="flex items-center justify-between"><div className="pilot-kicker">{k.label}</div><k.icon className="h-4 w-4 text-primary" /></div>
          <div className="mt-3 font-data text-2xl font-semibold text-foreground">{k.value}</div>
          <div className="mt-1 text-xs text-muted-foreground">{k.delta}</div>
        </div>
      ))}
    </section>

    <section className="grid gap-4 lg:grid-cols-2">
      {filtered.length === 0 && (
        <div className="pilot-card lg:col-span-2">
          <UciEmpty
            icon={CircuitBoard}
            title="No determinations match your filters"
            description="Try a different utility or status, or clear the search."
            onClear={() => { setQuery(""); setUtility("all"); setStatus("all"); }}
          />
        </div>
      )}
      {filtered.map((d) => {
        const Icon = iconFor(d.utility);
        return (
          <div key={d.id} className="pilot-card p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="pilot-kicker text-primary">{d.utility}</div>
                <h3 className="mt-1 font-tight text-lg font-bold text-foreground">{d.project}</h3>
              </div>
              <Icon className="h-5 w-5 text-primary" />
            </div>
            <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
              <dt className="pilot-kicker">Service</dt><dd className="text-foreground">{d.service}</dd>
              <dt className="pilot-kicker">Voltage / pressure</dt><dd className="font-data text-foreground">{d.voltage}</dd>
              <dt className="pilot-kicker">Sizing</dt><dd className="text-foreground">{d.transformer}</dd>
              <dt className="pilot-kicker">CIAC estimate</dt><dd className="font-data text-foreground">{d.ciac}</dd>
              <dt className="pilot-kicker">Confidence</dt><dd className="font-data text-foreground">{(d.confidence * 100).toFixed(0)}%</dd>
              <dt className="pilot-kicker">Status</dt><dd className="text-foreground">{d.status}</dd>
            </dl>
            {d.risks.length > 0 && (
              <div className="mt-3 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-[11px]">
                <div className="pilot-kicker text-destructive">Risk triggers</div>
                <ul className="mt-1 list-inside list-disc text-foreground">
                  {d.risks.map((r) => <li key={r}>{r}</li>)}
                </ul>
              </div>
            )}
          </div>
        );
      })}
    </section>

    <section className="grid gap-5 lg:grid-cols-[1fr_1fr]">
      <div className="pilot-card p-5">
        <div className="pilot-kicker text-primary">Discrepancy checklist</div>
        <h2 className="mt-1 font-tight text-lg font-bold text-foreground">Six dimensions Agent 6 reconciles</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Every incoming Class of Service letter is compared line-by-line against what the customer's design
          assumes. Discrepancies drive the response package.
        </p>
        <ul className="mt-4 grid gap-2 sm:grid-cols-2">
          {[
            { k: "Voltage class",       d: "208Y/120 vs 480Y/277 · phase count" },
            { k: "Transformer sizing",  d: "kVA rating · pad vs vault · location" },
            { k: "Easement scope",      d: "Parcel encroachment · ROW conflicts" },
            { k: "Customer equipment",  d: "Switchgear · CT cabinet · metering spec" },
            { k: "CIAC exposure",       d: "Estimated vs. budgeted variance" },
            { k: "Schedule impact",     d: "Lead time cascade to CO" },
          ].map((x) => (
            <li key={x.k} className="rounded-md border border-border bg-card/50 p-3">
              <div className="font-tight text-xs font-bold text-foreground">{x.k}</div>
              <div className="mt-1 text-[11px] text-muted-foreground">{x.d}</div>
            </li>
          ))}
        </ul>
      </div>

      <div className="pilot-card p-5">
        <div className="pilot-kicker text-primary">Typical response windows</div>
        <h2 className="mt-1 font-tight text-lg font-bold text-foreground">Historical utility SLA benchmarks</h2>
        <table className="mt-4 w-full text-xs">
          <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="pb-2 text-left">Utility</th>
              <th className="pb-2 text-left">Quoted</th>
              <th className="pb-2 text-left">Actual (CET data)</th>
              <th className="pb-2 text-right">Δ</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {[
              { u: "PEPCO",           q: "15–21 bd", a: "12 bd (median)",  d: "-3" },
              { u: "BGE",             q: "20–30 bd", a: "24 bd (median)",  d: "0" },
              { u: "Washington Gas",  q: "10–15 bd", a: "18 bd (median)",  d: "+3" },
              { u: "Dominion Energy", q: "10–14 bd", a: "11 bd (median)",  d: "-1" },
            ].map((r) => (
              <tr key={r.u}>
                <td className="py-2 font-tight font-semibold text-foreground">{r.u}</td>
                <td className="py-2 font-data text-muted-foreground">{r.q}</td>
                <td className="py-2 font-data text-foreground">{r.a}</td>
                <td className="py-2 text-right font-data text-primary">{r.d}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  </div>
  );
};

export default UciClassOfService;