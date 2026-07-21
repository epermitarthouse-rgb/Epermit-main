import { useState } from "react";
import { Award, Building2, Calendar, CheckCircle2, Edit3, FileText, Plus, Search, Trash2, TrendingUp } from "lucide-react";

type Entry = {
  id: string;
  project: string;
  client: string;
  jurisdiction: string;
  scope: string;
  value: string;
  closed: string;
  status: "Published" | "Draft" | "Archived";
  outcome: string;
};

const seed: Entry[] = [
  { id: "PP-2024-014", project: "Valvoline Leesburg Express", client: "Valvoline LLC", jurisdiction: "Loudoun County, VA", scope: "Permit expediting · utility coordination", value: "$2.4M", closed: "May 2024", status: "Published", outcome: "Permit issued 38 days ahead of schedule" },
  { id: "PP-2024-009", project: "Riverside Park Utilities", client: "Urban Parks Group", jurisdiction: "Austin, TX", scope: "Water tap + electric service", value: "$1.1M", closed: "Apr 2024", status: "Published", outcome: "5 jurisdictional comments reconciled in one pass" },
  { id: "PP-2024-007", project: "Downtown Transit Hub", client: "MetroWorks", jurisdiction: "Seattle, WA", scope: "DesignCheck + special inspections", value: "$8.6M", closed: "Mar 2024", status: "Published", outcome: "Zero RFIs at final CO" },
  { id: "PP-2024-002", project: "South Bay Fiber Backbone", client: "Regional FiberCo", jurisdiction: "Santa Clara, CA", scope: "ROW + cross-utility coordination", value: "$3.9M", closed: "Feb 2024", status: "Draft", outcome: "Pending client narrative review" },
  { id: "PP-2023-118", project: "Capitol Hill Mixed-Use", client: "Beacon Capital", jurisdiction: "Washington, DC", scope: "Raze + new build permit stack", value: "$14.2M", closed: "Dec 2023", status: "Archived", outcome: "Featured in DCRA case study" },
];

const stats = [
  { label: "Published case studies", value: "27", delta: "+4 YTD", icon: Award },
  { label: "Avg. cycle compression", value: "67%", delta: "vs. baseline", icon: TrendingUp },
  { label: "Active jurisdictions", value: "31", delta: "12 states", icon: Building2 },
  { label: "Drafts awaiting review", value: "3", delta: "needs attention", icon: FileText },
];

const initialForm = { project: "", client: "", jurisdiction: "", scope: "", value: "", closed: "", outcome: "" };

