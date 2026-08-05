import { ArrowLeft, ArrowUpRight, BadgeCheck, Brain, CloudUpload, ExternalLink, Landmark, Pencil, RefreshCw, ShieldCheck, Sparkles, Wallet } from "lucide-react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";

type RowTone = "success" | "warning" | "destructive";

const vaultRows: { item: string; category: string; party: string; status: string; tone: RowTone; ref: string; refKind: "link" | "action" }[] = [
  { item: "Final Approved Plans (As-Builts)", category: "Legal Archive", party: "Arch. J. Sterling", status: "Verified", tone: "success", ref: "VAULT-AB-9921", refKind: "link" },
  { item: "Final Electrical Release", category: "Inspection", party: "E. Miller (GC)", status: "Pending", tone: "warning", ref: "Upload file", refKind: "action" },
  { item: "Certificate of Occupancy", category: "Compliance", party: "Agent Pilot-01", status: "Verified", tone: "success", ref: "DCRA-CO-7712", refKind: "link" },
  { item: "Geotech Final Report", category: "Engineering", party: "T. Okafor (Civil)", status: "Verified", tone: "success", ref: "VAULT-GT-4410", refKind: "link" },
];

const financeRows: { item: string; category: "Revenue" | "Liability" | "Cost"; party: string; status: string; tone: RowTone; ref: string; refKind: "txid" | "qb" }[] = [
  { item: "Permit Bond Release Refund", category: "Revenue", party: "L. Harris (Finance)", status: "Received", tone: "success", ref: "TX-ID 4492-QB", refKind: "txid" },
  { item: "Utility Tap-In Final Invoice", category: "Liability", party: "Project Manager", status: "In Review", tone: "warning", ref: "Review in QB", refKind: "qb" },
  { item: "Third-Party Inspection Fees", category: "Cost", party: "Accounts Payable", status: "Paid", tone: "success", ref: "TX-ID 4488-QB", refKind: "txid" },
  { item: "Liquidated Damages — Foundation Slip", category: "Liability", party: "Legal Counsel", status: "Disputed", tone: "destructive", ref: "Review in QB", refKind: "qb" },
];

const toneStyles: Record<RowTone, string> = {
  success: "text-success",
  warning: "text-warning",
  destructive: "text-destructive",
};

const categoryTone: Record<string, string> = {
  "Legal Archive": "border-pilot-teal/30 bg-pilot-teal/10 text-pilot-teal",
  Inspection: "border-pilot-teal/30 bg-pilot-teal/10 text-pilot-teal",
  Compliance: "border-pilot-teal/30 bg-pilot-teal/10 text-pilot-teal",
  Engineering: "border-pilot-teal/30 bg-pilot-teal/10 text-pilot-teal",
  Revenue: "border-primary/30 bg-primary/10 text-primary",
  Liability: "border-destructive/30 bg-destructive/10 text-destructive",
  Cost: "border-warning/30 bg-warning/10 text-warning",
};

const bars = [
  { label: "P1", height: 40 },
  { label: "P2", height: 65 },
  { label: "P3", height: 50 },
  { label: "CUR", height: 90, active: true },
];

