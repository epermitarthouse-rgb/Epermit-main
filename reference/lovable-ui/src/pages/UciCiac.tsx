import { useEffect, useMemo, useState } from "react";
import { Banknote, CalendarClock, CheckCircle2, DollarSign, Receipt, Search, TrendingDown, Undo2 } from "lucide-react";
import { UciEmptyRow, UciLoading } from "@/components/permitpilot/UciStates";

type Ciac = {
  id: string;
  project: string;
  utility: string;
  estimate: number;
  actual: number | null;
  deposit: string;
  refundable: number;
  refundWindow: string;
  status: "Estimated" | "Deposit received" | "Deposit paid" | "Refunded" | "Reconciled";
  nextAction: string;
};

const rows: Ciac[] = [
  { id: "CIAC-771", project: "McDonald's · 75 NY Ave NE", utility: "PEPCO", estimate: 118240, actual: null, deposit: "30 days from letter", refundable: 42000, refundWindow: "5 yr contribution formula", status: "Estimated", nextAction: "Send deposit request to client CFO" },
  { id: "CIAC-768", project: "Wonder · Federal Hill", utility: "BGE", estimate: 247880, actual: 251140, deposit: "Paid Jun 12, 2026", refundable: 96000, refundWindow: "10 yr load-based", status: "Deposit paid", nextAction: "Track load ramp for refund eligibility" },
  { id: "CIAC-762", project: "Retail · Ballston Quarter", utility: "Dominion Energy", estimate: 41200, actual: 39980, deposit: "Paid May 04, 2026", refundable: 0, refundWindow: "Non-refundable", status: "Reconciled", nextAction: "Close cost line — variance -3.0%" },
  { id: "CIAC-758", project: "Langston Blvd · Multifamily", utility: "PEPCO", estimate: 118000, actual: 121400, deposit: "Paid Apr 22, 2026", refundable: 38000, refundWindow: "5 yr contribution formula", status: "Deposit paid", nextAction: "Refund milestone Y1 · Apr 2027" },
];

const fmt = (n: number | null) => (n == null ? "—" : n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }));

const totals = rows.reduce(
  (a, r) => ({ est: a.est + r.estimate, act: a.act + (r.actual ?? 0), ref: a.ref + r.refundable }),
  { est: 0, act: 0, ref: 0 },
);

const kpis = [
  { label: "Portfolio CIAC exposure", value: fmt(totals.est), delta: `${rows.length} active deals`, icon: DollarSign },
  { label: "Deposits paid", value: fmt(totals.act), delta: "vs estimates", icon: Banknote },
  { label: "Refundable pool", value: fmt(totals.ref), delta: "over 5–10 yr windows", icon: Undo2 },
  { label: "Variance vs estimate", value: "-0.4%", delta: "trailing 12 deals", icon: TrendingDown },
];

const badge = {
  "Estimated": "bg-pilot-cyan/10 text-pilot-cyan",
  "Deposit received": "bg-pilot-cyan/10 text-pilot-cyan",
  "Deposit paid": "bg-primary/15 text-primary",
  "Refunded": "bg-success/10 text-success",
  "Reconciled": "bg-success/10 text-success",
} as const;

