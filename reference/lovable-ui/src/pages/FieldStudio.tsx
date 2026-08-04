import { Brush, Image as ImageIcon, Layers, MousePointer2, Save, Sparkles, Type } from "lucide-react";

const layers = [
  { name: "Base photo", visible: true },
  { name: "Markup · arrows", visible: true },
  { name: "Annotations", visible: true },
  { name: "Measurements", visible: false },
];

const FieldStudio = () => (
  <div className="space-y-6">
    <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
      <div>
        <div className="pilot-kicker text-primary">Field Intelligence Studio</div>
        <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight">Annotation &amp; Markup</h1>
        <p className="mt-1 text-sm text-muted-foreground">Mark up field captures with AI-assisted callouts.</p>
      </div>
      <div className="flex gap-2">
        <button className="pilot-button-ghost"><Save className="h-4 w-4" /> Save</button>
        <button className="pilot-button-primary"><Sparkles className="h-4 w-4" /> Auto-Annotate</button>
      </div>
    </header>
    <div className="grid gap-4 lg:grid-cols-[64px_1fr_280px]">
      <aside className="pilot-card flex flex-col items-center gap-2 p-2">
        {[MousePointer2, Brush, Type, ImageIcon].map((Icon, i) => (
          <button key={i} className="flex h-10 w-10 items-center justify-center rounded border border-border text-muted-foreground hover:border-primary hover:text-primary"><Icon className="h-4 w-4" /></button>
        ))}
      </aside>
      <section className="pilot-card relative aspect-video overflow-hidden bg-[linear-gradient(135deg,hsl(var(--muted))_25%,transparent_25%,transparent_50%,hsl(var(--muted))_50%,hsl(var(--muted))_75%,transparent_75%)] bg-[length:24px_24px]">
        <div className="absolute inset-0 m-8 rounded border border-dashed border-primary/40" />
        <div className="absolute left-1/3 top-1/2 -translate-y-1/2 rounded border border-primary bg-primary/10 px-2 py-1 font-data text-xs text-primary">⌀ Service Panel · 200A</div>
        <svg className="absolute right-1/4 top-1/4" width="120" height="80"><line x1="0" y1="80" x2="120" y2="0" stroke="hsl(var(--destructive))" strokeWidth="2" /><text x="60" y="50" className="fill-destructive font-data text-xs">conflict</text></svg>
      </section>
      <aside className="pilot-card p-4">
        <h3 className="flex items-center gap-2 font-tight text-base font-bold"><Layers className="h-4 w-4 text-primary" /> Layers</h3>
        <ul className="mt-3 space-y-2 text-sm">
          {layers.map((l) => (
            <li key={l.name} className="flex items-center gap-2 rounded border border-border bg-muted/30 px-3 py-1.5">
              <input type="checkbox" defaultChecked={l.visible} className="h-3 w-3" /> {l.name}
            </li>
          ))}
        </ul>
        <div className="mt-4 rounded-lg border border-primary/30 bg-primary/5 p-3 text-xs">
          <div className="pilot-kicker text-primary">Auto-Annotate</div>
          <p className="mt-1 text-muted-foreground">3 elements detected: panel, conduit, meter.</p>
        </div>
      </aside>
    </div>
  </div>
);

export default FieldStudio;