import { CheckCircle2, ClipboardCheck, FileText, Sparkles, Upload, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

const checks = [
  { label: "Title block complete", pass: true },
  { label: "Drawing set numbered consecutively", pass: true },
  { label: "Stamped by RA/PE", pass: true },
  { label: "Code analysis included", pass: false, fix: "Missing IBC 2021 occupancy classification." },
  { label: "Egress diagrams attached", pass: true },
  { label: "Mechanical schedule present", pass: false, fix: "MEP not stamped — escalate to engineer of record." },
  { label: "Civil grading sheet C-402", pass: true },
  { label: "Lighting compliance worksheet", pass: true },
];

const InternalPrescreen = () => {
  const passed = checks.filter((c) => c.pass).length;
  const pct = Math.round((passed / checks.length) * 100);
  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="pilot-kicker text-primary">Internal Plan Prescreen</div>
          <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight">Pre-Submittal Readiness</h1>
          <p className="mt-1 text-sm text-muted-foreground">Catch jurisdictional rejections before submission.</p>
        </div>
        <button className="pilot-button-primary"><Sparkles className="h-4 w-4" /> Run Prescreen</button>
      </header>

      <section className="pilot-card flex flex-wrap items-center gap-6 p-5">
        <ReadinessGauge value={pct} />
        <div className="flex-1">
          <div className="pilot-kicker text-muted-foreground">Submittal Readiness</div>
          <div className="mt-1 font-display text-3xl font-semibold">{pct}%</div>
          <p className="mt-1 text-sm text-muted-foreground">
            {passed}/{checks.length} checks passed · 2 blockers must be resolved before upload.
          </p>
        </div>
        <button className="pilot-button-ghost"><Upload className="h-4 w-4" /> Replace Set</button>
      </section>

      <section className="pilot-card overflow-hidden">
        <header className="border-b border-border bg-muted/30 px-5 py-3">
          <h2 className="flex items-center gap-2 font-tight text-base font-bold">
            <ClipboardCheck className="h-4 w-4 text-primary" /> Checklist
          </h2>
        </header>
        <ul className="divide-y divide-border">
          {checks.map((c) => (
            <li key={c.label} className="flex items-start gap-3 px-5 py-3">
              {c.pass ? <CheckCircle2 className="mt-0.5 h-5 w-5 text-success" /> : <XCircle className="mt-0.5 h-5 w-5 text-destructive" />}
              <div className="flex-1">
                <p className={cn("text-sm", c.pass ? "text-foreground" : "font-medium text-destructive")}>{c.label}</p>
                {!c.pass && c.fix && <p className="mt-0.5 text-xs text-muted-foreground">{c.fix}</p>}
              </div>
              {!c.pass && <button className="pilot-button-ghost"><FileText className="h-4 w-4" /> Open</button>}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
};

const ReadinessGauge = ({ value }: { value: number }) => {
  const r = 36;
  const c = 2 * Math.PI * r;
  const offset = c - (value / 100) * c;
  return (
    <svg width="96" height="96" viewBox="0 0 96 96">
      <circle cx="48" cy="48" r={r} stroke="hsl(var(--border))" strokeWidth="8" fill="none" />
      <circle cx="48" cy="48" r={r} stroke="hsl(var(--primary))" strokeWidth="8" fill="none" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={offset} transform="rotate(-90 48 48)" />
      <text x="48" y="54" textAnchor="middle" className="fill-foreground font-data text-lg font-bold">{value}%</text>
    </svg>
  );
};

export default InternalPrescreen;