const UciCiac = () => {
  const [query, setQuery] = useState("");
  const [utility, setUtility] = useState("all");
  const [status, setStatus] = useState("all");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setLoading(false), 500);
    return () => clearTimeout(t);
  }, []);
  const utilities = useMemo(() => Array.from(new Set(rows.map((r) => r.utility))), []);
  const statuses = useMemo(() => Array.from(new Set(rows.map((r) => r.status))), []);
  const filtered = rows.filter((r) => {
    const q = query.trim().toLowerCase();
    const matchesQ = !q || [r.project, r.utility, r.id, r.deposit, r.refundWindow, r.nextAction].some((v) => v.toLowerCase().includes(q));
    return matchesQ && (utility === "all" || r.utility === utility) && (status === "all" || r.status === status);
  });
  if (loading) {
    return (
      <UciLoading
        kicker="Agent 8 · CIAC & Refund Tracker"
        title="Contributions in Aid of Construction"
        description="Loading estimates, deposits, actuals, and refundable pools across the portfolio…"
      />
    );
  }
  return (
  <div className="space-y-6 pb-12">
    <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div>
        <div className="pilot-kicker text-primary">Agent 8 · CIAC & Refund Tracker</div>
        <h1 className="mt-2 font-tight text-3xl font-black tracking-tight text-foreground md:text-4xl">Contributions in Aid of Construction</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Full-lifecycle ledger for every utility CIAC — estimate, deposit, actual, and refundable pool. No
          more surprise capital calls; no more forgotten refunds five years after energization.
        </p>
      </div>
      <button className="pilot-button-primary"><Receipt className="h-4 w-4" /> Export ledger</button>
    </header>

    <section className="pilot-card flex flex-wrap items-center gap-2 p-3">
      <div className="relative min-w-[240px] flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search deal, utility, next action…" className="w-full rounded-md border border-border bg-card py-2 pl-9 pr-3 text-xs text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none" />
      </div>
      <select value={utility} onChange={(e) => setUtility(e.target.value)} className="rounded-md border border-border bg-card px-3 py-2 text-xs text-foreground focus:border-primary focus:outline-none">
        <option value="all">All utilities</option>
        {utilities.map((u) => <option key={u} value={u}>{u}</option>)}
      </select>
      <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-md border border-border bg-card px-3 py-2 text-xs text-foreground focus:border-primary focus:outline-none">
        <option value="all">All statuses</option>
        {statuses.map((s) => <option key={s} value={s}>{s}</option>)}
      </select>
      {(query || utility !== "all" || status !== "all") && (
        <button onClick={() => { setQuery(""); setUtility("all"); setStatus("all"); }} className="pilot-kicker text-muted-foreground hover:text-primary">Clear</button>
      )}
      <span className="pilot-kicker text-muted-foreground">{filtered.length}/{rows.length}</span>
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

    <section className="pilot-card overflow-hidden">
      <div className="border-b border-border px-5 py-4">
        <div className="pilot-kicker text-primary">CIAC ledger</div>
        <h2 className="mt-1 font-tight text-lg font-bold text-foreground">{filtered.length} of {rows.length} deals · reconciled quarterly</h2>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-muted/40 text-[10px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-5 py-3 text-left">Deal</th>
              <th className="px-5 py-3 text-left">Utility</th>
              <th className="px-5 py-3 text-right">Estimate</th>
              <th className="px-5 py-3 text-right">Actual</th>
              <th className="px-5 py-3 text-left">Deposit</th>
              <th className="px-5 py-3 text-right">Refundable</th>
              <th className="px-5 py-3 text-left">Window</th>
              <th className="px-5 py-3 text-left">Status</th>
              <th className="px-5 py-3 text-left">Next action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filtered.length === 0 && (
              <UciEmptyRow
                colSpan={9}
                title="No CIAC deals match your filters"
                description="Try a different utility or status, or clear the search."
                onClear={() => { setQuery(""); setUtility("all"); setStatus("all"); }}
              />
            )}
            {filtered.map((r) => (
              <tr key={r.id} className="hover:bg-muted/30">
                <td className="px-5 py-3 font-tight font-semibold text-foreground">{r.project}</td>
                <td className="px-5 py-3 text-muted-foreground">{r.utility}</td>
                <td className="px-5 py-3 text-right font-data text-foreground">{fmt(r.estimate)}</td>
                <td className="px-5 py-3 text-right font-data text-foreground">{fmt(r.actual)}</td>
                <td className="px-5 py-3 font-data text-[11px] text-foreground"><CalendarClock className="mr-1 inline h-3 w-3 text-primary" />{r.deposit}</td>
                <td className="px-5 py-3 text-right font-data text-primary">{fmt(r.refundable)}</td>
                <td className="px-5 py-3 text-muted-foreground">{r.refundWindow}</td>
                <td className="px-5 py-3"><span className={`inline-flex rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${badge[r.status]}`}>{r.status === "Reconciled" ? <><CheckCircle2 className="mr-1 inline h-3 w-3" />Done</> : r.status}</span></td>
                <td className="px-5 py-3 text-foreground">{r.nextAction}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>

    <section className="grid gap-5 lg:grid-cols-[1.2fr_1fr]">
      <div className="pilot-card p-5">
        <div className="pilot-kicker text-primary">Itemized breakdown · McDonald's 75 NY Ave NE</div>
        <h2 className="mt-1 font-tight text-lg font-bold text-foreground">CIAC line items · PEPCO CIAC-771</h2>
        <table className="mt-4 w-full text-xs">
          <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="pb-2 text-left">Line item</th>
              <th className="pb-2 text-right">Estimate</th>
              <th className="pb-2 text-right">Refundable</th>
              <th className="pb-2 text-left">Note</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {[
              { k: "500 kVA pad-mount transformer", est: 48000, ref: 22000, n: "PEPCO-supplied" },
              { k: "Primary feeder extension (410 ft)", est: 32400, ref: 12000, n: "Shared with 1400 K St" },
              { k: "Service drop + secondary",         est: 12800, ref: 4200,  n: "Customer trench" },
              { k: "Meter + CT cabinet",               est: 6200,  ref: 0,     n: "Non-refundable" },
              { k: "Engineering + design review",      est: 14400, ref: 0,     n: "Fixed fee" },
              { k: "ROW / vault reuse credit",         est: 4440,  ref: 3800,  n: "Credit vs. new vault" },
            ].map((r) => (
              <tr key={r.k}>
                <td className="py-2 text-foreground">{r.k}</td>
                <td className="py-2 text-right font-data text-foreground">{fmt(r.est)}</td>
                <td className="py-2 text-right font-data text-primary">{fmt(r.ref)}</td>
                <td className="py-2 text-[11px] text-muted-foreground">{r.n}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-border">
              <td className="pt-3 font-tight text-foreground">Total</td>
              <td className="pt-3 text-right font-data font-bold text-foreground">{fmt(118240)}</td>
              <td className="pt-3 text-right font-data font-bold text-primary">{fmt(42000)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="pilot-card p-5">
        <div className="pilot-kicker text-primary">Payment lifecycle</div>
        <h2 className="mt-1 font-tight text-lg font-bold text-foreground">Invoice → wired · QuickBooks synced</h2>
        <ol className="mt-4 space-y-3">
          {[
            { s: "CIAC invoice received",      d: "Agent 5 parses PDF", done: true },
            { s: "Milestone created in QuickBooks", d: "Auto — Agent 8", done: true },
            { s: "Customer AP approval",       d: "Awaiting CFO countersign", done: false, current: true },
            { s: "Wire/check dispatched",      d: "Treasury queue", done: false },
            { s: "Utility confirms receipt",   d: "Agent 5 auto-detects", done: false },
            { s: "Refund milestones opened",   d: "5–10 yr contribution formula", done: false },
          ].map((x, i) => (
            <li key={x.s} className="grid grid-cols-[20px_1fr] gap-3">
              <div className="flex flex-col items-center">
                <CheckCircle2 className={`h-4 w-4 ${x.done ? "text-success" : x.current ? "text-primary" : "text-muted-foreground/40"}`} />
                {i < 5 && <div className="mt-1 h-full w-px flex-1 bg-border" />}
              </div>
              <div className={`rounded-md border p-3 ${x.current ? "border-primary/40 bg-primary/5" : "border-border bg-card/50"}`}>
                <div className="font-tight text-xs font-bold text-foreground">{x.s}</div>
                <div className="text-[11px] text-muted-foreground">{x.d}</div>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  </div>
  );
};

export default UciCiac;