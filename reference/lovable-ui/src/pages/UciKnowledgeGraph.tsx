import { useEffect, useMemo, useState } from "react";
import { Building2, Cable, Filter, GitBranch, Network, Search, Share2, Sparkles } from "lucide-react";
import { UciEmpty, UciEmptyRow, UciLoading } from "@/components/permitpilot/UciStates";

type Node = { id: string; label: string; kind: "Utility" | "Jurisdiction" | "Precedent" | "Project" | "Rule"; degree: number; note: string };
type Edge = { from: string; to: string; kind: string; strength: number };

const nodes: Node[] = [
  { id: "pepco", label: "PEPCO", kind: "Utility", degree: 41, note: "Primary DC-area electric" },
  { id: "wgl", label: "Washington Gas", kind: "Utility", degree: 27, note: "DC · MD · Northern VA gas" },
  { id: "dcra", label: "DOB (DC)", kind: "Jurisdiction", degree: 33, note: "Building/electrical AHJ" },
  { id: "arl", label: "Arlington County", kind: "Jurisdiction", degree: 19, note: "Site plan + BZA nexus" },
  { id: "mcd", label: "McDonald's — 75 NY Ave NE", kind: "Project", degree: 12, note: "Active demo project" },
  { id: "cos-vault", label: "Shared vault → CIAC ↑", kind: "Rule", degree: 8, note: "PEPCO shared-vault triggers CIAC premium" },
  { id: "prec-vault", label: "1400 K St vault reuse", kind: "Precedent", degree: 6, note: "PEPCO reused Class B vault · 2024" },
  { id: "prec-langston", label: "Langston Blvd multifamily", kind: "Precedent", degree: 9, note: "PEPCO 500 kVA secondary · 2024" },
  { id: "wgl-mp", label: "WGL medium pressure > 2 psi", kind: "Rule", degree: 5, note: "Requires DOB approval + regulator vault" },
];

const edges: Edge[] = [
  { from: "mcd", to: "pepco", kind: "Applies to", strength: 0.94 },
  { from: "mcd", to: "dcra", kind: "Permitted by", strength: 0.91 },
  { from: "mcd", to: "prec-vault", kind: "Analogous to", strength: 0.82 },
  { from: "pepco", to: "cos-vault", kind: "Enforces", strength: 0.88 },
  { from: "pepco", to: "prec-langston", kind: "Precedent from", strength: 0.71 },
  { from: "wgl", to: "wgl-mp", kind: "Enforces", strength: 0.83 },
  { from: "arl", to: "prec-langston", kind: "Approved", strength: 0.77 },
];

const kindTone: Record<Node["kind"], string> = {
  Utility: "bg-primary/15 text-primary",
  Jurisdiction: "bg-pilot-cyan/10 text-pilot-cyan",
  Precedent: "bg-success/10 text-success",
  Project: "bg-accent/15 text-accent",
  Rule: "bg-destructive/10 text-destructive",
};

const kindIcon: Record<Node["kind"], typeof Building2> = {
  Utility: Cable,
  Jurisdiction: Building2,
  Precedent: GitBranch,
  Project: Sparkles,
  Rule: Share2,
};

const kpis = [
  { label: "Graph nodes", value: "1,842", delta: "utilities · jurisdictions · rules", icon: Network },
  { label: "Edges", value: "6,214", delta: "auto-inferred from case history", icon: Share2 },
  { label: "Precedents indexed", value: "312", delta: "PEPCO · BGE · WGL · Dominion", icon: GitBranch },
  { label: "Query latency", value: "180ms", delta: "P95 across portfolio", icon: Search },
];

