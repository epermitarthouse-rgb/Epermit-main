import { useState } from "react";
import { useParams } from "react-router-dom";
import { CalendarRange, Download, Edit, RefreshCw, TrendingDown, TrendingUp } from "lucide-react";
import { useActiveProject, PROJECTS } from "@/state/activeProject";
import { cn } from "@/lib/utils";
import { CsvExportDialog, type CsvColumn } from "@/components/CsvExportDialog";

const months = ["Oct", "Nov", "Dec", "Jan", "Feb", "Mar", "Apr"];

const tracks = [
  { name: "Permitting", start: 0, width: 33, fill: 50, tone: "bg-pilot-cyan/30 border-pilot-cyan", fillTone: "bg-pilot-cyan" },
  { name: "Utility", start: 16, width: 50, fill: 100, tone: "bg-primary/30 border-primary", fillTone: "bg-primary" },
  { name: "Inspections", start: 50, width: 28, fill: 20, tone: "bg-pilot-teal/30 border-pilot-teal", fillTone: "bg-pilot-teal" },
];

const events = [
  { time: "Today, 09:41 AM", title: "Transformer Lead-Time Slip", impact: "+2 weeks projected delay", tone: "destructive" as const },
  { time: "Yesterday, 14:22 PM", title: "Site Evidence Synced", impact: "Reduced Utility Risk", tone: "success" as const },
  { time: "Tue, 11:08 AM", title: "Health Pre-Screen Approved", impact: "Critical path unblocked", tone: "success" as const },
];

const toneClass = {
  destructive: "border-destructive text-destructive",
  success: "border-success text-success",
} as const;

type TimelineRow = {
  type: "Track" | "Event";
  name: string;
  start: string;
  width: string;
  fill: string;
  notes: string;
};

const timelineColumns: CsvColumn<TimelineRow>[] = [
  { key: "type", label: "Type", value: (r) => r.type },
  { key: "name", label: "Name", value: (r) => r.name },
  { key: "start", label: "Start", value: (r) => r.start },
  { key: "width", label: "Width", value: (r) => r.width },
  { key: "fill", label: "Fill", value: (r) => r.fill },
  { key: "notes", label: "Notes", value: (r) => r.notes },
];

