import { Building2, Cable, Droplets, Flame, MapPin, Phone, Radio, Search, Zap } from "lucide-react";

type Provider = {
  name: string;
  utility: "Electric" | "Gas" | "Water" | "Telecom" | "Sanitary";
  territory: string;
  contact: string;
  sla: string;
  health: "Good" | "Strained" | "Critical";
};

const providers: Provider[] = [
  { name: "Pepco", utility: "Electric", territory: "Washington, DC · PG County, MD", contact: "(202) 833-7500", sla: "Service planning 8 wk", health: "Strained" },
  { name: "Dominion Energy", utility: "Electric", territory: "Northern VA · Fairfax · Loudoun", contact: "(866) 366-4357", sla: "Service planning 6 wk", health: "Good" },
  { name: "Washington Gas (WGL)", utility: "Gas", territory: "DC · MD · NoVA", contact: "(703) 750-1000", sla: "Tap design 4 wk", health: "Good" },
  { name: "DC Water", utility: "Water", territory: "Washington, DC", contact: "(202) 612-3400", sla: "Tap 12 wk", health: "Strained" },
  { name: "Fairfax Water", utility: "Water", territory: "Fairfax County, VA", contact: "(703) 698-5800", sla: "Tap 6 wk", health: "Good" },
  { name: "Verizon FiOS", utility: "Telecom", territory: "DC · MD · VA", contact: "(800) 837-4966", sla: "Make-ready 5 wk", health: "Good" },
  { name: "Lumen", utility: "Telecom", territory: "Regional backbone", contact: "(866) 352-0291", sla: "Splice window 7 wk", health: "Strained" },
  { name: "DC Water (Sewer)", utility: "Sanitary", territory: "Washington, DC", contact: "(202) 612-3400", sla: "Lateral approval 8 wk", health: "Critical" },
];

const iconFor = (u: Provider["utility"]) => ({ Electric: Zap, Gas: Flame, Water: Droplets, Telecom: Radio, Sanitary: Cable })[u];

const stats = [
  { label: "Providers tracked", value: "48", delta: "12 utility types" },
  { label: "Service requests open", value: "27", delta: "across portfolio" },
  { label: "Avg. response time", value: "9.4 d", delta: "↓ 1.8 d MoM" },
  { label: "Critical SLAs", value: "3", delta: "needs escalation" },
];

const UtilityProviderMap = () => (
  <div className="space-y-6 pb-12">
    <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div>
        <div className="pilot-kicker text-primary">Utility Intelligence</div>
        <h1 className="mt-2 font-tight text-3xl font-black tracking-tight text-foreground md:text-4xl">Utility Provider Territory Map</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          One canonical directory of every utility purveyor we coordinate with — their service
          territories, current SLAs, and the live escalation contacts.
        </p>
      </div>
      <label className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2">
        <Search className="h-4 w-4 text-muted-foreground" />
        <input placeholder="Search provider, jurisdiction, utility…" className="w-72 bg-transparent text-sm outline-none placeholder:text-muted-foreground" />
      </label>
    </header>

    <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {stats.map((s) => (
        <div key={s.label} className="pilot-card p-5">
          <div className="pilot-kicker">{s.label}</div>
          <div className="mt-3 font-data text-2xl font-semibold text-foreground">{s.value}</div>
          <div className="mt-1 text-xs text-muted-foreground">{s.delta}</div>
        </div>
      ))}
    </section>

    <section className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
      <div className="pilot-card overflow-hidden">
        <div className="border-b border-border p-5">
          <div className="pilot-kicker text-primary">Provider directory</div>
          <h2 className="mt-1 font-tight text-xl font-bold text-foreground">Active service territories</h2>
        </div>
        <ul className="divide-y divide-border">
          {providers.map((p) => {
            const Icon = iconFor(p.utility);
            return (
              <li key={p.name} className="flex items-start gap-4 p-5">
                <div className="flex h-11 w-11 flex-none items-center justify-center rounded-md bg-primary/10 text-primary"><Icon className="h-5 w-5" /></div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-tight text-base font-semibold text-foreground">{p.name}</span>
                    <span className="pilot-kicker">{p.utility}</span>
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground"><MapPin className="h-3.5 w-3.5" /> {p.territory}</div>
                  <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground"><Phone className="h-3.5 w-3.5" /> <span className="font-data">{p.contact}</span></div>
                </div>
                <div className="text-right">
                  <HealthBadge h={p.health} />
                  <div className="mt-2 font-data text-[11px] text-muted-foreground">{p.sla}</div>
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="pilot-card overflow-hidden">
        <div className="border-b border-border p-5">
          <div className="pilot-kicker text-primary">Territory overlay</div>
          <h3 className="mt-1 font-tight text-lg font-bold text-foreground">Regional coverage</h3>
        </div>
        <div className="relative aspect-[4/3] bg-gradient-to-br from-muted/40 via-background to-muted/20">
          <div className="absolute inset-0 grid grid-cols-6 grid-rows-5 opacity-20">
            {Array.from({ length: 30 }).map((_, i) => <div key={i} className="border-r border-b border-border" />)}
          </div>
          {[
            { top: "22%", left: "40%", label: "Pepco" },
            { top: "55%", left: "30%", label: "Dominion" },
            { top: "40%", left: "60%", label: "WGL" },
            { top: "30%", left: "55%", label: "DC Water" },
            { top: "68%", left: "48%", label: "Fairfax Water" },
          ].map((m) => (
            <div key={m.label} className="absolute -translate-x-1/2 -translate-y-1/2" style={{ top: m.top, left: m.left }}>
              <div className="flex flex-col items-center">
                <MapPin className="h-5 w-5 text-primary drop-shadow" />
                <span className="mt-0.5 rounded bg-background/90 px-1.5 py-0.5 font-data text-[10px] text-foreground">{m.label}</span>
              </div>
            </div>
          ))}
        </div>
        <div className="border-t border-border p-4 text-xs text-muted-foreground">
          <Building2 className="mr-1.5 inline h-3.5 w-3.5 text-primary" />
          Overlay sourced from public-utility commission filings, refreshed weekly.
        </div>
      </div>
    </section>
  </div>
);

const HealthBadge = ({ h }: { h: Provider["health"] }) => {
  const map = {
    Good: "border-primary/30 bg-primary/10 text-primary",
    Strained: "border-accent/40 bg-accent/15 text-accent-foreground",
    Critical: "border-destructive/40 bg-destructive/10 text-destructive",
  } as const;
  return <span className={`rounded-full border px-2.5 py-1 font-data text-[11px] font-medium ${map[h]}`}>{h}</span>;
};

export default UtilityProviderMap;