import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AlertTriangle, Search } from "lucide-react";
import { toast } from "sonner";
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
import {
  getApplicationPackageDraftApplication,
  parseApplicationPackageMetadata,
} from "@/lib/uciApplicationPrep";
import { supabase } from "@/lib/supabase";
import {
  formatUciUserError,
  getCoordinationDetail,
  getProjectPortfolioView,
  getProjectProviderResolution,
  listProjectCoordination,
  listProjectNeedsAttentionCommunications,
  listSubmissionPreparations,
  listUciProviders,
  prepareSubmissionPackage,
  updateSubmissionPreparation,
  confirmSubmissionPreparation,
  transmitSubmissionPreparation,
  confirmCommunicationReview,
  flagCommunicationForReview,
  type UciEmailReadiness,
  type UciSubmissionPreparationPreview,
  type UciTransmissionAttemptSummary,
} from "@/lib/uciApi";
import {
  formatUciOperatorMessage,
  formatUciPackageVersionLabel,
  formatUciSentSummary,
} from "@/lib/uciCapabilityLabels";
import {
  buildCommunicationCardModel,
  buildInboxAuditHistoryModel,
  communicationNeedsOperatorAttention,
  formatCommunicationSubjectForDisplay,
  groupInboxItemsByThread,
  isSyntheticUatCommunication,
  partitionOperatorInboxFeed,
  type InboxThreadGroup,
} from "@/lib/uciCommunicationPresentation";
import { CommunicationQuickActions } from "@/components/uci/UciD13WorkflowPanels";
import { cn } from "@/lib/utils";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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

function useOperationalCommunicationActions(reload: () => void) {
  const [busyId, setBusyId] = useState<string | null>(null);

  const handleConfirm = async (communicationId: string, classification: string) => {
    setBusyId(communicationId);
    try {
      await confirmCommunicationReview(communicationId, {
        classification,
        apply_lifecycle: true,
      });
      toast.success("Communication confirmed");
      reload();
    } catch (error: unknown) {
      toast.error(formatUciUserError(error, "Confirm review failed"));
    } finally {
      setBusyId(null);
    }
  };

  const handleFlag = async (communicationId: string) => {
    setBusyId(communicationId);
    try {
      await flagCommunicationForReview(communicationId, {
        note: "Flagged for human review from operational queue",
      });
      toast.success("Flagged for human review — auto-lifecycle blocked");
      reload();
    } catch (error: unknown) {
      toast.error(formatUciUserError(error, "Flag for review failed"));
    } finally {
      setBusyId(null);
    }
  };

  return { busyId, handleConfirm, handleFlag };
}

