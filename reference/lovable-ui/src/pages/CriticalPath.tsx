import { useState } from "react";
import { AlertTriangle, ArrowRight, Ban, Download, FileText, Filter, Mail, Route, Sparkles, Activity, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { CsvExportDialog, type CsvColumn } from "@/components/CsvExportDialog";

const rows = [
  {
    icon: FileText, group: true, title: "Building Permit Issuance", sub: "BP-2023-0491",
    owner: "Commun-ET LLC", days: -2, daysTone: "destructive" as const,
    blocker: "Awaiting Health Plan Review", blockerTone: "muted" as const,
  },
  {
    icon: Sparkles, indent: true, title: "Health Application Submittal",
    owner: "Commun-ET LLC", days: -5, daysTone: "destructive" as const,
    blocker: "Plumbing Fixture Schedule", blockerTone: "destructive" as const,
    highlight: true,
  },
  {
    icon: FileText, indent: true, title: "Approval Issuance",
    owner: "Commun-ET LLC", days: 14, daysTone: "warning" as const,
    blocker: "Dependent on Submittal", blockerTone: "muted" as const,
  },
  {
    icon: Zap, group: true, title: "Pepco Primary Energization", sub: "UTIL-24-902",
    owner: "Utility Co.", days: 45, daysTone: "default" as const,
    blocker: "Transformer Delivery", blockerTone: "muted" as const,
  },
];

const daysTone = {
  destructive: "text-destructive",
  warning: "text-warning",
  default: "text-foreground",
} as const;

const blockerTone = {
  muted: "text-muted-foreground",
  destructive: "bg-destructive/10 text-destructive border border-destructive/30",
} as const;

type CritRow = (typeof rows)[number];

const critColumns: CsvColumn<CritRow>[] = [
  { key: "task", label: "Task", value: (r) => r.title },
  { key: "reference", label: "Reference", value: (r) => r.sub ?? "" },
  { key: "responsible", label: "Responsible", value: (r) => r.owner },
  { key: "days", label: "Days Remaining", value: (r) => r.days },
  { key: "blocker", label: "Blocker", value: (r) => r.blocker },
  { key: "path", label: "Path", value: () => "CP" },
];

const CriticalPath = () => {
  const [exportOpen, setExportOpen] = useState(false);

  return (
    <>
    <div className="space-y-6">
    <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
      <div>
        <div className="pilot-kicker text-primary">Unified Task Matrix</div>
        <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight text-foreground">Critical Path Intelligence</h1>
        <p className="mt-1 text-sm text-muted-foreground">Tasks directly impacting energization date.</p>
      </div>
      <div className="flex gap-2">
        <button className="pilot-button-ghost"><Filter className="h-4 w-4" /> Filter</button>
        <button className="pilot-button-ghost" onClick={() => setExportOpen(true)}>
          <Download className="h-4 w-4" /> Export CSV
        </button>
        <button className="pilot-button-primary"><Sparkles className="h-4 w-4" /> Deploy Agent</button>
      </div>
    </header>

    <div className="grid gap-6 lg:grid-cols-12">
      {/* Critical path table */}
      <section className="pilot-card overflow-hidden lg:col-span-8">
        <header className="border-b border-border bg-muted/40 p-5">
          <h3 className="font-tight text-lg font-bold">Active Critical Path</h3>
          <p className="text-sm text-muted-foreground">Live blockers and float across the energization track.</p>
        </header>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted/30">
              <tr className="pilot-kicker">
                <th className="px-5 py-3 font-medium">Item / Task</th>
                <th className="px-5 py-3 font-medium">Path</th>
                <th className="px-5 py-3 font-medium">Responsible</th>
                <th className="px-5 py-3 text-right font-medium">Days Remaining</th>
                <th className="px-5 py-3 font-medium">Blockers / Dependencies</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((r) => (
                <tr
                  key={r.title}
                  className={cn(
                    "group transition-colors hover:bg-muted/40",
                    r.highlight && "bg-destructive/5 border-l-4 border-destructive",
                  )}
                >
                  <td className={cn("px-5 py-4", r.indent && "pl-10")}>
                    <div className="flex items-center gap-3">
                      <r.icon className={cn("h-5 w-5", r.highlight ? "text-destructive" : r.group ? "text-primary" : "text-muted-foreground")} />
                      <div>
                        <div className={cn("font-semibold text-foreground", r.group ? "font-tight text-base" : "font-medium")}>
                          {r.title}
                        </div>
                        {r.sub && <div className="font-data text-xs text-muted-foreground">{r.sub}</div>}
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-4">
                    <span className="rounded bg-primary/10 px-2 py-0.5 pilot-kicker text-primary">CP</span>
                  </td>
                  <td className="px-5 py-4 text-foreground">{r.owner}</td>
                  <td className={cn("px-5 py-4 text-right font-data font-bold", daysTone[r.daysTone])}>
                    <span className="inline-flex items-center justify-end gap-1">
                      {r.daysTone === "destructive" && <AlertTriangle className="h-3.5 w-3.5" />}
                      {r.days > 0 ? r.days : r.days}
                    </span>
                  </td>
                  <td className="px-5 py-4">
                    <span className={cn("inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs", blockerTone[r.blockerTone])}>
                      {r.blockerTone === "destructive" && <Ban className="h-3 w-3" />}
                      {r.blocker}
                    </span>
                  </td>
                  <td className="px-5 py-4">
                    <button className="rounded p-1 text-primary opacity-0 transition-opacity hover:text-primary/80 group-hover:opacity-100">
                      <ArrowRight className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Delay projection + interventions */}
      <div className="space-y-6 lg:col-span-4">
        <section className="pilot-card relative overflow-hidden p-5">
          <div className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-primary/5 blur-xl" />
          <h3 className="mb-4 flex items-center gap-2 font-tight text-lg font-bold">
            <Activity className="h-5 w-5 text-primary" /> Delay Projection
          </h3>
          <div className="rounded-lg border border-border bg-muted/40 p-4">
            <div className="pilot-kicker">Target Energization</div>
            <div className="mt-1 font-display text-3xl font-semibold">Oct 15</div>
            <div className="mt-4 space-y-4">
              <Projection label="P50 Projection" value="Nov 02 (+18d)" tone="warning" width={60} />
              <Projection label="P90 Projection" value="Dec 14 (+60d)" tone="destructive" width={85} />
            </div>
          </div>
        </section>

        <section className="pilot-card p-5">
          <h3 className="font-tight text-lg font-bold">Path Interventions</h3>
          <p className="mt-1 text-sm text-muted-foreground">Critical blockers detected. Immediate action recommended.</p>
          <div className="mt-4 flex flex-col gap-2">
            <button className="flex items-center justify-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 font-semibold text-destructive transition-colors hover:bg-destructive/20">
              <AlertTriangle className="h-4 w-4" /> Escalate Blocker
            </button>
            <button className="flex items-center justify-center gap-2 rounded-lg border border-primary/40 bg-background px-4 py-3 font-semibold text-primary transition-colors hover:bg-primary/10">
              <Route className="h-4 w-4" /> Re-route Track
            </button>
            <button className="flex items-center justify-center gap-2 rounded-lg border border-border bg-background px-4 py-3 font-semibold text-foreground transition-colors hover:bg-muted">
              <Mail className="h-4 w-4" /> Notify Stakeholders
            </button>
          </div>
        </section>
      </div>
    </div>
    </div>
    <CsvExportDialog
      open={exportOpen}
      onOpenChange={setExportOpen}
      title="Export Critical Path to CSV"
      description="Pick the columns to include in the critical path export."
      filename="critical-path"
      columns={critColumns}
      rows={rows}
      storageKey="critical-path"
    />
    </>
  );
};

const Projection = ({ label, value, tone, width }: { label: string; value: string; tone: "warning" | "destructive"; width: number }) => {
  const barTone = tone === "warning" ? "bg-warning" : "bg-destructive";
  const textTone = tone === "warning" ? "text-warning" : "text-destructive";
  return (
    <div>
      <div className="mb-1 flex justify-between text-sm">
        <span className="font-medium">{label}</span>
        <span className={cn("font-data", textTone)}>{value}</span>
      </div>
      <div className="h-2 w-full rounded-full bg-border">
        <div className={cn("h-2 rounded-full", barTone)} style={{ width: `${width}%` }} />
      </div>
    </div>
  );
};

export default CriticalPath;