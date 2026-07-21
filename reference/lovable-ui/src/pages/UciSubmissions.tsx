import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Clock, Filter, Globe, Inbox, Mail, Radio, RefreshCw, Search, Send, TimerReset } from "lucide-react";
import { Link } from "react-router-dom";
import { UciEmptyRow, UciLoading } from "@/components/permitpilot/UciStates";

type Row = {
  id: string;
  utility: string;
  project: string;
  submittedAt: string;
  ackSlaDays: number;
  ackReceivedAt: string | null;
  requestNumber: string | null;
  nextMilestone: string;
  nextEta: string;
  status: "acked" | "waiting" | "breached";
};

const rows: Row[] = [
  { id: "SUB-1041", utility: "PEPCO", project: "McDonald's · 75 NY Ave NE", submittedAt: "Jun 24, 2026", ackSlaDays: 5, ackReceivedAt: "Jun 27, 2026", requestNumber: "2024-U771", nextMilestone: "Class of Service letter", nextEta: "Jul 15 · ±4d", status: "acked" },
  { id: "SUB-1039", utility: "BGE", project: "Wonder · Federal Hill", submittedAt: "Jun 18, 2026", ackSlaDays: 5, ackReceivedAt: "Jun 22, 2026", requestNumber: "BGE-X9920", nextMilestone: "Field survey scheduling", nextEta: "Jul 09 · ±3d", status: "acked" },
  { id: "SUB-1037", utility: "Washington Gas", project: "McDonald's · Rockville MD", submittedAt: "Jun 12, 2026", ackSlaDays: 5, ackReceivedAt: null, requestNumber: null, nextMilestone: "Acknowledgment overdue", nextEta: "Escalate today", status: "breached" },
  { id: "SUB-1034", utility: "Dominion Energy", project: "Retail · Ballston Quarter", submittedAt: "Jul 01, 2026", ackSlaDays: 5, ackReceivedAt: null, requestNumber: null, nextMilestone: "Awaiting utility intake", nextEta: "Jul 08 · SLA", status: "waiting" },
  { id: "SUB-1030", utility: "PEPCO", project: "Langston Blvd · Multifamily", submittedAt: "May 28, 2026", ackSlaDays: 5, ackReceivedAt: "Jun 03, 2026", requestNumber: "2024-U702", nextMilestone: "Class of Service letter", nextEta: "Jul 10 · ±5d", status: "acked" },
];

const kpis = [
  { label: "Avg days to ack", value: "3.6", delta: "Target ≤ 5 bd", icon: TimerReset },
  { label: "Within-SLA rate", value: "94%", delta: "12 of last 13", icon: CheckCircle2 },
  { label: "Open acknowledgments", value: "2", delta: "1 breached · 1 in window", icon: Inbox },
  { label: "Weekly submissions", value: "7", delta: "PEPCO · BGE · WGL · Dominion", icon: Send },
];

const badge = {
  acked: "bg-success/10 text-success",
  waiting: "bg-pilot-cyan/10 text-pilot-cyan",
  breached: "bg-destructive/10 text-destructive",
} as const;

const portals: { utility: string; channel: string; type: "web_form" | "pdf_email" | "phone_only"; fallback: string; ackSla: string }[] = [
  { utility: "PEPCO",            channel: "Application Center portal",            type: "web_form",  fallback: "Playwright script → email draft on script failure",       ackSla: "3–5 business days" },
  { utility: "BGE",              channel: "BGE Online commercial application",    type: "web_form",  fallback: "Session-token aware Playwright; email attach fallback",    ackSla: "3–7 business days" },
  { utility: "Washington Gas",   channel: "Builder Information Form via email",   type: "pdf_email", fallback: "PDF package to gasplanning@washgas.com + phone confirm",   ackSla: "5–10 business days" },
  { utility: "Dominion Energy",  channel: "Commercial service web form + PM",     type: "web_form",  fallback: "Web form automation; PM contact remains human",            ackSla: "5–7 business days" },
  { utility: "NOVEC / SMECO",    channel: "Cooperative — email + phone",          type: "pdf_email", fallback: "Agent prepares packet; PM submits and calls",              ackSla: "5–10 business days" },
  { utility: "DC Water / WSSC",  channel: "Portal + email hybrid",                type: "web_form",  fallback: "Web automation + inbound email parser",                    ackSla: "7–14 business days" },
];

