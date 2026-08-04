import { Aperture, Check, RotateCw, Sparkles, Sun, Tag } from "lucide-react";

const MobileCamera = () => (
  <div className="mx-auto max-w-md space-y-4">
    <header className="rounded-2xl border border-border bg-card p-4">
      <div className="pilot-kicker text-primary">Field Camera</div>
      <h1 className="mt-1 font-display text-2xl font-semibold">Capture w/ Auto-tag</h1>
    </header>
    <div className="relative aspect-[3/4] overflow-hidden rounded-2xl border border-border bg-muted">
      <div className="absolute left-3 top-3 flex items-center gap-2 rounded-full border border-border bg-background/70 px-3 py-1 text-xs font-medium backdrop-blur">
        <Sun className="h-3.5 w-3.5 text-warning" /> Daylight balanced
      </div>
      <div className="absolute right-3 top-3 rounded-full border border-border bg-background/70 px-3 py-1 font-data text-[10px] backdrop-blur">4:3 · 12 MP</div>
      <div className="absolute inset-x-6 bottom-20 rounded-xl border-2 border-primary/70 p-2 text-center text-xs text-primary">
        AI suggests: capture electrical panel label in frame
      </div>
      <div className="absolute inset-x-0 bottom-4 flex items-center justify-around">
        <button className="flex h-12 w-12 items-center justify-center rounded-full border border-border bg-card text-muted-foreground"><Tag className="h-5 w-5" /></button>
        <button className="flex h-16 w-16 items-center justify-center rounded-full border-4 border-primary bg-background"><Aperture className="h-7 w-7 text-primary" /></button>
        <button className="flex h-12 w-12 items-center justify-center rounded-full border border-border bg-card text-muted-foreground"><RotateCw className="h-5 w-5" /></button>
      </div>
    </div>
    <div className="rounded-2xl border border-primary/30 bg-primary/5 p-4 text-sm">
      <div className="flex items-center gap-2 pilot-kicker text-primary"><Sparkles className="h-3.5 w-3.5" /> Auto-Detected</div>
      <p className="mt-1 text-foreground">Electrical service panel · 200A · Sq D · meter #88291</p>
      <div className="mt-3 flex gap-2">
        <button className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground"><Check className="h-4 w-4" /> Confirm tag</button>
        <button className="rounded-lg border border-border px-3 py-2 text-sm">Edit</button>
      </div>
    </div>
  </div>
);

export default MobileCamera;