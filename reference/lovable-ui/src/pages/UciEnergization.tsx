import { useEffect, useState } from "react";
import { CheckCircle2, Circle, Clock, Cog, Gauge, PlugZap, Radio, Search, ShieldCheck, Zap } from "lucide-react";
import { UciEmpty, UciLoading } from "@/components/permitpilot/UciStates";

type Phase = { key: string; label: string; owner: string; window: string; done: boolean; current?: boolean };

const phases: Phase[] = [
  { key: "witness", label: "Witness test scheduled", owner: "Utility · PEPCO", window: "Jul 22 · 09:00", done: true },
  { key: "punch", label: "Contractor punch complete", owner: "GC · TDR Construction", window: "Jul 23", done: true },
  { key: "auth", label: "Utility authorization to energize", owner: "PEPCO switching desk", window: "Jul 24 · 07:30", done: false, current: true },
  { key: "cutover", label: "Cutover window (lane closure)", owner: "DDOT permit · TCP-88221", window: "Jul 24 · 08:00–13:00", done: false },
  { key: "meter", label: "Meter set + seal", owner: "PEPCO field crew", window: "Jul 24 · 14:00", done: false },
  { key: "commission", label: "Load bank commissioning", owner: "Envise commissioning agent", window: "Jul 25", done: false },
  { key: "handover", label: "Handover to operations", owner: "Client facilities", window: "Jul 26", done: false },
];

const kpis = [
  { label: "Days to energize", value: "14", delta: "vs 61 legacy avg", icon: Zap },
  { label: "Cutover window", value: "5h", delta: "one lane closure only", icon: Clock },
  { label: "Coordination touches", value: "23", delta: "PEPCO · GC · DDOT · Cx", icon: Radio },
  { label: "Commissioning risk", value: "Low", delta: "0 blockers · 1 watch", icon: ShieldCheck },
];

