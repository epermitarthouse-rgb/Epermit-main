import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, ExternalLink, FileText, Search, Shield, ShieldAlert } from "lucide-react";
import {
  eastCoastCoverage,
  excludedCompanies,
  expandedScope,
  utilityProviders,
} from "@/data/utilityProviders";
import logoAsset from "@/assets/commun-et-logo.jpg.asset.json";

const Kpi = ({ label, value, delta }: { label: string; value: string; delta: string }) => (
  <div className="pilot-card p-5">
    <div className="pilot-kicker">{label}</div>
    <div className="mt-3 font-data text-2xl font-semibold text-foreground">{value}</div>
    <div className="mt-1 text-xs text-muted-foreground">{delta}</div>
  </div>
);

const UtilityCoverage = () => {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const contactRows = useMemo(
    () =>
      utilityProviders.filter(
        (p) =>
          !q ||
          p.name.toLowerCase().includes(q) ||
          (p.parent ?? "").toLowerCase().includes(q) ||
          p.region.toLowerCase().includes(q) ||
          p.territory.toLowerCase().includes(q),
      ),
    [q],
  );

  const holdingFamilies = new Set(utilityProviders.map((p) => p.parent ?? p.name)).size;
  const regions = new Set(utilityProviders.map((p) => p.region)).size;

  return (
    <div className="space-y-6 pb-16">
      <header className="pilot-card overflow-hidden">
        <div className="flex flex-col gap-6 border-b border-border p-6 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-4">
            <div className="rounded-md bg-white p-2 shadow-sm">
              <img src={logoAsset.url} alt="Commun-ET LLC" className="h-12 w-auto" />
            </div>
            <div>
              <div className="pilot-kicker text-primary">Internal Reference · Confidential</div>
              <h1 className="mt-1 font-tight text-3xl font-black tracking-tight text-foreground md:text-4xl">
                East Coast Utility Coverage Analysis
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Prepared by Ian Swain, Managing Partner &amp; Charlotte Ducksworth, Partner · July 2026
              </p>
            </div>
          </div>
          <label className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2">
            <Search className="h-4 w-4 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search utility, parent, region…"
              className="w-64 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </label>
        </div>
        <div className="flex items-start gap-3 border-b border-border bg-muted/40 p-5 text-xs leading-6 text-muted-foreground">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
          <p>
            <span className="font-semibold text-foreground">Sourcing caveat.</span> Regional classifications are
            Commun-ET's own determinations based on where each company operates. Source: Orennia,
            "The 20 Largest: Utilities in North America" (July 9, 2024). The ranking contains no service-territory
            data. Before any figure appears in a client-facing deliverable, verify against a primary source such
            as EIA Form 861. Scope expanded July 10, 2026 to also cover Ohio, West Virginia, Alabama, Mississippi,
            and eastern Canada — see the Expanded Scope section.
          </p>
        </div>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Top-20 East Coast utilities" value="8 / 20" delta="all named in CET materials" />
        <Kpi label="Operating utilities tracked" value={String(utilityProviders.length)} delta={`${holdingFamilies} holding families`} />
        <Kpi label="Regions covered" value={String(regions)} delta="DMV → Deep South" />
        <Kpi label="Builder portals wired" value="9" delta="new-service channels active" />
      </section>

      <section className="pilot-card p-6">
        <div className="flex items-start gap-3">
          <CheckCircle2 className="mt-1 h-5 w-5 text-success" />
          <div>
            <div className="pilot-kicker text-success">Finding</div>
            <h2 className="mt-1 font-tight text-xl font-bold text-foreground">
              8 of the 20 largest North American utilities operate on the East Coast in a distribution capacity relevant to Commun-ET's work.
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              All eight already appear by name in Commun-ET's active client materials, either directly or through
              their operating subsidiaries. No major East Coast distribution utility from the Orennia list is
              absent from Commun-ET's named relationships.
            </p>
          </div>
        </div>
      </section>

      <section className="pilot-card overflow-hidden">
        <div className="border-b border-border p-5">
          <div className="pilot-kicker text-primary">East Coast utilities on the list</div>
          <h3 className="mt-1 font-tight text-lg font-bold text-foreground">Coverage against the Orennia Top 20</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-5 py-3 font-semibold">Company (as listed)</th>
                <th className="px-5 py-3 font-semibold">East Coast operating presence</th>
                <th className="px-5 py-3 font-semibold">How it appears in CET materials</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {eastCoastCoverage.map((row) => (
                <tr key={row.company}>
                  <td className="px-5 py-3 font-tight font-semibold text-foreground">{row.company}</td>
                  <td className="px-5 py-3 text-muted-foreground">{row.presence}</td>
                  <td className="px-5 py-3 font-data text-xs text-foreground">{row.materials}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="pilot-card p-6">
        <div className="pilot-kicker text-primary">Parent company vs. operating utility</div>
        <h3 className="mt-1 font-tight text-lg font-bold text-foreground">Why we always name the operating utility</h3>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Commun-ET coordinates with the operating utility that grants service connections, sets meters, and
          issues Class of Service determinations — not with the holding company. PEPCO and BGE are Exelon
          subsidiaries; Florida Power &amp; Light is a NextEra subsidiary; Georgia Power is a Southern Company
          subsidiary. Client materials should continue to name the operating utility, not the parent.
        </p>
      </section>

      <section className="pilot-card overflow-hidden">
        <div className="border-b border-border p-5">
          <div className="pilot-kicker text-primary">Expanded Scope · July 10, 2026</div>
          <h3 className="mt-1 font-tight text-lg font-bold text-foreground">
            Ohio · West Virginia · Alabama · Mississippi · Eastern Canada
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-5 py-3 font-semibold">Region</th>
                <th className="px-5 py-3 font-semibold">List companies operating there</th>
                <th className="px-5 py-3 font-semibold">Operating utilities &amp; notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {expandedScope.map((row) => (
                <tr key={row.region}>
                  <td className="px-5 py-3 font-tight font-semibold text-foreground">{row.region}</td>
                  <td className="px-5 py-3 font-data text-xs text-muted-foreground">{row.companies}</td>
                  <td className="px-5 py-3 text-muted-foreground">{row.notes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex items-start gap-3 border-t border-border bg-muted/40 p-4 text-xs leading-6 text-muted-foreground">
          <FileText className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <p>
            <span className="font-semibold text-foreground">List gap note.</span> The Orennia list ranks by size,
            not by regional completeness. FirstEnergy — serving much of Ohio and West Virginia (Ohio Edison,
            Mon Power, Potomac Edison) — does not appear on the list, and neither do the dominant eastern
            Canadian utilities. This section describes which of the 20 listed companies operate in these
            regions, not the full utility landscape of each region.
          </p>
        </div>
      </section>

      <section className="pilot-card overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-border p-5 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="pilot-kicker text-primary">Contact directory</div>
            <h3 className="mt-1 font-tight text-lg font-bold text-foreground">
              East Coast + Expanded Scope operating utilities
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Corporate contact + working new-service / builder channel. Verified against public sources as of
              July 10, 2026. Phone numbers and portals change — verify before external use.
            </p>
          </div>
          <div className="font-data text-xs text-muted-foreground">
            {contactRows.length} / {utilityProviders.length} shown
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-5 py-3 font-semibold">Utility</th>
                <th className="px-5 py-3 font-semibold">Region</th>
                <th className="px-5 py-3 font-semibold">Corporate contact</th>
                <th className="px-5 py-3 font-semibold">New-service / builder channel</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {contactRows.map((row) => (
                <tr key={row.name}>
                  <td className="px-5 py-3">
                    <div className="font-tight font-semibold text-foreground">{row.name}</div>
                    {row.parent && (
                      <div className="mt-0.5 pilot-kicker">{row.parent}</div>
                    )}
                  </td>
                  <td className="px-5 py-3">
                    <span className="rounded-full border border-border bg-muted/40 px-2 py-0.5 font-data text-[11px] text-foreground">
                      {row.region}
                    </span>
                    <div className="mt-1 text-xs text-muted-foreground">{row.territory}</div>
                  </td>
                  <td className="px-5 py-3 font-data text-xs text-muted-foreground">{row.corporateContact}</td>
                  <td className="px-5 py-3 text-xs text-muted-foreground">{row.newServiceChannel}</td>
                </tr>
              ))}
              {contactRows.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-5 py-10 text-center text-sm text-muted-foreground">
                    No utilities match "{query}". Clear the search to see the full directory.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="pilot-card overflow-hidden">
        <div className="border-b border-border p-5">
          <div className="pilot-kicker text-muted-foreground">Excluded from the East Coast count</div>
          <h3 className="mt-1 font-tight text-lg font-bold text-foreground">Listed companies not counted &amp; why</h3>
        </div>
        <ul className="divide-y divide-border">
          {excludedCompanies.map((row) => (
            <li key={row.company} className="flex flex-col gap-1 px-5 py-3 md:flex-row md:items-start md:gap-6">
              <div className="min-w-[220px] font-tight font-semibold text-foreground">{row.company}</div>
              <div className="text-sm text-muted-foreground">{row.reason}</div>
            </li>
          ))}
        </ul>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <div className="pilot-card p-6">
          <div className="flex items-center gap-2 text-success">
            <Shield className="h-4 w-4" />
            <div className="pilot-kicker text-success">Defensible</div>
          </div>
          <p className="mt-3 text-sm leading-6 text-foreground">
            Commun-ET maintains named relationships with utilities that include 8 of the 20 largest in North
            America by the cited 2024 ranking, covering every major East Coast investor-owned distribution
            utility on that list.
          </p>
        </div>
        <div className="pilot-card p-6">
          <div className="flex items-center gap-2 text-destructive">
            <ShieldAlert className="h-4 w-4" />
            <div className="pilot-kicker text-destructive">Not defensible without further sourcing</div>
          </div>
          <p className="mt-3 text-sm leading-6 text-foreground">
            Any claim about market share, customer counts, percentage of East Coast load served, or that
            Commun-ET is the only firm with these relationships. The Orennia source supports none of these.
            For client-facing claims, cite EIA Form 861 or each utility's own service territory disclosure.
          </p>
        </div>
      </section>

      <section className="pilot-card p-6">
        <div className="pilot-kicker text-primary">Open items</div>
        <h3 className="mt-1 font-tight text-lg font-bold text-foreground">Follow-ups before external use</h3>
        <ul className="mt-4 space-y-3 text-sm leading-6 text-muted-foreground">
          <li className="flex items-start gap-2">
            <ExternalLink className="mt-1 h-4 w-4 shrink-0 text-primary" />
            Verify current service territories against EIA Form 861 before this analysis supports any proposal language.
          </li>
          <li className="flex items-start gap-2">
            <ExternalLink className="mt-1 h-4 w-4 shrink-0 text-primary" />
            Confirm whether the 80+ additional utility relationships cited in the East Coast proposal
            (cooperatives and municipal providers) have a documented source. That figure appears in client
            materials and should be traceable.
          </li>
          <li className="flex items-start gap-2">
            <ExternalLink className="mt-1 h-4 w-4 shrink-0 text-primary" />
            Revisit this document when Orennia or an equivalent source publishes an updated ranking.
          </li>
        </ul>
      </section>
    </div>
  );
};

export default UtilityCoverage;