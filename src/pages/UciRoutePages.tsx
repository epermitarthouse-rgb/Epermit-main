import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AlertTriangle, Search } from "lucide-react";
import { AlertBanner, PageHeader, Panel } from "@/components/design/ProductPrimitives";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSelectedProjectOptional } from "@/contexts/SelectedProjectContext";
import { useProjects } from "@/hooks/useProjects";
import {
  useUciOperationalSnapshot,
  type UciOperationalRecord as OperationalRecord,
} from "@/hooks/useUciOperationalSnapshot";
import { parseApplicationPackageMetadata } from "@/lib/uciApplicationPrep";
import { supabase } from "@/lib/supabase";
import {
  formatUciUserError,
  getCoordinationDetail,
  getProjectPortfolioView,
  getProjectProviderResolution,
  listProjectCoordination,
  listProjectNeedsAttentionCommunications,
  listUciProviders,
} from "@/lib/uciApi";
import type {
  CoordinationApplication,
  CoordinationCommunication,
  CoordinationCost,
  CoordinationRecord,
  UciProviderResolutionListResponse,
  UtilityProvider,
} from "@/types/uci";

type LoadMode = "records" | "details" | "attention" | "portfolio";

const STAGE_LABELS: Record<number, string> = {
  0: "setup",
  1: "provider resolution",
  2: "load and application preparation",
  3: "application package",
  4: "submission",
  5: "utility communications",
  6: "class of service",
  7: "costs and equipment",
  8: "meter-set preparation",
  9: "energization",
  10: "closeout",
};

function lifecycleLabel(record: CoordinationRecord): string {
  return STAGE_LABELS[record.current_stage] ?? `stage ${record.current_stage}`;
}

function applicationPackageStatus(application: CoordinationApplication): string {
  return parseApplicationPackageMetadata(application)?.package_status
    ?? application.portal_status
    ?? application.draft_status
    ?? "unknown";
}

function applicationBlockers(application: CoordinationApplication): string[] {
  const meta = parseApplicationPackageMetadata(application);
  return [
    ...(meta?.missing_fields ?? []).map((field) => `Missing field: ${field}`),
    ...(meta?.missing_documents ?? []).map((document) => `Missing document: ${document}`),
    ...(application.action_required ? ["Utility action required"] : []),
    ...(application.last_error ? [application.last_error] : []),
  ];
}

function recordBlockers(record: OperationalRecord): string[] {
  return [
    ...(record.last_error ? [record.last_error] : []),
    ...record.applications.flatMap(applicationBlockers),
  ];
}

function latestActivity(record: OperationalRecord): string {
  const values = [
    record.updated_at,
    ...record.applications.flatMap((application) => [application.updated_at, application.last_synced_at]),
    ...record.communications.flatMap((message) => [message.updated_at, message.message_timestamp, message.created_at]),
  ].filter((value): value is string => Boolean(value));
  const latest = values
    .map((value) => ({ value, time: new Date(value).getTime() }))
    .filter((item) => Number.isFinite(item.time))
    .sort((a, b) => b.time - a.time)[0];
  return latest ? new Date(latest.value).toLocaleString() : "No activity recorded";
}

async function settleWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  task: (item: T) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(Math.max(concurrency, 1), items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      try {
        results[index] = { status: "fulfilled", value: await task(items[index]) };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  });
  await Promise.all(workers);
  return results;
}