const PostMortemFinancial = () => {
  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <Link to="/closeout/post-mortem" className="pilot-kicker inline-flex items-center gap-1 text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-3 w-3" />
            Back to Post-Mortem
          </Link>
          <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight">
            Project Closeout &amp; Post-Mortem Intelligence
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Financial reconciliation, vault sync, and the institutional knowledge loop.
          </p>
        </div>
        <button className="pilot-button-primary">
          <BadgeCheck className="h-4 w-4" /> Mark Closeout Complete
        </button>
      </header>

      <section className="grid gap-4 md:grid-cols-3">
        <SummaryCard
          icon={Sparkles}
          iconAccent="text-primary bg-primary/15"
          badge="On Track"
          badgeTone="success"
          kicker="Planned vs Actual"
          value="+4.2 Days"
          body="Permit cycle efficiency increased since last sprint."
        />
        <SummaryCard
          icon={Wallet}
          iconAccent="text-pilot-teal bg-pilot-teal/15"
          badge="Reconciling"
          badgeTone="warning"
          kicker="Total Permit Expenditure"
          value="$142,480.00"
          body="98% of invoices synced to QuickBooks."
        />
        <SummaryCard
          icon={ShieldCheck}
          iconAccent="text-primary-foreground bg-primary"
          badge="High Priority"
          badgeTone="destructive"
          kicker="Document Vault Sync"
          value="12 Files Pending"
          body="Required for final project liability clearance."
          highlight
          action={{ label: "Sync Now", icon: RefreshCw }}
        />
      </section>

      <section className="pilot-card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-muted/30 px-5 py-3">
          <div className="flex items-center gap-3">
            <CloudUpload className="h-5 w-5 text-primary" />
            <h2 className="font-tight text-lg font-bold">Final Vault Sync</h2>
            <span className="rounded border border-border bg-card px-2 py-0.5 font-data text-[10px] uppercase tracking-wider text-muted-foreground">
              Concluding Step
            </span>
          </div>
          <span className="pilot-kicker text-muted-foreground">85% Complete</span>
        </div>
        <Table
          rows={vaultRows.map((r) => ({
            item: r.item,
            category: r.category,
            party: r.party,
            status: r.status,
            tone: r.tone,
            ref: r.ref,
            refContent:
              r.refKind === "link" ? (
                <a href="#" className="font-data text-xs text-primary hover:underline">
                  {r.ref}
                </a>
              ) : (
                <button className="inline-flex items-center gap-1 rounded border border-primary/30 bg-primary/10 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-primary">
                  {r.ref}
                </button>
              ),
          }))}
        />
      </section>

      <section className="pilot-card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-muted/30 px-5 py-3">
          <div className="flex items-center gap-3">
            <Landmark className="h-5 w-5 text-primary" />
            <h2 className="font-tight text-lg font-bold">Final Financial Reconciliation</h2>
            <span className="rounded border border-border bg-card px-2 py-0.5 font-data text-[10px] uppercase tracking-wider text-muted-foreground">
              Concluding Step
            </span>
          </div>
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <RefreshCw className="h-3.5 w-3.5 text-success" />
            Auto-sync with QuickBooks enabled
          </span>
        </div>
        <Table
          rows={financeRows.map((r) => ({
            item: r.item,
            category: r.category,
            party: r.party,
            status: r.status,
            tone: r.tone,
            ref: r.ref,
            refContent:
              r.refKind === "txid" ? (
                <span className="font-data text-xs text-muted-foreground">{r.ref}</span>
              ) : (
                <button className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                  {r.ref} <ExternalLink className="h-3 w-3" />
                </button>
              ),
          }))}
        />
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <div className="pilot-card p-5">
          <div className="flex items-center gap-2">
            <Brain className="h-5 w-5 text-primary" />
            <h2 className="font-tight text-lg font-bold">Post-Mortem Entry</h2>
          </div>
          <div className="mt-4 space-y-4">
            <div>
              <label className="pilot-kicker mb-1 block text-muted-foreground">Core Lesson Learned</label>
              <textarea
                rows={3}
                placeholder="Enter key takeaway for the organizational knowledge graph…"
                className="w-full rounded-md border border-border bg-background p-3 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary"
              />
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <Select label="Delay Root Cause" options={["Municipal Backlog", "Missing Documentation", "Utility Conflict", "Weather Delay"]} />
              <Select label="Success Driver" options={["Agent Automation", "Early Submission", "Expediter Liaison"]} />
            </div>
            <button className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-foreground py-2.5 font-tight text-sm font-bold text-background transition-opacity hover:opacity-90">
              <Pencil className="h-4 w-4" /> Commit to Knowledge Graph
            </button>
          </div>
        </div>

        <div className="pilot-card flex flex-col p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ArrowUpRight className="h-5 w-5 text-primary" />
              <h2 className="font-tight text-lg font-bold">Cycle Efficiency</h2>
            </div>
            <span className="font-data text-xs text-success">+12% vs Org Avg</span>
          </div>
          <div className="mt-4 flex flex-1 items-end gap-3 px-2">
            {bars.map((b) => (
              <div key={b.label} className="flex flex-1 flex-col items-center gap-2">
                <div
                  className={cn(
                    "w-full rounded-t-md transition-colors",
                    b.active ? "bg-primary" : "bg-primary/30",
                  )}
                  style={{ height: `${b.height}%` }}
                />
                <span className="font-data text-[10px] uppercase tracking-wider text-muted-foreground">{b.label}</span>
              </div>
            ))}
          </div>
          <div className="mt-4 border-t border-border pt-3">
            <p className="text-sm italic text-muted-foreground">
              "The automated Vault Sync protocol saved approximately 18 manual hours during this project phase."
            </p>
            <div className="mt-2 flex items-center gap-2">
              <BadgeCheck className="h-4 w-4 text-primary" />
              <span className="pilot-kicker text-muted-foreground">AI Agent Validation</span>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};

