import { Bell, CalendarCheck2, CheckCircle2, ClipboardList, ClockAlert, FileCheck2, Hourglass, ShieldCheck } from "lucide-react";

type Release = {
  id: string;
  project: string;
  trade: "Electrical" | "Mechanical" | "Plumbing" | "Structural" | "Fire" | "Sprinkler";
  inspector: string;
  requested: string;
  scheduled: string;
  status: "Requested" | "Scheduled" | "Inspected" | "Released" | "Failed";
  notes: string;
};

const releases: Release[] = [
  { id: "REL-1041", project: "Project Alpha", trade: "Electrical", inspector: "Jamal Boyd (DCRA)", requested: "Aug 09", scheduled: "Aug 14 AM", status: "Scheduled", notes: "Coordinated with Pepco meter set" },
  { id: "REL-1040", project: "Project Alpha", trade: "Sprinkler", inspector: "T. Nguyen", requested: "Aug 08", scheduled: "Aug 12 PM", status: "Inspected", notes: "1 punch: paint compound on riser" },
  { id: "REL-1039", project: "Transit Hub", trade: "Mechanical", inspector: "R. Velasquez", requested: "Aug 07", scheduled: "Aug 11 AM", status: "Released", notes: "Released for cover" },
  { id: "REL-1038", project: "Fiber Expansion", trade: "Structural", inspector: "Co. of Santa Clara", requested: "Aug 06", scheduled: "Aug 10 AM", status: "Failed", notes: "Failed: missing epoxy anchor calcs" },
  { id: "REL-1037", project: "Riverside Park", trade: "Plumbing", inspector: "DPW field", requested: "Aug 05", scheduled: "—", status: "Requested", notes: "Awaiting slot" },
];

const stats = [
  { label: "Open requests", value: "7", delta: "3 awaiting slot", icon: ClipboardList },
  { label: "Releases this week", value: "12", delta: "+3 vs target", icon: CheckCircle2 },
  { label: "First-pass rate", value: "91%", delta: "rolling 30 d", icon: ShieldCheck },
  { label: "Avg. days to release", value: "4.2 d", delta: "request → released", icon: Hourglass },
];

const dayTypes = ["Mon", "Tue", "Wed", "Thu", "Fri"];
const schedule = [
  { trade: "Electrical · Rough", slots: [1, 0, 2, 0, 1] },
  { trade: "Mechanical · Cover", slots: [0, 1, 1, 0, 0] },
  { trade: "Plumbing · Top out", slots: [0, 0, 1, 1, 0] },
  { trade: "Sprinkler · Hydro", slots: [1, 0, 0, 1, 0] },
  { trade: "Final · CO", slots: [0, 0, 0, 0, 2] },
];

const InspectorReleaseTracker = () => (
  <div className="space-y-6 pb-12">
    <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div>
        <div className="pilot-kicker text-primary">Inspections</div>
        <h1 className="mt-2 font-tight text-3xl font-black tracking-tight text-foreground md:text-4xl">Inspector Release Tracker</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          A single board of every requested, scheduled, and released inspection across the
          portfolio — synced with AHJ portals and the field team's check-in app.
        </p>
      </div>
      <button className="pilot-button-primary"><CalendarCheck2 className="h-4 w-4" /> Request inspection</button>
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
          <div className="pilot-kicker text-primary">Active release board</div>
          <h2 className="mt-1 font-tight text-xl font-bold text-foreground">All requests, all jurisdictions</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted/40 text-muted-foreground">
              <tr>{["Project", "Trade", "Inspector", "Requested", "Scheduled", "Status", "Notes"].map((h) => <th key={h} className="pilot-kicker px-5 py-3 font-semibold">{h}</th>)}</tr>
            </thead>
            <tbody>
              {releases.map((r) => (
                <tr key={r.id} className="border-t border-border hover:bg-muted/20">
                  <td className="px-5 py-4">
                    <div className="font-tight font-semibold text-foreground">{r.project}</div>
                    <div className="font-data text-[11px] text-muted-foreground">{r.id}</div>
                  </td>
                  <td className="px-5 py-4 text-foreground">{r.trade}</td>
                  <td className="px-5 py-4 text-muted-foreground">{r.inspector}</td>
                  <td className="px-5 py-4 font-data text-xs text-muted-foreground">{r.requested}</td>
                  <td className="px-5 py-4 font-data text-xs text-foreground">{r.scheduled}</td>
                  <td className="px-5 py-4"><StatusPill s={r.status} /></td>
                  <td className="px-5 py-4 text-muted-foreground">{r.notes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="space-y-5">
        <div className="pilot-card overflow-hidden">
          <div className="border-b border-border p-5">
            <div className="pilot-kicker text-primary">This week</div>
            <h3 className="mt-1 font-tight text-lg font-bold text-foreground">Inspector availability heatmap</h3>
          </div>
          <div className="overflow-x-auto p-4">
            <table className="w-full text-left text-xs">
              <thead>
                <tr>
                  <th className="pilot-kicker px-2 py-1.5"></th>
                  {dayTypes.map((d) => <th key={d} className="pilot-kicker px-2 py-1.5 text-center">{d}</th>)}
                </tr>
              </thead>
              <tbody>
                {schedule.map((row) => (
                  <tr key={row.trade} className="border-t border-border">
                    <td className="px-2 py-2 text-foreground">{row.trade}</td>
                    {row.slots.map((s, i) => (
                      <td key={i} className="px-1 py-2 text-center">
                        <span className={`inline-flex h-7 w-7 items-center justify-center rounded-md font-data text-[11px] ${
                          s === 0 ? "bg-muted text-muted-foreground"
                          : s === 1 ? "bg-primary/20 text-primary"
                          : "bg-primary/40 text-primary-foreground"
                        }`}>{s}</span>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="pilot-card p-5">
          <div className="flex items-center gap-2 text-primary"><Bell className="h-5 w-5" /><span className="font-tight font-semibold">Alerts</span></div>
          <ul className="mt-3 space-y-2 text-sm">
            <li className="flex gap-2 text-foreground"><ClockAlert className="mt-0.5 h-4 w-4 flex-none text-destructive" /> REL-1038 failed — re-inspection blocks structural cover.</li>
            <li className="flex gap-2 text-foreground"><FileCheck2 className="mt-0.5 h-4 w-4 flex-none text-primary" /> REL-1041 ready package — auto-emailed to Jamal Boyd at 07:00.</li>
          </ul>
        </div>
      </div>
    </section>
  </div>
);

const StatusPill = ({ s }: { s: Release["status"] }) => {
  const map = {
    Requested: "border-border bg-muted text-muted-foreground",
    Scheduled: "border-accent/40 bg-accent/15 text-accent-foreground",
    Inspected: "border-primary/30 bg-primary/10 text-primary",
    Released: "border-primary/40 bg-primary/20 text-primary",
    Failed: "border-destructive/40 bg-destructive/10 text-destructive",
  } as const;
  return <span className={`rounded-full border px-2.5 py-1 font-data text-[11px] font-medium ${map[s]}`}>{s}</span>;
};

export default InspectorReleaseTracker;