const ProjectTimeline = () => {
  const { id } = useParams();
  const { active } = useActiveProject();
  const project = PROJECTS.find((p) => p.id === id) ?? active;
  const [exportOpen, setExportOpen] = useState(false);

  const exportRows: TimelineRow[] = [
    ...tracks.map<TimelineRow>((t) => ({
      type: "Track",
      name: t.name,
      start: `${t.start}%`,
      width: `${t.width}%`,
      fill: `${t.fill}%`,
      notes: "",
    })),
    ...events.map<TimelineRow>((e) => ({
      type: "Event",
      name: e.title,
      start: "",
      width: "",
      fill: "",
      notes: `${e.time} — ${e.impact}`,
    })),
  ];

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="pilot-kicker text-primary">{project.phase}</div>
          <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight text-foreground">{project.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">Milestone &amp; Field-Impact Timeline</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="pilot-button-ghost"><RefreshCw className="h-4 w-4" /> Sync Field Data</button>
          <button className="pilot-button-ghost" onClick={() => setExportOpen(true)}>
            <Download className="h-4 w-4" /> Export CSV
          </button>
          <button className="pilot-button-primary"><Edit className="h-4 w-4" /> Update Schedule</button>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-4">
        <div className="space-y-6 lg:col-span-3">
          {/* Schedule summary */}
          <section className="pilot-card relative flex flex-wrap items-center gap-8 overflow-hidden p-5">
            <div className="pointer-events-none absolute -bottom-4 -right-4 h-16 w-16 rounded-full bg-primary/10 blur-xl" />
            <SummaryStat label="Project Start" value="Oct 15, 2023" />
            <div className="h-8 w-px bg-border" />
            <SummaryStat label="P50 Projection (Likely)" value="Mar 12, 2024" dot="bg-primary" />
            <div className="h-8 w-px bg-border" />
            <SummaryStat label="P90 Projection (Worst Case)" value="Apr 30, 2024" dot="bg-pilot-teal" />
          </section>

          {/* Timeline widget */}
          <section className="pilot-card overflow-hidden">
            <header className="flex items-center justify-between border-b border-border bg-muted/40 p-5">
              <h2 className="flex items-center gap-2 font-tight text-lg font-bold">
                <CalendarRange className="h-5 w-5 text-primary" /> 40-Week Horizon
              </h2>
              <div className="flex items-center gap-2 pilot-kicker">
                <span className="text-muted-foreground">Scale:</span>
                <button className="text-primary">Weeks</button>
                <button className="text-muted-foreground hover:text-foreground">Months</button>
              </div>
            </header>
            <div className="overflow-x-auto p-5">
              <div className="min-w-[720px]">
                {/* Month markers */}
                <div className="grid grid-cols-7 pilot-kicker text-muted-foreground">
                  {months.map((m) => <span key={m}>{m}</span>)}
                </div>
                {/* Tracks */}
                <div className="mt-6 space-y-4 border-l border-border pl-2">
                  {tracks.map((t) => (
                    <div key={t.name} className="relative grid grid-cols-[120px_1fr] items-center gap-4">
                      <span className="pilot-kicker text-right text-muted-foreground">{t.name}</span>
                      <div className="relative h-6">
                        <div className={cn("absolute h-full rounded-full border", t.tone)} style={{ left: `${t.start}%`, width: `${t.width}%` }}>
                          <div className={cn("h-full rounded-full", t.fillTone)} style={{ width: `${t.fill}%` }} />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                {/* Milestone marker */}
                <div className="mt-6 grid grid-cols-[120px_1fr] gap-4">
                  <span />
                  <div className="relative h-12">
                    <div className="absolute left-[18%] flex flex-col items-center">
                      <div className="h-12 w-px border-l border-dashed border-warning" />
                      <span className="mt-1 rounded bg-warning/10 px-1.5 pilot-kicker text-warning">Site Survey · Oct 24</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>

        {/* Field Impact Analytics */}
        <aside className="pilot-card flex flex-col p-5">
          <header className="mb-4 flex items-center gap-2 border-b border-border pb-3">
            <TrendingUp className="h-5 w-5 text-primary" />
            <h3 className="font-tight text-lg font-bold">Field Impact Analytics</h3>
          </header>
          <ul className="flex-1 space-y-4">
            {events.map((e) => (
              <li key={e.title} className={cn("border-l-2 py-1 pl-3", toneClass[e.tone])}>
                <span className="pilot-kicker text-muted-foreground">{e.time}</span>
                <p className="mt-1 text-sm font-medium text-foreground">{e.title}</p>
                <p className={cn("mt-0.5 text-xs", e.tone === "destructive" ? "text-destructive" : "text-success")}>
                  {e.impact}
                </p>
              </li>
            ))}
          </ul>
          <div className="mt-4 rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
            <TrendingDown className="mr-1 inline h-3 w-3 text-destructive" />
            Net schedule variance: <span className="font-data font-bold text-warning">+4.2 days</span>
          </div>
        </aside>
      </div>
      <CsvExportDialog
        open={exportOpen}
        onOpenChange={setExportOpen}
        title="Export Timeline to CSV"
        description="Pick the columns to include in the timeline export."
        filename={`${project.id}-timeline`}
        columns={timelineColumns}
        rows={exportRows}
        storageKey="timeline"
      />
    </div>
  );
};

const SummaryStat = ({ label, value, dot }: { label: string; value: string; dot?: string }) => (
  <div className="flex flex-col">
    <span className="pilot-kicker mb-1 flex items-center gap-1.5 text-muted-foreground">
      {dot && <span className={cn("inline-block h-2 w-2 rounded-full", dot)} />}
      {label}
    </span>
    <span className="font-data text-sm">{value}</span>
  </div>
);

export default ProjectTimeline;