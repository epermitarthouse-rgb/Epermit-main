import { Camera, CheckCircle2, ChevronRight, Cloud, ListChecks, MapPin, Mic } from "lucide-react";

const steps = [
  { label: "Frontage photo (street)", done: true },
  { label: "Utility meter shot", done: true },
  { label: "Egress doors panorama", done: false, active: true },
  { label: "Roof access photo", done: false },
  { label: "Adjacent building setback", done: false },
];

const MobileSurvey = () => (
  <div className="mx-auto max-w-md space-y-4">
    <header className="rounded-2xl border border-border bg-card p-5 shadow-lg">
      <div className="pilot-kicker text-primary">Field Companion</div>
      <h1 className="mt-1 font-display text-2xl font-semibold">Site Survey</h1>
      <p className="mt-1 text-xs text-muted-foreground">McDonald's · 75 NY Ave NE</p>
      <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
        <MapPin className="h-3.5 w-3.5 text-primary" /> 38.9028°N · −77.0094°W · GPS ±3m
      </div>
    </header>
    <section className="rounded-2xl border border-border bg-card p-5">
      <h2 className="flex items-center gap-2 font-tight text-base font-bold">
        <ListChecks className="h-4 w-4 text-primary" /> Capture Checklist
      </h2>
      <ul className="mt-3 space-y-2">
        {steps.map((s) => (
          <li key={s.label} className={`flex items-center justify-between rounded-lg border px-3 py-2 ${s.active ? "border-primary/40 bg-primary/5" : "border-border bg-muted/30"}`}>
            <span className="flex items-center gap-2 text-sm">
              {s.done ? <CheckCircle2 className="h-4 w-4 text-success" /> : <span className="h-3 w-3 rounded-full border border-current" />}
              {s.label}
            </span>
            {s.active && <ChevronRight className="h-4 w-4 text-primary" />}
          </li>
        ))}
      </ul>
    </section>
    <div className="grid grid-cols-3 gap-2">
      {[{i: Camera, l: "Capture"}, {i: Mic, l: "Voice"}, {i: Cloud, l: "Sync"}].map(({i: Icon, l}) => (
        <button key={l} className="flex flex-col items-center gap-1 rounded-2xl border border-border bg-card p-4 text-xs font-medium">
          <Icon className="h-5 w-5 text-primary" /> {l}
        </button>
      ))}
    </div>
    <button className="w-full rounded-2xl bg-primary px-4 py-3 font-semibold text-primary-foreground">Finish Survey</button>
  </div>
);

export default MobileSurvey;