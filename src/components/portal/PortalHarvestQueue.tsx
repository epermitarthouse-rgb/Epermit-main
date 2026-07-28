import { useMemo } from "react";
import { Link } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
import {
  Cloud,
  Download,
  FileUp,
  Filter,
  FolderUp,
  Inbox,
  KeyRound,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
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
  summarizePortalHarvestMetrics,
  type HarvestQueueStatus,
  type PortalHarvestRow,
} from "@/lib/portalHarvestMetrics";

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

  const loading = projectsLoading || evidence.loading;

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
    const body = evidence.rows.map((r) => {
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

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Portal Harvest"
        title="Operational monitoring for county and provider portals."
        body="Portal Harvest feeds both permit expediting and utility coordination. See which projects are synced, awaiting first harvest, or stalled, then drill into any project's live portal data."
        action={
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="pilot-button-ghost opacity-70"
              disabled
              title="A full portal harvest will be available here once the scraper action is connected."
              data-testid="button-run-full-harvest-queue"
            >
              <RefreshCw className="h-4 w-4" />
              Run Full Harvest
              <StatusPill tone="default" className="ml-1">
                Upcoming
              </StatusPill>
            </button>
            <Link to="/projects" className="pilot-button-primary">
              <Sparkles className="h-4 w-4" /> Manage Project Credentials
            </Link>
          </div>
        }
      />

      <div className="grid gap-4 md:grid-cols-4">
        <MetricCard
          label="Connected projects"
          value={loading ? "—" : `${metrics.connectedProjects}`}
          detail={
            loading
              ? "Projects linked to a portal credential"
              : metrics.uniqueCredentials > 0
                ? (
                    <>
                      Projects linked to a portal credential
                      <br />
                      <span className="text-muted-foreground">
                        {metrics.uniqueCredentials} credential
                        {metrics.uniqueCredentials === 1 ? "" : "s"}
                      </span>
                    </>
                  )
                : "Projects linked to a portal credential"
          }
          icon={Cloud}
        />
        <MetricCard
          label="Up to date"
          value={loading ? "—" : `${metrics.upToDate}`}
          detail="Current harvest status is Synced"
          icon={Inbox}
        />
        <MetricCard
          label="Awaiting first harvest"
          value={loading ? "—" : `${metrics.awaitingFirstHarvest}`}
          detail="Linked, but no successful harvest yet"
          icon={ShieldAlert}
        />
        <MetricCard
          label="Needs attention"
          value={loading ? "—" : `${metrics.needsAttention}`}
          detail="Stale, failed, partial, or blocked projects"
          icon={TriangleAlert}
        />
      </div>

      {!loading && metrics.needsAttention > 0 ? (
        <AlertBanner
          tone="warn"
          title={`${metrics.needsAttention} project${metrics.needsAttention === 1 ? "" : "s"} need attention`}
          detail={
            <>
              <span>
                Projects with failed, partial, stale, or blocked harvests are listed below.
              </span>
              {attentionBreakdownLines.length > 0 ? (
                <span className="mt-1 block font-data text-xs">
                  {attentionBreakdownLines.join(" · ")}
                </span>
              ) : null}
            </>
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

      <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <Panel title="Portal queue" eyebrow="Live monitoring">
          <div className="mb-4 flex flex-wrap gap-2">
            <Button variant="outline" size="sm" className="gap-1.5" disabled>
              <Filter className="h-4 w-4" /> Filter
              <StatusPill tone="default" className="ml-1">
                Upcoming
              </StatusPill>
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={handleExport}
              disabled={evidence.rows.length === 0}
            >
              <Download className="h-4 w-4" /> Export
            </Button>
            <Button asChild variant="outline" size="sm" className="gap-1.5">
              <Link to="/settings">
                <FolderUp className="h-4 w-4" /> Manage Credentials
              </Link>
            </Button>
          </div>

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
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-left text-sm">
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
                  {evidence.rows.map((row) => {
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
                        <td className="py-4 font-medium text-foreground">
                          <div className="flex items-center gap-2">
                            {project.name}
                            {row.projectId === selectedProjectId ? (
                              <ServicePill kind="permit">Active</ServicePill>
                            ) : null}
                          </div>
                        </td>
                        <td className="text-muted-foreground">
                          {project.jurisdiction || "—"}
                        </td>
                        <td className="font-mono text-xs text-muted-foreground">
                          {project.permit_number || "—"}
                        </td>
                        <td className="font-data text-xs text-muted-foreground">
                          {row.lastCheckedAt
                            ? formatDistanceToNow(new Date(row.lastCheckedAt), {
                                addSuffix: true,
                              })
                            : "Never"}
                        </td>
                        <td>{renderQueueStatus(row.harvestStatus)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <div className="space-y-4">
          <Panel title="Recently checked projects" eyebrow="Latest checks">
            {recentChecked.length === 0 ? (
              <p className="text-sm text-muted-foreground">No portal checks recorded yet.</p>
            ) : (
              <ul className="space-y-4">
                {recentChecked.map((row) => {
                  const project = projectById(projects, row.projectId);
                  const label = recentActivityLabel(row, project);
                  return (
                    <li
                      key={row.projectId}
                      className="cursor-pointer rounded-lg border border-border bg-muted/20 p-4 transition-colors hover:border-primary/40"
                      onClick={() => onOpenProject(row.projectId)}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="font-mono text-sm font-semibold text-foreground">
                          {label}
                        </div>
                        <div className="font-data text-[11px] uppercase tracking-wider text-muted-foreground">
                          {row.lastCheckedAt
                            ? formatDistanceToNow(new Date(row.lastCheckedAt), {
                                addSuffix: true,
                              })
                            : "—"}
                        </div>
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {project?.jurisdiction || project?.name || "—"}
                      </div>
                      <p className="mt-2 text-xs leading-5 text-muted-foreground">
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

          <Panel title="Fallback workflows" eyebrow="Operator playbook">
            {attentionRows.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No stale, failed, partial, or missing harvests right now — connected projects look
                up to date.
              </p>
            ) : (
              <div className="space-y-3">
                {attentionRows.map((row) => {
                  const project = projectById(projects, row.projectId);
                  return (
                    <div
                      key={row.projectId}
                      className="rounded-lg border border-border bg-muted/20 p-4"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-sm font-medium text-foreground">
                          {project?.permit_number || project?.name || row.projectId}
                        </div>
                        <StatusPill tone={harvestStatusTone(row.harvestStatus)}>
                          {row.harvestStatus}
                        </StatusPill>
                      </div>
                      <p className="mt-2 text-xs leading-5 text-muted-foreground">
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
