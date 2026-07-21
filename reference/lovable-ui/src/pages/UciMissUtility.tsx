import { useEffect, useMemo, useState } from "react";
import { AlertOctagon, CalendarClock, Filter, MapPin, Search, Shovel, Ticket, TimerReset } from "lucide-react";
import { UciEmpty, UciLoading } from "@/components/permitpilot/UciStates";

type MU = {
  ticket: string;
  project: string;
  address: string;
  type: "Normal" | "Emergency" | "Design" | "Update";
  requested: string;
  responseDue: string;
  status: "Open" | "Marked" | "Expired" | "Cancelled";
  responders: { utility: string; status: "Clear" | "Marked" | "No response" }[];
};

const tickets: MU[] = [
  {
    ticket: "MU-2026-118821",
    project: "McDonald's · 75 NY Ave NE",
    address: "75 New York Ave NE, Washington DC",
    type: "Normal",
    requested: "Jul 06 · 08:12",
    responseDue: "Jul 09 · 07:00",
    status: "Marked",
    responders: [
      { utility: "PEPCO", status: "Marked" },
      { utility: "Washington Gas", status: "Marked" },
      { utility: "DC Water", status: "Marked" },
      { utility: "Verizon", status: "Clear" },
      { utility: "Comcast", status: "No response" },
    ],
  },
  {
    ticket: "MU-2026-118803",
    project: "Wonder · Federal Hill",
    address: "1200 Light St, Baltimore MD",
    type: "Design",
    requested: "Jul 05 · 14:40",
    responseDue: "Jul 15 · 14:40",
    status: "Open",
    responders: [
      { utility: "BGE", status: "Clear" },
      { utility: "Baltimore DPW", status: "No response" },
      { utility: "Verizon", status: "Marked" },
    ],
  },
  {
    ticket: "MU-2026-118754",
    project: "Langston Blvd · Multifamily",
    address: "5600 Langston Blvd, Arlington VA",
    type: "Emergency",
    requested: "Jul 03 · 22:05",
    responseDue: "Jul 04 · 04:05",
    status: "Marked",
    responders: [
      { utility: "Dominion Energy", status: "Marked" },
      { utility: "Washington Gas", status: "Marked" },
      { utility: "Arlington DES", status: "Marked" },
    ],
  },
  {
    ticket: "MU-2026-118610",
    project: "Retail · Ballston Quarter",
    address: "4238 Wilson Blvd, Arlington VA",
    type: "Normal",
    requested: "Jun 27 · 09:20",
    responseDue: "Jun 30 · 07:00",
    status: "Expired",
    responders: [
      { utility: "Dominion Energy", status: "Marked" },
      { utility: "Comcast", status: "No response" },
      { utility: "Verizon", status: "No response" },
    ],
  },
];

const kpis = [
  { label: "Open tickets", value: "5", delta: "2 emergencies YTD", icon: Ticket },
  { label: "On-time responder rate", value: "88%", delta: "vs 71% state avg", icon: TimerReset },
  { label: "No-shows chased", value: "7", delta: "auto re-notify @ +24h", icon: AlertOctagon },
  { label: "Excavations cleared", value: "34", delta: "YTD across portfolio", icon: Shovel },
];

const responderTone = {
  "Clear": "text-success",
  "Marked": "text-primary",
  "No response": "text-destructive",
} as const;

const typeTone = {
  "Normal": "bg-pilot-cyan/10 text-pilot-cyan",
  "Emergency": "bg-destructive/10 text-destructive",
  "Design": "bg-primary/15 text-primary",
  "Update": "bg-muted text-muted-foreground",
} as const;

const statusTone = {
  "Open": "bg-pilot-cyan/10 text-pilot-cyan",
  "Marked": "bg-success/10 text-success",
  "Expired": "bg-destructive/10 text-destructive",
  "Cancelled": "bg-muted text-muted-foreground",
} as const;