const AdminPastPerformance = () => {
  const [entries, setEntries] = useState<Entry[]>(seed);
  const [form, setForm] = useState(initialForm);
  const [query, setQuery] = useState("");

  const filtered = entries.filter((e) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return [e.project, e.client, e.jurisdiction, e.scope].some((v) => v.toLowerCase().includes(q));
  });

  const onAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.project || !form.client) return;
    setEntries((prev) => [
      { id: `PP-${new Date().getFullYear()}-${String(prev.length + 100).padStart(3, "0")}`, status: "Draft", ...form } as Entry,
      ...prev,
    ]);
    setForm(initialForm);
  };

  return (
    <div className="space-y-6 pb-12">
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="pilot-kicker text-primary">Admin · Knowledge Base</div>
          <h1 className="mt-2 font-tight text-3xl font-black tracking-tight text-foreground md:text-4xl">Past Performance Management</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Curate the proof points sales, proposals, and agents pull from. Entries marked
            <span className="text-foreground"> Published</span> are eligible for client decks, jurisdiction pages, and RFP responses.
          </p>
        </div>
        <a href="#new" className="pilot-button-primary self-start"><Plus className="h-4 w-4" /> New Entry</a>
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

      <section id="new" className="pilot-card p-6 md:p-8">
        <div className="mb-5 flex items-center justify-between">
          <div>
            <div className="pilot-kicker text-primary">New project entry</div>
            <h2 className="mt-1 font-tight text-xl font-bold text-foreground">Add to past performance library</h2>
          </div>
          <CheckCircle2 className="h-5 w-5 text-primary" />
        </div>
        <form onSubmit={onAdd} className="grid gap-4 md:grid-cols-2">
          {([
            ["project", "Project name"],
            ["client", "Client / owner"],
            ["jurisdiction", "Jurisdiction"],
            ["scope", "Scope of work"],
            ["value", "Project value"],
            ["closed", "Completed"],
          ] as const).map(([key, label]) => (
            <label key={key} className="block">
              <span className="pilot-kicker mb-2 block">{label}</span>
              <input
                value={form[key]}
                onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                className="w-full rounded-md border border-border bg-background px-3 py-2.5 text-sm text-foreground outline-none focus:border-primary"
                placeholder={label}
              />
            </label>
          ))}
          <label className="block md:col-span-2">
            <span className="pilot-kicker mb-2 block">Outcome / headline</span>
            <textarea
              value={form.outcome}
              onChange={(e) => setForm({ ...form, outcome: e.target.value })}
              rows={3}
              className="w-full rounded-md border border-border bg-background px-3 py-2.5 text-sm text-foreground outline-none focus:border-primary"
              placeholder="e.g. Permit issued 38 days ahead of schedule"
            />
          </label>
          <div className="md:col-span-2 flex items-center justify-end gap-3 border-t border-border pt-4">
            <button type="button" onClick={() => setForm(initialForm)} className="pilot-button-ghost">Reset</button>
            <button type="submit" className="pilot-button-primary"><Plus className="h-4 w-4" /> Save as draft</button>
          </div>
        </form>
      </section>

      <section className="pilot-card overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-border p-5 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="pilot-kicker text-primary">Existing entries</div>
            <h2 className="mt-1 font-tight text-xl font-bold text-foreground">Library · {entries.length} records</h2>
          </div>
          <label className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2">
            <Search className="h-4 w-4 text-muted-foreground" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search project, client, jurisdiction…" className="w-full min-w-[220px] bg-transparent text-sm outline-none placeholder:text-muted-foreground" />
          </label>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted/40 text-muted-foreground">
              <tr>
                {["Project", "Client", "Jurisdiction", "Value", "Closed", "Status", "Actions"].map((h) => (
                  <th key={h} className="pilot-kicker px-5 py-3 font-semibold">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((e) => (
                <tr key={e.id} className="border-t border-border hover:bg-muted/20">
                  <td className="px-5 py-4">
                    <div className="font-tight font-semibold text-foreground">{e.project}</div>
                    <div className="mt-0.5 font-data text-[11px] text-muted-foreground">{e.id} · {e.scope}</div>
                    <div className="mt-1 text-xs text-muted-foreground">{e.outcome}</div>
                  </td>
                  <td className="px-5 py-4 text-foreground">{e.client}</td>
                  <td className="px-5 py-4 text-muted-foreground">{e.jurisdiction}</td>
                  <td className="px-5 py-4 font-data text-foreground">{e.value}</td>
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <Calendar className="h-3.5 w-3.5" /> {e.closed}
                    </div>
                  </td>
                  <td className="px-5 py-4">
                    <StatusBadge status={e.status} />
                  </td>
                  <td className="px-5 py-4">
                    <div className="flex items-center justify-end gap-2">
                      <button className="rounded-md border border-border p-1.5 text-muted-foreground hover:text-foreground" aria-label="Edit"><Edit3 className="h-3.5 w-3.5" /></button>
                      <button
                        onClick={() => setEntries((prev) => prev.filter((x) => x.id !== e.id))}
                        className="rounded-md border border-border p-1.5 text-muted-foreground hover:text-destructive"
                        aria-label="Remove"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};

const StatusBadge = ({ status }: { status: Entry["status"] }) => {
  const map = {
    Published: "bg-primary/15 text-primary border-primary/30",
    Draft: "bg-muted text-muted-foreground border-border",
    Archived: "bg-destructive/10 text-destructive border-destructive/30",
  } as const;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-data text-[11px] font-medium ${map[status]}`}>
      {status}
    </span>
  );
};

export default AdminPastPerformance;