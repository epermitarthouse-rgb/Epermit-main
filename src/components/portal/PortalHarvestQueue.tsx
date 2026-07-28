import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
import {
  Cloud,
  Download,
  FileUp,
  Filter,
  FolderUp,
  KeyRound,
  RefreshCw,
  ShieldAlert,
  TriangleAlert,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertBanner,
  MetricCard,
  PageHeader,
  Panel,
  ServicePill,
  StatusPill,
} from "@/components/design/ProductPrimitives";
import type { Project } from "@/types/project";
import { usePortalHarvestEvidence } from "@/hooks/usePortalHarvestEvidence";
import {
  formatAttentionBreakdownLines,
  harvestStatusTone,
  NEEDS_ATTENTION_STATUSES,
  summarizePortalHarvestMetrics,
  type HarvestQueueStatus,
  type PortalHarvestRow,
} from "@/lib/portalHarvestMetrics";

const HARVEST_STATUS_FILTERS: HarvestQueueStatus[] = [
  "Synced",
  "Awaiting First Harvest",
  "Stale",
  "Partial",
  "Failed",
  "Queued",
  "Running",
  "Credentials Required",
  "Human Action Required",
];

const TOOLBAR_BTN =
  "h-7 gap-1.5 px-2.5 text-xs font-medium [&_svg]:h-3.5 [&_svg]:w-3.5";

function renderQueueStatus(status: HarvestQueueStatus) {
  const tone = harvestStatusTone(status);
  if (status === "Credentials Required") {
    return (
      <StatusPill tone={tone}>
        <KeyRound className="h-3 w-3" /> {status}
      </StatusPill>
    );
  }
  if (status === "Awaiting First Harvest" || status === "Stale" || status === "Partial") {
    return (
      <StatusPill tone={tone}>
        <TriangleAlert className="h-3 w-3" /> {status}
      </StatusPill>
    );
  }
  if (status === "Running" || status === "Queued") {
    return (
      <StatusPill tone={tone}>
        <RefreshCw className="h-3 w-3" /> {status}
      </StatusPill>
    );
  }
  if (status === "Failed" || status === "Human Action Required") {
    return (
      <StatusPill tone={tone}>
        <ShieldAlert className="h-3 w-3" /> {status}
      </StatusPill>
    );
  }
  return (
    <StatusPill tone={tone}>
      <Cloud className="h-3 w-3" /> {status}
    </StatusPill>
  );
}

function projectById(projects: Project[], id: string): Project | undefined {
  return projects.find((p) => p.id === id);
}

function recentActivityLabel(row: PortalHarvestRow, project: Project | undefined) {
  const permit = project?.permit_number?.trim();
  return permit || project?.name || row.projectId;
}

