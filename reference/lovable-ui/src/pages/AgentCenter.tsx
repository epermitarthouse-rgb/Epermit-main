import { Bell, Brain, Cable, Clock, CloudRain, FileText, GaugeCircle, Layers, Play, Plug, Radio, ScrollText, Search, Siren, Wallet } from "lucide-react";
import { agents, activityFeed } from "@/components/permitpilot/data";
import { PageHeader, Panel, StatusPill } from "@/components/permitpilot/ProductPrimitives";

// 12-agent UCI architecture from technical_gap_analysis_audit.md — surfaced explicitly for
// the McDonald's proposal Section 6 (PermitPilot Platform Advantage).
const uciAgents = [
  { name: "Context & Reference Engine",  status: "Running",  icon: Layers,       body: "Pulls jurisdictional playbooks + prior-project memory for every new intake." },
  { name: "Discipline Classifier",       status: "Running",  icon: FileText,     body: "Routes each doc to the correct UCI track (electric / gas / water / telecom)." },
  { name: "Portal Monitor",              status: "Running",  icon: Radio,        body: "Polls PEPCO, BGE, FPL, Duke, Con Ed portals for status + response updates." },
  { name: "CIAC Analyzer",               status: "Reviewing",icon: Wallet,       body: "Compares utility CIAC quote against budget; flags variance for PM review." },
  { name: "Meter-Set Choreographer",     status: "Running",  icon: Plug,         body: "Sequences meter-set day: sign-offs, crew, franchisee, inspector." },
  { name: "Conflict Hunter",             status: "Running",  icon: Siren,        body: "Detects gas/electric/water/telecom clashes before construction begins." },
  { name: "Load Modeler",                status: "Idle",     icon: GaugeCircle,  body: "Generates load letters from restaurant prototype templates." },
  { name: "Provider Liaison",            status: "Running",  icon: Cable,        body: "Drafts escalation emails when applications exceed AHJ SLA windows." },
  { name: "Class-of-Service Watcher",    status: "Running",  icon: Clock,        body: "Watches for CoS receipt; triggers 30% invoice + downstream contracting." },
  { name: "Energization Predictor",      status: "Reviewing",icon: Brain,        body: "Bayesian P50/P90 energization forecast, re-run nightly per site." },
  { name: "Hurricane Impact Modeler",    status: "Idle",     icon: CloudRain,    body: "Applies Jun–Nov utility drawdown to Florida schedules." },
  { name: "Franchisee Notifier",         status: "Running",  icon: Bell,         body: "Sends milestone updates to franchisee operators (opt-in per site)." },
] as const;

const AgentCenter = () => (
  <div>
    <PageHeader eyebrow="AI operations" title="Agent Control Center" body="Monitor, deploy, pause, and audit automated intelligence routines across permits, documents, utilities, and deadlines." action={<button className="pilot-button-primary"><Play className="h-4 w-4" /> Deploy Agent</button>} />
    <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
      <div className="grid gap-4 md:grid-cols-2">{agents.map((agent) => <Panel key={agent.name}><div className="flex items-start justify-between gap-4"><div className="flex h-11 w-11 items-center justify-center rounded-md bg-primary/10 text-primary"><agent.icon className="h-5 w-5" /></div><StatusPill tone={agent.status === "Idle" ? "default" : agent.status === "Reviewing" ? "warn" : "good"}>{agent.status}</StatusPill></div><h2 className="mt-5 font-tight text-lg font-bold">{agent.name}</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">{agent.scope}</p><div className="mt-5 grid grid-cols-3 gap-3 text-center"><Mini label="Last" value={agent.lastRun} /><Mini label="Watch" value={String(agent.monitored)} /><Mini label="Actions" value={String(agent.actions)} /></div></Panel>)}</div>
      <Panel title="Live agent feed" eyebrow="Audit stream"><div className="space-y-4">{activityFeed.map((item) => <div key={item.time} className="flex gap-3"><ScrollText className="mt-1 h-4 w-4 shrink-0 text-primary" /><div><div className="font-data text-xs text-muted-foreground">{item.time} · {item.actor}</div><p className="mt-1 text-sm text-muted-foreground">{item.body}</p></div></div>)}</div></Panel>
    </div>

    <section className="mt-8">
      <Panel eyebrow="UCI · 12-agent architecture" title="Utility Coordination Intelligence agent stack">
        <p className="mb-5 max-w-3xl text-sm text-muted-foreground">
          The full agent stack behind PermitPilot's Utility Coordination Intelligence capability.
          Each agent runs continuously across every East Coast site under the McDonald's MSA.
        </p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {uciAgents.map((a) => (
            <div key={a.name} className="rounded-lg border border-border bg-muted/20 p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 text-primary"><a.icon className="h-4 w-4" /></div>
                <StatusPill tone={a.status === "Idle" ? "default" : a.status === "Reviewing" ? "warn" : "good"}>{a.status}</StatusPill>
              </div>
              <div className="mt-3 font-tight text-sm font-bold text-foreground">{a.name}</div>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{a.body}</p>
            </div>
          ))}
        </div>
      </Panel>
    </section>
  </div>
);

const Mini = ({ label, value }: { label: string; value: string }) => <div className="rounded-md bg-muted p-3"><div className="font-data text-sm font-semibold">{value}</div><div className="mt-1 text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div></div>;

export default AgentCenter;