const UciMissUtility = () => {
  const [query, setQuery] = useState("");
  const [type, setType] = useState("all");
  const [status, setStatus] = useState("all");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setLoading(false), 500);
    return () => clearTimeout(t);
  }, []);
  const types = useMemo(() => Array.from(new Set(tickets.map((t) => t.type))), []);
  const statuses = useMemo(() => Array.from(new Set(tickets.map((t) => t.status))), []);
  const filtered = tickets.filter((t) => {
    const q = query.trim().toLowerCase();
    const matchesQ = !q || [t.ticket, t.project, t.address, ...t.responders.map((r) => r.utility)].some((v) => v.toLowerCase().includes(q));
    return matchesQ && (type === "all" || t.type === type) && (status === "all" || t.status === status);
  });
  if (loading) {
    return (
      <UciLoading
        kicker="Side quest · Miss Utility 811 Coordinator"
        title="Miss Utility · 811 Tickets"
        description="Loading one-call tickets and responder matrices across DC, MD, and VA…"
      />
    );
  }
  return (
  <div className="space-y-6 pb-12">
    <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div>
        <div className="pilot-kicker text-primary">Side quest · Miss Utility 811 Coordinator</div>
        <h1 className="mt-2 font-tight text-3xl font-black tracking-tight text-foreground md:text-4xl">Miss Utility · 811 Tickets</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Every one-call ticket per project — Normal, Emergency, Design, or Update — with the response
          matrix of every notified utility. No-shows auto-escalate; expired tickets re-file automatically.
        </p>
      </div>
      <div className="flex items-center gap-2">
        <button className="pilot-button-ghost"><Filter className="h-4 w-4" /> Filter</button>
        <button className="pilot-button-primary"><Ticket className="h-4 w-4" /> File ticket</button>
      </div>
    </header>

    <section className="pilot-card flex flex-wrap items-center gap-2 p-3">
      <div className="relative min-w-[240px] flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search ticket #, project, address, responder…" className="w-full rounded-md border border-border bg-card py-2 pl-9 pr-3 text-xs text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none" />
      </div>
      <select value={type} onChange={(e) => setType(e.target.value)} className="rounded-md border border-border bg-card px-3 py-2 text-xs text-foreground focus:border-primary focus:outline-none">
        <option value="all">All types</option>
        {types.map((t) => <option key={t} value={t}>{t}</option>)}
      </select>
      <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-md border border-border bg-card px-3 py-2 text-xs text-foreground focus:border-primary focus:outline-none">
        <option value="all">All statuses</option>
        {statuses.map((s) => <option key={s} value={s}>{s}</option>)}
      </select>
      {(query || type !== "all" || status !== "all") && (
        <button onClick={() => { setQuery(""); setType("all"); setStatus("all"); }} className="pilot-kicker text-muted-foreground hover:text-primary">Clear</button>
      )}
      <span className="pilot-kicker text-muted-foreground">{filtered.length}/{tickets.length}</span>
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

    <section className="pilot-card divide-y divide-border">
      {filtered.length === 0 && (
        <UciEmpty
          icon={Ticket}
          title="No 811 tickets match your filters"
          description="Try a different ticket type or status, or clear the search."
          onClear={() => { setQuery(""); setType("all"); setStatus("all"); }}
        />
      )}
      {filtered.map((t) => (
        <div key={t.ticket} className="p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="font-data text-xs uppercase tracking-wider text-primary">{t.ticket}</span>
                <span className={`inline-flex rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${typeTone[t.type]}`}>{t.type}</span>
                <span className={`inline-flex rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${statusTone[t.status]}`}>{t.status}</span>
              </div>
              <div className="mt-1 font-tight text-sm font-bold text-foreground">{t.project}</div>
              <div className="mt-1 text-xs text-muted-foreground"><MapPin className="mr-1 inline h-3 w-3" />{t.address}</div>
            </div>
            <div className="text-right text-[11px] text-muted-foreground">
              <div><CalendarClock className="mr-1 inline h-3 w-3 text-primary" />Requested {t.requested}</div>
              <div className="mt-0.5">Response due {t.responseDue}</div>
            </div>
          </div>
          <div className="mt-3 grid gap-2 rounded-md border border-border bg-card/50 p-3 sm:grid-cols-2 md:grid-cols-3">
            {t.responders.map((r) => (
              <div key={r.utility} className="flex items-center justify-between text-[11px]">
                <span className="text-foreground">{r.utility}</span>
                <span className={`font-data uppercase tracking-wider ${responderTone[r.status]}`}>{r.status}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </section>

    <section className="grid gap-5 lg:grid-cols-[1fr_1fr]">
      <div className="pilot-card p-5">
        <div className="pilot-kicker text-primary">One-call jurisdictions</div>
        <h2 className="mt-1 font-tight text-lg font-bold text-foreground">DMV coverage · ITIC-connected</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Miss Utility 811 is the only utility channel with a publicly documented API (ITIC for professional
          users). UCI files, re-tickets, and reads positive responses through it.
        </p>
        <table className="mt-4 w-full text-xs">
          <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="pb-2 text-left">One-call center</th>
              <th className="pb-2 text-left">Ticket life</th>
              <th className="pb-2 text-left">Response SLA</th>
              <th className="pb-2 text-left">Integration</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {[
              { c: "DC One Call",     life: "10 business days",   sla: "48h", i: "ITIC" },
              { c: "Maryland 811",    life: "12 business days",   sla: "48h", i: "ITIC" },
              { c: "Virginia 811",    life: "15 business days",   sla: "48h", i: "ITIC + VUPS portal" },
              { c: "Design tickets",  life: "21 business days",   sla: "10 bd", i: "Portal upload" },
            ].map((r) => (
              <tr key={r.c}>
                <td className="py-2 font-tight font-semibold text-foreground">{r.c}</td>
                <td className="py-2 font-data text-muted-foreground">{r.life}</td>
                <td className="py-2 font-data text-foreground">{r.sla}</td>
                <td className="py-2 text-primary">{r.i}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="pilot-card p-5">
        <div className="pilot-kicker text-primary">Ticket lifecycle rules</div>
        <h2 className="mt-1 font-tight text-lg font-bold text-foreground">Auto re-file · auto-escalate</h2>
        <ul className="mt-4 space-y-3 text-xs">
          {[
            { k: "Positive response tracker", d: "Reads ITIC feed every 4h; flags any utility that hasn't marked before excavation date." },
            { k: "Expiration re-ticket",       d: "T-48h before ticket lapses UCI opens an update ticket if excavation still pending." },
            { k: "Emergency escalation",       d: "Emergency type triggers 2h response SLA; UCI phones the operator if no response by +90m." },
            { k: "Design ticket handoff",      d: "Design tickets attach mark-up drawings to project record; feed conflict hunter (§8.2)." },
            { k: "GC dispatch confirmation",   d: "GC superintendent gets SMS + inbox before the excavation date is legal." },
          ].map((x) => (
            <li key={x.k} className="rounded-md border border-border bg-card/50 p-3">
              <div className="font-tight text-xs font-bold text-foreground">{x.k}</div>
              <div className="mt-1 text-[11px] text-muted-foreground">{x.d}</div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  </div>
  );
};

export default UciMissUtility;