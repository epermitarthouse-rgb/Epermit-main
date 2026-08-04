import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, Bot, Filter, Inbox, Mail, MailCheck, Search, Sparkles } from "lucide-react";
import { Link } from "react-router-dom";
import { UciEmpty, UciLoading } from "@/components/permitpilot/UciStates";

type Msg = {
  id: string;
  from: string;
  subject: string;
  received: string;
  utility: string;
  intent: "Ack" | "RFI" | "Design comment" | "Class of Service" | "Fee estimate" | "Meter set";
  extracted: string[];
  linked: string;
  status: "Actioned" | "New" | "Waiting on us";
};

const msgs: Msg[] = [
  { id: "COM-8821", from: "commercial.services@pepco.com", subject: "RE: 75 NY Ave — Class of Service determination", received: "12m ago", utility: "PEPCO", intent: "Class of Service", extracted: ["Secondary 208Y/120V, 3ph", "800A pad-mount", "CIAC estimate to follow"], linked: "SUB-1041", status: "New" },
  { id: "COM-8817", from: "planner4@washgas.com", subject: "Additional info needed — Rockville MD", received: "38m ago", utility: "Washington Gas", intent: "RFI", extracted: ["Peak MBH load table", "Proposed regulator location", "Landowner signature page"], linked: "SUB-1037", status: "Waiting on us" },
  { id: "COM-8809", from: "bge.newservice@bge.com", subject: "Application received — BGE-X9920", received: "3h ago", utility: "BGE", intent: "Ack", extracted: ["Assigned to Planner J. Rivas", "Field survey window Jul 09–11"], linked: "SUB-1039", status: "Actioned" },
  { id: "COM-8802", from: "review@dominionenergy.com", subject: "Design comments — Ballston Quarter retail", received: "Yesterday", utility: "Dominion Energy", intent: "Design comment", extracted: ["Transformer clearance ≤ 3 ft violated", "Bollard placement required", "Grounding spec 8ft Cu-clad"], linked: "SUB-1034", status: "New" },
  { id: "COM-8794", from: "billing@pepco.com", subject: "Fee estimate — Langston Blvd", received: "2d ago", utility: "PEPCO", intent: "Fee estimate", extracted: ["CIAC $118,240", "Deposit due 30 days", "Refund schedule attached"], linked: "SUB-1030", status: "Waiting on us" },
];

const intentTone: Record<Msg["intent"], string> = {
  "Ack": "bg-success/10 text-success",
  "RFI": "bg-destructive/10 text-destructive",
  "Design comment": "bg-destructive/10 text-destructive",
  "Class of Service": "bg-primary/15 text-primary",
  "Fee estimate": "bg-pilot-cyan/10 text-pilot-cyan",
  "Meter set": "bg-pilot-cyan/10 text-pilot-cyan",
};

const kpis = [
  { label: "Inbox — 7d", value: "42", delta: "6 need reply", icon: Inbox },
  { label: "Auto-parsed", value: "96%", delta: "LLM extraction rate", icon: Bot },
  { label: "Median reply", value: "6.2h", delta: "vs 3.4d industry", icon: MailCheck },
  { label: "Escalations", value: "2", delta: "Rockville · Ballston", icon: AlertTriangle },
];

