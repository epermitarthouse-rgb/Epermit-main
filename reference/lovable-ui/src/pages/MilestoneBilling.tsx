import { useMemo, useState } from "react";
import { Check, Circle, CircleDot, Download, Receipt, Zap } from "lucide-react";
import { PageHeader, Panel, StatusPill } from "@/components/permitpilot/ProductPrimitives";
import { cn } from "@/lib/utils";

type GateState = "done" | "active" | "pending";
type Tier = "standard" | "complex";

type Site = {
  id: string;
  name: string;
  region: "DMV" | "FL" | "NE" | "SE";
  tier: Tier;
  fee: number;
  gates: { app: GateState; cos: GateState; energ: GateState; closeout: GateState };
};

const sites: Site[] = [
  { id: "MCD-DMV-014", name: "McDonald's · Silver Spring MD",     region: "DMV", tier: "complex",  fee: 12500, gates: { app: "done", cos: "done",   energ: "active",  closeout: "pending" } },
  { id: "MCD-DMV-018", name: "McDonald's · Arlington VA",         region: "DMV", tier: "complex",  fee: 12500, gates: { app: "done", cos: "active", energ: "pending", closeout: "pending" } },
  { id: "MCD-DMV-021", name: "McDonald's · Washington DC · H St", region: "DMV", tier: "complex",  fee: 12500, gates: { app: "done", cos: "done",   energ: "done",    closeout: "active"  } },
  { id: "MCD-FL-032",  name: "McDonald's · Miami HVHZ",           region: "FL",  tier: "complex",  fee: 12500, gates: { app: "done", cos: "active", energ: "pending", closeout: "pending" } },
  { id: "MCD-FL-037",  name: "McDonald's · Key West",             region: "FL",  tier: "complex",  fee: 12500, gates: { app: "active", cos: "pending", energ: "pending", closeout: "pending" } },
  { id: "MCD-FL-041",  name: "McDonald's · Orlando Standard",     region: "FL",  tier: "standard", fee: 8500,  gates: { app: "done", cos: "done",   energ: "active",  closeout: "pending" } },
  { id: "MCD-FL-044",  name: "McDonald's · Tampa Drive-Thru",     region: "FL",  tier: "standard", fee: 8500,  gates: { app: "done", cos: "done",   energ: "done",    closeout: "done"    } },
  { id: "MCD-NE-051",  name: "McDonald's · Portland ME",          region: "NE",  tier: "standard", fee: 8500,  gates: { app: "done", cos: "active", energ: "pending", closeout: "pending" } },
  { id: "MCD-NE-055",  name: "McDonald's · Newark NJ",            region: "NE",  tier: "complex",  fee: 12500, gates: { app: "done", cos: "done",   energ: "pending", closeout: "pending" } },
  { id: "MCD-SE-061",  name: "McDonald's · Charlotte NC",         region: "SE",  tier: "standard", fee: 8500,  gates: { app: "done", cos: "done",   energ: "active",  closeout: "pending" } },
  { id: "MCD-SE-064",  name: "McDonald's · Atlanta GA",           region: "SE",  tier: "standard", fee: 8500,  gates: { app: "active", cos: "pending", energ: "pending", closeout: "pending" } },
  { id: "MCD-SE-067",  name: "McDonald's · Savannah GA",          region: "SE",  tier: "standard", fee: 8500,  gates: { app: "done", cos: "done",   energ: "done",    closeout: "active"  } },
];

// 30 / 30 / 30 / 10 split
const SPLIT = { app: 0.3, cos: 0.3, energ: 0.3, closeout: 0.1 };

const gateProgress = (s: Site) => {
  let p = 0;
  (Object.keys(SPLIT) as (keyof typeof SPLIT)[]).forEach((k) => {
    if (s.gates[k] === "done") p += SPLIT[k];
  });
  return Math.round(p * 100);
};

const nextInvoiceTrigger = (s: Site) => {
  const order: (keyof Site["gates"])[] = ["app", "cos", "energ", "closeout"];
  const idx = order.findIndex((k) => s.gates[k] === "active");
  if (idx === -1) return "—";
  return { app: "Application submitted", cos: "Class of Service receipt", energ: "Energization confirmed", closeout: "Closeout accepted" }[order[idx]];
};

const GateDot = ({ state }: { state: GateState }) => (
  state === "done" ? <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-success/20 text-success"><Check className="h-3.5 w-3.5" /></span>
  : state === "active" ? <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary/20 text-primary ring-2 ring-primary/40"><CircleDot className="h-3.5 w-3.5" /></span>
  : <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-muted text-muted-foreground"><Circle className="h-3.5 w-3.5" /></span>
);

