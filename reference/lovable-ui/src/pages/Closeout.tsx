import { Link } from "react-router-dom";
import { Archive, FileCheck2, LineChart, ListChecks, ShieldCheck, Wallet } from "lucide-react";

const tiles = [
  { to: "/closeout/archive", label: "Archive & Closeout", desc: "Bundle the project for cold storage.", Icon: Archive },
  { to: "/closeout/tracker", label: "Post-Closeout Compliance", desc: "Renewals, monitoring, anniversary checks.", Icon: ShieldCheck },
  { to: "/closeout/post-mortem", label: "Post-Mortem", desc: "Lessons, schedule variance, agent attribution.", Icon: ListChecks },
  { to: "/closeout/post-mortem?view=analytics", label: "Post-Mortem Analytics", desc: "Quantitative variance and benchmarks.", Icon: LineChart },
  { to: "/closeout/post-mortem?view=financial", label: "Financial Intelligence", desc: "Profitability, cost-to-permit ratios.", Icon: Wallet },
  { to: "/inspections/final-co", label: "Final Inspections / CO", desc: "Drive the CO finish line.", Icon: FileCheck2 },
];

const Closeout = () => (
  <div className="space-y-6">
    <header>
      <div className="pilot-kicker text-primary">Closeout</div>
      <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight">Project Wrap-Up</h1>
      <p className="mt-1 text-sm text-muted-foreground">Everything required to put a project to bed and learn from it.</p>
    </header>
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {tiles.map((t) => (
        <Link key={t.to} to={t.to} className="pilot-card group flex flex-col gap-3 p-5 transition-colors hover:border-primary/50">
          <t.Icon className="h-6 w-6 text-primary" />
          <h2 className="font-tight text-lg font-bold">{t.label}</h2>
          <p className="text-sm text-muted-foreground">{t.desc}</p>
        </Link>
      ))}
    </div>
  </div>
);

export default Closeout;