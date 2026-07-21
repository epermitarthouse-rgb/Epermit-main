import { CheckCircle2, Clock, FileSignature, MapPin, Plus, Shield, Upload } from "lucide-react";

type Easement = {
  id: string;
  parcel: string;
  owner: string;
  type: "Permanent" | "Temporary" | "ROW Dedication" | "Encroachment";
  area: string;
  jurisdiction: string;
  status: "Drafting" | "Owner Review" | "Counsel" | "Executed" | "Recorded";
  compensation: string;
  recorded?: string;
};

const easements: Easement[] = [
  { id: "ESM-014", parcel: "Lot 142 · Block 7", owner: "Chen Family Trust", type: "Permanent", area: "1,840 sf", jurisdiction: "Loudoun County", status: "Executed", compensation: "$24,500", recorded: "Jul 18" },
  { id: "ESM-013", parcel: "Lot 188", owner: "Riverside HOA", type: "ROW Dedication", area: "4,210 sf", jurisdiction: "Washington, DC", status: "Counsel", compensation: "—" },
  { id: "ESM-012", parcel: "Lot 091", owner: "Beacon Capital LLC", type: "Temporary", area: "920 sf", jurisdiction: "Arlington, VA", status: "Owner Review", compensation: "$4,800" },
  { id: "ESM-011", parcel: "Tract A-3", owner: "DC Water (Public)", type: "Encroachment", area: "215 sf", jurisdiction: "Washington, DC", status: "Recorded", compensation: "Fee waived", recorded: "Jun 04" },
  { id: "ESM-010", parcel: "Lot 062 · Phase II", owner: "JBG Smith", type: "Permanent", area: "3,310 sf", jurisdiction: "Fairfax County", status: "Drafting", compensation: "$48,000" },
];

const stats = [
  { label: "Open easements", value: "8", delta: "3 awaiting counsel", icon: FileSignature },
  { label: "Recorded YTD", value: "21", delta: "+6 vs LY", icon: Shield },
  { label: "Acreage secured", value: "14.2 ac", delta: "across 9 parcels", icon: MapPin },
  { label: "Avg. cycle time", value: "31 days", delta: "draft → recorded", icon: Clock },
];

const EasementRowManager = () => (
  <div className="space-y-6 pb-12">
    <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div>
        <div className="pilot-kicker text-primary">Utility Intelligence</div>
        <h1 className="mt-2 font-tight text-3xl font-black tracking-tight text-foreground md:text-4xl">Easement &amp; ROW Manager</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Track every right-of-way negotiation, encroachment agreement, and recorded easement
          across the portfolio — with counsel routing, parcel geometry, and recording chain of
          custody.
        </p>
      </div>
      <div className="flex items-center gap-2">
        <button className="pilot-button-ghost"><Upload className="h-4 w-4" /> Import plat</button>
        <button className="pilot-button-primary"><Plus className="h-4 w-4" /> New easement</button>
      </div>
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
        <div className="pilot-kicker text-primary">Active easements</div>
        <h2 className="mt-1 font-tight text-xl font-bold text-foreground">Portfolio register</h2>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-muted/40 text-muted-foreground">
            <tr>{["Parcel", "Owner", "Type", "Area", "Jurisdiction", "Compensation", "Status", "Recorded"].map((h) => <th key={h} className="pilot-kicker px-5 py-3 font-semibold">{h}</th>)}</tr>
          </thead>
          <tbody>
            {easements.map((e) => (
              <tr key={e.id} className="border-t border-border hover:bg-muted/20">
                <td className="px-5 py-4">
                  <div className="font-tight font-semibold text-foreground">{e.parcel}</div>
                  <div className="font-data text-[11px] text-muted-foreground">{e.id}</div>
                </td>
                <td className="px-5 py-4 text-foreground">{e.owner}</td>
                <td className="px-5 py-4 text-muted-foreground">{e.type}</td>
                <td className="px-5 py-4 font-data text-foreground">{e.area}</td>
                <td className="px-5 py-4 text-muted-foreground">{e.jurisdiction}</td>
                <td className="px-5 py-4 font-data text-foreground">{e.compensation}</td>
                <td className="px-5 py-4"><StatusPill s={e.status} /></td>
                <td className="px-5 py-4 font-data text-xs text-muted-foreground">{e.recorded ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>

    <section className="grid gap-5 lg:grid-cols-2">
      <div className="pilot-card p-6">
        <div className="pilot-kicker text-primary">Approval chain</div>
        <h3 className="mt-1 font-tight text-lg font-bold text-foreground">Where each easement is in the workflow</h3>
        <ol className="mt-4 space-y-3">
          {["Drafting", "Owner Review", "Counsel", "Executed", "Recorded"].map((step, i) => (
            <li key={step} className="flex items-center gap-3">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/15 font-data text-xs font-semibold text-primary">{i + 1}</span>
              <span className="font-tight text-sm font-medium text-foreground">{step}</span>
              <span className="ml-auto font-data text-xs text-muted-foreground">{[2, 1, 3, 1, 1][i]} in stage</span>
            </li>
          ))}
        </ol>
      </div>

      <div className="pilot-card p-6">
        <div className="flex items-center gap-2 text-primary"><CheckCircle2 className="h-5 w-5" /><span className="font-tight font-semibold">Recording assistant</span></div>
        <p className="mt-2 text-sm text-muted-foreground">
          Generate recordable instruments (Deed of Easement, ROW Dedication, Encroachment
          Agreement) pre-populated from parcel, project, and counsel templates.
        </p>
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {["Deed of Easement", "ROW Dedication", "Encroachment Agreement", "Vacation Petition"].map((t) => (
            <button key={t} className="rounded-md border border-border bg-background px-3 py-2 text-left text-sm text-foreground hover:border-primary">{t}</button>
          ))}
        </div>
      </div>
    </section>
  </div>
);

const StatusPill = ({ s }: { s: Easement["status"] }) => {
  const map = {
    Drafting: "border-border bg-muted text-muted-foreground",
    "Owner Review": "border-accent/40 bg-accent/15 text-accent-foreground",
    Counsel: "border-primary/30 bg-primary/10 text-primary",
    Executed: "border-primary/40 bg-primary/20 text-primary",
    Recorded: "border-primary/40 bg-primary/20 text-primary",
  } as const;
  return <span className={`rounded-full border px-2.5 py-1 font-data text-[11px] font-medium ${map[s]}`}>{s}</span>;
};

export default EasementRowManager;