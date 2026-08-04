import { useSearchParams } from "react-router-dom";
import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Filter, MessageSquare, Sparkles, AlertTriangle, CheckCircle2, Circle, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { CsvExportDialog, type CsvColumn } from "@/components/CsvExportDialog";
import { Download } from "lucide-react";

type Status = "open" | "in_progress" | "blocked" | "done";
type Row = {
  id: string;
  group: string;
  task: string;
  owner: string;
  agency: string;
  due: string;
  status: Status;
  cp?: boolean;
  detail?: string;
};

const rows: Row[] = [
  { id: "T-101", group: "Building Permit Review #2", task: "Health Plan Review #2", owner: "Commun-ET", agency: "DOH", due: "Oct 10", status: "in_progress", cp: true },
  { id: "T-102", group: "Building Permit Review #2", task: "Fire Review #2", owner: "Commun-ET", agency: "FEMS", due: "Oct 14", status: "open" },
  { id: "T-103", group: "Building Permit Review #2", task: "Building Permit Issuance", owner: "DOB", agency: "DOB", due: "Oct 22", status: "blocked", cp: true, detail: "Awaiting Health Pre-Screen" },
  { id: "T-201", group: "Gas Utility Coordination", task: "Service Application", owner: "Washington Gas", agency: "Utility", due: "Sep 18", status: "done" },
  { id: "T-202", group: "Gas Utility Coordination", task: "Site Plan w/ Gas Lines", owner: "Civil Eng.", agency: "—", due: "Sep 30", status: "in_progress" },
  { id: "T-203", group: "Gas Utility Coordination", task: "Gas Service Installation", owner: "Washington Gas", agency: "Utility", due: "Nov 03", status: "open", cp: true },
  { id: "T-301", group: "Health Submittal", task: "Plumbing Fixture Schedule", owner: "MEP Eng.", agency: "—", due: "Oct 02", status: "blocked", detail: "Landlord auth pending" },
  { id: "T-302", group: "Health Submittal", task: "Hood/Vent Layout", owner: "MEP Eng.", agency: "—", due: "Oct 04", status: "in_progress" },
];

const statusMeta: Record<Status, { label: string; tone: string; Icon: typeof Circle }> = {
  open: { label: "Open", tone: "text-muted-foreground", Icon: Circle },
  in_progress: { label: "In Progress", tone: "text-primary", Icon: Clock },
  blocked: { label: "Blocked", tone: "text-destructive", Icon: AlertTriangle },
  done: { label: "Done", tone: "text-success", Icon: CheckCircle2 },
};

const csvColumns: CsvColumn<Row>[] = [
  { key: "id", label: "ID", value: (r) => r.id },
  { key: "group", label: "Group", value: (r) => r.group },
  { key: "task", label: "Task", value: (r) => r.task },
  { key: "owner", label: "Owner", value: (r) => r.owner },
  { key: "agency", label: "Agency", value: (r) => r.agency },
  { key: "due", label: "Due", value: (r) => r.due },
  { key: "status", label: "Status", value: (r) => statusMeta[r.status].label },
  { key: "cp", label: "Critical Path", value: (r) => (r.cp ? "Yes" : "No") },
];

const UnifiedMatrix = () => {
  const [params, setParams] = useSearchParams();
  const expanded = params.get("view") === "expanded";
  const [exportOpen, setExportOpen] = useState(false);

  const grouped = useMemo(() => {
    const map = new Map<string, Row[]>();
    rows.forEach((r) => {
      const arr = map.get(r.group) ?? [];
      arr.push(r);
      map.set(r.group, arr);
    });
    return Array.from(map.entries());
  }, []);

  const setView = (v: "compact" | "expanded") => {
    const next = new URLSearchParams(params);
    if (v === "expanded") next.set("view", "expanded");
    else next.delete("view");
    setParams(next, { replace: true });
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="pilot-kicker text-primary">Unified Task Matrix</div>
          <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight">{expanded ? "Expanded View" : "Compact View"}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{rows.length} tasks across {grouped.length} groups.</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-md border border-border bg-card p-0.5 text-xs">
            {(["compact", "expanded"] as const).map((v) => {
              const active = (v === "expanded") === expanded;
              return (
                <button key={v} onClick={() => setView(v)} className={cn("rounded px-3 py-1.5 capitalize transition-colors", active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>
                  {v}
                </button>
              );
            })}
          </div>
          <button className="pilot-button-ghost"><Filter className="h-4 w-4" /> Filter</button>
          <button className="pilot-button-ghost" onClick={() => setExportOpen(true)}><Download className="h-4 w-4" /> Export CSV</button>
          <button className="pilot-button-primary"><Sparkles className="h-4 w-4" /> Deploy Agent</button>
        </div>
      </header>

      <section className="pilot-card overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="bg-muted/30 pilot-kicker">
            <tr>
              <th className="px-5 py-3 font-medium">Task</th>
              <th className="px-5 py-3 font-medium">Owner</th>
              <th className="px-5 py-3 font-medium">Agency</th>
              <th className="px-5 py-3 font-medium">Due</th>
              <th className="px-5 py-3 font-medium">Status</th>
              <th className="px-5 py-3 font-medium">CP</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {grouped.map(([group, items]) => (
              <GroupBlock key={group} group={group} items={items} expanded={expanded} />
            ))}
          </tbody>
        </table>
      </section>
      <CsvExportDialog
        open={exportOpen}
        onOpenChange={setExportOpen}
        title="Export Unified Matrix"
        filename="unified-matrix"
        columns={csvColumns}
        rows={rows}
        storageKey="unified-matrix"
      />
    </div>
  );
};

const GroupBlock = ({ group, items, expanded }: { group: string; items: Row[]; expanded: boolean }) => {
  const [open, setOpen] = useState(true);
  return (
    <>
      <tr className="bg-muted/20 hover:bg-muted/30">
        <td colSpan={6} className="px-3 py-2">
          <button className="flex w-full items-center gap-2" onClick={() => setOpen(!open)}>
            {open ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
            <span className="font-tight text-sm font-bold">{group}</span>
            <span className="ml-auto rounded bg-card px-2 py-0.5 font-data text-[10px] text-muted-foreground">{items.length}</span>
          </button>
        </td>
      </tr>
      {open &&
        items.map((r) => {
          const meta = statusMeta[r.status];
          return (
            <tr key={r.id} className={cn("group transition-colors hover:bg-muted/40", r.status === "blocked" && "bg-destructive/5")}>
              <td className="px-5 py-3">
                <div className="flex items-center gap-2">
                  <MessageSquare className="h-3.5 w-3.5 text-muted-foreground" />
                  <div>
                    <div className="font-medium text-foreground">{r.task}</div>
                    {expanded && r.detail && <div className="mt-0.5 text-xs text-muted-foreground">{r.detail}</div>}
                  </div>
                </div>
              </td>
              <td className="px-5 py-3 text-foreground">{r.owner}</td>
              <td className="px-5 py-3 text-muted-foreground">{r.agency}</td>
              <td className="px-5 py-3 font-data text-xs">{r.due}</td>
              <td className="px-5 py-3">
                <span className={cn("inline-flex items-center gap-1.5 text-xs font-medium", meta.tone)}>
                  <meta.Icon className="h-3.5 w-3.5" /> {meta.label}
                </span>
              </td>
              <td className="px-5 py-3">
                {r.cp && <span className="rounded bg-primary/10 px-1.5 py-0.5 pilot-kicker text-primary">CP</span>}
              </td>
            </tr>
          );
        })}
    </>
  );
};

export default UnifiedMatrix;