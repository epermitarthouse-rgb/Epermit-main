import { Crosshair, Filter, Layers, MapPin, Navigation } from "lucide-react";

const pins = [
  { x: 30, y: 38, label: "Gas meter", tone: "bg-warning" },
  { x: 55, y: 52, label: "Electric", tone: "bg-primary" },
  { x: 70, y: 25, label: "Water tap", tone: "bg-pilot-cyan" },
  { x: 42, y: 70, label: "MH-3", tone: "bg-pilot-teal" },
];

const MobileMap = () => (
  <div className="mx-auto max-w-md space-y-4">
    <header className="rounded-2xl border border-border bg-card p-4">
      <div className="pilot-kicker text-primary">Field Companion</div>
      <h1 className="mt-1 font-display text-2xl font-semibold">Utility Locator</h1>
    </header>
    <div className="relative aspect-square overflow-hidden rounded-2xl border border-border bg-muted">
      <svg className="absolute inset-0 h-full w-full opacity-40" viewBox="0 0 100 100" preserveAspectRatio="none">
        <defs><pattern id="g" width="10" height="10" patternUnits="userSpaceOnUse"><path d="M 10 0 L 0 0 0 10" fill="none" stroke="hsl(var(--border))" strokeWidth="0.3" /></pattern></defs>
        <rect width="100" height="100" fill="url(#g)" />
        <path d="M 0 50 L 100 55" stroke="hsl(var(--primary))" strokeWidth="0.5" strokeDasharray="2,2" />
        <path d="M 50 0 L 55 100" stroke="hsl(var(--pilot-cyan))" strokeWidth="0.5" strokeDasharray="2,2" />
      </svg>
      {pins.map((p) => (
        <div key={p.label} className="absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center" style={{ left: `${p.x}%`, top: `${p.y}%` }}>
          <MapPin className={`h-6 w-6 rounded-full p-1 text-white drop-shadow ${p.tone}`} />
          <span className="mt-0.5 rounded bg-background/80 px-1 font-data text-[9px] backdrop-blur">{p.label}</span>
        </div>
      ))}
      <div className="absolute right-3 top-3 flex flex-col gap-2">
        {[Layers, Filter, Crosshair].map((Icon, i) => (
          <button key={i} className="flex h-9 w-9 items-center justify-center rounded-full border border-border bg-background/80 backdrop-blur"><Icon className="h-4 w-4" /></button>
        ))}
      </div>
    </div>
    <div className="rounded-2xl border border-border bg-card p-4 text-sm">
      <div className="flex items-center gap-2"><Navigation className="h-4 w-4 text-primary" /><span className="font-medium">Closest asset</span></div>
      <p className="mt-1 text-xs text-muted-foreground">Electric service · 12 ft NW · drop pin to capture photo</p>
    </div>
  </div>
);

export default MobileMap;