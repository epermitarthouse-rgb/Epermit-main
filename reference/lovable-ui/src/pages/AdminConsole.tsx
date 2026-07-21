import { Link } from "react-router-dom";
import { Activity, Building2, FileSignature, GraduationCap, History, Server, ShieldCheck, Sparkles, Users, Wallet, Network } from "lucide-react";
import { StatusPill } from "@/components/permitpilot/ProductPrimitives";

const kpis = [
  { label: "Active Clients", value: "12", Icon: Building2 },
  { label: "Active Users", value: "48", Icon: Users },
  { label: "System Health", value: "99.98%", Icon: Activity },
  { label: "Pending Invoices", value: "9", Icon: Wallet },
];

const audit = [
  { time: "10:42", actor: "S. Jenkins", action: "Issued password reset to m.torres@commun-et.com" },
  { time: "10:18", actor: "System", action: "Rotated PEPCO portal credentials" },
  { time: "09:55", actor: "D. Okafor", action: "Added Valvoline LLC as new client" },
  { time: "09:02", actor: "AI · DesignCheck", action: "Surfaced 3 new findings on PRJ-2023-089A" },
];

// McDonald's onboarding schedule — pilot pre-launch milestones per proposal Section 7.
const trainingTracker = [
  { week: "Week 4",  milestone: "CM team contacts identified", owner: "Ian Swain",           status: "done"    as const },
  { week: "Week 8",  milestone: "McDonald's CM team UAT session (2 hr walkthrough)", owner: "Charlotte Ducksworth", status: "scheduled" as const },
  { week: "Week 10", milestone: "CM team training — pilot goes live", owner: "Diamond Lakey", status: "pending" as const },
];

const AdminConsole = () => (
  <div className="space-y-6">
    <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
      <div>
        <div className="pilot-kicker text-primary">Admin Control Center</div>
        <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight">Workspace Operations</h1>
      </div>
      <div className="flex gap-2">
        <Link to="/admin/members" className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm font-medium transition hover:border-primary hover:text-primary">
          <Users className="h-4 w-4" /> Workspace Members
        </Link>
        <Link to="/admin/audit" className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm font-medium transition hover:border-primary hover:text-primary">
          <History className="h-4 w-4" /> Access Audit Log
        </Link>
        <Link to="/admin/authorizations" className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm font-medium transition hover:border-primary hover:text-primary">
          <FileSignature className="h-4 w-4" /> Client Authorizations
        </Link>
        <Link to="/admin/endpoints" className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm font-medium transition hover:border-primary hover:text-primary">
          <Network className="h-4 w-4" /> Platform Endpoints
        </Link>
        <Link to="/admin/invoicing" className="pilot-button-primary"><Wallet className="h-4 w-4" /> QuickBooks Invoicing</Link>
      </div>
    </header>

    <div className="grid gap-4 md:grid-cols-4">
      {kpis.map((k) => (
        <div key={k.label} className="pilot-card p-4">
          <div className="flex items-center justify-between">
            <span className="pilot-kicker text-muted-foreground">{k.label}</span>
            <k.Icon className="h-4 w-4 text-primary" />
          </div>
          <div className="mt-1 font-display text-3xl font-semibold">{k.value}</div>
        </div>
      ))}
    </div>

    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <section className="pilot-card overflow-hidden">
        <header className="border-b border-border bg-muted/30 px-5 py-3">
          <h2 className="flex items-center gap-2 font-tight text-base font-bold"><ShieldCheck className="h-4 w-4 text-primary" /> Audit Trail</h2>
        </header>
        <ul className="divide-y divide-border">
          {audit.map((a) => (
            <li key={a.time + a.actor} className="flex items-start gap-3 px-5 py-3 text-sm">
              <span className="w-14 font-data text-xs text-muted-foreground">{a.time}</span>
              <span className="w-48 font-medium">{a.actor}</span>
              <span className="flex-1 text-muted-foreground">{a.action}</span>
            </li>
          ))}
        </ul>
      </section>
      <aside className="pilot-card p-5">
        <h3 className="flex items-center gap-2 font-tight text-base font-bold"><Server className="h-4 w-4 text-pilot-teal" /> Infrastructure</h3>
        <ul className="mt-3 space-y-2 text-sm">
          {["API gateway · healthy", "Agent runtime · 7/7 online", "Vector store · 99.99%", "OCR pipeline · healthy", "Email relay · degraded"].map((row) => (
            <li key={row} className="flex items-center justify-between rounded border border-border bg-muted/30 px-3 py-2">
              <span>{row.split(" · ")[0]}</span>
              <span className={row.includes("degraded") ? "text-warning" : "text-success"}>{row.split(" · ")[1]}</span>
            </li>
          ))}
        </ul>
        <div className="mt-4 rounded-lg border border-primary/30 bg-primary/5 p-3 text-xs">
          <div className="flex items-center gap-1 pilot-kicker text-primary"><Sparkles className="h-3 w-3" /> Recommendation</div>
          <p className="mt-1 text-muted-foreground">Email relay degraded — retry queue at 312. Consider failover to backup SMTP.</p>
        </div>
      </aside>
    </div>

    <section className="pilot-card overflow-hidden">
      <header className="border-b border-border bg-muted/30 px-5 py-3">
        <h2 className="flex items-center gap-2 font-tight text-base font-bold"><GraduationCap className="h-4 w-4 text-primary" /> McDonald's UAT + Training Tracker</h2>
        <p className="mt-1 text-xs text-muted-foreground">Pre-pilot onboarding — MSA CET-2026-MCD-UC-001, Section 7 milestones.</p>
      </header>
      <ul className="divide-y divide-border">
        {trainingTracker.map((t) => (
          <li key={t.week} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
            <span className="w-20 font-data text-xs font-semibold text-primary">{t.week}</span>
            <span className="flex-1 min-w-[240px] text-foreground">{t.milestone}</span>
            <span className="font-data text-xs text-muted-foreground">Owner: <span className="text-foreground">{t.owner}</span></span>
            <StatusPill tone={t.status === "done" ? "good" : t.status === "scheduled" ? "info" : "default"}>
              {t.status}
            </StatusPill>
          </li>
        ))}
      </ul>
    </section>
  </div>
);

export default AdminConsole;