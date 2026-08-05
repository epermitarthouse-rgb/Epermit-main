import { useSearchParams } from "react-router-dom";
import { CalendarCheck, CheckCircle2, ClipboardList, Clock, Sparkles, Upload, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

type Inspection = {
  id: string;
  type: string;
  agency: string;
  scheduled: string;
  inspector: string;
  status: "scheduled" | "passed" | "failed" | "pending";
  notes?: string;
};

const inspections: Inspection[] = [
  { id: "SI-101", type: "High-strength bolting", agency: "Atlas Inspections", scheduled: "Oct 18, 9:00", inspector: "R. Patel", status: "scheduled" },
  { id: "SI-102", type: "Concrete cylinder break (28d)", agency: "Atlas Inspections", scheduled: "Oct 20, 11:00", inspector: "L. Diaz", status: "scheduled" },
  { id: "SI-103", type: "Soil compaction (pad)", agency: "GeoTrust", scheduled: "Oct 09, 7:30", inspector: "J. Hill", status: "passed", notes: "98% Proctor avg." },
  { id: "SI-104", type: "Sprayed fireproofing", agency: "FireSpec", scheduled: "Oct 11, 13:00", inspector: "K. Mendes", status: "failed", notes: "Thickness < required at columns C-3, C-4." },
  { id: "SI-105", type: "Anchor bolts pre-pour", agency: "Atlas Inspections", scheduled: "TBD", inspector: "—", status: "pending" },
];

const SpecialInspections = () => {
  const [params, setParams] = useSearchParams();
  const v31 = params.get("view") === "v3.1";

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="pilot-kicker text-primary">Third-Party Special Inspections</div>
          <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight">Inspection Coordination</h1>
          <p className="mt-1 text-sm text-muted-foreground">{inspections.length} inspections logged · {inspections.filter((i) => i.status === "scheduled").length} upcoming</p>
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
          <button className="pilot-button-ghost"><Upload className="h-4 w-4" /> Upload Report</button>
          <button className="pilot-button-primary"><Sparkles className="h-4 w-4" /> Schedule</button>
        </div>
      </header>

      <section className="pilot-card overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-muted/30 pilot-kicker">
            <tr>
              <th className="px-5 py-3 font-medium">ID</th>
              <th className="px-5 py-3 font-medium">Type</th>
              <th className="px-5 py-3 font-medium">Agency</th>
              <th className="px-5 py-3 font-medium">Scheduled</th>
              <th className="px-5 py-3 font-medium">Inspector</th>
              <th className="px-5 py-3 font-medium">Status</th>
              {v31 && <th className="px-5 py-3 font-medium">Notes</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {inspections.map((r) => (
              <tr key={r.id} className={cn("hover:bg-muted/40", r.status === "failed" && "bg-destructive/5")}>
                <td className="px-5 py-3 font-data text-xs">{r.id}</td>
                <td className="px-5 py-3 font-medium">{r.type}</td>
                <td className="px-5 py-3 text-muted-foreground">{r.agency}</td>
                <td className="px-5 py-3 font-data text-xs"><CalendarCheck className="mr-1 inline h-3.5 w-3.5 text-primary" />{r.scheduled}</td>
                <td className="px-5 py-3">{r.inspector}</td>
                <td className="px-5 py-3">
                  <StatusBadge status={r.status} />
                </td>
                {v31 && <td className="px-5 py-3 text-xs text-muted-foreground">{r.notes ?? "—"}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
};

const StatusBadge = ({ status }: { status: Inspection["status"] }) => {
  const map = {
    scheduled: { Icon: Clock, tone: "text-primary border-primary/30 bg-primary/10", label: "Scheduled" },
    passed: { Icon: CheckCircle2, tone: "text-success border-success/30 bg-success/10", label: "Passed" },
    failed: { Icon: XCircle, tone: "text-destructive border-destructive/30 bg-destructive/10", label: "Failed" },
    pending: { Icon: ClipboardList, tone: "text-muted-foreground border-border bg-muted/40", label: "Pending" },
  } as const;
  const m = map[status];
  return (
    <span className={cn("inline-flex items-center gap-1 rounded border px-2 py-0.5 pilot-kicker", m.tone)}>
      <m.Icon className="h-3 w-3" /> {m.label}
    </span>
  );
};

export default SpecialInspections;