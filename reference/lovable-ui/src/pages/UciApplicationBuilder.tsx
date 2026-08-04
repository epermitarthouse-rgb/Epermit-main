import { useState } from "react";
import { ArrowRight, CheckCircle2, Circle, FileText, ListChecks, Save, Send, Sparkles, Upload } from "lucide-react";

const sections = [
  { id: "service", label: "Service requested" },
  { id: "load", label: "Load profile" },
  { id: "site", label: "Site & access" },
  { id: "owner", label: "Owner & billing" },
  { id: "drawings", label: "Drawings & exhibits" },
  { id: "review", label: "Review & submit" },
] as const;

type SectionId = typeof sections[number]["id"];

const UciApplicationBuilder = () => {
  const [active, setActive] = useState<SectionId>("service");
  const [completed, setCompleted] = useState<Set<SectionId>>(new Set(["service", "load"]));
  const [form, setForm] = useState({
    project: "Valvoline Leesburg Express",
    utility: "Pepco — Commercial Electric Service",
    voltage: "480 V · 3-phase · 4-wire",
    amperage: "1,600 A",
    serviceType: "New permanent service",
    targetDate: "Sep 19",
    contact: "Sarah Jenkins · sjenkins@commun-et.com",
  });

  const completion = Math.round((completed.size / sections.length) * 100);

  return (
    <div className="space-y-6 pb-12">
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="pilot-kicker text-primary">UCI · Utility Coordination Intelligence</div>
          <h1 className="mt-2 font-tight text-3xl font-black tracking-tight text-foreground md:text-4xl">Commercial Service Application</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Guided builder for purveyor service applications. Pre-fills from the active project,
            load profile analyzer, and document vault. Outputs a portal-ready package per
            purveyor.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button className="pilot-button-ghost"><Save className="h-4 w-4" /> Save draft</button>
          <button className="pilot-button-primary"><Send className="h-4 w-4" /> Submit to Pepco</button>
        </div>
      </header>

      <section className="pilot-card p-5">
        <div className="flex items-center justify-between">
          <div>
            <div className="pilot-kicker text-primary">Application progress</div>
            <div className="mt-1 font-tight text-base font-semibold text-foreground">{completed.size} of {sections.length} sections complete</div>
          </div>
          <div className="font-data text-2xl font-semibold text-primary">{completion}%</div>
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${completion}%` }} />
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-[260px_1fr]">
        <nav className="pilot-card p-3">
          <ul className="space-y-1">
            {sections.map((s, i) => {
              const done = completed.has(s.id);
              const isActive = active === s.id;
              return (
                <li key={s.id}>
                  <button
                    onClick={() => setActive(s.id)}
                    className={`flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm transition-colors ${
                      isActive ? "bg-primary/15 text-primary" : "text-foreground hover:bg-muted/40"
                    }`}
                  >
                    {done ? <CheckCircle2 className="h-4 w-4 text-primary" /> : <Circle className="h-4 w-4 text-muted-foreground" />}
                    <span className="font-data text-[11px] text-muted-foreground">{String(i + 1).padStart(2, "0")}</span>
                    <span className="font-tight font-medium">{s.label}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        <section className="pilot-card p-6 md:p-8">
          {active === "service" && (
            <div>
              <div className="pilot-kicker text-primary">Step 01 · Service requested</div>
              <h2 className="mt-1 font-tight text-xl font-bold text-foreground">What you're applying for</h2>
              <div className="mt-5 grid gap-4 md:grid-cols-2">
                {[
                  ["project", "Project"],
                  ["utility", "Purveyor + service"],
                  ["voltage", "Voltage / phase"],
                  ["amperage", "Service size"],
                  ["serviceType", "Service type"],
                  ["targetDate", "Target energization"],
                ].map(([key, label]) => (
                  <label key={key} className="block">
                    <span className="pilot-kicker mb-2 block">{label}</span>
                    <input
                      value={form[key as keyof typeof form]}
                      onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                      className="w-full rounded-md border border-border bg-background px-3 py-2.5 text-sm text-foreground outline-none focus:border-primary"
                    />
                  </label>
                ))}
              </div>
            </div>
          )}

          {active === "load" && (
            <div>
              <div className="pilot-kicker text-primary">Step 02 · Load profile</div>
              <h2 className="mt-1 font-tight text-xl font-bold text-foreground">Pulled from Load Profile Analyzer</h2>
              <div className="mt-5 grid gap-4 md:grid-cols-2">
                {[
                  ["Peak demand", "1.42 MW"],
                  ["Load factor", "0.62"],
                  ["Coincident peak", "1.18 MW"],
                  ["Service entrance", "1,600 A / 480 V"],
                  ["Service class", "GS-T tariff"],
                  ["Standby generator", "750 kW (Cummins, on-site)"],
                ].map(([k, v]) => (
                  <div key={k} className="rounded-md border border-border bg-background px-3 py-3">
                    <div className="pilot-kicker">{k}</div>
                    <div className="mt-1 font-data text-sm font-semibold text-foreground">{v}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {active === "site" && (
            <div>
              <div className="pilot-kicker text-primary">Step 03 · Site &amp; access</div>
              <h2 className="mt-1 font-tight text-xl font-bold text-foreground">Where the service lands</h2>
              <p className="mt-3 text-sm text-muted-foreground">Confirm parcel, primary connection point, and field access constraints.</p>
              <div className="mt-5 grid gap-4 md:grid-cols-2">
                {["Parcel ID", "Service entrance address", "Primary connection point", "Crane access", "Working clearance", "Restricted hours"].map((label) => (
                  <label key={label} className="block">
                    <span className="pilot-kicker mb-2 block">{label}</span>
                    <input className="w-full rounded-md border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-primary" placeholder={label} />
                  </label>
                ))}
              </div>
            </div>
          )}

          {active === "owner" && (
            <div>
              <div className="pilot-kicker text-primary">Step 04 · Owner &amp; billing</div>
              <h2 className="mt-1 font-tight text-xl font-bold text-foreground">Account-holder and billing routing</h2>
              <div className="mt-5 grid gap-4 md:grid-cols-2">
                {["Account-holder name", "Federal Tax ID", "Billing address", "Billing email", "Authorized signatory", "Phone"].map((label) => (
                  <label key={label} className="block">
                    <span className="pilot-kicker mb-2 block">{label}</span>
                    <input className="w-full rounded-md border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-primary" placeholder={label} />
                  </label>
                ))}
              </div>
            </div>
          )}

          {active === "drawings" && (
            <div>
              <div className="pilot-kicker text-primary">Step 05 · Drawings &amp; exhibits</div>
              <h2 className="mt-1 font-tight text-xl font-bold text-foreground">Attach the purveyor's required exhibits</h2>
              <ul className="mt-5 space-y-2">
                {["Electrical riser diagram", "Site plan w/ service entrance", "Load letter (sealed)", "Switchgear nameplate", "Standby gen one-line"].map((d) => (
                  <li key={d} className="flex items-center justify-between rounded-md border border-border bg-background px-4 py-3">
                    <div className="flex items-center gap-3">
                      <FileText className="h-4 w-4 text-primary" />
                      <span className="font-tight text-sm font-medium text-foreground">{d}</span>
                    </div>
                    <button className="pilot-button-ghost"><Upload className="h-3.5 w-3.5" /> Attach</button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {active === "review" && (
            <div>
              <div className="pilot-kicker text-primary">Step 06 · Review &amp; submit</div>
              <h2 className="mt-1 font-tight text-xl font-bold text-foreground">Pre-flight check</h2>
              <ul className="mt-5 space-y-3 text-sm">
                {[
                  "All required fields present",
                  "Load profile within tariff bounds",
                  "Exhibits sealed by engineer of record",
                  "Account-holder verified against W-9",
                ].map((c) => (
                  <li key={c} className="flex items-center gap-2 text-foreground">
                    <CheckCircle2 className="h-4 w-4 text-primary" /> {c}
                  </li>
                ))}
              </ul>
              <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-md border border-primary/30 bg-primary/5 p-4">
                <div className="flex items-center gap-2 text-primary"><Sparkles className="h-4 w-4" /> <span className="font-tight font-semibold">Agent QA passed.</span></div>
                <button className="pilot-button-primary"><Send className="h-4 w-4" /> Submit to Pepco portal <ArrowRight className="h-4 w-4" /></button>
              </div>
            </div>
          )}

          <div className="mt-8 flex items-center justify-between border-t border-border pt-5">
            <button
              onClick={() => {
                const idx = sections.findIndex((s) => s.id === active);
                if (idx > 0) setActive(sections[idx - 1].id);
              }}
              className="pilot-button-ghost"
            >
              ← Back
            </button>
            <button
              onClick={() => {
                setCompleted((c) => new Set(c).add(active));
                const idx = sections.findIndex((s) => s.id === active);
                if (idx < sections.length - 1) setActive(sections[idx + 1].id);
              }}
              className="pilot-button-primary"
            >
              <ListChecks className="h-4 w-4" /> Mark complete &amp; continue
            </button>
          </div>
        </section>
      </div>
    </div>
  );
};

export default UciApplicationBuilder;