const UciEnergization = () => {
  const [query, setQuery] = useState("");
  const [state, setState] = useState<"all" | "done" | "current" | "upcoming">("all");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setLoading(false), 500);
    return () => clearTimeout(t);
  }, []);
  const filtered = phases.filter((p) => {
    const q = query.trim().toLowerCase();
    const matchesQ = !q || [p.label, p.owner, p.window].some((v) => v.toLowerCase().includes(q));
    const s: "done" | "current" | "upcoming" = p.done ? "done" : p.current ? "current" : "upcoming";
    return matchesQ && (state === "all" || s === state);
  });
  if (loading) {
    return (
      <UciLoading
        kicker="Agent 12 · Energization Choreographer"
        title="Energization & Commissioning"
        description="Sequencing the last-mile choreography — witness test, cutover, meter set, commissioning…"
      />
    );
  }
  return (
  <div className="space-y-6 pb-12">
    <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div>
        <div className="pilot-kicker text-primary">Agent 12 · Energization Choreographer</div>
        <h1 className="mt-2 font-tight text-3xl font-black tracking-tight text-foreground md:text-4xl">Energization &amp; Commissioning</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Sequences the last-mile choreography — witness test, cutover permit, meter set, commissioning —
          across the utility, contractor, jurisdiction, and commissioning agent as a single timeline.
        </p>
      </div>
      <button className="pilot-button-primary"><PlugZap className="h-4 w-4" /> Broadcast schedule</button>
    </header>

    <section className="pilot-card flex flex-wrap items-center gap-2 p-3">
      <div className="relative min-w-[240px] flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search phase, owner, window…" className="w-full rounded-md border border-border bg-card py-2 pl-9 pr-3 text-xs text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none" />
      </div>
      <select value={state} onChange={(e) => setState(e.target.value as typeof state)} className="rounded-md border border-border bg-card px-3 py-2 text-xs text-foreground focus:border-primary focus:outline-none">
        <option value="all">All phases</option>
        <option value="done">Done</option>
        <option value="current">In progress</option>
        <option value="upcoming">Upcoming</option>
      </select>
      {(query || state !== "all") && (
        <button onClick={() => { setQuery(""); setState("all"); }} className="pilot-kicker text-muted-foreground hover:text-primary">Clear</button>
      )}
      <span className="pilot-kicker text-muted-foreground">{filtered.length}/{phases.length}</span>
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

    <section className="pilot-card p-6">
      <div className="pilot-kicker text-primary">Energization sequence · McDonald's 75 NY Ave NE</div>
      <ol className="mt-6 space-y-4">
        {filtered.length === 0 && (
          <li>
            <UciEmpty
              icon={PlugZap}
              title="No phases match your filters"
              description="Try a different phase state or clear the search."
              onClear={() => { setQuery(""); setState("all"); }}
            />
          </li>
        )}
        {filtered.map((p, i) => (
          <li key={p.key} className="grid grid-cols-[24px_1fr] gap-4">
            <div className="flex flex-col items-center">
              {p.done ? (
                <CheckCircle2 className="h-5 w-5 text-success" />
              ) : p.current ? (
                <Cog className="h-5 w-5 animate-spin text-primary" />
              ) : (
                <Circle className="h-5 w-5 text-muted-foreground" />
              )}
              {i < filtered.length - 1 && <div className="mt-1 h-full w-px flex-1 bg-border" />}
            </div>
            <div className={`rounded-md border p-4 ${p.current ? "border-primary/40 bg-primary/5" : "border-border bg-card"}`}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="font-tight text-sm font-bold text-foreground">{p.label}</div>
                <div className="pilot-kicker text-muted-foreground">{p.window}</div>
              </div>
              <div className="mt-1 text-xs text-muted-foreground"><Gauge className="mr-1 inline h-3 w-3" />{p.owner}</div>
            </div>
          </li>
        ))}
      </ol>
    </section>

    <section className="grid gap-5 lg:grid-cols-[1fr_1fr]">
      <div className="pilot-card p-5">
        <div className="pilot-kicker text-primary">Meter-set day-of choreography</div>
        <h2 className="mt-1 font-tight text-lg font-bold text-foreground">Hour-by-hour · reduces failed sets from ~15% → &lt;3%</h2>
        <ul className="mt-4 space-y-2">
          {[
            { t: "07:30", who: "GC superintendent", a: "Confirm pad graded · clear access · site escort assigned" },
            { t: "09:00", who: "Electrician",       a: "Main breaker OPEN · branch breakers OFF · panel cover installed" },
            { t: "10:00", who: "PM",                a: "Verify service address matches SDAT / utility record exactly" },
            { t: "13:00", who: "Customer rep",      a: "Responsible adult on-site if gas (WGL requirement)" },
            { t: "14:00", who: "Utility tech",      a: "Meter set · phase rotation check · voltage verification" },
            { t: "15:00", who: "PM",                a: "Photo evidence uploaded · account activated in utility billing" },
          ].map((x) => (
            <li key={x.t} className="grid grid-cols-[60px_1fr] gap-3 rounded-md border border-border bg-card/50 p-3 text-xs">
              <div className="font-data text-primary">{x.t}</div>
              <div>
                <div className="font-tight text-xs font-bold text-foreground">{x.who}</div>
                <div className="text-[11px] text-muted-foreground">{x.a}</div>
              </div>
            </li>
          ))}
        </ul>
      </div>

      <div className="pilot-card p-5">
        <div className="pilot-kicker text-primary">Variant handling</div>
        <h2 className="mt-1 font-tight text-lg font-bold text-foreground">Electric vs. gas meter-set requirements</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="rounded-md border border-primary/30 bg-primary/5 p-4">
            <div className="font-tight text-sm font-bold text-primary">Electric</div>
            <ul className="mt-2 space-y-1 text-[11px] text-foreground">
              <li>• Service entrance energized-ready</li>
              <li>• Main breaker open, branches off</li>
              <li>• Panel cover installed &amp; grounded</li>
              <li>• Phase rotation + voltage verification</li>
              <li>• Inspection release must reach utility ≤ 48h</li>
            </ul>
          </div>
          <div className="rounded-md border border-accent/40 bg-accent/5 p-4">
            <div className="font-tight text-sm font-bold text-accent">Gas</div>
            <ul className="mt-2 space-y-1 text-[11px] text-foreground">
              <li>• Pressure test certificate on file</li>
              <li>• Leak check by utility tech on site</li>
              <li>• Responsible adult present (WGL / BGE gas)</li>
              <li>• All gas appliances installed &amp; connected</li>
              <li>• Appliance turn-on documented per meter</li>
            </ul>
          </div>
        </div>
      </div>
    </section>
  </div>
  );
};

export default UciEnergization;