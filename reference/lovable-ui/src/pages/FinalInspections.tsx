import { useSearchParams } from "react-router-dom";
import { CalendarCheck, CheckCircle2, ClipboardCheck, Clock, FileCheck2, Sparkles, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

type Item = { id: string; trade: string; agency: string; status: "passed" | "failed" | "scheduled" | "todo"; date: string; notes?: string };

const items: Item[] = [
  { id: "FI-01", trade: "Building Final", agency: "DOB", status: "passed", date: "Oct 22" },
  { id: "FI-02", trade: "Electrical Final", agency: "DOB-ELEC", status: "passed", date: "Oct 23" },
  { id: "FI-03", trade: "Plumbing Final", agency: "DOH", status: "failed", date: "Oct 24", notes: "Two trap primers missing." },
  { id: "FI-04", trade: "Fire Final", agency: "FEMS", status: "scheduled", date: "Oct 30" },
  { id: "FI-05", trade: "Public Space", agency: "DDOT", status: "todo", date: "—" },
  { id: "FI-06", trade: "Certificate of Occupancy", agency: "DOB", status: "todo", date: "—" },
];

const FinalInspections = () => {
  const [params, setParams] = useSearchParams();
  const v31 = params.get("view") === "v3.1";
  const passed = items.filter((i) => i.status === "passed").length;
  const pct = Math.round((passed / items.length) * 100);

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="pilot-kicker text-primary">Final Inspections / CO</div>
          <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight">Closeout Sweep</h1>
          <p className="mt-1 text-sm text-muted-foreground">Path to Certificate of Occupancy.</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-md border border-border bg-card p-0.5 text-xs">
            {(["v3", "v3.1"] as const).map((v) => {
              const active = (v === "v3.1") === v31;
              return (
                <button key={v} onClick={() => setParams(v === "v3.1" ? { view: "v3.1" } : {}, { replace: true })} className={cn("rounded px-3 py-1.5 transition-colors", active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>
                  {v}
                </button>
              );
            })}
          </div>
          <button className="pilot-button-primary"><Sparkles className="h-4 w-4" /> Request CO</button>
        </div>
      </header>

      <section className="pilot-card flex items-center gap-6 p-5">
        <div className="font-display text-5xl font-semibold text-primary">{pct}%</div>
        <div className="flex-1">
          <div className="pilot-kicker text-muted-foreground">Final Inspection Progress</div>
          <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-border">
            <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">{passed} of {items.length} complete · 1 failure to reschedule.</p>
        </div>
      </section>

      <section className="pilot-card overflow-hidden">
        <header className="border-b border-border bg-muted/30 px-5 py-3">
          <h2 className="flex items-center gap-2 font-tight text-base font-bold"><ClipboardCheck className="h-4 w-4 text-primary" /> Inspections</h2>
        </header>
        <ul className="divide-y divide-border">
          {items.map((i) => (
            <li key={i.id} className={cn("flex items-center gap-4 px-5 py-3 text-sm", i.status === "failed" && "bg-destructive/5")}>
              <span className="w-16 font-data text-xs text-muted-foreground">{i.id}</span>
              <span className="flex-1 font-medium">{i.trade} <span className="text-xs font-normal text-muted-foreground">· {i.agency}</span></span>
              <span className="w-24 text-right font-data text-xs"><CalendarCheck className="mr-1 inline h-3 w-3 text-primary" />{i.date}</span>
              <StatusBadge status={i.status} />
            </li>
          ))}
        </ul>
      </section>

      <div className="pilot-card flex items-center gap-3 p-5">
        <FileCheck2 className="h-5 w-5 text-primary" />
        <div className="flex-1 text-sm"><span className="font-medium">CO eligibility:</span> available after FI-03 re-inspection passes.</div>
      </div>
    </div>
  );
};

const StatusBadge = ({ status }: { status: Item["status"] }) => {
  const map = {
    passed: { Icon: CheckCircle2, tone: "text-success bg-success/10 border-success/30" },
    failed: { Icon: XCircle, tone: "text-destructive bg-destructive/10 border-destructive/30" },
    scheduled: { Icon: Clock, tone: "text-primary bg-primary/10 border-primary/30" },
    todo: { Icon: ClipboardCheck, tone: "text-muted-foreground bg-muted/40 border-border" },
  } as const;
  const m = map[status];
  return (
    <span className={cn("inline-flex items-center gap-1 rounded border px-2 py-0.5 pilot-kicker", m.tone)}>
      <m.Icon className="h-3 w-3" /> {status}
    </span>
  );
};

export default FinalInspections;