const UciKnowledgeGraph = () => {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<string>("all");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setLoading(false), 500);
    return () => clearTimeout(t);
  }, []);
  const kinds = useMemo(() => Array.from(new Set(nodes.map((n) => n.kind))), []);
  const filteredNodes = nodes.filter((n) => {
    const q = query.trim().toLowerCase();
    return (!q || [n.label, n.note, n.kind, n.id].some((v) => v.toLowerCase().includes(q))) && (kind === "all" || n.kind === kind);
  });
  const nodeIds = new Set(filteredNodes.map((n) => n.id));
  const filteredEdges = edges.filter((e) => nodeIds.has(e.from) || nodeIds.has(e.to));
  if (loading) {
    return (
      <UciLoading
        kicker="Differentiator 8.6 · Utility Knowledge Graph"
        title="Knowledge Graph"
        description="Loading utilities, jurisdictions, precedents, and rules linked across your portfolio…"
      />
    );
  }
  return (
  <div className="space-y-6 pb-12">
    <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div>
        <div className="pilot-kicker text-primary">Differentiator 8.6 · Utility Knowledge Graph</div>
        <h1 className="mt-2 font-tight text-3xl font-black tracking-tight text-foreground md:text-4xl">Knowledge Graph</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Every utility, jurisdiction, precedent, and rule the platform has ever touched — linked. Each new
          deal inherits every prior lesson automatically instead of relying on a project manager's memory.
        </p>
      </div>
      <div className="flex items-center gap-2">
        <button className="pilot-button-ghost"><Filter className="h-4 w-4" /> Facet</button>
        <button className="pilot-button-primary"><Search className="h-4 w-4" /> Ask the graph</button>
      </div>
    </header>

    <section className="pilot-card flex flex-wrap items-center gap-2 p-3">
      <div className="relative min-w-[240px] flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search node, note, rule, precedent…" className="w-full rounded-md border border-border bg-card py-2 pl-9 pr-3 text-xs text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none" />
      </div>
      <select value={kind} onChange={(e) => setKind(e.target.value)} className="rounded-md border border-border bg-card px-3 py-2 text-xs text-foreground focus:border-primary focus:outline-none">
        <option value="all">All kinds</option>
        {kinds.map((k) => <option key={k} value={k}>{k}</option>)}
      </select>
      {(query || kind !== "all") && (
        <button onClick={() => { setQuery(""); setKind("all"); }} className="pilot-kicker text-muted-foreground hover:text-primary">Clear</button>
      )}
      <span className="pilot-kicker text-muted-foreground">{filteredNodes.length}/{nodes.length} nodes · {filteredEdges.length}/{edges.length} edges</span>
    </section>

    <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {kpis.map((k) => (
        <div key={k.label} className="pilot-card p-5">
          <div className="flex items-center justify-between"><div className="pilot-kicker">{k.label}</div><k.icon className="h-4 w-4 text-primary" /></div>
          <div className="mt-3 font-data text-2xl font-semibold text-foreground">{k.value}</div>
          <div className="mt-1 text-xs text-muted-foreground">{k.delta}</div>
        </div>
      ))}
    </section>

    <section className="grid gap-5 lg:grid-cols-[1fr_1fr]">
      <div className="pilot-card p-5">
        <div className="pilot-kicker text-primary">Top-degree nodes</div>
        <ul className="mt-4 space-y-3">
          {filteredNodes.length === 0 && (
            <li>
              <UciEmpty
                icon={Network}
                title="No nodes match your filters"
                description="Try a different kind or clear the search."
                onClear={() => { setQuery(""); setKind("all"); }}
              />
            </li>
          )}
          {filteredNodes.map((n) => {
            const Icon = kindIcon[n.kind];
            return (
              <li key={n.id} className="flex items-start justify-between gap-3 rounded-md border border-border bg-card/50 p-3">
                <div className="flex items-start gap-3">
                  <Icon className="mt-0.5 h-4 w-4 text-primary" />
                  <div>
                    <div className="font-tight text-sm font-bold text-foreground">{n.label}</div>
                    <div className="text-[11px] text-muted-foreground">{n.note}</div>
                  </div>
                </div>
                <div className="text-right">
                  <span className={`inline-flex rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${kindTone[n.kind]}`}>{n.kind}</span>
                  <div className="mt-1 font-data text-[11px] text-muted-foreground">deg · {n.degree}</div>
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="pilot-card p-5">
        <div className="pilot-kicker text-primary">Edges around active project</div>
        <table className="mt-4 w-full text-xs">
          <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="pb-2 text-left">From</th>
              <th className="pb-2 text-left">Relation</th>
              <th className="pb-2 text-left">To</th>
              <th className="pb-2 text-right">Weight</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filteredEdges.length === 0 && (
              <UciEmptyRow
                colSpan={4}
                title="No linked edges"
                description="No edges connect to the currently visible nodes."
                onClear={() => { setQuery(""); setKind("all"); }}
              />
            )}
            {filteredEdges.map((e, i) => {
              const from = nodes.find((n) => n.id === e.from);
              const to = nodes.find((n) => n.id === e.to);
              return (
                <tr key={i}>
                  <td className="py-2 text-foreground">{from?.label ?? e.from}</td>
                  <td className="py-2 text-muted-foreground">{e.kind}</td>
                  <td className="py-2 text-foreground">{to?.label ?? e.to}</td>
                  <td className="py-2 text-right font-data text-primary">{(e.strength * 100).toFixed(0)}%</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>

    <section className="pilot-card p-5">
      <div className="pilot-kicker text-primary">Institutional memory · surfaced insights</div>
      <h2 className="mt-1 font-tight text-lg font-bold text-foreground">What the graph tells the next project</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Every closed-out project feeds three new signals back into the graph. These are the top insights
        currently influencing active deals — none are hard-coded, all are learned from case history.
      </p>
      <div className="mt-4 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {[
          { t: "PEPCO restaurant TI in Ward 6", i: "Class of Service letters arrive in 12 bd (not the 21 quoted)", n: "18 comparable projects" },
          { t: "BGE 750 kVA pad-mount",         i: "Lead times dropped from 28 → 18 weeks in Q2 2026",            n: "12 procurement events" },
          { t: "WGL meter set · Aspen Hill",    i: "Requires Mont. County DPS gas inspector, not state DLLR",     n: "7 field trips" },
          { t: "Dominion Ballston corridor",    i: "Shared-vault reuse averages 6 wks vs 14 wks new vault",       n: "9 projects since 2023" },
          { t: "NOVEC cooperatives",            i: "Voice contact within 24h of email doubles ack rate",          n: "14 outbound sequences" },
          { t: "DDOT cutover permits",          i: "TCP-88xxx windows > 8h delay by 3 wks on avg",                n: "22 cutovers" },
        ].map((x) => (
          <div key={x.t} className="rounded-md border border-border bg-card/50 p-3">
            <div className="pilot-kicker text-primary">{x.t}</div>
            <div className="mt-1 text-xs text-foreground">{x.i}</div>
            <div className="mt-2 font-data text-[10px] uppercase tracking-wider text-muted-foreground">Signal · {x.n}</div>
          </div>
        ))}
      </div>
    </section>
  </div>
  );
};

export default UciKnowledgeGraph;