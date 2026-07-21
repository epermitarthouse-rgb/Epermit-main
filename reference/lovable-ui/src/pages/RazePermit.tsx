import { useSearchParams } from "react-router-dom";
import { AlertTriangle, CalendarCheck, FileText, Hammer, ShieldCheck, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

const phases = [
  { name: "Pre-Application", done: true },
  { name: "Asbestos / Lead", done: true },
  { name: "Raze Application Filed", done: true },
  { name: "Public Notice", active: true },
  { name: "Permit Issuance", done: false },
  { name: "Active Demo", done: false },
  { name: "Sign-off", done: false },
];

const docs = [
  { name: "Asbestos NESHAP Notice", status: "Approved", tone: "text-success" },
  { name: "Lead-Based Paint Survey", status: "Approved", tone: "text-success" },
  { name: "Pest Control Sign-off", status: "Pending", tone: "text-warning" },
  { name: "Utility Disconnect Letters", status: "3 of 4", tone: "text-warning" },
  { name: "Right-of-Way Plan", status: "Approved", tone: "text-success" },
];

const RazePermit = () => {
  const [params, setParams] = useSearchParams();
  const enhanced = params.get("view") === "enhanced";

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="pilot-kicker text-primary">Raze Permit Management</div>
          <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight">Demolition Workflow</h1>
          <p className="mt-1 text-sm text-muted-foreground">Linear, regulated, environmentally-sensitive — handled.</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-md border border-border bg-card p-0.5 text-xs">
            {(["v3", "enhanced"] as const).map((v) => {
              const active = (v === "enhanced") === enhanced;
              return (
                <button key={v} onClick={() => setParams(v === "enhanced" ? { view: "enhanced" } : {}, { replace: true })} className={cn("rounded px-3 py-1.5 transition-colors", active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>
                  {v === "enhanced" ? "v3.1" : "v3"}
                </button>
              );
            })}
          </div>
          <button className="pilot-button-primary"><Sparkles className="h-4 w-4" /> Run AI Audit</button>
        </div>
      </header>

      <section className="pilot-card overflow-x-auto p-5">
        <ol className="flex min-w-[700px] items-center gap-3">
          {phases.map((p, i) => (
            <li key={p.name} className="flex flex-1 items-center gap-3">
              <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-full border font-data text-sm font-bold",
                p.done ? "border-success bg-success/20 text-success" : p.active ? "border-primary bg-primary/20 text-primary" : "border-border bg-muted text-muted-foreground")}>
                {i + 1}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{p.name}</div>
              </div>
              {i < phases.length - 1 && <div className="h-px flex-1 bg-border" />}
            </li>
          ))}
        </ol>
      </section>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <section className="pilot-card overflow-hidden">
          <header className="border-b border-border bg-muted/30 px-5 py-3">
            <h3 className="flex items-center gap-2 font-tight text-base font-bold">
              <FileText className="h-4 w-4 text-primary" /> Environmental Package
            </h3>
          </header>
          <ul className="divide-y divide-border">
            {docs.map((d) => (
              <li key={d.name} className="flex items-center justify-between px-5 py-3 text-sm">
                <span className="font-medium">{d.name}</span>
                <span className={cn("pilot-kicker", d.tone)}>{d.status}</span>
              </li>
            ))}
          </ul>
        </section>

        <aside className="space-y-4">
          <div className="pilot-card p-5">
            <h4 className="flex items-center gap-2 font-tight text-base font-bold">
              <Hammer className="h-4 w-4 text-primary" /> Demo Window
            </h4>
            <div className="mt-2 font-display text-2xl">Oct 28 → Dec 14</div>
            <p className="mt-1 text-xs text-muted-foreground">Daylight hours · weekday-only per DDOT permit.</p>
          </div>
          <div className="pilot-card p-5">
            <h4 className="flex items-center gap-2 font-tight text-base font-bold">
              <ShieldCheck className="h-4 w-4 text-pilot-teal" /> Risk Watch
            </h4>
            <ul className="mt-3 space-y-2 text-sm">
              <li className="flex items-start gap-2"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 text-warning" /> Adjacent historic facade — vibration limits apply.</li>
              <li className="flex items-start gap-2"><CalendarCheck className="mt-0.5 h-3.5 w-3.5 text-success" /> 30-day notice mailed Sep 22.</li>
            </ul>
          </div>
        </aside>
      </div>
    </div>
  );
};

export default RazePermit;