import { Activity, ArrowUpRight, Bot, ChevronRight, Filter, Plus, RefreshCw, Settings2, Workflow } from "lucide-react";

type Lead = {
  project: string;
  client: string;
  status: "Discovery" | "Proposal" | "Negotiation" | "Won" | "Stalled";
  priority: "Low" | "Medium" | "High" | "Critical";
  agent: string;
  next: string;
  due: string;
  value: string;
};

const board: Lead[] = [
  { project: "Tysons Tower Refresh", client: "JBG Smith", status: "Negotiation", priority: "Critical", agent: "Ian Swain", next: "Send revised SOW by EOD", due: "Today", value: "$184k" },
  { project: "Reston Logistics Hub", client: "Prologis", status: "Proposal", priority: "High", agent: "Sarah Jenkins", next: "Schedule feasibility walk", due: "Tomorrow", value: "$92k" },
  { project: "Bethesda Medical Plaza", client: "Carr Properties", status: "Discovery", priority: "Medium", agent: "Daniel Okafor", next: "Discovery call with PM", due: "Aug 14", value: "—" },
  { project: "Fairfax Charter School", client: "BASIS Ed.", status: "Won", priority: "High", agent: "Michael Torres", next: "Kickoff scheduled", due: "Aug 16", value: "$240k" },
  { project: "Anacostia Mixed-Use", client: "Beacon Capital", status: "Stalled", priority: "High", agent: "Ian Swain", next: "Re-engage on parking variance", due: "Overdue 3d", value: "$310k" },
  { project: "NoMa Data Center", client: "Iron Mountain", status: "Discovery", priority: "Critical", agent: "Agent Alpha", next: "Power study handoff", due: "Aug 18", value: "—" },
];

const stages: Lead["status"][] = ["Discovery", "Proposal", "Negotiation", "Won", "Stalled"];

const pipelineStats = [
  { label: "Open pipeline value", value: "$1.84M", delta: "+12% MoM" },
  { label: "Stage velocity", value: "8.4 days", delta: "Discovery → Proposal" },
  { label: "Win rate (rolling 90d)", value: "62%", delta: "vs. 51% baseline" },
  { label: "Stalled leads", value: "4", delta: "needs intervention" },
];

const syncEvents = [
  { time: "10:42", body: "Pulled 14 board updates from Q3 Permitting Pipeline." },
  { time: "10:21", body: "Promoted Fairfax Charter School to Won — created project workspace." },
  { time: "09:48", body: "Lead scorer flagged Anacostia Mixed-Use as stalling risk (95% conf)." },
  { time: "09:05", body: "Synced 6 new contacts from Monday.com → PermitPilot CRM." },
];

const boards = [
  { name: "Q3 Permitting Pipeline", items: 38, mapped: true, owner: "Sales Ops" },
  { name: "Utility Coordination Bids", items: 12, mapped: true, owner: "Utility Team" },
  { name: "Government RFPs", items: 9, mapped: false, owner: "Proposals" },
];