async function listAccessibleCoordinationProjectIds(): Promise<Set<string>> {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), 10_000);
  try {
    const { data, error } = await supabase
      .from("coordination_records")
      .select("project_id")
      .abortSignal(controller.signal);
    if (error) throw error;
    return new Set((data ?? []).map((row) => String(row.project_id)));
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

function providerName(record: CoordinationRecord & { providerDisplayName?: string | null }): string {
  const provider = Array.isArray(record.utility_providers)
    ? record.utility_providers[0]
    : record.utility_providers;
  return record.providerDisplayName
    || provider?.display_name
    || provider?.name
    || record.utility_type
    || "Utility";
}

function recordHref(record: CoordinationRecord, tab?: string): string {
  const base = `/uci/records/${encodeURIComponent(record.id)}`;
  return tab ? `${base}?tab=${encodeURIComponent(tab)}` : base;
}

function RecordLink({
  record,
  tab,
  children,
}: {
  record: OperationalRecord;
  tab?: string;
  children?: ReactNode;
}) {
  return (
    <Link className="font-medium text-primary hover:underline" to={recordHref(record, tab)}>
      {children ?? `${record.projectName} · ${providerName(record)}`}
    </Link>
  );
}

function RouteFrame({
  eyebrow,
  title,
  body,
  badge,
  children,
}: {
  eyebrow: string;
  title: string;
  body: string;
  badge: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-6 pb-12">
      <PageHeader
        eyebrow={eyebrow}
        title={title}
        body={body}
        action={<Badge variant="outline">{badge}</Badge>}
      />
      <div className="mx-auto w-full max-w-6xl space-y-6">{children}</div>
    </div>
  );
}

function RouteLoadState({
  loading,
  error,
  loadingText,
  retry,
}: {
  loading: boolean;
  error: string | null;
  loadingText: string;
  retry: () => void;
}) {
  if (loading) {
    return (
      <div className="rounded-lg border bg-card p-5 text-sm text-muted-foreground">
        {loadingText}
      </div>
    );
  }
  if (error) {
    return (
      <AlertBanner
        tone="critical"
        title="This route could not load"
        detail={`${error} Refresh this route to retry.`}
        action={<Button variant="outline" size="sm" onClick={retry}>Retry</Button>}
      />
    );
  }
  return null;
}

function useOperationalRecords(mode: LoadMode, crossProject: boolean) {
  const { projects, loading: projectsLoading, error: projectsError } = useProjects();
  const selectedProject = useSelectedProjectOptional();
  const [searchParams] = useSearchParams();
  const projectId = searchParams.get("projectId") ?? selectedProject?.selectedProjectId ?? null;
  const [records, setRecords] = useState<OperationalRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [partialFailures, setPartialFailures] = useState(0);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (projectsLoading) return;
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      setPartialFailures(0);
      if (projectsError) {
        setRecords([]);
        setError(projectsError);
        setLoading(false);
        return;
      }
      if (!crossProject && !projectId) {
        setRecords([]);
        setLoading(false);
        return;
      }
      try {
        const providerResponse = await listUciProviders().catch(() => null);
        const providersById = new Map(
          (providerResponse?.providers ?? []).map((provider) => [provider.id, provider] as const),
        );
        const coordinationProjectIds = crossProject
          ? await listAccessibleCoordinationProjectIds()
          : null;
        const targets = crossProject
          ? projects.filter((project) => coordinationProjectIds?.has(project.id))
          : projects.filter((project) => project.id === projectId);
        const settled = await settleWithConcurrency(
          targets,
          16,
          async (project) => {
            const coordination = await listProjectCoordination(project.id);
            const portfolio =
              mode === "portfolio"
                ? await getProjectPortfolioView(project.id).catch(() => null)
                : null;
            const attention =
              mode === "attention"
                ? await listProjectNeedsAttentionCommunications(project.id, { limit: 100 }).catch(() => null)
                : null;
            const details =
              mode !== "records"
                ? await settleWithConcurrency(
                    coordination.records,
                    6,
                    (record) => getCoordinationDetail(record.id),
                  )
                : [];
            const detailById = new Map(
              details.flatMap((result) =>
                result.status === "fulfilled"
                  ? [[result.value.record.id, result.value] as const]
                  : [],
              ),
            );
            const operationalRecords = coordination.records.map((record): OperationalRecord => {
              const detail = detailById.get(record.id);
              const portfolioRecord = portfolio?.records.find((item) => item.id === record.id);
              return {
                ...record,
                projectName: project.name,
                providerDisplayName:
                  providersById.get(record.utility_provider_id)?.display_name
                  || providersById.get(record.utility_provider_id)?.name
                  || null,
                applications: detail?.applications ?? [],
                costs: detail?.costs ?? [],
                communications:
                  mode === "attention"
                    ? attention?.communications.filter(
                        (message) => message.coordination_record_id === record.id,
                      ) ?? []
                    : detail?.communications_recent ?? [],
                attentionCount: portfolioRecord?.needs_attention_count ?? 0,
              };
            });
            return {
              records: operationalRecords,
              failures:
                details.filter((result) => result.status === "rejected").length
                + (mode === "portfolio" && portfolio == null ? 1 : 0)
                + (mode === "attention" && attention == null ? 1 : 0),
            };
          },
        );
        if (cancelled) return;
        const failures = settled.filter((result) => result.status === "rejected");
        setPartialFailures(
          (providerResponse == null ? 1 : 0)
            + failures.length
            + settled.reduce(
              (sum, result) => sum + (result.status === "fulfilled" ? result.value.failures : 0),
              0,
            ),
        );
        setRecords(
          settled.flatMap((result) => (result.status === "fulfilled" ? result.value.records : [])),
        );
        if (failures.length === settled.length && settled.length > 0) {
          throw failures[0].reason;
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(formatUciUserError(loadError, "Unable to load route data."));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [crossProject, mode, projectId, projects, projectsError, projectsLoading, reloadKey]);

  return {
    records,
    loading: loading || projectsLoading,
    error,
    partialFailures,
    projectId,
    reload: () => setReloadKey((value) => value + 1),
  };
}

function CoverageNote({ failures }: { failures: number }) {
  return failures > 0 ? (
    <AlertBanner
      tone="warning"
      title="Partial data coverage"
      detail={`${failures} project or record fetch(es) failed. Successfully loaded records remain visible.`}
    />
  ) : null;
}

export function UciSubmissionsPage() {
  const state = useUciOperationalSnapshot("/uci/submissions");
  const rows = state.records.flatMap((record) =>
    record.applications.map((application) => ({ record, application })),
  );
  return (
    <RouteFrame
      eyebrow="Cross-project operations"
      title="Application Queue"
      body="Review real utility application packages and open their record-level preparation workspace."
      badge="Live application data"
    >
      <RouteLoadState {...state} loadingText="Loading application packages…" />
      <CoverageNote failures={state.partialFailures} />
      {!state.loading && !state.error ? (
        <Panel eyebrow="Application preparation" title={`${rows.length} application package row(s)`}>
          <AlertBanner
            tone="default"
            title="Live filing requires confirmation"
            detail="This queue is read-only. Open the record workspace to build, review, or submit a package."
          />
          <div className="mt-4 space-y-3">
            {rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">No application packages exist in accessible UCI records.</p>
            ) : rows.map(({ record, application }) => (
              <div key={application.id} className="grid gap-3 rounded-lg border p-4 md:grid-cols-[minmax(0,1fr)_auto]">
                <div className="space-y-1">
                  <RecordLink record={record} tab="application-prep" />
                  <p className="text-sm">
                    {providerName(record)} · {record.utility_type || "Utility type not recorded"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Package {applicationPackageStatus(application)} · {lifecycleLabel(record)} · {record.current_stage_state}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Last activity {latestActivity(record)}
                  </p>
                  {applicationBlockers(application).length ? (
                    <p className="text-xs text-amber-700">
                      Blockers: {applicationBlockers(application).join("; ")}
                    </p>
                  ) : (
                    <p className="text-xs text-emerald-700">No recorded package blockers.</p>
                  )}
                </div>
                <Button asChild size="sm" variant="outline">
                  <Link to={recordHref(record, "application-prep")}>Open package</Link>
                </Button>
              </div>
            ))}
          </div>
        </Panel>
      ) : null}
    </RouteFrame>
  );
}

export function UciInboxPage() {
  const state = useUciOperationalSnapshot("/uci/inbox");
  const messages = state.records.flatMap((record) =>
    record.communications.map((message) => ({ record, message })),
  );
  return (
    <RouteFrame
      eyebrow="Cross-project operations"
      title="Utility Communications Inbox"
      body="Recent utility messages retain their source project and coordination record."
      badge="Live communications"
    >
      <RouteLoadState {...state} loadingText="Loading utility communications…" />
      <CoverageNote failures={state.partialFailures} />
      {!state.loading && !state.error ? (
        <Panel eyebrow="Coordination messages" title={`${messages.length} recent message(s)`}>
          <div className="space-y-3">
            {messages.length === 0 ? (
              <p className="text-sm text-muted-foreground">No utility communications yet.</p>
            ) : messages.map(({ record, message }) => (
              <div key={message.id} className="rounded-lg border p-3">
                <RecordLink record={record} tab="communications" />
                <p className="mt-1 font-medium">{message.raw_subject || "(no subject)"}</p>
                <p className="text-xs text-muted-foreground">{message.parsed_summary || message.raw_body || "No message summary"}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {providerName(record)} · {record.utility_type || "Utility"} · {message.direction || "direction unknown"} · {message.message_timestamp ? new Date(message.message_timestamp).toLocaleString() : new Date(message.created_at).toLocaleString()}
                </p>
              </div>
            ))}
          </div>
        </Panel>
      ) : null}
    </RouteFrame>
  );
}

export function UciNeedsAttentionPage() {
  const state = useUciOperationalSnapshot("/uci/needs-attention");
  const messages = state.records.flatMap((record) =>
    record.communications.map((message) => ({ record, message })),
  );
  const blockers = state.records.flatMap((record) => {
    const items = recordBlockers(record);
    return items.length ? [{ record, items }] : [];
  });
  const total = messages.length + blockers.reduce((sum, item) => sum + item.items.length, 0);
  return (
    <RouteFrame
      eyebrow="Cross-project operations"
      title="Attention Queue"
      body="Live messages flagged by the needs-attention endpoint for human review."
      badge="Human review required"
    >
      <RouteLoadState {...state} loadingText="Loading needs-attention communications…" />
      <CoverageNote failures={state.partialFailures} />
      {!state.loading && !state.error ? (
        <Panel eyebrow="Operational attention" title={`${total} flagged item(s)`}>
          <div className="space-y-3">
            {total === 0 ? (
              <p className="text-sm text-muted-foreground">No UCI records, messages, or blockers currently need attention.</p>
            ) : null}
            {messages.map(({ record, message }) => (
              <div key={message.id} className="rounded-lg border border-amber-500/30 p-3">
                <RecordLink record={record} tab="communications" />
                <p className="mt-1 font-medium">{message.raw_subject || "(no subject)"}</p>
                <p className="text-xs text-muted-foreground">{message.parsed_summary || message.raw_body || "No summary"}</p>
              </div>
            ))}
            {blockers.map(({ record, items }) => (
              <div key={`blockers-${record.id}`} className="rounded-lg border border-amber-500/30 p-3">
                <RecordLink record={record} tab="application-prep" />
                <p className="mt-1 text-sm font-medium">Recorded blockers</p>
                <ul className="mt-1 list-disc pl-5 text-xs text-muted-foreground">
                  {items.map((item, index) => <li key={`${record.id}-${index}`}>{item}</li>)}
                </ul>
              </div>
            ))}
          </div>
        </Panel>
      ) : null}
    </RouteFrame>
  );
}

export function UciPortfolioPage() {
  const state = useUciOperationalSnapshot("/uci/portfolio");
  return (
    <RouteFrame
      eyebrow="Cross-project operations"
      title="Coordination Portfolio"
      body="Lifecycle status and attention counts for real utility coordination records."
      badge="Live record rollup"
    >
      <RouteLoadState {...state} loadingText="Loading coordination portfolio…" />
      <CoverageNote failures={state.partialFailures} />
      {!state.loading && !state.error ? (
        <Panel eyebrow="Accessible UCI records" title={`${state.records.length} coordination record(s)`}>
          <div className="space-y-3">
            {state.records.length === 0 ? (
              <p className="text-sm text-muted-foreground">No coordination records exist in accessible projects.</p>
            ) : state.records.map((record) => (
              <div key={record.id} className="grid gap-3 rounded-lg border p-4 md:grid-cols-[minmax(0,1fr)_auto]">
                <div className="space-y-1">
                  <RecordLink record={record} />
                  <p className="text-sm">{providerName(record)} · {record.utility_type || "Utility type not recorded"}</p>
                  <p className="text-xs text-muted-foreground">
                    {lifecycleLabel(record)} · {record.current_stage_state} · {record.attentionCount} flagged communication(s)
                  </p>
                  <p className="text-xs text-muted-foreground">Last activity {latestActivity(record)}</p>
                  {recordBlockers(record).length ? (
                    <p className="text-xs text-amber-700">Readiness blockers: {recordBlockers(record).join("; ")}</p>
                  ) : (
                    <p className="text-xs text-emerald-700">No recorded readiness blockers.</p>
                  )}
                </div>
                <Button asChild size="sm" variant="outline">
                  <Link to={recordHref(record)}>Open record</Link>
                </Button>
              </div>
            ))}
          </div>
        </Panel>
      ) : null}
    </RouteFrame>
  );
}

export function UciProviderDirectoryPage() {
  const [providers, setProviders] = useState<UtilityProvider[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void listUciProviders()
      .then((response) => {
        if (!cancelled) setProviders(response.providers);
      })
      .catch((loadError) => {
        if (!cancelled) setError(formatUciUserError(loadError, "Unable to load utility providers."));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return providers;
    return providers.filter((provider) =>
      [provider.display_name, provider.name, provider.canonical_name, provider.utility_type, provider.automation_status]
        .some((value) => String(value ?? "").toLowerCase().includes(needle)),
    );
  }, [providers, query]);
  return (
    <RouteFrame
      eyebrow="Utility reference"
      title="Utility Provider Directory"
      body="Search the live utility provider catalog used by UCI project setup and coordination records."
      badge="Provider API"
    >
      <RouteLoadState loading={loading} error={error} loadingText="Loading utility providers…" retry={() => setReloadKey((value) => value + 1)} />
      {!loading && !error ? (
        <>
          <Panel eyebrow="Provider search" title="Find a provider">
            <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name, utility type, or automation status" />
          </Panel>
          <Panel eyebrow="Live provider catalog" title={`${filtered.length} matching provider(s)`}>
            <div className="grid gap-3 sm:grid-cols-2">
              {filtered.length === 0 ? <p className="text-sm text-muted-foreground">No providers match this search.</p> : filtered.map((provider) => (
                <div key={provider.id} className="rounded-lg border p-3">
                  <p className="font-medium">{provider.display_name || provider.name}</p>
                  <p className="text-xs text-muted-foreground">{provider.utility_type} · {provider.automation_status || "manual"}</p>
                  {provider.portal_url ? <a className="mt-2 inline-block text-xs text-primary hover:underline" href={provider.portal_url} target="_blank" rel="noreferrer">Provider portal</a> : null}
                </div>
              ))}
            </div>
          </Panel>
        </>
      ) : null}
    </RouteFrame>
  );
}

export function UciClassOfServicePage() {
  const state = useOperationalRecords("details", false);
  return (
    <RouteFrame eyebrow="Project operation" title="Class of Service Review" body="Compare advisory analysis with utility-issued COS evidence for the selected project." badge="Real evidence · partial">
      <RouteLoadState {...state} loadingText="Loading class-of-service evidence…" />
      {!state.projectId ? <AlertBanner tone="info" title="Select a project" detail="Choose an active project to review class-of-service evidence." /> : null}
      {!state.loading && !state.error && state.projectId ? (
        <Panel eyebrow="Advisory and issued evidence" title={`${state.records.length} record(s)`}>
          <div className="space-y-3">
            {state.records.length === 0 ? (
              <p className="text-sm text-muted-foreground">No class-of-service evidence exists for this project.</p>
            ) : state.records.map((record) => (
              <div key={record.id} className="rounded-lg border p-3">
                <RecordLink record={record} tab="cos" />
                <p className="text-xs text-muted-foreground">
                  Advisory: {record.metadata?.uci_cos_analysis ? "available" : "not available"} · Utility issued: {record.class_of_service_issued_at || "not evidenced"}
                </p>
              </div>
            ))}
          </div>
        </Panel>
      ) : null}
      <AlertBanner tone="default" title="Coming soon" detail="Portfolio-wide predictive COS comparison remains human-reviewed and is not enabled." />
    </RouteFrame>
  );
}

export function UciCiacRefundsPage() {
  const state = useOperationalRecords("details", false);
  return (
    <RouteFrame eyebrow="Project operation" title="CIAC Costs & Refunds" body="Review real coordination cost rows without inferring refund eligibility." badge="Real costs · partial">
      <RouteLoadState {...state} loadingText="Loading CIAC and coordination costs…" />
      {!state.projectId ? <AlertBanner tone="info" title="Select a project" detail="Choose an active project to review coordination costs." /> : null}
      {!state.loading && !state.error && state.projectId ? (
        <Panel eyebrow="Recorded costs" title="CIAC and utility cost rows">
          <div className="space-y-3">
            {state.records.length === 0 ? (
              <p className="text-sm text-muted-foreground">No CIAC or utility cost records exist for this project.</p>
            ) : state.records.map((record) => (
              <div key={record.id} className="rounded-lg border p-3">
                <RecordLink record={record} tab="costs" />
                <p className="text-xs text-muted-foreground">{record.costs.length} cost row(s): {record.costs.map((cost) => cost.cost_type || "untyped").join(", ") || "none recorded"}</p>
              </div>
            ))}
          </div>
        </Panel>
      ) : null}
      <AlertBanner tone="default" title="Coming soon" detail="Refund eligibility calculations and automatic accounting posting are not enabled." />
    </RouteFrame>
  );
}

export function UciEnergizationPage() {
  const state = useOperationalRecords("records", false);
  return (
    <RouteFrame eyebrow="Project operation" title="Energization & Meter Set" body="Track real energization targets and open meter-set and closeout workspaces." badge="Lifecycle data · partial">
      <RouteLoadState {...state} loadingText="Loading energization records…" />
      {!state.projectId ? <AlertBanner tone="info" title="Select a project" detail="Choose an active project to review energization records." /> : null}
      {!state.loading && !state.error && state.projectId ? (
        <Panel eyebrow="Stages 8–10" title={`${state.records.length} energization record(s)`}>
          <div className="space-y-3">
            {state.records.length === 0 ? (
              <p className="text-sm text-muted-foreground">No energization coordination records exist for this project.</p>
            ) : state.records.map((record) => (
              <div key={record.id} className="rounded-lg border p-3">
                <RecordLink record={record} tab="energization-closeout" />
                <p className="text-xs text-muted-foreground">Stage {record.current_stage} · target {record.energization_target_date || "not set"} · actual {record.energization_actual_date || "not recorded"}</p>
              </div>
            ))}
          </div>
        </Panel>
      ) : null}
      <AlertBanner tone="default" title="Coming soon" detail="Multi-party energization choreography is not yet modeled." />
    </RouteFrame>
  );
}

export function UciKnowledgePage() {
  const state = useOperationalRecords("details", true);
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return state.records;
    return state.records.filter((record) =>
      [record.projectName, providerName(record), record.scope_description, ...record.communications.flatMap((message) => [message.raw_subject, message.parsed_summary, message.raw_body])]
        .some((value) => String(value ?? "").toLowerCase().includes(needle)),
    );
  }, [query, state.records]);
  return (
    <RouteFrame eyebrow="Cross-project history" title="UCI Knowledge Search" body="Search real coordination scopes and recent communication history." badge="Live history · partial">
      <RouteLoadState {...state} loadingText="Loading coordination history…" />
      <CoverageNote failures={state.partialFailures} />
      {!state.loading && !state.error ? (
        <>
          <Panel eyebrow="History search" title="Search coordination evidence">
            <div className="relative">
              <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input className="pl-9" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search projects, providers, scopes, and communications" />
            </div>
          </Panel>
          <Panel eyebrow="Search results" title={`${filtered.length} record(s)`}>
            <div className="space-y-3">
              {filtered.length === 0 ? (
                <p className="text-sm text-muted-foreground">No accessible coordination history matches this search.</p>
              ) : filtered.map((record) => <div key={record.id} className="rounded-lg border p-3"><RecordLink record={record} tab="lifecycle" /><p className="text-xs text-muted-foreground">{record.scope_description || "No scope description"} · {record.communications.length} recent message(s)</p></div>)}
            </div>
          </Panel>
        </>
      ) : null}
      <AlertBanner tone="default" title="Coming soon" detail="Semantic graph indexing is not enabled; results currently use accessible record history." />
    </RouteFrame>
  );
}

export function UciUtilityTerritoryPage() {
  const { projects, loading: projectsLoading, error: projectsError } = useProjects();
  const [rows, setRows] = useState<Array<{ projectName: string; data: UciProviderResolutionListResponse }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  useEffect(() => {
    if (projectsLoading) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    if (projectsError) {
      setRows([]);
      setError(projectsError);
      setLoading(false);
      return;
    }
    void Promise.allSettled(projects.map(async (project) => ({ projectName: project.name, data: await getProjectProviderResolution(project.id) })))
      .then((settled) => {
        if (cancelled) return;
        const successes = settled.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
        setRows(successes);
        if (successes.length === 0 && settled.length > 0) setError("Provider-resolution evidence could not be loaded.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [projects, projectsError, projectsLoading, reloadKey]);
  return (
    <RouteFrame eyebrow="Provider resolution" title="Utility Territory Evidence" body="Real provider-resolution evidence across accessible projects; this is not the municipal jurisdiction map." badge="Resolution API">
      <RouteLoadState loading={loading || projectsLoading} error={error} loadingText="Loading utility territory evidence…" retry={() => setReloadKey((value) => value + 1)} />
      {!loading && !projectsLoading && !error ? (
        <Panel eyebrow="Resolution evidence" title={`${rows.length} project resolution(s)`}>
          <div className="space-y-3">
            {rows.length === 0 ? <p className="text-sm text-muted-foreground">No provider-resolution evidence is available.</p> : rows.map(({ projectName, data }) => (
              <div key={data.project_id} className="rounded-lg border p-3">
                <Link className="font-medium text-primary hover:underline" to={`/uci?projectId=${encodeURIComponent(data.project_id)}`}>{projectName}</Link>
                {Object.entries(data.resolutions).map(([service, resolution]) => <p key={service} className="text-xs text-muted-foreground">{service}: {resolution.status} · {resolution.confidence} confidence · {resolution.resolution_method || "manual"}</p>)}
              </div>
            ))}
          </div>
        </Panel>
      ) : null}
    </RouteFrame>
  );
}

export function UciMissUtilityPage() {
  return (
    <RouteFrame eyebrow="Unavailable capability" title="Miss Utility 811" body="811 ticket filing and synchronization are not enabled in PermitPilot." badge="Not enabled">
      <Panel eyebrow="Capability boundary" title="No connected 811 service">
        <div className="flex gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 text-amber-600" />
          <p className="text-sm text-muted-foreground">PermitPilot does not create, update, or synchronize Miss Utility tickets. No local-only ticket is presented as operational data.</p>
        </div>
      </Panel>
    </RouteFrame>
  );
}

export function UciConflictsPage() {
  return (
    <RouteFrame eyebrow="Unavailable capability" title="Utility Conflict Detection" body="Shared conflict detection and persistence are not enabled." badge="Not enabled">
      <Panel eyebrow="Capability boundary" title="No connected conflict engine">
        <div className="flex gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 text-amber-600" />
          <p className="text-sm text-muted-foreground">Use lifecycle blockers and communications in the coordination record today. This route does not fabricate conflict rows or save browser-local issues.</p>
        </div>
      </Panel>
    </RouteFrame>
  );
}
