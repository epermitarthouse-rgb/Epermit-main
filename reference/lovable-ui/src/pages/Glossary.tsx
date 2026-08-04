import { useMemo, useState } from "react";
import { BookOpen, Building2, Search, Settings2 } from "lucide-react";
import logoAsset from "@/assets/commun-et-logo.jpg.asset.json";

type Term = { term: string; definition: string };
type Section = { id: string; label: string; icon: typeof BookOpen; terms: Term[] };

const sections: Section[] = [
  {
    id: "platform",
    label: "Platform & Process",
    icon: Settings2,
    terms: [
      { term: "PermitPilot", definition: "Commun-ET's proprietary AI-native operating platform for permitting and utility coordination, engineered in house. Clients receive its outputs and dashboards; Commun-ET operates the platform on their behalf." },
      { term: "UCI (Utility Coordination Intelligence)", definition: "The PermitPilot module dedicated to utility work: predictive energization dates, queue monitoring, cross-utility conflict detection, meter set choreography, and portfolio KPI reporting." },
      { term: "DesignCheck Intake Pipeline", definition: "The PermitPilot intake module that validates plans, site data, and load profiles against jurisdiction and utility requirements before submission, so applications go in complete the first time." },
      { term: "Portfolio Dashboard", definition: "The PermitPilot view showing every active site in one place: status, risk flags, upcoming milestones, and KPI reporting aligned to the client's regional operating structure." },
      { term: "Isolated tenant", definition: "A dedicated, access-controlled instance of PermitPilot configured for a single client, with its own branding, data separation, audit logging, and backup procedures." },
      { term: "P50 date", definition: "A forecast date with 50 percent confidence: the statistical midpoint, where half of comparable outcomes land earlier and half later. Used as the internal planning target." },
      { term: "P90 date", definition: "A forecast date with 90 percent confidence: a conservative date the project is expected to beat nine times out of ten. Used for external commitments such as grand opening planning." },
      { term: "Queue management", definition: "Actively tracking a project's position in a utility's internal work queue and intervening when an application stalls, rather than waiting for the utility to miss a date." },
      { term: "Cross-utility conflict detection", definition: "Checking electric, gas, water, and telecom dependencies against each other before construction begins, so one provider's work does not block another's." },
      { term: "Meter set choreography", definition: "Sequencing the day-of-meter-set activities (inspection release, utility crew scheduling, GC readiness) so the crew dispatch succeeds on the first attempt." },
      { term: "Failed meter set", definition: "A utility crew dispatched to set a meter that cannot complete the work, typically because an inspection, clearance, or site condition was not ready. Each failure usually costs a week or more." },
      { term: "Energization", definition: "The milestone at which the utility delivers permanent power (or gas) to the site: the point a restaurant can move from construction power to operations." },
    ],
  },
  {
    id: "utility",
    label: "Utility & Regulatory",
    icon: Building2,
    terms: [
      { term: "CIAC (Contribution In Aid of Construction)", definition: "The payment a utility requires from a customer toward the cost of infrastructure built to serve the site, such as transformers, line extensions, or service upgrades." },
      { term: "Class of Service", definition: "The utility's formal determination of the service type and rate classification for a site; its receipt is a key milestone confirming the utility has engaged the project." },
      { term: "Load profile", definition: "The site's expected electrical or gas demand characteristics, which drive the utility's equipment sizing, design, and CIAC estimate." },
      { term: "IOU (Investor-Owned Utility)", definition: "A shareholder-owned utility such as PEPCO, BGE, Dominion, FPL, or Con Edison, regulated by state public utility commissions." },
      { term: "Cooperative / municipal utility", definition: "Member-owned (cooperative) or city-owned (municipal) power providers, common outside major metros, each with its own processes and timelines." },
      { term: "HVHZ (High-Velocity Hurricane Zone)", definition: "The Florida Building Code designation for Miami-Dade and Broward counties, imposing the strictest wind-resistance requirements in the country." },
      { term: "DDOT / Public Space Committee", definition: "District of Columbia bodies governing work in public space; an approval overlay unique to DC that affects utility connections and site work." },
      { term: "ROW (Right of Way)", definition: "Publicly controlled land, typically streets and adjacent strips, where utility connections and site access work require separate permits." },
    ],
  },
  {
    id: "engagement",
    label: "Engagement & Commercial",
    icon: BookOpen,
    terms: [
      { term: "MSA (Master Services Agreement)", definition: "The umbrella contract establishing legal and commercial terms between the client and Commun-ET, under which individual work is authorized." },
      { term: "SOW (Statement of Work)", definition: "A document executed under an MSA that defines a specific engagement's scope, deliverables, fees, and schedule, such as the utility coordination pilot." },
      { term: "Reimbursable / passthrough", definition: "Third-party costs (CIAC, application fees, recording fees) billed to the client at cost with receipts and no markup, separate from Commun-ET's fees." },
      { term: "KPI (Key Performance Indicator)", definition: "A measurable target Commun-ET commits to during a pilot or engagement, reported at defined review points." },
      { term: "UAT (User Acceptance Testing)", definition: "The client walkthrough session before launch in which the client's team verifies the configured platform works as expected for their use." },
      { term: "Business days (b-days)", definition: "Weekdays excluding holidays, the unit used in responsiveness KPIs such as days to first utility acknowledgment." },
      { term: "AUV (Average Unit Volume)", definition: "A restaurant's average annual sales; the revenue measure against which the cost of opening delays is quantified." },
      { term: "ACM (Area Construction Manager)", definition: "The McDonald's field role responsible for delivering construction projects across a territory." },
      { term: "AE firm", definition: "The architecture and engineering firm producing the design documents for a site." },
      { term: "GC (General Contractor)", definition: "The construction firm responsible for building the project and coordinating trade subcontractors on site." },
    ],
  },
];

