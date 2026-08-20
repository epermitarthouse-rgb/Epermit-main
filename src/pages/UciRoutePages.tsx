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
  buildInboxConversationCardModel,
  communicationNeedsOperatorAttention,
  conciseCommunicationSummary,
  formatCommunicationSubjectForDisplay,
  formatDirectionLabel,
  formatOperatorTimelineWhen,
  groupInboxItemsByThread,
  isSyntheticUatCommunication,
  listCommunicationAttachmentLabels,
  partitionOperatorInboxFeed,
  type InboxThreadGroup,
} from "@/lib/uciCommunicationPresentation";
import {
  formatConservativeP90Chip,
  formatTypicalP50Chip,
  formatUciLifecycleStateLabel,
  getLifecycleStageTitle,
} from "@/lib/uciWorkspaceGuidance";
import {
  furthestStageLabel,
  groupPortfolioByProject,
  listRecordOperatorAttentionItems,
  matchesPortfolioFilter,
  portfolioFilterLabel,
  type PortfolioFilter,
} from "@/lib/uciPortfolioPresentation";
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
  surface = "inbox",
}: {
  record: OperationalRecord;
  message: CoordinationCommunication;
  reload: () => void;
  className?: string;
  surface?: "inbox" | "needs-attention" | "workspace";
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
          {reasons[0]}
        </p>
      ) : null}
      {reasons.length > 1 ? (
        <ul className="mt-1 list-disc pl-4 text-[11px] text-muted-foreground">
          {reasons.slice(1).map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
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
        onFlagForReview={surface === "needs-attention" ? undefined : (id) => void handleFlag(id)}
        toolbarOutlineButtonClass="h-7 text-[11px]"
        workspaceHref={workspaceHref}
        surface={surface}
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
          ) : liveFlagOn ? (
            <AlertBanner
              tone="warn"
              title="LIVE EMAIL SEND is enabled"
              detail="Send submission uses the connected Outlook mailbox. Synthetic test send is limited to the controlled recipient on the preview."
            />
          ) : (
            <AlertBanner
              tone="warn"
              title="Email sending is not enabled"
              detail="Your mailbox is connected, but sending is turned off in this environment."
            />
          )}
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
            <AlertDialogTitle>
              {liveFlagOn ? "LIVE EMAIL SEND" : "Send this email?"}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">
                {liveFlagOn ? (
                  <p className="font-semibold text-amber-800 dark:text-amber-200">
                    Live email sending is ON in this environment. Confirming sends from the connected Outlook mailbox.
                  </p>
                ) : (
                  <p>This sends the previewed message and attachments from your connected mailbox.</p>
                )}
                {pendingTransmit ? (
                  <ul className="list-disc pl-4 text-foreground">
                    <li>From: {pendingTransmit.from || "—"}</li>
                    <li>To: {pendingTransmit.to}</li>
                    <li>Subject: {pendingTransmit.subject || "—"}</li>
                    <li>Attachments: {pendingTransmit.attachmentCount}</li>
                    {pendingTransmit.synthetic ? (
                      <li>SYNTHETIC TEST — controlled recipient only</li>
                    ) : (
                      <li>Production recipient — not a synthetic test send</li>
                    )}
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
  const { busyId, handleConfirm, handleFlag } = useOperationalCommunicationActions(reload);
  const model = buildInboxConversationCardModel(group, {
    projectName: group.record.projectName,
    providerName: providerName(group.record),
    record: group.record,
  });
  const workspaceHref = recordHref(group.record, "communications");
  const actionTone =
    model.actionState === "action_required"
      ? "border-amber-500/40 bg-amber-500/5"
      : model.actionState === "resolved"
        ? "border-border/60"
        : "border-border";

  return (
    <div className={cn("rounded-lg border p-4", actionTone)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <RecordLink record={group.record} tab="communications">
              {model.projectName}
            </RecordLink>
            <Badge variant="outline" className="text-[10px] font-medium">
              {model.actionStateLabel}
            </Badge>
            {model.showMessageCount ? (
              <Badge variant="secondary" className="text-[10px] font-normal">
                {model.messageCount} messages
              </Badge>
            ) : null}
          </div>
          <p className="text-sm text-muted-foreground">{model.providerName}</p>
          <p className="font-medium">{model.subject}</p>
          <p className="text-xs text-muted-foreground">{model.category}</p>
          {model.summary ? (
            <p className="text-sm leading-snug text-foreground">{model.summary}</p>
          ) : null}
          {model.attentionReasons[0] ? (
            <p className="text-xs text-amber-800 dark:text-amber-200">{model.attentionReasons[0]}</p>
          ) : null}
          <p className="text-xs text-muted-foreground">{model.timestampLabel}</p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? "Hide thread" : "Open thread"}
        </Button>
      </div>
      {expanded ? (
        <ol className="mt-3 space-y-3 border-t pt-3">
          {model.chronological.map((message) => {
            const attachments = listCommunicationAttachmentLabels(message);
            return (
              <li key={message.id} className="rounded-md border bg-background/70 p-3">
                <p className="text-xs font-medium">
                  {message.sender || "Unknown sender"} ·{" "}
                  {formatOperatorTimelineWhen(message.message_timestamp || message.created_at)}
                  {formatDirectionLabel(message.direction)
                    ? ` · ${formatDirectionLabel(message.direction)}`
                    : ""}
                </p>
                <p className="mt-1 text-sm">
                  {formatCommunicationSubjectForDisplay(message.raw_subject)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {message.classification
                    ? message.classification.replace(/_/g, " ")
                    : "Unclassified"}
                </p>
                {conciseCommunicationSummary(message) ? (
                  <p className="mt-1 text-sm">{conciseCommunicationSummary(message)}</p>
                ) : null}
                {attachments.length > 0 ? (
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Attachments: {attachments.join(", ")}
                  </p>
                ) : null}
                <CommunicationQuickActions
                  comm={message}
                  record={group.record}
                  providerName={providerName(group.record)}
                  busy={busyId === message.id}
                  onConfirm={(id, classification) => void handleConfirm(id, classification)}
                  onFlagForReview={(id) => void handleFlag(id)}
                  toolbarOutlineButtonClass="h-7 text-[11px]"
                  workspaceHref={workspaceHref}
                  surface="inbox"
                />
              </li>
            );
          })}
        </ol>
      ) : (
        <CommunicationQuickActions
          comm={group.latest}
          record={group.record}
          providerName={providerName(group.record)}
          busy={busyId === group.latest.id}
          onConfirm={(id, classification) => void handleConfirm(id, classification)}
          onFlagForReview={(id) => void handleFlag(id)}
          toolbarOutlineButtonClass="h-7 text-[11px]"
          workspaceHref={workspaceHref}
          surface="inbox"
        />
      )}
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
      body="One card per conversation. Open a thread for chronological messages, attachments, and classification. Resolved synthetic UAT items move to Test / Audit history — records are never deleted."
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
  const messages = state.records.flatMap((record) =>
    record.communications
      .filter((message) => communicationNeedsOperatorAttention(message, record))
      .map((message) => ({ record, message })),
  );
  const recordItems = state.records.flatMap((record) => {
    const fromSnapshot = (record.recordAttention ?? []).map((item) => ({
      record,
      reason: item.label,
      tab: "overview" as const,
      id: `${record.id}:${item.code}`,
    }));
    const fromMeta = listRecordOperatorAttentionItems(record).map((item) => ({
      record: item.record,
      reason: item.reason,
      tab: item.tab,
      id: item.id,
    }));
    const merged = [...fromSnapshot, ...fromMeta];
    const seen = new Set<string>();
    return merged.filter((item) => {
      const key = `${item.record.id}:${item.reason}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  });
  const blockers = state.records.flatMap((record) => {
    if (String(record.current_stage_state) === "COMPLETED") return [];
    const items = recordBlockers(record).filter((item) => {
      const lower = item.toLowerCase();
      if (lower.includes("no recorded") || lower.includes("not operator")) return false;
      return true;
    });
    return items.length ? [{ record, items }] : [];
  });
  const blockerCount = blockers.reduce((sum, item) => sum + item.items.length, 0);
  const total = messages.length + recordItems.length + blockerCount;
  return (
    <RouteFrame
      eyebrow="Cross-project operations"
      title="Attention Queue"
      body="Unresolved actionable items only — communications, COS/capacity, CIAC, ETA, and meter-set issues. Resolved synthetic UAT and outbound transmissions stay out of this queue."
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
                    surface="needs-attention"
                  />
                ))}
              </div>
            </Panel>
          ) : null}
          {recordItems.length > 0 ? (
            <Panel
              eyebrow="Record attention"
              title={`${recordItems.length} record item(s)`}
            >
              <div className="space-y-3">
                {recordItems.map((item) => (
                  <div
                    key={item.id}
                    className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-amber-500/30 p-3"
                  >
                    <div>
                      <RecordLink record={item.record} tab={item.tab} />
                      <p className="mt-1 text-sm font-medium">{item.reason}</p>
                      <p className="text-xs text-muted-foreground">
                        {providerName(item.record)} · {lifecycleLabel(item.record)} ·{" "}
                        {item.record.current_stage_state}
                      </p>
                    </div>
                    <Button asChild size="sm" variant="outline">
                      <Link to={recordHref(item.record, item.tab)}>Open record</Link>
                    </Button>
                  </div>
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
  const [filter, setFilter] = useState<PortfolioFilter>("active");
  const groups = useMemo(() => groupPortfolioByProject(state.records), [state.records]);
  const visible = groups.filter((group) => matchesPortfolioFilter(group, filter));
  const uniqueProjects = groups.length;
  const testCount = groups.filter((group) => group.isTestOrArchive).length;
  return (
    <RouteFrame
      eyebrow="Cross-project operations"
      title="Coordination Portfolio"
      body="Projects are the primary unit. Nested utilities stay visible — Highland water, gas, sewer, and telecom records are not hidden. Test and archive projects are filtered out of Active."
      badge="Project rollup"
    >
      <RouteLoadState {...state} loadingText="Loading coordination portfolio…" />
      <CoverageNote failures={state.partialFailures} />
      {!state.loading && !state.error ? (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {(["active", "needs_attention", "completed", "archived_test"] as PortfolioFilter[]).map(
              (value) => (
                <Button
                  key={value}
                  size="sm"
                  variant={filter === value ? "default" : "outline"}
                  onClick={() => setFilter(value)}
                >
                  {portfolioFilterLabel(value)}
                  {value === "archived_test" ? ` (${testCount})` : ""}
                </Button>
              ),
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {state.records.length} coordination record(s) · {uniqueProjects} project(s) · default
            view is Active operator projects
          </p>
          <Panel
            eyebrow="Projects"
            title={`${visible.length} ${portfolioFilterLabel(filter).toLowerCase()} project(s)`}
          >
            <div className="space-y-3">
              {visible.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No projects match this filter.
                </p>
              ) : (
                visible.map((group) => (
                  <div key={group.projectId} className="space-y-3 rounded-lg border p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 space-y-1">
                        <Link
                          className="font-medium text-primary hover:underline"
                          to={`/uci?projectId=${encodeURIComponent(group.projectId)}`}
                        >
                          {group.projectName}
                        </Link>
                        <p className="text-sm">
                          {group.utilityCount} utilit{group.utilityCount === 1 ? "y" : "ies"} ·{" "}
                          {group.attentionCount} needing attention · {furthestStageLabel(group.furthestStage)} ({group.furthestState})
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Overall progress {group.overallProgress}%
                          {group.p50Label ? ` · ${group.p50Label}` : " · Typical (P50) not computed yet"}
                          {group.p90Label ? ` · ${group.p90Label}` : ""}
                        </p>
                        <p className="text-xs text-muted-foreground">Next: {group.nextAction}</p>
                      </div>
                      <Button asChild size="sm" variant="outline">
                        <Link to={`/uci?projectId=${encodeURIComponent(group.projectId)}`}>
                          Open project
                        </Link>
                      </Button>
                    </div>
                    <ul className="space-y-1 border-t pt-2 text-xs text-muted-foreground">
                      {group.records.map((record) => (
                        <li key={record.id} className="flex flex-wrap items-center justify-between gap-2">
                          <span>
                            {providerName(record)} · {record.utility_type || "Utility"} ·{" "}
                            {lifecycleLabel(record)} · {record.current_stage_state}
                          </span>
                          <Link className="text-primary hover:underline" to={recordHref(record)}>
                            Open record
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))
              )}
            </div>
          </Panel>
        </div>
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
    <RouteFrame
      eyebrow="Stage 6"
      title="Design Review / Class of Service"
      body="Live Track A COS evidence. Clean matches complete Stage 6 automatically. Discrepancies stay in progress until an operator override or revision."
      badge="Live Stage 6"
    >
      <RouteLoadState {...state} loadingText="Loading class-of-service evidence…" />
      {!state.projectId ? <AlertBanner tone="info" title="Select a project" detail="Choose an active project to review class-of-service evidence." /> : null}
      {!state.loading && !state.error && state.projectId ? (
        <Panel eyebrow="Advisory and issued evidence" title={`${state.records.length} record(s)`}>
          <div className="space-y-3">
            {state.records.length === 0 ? (
              <p className="text-sm text-muted-foreground">No class-of-service evidence exists for this project.</p>
            ) : state.records.map((record) => {
              const analysis = record.metadata?.uci_cos_analysis as Record<string, unknown> | undefined;
              const reviewStatus = String(analysis?.review_status || "not analyzed");
              const autoCompleted = analysis?.auto_completed === true || (Number(record.current_stage) >= 6 && String(record.current_stage_state) === "COMPLETED" && Boolean(record.class_of_service_issued_at));
              return (
                <div key={record.id} className="rounded-lg border p-3">
                  <RecordLink record={record} tab="cos" />
                  <p className="text-xs text-muted-foreground">
                    Stage {record.current_stage} · {formatUciLifecycleStateLabel(record.current_stage_state)} · Review {reviewStatus.replace(/_/g, " ")}
                    {autoCompleted ? " · COS matched (auto-completed)" : ""}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Utility issued: {record.class_of_service_issued_at || "not evidenced"} · Stage 7 eligible: {Number(record.current_stage) === 6 && String(record.current_stage_state) === "COMPLETED" && record.class_of_service_issued_at ? "yes" : "no"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatTypicalP50Chip(record, (iso) => iso ? new Date(iso).toLocaleDateString() : "—") || "Typical (P50) not computed yet"}
                    {formatConservativeP90Chip(record, (iso) => iso ? new Date(iso).toLocaleDateString() : "—") ? ` · ${formatConservativeP90Chip(record, (iso) => iso ? new Date(iso).toLocaleDateString() : "—")}` : ""}
                  </p>
                </div>
              );
            })}
          </div>
        </Panel>
      ) : null}
      <AlertBanner tone="default" title="Predictive COS remains advisory" detail="Portfolio-wide predictive COS comparison is not treated as utility-issued evidence. Open a record to edit accepted values or request revision." />
    </RouteFrame>
  );
}

export function UciCiacRefundsPage() {
  const state = useOperationalRecords("details", false);
  return (
    <RouteFrame
      eyebrow="Stage 7"
      title="CIAC Costs & Refunds"
      body="Live CIAC and utility cost rows from Track B. Open a record to approve, record payment, or override a billing hold. Refund eligibility is not a required product."
      badge="Live Stage 7"
    >
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
                <p className="text-xs text-muted-foreground">
                  Stage {record.current_stage} · {formatUciLifecycleStateLabel(record.current_stage_state)}
                </p>
                {record.costs.length === 0 ? (
                  <p className="mt-1 text-xs text-muted-foreground">No cost rows yet — Stage 7 can complete with a no-cost path.</p>
                ) : (
                  <ul className="mt-1 space-y-1 text-xs text-muted-foreground">
                    {record.costs.map((cost) => {
                      const variance = Number(cost.variance_pct);
                      return (
                        <li key={cost.id}>
                          {cost.cost_type || "untyped"} · est {cost.estimated_amount ?? "—"} · actual {cost.actual_amount ?? "—"}
                          {Number.isFinite(variance) ? ` · variance ${variance}%` : ""}
                          {cost.billing_hold ? " · billing hold" : ""}
                          {cost.qb_sync_status ? ` · QB ${String(cost.qb_sync_status).replace(/_/g, " ")}` : ""}
                        </li>
                      );
                    })}
                  </ul>
                )}
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
    <RouteFrame
      eyebrow="Stages 9–10"
      title="Energization & Meter Set"
      body="Live inspection-release, meter-set, and closeout state from Track B. Agent 10 inspection-release automation is not enabled — record release in the workspace."
      badge="Live Stages 9–10"
    >
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
                <p className="text-xs text-muted-foreground">
                  Stage {record.current_stage} · {formatUciLifecycleStateLabel(record.current_stage_state)} · {getLifecycleStageTitle(record.current_stage)}
                </p>
                <p className="text-xs text-muted-foreground">
                  Inspection release {record.inspection_release_received_at || "not recorded"} · Meter set {record.meter_set_scheduled_at || "not scheduled"} · Site readiness {record.site_readiness_confirmed_at || "not confirmed"}
                </p>
                <p className="text-xs text-muted-foreground">
                  Target {record.energization_target_date || "not set"} · Actual {record.energization_actual_date || "not recorded"}
                  {record.closeout_package_doc_id ? " · Closeout PDF archived" : ""}
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatTypicalP50Chip(record, (iso) => iso ? new Date(iso).toLocaleDateString() : "—") || "Typical (P50) not computed yet"}
                </p>
              </div>
            ))}
          </div>
        </Panel>
      ) : null}
      <AlertBanner tone="default" title="Use the record workspace" detail="Inspection release, meter-set choreography, and closeout PDF live on the Energization & closeout tab. Miss Utility 811 automation is not enabled." />
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