const SummaryCard = ({
  icon: Icon,
  iconAccent,
  badge,
  badgeTone,
  kicker,
  value,
  body,
  highlight,
  action,
}: {
  icon: React.ComponentType<{ className?: string }>;
  iconAccent: string;
  badge: string;
  badgeTone: RowTone;
  kicker: string;
  value: string;
  body: string;
  highlight?: boolean;
  action?: { label: string; icon: React.ComponentType<{ className?: string }> };
}) => {
  const badgeMap: Record<RowTone, string> = {
    success: "border-success/30 bg-success/10 text-success",
    warning: "border-warning/30 bg-warning/10 text-warning",
    destructive: "border-destructive/30 bg-destructive/10 text-destructive",
  };
  return (
    <div className={cn("pilot-card p-5", highlight && "border-primary/60 shadow-[0_4px_20px_hsl(var(--primary)/0.15)]")}>
      <div className="flex items-start justify-between">
        <span className={cn("flex h-9 w-9 items-center justify-center rounded-md", iconAccent)}>
          <Icon className="h-5 w-5" />
        </span>
        <span className={cn("rounded border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider", badgeMap[badgeTone])}>
          {badge}
        </span>
      </div>
      <div className="pilot-kicker mt-4 text-muted-foreground">{kicker}</div>
      <div className="mt-1 font-display text-3xl font-semibold tracking-tight">{value}</div>
      <p className="mt-2 text-sm text-muted-foreground">{body}</p>
      {action && (
        <button className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-md bg-primary py-2 font-tight text-xs font-bold uppercase tracking-wider text-primary-foreground">
          <action.icon className="h-4 w-4" />
          {action.label}
        </button>
      )}
    </div>
  );
};

const Table = ({
  rows,
}: {
  rows: { item: string; category: string; party: string; status: string; tone: RowTone; ref: string; refContent: React.ReactNode }[];
}) => (
  <div className="overflow-x-auto">
    <table className="w-full text-left">
      <thead className="border-b border-border bg-muted/40">
        <tr>
          {["Item", "Category", "Responsible Party", "Status", "Verification"].map((h) => (
            <th key={h} className="px-5 py-3 pilot-kicker text-muted-foreground">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y divide-border">
        {rows.map((r) => (
          <tr key={r.item} className="transition-colors hover:bg-muted/20">
            <td className="px-5 py-4 text-sm font-medium text-foreground">{r.item}</td>
            <td className="px-5 py-4">
              <span className={cn("rounded border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider", categoryTone[r.category])}>
                {r.category}
              </span>
            </td>
            <td className="px-5 py-4 text-sm text-muted-foreground">{r.party}</td>
            <td className="px-5 py-4">
              <span className={cn("text-[10px] font-bold uppercase tracking-wider", toneStyles[r.tone])}>{r.status}</span>
            </td>
            <td className="px-5 py-4">{r.refContent}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

const Select = ({ label, options }: { label: string; options: string[] }) => (
  <div>
    <label className="pilot-kicker mb-1 block text-muted-foreground">{label}</label>
    <select className="w-full rounded-md border border-border bg-background p-2 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary">
      {options.map((o) => (
        <option key={o}>{o}</option>
      ))}
    </select>
  </div>
);

export default PostMortemFinancial;