const MilestoneBilling = () => {
  const [region, setRegion] = useState<"All" | Site["region"]>("All");

  const filtered = useMemo(() => region === "All" ? sites : sites.filter((s) => s.region === region), [region]);

  const totals = useMemo(() => {
    const invoiced = filtered.reduce((sum, s) => sum + Math.round(s.fee * (gateProgress(s) / 100)), 0);
    const contracted = filtered.reduce((sum, s) => sum + s.fee, 0);
    return { invoiced, contracted, remaining: contracted - invoiced };
  }, [filtered]);

  return (
    <div className="space-y-6 pb-12">
      <PageHeader
        eyebrow="McDonald's East Coast · MSA CET-2026-MCD-UC-001"
        title="Milestone billing — 30 / 30 / 30 / 10"
        body="Per-site progression through the four contracted gates: Application submitted → Class of Service receipt → Energization confirmed → Closeout. Invoices auto-trigger at each gate."
        action={<button className="pilot-button-primary"><Download className="h-4 w-4" /> Export QuickBooks batch</button>}
      />

      <section className="grid gap-3 sm:grid-cols-3">
        <div className="pilot-card p-5">
          <div className="pilot-kicker">Invoiced to date</div>
          <div className="mt-2 font-data text-3xl font-semibold text-primary">${totals.invoiced.toLocaleString()}</div>
          <div className="mt-1 text-xs text-muted-foreground">Across {filtered.length} pilot sites</div>
        </div>
        <div className="pilot-card p-5">
          <div className="pilot-kicker">Remaining contracted</div>
          <div className="mt-2 font-data text-3xl font-semibold text-foreground">${totals.remaining.toLocaleString()}</div>
          <div className="mt-1 text-xs text-muted-foreground">Releases with future gate completions</div>
        </div>
        <div className="pilot-card p-5">
          <div className="pilot-kicker">Contracted total</div>
          <div className="mt-2 font-data text-3xl font-semibold text-foreground">${totals.contracted.toLocaleString()}</div>
          <div className="mt-1 text-xs text-muted-foreground">$8.5K standard · $12.5K complex</div>
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-2">
        {(["All", "DMV", "FL", "NE", "SE"] as const).map((r) => (
          <button
            key={r}
            onClick={() => setRegion(r)}
            className={cn(
              "rounded-md border px-3 py-1.5 text-xs font-semibold uppercase tracking-wider transition-colors",
              region === r ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:text-foreground"
            )}
          >{r}</button>
        ))}
      </div>

      <Panel eyebrow="Per-site progression" title="Gate status and invoice triggers">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted/40 text-muted-foreground">
              <tr>
                <th className="pilot-kicker px-4 py-3 font-semibold">Site</th>
                <th className="pilot-kicker px-4 py-3 font-semibold">Tier</th>
                <th className="pilot-kicker px-4 py-3 text-center font-semibold">App<br/><span className="font-data text-[9px]">30%</span></th>
                <th className="pilot-kicker px-4 py-3 text-center font-semibold">CoS<br/><span className="font-data text-[9px]">30%</span></th>
                <th className="pilot-kicker px-4 py-3 text-center font-semibold">Energ.<br/><span className="font-data text-[9px]">30%</span></th>
                <th className="pilot-kicker px-4 py-3 text-center font-semibold">Closeout<br/><span className="font-data text-[9px]">10%</span></th>
                <th className="pilot-kicker px-4 py-3 font-semibold">Invoiced</th>
                <th className="pilot-kicker px-4 py-3 font-semibold">Next trigger</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => {
                const pct = gateProgress(s);
                const invoiced = Math.round(s.fee * (pct / 100));
                return (
                  <tr key={s.id} className="border-t border-border hover:bg-muted/20">
                    <td className="px-4 py-4">
                      <div className="font-tight font-semibold text-foreground">{s.name}</div>
                      <div className="font-data text-[10px] uppercase tracking-wider text-muted-foreground">{s.id} · {s.region}</div>
                    </td>
                    <td className="px-4 py-4">
                      <StatusPill tone={s.tier === "complex" ? "warn" : "default"}>
                        {s.tier === "complex" ? "Complex · $12.5K" : "Standard · $8.5K"}
                      </StatusPill>
                    </td>
                    <td className="px-4 py-4 text-center"><GateDot state={s.gates.app} /></td>
                    <td className="px-4 py-4 text-center"><GateDot state={s.gates.cos} /></td>
                    <td className="px-4 py-4 text-center"><GateDot state={s.gates.energ} /></td>
                    <td className="px-4 py-4 text-center"><GateDot state={s.gates.closeout} /></td>
                    <td className="px-4 py-4 font-data font-semibold text-foreground">
                      ${invoiced.toLocaleString()}
                      <div className="font-data text-[10px] text-muted-foreground">{pct}% of ${s.fee.toLocaleString()}</div>
                    </td>
                    <td className="px-4 py-4">
                      <span className="inline-flex items-center gap-1 text-xs text-primary">
                        <Zap className="h-3 w-3" /> {nextInvoiceTrigger(s)}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel eyebrow="Gate definitions" title="What triggers each invoice">
        <div className="grid gap-4 md:grid-cols-4">
          {[
            { pct: "30%", name: "Application submitted", body: "Utility application filed via PermitPilot UCI Builder against PEPCO / BGE / FPL / etc." },
            { pct: "30%", name: "Class of Service receipt", body: "Utility returns official Class of Service determining tariff, service size, and CIAC." },
            { pct: "30%", name: "Energization confirmed", body: "Meter set, utility live, service tested. Meter-Set Choreographer confirms." },
            { pct: "10%", name: "Closeout accepted", body: "As-builts filed, franchisee handoff, final invoice released." },
          ].map((g) => (
            <div key={g.name} className="rounded-lg border border-border bg-muted/20 p-4">
              <div className="flex items-center gap-2"><Receipt className="h-4 w-4 text-primary" /><span className="font-data text-xs font-bold text-primary">{g.pct}</span></div>
              <div className="mt-2 font-tight text-sm font-bold text-foreground">{g.name}</div>
              <p className="mt-1 text-xs text-muted-foreground">{g.body}</p>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
};

export default MilestoneBilling;