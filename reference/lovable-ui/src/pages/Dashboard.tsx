import { Link, NavLink, Outlet } from "react-router-dom";
import { AlertTriangle, ArrowRight, BarChart3, Bot, Brain, FileUp, Info, PlusCircle, ShieldAlert, Wrench } from "lucide-react";
import { cn } from "@/lib/utils";
import { ServicePill } from "@/components/permitpilot/ProductPrimitives";

const stats = [
  { value: "24", label: "Active Projects", accent: "bg-pilot-teal/10" },
  { value: "14", label: "Permit-led Workflows", accent: "bg-primary/10" },
  { value: "10", label: "Utility-led Workflows", accent: "bg-pilot-cyan/10" },
  { value: "7", label: "Cross-service Blockers", accent: "bg-destructive/10", tone: "bad" as const },
];

const portfolio = [
  { name: "Ballston Envelope Package", jurisdiction: "Arlington County, VA", status: "Action needed", tone: "bad", milestone: "VE letter due in 2d", assigned: "N. Okonkwo", service: "permit-expediting" as const },
  { name: "South Bay Fiber Expansion", jurisdiction: "Santa Clara, CA", status: "Provider review", tone: "warn", milestone: "PG&E response due Fri", assigned: "M. Torres", service: "utility-coordination" as const },
  { name: "Downtown Transit Hub", jurisdiction: "Seattle, WA", status: "AI review", tone: "warn", milestone: "Internal packet review 3:30 PM", assigned: "D. Okafor", service: "permit-expediting" as const },
  { name: "Riverside Park Utilities", jurisdiction: "Austin, TX", status: "Monitoring", tone: "warn", milestone: "Receipt digest in 12m", assigned: "A. Rivera", service: "utility-coordination" as const },
  { name: "Transit Hub Utility Tie-in", jurisdiction: "Seattle, WA", status: "Clear", tone: "good", milestone: "Meter-set window reserved", assigned: "Utility desk", service: "utility-coordination" as const },
] as const;

const alerts = [
  { priority: "High Priority", time: "10:42 AM", body: "Fairfax outage window is degrading the permit comment refresh workflow.", icon: AlertTriangle, tone: "bad" as const, links: ["Open Portal Harvest", "Switch to CSV fallback"] },
  { priority: "Medium Priority", time: "09:15 AM", body: "Transformer ETA variance could push meter-set sequencing by 9 days.", icon: Wrench, tone: "warn" as const, links: ["Review Utility Queue"] },
  { priority: "Low Priority", time: "Yesterday", body: "AI drafted 9 response items for the Ballston filing package.", icon: Bot, tone: "default" as const, links: ["Open Response Matrix"] },
];

const toneStyles = {
  good: "border-success/30 bg-success/10 text-success",
  warn: "border-warning/30 bg-warning/10 text-warning",
  bad: "border-destructive/30 bg-destructive/10 text-destructive",
  default: "border-border bg-muted text-muted-foreground",
} as const;

const DashboardLayout = () => (
  <div className="space-y-6">
    <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
      <div>
        <div className="pilot-kicker text-primary">PermitPilot Command</div>
        <h1 className="mt-2 font-tight text-3xl font-black tracking-tight text-foreground md:text-4xl">Dashboard</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Overview of active permit expediting and utility coordination work across the portfolio.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
          <button className="pilot-button-ghost"><PlusCircle className="h-4 w-4 text-primary" /> New Project</button>
          <button className="pilot-button-ghost"><FileUp className="h-4 w-4 text-primary" /> Upload Package</button>
          <button className="pilot-button-primary"><BarChart3 className="h-4 w-4" /> Open Operations Report</button>
      </div>
    </header>

      <div className="flex flex-wrap gap-2">
        <ServicePill service="permit-expediting" />
        <ServicePill service="utility-coordination" />
      </div>

    <nav className="flex items-center gap-1 border-b border-border">
      {[
        { to: "/dashboard", label: "Operations", end: true },
        { to: "/dashboard/uci", label: "Utility Coordination" },
      ].map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          end={tab.end}
          className={({ isActive }) =>
            cn(
              "relative px-4 py-3 font-tight text-sm font-semibold transition-colors",
              isActive ? "text-foreground" : "text-muted-foreground hover:text-foreground",
              isActive && "after:absolute after:inset-x-3 after:-bottom-px after:h-0.5 after:bg-primary",
            )
          }
        >
          {tab.label}
        </NavLink>
      ))}
    </nav>

    <Outlet />
  </div>
);