const lifecycle = [
  { n: 1, label: "Project init & load planning",       state: "done" },
  { n: 2, label: "Pre-application engagement",         state: "done" },
  { n: 3, label: "Formal service application",         state: "current" },
  { n: 4, label: "Class of Service determination",     state: "next" },
  { n: 5, label: "Customer drawings & switchgear",     state: "pending" },
  { n: 6, label: "Easement & ROW",                     state: "pending" },
  { n: 7, label: "CIAC & contract execution",          state: "pending" },
  { n: 8, label: "Construction & installation",        state: "pending" },
  { n: 9, label: "Inspection & meter release",         state: "pending" },
  { n: 10, label: "Meter set & energization",          state: "pending" },
] as const;

const stageTone: Record<string, string> = {
  done: "border-success/40 bg-success/5 text-success",
  current: "border-primary/50 bg-primary/10 text-primary",
  next: "border-pilot-cyan/40 bg-pilot-cyan/5 text-pilot-cyan",
  pending: "border-border bg-card text-muted-foreground",
};

const UciSubmissions = () => {
  const [query, setQuery] = useState("");
  const [utility, setUtility] = useState("all");
  const [status, setStatus] = useState("all");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setLoading(false), 500);
    return () => clearTimeout(t);
  }, []);
  const utilities = useMemo(() => Array.from(new Set(rows.map((r) => r.utility))), []);
  const filtered = rows.filter((r) => {
    const q = query.trim().toLowerCase();
    const matchesQ = !q || [r.project, r.utility, r.id, r.requestNumber ?? "", r.nextMilestone].some((v) => v.toLowerCase().includes(q));
    const matchesU = utility === "all" || r.utility === utility;
    const matchesS = status === "all" || r.status === status;
    return matchesQ && matchesU && matchesS;
  });
  if (loading) {
    return (
      <UciLoading
        kicker="Agent 4 · Submission & Confirmation Tracker"
        title="Utility Submissions"
        description="Loading in-flight applications, acknowledgment SLAs, and utility-assigned request numbers…"
      />
    );
  }
  return (
  <div className="space-y-6 pb-12">
    <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div>
        <div className="pilot-kicker text-primary">Agent 4 · Submission & Confirmation Tracker</div>
        <h1 className="mt-2 font-tight text-3xl font-black tracking-tight text-foreground md:text-4xl">Utility Submissions</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Every commercial service application filed to a utility, its acknowledgment SLA, the utility-assigned
          request number, and the projected next milestone. Breaches escalate automatically.
        </p>
      </div>
      <div className="flex items-center gap-2">
        <button className="pilot-button-ghost"><Filter className="h-4 w-4" /> Filter</button>
        <button className="pilot-button-primary"><RefreshCw className="h-4 w-4" /> Poll utilities</button>
      </div>
    </header>

    <section className="pilot-card flex flex-wrap items-center gap-2 p-3">
      <div className="relative min-w-[240px] flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search project, utility, request #, milestone…" className="w-full rounded-md border border-border bg-card py-2 pl-9 pr-3 text-xs text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none" />
      </div>
      <select value={utility} onChange={(e) => setUtility(e.target.value)} className="rounded-md border border-border bg-card px-3 py-2 text-xs text-foreground focus:border-primary focus:outline-none">
        <option value="all">All utilities</option>
        {utilities.map((u) => <option key={u} value={u}>{u}</option>)}
      </select>
      <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-md border border-border bg-card px-3 py-2 text-xs text-foreground focus:border-primary focus:outline-none">
        <option value="all">All statuses</option>
        <option value="acked">Acked</option>
        <option value="waiting">Waiting</option>
        <option value="breached">Breached</option>
      </select>
      {(query || utility !== "all" || status !== "all") && (
        <button onClick={() => { setQuery(""); setUtility("all"); setStatus("all"); }} className="pilot-kicker text-muted-foreground hover:text-primary">Clear</button>
      )}
    </section>

    <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {kpis.map((k) => (
        <div key={k.label} className="pilot-card p-5">
          <div className="flex items-center justify-between">
            <div className="pilot-kicker">{k.label}</div>
            <k.icon className="h-4 w-4 text-primary" />
          </div>
          <div className="mt-3 font-data text-2xl font-semibold text-foreground">{k.value}</div>
          <div className="mt-1 text-xs text-muted-foreground">{k.delta}</div>
        </div>
      ))}
    </section>

    <section className="pilot-card overflow-hidden">
      <div className="flex items-center justify-between border-b border-border px-5 py-4">
        <div>
          <div className="pilot-kicker text-primary">In-flight applications</div>
          <h2 className="mt-1 font-tight text-lg font-bold text-foreground">{filtered.length} of {rows.length} rows · sorted by submitted date</h2>
        </div>
        <Link to="/uci/communications" className="text-[10px] font-bold uppercase tracking-wider text-primary hover:underline">
          View inbox →
        </Link>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-muted/40 text-[10px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-5 py-3 text-left">Utility</th>
              <th className="px-5 py-3 text-left">Project</th>
              <th className="px-5 py-3 text-left">Submitted</th>
              <th className="px-5 py-3 text-left">SLA</th>
              <th className="px-5 py-3 text-left">Ack received</th>
              <th className="px-5 py-3 text-left">Request #</th>
              <th className="px-5 py-3 text-left">Next milestone · ETA</th>
              <th className="px-5 py-3 text-left">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filtered.length === 0 && (
              <UciEmptyRow
                colSpan={8}
                title="No submissions match your filters"
                description="Try a different utility, status, or clear the search."
                onClear={() => { setQuery(""); setUtility("all"); setStatus("all"); }}
              />
            )}
            {filtered.map((r) => (
              <tr key={r.id} className="hover:bg-muted/30">
                <td className="px-5 py-3 font-tight font-semibold text-foreground"><Radio className="mr-1.5 inline h-3 w-3 text-primary" /> {r.utility}</td>
                <td className="px-5 py-3 text-muted-foreground">{r.project}</td>
                <td className="px-5 py-3 font-data text-[11px] text-foreground">{r.submittedAt}</td>
                <td className="px-5 py-3 font-data text-[11px] text-muted-foreground">≤ {r.ackSlaDays} bd</td>
                <td className="px-5 py-3 font-data text-[11px] text-foreground">{r.ackReceivedAt ?? <span className="text-muted-foreground">—</span>}</td>
                <td className="px-5 py-3 font-data text-[11px] text-foreground">{r.requestNumber ?? <span className="text-muted-foreground">pending</span>}</td>
                <td className="px-5 py-3">
                  <div className="text-foreground">{r.nextMilestone}</div>
                  <div className="font-data text-[10px] uppercase tracking-wider text-muted-foreground"><Clock className="mr-1 inline h-3 w-3" />{r.nextEta}</div>
                </td>
                <td className="px-5 py-3">
                  <span className={`inline-flex rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${badge[r.status]}`}>{r.status}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>

    <section className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
      <div className="pilot-card overflow-hidden">
        <div className="border-b border-border px-5 py-4">
          <div className="pilot-kicker text-primary">Portal integration matrix</div>
          <h2 className="mt-1 font-tight text-lg font-bold text-foreground">Portal-aware, never portal-dependent</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            No investor-owned utility exposes a real commercial API. Every submission path has an email-first
            fallback so a portal HTML change never stalls a project.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-muted/40 text-[10px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-5 py-3 text-left">Utility</th>
                <th className="px-5 py-3 text-left">Primary channel</th>
                <th className="px-5 py-3 text-left">Type</th>
                <th className="px-5 py-3 text-left">Fallback</th>
                <th className="px-5 py-3 text-left">Ack SLA</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {portals.map((p) => (
                <tr key={p.utility} className="hover:bg-muted/30">
                  <td className="px-5 py-3 font-tight font-semibold text-foreground">
                    {p.type === "pdf_email" ? <Mail className="mr-1.5 inline h-3 w-3 text-primary" /> : <Globe className="mr-1.5 inline h-3 w-3 text-primary" />}
                    {p.utility}
                  </td>
                  <td className="px-5 py-3 text-muted-foreground">{p.channel}</td>
                  <td className="px-5 py-3 font-data text-[10px] uppercase tracking-wider text-foreground">{p.type}</td>
                  <td className="px-5 py-3 text-foreground">{p.fallback}</td>
                  <td className="px-5 py-3 font-data text-[11px] text-muted-foreground">{p.ackSla}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="pilot-card p-5">
        <div className="pilot-kicker text-primary">10-stage utility lifecycle</div>
        <h2 className="mt-1 font-tight text-lg font-bold text-foreground">Submission sits at stage 3</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Every project moves through the same industry-standard sequence, synthesized from PEPCO, BGE, WGL,
          and Dominion commercial developer manuals.
        </p>
        <ol className="mt-4 space-y-2">
          {lifecycle.map((s) => (
            <li key={s.n} className={`flex items-center justify-between rounded-md border px-3 py-2 text-xs ${stageTone[s.state]}`}>
              <span className="flex items-center gap-2">
                <span className="font-data text-[10px] uppercase tracking-wider">Stage {s.n}</span>
                <span className="font-tight font-semibold">{s.label}</span>
              </span>
              <span className="font-data text-[10px] uppercase tracking-wider">{s.state}</span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  </div>
  );
};

export default UciSubmissions;