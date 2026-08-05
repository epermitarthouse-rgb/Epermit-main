import { AlertTriangle, ArrowRight, CalendarClock, CheckCircle2, Package, Plus, Truck, Wrench, Building2 } from "lucide-react";
import { Link } from "react-router-dom";

type Item = {
  id: string;
  name: string;
  vendor: string;
  projectImpact: string;
  lead: string;
  ordered: string;
  ship: string;
  onsite: string;
  status: "On Order" | "In Fabrication" | "Shipping" | "Delivered" | "Slipped";
  buffer: string;
};

const items: Item[] = [
  { id: "MCD-LL-014", name: "PEPCO padmount transformer · 750 kVA", vendor: "Howard Industries", projectImpact: "Energization", lead: "32 wk", ordered: "Mar 04", ship: "Sep 12", onsite: "Sep 19", status: "In Fabrication", buffer: "+9 d float" },
  { id: "MCD-LL-013", name: "Switchgear lineup · 208 V · 800 A", vendor: "Eaton", projectImpact: "Rough electrical", lead: "22 wk", ordered: "Apr 11", ship: "Aug 22", onsite: "Aug 29", status: "Shipping", buffer: "+3 d float" },
  { id: "MCD-LL-012", name: "RTU-1 / RTU-2 rooftop units", vendor: "Trane", projectImpact: "MEP rough-in", lead: "18 wk", ordered: "Apr 28", ship: "Sep 04", onsite: "Sep 10", status: "On Order", buffer: "+12 d float" },
  { id: "MCD-LL-011", name: "Drive-thru canopy + digital menu boards", vendor: "Coates AV", projectImpact: "Site handover", lead: "14 wk", ordered: "May 30", ship: "Aug 30", onsite: "Sep 06", status: "Slipped", buffer: "-6 d float" },
  { id: "MCD-LL-010", name: "Kitchen line · fryers + grills (McD spec)", vendor: "Welbilt / Frymaster", projectImpact: "Commissioning", lead: "24 wk", ordered: "Feb 14", ship: "Aug 10", onsite: "Aug 17", status: "Delivered", buffer: "+22 d float" },
];

const stats = [
  { label: "Open POs", value: "9", delta: "$4.8M committed", icon: Package },
  { label: "Avg. lead time", value: "24 wk", delta: "across active POs", icon: CalendarClock },
  { label: "Slipped items", value: "1", delta: "envelope at risk", icon: AlertTriangle },
  { label: "Float buffer", value: "+11 d", delta: "rolled-up portfolio", icon: CheckCircle2 },
];

