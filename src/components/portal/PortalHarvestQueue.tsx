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

const STALE_DAYS = 7;

type QueueRow = {
  project: Project;
  linked: boolean;
  synced: boolean;
  staleOrPending: boolean;
  daysSinceCheck: number | null;
};

function buildQueueRows(projects: Project[]): QueueRow[] {
  const now = Date.now();
  return projects.map((project) => {
    const linked = !!project.credential_id;
    const synced = !!project.portal_data;
    const daysSinceCheck = project.last_checked_at
      ? Math.floor((now - new Date(project.last_checked_at).getTime()) / (1000 * 60 * 60 * 24))
      : null;
    const staleOrPending = linked && (!synced || daysSinceCheck === null || daysSinceCheck > STALE_DAYS);
    return { project, linked, synced, staleOrPending, daysSinceCheck };
  });
}

function renderQueueStatus(row: QueueRow) {
  if (!row.linked) {
    return (
      <StatusPill tone="default">
        <KeyRound className="h-3 w-3" /> No credential
      </StatusPill>
    );
  }
  if (!row.synced) {
    return (
      <StatusPill tone="warn">
        <RefreshCw className="h-3 w-3" /> Awaiting first sync
      </StatusPill>
    );
  }
  if (row.staleOrPending) {
    return (
      <StatusPill tone="warn">
        <TriangleAlert className="h-3 w-3" /> Stale sync
      </StatusPill>
    );
  }
  return (
    <StatusPill tone="good">
      <Cloud className="h-3 w-3" /> Synced
    </StatusPill>
  );
}

