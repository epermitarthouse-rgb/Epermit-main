import { useCallback, useEffect, useMemo, useState } from "react";
import { ExternalLink, Link2, RefreshCw } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { AlertBanner, PageHeader, Panel, StatusPill } from "@/components/design/ProductPrimitives";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  formatUciUserError,
  getUciPortalHarvest,
  linkUciPortalHarvestApplication,
  listProjectCoordination,
  refreshUciPortalHarvest,
} from "@/lib/uciApi";
import type {
  CoordinationRecord,
  UciPortalHarvestApplication,
  UciPortalHarvestResponse,
} from "@/types/uci";

function matchTone(status: UciPortalHarvestApplication["match_status"]) {
  if (status === "Linked") return "good" as const;
  if (status === "Needs review") return "warn" as const;
  return "default" as const;
}

function formatDate(value: string | null) {
  if (!value) return "Never";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function isPepcoRecord(record: CoordinationRecord) {
  const provider = Array.isArray(record.utility_providers)
    ? record.utility_providers[0]
    : record.utility_providers;
  return provider?.slug === "pepco";
}

export default function UciPortalHarvest() {
  const [harvest, setHarvest] = useState<UciPortalHarvestResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [linkingId, setLinkingId] = useState<string | null>(null);
  const [selectedProjects, setSelectedProjects] = useState<Record<string, string>>({});
  const [recordsByProject, setRecordsByProject] = useState<Record<string, CoordinationRecord[]>>({});
  const [selectedRecords, setSelectedRecords] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15_000);
    try {
      setHarvest(await getUciPortalHarvest("pepco", { signal: controller.signal }));
    } catch (loadError) {
      setHarvest(null);
      setError(
        loadError instanceof DOMException && loadError.name === "AbortError"
          ? "The PEPCO harvest request timed out. Retry after confirming the scraper API is available."
          : formatUciUserError(loadError, "Unable to load PEPCO harvest."),
      );
    } finally {
      window.clearTimeout(timeout);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const metrics = useMemo(() => {
    const applications = harvest?.applications ?? [];
    return {
      total: applications.length,
      linked: applications.filter((application) => application.match_status === "Linked").length,
      review: applications.filter((application) => application.match_status === "Needs review").length,
      unmatched: applications.filter((application) => application.match_status === "Unmatched").length,
    };
  }, [harvest]);

  const chooseProject = async (applicationId: string, projectId: string) => {
    setSelectedProjects((previous) => ({ ...previous, [applicationId]: projectId }));
    setSelectedRecords((previous) => ({ ...previous, [applicationId]: "" }));
    if (!projectId || recordsByProject[projectId]) return;
    try {
      const response = await listProjectCoordination(projectId);
      const records = response.records.filter(isPepcoRecord);
      setRecordsByProject((previous) => ({ ...previous, [projectId]: records }));
      if (records.length === 1) {
        setSelectedRecords((previous) => ({ ...previous, [applicationId]: records[0].id }));
      }
    } catch (recordError) {
      toast.error(formatUciUserError(recordError, "Unable to load PEPCO coordination records."));
    }
  };

  const confirmLink = async (application: UciPortalHarvestApplication) => {
    const projectId = selectedProjects[application.external_application_id];
    const coordinationRecordId = selectedRecords[application.external_application_id];
    if (!projectId || !coordinationRecordId) return;
    setLinkingId(application.external_application_id);
    try {
      await linkUciPortalHarvestApplication("pepco", application.external_application_id, {
        project_id: projectId,
        coordination_record_id: coordinationRecordId,
      });
      toast.success("PEPCO application linked.");
      await load();
    } catch (linkError) {
      toast.error(formatUciUserError(linkError, "Unable to link PEPCO application."));
    } finally {
      setLinkingId(null);
    }
  };

  const refreshLinkedData = async () => {
    setRefreshing(true);
    try {
      const result = await refreshUciPortalHarvest("pepco");
      toast.success(`Refreshed ${result.refreshed} linked application(s).`);
      await load();
    } catch (refreshError) {
      toast.error(formatUciUserError(refreshError, "Unable to refresh linked PEPCO data."));
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Cross-project operations"
        title="UCI Portal Harvest"
        body="Provider-account discoveries are inventoried first, then explicitly linked to the correct PermitPilot project and coordination record."
        action={
          <Button onClick={refreshLinkedData} disabled={refreshing || loading}>
            <RefreshCw className={refreshing ? "animate-spin" : ""} />
            {refreshing ? "Refreshing…" : "Refresh linked data"}
          </Button>
        }
      />

      <div className="mx-auto w-full max-w-7xl space-y-5">
        <AlertBanner
          tone="info"
          title="Harvest → link → coordination"
          detail="This page does not re-scrape on load. Refresh replays already-harvested PEPCO snapshots only into their confirmed links; unmatched applications remain unattached."
        />
        {error ? (
          <div className="space-y-2">
            <AlertBanner tone="bad" title="Could not load harvest" detail={error} />
            <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
              Retry loading harvest
            </Button>
          </div>
        ) : null}

        {!loading && !error ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ["Discovered", metrics.total],
              ["Linked", metrics.linked],
              ["Needs review", metrics.review],
              ["Unmatched", metrics.unmatched],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg border bg-card p-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
                <p className="mt-1 text-2xl font-semibold">{value}</p>
              </div>
            ))}
          </div>
        ) : null}

        <Panel
          eyebrow="PEPCO provider account"
          title={`Discovered applications · last sync ${formatDate(harvest?.last_sync ?? null)}`}
        >
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading already-scraped PEPCO data…</p>
          ) : error ? (
            <p className="text-sm text-muted-foreground">
              PEPCO harvest data is unavailable. Use the retry action above.
            </p>
          ) : !harvest?.applications.length ? (
            <p className="text-sm text-muted-foreground">
              No normalized PEPCO applications are available yet. Run PEPCO discovery explicitly from
              a coordination workspace, then return here to match the harvested applications.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1180px] text-left text-sm">
                <thead className="border-b text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="py-3 pr-4">PEPCO project / application</th>
                    <th className="pr-4">Status / milestone</th>
                    <th className="pr-4">Evidence</th>
                    <th className="pr-4">Match</th>
                    <th className="pr-4">PermitPilot link</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {harvest.applications.map((application) => {
                    const appId = application.external_application_id;
                    const projectId = selectedProjects[appId] ?? "";
                    const records = recordsByProject[projectId] ?? [];
                    return (
                      <tr key={appId} className="align-top">
                        <td className="py-4 pr-4">
                          <p className="font-medium">{application.name || "Unnamed PEPCO project"}</p>
                          <p className="font-mono text-xs text-muted-foreground">{appId}</p>
                          {application.external_job_id ? (
                            <p className="text-xs text-muted-foreground">
                              PEPCO job {application.external_job_id}
                            </p>
                          ) : null}
                          <p className="text-xs text-muted-foreground">
                            {application.address || "No address captured"}
                          </p>
                          {application.source_duplicate_count > 1 ? (
                            <Badge variant="outline" className="mt-2">
                              {application.source_duplicate_count} legacy duplicate attachments collapsed
                            </Badge>
                          ) : null}
                        </td>
                        <td className="pr-4">
                          <p>{application.portal_status || "No status"}</p>
                          <p className="text-xs text-muted-foreground">
                            {application.portal_milestone || application.latest_milestone_status || "No milestone"}
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            Synced {formatDate(application.last_synced_at)}
                          </p>
                        </td>
                        <td className="pr-4 text-xs text-muted-foreground">
                          <p>{application.documents_count} documents</p>
                          <p>{application.communications_count} communications</p>
                          <p>{application.milestones_count} milestones</p>
                        </td>
                        <td className="pr-4">
                          <StatusPill tone={matchTone(application.match_status)}>
                            {application.match_status}
                          </StatusPill>
                          {application.suggestions.map((suggestion) => (
                            <button
                              key={suggestion.project_id}
                              type="button"
                              className="mt-2 block max-w-[220px] text-left text-xs text-primary hover:underline"
                              onClick={() => void chooseProject(appId, suggestion.project_id)}
                            >
                              Suggest {suggestion.project_name} · {suggestion.confidence}
                              <span className="block text-muted-foreground">
                                {suggestion.reasons.join(", ")}
                              </span>
                            </button>
                          ))}
                        </td>
                        <td className="pr-4">
                          {application.linked_project ? (
                            <div className="space-y-1">
                              <Link
                                className="block font-medium text-primary hover:underline"
                                to={`/uci?projectId=${encodeURIComponent(application.linked_project.id)}`}
                              >
                                {application.linked_project.name}
                              </Link>
                              {application.coordination_record_id ? (
                                <Link
                                  className="block text-xs text-primary hover:underline"
                                  to={`/uci/records/${encodeURIComponent(application.coordination_record_id)}`}
                                >
                                  Coordination record
                                </Link>
                              ) : null}
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">Not linked</span>
                          )}
                        </td>
                        <td>
                          <div className="w-[230px] space-y-2">
                            <select
                              className="h-9 w-full rounded-md border bg-background px-2 text-xs"
                              aria-label={`PermitPilot project for ${application.name || appId}`}
                              value={projectId}
                              onChange={(event) => void chooseProject(appId, event.target.value)}
                            >
                              <option value="">Select project</option>
                              {harvest.projects.map((project) => (
                                <option key={project.id} value={project.id}>
                                  {project.name}
                                </option>
                              ))}
                            </select>
                            <select
                              className="h-9 w-full rounded-md border bg-background px-2 text-xs"
                              aria-label={`Coordination record for ${application.name || appId}`}
                              value={selectedRecords[appId] ?? ""}
                              disabled={!projectId}
                              onChange={(event) =>
                                setSelectedRecords((previous) => ({
                                  ...previous,
                                  [appId]: event.target.value,
                                }))
                              }
                            >
                              <option value="">Select PEPCO record</option>
                              {records.map((record) => (
                                <option key={record.id} value={record.id}>
                                  Stage {record.current_stage} · {record.scope_description || "PEPCO"}
                                </option>
                              ))}
                            </select>
                            <Button
                              size="sm"
                              className="w-full"
                              disabled={
                                !projectId ||
                                !selectedRecords[appId] ||
                                linkingId === application.external_application_id
                              }
                              onClick={() => void confirmLink(application)}
                            >
                              <Link2 />
                              {application.linked_project ? "Relink" : "Confirm link"}
                            </Button>
                            {application.linked_project ? (
                              <Button variant="outline" size="sm" className="w-full" asChild>
                                <Link to={`/uci?projectId=${encodeURIComponent(application.linked_project.id)}`}>
                                  Open project <ExternalLink />
                                </Link>
                              </Button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}