const UciCommunications = () => {
  const [query, setQuery] = useState("");
  const [utility, setUtility] = useState("all");
  const [intent, setIntent] = useState<string>("all");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setLoading(false), 500);
    return () => clearTimeout(t);
  }, []);
  const utilities = useMemo(() => Array.from(new Set(msgs.map((m) => m.utility))), []);
  const intents = useMemo(() => Array.from(new Set(msgs.map((m) => m.intent))), []);
  const filtered = msgs.filter((m) => {
    const q = query.trim().toLowerCase();
    const matchesQ = !q || [m.subject, m.from, m.utility, m.linked, ...m.extracted].some((v) => v.toLowerCase().includes(q));
    return matchesQ && (utility === "all" || m.utility === utility) && (intent === "all" || m.intent === intent);
  });
  if (loading) {
    return (
      <UciLoading
        kicker="Agent 5 · Utility Communication Parser"
        title="Utility Inbox"
        description="Parsing inbound utility messages and matching them to open submissions…"
      />
    );
  }
  return (
  <div className="space-y-6 pb-12">
    <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div>
        <div className="pilot-kicker text-primary">Agent 5 · Utility Communication Parser</div>
        <h1 className="mt-2 font-tight text-3xl font-black tracking-tight text-foreground md:text-4xl">Utility Inbox</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Every message from every utility, parsed for intent and merged with the corresponding submission so
          the deal record — not the email thread — is the source of truth.
        </p>
      </div>
      <div className="flex items-center gap-2">
        <button className="pilot-button-ghost"><Filter className="h-4 w-4" /> Filter</button>
        <button className="pilot-button-primary"><Sparkles className="h-4 w-4" /> Draft replies</button>
      </div>
    </header>

    <section className="pilot-card flex flex-wrap items-center gap-2 p-3">
      <div className="relative min-w-[240px] flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search subject, sender, extracted data…" className="w-full rounded-md border border-border bg-card py-2 pl-9 pr-3 text-xs text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none" />
      </div>
      <select value={utility} onChange={(e) => setUtility(e.target.value)} className="rounded-md border border-border bg-card px-3 py-2 text-xs text-foreground focus:border-primary focus:outline-none">
        <option value="all">All utilities</option>
        {utilities.map((u) => <option key={u} value={u}>{u}</option>)}
      </select>
      <select value={intent} onChange={(e) => setIntent(e.target.value)} className="rounded-md border border-border bg-card px-3 py-2 text-xs text-foreground focus:border-primary focus:outline-none">
        <option value="all">All intents</option>
        {intents.map((i) => <option key={i} value={i}>{i}</option>)}
      </select>
      {(query || utility !== "all" || intent !== "all") && (
        <button onClick={() => { setQuery(""); setUtility("all"); setIntent("all"); }} className="pilot-kicker text-muted-foreground hover:text-primary">Clear</button>
      )}
      <span className="pilot-kicker text-muted-foreground">{filtered.length}/{msgs.length}</span>
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
          icon={Mail}
          title="No messages match your filters"
          description="Adjust utility or intent, or clear the search to see the full inbox."
          onClear={() => { setQuery(""); setUtility("all"); setIntent("all"); }}
        />
      )}
      {filtered.map((m) => (
        <div key={m.id} className="p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-[280px] flex-1">
              <div className="flex items-center gap-2">
                <Mail className="h-3.5 w-3.5 text-primary" />
                <span className="pilot-kicker text-primary">{m.utility}</span>
                <span className={`inline-flex rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${intentTone[m.intent]}`}>{m.intent}</span>
                <span className="pilot-kicker text-muted-foreground">{m.received}</span>
              </div>
              <div className="mt-2 font-tight text-sm font-bold text-foreground">{m.subject}</div>
              <div className="mt-1 text-xs text-muted-foreground">{m.from}</div>
            </div>
            <div className="flex items-center gap-3">
              <Link to="/uci/submissions" className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground hover:text-primary">
                {m.linked} <ArrowRight className="ml-1 inline h-3 w-3" />
              </Link>
              <span className="pilot-kicker text-foreground">{m.status}</span>
            </div>
          </div>
          <div className="mt-3 grid gap-2 rounded-md border border-primary/20 bg-primary/5 p-3 md:grid-cols-3">
            {m.extracted.map((e) => (
              <div key={e} className="text-[11px] text-foreground"><Sparkles className="mr-1 inline h-3 w-3 text-primary" />{e}</div>
            ))}
          </div>
        </div>
      ))}
    </section>

    <section className="grid gap-5 lg:grid-cols-[1.2fr_1fr]">
      <div className="pilot-card p-5">
        <div className="pilot-kicker text-primary">Classification taxonomy</div>
        <h2 className="mt-1 font-tight text-lg font-bold text-foreground">11 message classes · deterministic routing</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Every inbound utility email is parsed into one of these classes. Each class carries a downstream
          agent, an SLA, and a default draft-response template.
        </p>
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {[
            { c: "acknowledgment",           agent: "Agent 4",  sla: "auto-file" },
            { c: "rfi",                      agent: "Agent 6",  sla: "reply ≤ 48h" },
            { c: "class_of_service_letter",  agent: "Agent 6",  sla: "reply ≤ 5 bd" },
            { c: "design_review_comments",   agent: "Agent 6",  sla: "reply ≤ 10 bd" },
            { c: "easement_document",        agent: "Agent 7",  sla: "route to counsel" },
            { c: "ciac_invoice",             agent: "Agent 8",  sla: "AP milestone" },
            { c: "meter_release_notification", agent: "Agent 10", sla: "confirm ≤ 24h" },
            { c: "inspection_release",       agent: "Agent 10", sla: "confirm ≤ 24h" },
            { c: "meter_scheduling",         agent: "Agent 11", sla: "book slot" },
            { c: "general_correspondence",   agent: "Agent 5",  sla: "manual triage" },
            { c: "unclassified",             agent: "human",    sla: "nightly review" },
          ].map((x) => (
            <div key={x.c} className="rounded-md border border-border bg-card/50 p-3">
              <div className="font-data text-[11px] uppercase tracking-wider text-primary">{x.c}</div>
              <div className="mt-1 flex items-center justify-between text-[11px]">
                <span className="text-foreground">{x.agent}</span>
                <span className="text-muted-foreground">{x.sla}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="pilot-card p-5">
        <div className="pilot-kicker text-primary">Inbound routing addresses</div>
        <h2 className="mt-1 font-tight text-lg font-bold text-foreground">One inbox per utility</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Postmark / SendGrid Inbound routes utility replies to a dedicated per-utility address so thread
          reassembly and project matching never miss.
        </p>
        <ul className="mt-4 space-y-2 text-xs">
          {[
            { u: "PEPCO",           addr: "pepco-inbound@permitpilot.com" },
            { u: "BGE",             addr: "bge-inbound@permitpilot.com" },
            { u: "Washington Gas",  addr: "wgl-inbound@permitpilot.com" },
            { u: "Dominion Energy", addr: "dominion-inbound@permitpilot.com" },
            { u: "DC Water / WSSC", addr: "water-inbound@permitpilot.com" },
            { u: "Outbound reply-to", addr: "uci-outbound@permitpilot.com" },
          ].map((x) => (
            <li key={x.u} className="flex items-center justify-between rounded-md border border-border bg-card/50 px-3 py-2">
              <span className="font-tight font-semibold text-foreground">{x.u}</span>
              <span className="font-data text-[11px] text-primary">{x.addr}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  </div>
  );
};

export default UciCommunications;