export function PortalHarvestQueue({
  projects,
  projectsLoading,
  selectedProjectId,
  onOpenProject,
  onForceSyncAll,
  forceSyncing,
}: {
  projects: Project[];
  projectsLoading: boolean;
  selectedProjectId: string | null;
  onOpenProject: (projectId: string) => void;
  onForceSyncAll?: () => void;
  forceSyncing?: boolean;
}) {
  const rows = useMemo(() => buildQueueRows(projects), [projects]);

  const linkedCount = rows.filter((r) => r.linked).length;
  const syncedCount = rows.filter((r) => r.synced).length;
  const pendingCount = rows.filter((r) => r.linked && !r.synced).length;
  const staleCount = rows.filter((r) => r.linked && r.synced && r.staleOrPending).length;

  const recentHarvest = useMemo(
    () =>
      [...rows]
        .filter((r) => r.project.last_checked_at)
        .sort(
          (a, b) =>
            new Date(b.project.last_checked_at!).getTime() -
            new Date(a.project.last_checked_at!).getTime(),
        )
        .slice(0, 6),
    [rows],
  );

  const attentionRows = useMemo(
    () => rows.filter((r) => r.linked && (r.staleOrPending || !r.synced)).slice(0, 4),
    [rows],
  );

  const handleExport = () => {
    const header = ["Project", "Jurisdiction", "Permit #", "Portal Status", "Last Checked"];
    const body = rows.map((r) => [
      r.project.name,
      r.project.jurisdiction || "",
      r.project.permit_number || "",
      r.project.portal_status || "",
      r.project.last_checked_at ? new Date(r.project.last_checked_at).toISOString() : "",
    ]);
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
            {onForceSyncAll ? (
              <button
                type="button"
                className="pilot-button-ghost"
                onClick={onForceSyncAll}
                disabled={forceSyncing}
              >
                <RefreshCw className={`h-4 w-4 ${forceSyncing ? "animate-spin" : ""}`} />
                Force Sync
              </button>
            ) : null}
            <Link to="/projects" className="pilot-button-primary">
              <Sparkles className="h-4 w-4" /> Add Portal Credential
            </Link>
          </div>
        }
      />

      <div className="grid gap-4 md:grid-cols-4">
        <MetricCard
          label="Connected portals"
          value={projectsLoading ? "—" : `${linkedCount}`}
          detail="Projects with a linked credential"
          icon={Cloud}
        />
        <MetricCard
          label="Synced"
          value={projectsLoading ? "—" : `${syncedCount}`}
          detail="Portal data harvested at least once"
          icon={Inbox}
        />
        <MetricCard
          label="Awaiting first sync"
          value={projectsLoading ? "—" : `${pendingCount}`}
          detail="Linked, no harvest yet"
          icon={ShieldAlert}
        />
        <MetricCard
          label="Stale (7d+)"
          value={projectsLoading ? "—" : `${staleCount}`}
          detail="Needs a Force Sync"
          icon={TriangleAlert}
        />
      </div>

      {staleCount + pendingCount > 0 ? (
        <AlertBanner
          tone="warn"
          title={`${staleCount + pendingCount} project${staleCount + pendingCount === 1 ? "" : "s"} need attention`}
          detail="Stale or pending portal syncs are flagged below. Open a project to run a live scrape or review its fallback options."
        />
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <Panel title="Portal queue" eyebrow="Live monitoring">
          <div className="mb-4 flex flex-wrap gap-2">
            <Button variant="outline" size="sm" className="gap-1.5" disabled>
              <Filter className="h-4 w-4" /> Filter
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={handleExport}
              disabled={rows.length === 0}
            >
              <Download className="h-4 w-4" /> Export
            </Button>
            <Button asChild variant="outline" size="sm" className="gap-1.5">
              <Link to="/settings">
                <FolderUp className="h-4 w-4" /> Manage Credentials
              </Link>
            </Button>
          </div>

          {projectsLoading ? (
            <div className="space-y-3 p-1">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : rows.length === 0 ? (
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
                    <th className="font-data">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((row) => (
                    <tr
                      key={row.project.id}
                      className={`cursor-pointer hover:bg-muted/30 ${
                        row.project.id === selectedProjectId ? "bg-primary/5" : ""
                      }`}
                      onClick={() => onOpenProject(row.project.id)}
                    >
                      <td className="py-4 font-medium text-foreground">
                        <div className="flex items-center gap-2">
                          {row.project.name}
                          {row.project.id === selectedProjectId ? (
                            <ServicePill kind="permit">Active</ServicePill>
                          ) : null}
                        </div>
                      </td>
                      <td className="text-muted-foreground">{row.project.jurisdiction || "—"}</td>
                      <td className="font-mono text-xs text-muted-foreground">
                        {row.project.permit_number || "—"}
                      </td>
                      <td className="font-data text-xs text-muted-foreground">
                        {row.project.last_checked_at
                          ? formatDistanceToNow(new Date(row.project.last_checked_at), { addSuffix: true })
                          : "Never"}
                      </td>
                      <td>{renderQueueStatus(row)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <div className="space-y-4">
          <Panel title="Recent harvest" eyebrow="Latest checks">
            {recentHarvest.length === 0 ? (
              <p className="text-sm text-muted-foreground">No portal checks recorded yet.</p>
            ) : (
              <ul className="space-y-4">
                {recentHarvest.map((row) => (
                  <li
                    key={row.project.id}
                    className="cursor-pointer rounded-lg border border-border bg-muted/20 p-4 transition-colors hover:border-primary/40"
                    onClick={() => onOpenProject(row.project.id)}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="pilot-kicker">{row.project.jurisdiction || row.project.name}</div>
                      <div className="font-data text-[11px] uppercase tracking-wider text-muted-foreground">
                        {formatDistanceToNow(new Date(row.project.last_checked_at!), { addSuffix: true })}
                      </div>
                    </div>
                    <div className="mt-2 text-sm font-medium text-foreground">{row.project.name}</div>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      {row.project.portal_status || (row.synced ? "Portal data synced." : "Awaiting harvest.")}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Fallback workflows" eyebrow="Operator playbook">
            {attentionRows.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No stale or pending portals right now — all linked projects are synced.
              </p>
            ) : (
              <div className="space-y-3">
                {attentionRows.map((row) => (
                  <div key={row.project.id} className="rounded-lg border border-border bg-muted/20 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm font-medium text-foreground">{row.project.name}</div>
                      <StatusPill tone={row.synced ? "warn" : "bad"}>
                        {row.synced ? "Stale" : "Pending"}
                      </StatusPill>
                    </div>
                    <p className="mt-2 text-xs leading-5 text-muted-foreground">
                      {row.synced
                        ? `Last checked ${row.daysSinceCheck ?? "?"} day${row.daysSinceCheck === 1 ? "" : "s"} ago. Force Sync inside the project to refresh.`
                        : "Credential linked but no harvest has run yet. Open the project and Force Sync."}
                    </p>
                    <button
                      type="button"
                      className="pilot-button-ghost mt-3 py-1.5 text-xs"
                      onClick={() => onOpenProject(row.project.id)}
                    >
                      Open project <RefreshCw className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}
