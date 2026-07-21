import { ArrowRight, CheckCircle2, FileDown, RefreshCw, Sparkles } from "lucide-react";

const diffs = [
  { section: "Executive Summary", inSir: true, inEsir: true, status: "synced" },
  { section: "Site Context", inSir: true, inEsir: true, status: "synced" },
  { section: "Utility Maps", inSir: true, inEsir: false, status: "stale" },
  { section: "Capital Risk", inSir: false, inEsir: true, status: "esir-only" },
  { section: "Code Citations", inSir: true, inEsir: false, status: "stale" },
];

const statusMeta = {
  synced: { tone: "text-success", label: "Synced" },
  stale: { tone: "text-warning", label: "Stale in ESIR" },
  "esir-only": { tone: "text-primary", label: "ESIR-only" },
} as const;

const SirSync = () => (
  <div className="space-y-6">
    <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
      <div>
        <div className="pilot-kicker text-primary">SIR ↔ ESIR Sync</div>
        <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight">Report Generator</h1>
        <p className="mt-1 text-sm text-muted-foreground">Reconcile the technical SIR with the executive ESIR in one pass.</p>
      </div>
      <div className="flex gap-2">
        <button className="pilot-button-ghost"><RefreshCw className="h-4 w-4" /> Recompute Diff</button>
        <button className="pilot-button-primary"><Sparkles className="h-4 w-4" /> Generate Reports</button>
      </div>
    </header>

    <section className="pilot-card overflow-hidden">
      <table className="w-full text-left text-sm">
        <thead className="bg-muted/30 pilot-kicker">
          <tr>
            <th className="px-5 py-3 font-medium">Section</th>
            <th className="px-5 py-3 text-center font-medium">SIR</th>
            <th className="px-5 py-3 text-center font-medium">→</th>
            <th className="px-5 py-3 text-center font-medium">ESIR</th>
            <th className="px-5 py-3 font-medium">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {diffs.map((d) => {
            const meta = statusMeta[d.status as keyof typeof statusMeta];
            return (
              <tr key={d.section}>
                <td className="px-5 py-3 font-medium">{d.section}</td>
                <td className="px-5 py-3 text-center">{d.inSir ? <CheckCircle2 className="mx-auto h-4 w-4 text-success" /> : <span className="text-muted-foreground">—</span>}</td>
                <td className="px-5 py-3 text-center text-muted-foreground"><ArrowRight className="mx-auto h-4 w-4" /></td>
                <td className="px-5 py-3 text-center">{d.inEsir ? <CheckCircle2 className="mx-auto h-4 w-4 text-success" /> : <span className="text-muted-foreground">—</span>}</td>
                <td className={`px-5 py-3 font-medium ${meta.tone}`}>{meta.label}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>

    <div className="grid gap-4 md:grid-cols-2">
      <button className="pilot-card flex items-center justify-between p-5 text-left">
        <div>
          <h3 className="font-tight text-lg font-bold">Export SIR.pdf</h3>
          <p className="text-xs text-muted-foreground">Full technical document, ~42 pages.</p>
        </div>
        <FileDown className="h-5 w-5 text-primary" />
      </button>
      <button className="pilot-card flex items-center justify-between p-5 text-left">
        <div>
          <h3 className="font-tight text-lg font-bold">Export ESIR.pdf</h3>
          <p className="text-xs text-muted-foreground">Executive brief, 4 pages with go/no-go.</p>
        </div>
        <FileDown className="h-5 w-5 text-primary" />
      </button>
    </div>
  </div>
);

export default SirSync;