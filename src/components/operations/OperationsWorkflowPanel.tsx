import { Fragment, useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDashed,
} from "lucide-react";
import { DataSourceBadge } from "@/components/operations/DataSourceBadge";
import { ProgressBar, statusStyles } from "@/components/operations/OperationsShared";
import type { MockWorkflowGroup } from "@/lib/operations/operations-types";
import { MOCK_WORKFLOW_NOTICE } from "@/lib/operations/operations-types";

export function OperationsWorkflowPanel({
  groups,
  openGroups,
  onToggleGroup,
}: {
  groups: MockWorkflowGroup[];
  openGroups: Record<string, boolean>;
  onToggleGroup: (name: string) => void;
}) {
  const [openTasks, setOpenTasks] = useState<Record<string, boolean>>({});
  const toggleTask = (k: string) => setOpenTasks((p) => ({ ...p, [k]: !p[k] }));

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-violet-500/30 bg-violet-500/5 px-4 py-3 text-sm">
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <DataSourceBadge kind="mock" />
          <span className="font-medium">PM Workflow</span>
        </div>
        <p className="text-muted-foreground">{MOCK_WORKFLOW_NOTICE}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          These groups are not mapped from filings, comments, scrape jobs, agent runs, or UCI
          milestones. They do not belong to the selected project.
        </p>
      </div>

      {groups.map((g) => {
        const open = openGroups[g.name] !== false;
        const done = g.tasks.filter((t) => t.status === "Done").length;
        return (
          <div key={g.name} className="overflow-hidden rounded-lg border border-border bg-card">
            <button
              type="button"
              onClick={() => onToggleGroup(g.name)}
              className="flex w-full items-center gap-2 border-b border-border bg-muted/30 px-4 py-2 text-left"
              style={{ borderLeft: `4px solid ${g.accent}` }}
            >
              {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              <span className="font-serif text-lg" style={{ color: g.accent }}>
                {g.name}
              </span>
              <span className="ml-2 text-xs text-muted-foreground">
                {g.tasks.length} items · {done} done
              </span>
              <DataSourceBadge kind="mock" className="ml-auto" />
            </button>
            {open && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
                      <th className="px-4 py-2 font-medium">Item</th>
                      <th className="px-3 py-2 font-medium">Critical Path</th>
                      <th className="px-3 py-2 font-medium">Responsible Coordinator</th>
                      <th className="px-3 py-2 font-medium">Status</th>
                      <th className="px-3 py-2 font-medium">Completion</th>
                      <th className="px-3 py-2 font-medium w-40">Progress</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.tasks.map((t, i) => {
                      const key = `${g.name}-${i}`;
                      const expanded = openTasks[key];
                      return (
                        <Fragment key={key}>
                          <tr className="border-b border-border/50 hover:bg-muted/30">
                            <td className="px-4 py-2">
                              <div className="flex items-center gap-2">
                                {t.subitems ? (
                                  <button
                                    type="button"
                                    onClick={() => toggleTask(key)}
                                    className="text-muted-foreground hover:text-foreground"
                                  >
                                    {expanded ? (
                                      <ChevronDown className="h-3.5 w-3.5" />
                                    ) : (
                                      <ChevronRight className="h-3.5 w-3.5" />
                                    )}
                                  </button>
                                ) : (
                                  <span className="w-3.5" />
                                )}
                                {t.status === "Done" ? (
                                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                                ) : (
                                  <CircleDashed className="h-3.5 w-3.5 text-muted-foreground" />
                                )}
                                <span>{t.name}</span>
                                {t.subitems && (
                                  <span className="ml-1 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                                    {t.subitems.length}
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="px-3 py-2">
                              <span
                                className={`inline-flex items-center justify-center rounded px-2 py-0.5 text-[10px] font-bold ${
                                  t.cp === "CP"
                                    ? "border border-amber-500/30 bg-amber-500/20 text-amber-700 dark:text-amber-400"
                                    : "border border-border bg-muted text-muted-foreground"
                                }`}
                              >
                                {t.cp}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-muted-foreground">{t.owner}</td>
                            <td className="px-3 py-2">
                              <span
                                className={`inline-flex items-center rounded border px-2 py-0.5 text-[11px] ${statusStyles[t.status]}`}
                              >
                                {t.status}
                              </span>
                            </td>
                            <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                              {t.completion}
                            </td>
                            <td className="px-3 py-2">
                              <ProgressBar value={t.progress} />
                            </td>
                          </tr>
                          {expanded && t.subitems && (
                            <tr className="bg-muted/10">
                              <td colSpan={6} className="px-4 py-3">
                                <div className="ml-6 overflow-hidden rounded-md border border-border bg-background/60">
                                  <table className="w-full text-xs">
                                    <thead>
                                      <tr className="border-b border-border text-left uppercase tracking-wider text-muted-foreground">
                                        <th className="px-3 py-1.5 font-medium">Subitem</th>
                                        <th className="px-3 py-1.5 font-medium">Approved</th>
                                        <th className="px-3 py-1.5 font-medium">Completion</th>
                                        <th className="px-3 py-1.5 font-medium">Dependent On</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {t.subitems.map((s, si) => (
                                        <tr
                                          key={si}
                                          className="border-b border-border/30 hover:bg-muted/30"
                                        >
                                          <td className="px-3 py-1.5">{s.name}</td>
                                          <td className="px-3 py-1.5">
                                            <span
                                              className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] ${
                                                s.approved === "Done"
                                                  ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                                                  : s.approved === "N/A"
                                                    ? "border-border bg-muted text-muted-foreground"
                                                    : "border-amber-500/30 bg-amber-500/15 text-amber-700 dark:text-amber-400"
                                              }`}
                                            >
                                              {s.approved}
                                            </span>
                                          </td>
                                          <td className="px-3 py-1.5 font-mono text-muted-foreground">
                                            {s.completion}
                                          </td>
                                          <td className="px-3 py-1.5">
                                            {s.dependsOn ? (
                                              <span className="rounded border border-sky-500/30 bg-sky-500/10 px-1.5 py-0.5 text-[10px] text-sky-600 dark:text-sky-400">
                                                {s.dependsOn}
                                              </span>
                                            ) : (
                                              <span className="text-muted-foreground">—</span>
                                            )}
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