export function PortalHarvestQueue({
  projects,
  projectsLoading,
  selectedProjectId,
  onOpenProject,
}: {
  projects: Project[];
  projectsLoading: boolean;
  selectedProjectId: string | null;
  onOpenProject: (projectId: string) => void;
  /** @deprecated Unwired full-harvest control — kept off the public API intentionally. */
  onForceSyncAll?: () => void;
  forceSyncing?: boolean;
}) {
  const evidence = usePortalHarvestEvidence(projects);
  const metrics = useMemo(
    () => summarizePortalHarvestMetrics(evidence.rows),
    [evidence.rows],
  );
  const attentionBreakdownLines = useMemo(
    () => formatAttentionBreakdownLines(metrics.attentionBreakdown),
    [metrics.attentionBreakdown],
  );

  /** Empty set = show all statuses. */
  const [statusFilters, setStatusFilters] = useState<Set<HarvestQueueStatus>>(
    () => new Set(),
  );

  const loading = projectsLoading || evidence.loading;

  const filteredRows = useMemo(() => {
    if (statusFilters.size === 0) return evidence.rows;
    return evidence.rows.filter((r) => statusFilters.has(r.harvestStatus));
  }, [evidence.rows, statusFilters]);

  const recentChecked = useMemo(
    () =>
      [...evidence.rows]
        .filter((r) => r.lastCheckedAt)
        .sort(
          (a, b) =>
            new Date(b.lastCheckedAt!).getTime() - new Date(a.lastCheckedAt!).getTime(),
        )
        .slice(0, 6),
    [evidence.rows],
  );

  const attentionRows = useMemo(
    () =>
      evidence.rows
        .filter(
          (r) =>
            r.linked &&
            (r.needsAttention || r.harvestStatus === "Awaiting First Harvest"),
        )
        .slice(0, 4),
    [evidence.rows],
  );

  const toggleStatus = (status: HarvestQueueStatus) => {
    setStatusFilters((prev) => {
      const next = new Set(prev);
      if (next.has(status)) next.delete(status);
      else next.add(status);
      return next;
    });
  };

  const applyPreset = (preset: "all" | "upToDate" | "awaiting" | "needsAttention") => {
    if (preset === "all") {
      setStatusFilters(new Set());
      return;
    }
    if (preset === "upToDate") {
      setStatusFilters(new Set<HarvestQueueStatus>(["Synced"]));
      return;
    }
    if (preset === "awaiting") {
      setStatusFilters(new Set<HarvestQueueStatus>(["Awaiting First Harvest"]));
      return;
    }
    setStatusFilters(new Set(NEEDS_ATTENTION_STATUSES));
  };

  const handleExport = () => {
    const header = [
      "Project",
      "Jurisdiction",
      "Permit #",
      "Portal Status",
      "Harvest Status",
      "Last Checked",
      "Last Successful Harvest",
    ];
    const body = filteredRows.map((r) => {
      const project = projectById(projects, r.projectId);
      return [
        project?.name || "",
        project?.jurisdiction || "",
        project?.permit_number || "",
        r.portalStatus || "",
        r.harvestStatus,
        r.lastCheckedAt ? new Date(r.lastCheckedAt).toISOString() : "",
        r.lastSuccessfulHarvestAt
          ? new Date(r.lastSuccessfulHarvestAt).toISOString()
          : "",
      ];
    });
    const csv = [header, ...body]
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "portal-harvest-queue.csv";
    link.click();
    URL.revokeObjectURL(url);
  };

  const filterActive = statusFilters.size > 0;

  return (
    <div className="w-full min-w-0 max-w-full space-y-4 overflow-x-clip">
      <PageHeader
        className="mb-0 gap-3 sm:items-center"
        eyebrow="Portal Harvest"
        title="Operational monitoring for county and provider portals."
        body="Track harvest health across linked projects, then open any row for portal detail."
        action={
          <button
            type="button"
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-transparent px-2.5 text-xs font-medium text-muted-foreground opacity-70",
            )}
            disabled
            title="A full portal harvest will be available here once the scraper action is connected."
            data-testid="button-run-full-harvest-queue"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Run Full Harvest
            <StatusPill tone="default" className="ml-0.5 px-1.5 py-0 text-[9px]">
              Upcoming
            </StatusPill>
          </button>
        }
      />

      <div className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          className="min-w-0 p-3.5 [&_.font-display]:mt-1 [&_.font-display]:text-2xl md:[&_.font-display]:text-2xl [&_p.mt-2]:mt-1"
          label="Connected projects"
          value={loading ? "—" : `${metrics.connectedProjects}`}
          detail={
            loading
              ? "Linked to a portal credential"
              : metrics.uniqueCredentials > 0
                ? `${metrics.uniqueCredentials} credential${metrics.uniqueCredentials === 1 ? "" : "s"}`
                : "Linked to a portal credential"
          }
        />
        <MetricCard
          className="min-w-0 p-3.5 [&_.font-display]:mt-1 [&_.font-display]:text-2xl md:[&_.font-display]:text-2xl [&_p.mt-2]:mt-1"
          label="Up to date"
          value={loading ? "—" : `${metrics.upToDate}`}
          detail="Harvest status Synced"
        />
        <MetricCard
          className="min-w-0 p-3.5 [&_.font-display]:mt-1 [&_.font-display]:text-2xl md:[&_.font-display]:text-2xl [&_p.mt-2]:mt-1"
          label="Awaiting first harvest"
          value={loading ? "—" : `${metrics.awaitingFirstHarvest}`}
          detail="No successful harvest yet"
        />
        <MetricCard
          className="min-w-0 p-3.5 [&_.font-display]:mt-1 [&_.font-display]:text-2xl md:[&_.font-display]:text-2xl [&_p.mt-2]:mt-1"
          label="Needs attention"
          value={loading ? "—" : `${metrics.needsAttention}`}
          detail="Stale, failed, partial, or blocked"
        />
      </div>

      {!loading && metrics.needsAttention > 0 ? (
        <AlertBanner
          className="px-3 py-2"
          tone="warn"
          title={`${metrics.needsAttention} project${metrics.needsAttention === 1 ? "" : "s"} need attention`}
          detail={
            attentionBreakdownLines.length > 0 ? (
              <span className="font-data text-xs">{attentionBreakdownLines.join(" · ")}</span>
            ) : null
          }
        />
      ) : null}
      {!loading &&
      metrics.needsAttention === 0 &&
      metrics.awaitingFirstHarvest === 0 &&
      metrics.activeJobs === 0 &&
      metrics.connectedProjects > 0 ? (
        <AlertBanner
          tone="info"
          title="All connected projects are up to date"
          detail="No failed, partial, stale, blocked, or missing harvests in the current queue."
        />
      ) : null}
      {!loading && metrics.needsAttention === 0 && metrics.activeJobs > 0 ? (
        <AlertBanner
          tone="info"
          title={`${metrics.activeJobs} project${metrics.activeJobs === 1 ? "" : "s"} actively harvesting`}
          detail={formatAttentionBreakdownLines({
            ...metrics.attentionBreakdown,
            stale: 0,
            partial: 0,
            failed: 0,
            credentialsRequired: 0,
            humanActionRequired: 0,
          }).join(" · ")}
        />
      ) : null}

      {evidence.error ? (
        <AlertBanner
          tone="warn"
          title="Harvest evidence partially unavailable"
          detail={evidence.error}
        />
      ) : null}

      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,0.85fr)]">
        <Panel title="Portal queue" eyebrow="Live monitoring" className="min-w-0 overflow-hidden p-4">
          <div className="mb-3 flex flex-wrap items-center gap-1.5">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className={TOOLBAR_BTN}
                  data-testid="button-portal-harvest-filter"
                >
                  <Filter />
                  Filter
                  {filterActive ? (
                    <StatusPill tone="info" className="ml-0.5 px-1.5 py-0 text-[9px] normal-case tracking-normal">
                      {statusFilters.size}
                    </StatusPill>
                  ) : null}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-64">
                <DropdownMenuLabel>Quick filters</DropdownMenuLabel>
                <DropdownMenuItem onClick={() => applyPreset("all")}>
                  All projects
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => applyPreset("upToDate")}>
                  Up to date
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => applyPreset("awaiting")}>
                  Awaiting first harvest
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => applyPreset("needsAttention")}>
                  Needs attention
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>Harvest status</DropdownMenuLabel>
                {HARVEST_STATUS_FILTERS.map((status) => (
                  <DropdownMenuCheckboxItem
                    key={status}
                    checked={statusFilters.has(status)}
                    onCheckedChange={() => toggleStatus(status)}
                    onSelect={(e) => e.preventDefault()}
                  >
                    {status}
                  </DropdownMenuCheckboxItem>
                ))}
                {filterActive ? (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => applyPreset("all")}>
                      <X className="mr-2 h-3.5 w-3.5" />
                      Clear filters
                    </DropdownMenuItem>
                  </>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
            {filterActive ? (
              <Button
                variant="ghost"
                size="sm"
                className={cn(TOOLBAR_BTN, "text-muted-foreground")}
                onClick={() => applyPreset("all")}
              >
                <X />
                Clear
              </Button>
            ) : null}
            <Button
              variant="outline"
              size="sm"
              className={TOOLBAR_BTN}
              onClick={handleExport}
              disabled={filteredRows.length === 0}
            >
              <Download /> Export
            </Button>
            <Button asChild variant="outline" size="sm" className={TOOLBAR_BTN}>
              <Link to="/settings">
                <FolderUp /> Manage Credentials
              </Link>
            </Button>
          </div>

          {filterActive && !loading ? (
            <p className="mb-2 text-xs text-muted-foreground">
              Showing {filteredRows.length} of {evidence.rows.length} projects
            </p>
          ) : null}

          {loading ? (
            <div className="space-y-3 p-1">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : evidence.rows.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <FileUp className="h-10 w-10 text-muted-foreground" />
              <p className="font-tight font-semibold">No projects yet</p>
              <p className="max-w-sm text-sm text-muted-foreground">
                Create a project and link a portal credential to start harvesting.
              </p>
              <Button asChild size="sm">
                <Link to="/projects/new">New Project</Link>
              </Button>
            </div>
          ) : filteredRows.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <Filter className="h-10 w-10 text-muted-foreground" />
              <p className="font-tight font-semibold">No projects match this filter</p>
              <p className="max-w-sm text-sm text-muted-foreground">
                Clear or change the harvest status filter to see more projects.
              </p>
              <Button size="sm" variant="outline" onClick={() => applyPreset("all")}>
                Clear filters
              </Button>
            </div>
          ) : (
            <div className="min-w-0 overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead className="border-b border-border text-xs uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="py-3 font-data">Project</th>
                    <th className="font-data">Jurisdiction</th>
                    <th className="font-data">Permit #</th>
                    <th className="font-data">Last checked</th>
                    <th className="font-data">Harvest status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filteredRows.map((row) => {
                    const project = projectById(projects, row.projectId);
                    if (!project) return null;
                    return (
                      <tr
                        key={row.projectId}
                        className={`cursor-pointer hover:bg-muted/30 ${
                          row.projectId === selectedProjectId ? "bg-primary/5" : ""
                        }`}
                        onClick={() => onOpenProject(row.projectId)}
                      >
                        <td className="max-w-[220px] truncate py-4 font-medium text-foreground">
                          <div className="flex min-w-0 items-center gap-2">
                            <span className="truncate">{project.name}</span>
                            {row.projectId === selectedProjectId ? (
                              <ServicePill kind="permit">Active</ServicePill>
                            ) : null}
                          </div>
                        </td>
                        <td className="max-w-[140px] truncate text-muted-foreground">
                          {project.jurisdiction || "—"}
                        </td>
                        <td className="font-mono text-xs text-muted-foreground">
                          {project.permit_number || "—"}
                        </td>
                        <td className="whitespace-nowrap font-data text-xs text-muted-foreground">
                          {row.lastCheckedAt
                            ? formatDistanceToNow(new Date(row.lastCheckedAt), {
                                addSuffix: true,
                              })
                            : "Never"}
                        </td>
                        <td className="whitespace-nowrap">{renderQueueStatus(row.harvestStatus)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <div className="min-w-0 space-y-3">
          <Panel
            title="Recently checked projects"
            eyebrow="Latest checks"
            className="min-w-0 overflow-hidden p-4"
          >
            {recentChecked.length === 0 ? (
              <p className="text-sm text-muted-foreground">No portal checks recorded yet.</p>
            ) : (
              <ul className="space-y-2.5">
                {recentChecked.map((row) => {
                  const project = projectById(projects, row.projectId);
                  const label = recentActivityLabel(row, project);
                  return (
                    <li
                      key={row.projectId}
                      className="min-w-0 cursor-pointer rounded-md border border-border bg-muted/20 p-3 transition-colors hover:border-primary/40"
                      onClick={() => onOpenProject(row.projectId)}
                    >
                      <div className="flex min-w-0 items-start justify-between gap-3">
                        <div className="min-w-0 truncate font-mono text-sm font-semibold text-foreground">
                          {label}
                        </div>
                        <div className="shrink-0 font-data text-[11px] uppercase tracking-wider text-muted-foreground">
                          {row.lastCheckedAt
                            ? formatDistanceToNow(new Date(row.lastCheckedAt), {
                                addSuffix: true,
                              })
                            : "—"}
                        </div>
                      </div>
                      <div className="mt-1 truncate text-xs text-muted-foreground">
                        {project?.jurisdiction || project?.name || "—"}
                      </div>
                      <p className="mt-2 break-words text-xs leading-5 text-muted-foreground">
                        Harvest: {row.harvestStatus}
                        {row.portalStatus ? (
                          <>
                            <br />
                            Portal status: {row.portalStatus}
                          </>
                        ) : null}
                      </p>
                      {!row.hasSuccessfulHarvest ? (
                        <p className="mt-1 text-xs text-muted-foreground">No harvest yet</p>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>

          <Panel
            title="Fallback workflows"
            eyebrow="Operator playbook"
            className="min-w-0 overflow-hidden p-4"
          >
            {attentionRows.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No stale, failed, partial, or missing harvests right now — connected projects look
                up to date.
              </p>
            ) : (
              <div className="space-y-2.5">
                {attentionRows.map((row) => {
                  const project = projectById(projects, row.projectId);
                  return (
                    <div
                      key={row.projectId}
                      className="min-w-0 rounded-md border border-border bg-muted/20 p-3"
                    >
                      <div className="flex min-w-0 items-center justify-between gap-3">
                        <div className="min-w-0 truncate text-sm font-medium text-foreground">
                          {project?.permit_number || project?.name || row.projectId}
                        </div>
                        <StatusPill tone={harvestStatusTone(row.harvestStatus)}>
                          {row.harvestStatus}
                        </StatusPill>
                      </div>
                      <p className="mt-2 break-words text-xs leading-5 text-muted-foreground">
                        {row.portalStatus ? `Portal status: ${row.portalStatus}. ` : null}
                        {row.harvestStatus === "Awaiting First Harvest"
                          ? "Linked, but no successful harvest yet."
                          : row.harvestStatus === "Stale"
                            ? `Last successful harvest ${row.daysSinceSuccessfulHarvest ?? "?"} day${row.daysSinceSuccessfulHarvest === 1 ? "" : "s"} ago.`
                            : `Needs attention (${row.attentionReasons.join(", ")}).`}
                      </p>
                      <button
                        type="button"
                        className="pilot-button-ghost mt-3 py-1.5 text-xs"
                        onClick={() => onOpenProject(row.projectId)}
                      >
                        Open project <RefreshCw className="h-3 w-3" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}