export const DashboardOverview = () => (
  <div className="space-y-6">
    {/* KPI cards */}
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {stats.map((s) => (
        <article key={s.label} className="pilot-card relative overflow-hidden p-6">
          <div className={cn("pointer-events-none absolute -right-6 -top-6 h-24 w-24 rounded-full", s.accent)} />
          <div className={cn("relative font-display text-5xl font-semibold leading-none tracking-tight", s.tone === "bad" ? "text-destructive" : "text-foreground")}>
            {s.value}
          </div>
          <div className="pilot-kicker relative mt-3">{s.label}</div>
        </article>
      ))}
    </div>

    {/* Portfolio + Intelligence */}
    <div className="grid gap-6 xl:grid-cols-[2fr_1fr]">
      <section className="pilot-card overflow-hidden">
        <header className="flex items-center justify-between gap-3 border-b border-border p-5">
          <div className="flex items-center gap-3">
            <h2 className="font-tight text-lg font-bold">Active Projects</h2>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-success/30 bg-success/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-success">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-success" />
              Queue health 94%
            </span>
          </div>
          <Link to="/projects" className="inline-flex items-center gap-1 text-xs font-bold uppercase tracking-wider text-primary hover:text-brand-orange-deep">
            View All <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </header>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-muted/60">
              <tr className="pilot-kicker">
                <th className="px-5 py-3 font-medium">Project</th>
                <th className="px-5 py-3 font-medium">Jurisdiction</th>
                <th className="px-5 py-3 font-medium">Service</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium">Next Milestone</th>
                <th className="px-5 py-3 font-medium">Assigned</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border text-sm">
              {portfolio.map((row) => (
                <tr key={row.name} className="transition-colors hover:bg-muted/40">
                  <td className="px-5 py-4 font-tight font-semibold text-foreground">{row.name}</td>
                  <td className="px-5 py-4 text-muted-foreground">{row.jurisdiction}</td>
                  <td className="px-5 py-4"><ServicePill service={row.service} /></td>
                  <td className="px-5 py-4">
                    <span className={cn("inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider", toneStyles[row.tone])}>
                      {row.status}
                    </span>
                  </td>
                  <td className="px-5 py-4 font-data text-xs text-muted-foreground">{row.milestone}</td>
                  <td className="px-5 py-4 text-muted-foreground">{row.assigned}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="pilot-card flex flex-col">
        <header className="flex items-center justify-between border-b border-border p-5">
          <h2 className="font-tight text-lg font-bold">Intelligence &amp; Alerts</h2>
          <Brain className="h-5 w-5 text-muted-foreground" />
        </header>
        <div className="relative flex-1 p-5">
          <div className="absolute left-[39px] top-5 bottom-5 w-px bg-border" aria-hidden />
          <div className="relative flex flex-col gap-6">
            {alerts.map((a) => (
              <div key={a.priority + a.time} className="flex gap-4">
                <div className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-full border", toneStyles[a.tone])}>
                  <a.icon className="h-4 w-4" />
                </div>
                <div className="flex flex-col gap-1">
                  <div className="flex items-center justify-between gap-3">
                    <span className={cn("text-[10px] font-bold uppercase tracking-wider", a.tone === "bad" ? "text-destructive" : a.tone === "warn" ? "text-warning" : "text-muted-foreground")}>
                      {a.priority}
                    </span>
                    <span className="font-data text-[11px] text-muted-foreground">{a.time}</span>
                  </div>
                  <p className="text-sm leading-snug text-foreground">{a.body}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    {a.links.map((l, i) => (
                      <span key={l} className="flex items-center gap-2">
                        {i > 0 && <span className="text-border">•</span>}
                        <a href="#" className="text-[11px] font-bold text-accent hover:underline">{l}</a>
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  </div>
);

export default DashboardLayout;
