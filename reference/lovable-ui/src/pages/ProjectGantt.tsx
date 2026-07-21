import { useState } from "react";
import { useParams } from "react-router-dom";
import { ChevronDown, Download, Filter, MessageSquare, Sparkles } from "lucide-react";
import { useActiveProject, PROJECTS } from "@/state/activeProject";
import { cn } from "@/lib/utils";
import { CsvExportDialog, type CsvColumn } from "@/components/CsvExportDialog";

type Bar = { left: number; width: number; label?: string; tone: "muted" | "primary" | "cyan" | "success" | "cp" };

const groups: { title: string; tone?: string; bars: { name: string; bar: Bar; cp?: boolean; done?: boolean }[] }[] = [
  {
    title: "Building Permit Review #2",
    bars: [
      { name: "Health Review #2", bar: { left: 10, width: 15, label: "In Progress", tone: "cyan" } },
      { name: "Fire Review #2", bar: { left: 25, width: 10, tone: "muted" } },
      { name: "Building Permit Issuance", bar: { left: 35, width: 25, label: "Critical Path", tone: "cp" }, cp: true },
    ],
  },
  {
    title: "Gas Utility Coordination",
    tone: "text-primary",
    bars: [
      { name: "Service Application", bar: { left: 20, width: 5, tone: "success" }, done: true },
      { name: "Site Plan Showing Gas Lines", bar: { left: 25, width: 15, tone: "muted" } },
      { name: "Gas New Service Installation", bar: { left: 45, width: 20, label: "Critical Path", tone: "cp" }, cp: true },
    ],
  },
];

const barTone: Record<Bar["tone"], string> = {
  muted: "bg-border",
  primary: "bg-primary/30 border border-primary",
  cyan: "bg-pilot-cyan/20 border border-pilot-cyan",
  success: "bg-success/80 border border-success",
  cp: "bg-primary border border-primary text-primary-foreground",
};