const Glossary = () => {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();

  const filtered = useMemo(
    () =>
      sections.map((section) => ({
        ...section,
        terms: section.terms.filter(
          (t) =>
            !q ||
            t.term.toLowerCase().includes(q) ||
            t.definition.toLowerCase().includes(q),
        ),
      })),
    [q],
  );

  const totalMatches = filtered.reduce((sum, s) => sum + s.terms.length, 0);
  const totalTerms = sections.reduce((sum, s) => sum + s.terms.length, 0);

  return (
    <div className="space-y-6 pb-16">
      <header className="pilot-card overflow-hidden">
        <div className="flex flex-col gap-6 border-b border-border p-6 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-4">
            <div className="rounded-md bg-white p-2 shadow-sm">
              <img src={logoAsset.url} alt="Commun-ET LLC" className="h-12 w-auto" />
            </div>
            <div>
              <div className="pilot-kicker text-primary">Confidential Reference</div>
              <h1 className="mt-1 font-tight text-3xl font-black tracking-tight text-foreground md:text-4xl">
                Glossary of Terms
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Plain-language reference for PermitPilot, utility coordination, and engagement terminology · July 2026
              </p>
            </div>
          </div>
          <label className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2">
            <Search className="h-4 w-4 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search terms or definitions…"
              className="w-64 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-b border-border bg-muted/40 px-6 py-3 text-xs text-muted-foreground">
          <span className="font-data">{totalMatches} / {totalTerms} terms</span>
          <span>·</span>
          {sections.map((s) => (
            <a
              key={s.id}
              href={`#${s.id}`}
              className="rounded-full border border-border bg-background px-2.5 py-1 font-tight text-[11px] font-semibold text-foreground transition-colors hover:border-primary hover:text-primary"
            >
              {s.label}
            </a>
          ))}
        </div>
      </header>

      {filtered.map((section) => {
        if (section.terms.length === 0) return null;
        const Icon = section.icon;
        return (
          <section key={section.id} id={section.id} className="pilot-card overflow-hidden scroll-mt-20">
            <div className="flex items-center gap-3 border-b border-border p-5">
              <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10 text-primary">
                <Icon className="h-4 w-4" />
              </div>
              <div>
                <div className="pilot-kicker text-primary">Section</div>
                <h2 className="mt-0.5 font-tight text-lg font-bold text-foreground">{section.label}</h2>
              </div>
              <span className="ml-auto font-data text-xs text-muted-foreground">{section.terms.length} terms</span>
            </div>
            <dl className="divide-y divide-border">
              {section.terms.map((t) => (
                <div key={t.term} className="grid gap-2 px-6 py-4 md:grid-cols-[minmax(220px,0.35fr)_1fr] md:gap-8">
                  <dt className="font-tight text-sm font-semibold text-foreground">{t.term}</dt>
                  <dd className="text-sm leading-6 text-muted-foreground">{t.definition}</dd>
                </div>
              ))}
            </dl>
          </section>
        );
      })}

      {totalMatches === 0 && (
        <div className="pilot-card p-10 text-center text-sm text-muted-foreground">
          No terms match "{query}". Clear the search to see the full glossary.
        </div>
      )}
    </div>
  );
};

export default Glossary;