function OperationalCommunicationCard({
  record,
  message,
  reload,
  className,
}: {
  record: OperationalRecord;
  message: CoordinationCommunication;
  reload: () => void;
  className?: string;
}) {
  const { busyId, handleConfirm, handleFlag } = useOperationalCommunicationActions(reload);
  const model = buildCommunicationCardModel(message, {
    providerName: providerName(record),
    record,
  });
  const reasons = model.attentionReasons;
  const workspaceHref = recordHref(record, "communications");

  return (
    <div className={cn("rounded-lg border p-3", className)}>
      <RecordLink record={record} tab="communications" />
      <p className="mt-1 font-medium">{model.title}</p>
      {model.subtitle ? <p className="text-xs text-muted-foreground">{model.subtitle}</p> : null}
      {reasons.length > 0 ? (
        <p className="mt-1 text-xs text-amber-800 dark:text-amber-200">
          Why this needs attention: {reasons[0]}
        </p>
      ) : null}
      {model.detailLine ? (
        <p className="text-xs text-muted-foreground">{model.detailLine}</p>
      ) : (
        <p className="text-xs text-muted-foreground">
          {formatCommunicationSubjectForDisplay(message.raw_subject)}
        </p>
      )}
      <p className="mt-1 text-xs text-muted-foreground">
        {providerName(record)} · {record.utility_type || "Utility"} ·{" "}
        {model.directionLabel || "direction unknown"} ·{" "}
        {message.message_timestamp
          ? new Date(message.message_timestamp).toLocaleString()
          : new Date(message.created_at).toLocaleString()}
      </p>
      <CommunicationQuickActions
        comm={message}
        record={record}
        providerName={providerName(record)}
        busy={busyId === message.id}
        onConfirm={(id, classification) => void handleConfirm(id, classification)}
        onFlagForReview={(id) => void handleFlag(id)}
        toolbarOutlineButtonClass="h-7 text-[11px]"
        workspaceHref={workspaceHref}
      />
    </div>
  );
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

function isTransmissionSent(
  transmission: UciTransmissionAttemptSummary | null | undefined,
): boolean {
  if (!transmission) return false;
  return (
    String(transmission.status || "").toLowerCase() === "sent" || transmission.ok === true
  );
}

function transmissionAttemptList(
  application: CoordinationApplication,
): UciTransmissionAttemptSummary[] {
  const meta = application.agent_draft_metadata as Record<string, unknown> | undefined;
  const history = Array.isArray(meta?.submission_transmission_attempts)
    ? (meta.submission_transmission_attempts as UciTransmissionAttemptSummary[])
    : [];
  const latest =
    meta?.latest_transmission && typeof meta.latest_transmission === "object"
      ? (meta.latest_transmission as UciTransmissionAttemptSummary)
      : null;
  if (!latest) return history;
  const latestId = String(latest.id || latest.transmission_id || "");
  if (!latestId) return history.length > 0 ? history : [latest];
  if (history.some((row) => String(row.id || row.transmission_id || "") === latestId)) {
    return history;
  }
  return [...history, latest];
}

export function UciSubmissionsPage() {
  const state = useUciOperationalSnapshot("/uci/submissions");
  const [searchParams] = useSearchParams();
  const focusCoordinationId = String(searchParams.get("coordinationId") || "").trim();
  const focusApplicationId = String(searchParams.get("applicationId") || "").trim();
  const [prepBusyId, setPrepBusyId] = useState<string | null>(null);
  const [confirmBusyId, setConfirmBusyId] = useState<string | null>(null);
  const [transmitBusyId, setTransmitBusyId] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [connectOutlookHint, setConnectOutlookHint] = useState(false);
  const [emailReadiness, setEmailReadiness] = useState<UciEmailReadiness | null>(null);
  const [prepCache, setPrepCache] = useState<
    Record<string, UciSubmissionPreparationPreview | null>
  >({});
  const [transmissionCache, setTransmissionCache] = useState<
    Record<string, UciTransmissionAttemptSummary | null>
  >({});
  const [historyOpen, setHistoryOpen] = useState<Record<string, boolean>>({});
  const [recipientDraft, setRecipientDraft] = useState<Record<string, string>>({});
  const [pendingTransmit, setPendingTransmit] = useState<{
    applicationId: string;
    preparationId: string;
    to: string;
    from: string;
    subject: string;
    attachmentCount: number;
    synthetic: boolean;
  } | null>(null);

  // One top-level row per coordination application package (not load-profile /
  // portal rows, and not per preparation/transmission attempt).
  const rows = useMemo(() => {
    const out: Array<{ record: OperationalRecord; application: CoordinationApplication }> = [];
    for (const record of state.records) {
      const packageApp =
        getApplicationPackageDraftApplication(record.applications) ||
        record.applications.find((app) => parseApplicationPackageMetadata(app) != null) ||
        null;
      if (!packageApp) continue;
      out.push({ record, application: packageApp });
    }
    return out;
  }, [state.records]);
  const focusedRows = focusCoordinationId
    ? rows.filter(
        ({ record, application }) =>
          record.id === focusCoordinationId &&
          (!focusApplicationId || application.id === focusApplicationId),
      )
    : rows;

  const refreshPreparations = async (applicationId: string) => {
    try {
      const listed = await listSubmissionPreparations(applicationId);
      if (listed.email_readiness) {
        setEmailReadiness(listed.email_readiness);
      }
      setPrepCache((prev) => ({ ...prev, [applicationId]: listed.latest }));
      if (listed.latest_transmission) {
        setTransmissionCache((prev) => ({
          ...prev,
          [applicationId]: listed.latest_transmission ?? null,
        }));
      }
      const to = listed.latest?.to?.[0]?.email;
      if (to) {
        setRecipientDraft((prev) => ({ ...prev, [applicationId]: to }));
      }
    } catch {
      // best-effort until migration applied
    }
  };

  useEffect(() => {
    for (const { application } of focusedRows.slice(0, 12)) {
      void refreshPreparations(application.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.loading, focusCoordinationId, focusApplicationId, focusedRows.length]);

  const runPrepare = async (applicationId: string) => {
    if (prepBusyId) return;
    setPrepBusyId(applicationId);
    setActionMessage(null);
    setConnectOutlookHint(false);
    try {
      const to = recipientDraft[applicationId]?.trim();
      const result = await prepareSubmissionPackage(
        applicationId,
        to ? { to } : undefined,
      );
      setPrepCache((prev) => ({ ...prev, [applicationId]: result }));
      setEmailReadiness({
        live_email_flag_enabled: result.live_email_flag_enabled,
        mail_send_permission_configured: result.mail_send_permission_configured,
        ready_to_send: result.ready_to_send,
        production_readiness_blocker: result.production_readiness_blocker,
        sending_enabled: result.sending_enabled,
      });
      setActionMessage(
        formatUciOperatorMessage(
          result.message,
          "Preparation ready — review the preview, then send when ready.",
        ),
      );
      await refreshPreparations(applicationId);
    } catch (e: unknown) {
      const msg = formatUciOperatorMessage(
        formatUciUserError(e, "Prepare failed"),
        "Prepare failed",
      );
      setActionMessage(msg);
      if (/connect.*outlook|CONNECT_OUTLOOK|mailbox/i.test(msg)) {
        setConnectOutlookHint(true);
      }
    } finally {
      setPrepBusyId(null);
    }
  };

  const saveRecipients = async (applicationId: string, preparationId: string) => {
    const to = recipientDraft[applicationId]?.trim();
    if (!to) {
      setActionMessage("Enter at least one recipient address.");
      return;
    }
    setPrepBusyId(applicationId);
    try {
      const result = await updateSubmissionPreparation(applicationId, preparationId, { to });
      setPrepCache((prev) => ({ ...prev, [applicationId]: result }));
      setActionMessage("Preview updated with recipient(s).");
    } catch (e: unknown) {
      const msg = formatUciOperatorMessage(
        formatUciUserError(e, "Could not update preview"),
        "Could not update preview",
      );
      setActionMessage(msg);
      if (/connect.*outlook|CONNECT_OUTLOOK|mailbox/i.test(msg)) {
        setConnectOutlookHint(true);
      }
    } finally {
      setPrepBusyId(null);
    }
  };

  const requestTransmit = (
    applicationId: string,
    prep: UciSubmissionPreparationPreview,
    synthetic: boolean,
  ) => {
    const to = recipientDraft[applicationId]?.trim();
    if (!to) {
      setActionMessage("Enter an explicit recipient address before sending.");
      return;
    }
    setPendingTransmit({
      applicationId,
      preparationId: prep.preparation_id,
      to,
      from: String(prep.from || ""),
      subject: String(prep.subject || ""),
      attachmentCount: Array.isArray(prep.attachments) ? prep.attachments.length : 0,
      synthetic,
    });
  };

  const runTransmit = async () => {
    if (!pendingTransmit || transmitBusyId) return;
    const { applicationId, preparationId, to, synthetic } = pendingTransmit;
    setPendingTransmit(null);
    setTransmitBusyId(applicationId);
    setActionMessage(null);
    try {
      const currentPrep = prepCache[applicationId];
      if (currentPrep && currentPrep.status !== "confirmed_for_transmission") {
        setConfirmBusyId(applicationId);
        const confirmed = await confirmSubmissionPreparation(applicationId, preparationId, {
          to,
          idempotency_key: `ui-confirm:${preparationId}`,
        });
        setPrepCache((prev) => ({ ...prev, [applicationId]: confirmed }));
        setEmailReadiness({
          live_email_flag_enabled: confirmed.live_email_flag_enabled,
          mail_send_permission_configured: confirmed.mail_send_permission_configured,
          ready_to_send: confirmed.ready_to_send,
          production_readiness_blocker: confirmed.production_readiness_blocker,
          sending_enabled: confirmed.sending_enabled,
        });
        setConfirmBusyId(null);
      }

      const result = await transmitSubmissionPreparation(applicationId, preparationId, {
        to,
        idempotency_key: `ui-transmit:${preparationId}`,
        confirm_send: true,
      });
      setTransmissionCache((prev) => ({ ...prev, [applicationId]: result }));
      const fromAddr = String(result.from || result.sender_mailbox || "—");
      const outcome =
        result.status === "sent" || result.ok
          ? formatUciSentSummary({
              completedAt: result.completed_at || new Date().toISOString(),
              from: fromAddr,
              to,
              attachmentCount: result.attachment_count ?? 0,
            })
          : formatUciOperatorMessage(
              result.message,
              `Send ${result.status || "failed"}`,
            );
      setActionMessage(outcome);
      await refreshPreparations(applicationId);
      if (!synthetic) {
        await state.reload?.();
      }
    } catch (e: unknown) {
      setConfirmBusyId(null);
      setActionMessage(
        formatUciOperatorMessage(formatUciUserError(e, "Send failed"), "Send failed"),
      );
    } finally {
      setTransmitBusyId(null);
    }
  };

  const anyBusy = Boolean(prepBusyId || confirmBusyId || transmitBusyId);
  const mailSendOk = emailReadiness?.mail_send_permission_configured === true;
  const liveFlagOn = emailReadiness?.live_email_flag_enabled === true;
  const readyToSend = emailReadiness?.ready_to_send === true || (mailSendOk && liveFlagOn);

  return (
    <RouteFrame
      eyebrow="Stage 4 · Submission and Confirmation Tracker"
      title="Submission and Confirmation Tracker"
      body="Reviewed packages: prepare an email preview from your connected Outlook, then send explicitly. Nothing is sent until you confirm."
      badge="Prepare · Preview · Send"
    >
      <RouteLoadState {...state} loadingText="Loading submission tracker…" />
      <CoverageNote failures={state.partialFailures} />
      {!state.loading && !state.error ? (
        <Panel
          eyebrow="Submission journey"
          title={`${focusedRows.length} package${focusedRows.length === 1 ? "" : "s"}${focusCoordinationId ? " · focused record" : ""}`}
        >
          {!mailSendOk ? (
            <AlertBanner
              tone="warn"
              title="Email sending unavailable"
              detail="Connect or reconnect Outlook in Settings so your mailbox can send email."
            />
          ) : !liveFlagOn ? (
            <AlertBanner
              tone="warn"
              title="Email sending is not enabled"
              detail="Your mailbox is connected, but sending is turned off in this environment."
            />
          ) : null}
          {connectOutlookHint ? (
            <div className="mt-3 rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-sm">
              <p className="font-medium">Connect Outlook to continue</p>
              <p className="text-xs text-muted-foreground mt-1">
                Email preparation needs your Microsoft 365 mailbox linked in Settings.
              </p>
              <Button asChild size="sm" className="mt-2" variant="outline">
                <Link to="/settings">Connect Outlook</Link>
              </Button>
            </div>
          ) : null}
          {actionMessage ? (
            <p className="mt-3 text-sm text-muted-foreground">{actionMessage}</p>
          ) : null}
          <div className="mt-4 space-y-4">
            {focusedRows.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No application packages match this tracker view.
              </p>
            ) : (
              focusedRows.map(({ record, application }) => {
                const meta = application.agent_draft_metadata as
                  | Record<string, unknown>
                  | undefined;
                const prep = prepCache[application.id];
                const transmission =
                  transmissionCache[application.id] ||
                  (meta?.latest_transmission && typeof meta.latest_transmission === "object"
                    ? (meta.latest_transmission as UciTransmissionAttemptSummary)
                    : null);
                const isReviewed = application.draft_status === "reviewed";
                const synthetic =
                  String(application.provider_slug || "").toLowerCase() === "dominion" &&
                  String(
                    (parseApplicationPackageMetadata(application) as { checklist_mode?: string } | null)
                      ?.checklist_mode || "",
                  ) === "synthetic_test";
                const confirmed = prep?.status === "confirmed_for_transmission";
                const packageReady = prep?.ready_to_send === true || readyToSend;
                const prepSent = Boolean(
                  prep &&
                    transmission &&
                    String(transmission.preparation_id || "") === String(prep.preparation_id) &&
                    isTransmissionSent(transmission),
                );
                const priorSent =
                  isTransmissionSent(transmission) && !prepSent;
                const attachmentCount = Array.isArray(prep?.attachments)
                  ? prep.attachments.length
                  : transmission?.attachment_count ?? 0;
                const toEditable = Boolean(prep && !prepSent);
                const transmissionLabel = prepSent
                  ? "Sent"
                  : confirmed
                    ? packageReady
                      ? "Ready to send"
                      : "Prepared"
                    : prep
                      ? "Prepared"
                      : priorSent
                        ? "Sent (prior)"
                        : "Not prepared";
                const providerConfirmation = application.submitted_at
                  ? "Submitted"
                  : "Not submitted";
                const sentSummary = transmission
                  ? formatUciSentSummary({
                      completedAt: transmission.completed_at || transmission.claimed_at,
                      from:
                        transmission.from ||
                        transmission.sender_mailbox ||
                        prep?.from ||
                        null,
                      to:
                        transmission.to ||
                        transmission.to_recipients ||
                        recipientDraft[application.id] ||
                        null,
                      attachmentCount: transmission.attachment_count ?? attachmentCount,
                    })
                  : null;
                const attempts = (() => {
                  const fromMeta = transmissionAttemptList(application);
                  const cached = transmissionCache[application.id];
                  if (!cached) return fromMeta;
                  const cachedId = String(cached.id || cached.transmission_id || "");
                  if (
                    !cachedId ||
                    fromMeta.some(
                      (row) => String(row.id || row.transmission_id || "") === cachedId,
                    )
                  ) {
                    return fromMeta;
                  }
                  return [...fromMeta, cached];
                })()
                  .slice()
                  .sort((a, b) => {
                    const aAt = Date.parse(String(a.completed_at || a.claimed_at || "")) || 0;
                    const bAt = Date.parse(String(b.completed_at || b.claimed_at || "")) || 0;
                    return bAt - aAt;
                  });
                const sentAttempts = attempts.filter(isTransmissionSent);
                const currentPrepId = prep ? String(prep.preparation_id) : "";
                const displayHistory = sentAttempts.filter((row) => {
                  // Current open prep that itself was sent → keep that attempt on the primary row.
                  if (
                    prepSent &&
                    currentPrepId &&
                    String(row.preparation_id || "") === currentPrepId
                  ) {
                    return false;
                  }
                  // Otherwise every sent attempt is history (including last send while a new prep is open).
                  return true;
                });
                const historyCount = displayHistory.length;
                const historyExpanded = historyOpen[application.id] === true;

                return (
                  <div key={`${record.id}:${application.id}`} className="space-y-3 rounded-lg border p-4">
                    <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
                      <div className="space-y-1">
                        <RecordLink record={record} tab="application-prep" />
                        <p className="text-sm">
                          {providerName(record)} · {record.utility_type || "Utility type not recorded"}
                        </p>
                        <p className="text-xs">
                          Transmission:{" "}
                          <span
                            className={
                              prepSent || priorSent
                                ? "font-semibold text-emerald-800 dark:text-emerald-200"
                                : "font-semibold"
                            }
                          >
                            {transmissionLabel}
                          </span>
                          {" · "}
                          Provider confirmation:{" "}
                          <span className="font-semibold">{providerConfirmation}</span>
                        </p>
                        {prepSent && sentSummary ? (
                          <p className="text-xs text-emerald-900 dark:text-emerald-100">
                            Current · {sentSummary}
                          </p>
                        ) : null}
                        {priorSent && sentSummary ? (
                          <p className="text-xs text-muted-foreground">
                            Last sent · {sentSummary.replace(/^Sent\s+/i, "")}
                          </p>
                        ) : null}
                        {synthetic ? (
                          <p className="text-xs font-semibold text-amber-800 dark:text-amber-200">
                            SYNTHETIC TEST — NO EXTERNAL SUBMISSION
                          </p>
                        ) : null}
                      </div>
                      <div className="flex flex-col gap-2">
                        <Button asChild size="sm" variant="outline">
                          <Link to={recordHref(record, "application-prep")}>Open package</Link>
                        </Button>
                        {prepSent ? (
                          <Button
                            size="sm"
                            disabled={!isReviewed || anyBusy}
                            onClick={() => void runPrepare(application.id)}
                          >
                            {prepBusyId === application.id
                              ? "Preparing…"
                              : synthetic
                                ? "Send another test"
                                : "Create new transmission"}
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            disabled={!isReviewed || anyBusy || confirmed}
                            onClick={() => void runPrepare(application.id)}
                          >
                            {prepBusyId === application.id ? "Preparing…" : "Prepare submission"}
                          </Button>
                        )}
                      </div>
                    </div>

                    {prep && !prepSent ? (
                      <div className="space-y-2 rounded-md border bg-muted/20 p-3 text-xs">
                        <p className="font-semibold text-sm text-foreground">Email preview</p>
                        <p>
                          From:{" "}
                          <span className="font-semibold text-foreground">
                            {prep.from || "(connect Outlook)"}
                          </span>
                          {prep.sender_mailbox_verified ? " · verified" : ""}
                        </p>
                        <p>
                          Provider: {String(prep.provider || "—")} · Project:{" "}
                          {String(prep.project_name || "—")}
                        </p>
                        <p>
                          Package:{" "}
                          <span className="text-foreground">
                            {formatUciPackageVersionLabel(
                              prep.package_version || "agent-3-reviewed-package-snapshot-v1",
                            )}
                          </span>
                        </p>
                        <p>Subject: {String(prep.subject || "—")}</p>
                        <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded border bg-background p-2 text-[11px] text-muted-foreground">
                          {String(prep.body || "")}
                        </pre>
                        <div>
                          <p className="font-medium text-foreground">
                            Attachments ({attachmentCount})
                          </p>
                          <ul className="mt-1 list-disc pl-4">
                            {(prep.attachments || []).map((doc, idx) => (
                              <li key={`${String(doc.key ?? "a")}-${idx}`}>
                                {String(doc.label || doc.key || "document")}
                                {doc.file_name ? ` · ${String(doc.file_name)}` : ""}
                              </li>
                            ))}
                          </ul>
                        </div>
                        <div className="space-y-1 pt-1">
                          <label className="text-foreground" htmlFor={`to-${application.id}`}>
                            To (required — explicit recipient)
                          </label>
                          <Input
                            id={`to-${application.id}`}
                            value={recipientDraft[application.id] ?? ""}
                            onChange={(e) =>
                              setRecipientDraft((prev) => ({
                                ...prev,
                                [application.id]: e.target.value,
                              }))
                            }
                            placeholder="utility-test@example.com"
                            disabled={!toEditable || anyBusy}
                            className="max-w-md"
                          />
                        </div>
                        <div className="flex flex-wrap gap-2 pt-1">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={anyBusy || !toEditable}
                            onClick={() =>
                              void saveRecipients(application.id, prep.preparation_id)
                            }
                          >
                            Update preview
                          </Button>
                          {packageReady ? (
                            <Button
                              size="sm"
                              disabled={anyBusy}
                              onClick={() =>
                                requestTransmit(application.id, prep, synthetic)
                              }
                            >
                              {transmitBusyId === application.id
                                ? "Sending…"
                                : synthetic
                                  ? "Send test email"
                                  : "Send submission"}
                            </Button>
                          ) : prep.production_readiness_blocker ? (
                            <div className="w-full rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-950 dark:text-amber-100">
                              <p className="font-semibold">
                                {formatUciOperatorMessage(
                                  prep.production_readiness_blocker,
                                  "Email sending is not available.",
                                )}
                              </p>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    ) : null}

                    {prepSent ? (
                      <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-950 dark:text-emerald-100">
                        <p className="font-medium">{sentSummary}</p>
                        <p className="mt-1 text-muted-foreground">
                          This transmission stays on record. Use{" "}
                          {synthetic ? "Send another test" : "Create new transmission"} for a new
                          preview and send.
                        </p>
                      </div>
                    ) : null}

                    {historyCount > 0 ? (
                      <div className="rounded-md border px-3 py-2 text-xs">
                        <button
                          type="button"
                          className="flex w-full items-center justify-between text-left font-medium text-foreground"
                          onClick={() =>
                            setHistoryOpen((prev) => ({
                              ...prev,
                              [application.id]: !historyExpanded,
                            }))
                          }
                        >
                          <span>Transmission history ({historyCount})</span>
                          <span className="text-muted-foreground">
                            {historyExpanded ? "Hide" : "Show"}
                          </span>
                        </button>
                        {historyExpanded ? (
                          <ul className="mt-2 space-y-2 border-t pt-2 text-muted-foreground">
                            {displayHistory.map((row, idx) => {
                              const summary = formatUciSentSummary({
                                completedAt: row.completed_at || row.claimed_at,
                                from: row.from || row.sender_mailbox || null,
                                to: row.to || row.to_recipients || null,
                                attachmentCount: row.attachment_count ?? 0,
                              });
                              return (
                                <li key={String(row.id || row.transmission_id || idx)}>
                                  {summary}
                                </li>
                              );
                            })}
                          </ul>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                );
              })
            )}
          </div>
        </Panel>
      ) : null}

      <AlertDialog
        open={Boolean(pendingTransmit)}
        onOpenChange={(open) => {
          if (!open) setPendingTransmit(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Send this email?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>This sends the previewed message and attachments from your connected mailbox.</p>
                {pendingTransmit ? (
                  <ul className="list-disc pl-4 text-foreground">
                    <li>From: {pendingTransmit.from || "—"}</li>
                    <li>To: {pendingTransmit.to}</li>
                    <li>Subject: {pendingTransmit.subject || "—"}</li>
                    <li>Attachments: {pendingTransmit.attachmentCount}</li>
                    {pendingTransmit.synthetic ? (
                      <li>SYNTHETIC TEST — self-send only</li>
                    ) : null}
                  </ul>
                ) : null}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void runTransmit()}>
              Confirm send
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </RouteFrame>
  );
}

function InboxAuditHistoryCard({
  record,
  message,
}: {
  record: OperationalRecord;
  message: CoordinationCommunication;
}) {
  const audit = buildInboxAuditHistoryModel(message, record);
  return (
    <div className="rounded-lg border border-dashed p-3">
      <RecordLink record={record} tab="communications" />
      <p className="mt-1 text-sm font-medium">
        Synthetic UAT · {formatCommunicationSubjectForDisplay(message.raw_subject)}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">{audit.detailLine}</p>
      <p className="mt-1 text-[11px] text-muted-foreground">
        Kept for audit — not deleted. Open the coordination record for full message history.
      </p>
    </div>
  );
}

function InboxThreadCard({
  group,
  reload,
}: {
  group: InboxThreadGroup<OperationalRecord>;
  reload: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const older = group.messages.slice(1);
  return (
    <div className="space-y-2">
      <OperationalCommunicationCard
        record={group.record}
        message={group.latest}
        reload={reload}
      />
      {group.messages.length > 1 ? (
        <div className="pl-3">
          <button
            type="button"
            className="text-xs text-muted-foreground underline-offset-2 hover:underline"
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? "Hide" : "Show"} {group.messages.length - 1} earlier message
            {group.messages.length - 1 === 1 ? "" : "s"} in this conversation
            {group.threadId ? " (thread)" : ""}
          </button>
          {expanded
            ? older.map((message) => (
                <div key={message.id} className="mt-2 rounded-md border bg-muted/20 p-2">
                  <p className="text-xs font-medium">
                    {formatCommunicationSubjectForDisplay(message.raw_subject)}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {message.message_timestamp
                      ? new Date(message.message_timestamp).toLocaleString()
                      : new Date(message.created_at).toLocaleString()}
                    {message.classification
                      ? ` · ${message.classification.replace(/_/g, " ")}`
                      : ""}
                  </p>
                </div>
              ))
            : null}
        </div>
      ) : null}
    </div>
  );
}

export function UciInboxPage() {
  const state = useUciOperationalSnapshot("/uci/inbox");
  const messages = state.records.flatMap((record) =>
    record.communications.map((message) => ({ record, message })),
  );
  const { primary, auditHistory } = useMemo(
    () => partitionOperatorInboxFeed(messages),
    [messages],
  );
  const primaryThreads = useMemo(() => groupInboxItemsByThread(primary), [primary]);
  const actionableSyntheticCount = primary.filter(({ message }) =>
    isSyntheticUatCommunication(message),
  ).length;

  return (
    <RouteFrame
      eyebrow="Cross-project operations"
      title="Utility Communications Inbox"
      body="Live utility messages stay in the primary feed (grouped by conversation thread when available). Resolved synthetic UAT items move to Test / Audit history — records are never deleted."
      badge="Live communications"
    >
      <RouteLoadState {...state} loadingText="Loading utility communications…" />
      <CoverageNote failures={state.partialFailures} />
      {!state.loading && !state.error ? (
        <div className="space-y-6">
          <Panel
            eyebrow="Operator inbox"
            title={`${primaryThreads.length} conversation(s) · ${primary.length} message(s)`}
          >
            <div className="space-y-3">
              {primary.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No active utility communications. Resolved synthetic UAT items appear under Test /
                  Audit history below.
                </p>
              ) : (
                primaryThreads.map((group) => (
                  <InboxThreadCard key={group.key} group={group} reload={state.reload} />
                ))
              )}
              {actionableSyntheticCount > 0 ? (
                <p className="text-xs text-muted-foreground">
                  {actionableSyntheticCount} synthetic test item
                  {actionableSyntheticCount === 1 ? "" : "s"} remain visible because operator
                  action is still required.
                </p>
              ) : null}
            </div>
          </Panel>
          {auditHistory.length > 0 ? (
            <Panel
              eyebrow="Test / Audit history"
              title={`${auditHistory.length} synthetic UAT message(s)`}
            >
              <p className="mb-3 text-xs text-muted-foreground">
                Controlled Stage 5 / synthetic test emails that no longer need operator action.
                Listed separately with ticket, time, and result — not merged, not deleted.
              </p>
              <div className="space-y-3">
                {auditHistory.map(({ record, message }) => (
                  <InboxAuditHistoryCard key={message.id} record={record} message={message} />
                ))}
              </div>
            </Panel>
          ) : null}
        </div>
      ) : null}
    </RouteFrame>
  );
}

export function UciNeedsAttentionPage() {
  const state = useUciOperationalSnapshot("/uci/needs-attention");
  // Defense-in-depth: backend snapshot should already be actionable-only; re-filter so
  // cards never show "not operator attention" while remaining in this queue.
  const messages = state.records.flatMap((record) =>
    record.communications
      .filter((message) => communicationNeedsOperatorAttention(message, record))
      .map((message) => ({ record, message })),
  );
  const blockers = state.records.flatMap((record) => {
    const items = recordBlockers(record);
    return items.length ? [{ record, items }] : [];
  });
  const blockerCount = blockers.reduce((sum, item) => sum + item.items.length, 0);
  const total = messages.length + blockerCount;
  return (
    <RouteFrame
      eyebrow="Cross-project operations"
      title="Attention Queue"
      body="Actionable unresolved utility communications and application readiness items that need operator review."
      badge="Human review required"
    >
      <RouteLoadState {...state} loadingText="Loading needs-attention communications…" />
      <CoverageNote failures={state.partialFailures} />
      {!state.loading && !state.error ? (
        <div className="space-y-6">
          {total === 0 ? (
            <Panel eyebrow="Operational attention" title="Nothing flagged">
              <p className="text-sm text-muted-foreground">
                No UCI records, messages, or blockers currently need attention.
              </p>
            </Panel>
          ) : null}
          {messages.length > 0 ? (
            <Panel
              eyebrow="Utility communications"
              title={`${messages.length} message(s) needing attention`}
            >
              <div className="space-y-3">
                {messages.map(({ record, message }) => (
                  <OperationalCommunicationCard
                    key={message.id}
                    record={record}
                    message={message}
                    reload={state.reload}
                    className="border-amber-500/30"
                  />
                ))}
              </div>
            </Panel>
          ) : null}
          {blockers.length > 0 ? (
            <Panel
              eyebrow="Application / package readiness"
              title={`${blockerCount} readiness blocker(s)`}
            >
              <div className="space-y-3">
                {blockers.map(({ record, items }) => (
                  <div
                    key={`blockers-${record.id}`}
                    className="rounded-lg border border-amber-500/30 p-3"
                  >
                    <RecordLink record={record} tab="application-prep" />
                    <p className="mt-1 text-sm font-medium">Recorded blockers</p>
                    <ul className="mt-1 list-disc pl-5 text-xs text-muted-foreground">
                      {items.map((item, index) => (
                        <li key={`${record.id}-${index}`}>{item}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </Panel>
          ) : null}
        </div>
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
    <RouteFrame eyebrow="Project operation" title="Design Review / Class of Service" body="Compare verified project inputs with utility-issued COS evidence. Advisory predictions are never treated as issued." badge="Real evidence · Stage 6">
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
                  Advisory: {record.metadata?.uci_cos_analysis ? "available" : "not available"} · Utility issued: {record.class_of_service_issued_at || "not evidenced"} · Stage 7 eligible: {Number(record.current_stage) === 6 && String(record.current_stage_state) === "COMPLETED" && record.class_of_service_issued_at ? "yes" : "no"}
                </p>
              </div>
            ))}
          </div>
        </Panel>
      ) : null}
      <AlertBanner tone="default" title="Predictive COS remains advisory" detail="Portfolio-wide predictive COS comparison is not treated as utility-issued evidence." />
    </RouteFrame>
  );
}

export function UciCiacRefundsPage() {
  const state = useOperationalRecords("details", false);
  return (
    <RouteFrame eyebrow="Project operation" title="CIAC Costs & Refunds" body="Opens the Costs & long-lead workspace for real CIAC rows. Refund eligibility is not a required product." badge="Deep-link · costs tab">
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
      <AlertBanner tone="default" title="Refunds are not required" detail="Use the Costs & long-lead tab to approve, pay, and bill CIAC. Refund and deposit workflows are out of scope." />
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
        <Panel eyebrow="Stages 9–10" title={`${state.records.length} energization record(s)`}>
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
      <AlertBanner tone="default" title="Use the record workspace" detail="Inspection release, meter-set choreography, and closeout PDF live on the Energization & closeout tab." />
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
