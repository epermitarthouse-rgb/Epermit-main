import { BookOpen, Cable, FileText, MapPin, ScrollText } from "lucide-react";

const sections = [
  { Icon: ScrollText, title: "Code Citations", body: "IBC 2021, IECC C402, ICC A117.1 — applied to lot 0231 with assembly use group." },
  { Icon: Cable, title: "Utility Maps", body: "Gas (Washington Gas WAMS, 09/22), Power (PEPCO grid 04/24), Water (DC Water TX-1108)." },
  { Icon: MapPin, title: "Easements & ROW", body: "5' utility easement north property line; DDOT 8' sidewalk ROW frontage." },
  { Icon: BookOpen, title: "Historic Overlay", body: "Within HD-MTV; HPRB consultation required for facade modifications > 25%." },
  { Icon: FileText, title: "Reference Library", body: "All cited PDFs and shape files retained in Document Vault under SIR-Annex tag." },
];

const SirAnnex = () => (
  <div className="space-y-6">
    <header>
      <div className="pilot-kicker text-primary">SIR Technical Annex</div>
      <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight">Source-of-Truth References</h1>
      <p className="mt-1 text-sm text-muted-foreground">Every claim in the SIR is anchored back to one of these primary sources.</p>
    </header>
    <div className="space-y-3">
      {sections.map((s) => (
        <article key={s.title} className="pilot-card flex gap-4 p-5">
          <s.Icon className="h-6 w-6 text-primary" />
          <div className="flex-1">
            <h2 className="font-tight text-lg font-bold">{s.title}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{s.body}</p>
          </div>
        </article>
      ))}
    </div>
  </div>
);

export default SirAnnex;