const ProjectGantt = () => {
  const { id } = useParams();
  const { active } = useActiveProject();
  const project = PROJECTS.find((p) => p.id === id) ?? active;
  const [exportOpen, setExportOpen] = useState(false);

  type GanttRow = {
    group: string;
    task: string;
    cp: string;
    status: string;
    start: string;
    width: string;
    label: string;
  };

  const exportRows: GanttRow[] = groups.flatMap((g) =>
    g.bars.map<GanttRow>((row) => ({
      group: g.title,
      task: row.name,
      cp: row.cp ? "Yes" : "No",
      status: row.done ? "Done" : "Open",
      start: `${row.bar.left}%`,
      width: `${row.bar.width}%`,
      label: row.bar.label ?? "",
    })),
  );

  const ganttColumns: CsvColumn<GanttRow>[] = [
    { key: "group", label: "Group", value: (r) => r.group },
    { key: "task", label: "Task", value: (r) => r.task },
    { key: "cp", label: "Critical Path", value: (r) => r.cp },
    { key: "status", label: "Status", value: (r) => r.status },
    { key: "start", label: "Start", value: (r) => r.start },
    { key: "width", label: "Width", value: (r) => r.width },
    { key: "label", label: "Label", value: (r) => r.label },
  ];

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight text-foreground">Unified Task Matrix · Gantt</h1>
          <p className="mt-1 text-sm text-muted-foreground">{project.name}</p>
        </div>
        <div className="flex gap-2">
          <button className="pilot-button-ghost"><Filter className="h-4 w-4" /> Filter</button>
          <button className="pilot-button-ghost" onClick={() => setExportOpen(true)}>
            <Download className="h-4 w-4" /> Export CSV
          </button>
          <button className="pilot-button-primary"><Sparkles className="h-4 w-4" /> Deploy Agent</button>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        {/* Gantt body */}
        <section className="pilot-card overflow-hidden">
          {/* Header */}
          <div className="flex border-b border-border bg-muted/40">
            <div className="w-[280px] shrink-0 border-r border-border p-3 pilot-kicker">Task Name</div>
            <div className="flex-1">
              <div className="grid grid-cols-4 border-b border-border font-data text-xs text-muted-foreground">
                {["June", "July", "August", "September"].map((m) => (
                  <span key={m} className="border-r border-border px-2 py-1 last:border-0">{m}</span>
                ))}
              </div>
              <div className="grid grid-cols-10 font-data text-[10px] text-muted-foreground">
                {Array.from({ length: 10 }, (_, i) => `W${(i % 4) + 1}`).map((w, i) => (
                  <span key={i} className="border-r border-border/50 px-2 py-1 text-center opacity-60 last:border-0">
                    {w}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* Groups */}
          <div className="divide-y divide-border">
            {groups.map((g) => (
              <div key={g.title}>
                <div className="flex bg-muted/30">
                  <div className="flex w-[280px] shrink-0 items-center gap-2 border-r border-border bg-background p-2">
                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    <span className={cn("font-tight text-sm font-bold", g.tone ?? "text-foreground")}>{g.title}</span>
                    <span className="ml-auto rounded bg-muted px-1.5 font-data text-[10px] text-muted-foreground">
                      {g.bars.length}
                    </span>
                  </div>
                  <div className="relative flex-1">
                    <div className="absolute left-[15%] right-[30%] top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-muted-foreground/30" />
                  </div>
                </div>
                {g.bars.map((row) => (
                  <div key={row.name} className="group flex transition-colors hover:bg-muted/40">
                    <div className="flex w-[280px] shrink-0 items-center gap-2 border-r border-border bg-background p-2 pl-8">
                      <input type="checkbox" defaultChecked={row.done} className="h-3 w-3 rounded border-border" readOnly />
                      <span className={cn("text-sm", row.done ? "text-muted-foreground line-through" : "text-foreground")}>
                        {row.name}
                      </span>
                      {row.cp && (
                        <span className="rounded border border-primary/30 bg-primary/10 px-1 font-data text-[9px] font-bold text-primary">
                          CP
                        </span>
                      )}
                      <MessageSquare className="ml-auto h-3 w-3 text-muted-foreground" />
                    </div>
                    <div className="relative flex-1 border-b border-border/40 py-3">
                      <div
                        className={cn("absolute top-1/2 flex h-6 -translate-y-1/2 items-center rounded px-2", barTone[row.bar.tone])}
                        style={{ left: `${row.bar.left}%`, width: `${row.bar.width}%` }}
                      >
                        <span className="truncate font-data text-[10px] font-bold">{row.bar.label ?? ""}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </section>

        {/* Side: Field Impact */}
        <aside className="pilot-card flex h-full flex-col p-5">
          <h3 className="font-display text-xl font-semibold">Field Impact Analytics</h3>
          <div className="mt-4 rounded-lg border border-border bg-muted/40 p-3">
            <div className="pilot-kicker text-muted-foreground">Schedule Variance</div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="font-data text-xl font-bold text-warning">+4.2</span>
              <span className="text-sm text-muted-foreground">Days</span>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Driven primarily by recent gas line routing discrepancies found in Field Survey #402.
            </p>
          </div>

          <h4 className="mt-6 pilot-kicker">Critical Path Disruptors</h4>
          <ul className="mt-3 space-y-3 text-sm">
            {[
              { dot: "bg-destructive", title: "Prescreen Review #2", sub: "Commun-ET LLC · Delayed" },
              { dot: "bg-primary", title: "MEP Drawings Update", sub: "Landlord · Pending Auth" },
            ].map((row) => (
              <li key={row.title} className="flex gap-3">
                <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", row.dot)} />
                <div>
                  <div className="font-semibold text-foreground">{row.title}</div>
                  <div className="font-data text-xs text-muted-foreground">{row.sub}</div>
                </div>
              </li>
            ))}
          </ul>

          <div className="mt-auto rounded-lg border border-primary/30 bg-primary/5 p-3 text-xs text-muted-foreground">
            <Sparkles className="mr-1 inline h-3 w-3 text-primary" />
            AI suggestion: shift Gas Service Installation forward two weeks to recover float.
          </div>
        </aside>
      </div>
      <CsvExportDialog
        open={exportOpen}
        onOpenChange={setExportOpen}
        title="Export Gantt to CSV"
        description="Pick the columns to include in the Gantt export."
        filename={`${project.id}-gantt`}
        columns={ganttColumns}
        rows={exportRows}
        storageKey="gantt"
      />
    </div>
  );
};

export default ProjectGantt;