import { AlertTriangle, CalendarClock, CheckCircle2, Recycle, ShieldCheck } from "lucide-react";

const obligations = [
  { id: "O-01", label: "Stormwater BMP annual inspection", due: "Mar 14, 2025", status: "ok" },
  { id: "O-02", label: "Backflow preventer test", due: "Jan 30, 2025", status: "soon" },
  { id: "O-03", label: "Elevator certificate renewal", due: "Dec 04, 2024", status: "soon" },
  { id: "O-04", label: "Fire sprinkler 5-year flush", due: "Aug 11, 2027", status: "ok" },
  { id: "O-05", label: "Public-space permit renewal", due: "Oct 31, 2024", status: "overdue" },
];

const toneMap = {
  ok: { Icon: CheckCircle2, tone: "text-success" },
  soon: { Icon: CalendarClock, tone: "text-warning" },
  overdue: { Icon: AlertTriangle, tone: "text-destructive" },
} as const;

const CloseoutTracker = () => (
  <div className="space-y-6">
    <header>
      <div className="pilot-kicker text-primary">Post-Closeout Compliance</div>
      <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight">Lifetime Obligations Tracker</h1>
      <p className="mt-1 text-sm text-muted-foreground">Track recurring obligations long after CO is issued.</p>
    </header>
    <div className="grid gap-4 md:grid-cols-3">
      {[
        { l: "Overdue", v: obligations.filter((o) => o.status === "overdue").length, t: "text-destructive" },
        { l: "Due < 90d", v: obligations.filter((o) => o.status === "soon").length, t: "text-warning" },
        { l: "Healthy", v: obligations.filter((o) => o.status === "ok").length, t: "text-success" },
      ].map((k) => (
        <div key={k.l} className="pilot-card p-4">
          <div className="pilot-kicker text-muted-foreground">{k.l}</div>
          <div className={`mt-1 font-display text-3xl font-semibold ${k.t}`}>{k.v}</div>
        </div>
      ))}
    </div>
    <section className="pilot-card overflow-hidden">
      <header className="border-b border-border bg-muted/30 px-5 py-3">
        <h2 className="flex items-center gap-2 font-tight text-base font-bold"><ShieldCheck className="h-4 w-4 text-primary" /> Obligations</h2>
      </header>
      <ul className="divide-y divide-border">
        {obligations.map((o) => {
          const m = toneMap[o.status as keyof typeof toneMap];
          return (
            <li key={o.id} className="flex items-center gap-4 px-5 py-3 text-sm">
              <span className="w-16 font-data text-xs text-muted-foreground">{o.id}</span>
              <span className="flex-1 font-medium">{o.label}</span>
              <span className="w-32 font-data text-xs text-muted-foreground">due {o.due}</span>
              <span className={`inline-flex items-center gap-1 text-xs font-medium ${m.tone}`}><m.Icon className="h-3.5 w-3.5" /> {o.status}</span>
            </li>
          );
        })}
      </ul>
    </section>
    <div className="pilot-card flex items-start gap-3 p-5">
      <Recycle className="h-5 w-5 text-pilot-teal" />
      <div className="text-sm"><span className="font-medium">Auto-renewal agent:</span> reminders dispatched 90/60/30 days before each obligation.</div>
    </div>
  </div>
);

export default CloseoutTracker;