const LongLeadEquipment = () => (
  <div className="space-y-6 pb-12">
    <section className="flex flex-wrap items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3">
      <Building2 className="h-4 w-4 text-primary" />
      <div className="flex-1 min-w-[240px]">
        <div className="pilot-kicker text-primary">Active Site</div>
        <div className="font-tight text-sm font-bold text-foreground">McDonald's — 75 New York Ave NE · Washington DC</div>
      </div>
      <Link to="/utility/meter-set" className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground hover:text-primary">← Meter-Set</Link>
      <Link to="/scheduling/predictive-impact" className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-primary hover:underline">Next · Predictive Impact <ArrowRight className="h-3 w-3" /></Link>
    </section>

    <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div>
        <div className="pilot-kicker text-primary">Scheduling Intelligence</div>
        <h1 className="mt-2 font-tight text-3xl font-black tracking-tight text-foreground md:text-4xl">Long-Lead Equipment Tracker</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Every long-lead PO, fabrication milestone, and on-site delivery — pinned to the
          project's critical path. The agent recomputes float the moment a vendor slips.
        </p>
      </div>
      <button className="pilot-button-primary"><Plus className="h-4 w-4" /> Add tracked item</button>
    </header>

    <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {stats.map((s) => (
        <div key={s.label} className="pilot-card p-5">
          <div className="flex items-center justify-between">
            <div className="pilot-kicker">{s.label}</div>
            <s.icon className="h-4 w-4 text-primary" />
          </div>
          <div className="mt-3 font-data text-2xl font-semibold text-foreground">{s.value}</div>
          <div className="mt-1 text-xs text-muted-foreground">{s.delta}</div>
        </div>
      ))}
    </section>

    <section className="pilot-card overflow-hidden">
      <div className="border-b border-border p-5">
        <div className="pilot-kicker text-primary">Active POs</div>
        <h2 className="mt-1 font-tight text-xl font-bold text-foreground">Procurement ledger</h2>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-muted/40 text-muted-foreground">
            <tr>{["Item", "Vendor", "Project impact", "Lead", "Shipping", "On-site", "Status", "Buffer"].map((h) => <th key={h} className="pilot-kicker px-5 py-3 font-semibold">{h}</th>)}</tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <tr key={it.id} className="border-t border-border hover:bg-muted/20">
                <td className="px-5 py-4">
                  <div className="font-tight font-semibold text-foreground">{it.name}</div>
                  <div className="font-data text-[11px] text-muted-foreground">{it.id} · ordered {it.ordered}</div>
                </td>
                <td className="px-5 py-4 text-foreground">{it.vendor}</td>
                <td className="px-5 py-4 text-muted-foreground">{it.projectImpact}</td>
                <td className="px-5 py-4 font-data text-foreground">{it.lead}</td>
                <td className="px-5 py-4 font-data text-muted-foreground">{it.ship}</td>
                <td className="px-5 py-4 font-data text-foreground">{it.onsite}</td>
                <td className="px-5 py-4"><StatusPill s={it.status} /></td>
                <td className={`px-5 py-4 font-data ${it.buffer.startsWith("-") ? "text-destructive" : "text-primary"}`}>{it.buffer}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>

    <section className="grid gap-5 lg:grid-cols-2">
      <div className="pilot-card p-6">
        <div className="flex items-center gap-2 text-primary"><Truck className="h-5 w-5" /><span className="font-tight font-semibold">This week · expected deliveries</span></div>
        <ul className="mt-4 space-y-3 text-sm">
          {items.filter((i) => i.status === "Shipping" || i.status === "Delivered").map((i) => (
            <li key={i.id} className="flex items-center justify-between border-b border-border pb-2 last:border-0">
              <div>
                <div className="text-foreground">{i.name}</div>
                <div className="font-data text-[11px] text-muted-foreground">{i.vendor} · on-site {i.onsite}</div>
              </div>
              <StatusPill s={i.status} />
            </li>
          ))}
        </ul>
      </div>
      <div className="pilot-card p-6">
        <div className="flex items-center gap-2 text-destructive"><Wrench className="h-5 w-5" /><span className="font-tight font-semibold">Mitigations in progress</span></div>
        <ul className="mt-4 space-y-3 text-sm">
          <li className="border-b border-border pb-2"><b className="text-foreground">Drive-thru canopy slip (MCD-LL-011).</b> Coates fast-tracking menu-board panels from Dallas line to recover 4 days of float; canopy steel ships per original schedule.</li>
          <li className="border-b border-border pb-2"><b className="text-foreground">PEPCO transformer (MCD-LL-014).</b> Pre-positioning concrete pad pour to absorb a 1-week Howard slip without moving Aug 18 meter set.</li>
          <li><b className="text-foreground">Switchgear (MCD-LL-013).</b> Confirming Eaton's flatbed window with McDonald's site logistics; one-shift pickup buffer reserved.</li>
        </ul>
      </div>
    </section>
  </div>
);

const StatusPill = ({ s }: { s: Item["status"] }) => {
  const map = {
    "On Order": "border-border bg-muted text-muted-foreground",
    "In Fabrication": "border-primary/30 bg-primary/10 text-primary",
    Shipping: "border-accent/40 bg-accent/15 text-accent-foreground",
    Delivered: "border-primary/40 bg-primary/20 text-primary",
    Slipped: "border-destructive/40 bg-destructive/10 text-destructive",
  } as const;
  return <span className={`rounded-full border px-2.5 py-1 font-data text-[11px] font-medium ${map[s]}`}>{s}</span>;
};

export default LongLeadEquipment;