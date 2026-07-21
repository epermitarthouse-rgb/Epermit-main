import { CalendarCheck2, CheckCircle2, ClipboardCheck, Clock, Gauge, Plug, ShieldCheck, Truck, Building2, ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";

type Step = {
  name: string;
  owner: string;
  status: "Complete" | "In Progress" | "Blocked" | "Queued";
  due: string;
  dependsOn?: string;
};

const sequence: Step[] = [
  { name: "Service entrance ready (SER)", owner: "McDonald's GC · electrical", status: "Complete", due: "Aug 02" },
  { name: "Utility inspection #1 (rough)", owner: "PEPCO", status: "Complete", due: "Aug 05" },
  { name: "AHJ electrical rough-in", owner: "DCRA inspector", status: "Complete", due: "Aug 06" },
  { name: "Meter base verification", owner: "PermitPilot agent", status: "In Progress", due: "Aug 14", dependsOn: "AHJ electrical rough-in" },
  { name: "Release to utility (E-RLZ)", owner: "AHJ", status: "Queued", due: "Aug 15", dependsOn: "Meter base verification" },
  { name: "PEPCO meter set", owner: "PEPCO field crew", status: "Queued", due: "Aug 18", dependsOn: "Release to utility" },
  { name: "Energize kitchen + drive-thru", owner: "McDonald's commissioning", status: "Queued", due: "Aug 18" },
  { name: "TCO eligible", owner: "AHJ", status: "Queued", due: "Aug 20" },
];

const stats = [
  { label: "Project days to meter", value: "4 d", delta: "after release", icon: Clock },
  { label: "Release tracker", value: "2 of 4", delta: "AHJ items cleared", icon: ShieldCheck },
  { label: "PEPCO crew window", value: "Aug 18 AM", delta: "confirmed", icon: Truck },
  { label: "Blocking items", value: "0", delta: "all green", icon: CheckCircle2 },
];

const MeterSetChoreographer = () => (
  <div className="space-y-6 pb-12">
    <section className="flex flex-wrap items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3">
      <Building2 className="h-4 w-4 text-primary" />
      <div className="flex-1 min-w-[240px]">
        <div className="pilot-kicker text-primary">Active Site</div>
        <div className="font-tight text-sm font-bold text-foreground">McDonald's — 75 New York Ave NE · Washington DC</div>
      </div>
      <Link to="/utility/conflict-hunter" className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground hover:text-primary">← Conflicts</Link>
      <Link to="/scheduling/long-lead" className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-primary hover:underline">Next · Long-Lead <ArrowRight className="h-3 w-3" /></Link>
    </section>

    <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div>
        <div className="pilot-kicker text-primary">Utility Intelligence</div>
        <h1 className="mt-2 font-tight text-3xl font-black tracking-tight text-foreground md:text-4xl">Inspection &amp; Meter-Set Choreographer</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Sequence every inspection, release, and utility hand-off needed to land an energized
          meter on the project schedule. The agent re-runs the critical path every time a step
          ships or slips.
        </p>
      </div>
      <button className="pilot-button-primary"><CalendarCheck2 className="h-4 w-4" /> Confirm Aug 18 set</button>
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
          <div className="pilot-kicker text-primary">Choreographed sequence</div>
          <h2 className="mt-1 font-tight text-xl font-bold text-foreground">Critical path to energization</h2>
        </div>
        <ol className="divide-y divide-border">
          {sequence.map((s, i) => (
            <li key={s.name} className="flex items-start gap-4 p-5">
              <span className={`mt-0.5 flex h-8 w-8 flex-none items-center justify-center rounded-full border font-data text-xs font-semibold ${
                s.status === "Complete" ? "border-primary/40 bg-primary/15 text-primary"
                : s.status === "In Progress" ? "border-accent/40 bg-accent/15 text-accent-foreground"
                : s.status === "Blocked" ? "border-destructive/40 bg-destructive/10 text-destructive"
                : "border-border bg-muted text-muted-foreground"
              }`}>{i + 1}</span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-tight font-semibold text-foreground">{s.name}</span>
                  <span className="pilot-kicker">{s.status}</span>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">Owner · {s.owner}</div>
                {s.dependsOn && <div className="mt-0.5 text-xs text-muted-foreground">Depends on · {s.dependsOn}</div>}
              </div>
              <div className="text-right">
                <div className="pilot-kicker">Due</div>
                <div className="font-data text-sm text-foreground">{s.due}</div>
              </div>
            </li>
          ))}
        </ol>
      </div>

      <div className="space-y-5">
        <div className="pilot-card p-6">
          <div className="flex items-center gap-2 text-primary"><Plug className="h-5 w-5" /><span className="font-tight font-semibold">Meter spec</span></div>
          <dl className="mt-4 space-y-2 text-sm">
            {[
              ["Service", "800 A · 208 V · 3-phase (QSR-standard)"],
              ["Meter form", "Form 16S CT-rated"],
              ["CT cabinet", "PEPCO standard P-21"],
              ["Sealing party", "PEPCO field rep"],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between border-b border-border pb-1.5 last:border-0">
                <dt className="text-muted-foreground">{k}</dt>
                <dd className="font-data text-foreground">{v}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="pilot-card p-6">
          <div className="flex items-center gap-2 text-primary"><ClipboardCheck className="h-5 w-5" /><span className="font-tight font-semibold">Pre-set checklist</span></div>
          <ul className="mt-4 space-y-2 text-sm">
            {[
              "GFCI labels visible at service",
              "Working clearance ≥ 36 in",
              "Equipment grounding electrode certified",
              "Switchgear nameplate matches application",
              "Inspection card displayed on enclosure",
            ].map((item) => (
              <li key={item} className="flex items-start gap-2 text-foreground">
                <CheckCircle2 className="mt-0.5 h-4 w-4 flex-none text-primary" /> {item}
              </li>
            ))}
          </ul>
        </div>

        <div className="pilot-card p-6">
          <div className="flex items-center gap-2 text-primary"><Gauge className="h-5 w-5" /><span className="font-tight font-semibold">Energization window</span></div>
          <p className="mt-2 text-sm text-muted-foreground">If we slip past Aug 22, PEPCO re-queues at next regional cycle — adds 11 calendar days to McDonald's grand-open date.</p>
        </div>
      </div>
    </section>
  </div>
);

export default MeterSetChoreographer;