const AdminCrm = () => (
  <div className="space-y-6 pb-12">
    <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div>
        <div className="pilot-kicker text-primary">Admin · Integrations</div>
        <h1 className="mt-2 font-tight text-3xl font-black tracking-tight text-foreground md:text-4xl">CRM Intelligence — Monday.com</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Two-way sync between Commun-ET's Monday workspaces and PermitPilot. Lead scoring, stage
          velocity, and stall detection run continuously on every mapped board.
        </p>
      </div>
      <div className="flex items-center gap-2">
        <button className="pilot-button-ghost"><RefreshCw className="h-4 w-4" /> Sync now</button>
        <button className="pilot-button-primary"><Plus className="h-4 w-4" /> Map new board</button>
      </div>
    </header>

    <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {pipelineStats.map((s) => (
        <div key={s.label} className="pilot-card p-5">
          <div className="pilot-kicker">{s.label}</div>
          <div className="mt-3 font-data text-2xl font-semibold text-foreground">{s.value}</div>
          <div className="mt-1 text-xs text-primary">{s.delta}</div>
        </div>
      ))}
    </section>

    <section className="pilot-card overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-border p-5 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="pilot-kicker text-primary">Active board</div>
          <h2 className="mt-1 font-tight text-xl font-bold text-foreground">Q3 Permitting Pipeline</h2>
        </div>
        <button className="pilot-button-ghost"><Filter className="h-4 w-4" /> Filter</button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-muted/40 text-muted-foreground">
            <tr>
              {["Project", "Stage", "Priority", "Agent", "Next action", "Due", "Value"].map((h) => (
                <th key={h} className="pilot-kicker px-5 py-3 font-semibold">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {board.map((l) => (
              <tr key={l.project} className="border-t border-border hover:bg-muted/20">
                <td className="px-5 py-4">
                  <div className="font-tight font-semibold text-foreground">{l.project}</div>
                  <div className="text-xs text-muted-foreground">{l.client}</div>
                </td>
                <td className="px-5 py-4"><StageBadge status={l.status} /></td>
                <td className="px-5 py-4"><PriorityBadge p={l.priority} /></td>
                <td className="px-5 py-4 text-foreground">{l.agent}</td>
                <td className="px-5 py-4 text-muted-foreground">{l.next}</td>
                <td className="px-5 py-4 font-data text-xs text-muted-foreground">{l.due}</td>
                <td className="px-5 py-4 font-data text-foreground">{l.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>

    <section className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
      <div className="pilot-card overflow-hidden">
        <div className="border-b border-border p-5">
          <div className="pilot-kicker text-primary">Mapped boards</div>
          <h3 className="mt-1 font-tight text-lg font-bold text-foreground">Sync configuration</h3>
        </div>
        <ul className="divide-y divide-border">
          {boards.map((b) => (
            <li key={b.name} className="flex items-center justify-between gap-4 p-5">
              <div className="flex items-center gap-4">
                <Workflow className="h-5 w-5 text-primary" />
                <div>
                  <div className="font-tight font-semibold text-foreground">{b.name}</div>
                  <div className="text-xs text-muted-foreground">{b.items} items · owner {b.owner}</div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className={`rounded-full border px-2.5 py-1 font-data text-[11px] ${b.mapped ? "border-primary/30 bg-primary/10 text-primary" : "border-border bg-muted text-muted-foreground"}`}>
                  {b.mapped ? "Synced" : "Map pending"}
                </span>
                <button className="rounded-md border border-border p-2 text-muted-foreground hover:text-foreground"><Settings2 className="h-4 w-4" /></button>
              </div>
            </li>
          ))}
        </ul>
      </div>

      <div className="pilot-card overflow-hidden">
        <div className="border-b border-border p-5">
          <div className="pilot-kicker text-primary">Sync activity</div>
          <h3 className="mt-1 font-tight text-lg font-bold text-foreground">Last 30 minutes</h3>
        </div>
        <ul className="divide-y divide-border">
          {syncEvents.map((ev, i) => (
            <li key={i} className="flex gap-3 p-4">
              <Bot className="mt-0.5 h-4 w-4 flex-none text-primary" />
              <div>
                <div className="font-data text-[11px] text-muted-foreground">{ev.time}</div>
                <div className="text-sm text-foreground">{ev.body}</div>
              </div>
            </li>
          ))}
        </ul>
        <div className="border-t border-border p-4">
          <button className="pilot-button-ghost w-full justify-center">
            <Activity className="h-4 w-4" /> Open full sync log <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </section>

    <section className="pilot-card flex flex-col items-start justify-between gap-4 p-6 md:flex-row md:items-center">
      <div>
        <h3 className="font-tight text-lg font-bold text-foreground">Need to migrate a HubSpot or Salesforce pipeline?</h3>
        <p className="mt-1 text-sm text-muted-foreground">Our CRM scorer will re-map your stages onto the Monday model in &lt;48 hours.</p>
      </div>
      <button className="pilot-button-primary">Request migration <ArrowUpRight className="h-4 w-4" /></button>
    </section>
  </div>
);

const StageBadge = ({ status }: { status: Lead["status"] }) => {
  const map = {
    Discovery: "border-border bg-muted text-muted-foreground",
    Proposal: "border-primary/30 bg-primary/10 text-primary",
    Negotiation: "border-accent/40 bg-accent/15 text-accent-foreground",
    Won: "border-primary/40 bg-primary/20 text-primary",
    Stalled: "border-destructive/40 bg-destructive/10 text-destructive",
  } as const;
  return <span className={`rounded-full border px-2.5 py-1 font-data text-[11px] font-medium ${map[status]}`}>{status}</span>;
};

const PriorityBadge = ({ p }: { p: Lead["priority"] }) => {
  const map = {
    Low: "text-muted-foreground",
    Medium: "text-foreground",
    High: "text-primary",
    Critical: "text-destructive",
  } as const;
  return <span className={`font-data text-[11px] font-semibold uppercase ${map[p]}`}>{p}</span>;
};

export default AdminCrm;