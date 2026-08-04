import { FileText, Layers, Pin, Save, Search, Sparkles } from "lucide-react";

const sheets = [
  { id: "S-01", name: "Cover + Vicinity", reviewed: true },
  { id: "S-02", name: "Zoning Analysis", reviewed: true },
  { id: "S-03", name: "Existing Conditions", reviewed: true },
  { id: "S-04", name: "Utility Survey", reviewed: false },
  { id: "S-05", name: "Easement Map", reviewed: false },
  { id: "S-06", name: "Photo Plate", reviewed: true },
];

const SirWorkspace = () => (
  <div className="space-y-6">
    <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
      <div>
        <div className="pilot-kicker text-primary">SIR Technical Workspace</div>
        <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight">Investigation Workbench</h1>
      </div>
      <div className="flex gap-2">
        <button className="pilot-button-ghost"><Save className="h-4 w-4" /> Save Draft</button>
        <button className="pilot-button-primary"><Sparkles className="h-4 w-4" /> Auto-Compose</button>
      </div>
    </header>

    <div className="grid gap-4 lg:grid-cols-[260px_1fr_320px]">
      <aside className="pilot-card p-4">
        <h2 className="flex items-center gap-2 font-tight text-base font-bold"><Layers className="h-4 w-4 text-primary" /> Sheets</h2>
        <ul className="mt-3 space-y-1 text-sm">
          {sheets.map((s) => (
            <li key={s.id} className={`flex items-center justify-between rounded px-2 py-1.5 ${s.reviewed ? "text-muted-foreground" : "bg-primary/5 font-medium"}`}>
              <span><span className="font-data text-xs">{s.id}</span> · {s.name}</span>
              {s.reviewed && <span className="font-data text-[10px] text-success">✓</span>}
            </li>
          ))}
        </ul>
      </aside>

      <section className="pilot-card overflow-hidden">
        <header className="flex items-center justify-between border-b border-border bg-muted/30 px-4 py-2">
          <div className="flex items-center gap-2 text-sm font-medium"><FileText className="h-4 w-4 text-primary" /> S-04 · Utility Survey</div>
          <label className="flex items-center gap-2 rounded border border-border bg-card px-2 py-1">
            <Search className="h-3.5 w-3.5 text-muted-foreground" />
            <input className="bg-transparent text-xs outline-none placeholder:text-muted-foreground" placeholder="Search in sheet" />
          </label>
        </header>
        <div className="aspect-video bg-[radial-gradient(circle_at_50%_50%,hsl(var(--muted))_0%,hsl(var(--background))_70%)] p-8">
          <div className="mx-auto h-full max-w-xl rounded border border-dashed border-border bg-card/50 p-6 text-center text-sm text-muted-foreground">
            Sheet S-04 preview — utility survey overlay with 4 detected conflicts.
          </div>
        </div>
      </section>

      <aside className="pilot-card p-4 space-y-3">
        <h3 className="flex items-center gap-2 font-tight text-base font-bold"><Pin className="h-4 w-4 text-primary" /> Pinned Findings</h3>
        <ul className="space-y-2 text-sm">
          <li className="rounded border border-warning/30 bg-warning/5 p-3">
            <div className="pilot-kicker text-warning">Conflict</div>
            <p className="mt-1">Gas service crosses planned column line C-6.</p>
          </li>
          <li className="rounded border border-primary/30 bg-primary/5 p-3">
            <div className="pilot-kicker text-primary">Note</div>
            <p className="mt-1">Confirm easement width with DDOT before final report.</p>
          </li>
        </ul>
      </aside>
    </div>
  </div>
);

export default SirWorkspace;