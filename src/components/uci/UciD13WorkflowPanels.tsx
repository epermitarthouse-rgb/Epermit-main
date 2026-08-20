import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { CheckCircle2, ChevronRight, Eye, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  UCI_COMMUNICATION_CATEGORIES,
  formatCommunicationClassification,
} from "@/lib/uciCommunicationClassifier";
import {
  buildCommunicationCardModel,
  buildCommunicationReviewTimeline,
  formatOperatorTimelineWhen,
  getCommunicationActionPlan,
  type CommunicationActionPlan,
} from "@/lib/uciCommunicationPresentation";
import type {
  CoordinationCommunication,
  CoordinationCost,
  CoordinationEquipment,
  CoordinationMilestone,
  CoordinationRecord,
  LifecycleState,
  UciLifecycleProposalRow,
  UciLifecycleProposalsPayload,
  UciLifecycleStatus,
  UciPortalSyncRun,
  UciPortfolioViewResponse,
  UciProviderMappingMetadata,
} from "@/types/uci";
import { UCI_COST_TYPES } from "@/types/uci";

type PanelCommonProps = {
  mutedClass: string;
  sectionTitleClass: string;
  toolbarOutlineButtonClass: string;
  formatWhen: (iso: string | null | undefined) => string;
};

export function ProviderMappingBanner({
  mapping,
  mutedClass,
}: {
  mapping: UciProviderMappingMetadata | null;
  mutedClass: string;
}) {
  if (!mapping) return null;
  return (
    <div className="rounded-md border border-teal/30 bg-cream-raised/40 px-3 py-2 text-xs dark:bg-obsidian/35">
      <p className="font-medium text-foreground">Human-assisted provider mapping confirmed</p>
      <p className={cn("mt-0.5", mutedClass)}>
        Address source: {mapping.address_source}
        {mapping.address_snapshot?.formatted ? ` · ${mapping.address_snapshot.formatted}` : ""}
      </p>
      <p className={cn("mt-0.5", mutedClass)}>
        Providers: {mapping.selected_provider_slugs.join(", ") || "—"}
        {mapping.unresolved_utility_types.length
          ? ` · Unresolved types: ${mapping.unresolved_utility_types.join(", ")}`
          : ""}
      </p>
      <p className={cn("mt-0.5 tabular-nums", mutedClass)}>
        Confirmed {mapping.confirmed_at ? new Date(mapping.confirmed_at).toLocaleString() : "—"}
      </p>
    </div>
  );
}

export function PortfolioSummarySection({
  portfolio,
  loading,
  mutedClass,
  sectionTitleClass,
}: {
  portfolio: UciPortfolioViewResponse | null;
  loading: boolean;
  mutedClass: string;
  sectionTitleClass: string;
}) {
  if (!portfolio && !loading) return null;
  return (
    <Card className="border-teal/25">
      <CardHeader className="pb-2">
        <CardTitle className={sectionTitleClass}>Portfolio summary</CardTitle>
        <CardDescription className={cn("text-[11px]", mutedClass)}>
          Project-level rollup from coordination records and attention queue.
        </CardDescription>
      </CardHeader>
      <CardContent className="text-xs">
        {loading ? (
          <div className="flex justify-center py-4">
            <Loader2 className="h-5 w-5 animate-spin text-teal" />
          </div>
        ) : portfolio ? (
          <div className="grid gap-2 sm:grid-cols-3">
            <div>
              <p className="font-medium">{portfolio.coordination_record_count}</p>
              <p className={mutedClass}>Coordination records</p>
            </div>
            <div>
              <p className="font-medium">{portfolio.needs_attention_communication_count}</p>
              <p className={mutedClass}>Needs attention</p>
            </div>
            <div>
              <p className="font-medium">
                {Object.entries(portfolio.stage_summary ?? {})
                  .filter(([, count]) => count > 0)
                  .map(([stage, count]) => `S${stage}:${count}`)
                  .join(" · ") || "—"}
              </p>
              <p className={mutedClass}>Stage distribution</p>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function SyncRunsPanel({
  coordinationId,
  runs,
  activeRun,
  loading,
  onRefresh,
  mutedClass,
  sectionTitleClass,
  toolbarOutlineButtonClass,
  formatWhen,
}: PanelCommonProps & {
  coordinationId: string;
  runs: UciPortalSyncRun[];
  activeRun: UciPortalSyncRun | null;
  loading: boolean;
  onRefresh: () => void;
}) {
  const [open, setOpen] = useState(Boolean(activeRun));
  const displayRun = activeRun ?? runs[0] ?? null;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={cn("h-8 w-full justify-between px-2", toolbarOutlineButtonClass)}
        >
          <span className={sectionTitleClass}>Durable sync runs</span>
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            {displayRun?.status ?? "idle"}
            <ChevronRight className={cn("h-4 w-4 transition-transform", open && "rotate-90")} />
          </span>
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2 space-y-2 rounded-md border border-border/50 px-3 py-2 text-xs">
        <div className="flex items-center justify-between gap-2">
          <p className={mutedClass}>Coordination {coordinationId.slice(0, 8)}…</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className={toolbarOutlineButtonClass}
            disabled={loading}
            onClick={onRefresh}
          >
            {loading ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
            Refresh
          </Button>
        </div>
        {displayRun ? (
          <>
            <p>
              <Badge variant="outline">{displayRun.status}</Badge>{" "}
              {displayRun.currentUserMessage || displayRun.phase || "Queued"}
            </p>
            {displayRun.progressTotal != null ? (
              <p className={mutedClass}>
                Progress {displayRun.progressCurrent ?? 0}/{displayRun.progressTotal}
              </p>
            ) : null}
            {displayRun.errorUserMessage ? (
              <p className="text-destructive">{displayRun.errorUserMessage}</p>
            ) : null}
            <p className={cn("tabular-nums", mutedClass)}>Updated {formatWhen(displayRun.updatedAt)}</p>
          </>
        ) : (
          <p className={mutedClass}>No durable sync runs for this coordination record.</p>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

export function CommunicationReclassifyRow({
  comm,
  busy,
  onReclassify,
  onFlagForReview,
  onConfirm,
  onReject,
  onViewHistory,
  mutedClass,
  toolbarOutlineButtonClass,
  actions,
}: {
  comm: CoordinationCommunication;
  busy: boolean;
  onReclassify: (communicationId: string, classification: string) => void;
  onFlagForReview?: (communicationId: string) => void;
  onConfirm?: (communicationId: string, classification: string) => void;
  onReject?: (communicationId: string) => void;
  onViewHistory?: (communicationId: string) => void;
  mutedClass: string;
  toolbarOutlineButtonClass: string;
  actions?: CommunicationActionPlan;
}) {
  const [category, setCategory] = useState(comm.classification || "unclassified");
  const plan = actions ?? buildCommunicationCardModel(comm).actions;
  const flagged = Boolean(
    (comm.agent_processed_metadata as Record<string, unknown> | undefined)?.flagged_for_review,
  );
  const overrideLine = buildCommunicationCardModel(comm).overrideLine;

  return (
    <div className="mt-2 space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        {plan.showReclassify ? (
          <>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger className="h-7 w-[180px] text-[11px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {UCI_COMMUNICATION_CATEGORIES.map((cat) => (
                  <SelectItem key={cat} value={cat}>
                    {formatCommunicationClassification(cat)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className={toolbarOutlineButtonClass}
              disabled={busy}
              onClick={() => onReclassify(comm.id, category)}
            >
              {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
              Reclassify
            </Button>
          </>
        ) : null}
        {plan.showConfirm && onConfirm ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className={toolbarOutlineButtonClass}
            disabled={busy}
            onClick={() => onConfirm(comm.id, category)}
          >
            Confirm
          </Button>
        ) : null}
        {plan.showFlag && onFlagForReview ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className={toolbarOutlineButtonClass}
            disabled={busy || flagged}
            onClick={() => onFlagForReview(comm.id)}
          >
            {flagged ? "Flagged" : "Flag for review"}
          </Button>
        ) : null}
        {plan.showReject && onReject ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className={toolbarOutlineButtonClass}
            disabled={busy}
            onClick={() => onReject(comm.id)}
          >
            Reject
          </Button>
        ) : null}
        {plan.showViewHistory && onViewHistory ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-[11px]"
            onClick={() => onViewHistory(comm.id)}
          >
            View history
          </Button>
        ) : plan.showViewHistory ? (
          <span className={cn("text-[11px]", mutedClass)}>View history</span>
        ) : null}
      </div>
      {overrideLine ? <p className={cn("text-[10px]", mutedClass)}>{overrideLine}</p> : null}
    </div>
  );
}

export function CommunicationReviewTimeline({
  comm,
  record,
  mutedClass,
  showAuditDetail = false,
}: {
  comm: CoordinationCommunication;
  record?: CoordinationRecord | null;
  mutedClass: string;
  showAuditDetail?: boolean;
}) {
  const [auditOpen, setAuditOpen] = useState(false);
  const events = buildCommunicationReviewTimeline(comm, record);
  const meta = (comm.agent_processed_metadata || {}) as Record<string, unknown>;

  if (events.length === 0) {
    return <p className={cn("text-[11px]", mutedClass)}>No review history yet.</p>;
  }

  return (
    <div className="mt-2 space-y-2">
      <ul className="space-y-1.5 border-l border-border/60 pl-3">
        {events.map((event, index) => (
          <li key={`${event.label}-${index}`} className={cn("text-[11px]", mutedClass)}>
            <span className="font-medium text-foreground">{event.label}</span>
            {event.at ? ` · ${formatOperatorTimelineWhen(event.at)}` : null}
            {event.detail ? <p className="mt-0.5">{event.detail}</p> : null}
          </li>
        ))}
      </ul>
      {showAuditDetail ? (
        <>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-[10px]"
            onClick={() => setAuditOpen((value) => !value)}
          >
            {auditOpen ? "Hide audit detail" : "Audit detail"}
          </Button>
          {auditOpen ? (
            <pre
              className={cn(
                "max-h-40 overflow-auto rounded bg-muted/20 p-2 font-mono text-[10px]",
                mutedClass,
              )}
            >
              {JSON.stringify(
                {
                  reviewed_by: comm.reviewed_by,
                  reviewed_at: comm.reviewed_at,
                  review_decision: meta.review_decision ?? null,
                  stage_5_incomplete: meta.stage_5_incomplete ?? null,
                  stage_5_completion: meta.stage_5_completion ?? null,
                  classification: comm.classification,
                  confidence: comm.classification_confidence,
                },
                null,
                2,
              )}
            </pre>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

/** Lightweight Confirm / Flag actions for operational queues (Inbox, Needs Attention). */
export function CommunicationQuickActions({
  comm,
  record,
  providerName,
  busy,
  onConfirm,
  onFlagForReview,
  toolbarOutlineButtonClass,
  workspaceHref,
  surface = "inbox",
}: {
  comm: CoordinationCommunication;
  record?: CoordinationRecord | null;
  providerName?: string | null;
  busy: boolean;
  onConfirm?: (communicationId: string, classification: string) => void;
  onFlagForReview?: (communicationId: string) => void;
  toolbarOutlineButtonClass: string;
  workspaceHref?: string;
  surface?: "inbox" | "needs-attention" | "workspace";
}) {
  const plan = getCommunicationActionPlan(comm, record, { surface });
  const flagged = Boolean(
    (comm.agent_processed_metadata as Record<string, unknown> | undefined)?.flagged_for_review,
  );
  const needsAttentionQueue = surface === "needs-attention";
  const showOpenRecord = Boolean(workspaceHref);
  const showReclassify = Boolean(workspaceHref) && plan.showReclassify;
  const showConfirm = plan.showConfirm && onConfirm;
  const showFlag = plan.showFlag && onFlagForReview && !needsAttentionQueue;

  if (!showConfirm && !showFlag && !showOpenRecord && !showReclassify) {
    return null;
  }

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      {showConfirm ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className={toolbarOutlineButtonClass}
          disabled={busy}
          onClick={() => onConfirm?.(comm.id, comm.classification || "acknowledgment")}
        >
          {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
          {needsAttentionQueue ? "Resolve" : "Confirm"}
        </Button>
      ) : null}
      {showFlag ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className={toolbarOutlineButtonClass}
          disabled={busy || flagged}
          onClick={() => onFlagForReview?.(comm.id)}
        >
          {flagged ? "Flagged" : "Flag for review"}
        </Button>
      ) : null}
      {showReclassify ? (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-[11px]"
          asChild
        >
          <Link to={workspaceHref!}>Reclassify</Link>
        </Button>
      ) : null}
      {showOpenRecord ? (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-[11px]"
          asChild
        >
          <Link to={workspaceHref!}>{needsAttentionQueue ? "Open record" : "Review in workspace"}</Link>
        </Button>
      ) : null}
    </div>
  );
}

export function CommunicationOperatorCard({
  comm,
  providerName,
  record,
  busy,
  onReclassify,
  onFlagForReview,
  onConfirm,
  onReject,
  mutedClass,
  toolbarOutlineButtonClass,
  cardClassName,
}: {
  comm: CoordinationCommunication;
  providerName?: string | null;
  record?: CoordinationRecord | null;
  busy: boolean;
  onReclassify?: (communicationId: string, classification: string) => void;
  onFlagForReview?: (communicationId: string) => void;
  onConfirm?: (communicationId: string, classification: string) => void;
  onReject?: (communicationId: string) => void;
  mutedClass: string;
  toolbarOutlineButtonClass: string;
  cardClassName?: string;
}) {
  const [messageOpen, setMessageOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const model = buildCommunicationCardModel(comm, { providerName, record });

  return (
    <div className={cardClassName}>
      <div className="flex flex-wrap items-center gap-2">
        {model.directionLabel ? <Badge variant="outline">{model.directionLabel}</Badge> : null}
        {model.actions.needsAttention ? (
          <Badge variant="destructive">Needs attention</Badge>
        ) : model.actions.resolved ? (
          <Badge variant="secondary">Resolved</Badge>
        ) : null}
      </div>
      <p className="mt-2 font-medium text-foreground">{model.title}</p>
      {model.subtitle ? <p className={cn("mt-0.5 text-xs", mutedClass)}>{model.subtitle}</p> : null}
      {model.actions.needsAttention && model.attentionReasons.length > 1 ? (
        <ul className={cn("mt-1 list-disc pl-4 text-[11px]", mutedClass)}>
          {model.attentionReasons.slice(1).map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      ) : null}
      {model.detailLine ? (
        <p className={cn("mt-1 text-xs tabular-nums", mutedClass)}>{model.detailLine}</p>
      ) : null}
      {model.nextLine ? <p className={cn("mt-1 text-xs", mutedClass)}>{model.nextLine}</p> : null}
      {!model.isAcknowledgment && model.displaySubject !== "(no subject)" ? (
        <p className={cn("mt-1 text-xs", mutedClass)}>{model.displaySubject}</p>
      ) : null}
      <div className="mt-2 flex flex-wrap gap-2">
        {model.actions.showViewMessage && comm.raw_body ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-[11px]"
            onClick={() => setMessageOpen((v) => !v)}
          >
            {messageOpen ? "Hide message" : "View message"}
          </Button>
        ) : null}
        {model.actions.showViewHistory ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-[11px]"
            onClick={() => setHistoryOpen((v) => !v)}
          >
            {historyOpen ? "Hide history" : "View history"}
          </Button>
        ) : null}
      </div>
      {messageOpen && comm.raw_body ? (
        <pre className={cn("mt-2 max-h-40 overflow-auto rounded bg-muted/20 p-2 text-[11px] whitespace-pre-wrap", mutedClass)}>
          {comm.raw_body}
        </pre>
      ) : null}
      {historyOpen ? (
        <CommunicationReviewTimeline
          comm={comm}
          record={record}
          mutedClass={mutedClass}
          showAuditDetail
        />
      ) : null}
      {onReclassify ? (
        <CommunicationReclassifyRow
          comm={comm}
          busy={busy}
          actions={model.actions}
          onReclassify={onReclassify}
          onFlagForReview={onFlagForReview}
          onConfirm={onConfirm}
          onReject={onReject}
          mutedClass={mutedClass}
          toolbarOutlineButtonClass={toolbarOutlineButtonClass}
        />
      ) : null}
    </div>
  );
}

export function CosAnalysisPanel({
  coordinationId,
  projectId = null,
  metadata,
  cosDesignRecords = [],
  projectDocuments = [],
  canEnterStage7 = false,
  classOfServiceIssuedAt = null,
  busy,
  error,
  onAnalyze,
  onUploadDocuments,
  onSelectExistingDocuments,
  onUpdateAcceptedFields,
  onUpdateComparisonInclusion,
  onApprove,
  onAcceptDeviation,
  onRequestRevision,
  onFlag,
  onReject,
  mutedClass,
  sectionTitleClass,
  toolbarOutlineButtonClass,
}: PanelCommonProps & {
  coordinationId: string;
  projectId?: string | null;
  metadata: Record<string, unknown>;
  cosDesignRecords?: Array<Record<string, unknown>>;
  projectDocuments?: Array<{
    id: string;
    file_name: string;
    file_type?: string | null;
    description?: string | null;
    created_at?: string | null;
  }>;
  canEnterStage7?: boolean;
  classOfServiceIssuedAt?: string | null;
  busy: boolean;
  error: string | null;
  onAnalyze: () => void;
  onUploadDocuments?: (files: File[]) => void | Promise<void>;
  onSelectExistingDocuments?: (documentIds: string[]) => void | Promise<void>;
  onUpdateAcceptedFields?: (payload: {
    updates?: Array<{ field: string; accepted_value: unknown; reason?: string | null }>;
    reset_fields?: string[];
  }) => void | Promise<void>;
  onUpdateComparisonInclusion?: (payload: {
    toggles: Array<{ field: string; included_in_comparison: boolean }>;
    confirm_core_exclusion?: boolean;
  }) => void | Promise<void>;
  onApprove?: () => void;
  onAcceptDeviation?: (notes: string) => void;
  onRequestRevision?: (notes: string) => void;
  onFlag?: () => void;
  onReject?: (reason: string) => void;
}) {
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const [selectedExistingIds, setSelectedExistingIds] = useState<string[]>([]);
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const analysis = metadata.uci_cos_analysis as Record<string, unknown> | undefined;
  const current =
    cosDesignRecords.find((r) => r.is_current === true) ||
    cosDesignRecords[0] ||
    null;
  const comparisonRows = (Array.isArray(current?.comparison_rows)
    ? current?.comparison_rows
    : Array.isArray(analysis?.comparison_rows)
      ? analysis?.comparison_rows
      : []) as Array<Record<string, unknown>>;
  const evidenceStatus = String(current?.evidence_status || analysis?.evidence_status || "—");
  const reviewStatus = String(current?.review_status || analysis?.review_status || "—");
  const versionLabel =
    current?.version != null ? `v${String(current.version)}` : null;
  const hasEvidence =
    comparisonRows.length > 0 ||
    Boolean(current?.id) ||
    Boolean(analysis?.cos_design_record_id);
  const isApproved = reviewStatus === "approved";
  const canEditAccepted =
    Boolean(onUpdateAcceptedFields) &&
    !isApproved &&
    evidenceStatus !== "ADVISORY" &&
    reviewStatus !== "rejected" &&
    reviewStatus !== "superseded";
  const canEditInclusion =
    Boolean(onUpdateComparisonInclusion) &&
    !isApproved &&
    evidenceStatus !== "ADVISORY" &&
    reviewStatus !== "rejected" &&
    reviewStatus !== "superseded";

  const COS_CORE_COMPARE_FIELDS = new Set([
    "service_amperage",
    "service_voltage",
    "phase",
    "wire_configuration",
    "meter_count",
  ]);

  const isRowIncluded = (row: Record<string, unknown>) => row.included_in_comparison !== false;
  const includedComparisonRows = comparisonRows.filter(isRowIncluded);
  const hasMaterialIncluded = includedComparisonRows.some(
    (r) =>
      r.result &&
      r.result !== "match" &&
      r.result !== "insufficient_data" &&
      (r.material === true ||
        r.result === "undersized" ||
        r.result === "oversized" ||
        r.result === "mismatch" ||
        r.utility_conflict === true),
  );
  const hasMaterial =
    reviewStatus === "revision_required" ||
    hasMaterialIncluded ||
    (evidenceStatus === "DISCREPANCY" && !isApproved && includedComparisonRows.length > 0);

  const reviewSummary =
    (current?.discrepancy_report &&
    typeof current.discrepancy_report === "object" &&
    !Array.isArray(current.discrepancy_report) &&
    (current.discrepancy_report as Record<string, unknown>).review_summary) ||
    (current?.agent_metadata &&
    typeof current.agent_metadata === "object" &&
    !Array.isArray(current.agent_metadata) &&
    (current.agent_metadata as Record<string, unknown>).review_summary) ||
    analysis?.review_summary ||
    null;

  const autoCompleted =
    Boolean((current?.agent_metadata as Record<string, unknown> | undefined)?.auto_completed) ||
    Boolean((analysis as Record<string, unknown> | undefined)?.auto_completed) ||
    Boolean(
      reviewSummary &&
        typeof reviewSummary === "object" &&
        (reviewSummary as Record<string, unknown>).auto_completed,
    ) ||
    (isApproved && !hasMaterial && evidenceStatus !== "DISCREPANCY");

  const summaryHeadline =
    reviewSummary && typeof reviewSummary === "object"
      ? String((reviewSummary as Record<string, unknown>).headline || "")
      : "";
  const nextAction =
    reviewSummary && typeof reviewSummary === "object"
      ? String((reviewSummary as Record<string, unknown>).next_action || "")
      : "";
  const workflowStep =
    reviewSummary && typeof reviewSummary === "object"
      ? String((reviewSummary as Record<string, unknown>).workflow_step || "")
      : hasEvidence
        ? "review_values"
        : "awaiting_documents";

  const overrideRows = comparisonRows.filter((r) => r.operator_override === true);
  const historyVersions = cosDesignRecords
    .filter((r) => r.is_current !== true)
    .slice(0, 5);

  const selectableDocs = projectDocuments.filter((d) => {
    const name = String(d.file_name || "").toLowerCase();
    const type = String(d.file_type || "").toLowerCase();
    return (
      type.includes("pdf") ||
      type.includes("html") ||
      type.includes("text") ||
      type.includes("image") ||
      /\.(pdf|docx?|html?|txt|png|jpe?g)$/i.test(name)
    );
  });

  const workflowSteps = [
    { id: "awaiting_documents", label: "Documents received" },
    { id: "review_values", label: "Analysis complete" },
    { id: "resolve_differences", label: "Resolve differences" },
    {
      id: "approved",
      label:
        autoCompleted ||
        (isApproved &&
          (Boolean((current?.agent_metadata as Record<string, unknown> | undefined)?.auto_completed) ||
            Boolean((analysis as Record<string, unknown> | undefined)?.auto_completed) ||
            Boolean(
              reviewSummary &&
                typeof reviewSummary === "object" &&
                (reviewSummary as Record<string, unknown>).auto_completed,
            )))
          ? "COS matched"
          : "Approve COS",
    },
  ];

  const activeWorkflowIndex = (() => {
    if (isApproved || workflowStep === "approved") return 3;
    if (workflowStep === "resolve_differences") return 2;
    if (hasEvidence || workflowStep === "review_values") return 1;
    return 0;
  })();

  const formatCell = (value: unknown) => (value != null && value !== "" ? String(value) : "—");

  const statusLabel = (row: Record<string, unknown>) => {
    if (row.utility_conflict === true || row.result === "document_conflict") return "Conflict";
    if (row.operator_override === true) return "Override";
    if (row.result === "match") return "Match";
    if (row.result === "baseline_missing") return "New condition";
    if (row.result === "undersized" || row.result === "oversized" || row.result === "mismatch") {
      return "Discrepancy";
    }
    return String(row.result || "—");
  };

  const saveAccepted = async (field: string, acceptedValue: unknown, requireReason: boolean) => {
    if (!onUpdateAcceptedFields) return;
    let reason: string | null = null;
    if (requireReason) {
      reason = window.prompt("Reason for changing accepted value from utility-issued");
      if (!reason || !reason.trim()) return;
    }
    await onUpdateAcceptedFields({
      updates: [{ field, accepted_value: acceptedValue, reason: reason?.trim() || null }],
    });
    setEditingField(null);
    setEditDraft("");
  };

  const toggleComparisonInclusion = async (field: string, nextIncluded: boolean) => {
    if (!onUpdateComparisonInclusion) return;
    if (!nextIncluded && COS_CORE_COMPARE_FIELDS.has(field)) {
      const ok = window.confirm(
        `Exclude core field "${field}" from comparison?\n\nCore service fields usually must match before Stage 6 can complete. Only exclude if this row is parser noise.`,
      );
      if (!ok) return;
      await onUpdateComparisonInclusion({
        toggles: [{ field, included_in_comparison: false }],
        confirm_core_exclusion: true,
      });
      return;
    }
    await onUpdateComparisonInclusion({
      toggles: [{ field, included_in_comparison: nextIncluded }],
    });
  };

  const handleApproveClick = () => {
    if (!onApprove) return;
    if (overrideRows.length > 0) {
      const lines = overrideRows
        .map(
          (r) =>
            `• ${String(r.label || r.field)}: utility ${formatCell(r.utility_issued)} → accepted ${formatCell(r.accepted)}${r.override_reason ? ` (${String(r.override_reason)})` : ""}`,
        )
        .join("\n");
      const ok = window.confirm(
        `Approve COS with ${overrideRows.length} operator override(s)?\n\n${lines}\n\nUtility-issued evidence stays immutable.`,
      );
      if (!ok) return;
    }
    onApprove();
  };

  return (
    <Card className="border-border/60">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className={sectionTitleClass}>Design Review / Class of Service</CardTitle>
          <div className="flex flex-wrap gap-1">
            {!hasEvidence ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className={toolbarOutlineButtonClass}
                disabled={busy}
                onClick={onAnalyze}
                title="Run analysis if documents are already on the record"
              >
                {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
                Analyze
              </Button>
            ) : null}
            {onApprove && !autoCompleted && !isApproved ? (
              <Button
                type="button"
                size="sm"
                disabled={busy || evidenceStatus === "ADVISORY"}
                onClick={handleApproveClick}
              >
                Approve COS
              </Button>
            ) : null}
            {autoCompleted || (isApproved && !hasMaterial) ? (
              <Badge variant="secondary" className="text-[10px] font-medium">
                COS matched · Stage 6 completed automatically
              </Badge>
            ) : null}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-xs">
        {error ? <p className="text-destructive">{error}</p> : null}

        <div className="flex flex-wrap gap-1.5">
          {workflowSteps.map((step, idx) => (
            <Badge
              key={step.id}
              variant={idx <= activeWorkflowIndex ? "default" : "outline"}
              className="text-[10px] font-normal"
            >
              {idx + 1}. {step.label}
            </Badge>
          ))}
        </div>

        {summaryHeadline ? (
          <div className="rounded border border-border/40 bg-muted/20 px-2.5 py-2">
            <p className="font-medium text-foreground">{summaryHeadline}</p>
            {nextAction ? <p className={`${mutedClass} mt-0.5`}>Next: {nextAction}</p> : null}
          </div>
        ) : null}

        <div className="grid gap-1 text-[11px] text-muted-foreground sm:grid-cols-2">
          <p>
            Evidence: <span className="font-medium text-foreground">{evidenceStatus}</span>
            {evidenceStatus === "ADVISORY" ? " (not utility-issued)" : ""}
            {versionLabel ? ` · ${versionLabel}` : ""}
            {current?.review_version != null ? ` · review r${String(current.review_version)}` : ""}
          </p>
          <p>
            Review: <span className="font-medium text-foreground">{reviewStatus}</span>
          </p>
          <p>
            Issued at:{" "}
            <span className="font-medium text-foreground">
              {classOfServiceIssuedAt || "not evidenced"}
            </span>
          </p>
          <p>
            Stage 7 eligible:{" "}
            <span className="font-medium text-foreground">{canEnterStage7 ? "yes" : "no"}</span>
          </p>
        </div>

        {(onUploadDocuments || onSelectExistingDocuments) && projectId ? (
          <div className="space-y-2 rounded border border-border/40 p-2">
            <p className="text-[11px] font-medium text-foreground">
              Upload COS / Design documents
            </p>
            <p className={mutedClass}>
              Multi-select uploads persist each file independently, then auto-analyze. Clean
              matches complete Stage 6 automatically — Approve is only needed for discrepancies
              or overrides. Utility evidence is never overwritten. Re-analyze selected is recovery
              / debug only.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              {onUploadDocuments ? (
                <>
                  <input
                    ref={uploadInputRef}
                    type="file"
                    multiple
                    accept=".pdf,.doc,.docx,.html,.htm,.txt,.png,.jpg,.jpeg,application/pdf,text/html,text/plain,image/*"
                    className="hidden"
                    disabled={busy}
                    onChange={(e) => {
                      const files = Array.from(e.target.files || []);
                      e.target.value = "";
                      if (files.length) void onUploadDocuments(files);
                    }}
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className={toolbarOutlineButtonClass}
                    disabled={busy}
                    onClick={() => uploadInputRef.current?.click()}
                  >
                    {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
                    Upload COS / Design documents
                  </Button>
                </>
              ) : null}
            </div>
            {onSelectExistingDocuments ? (
              <div className="space-y-2 pt-1">
                <Label className="text-[10px] text-muted-foreground">
                  Select existing (reprocess fallback)
                </Label>
                <div className="max-h-28 space-y-1 overflow-y-auto rounded border border-border/30 p-1.5">
                  {selectableDocs.length === 0 ? (
                    <p className={mutedClass}>No eligible project documents</p>
                  ) : (
                    selectableDocs.map((doc) => {
                      const checked = selectedExistingIds.includes(doc.id);
                      return (
                        <label
                          key={doc.id}
                          className="flex cursor-pointer items-start gap-2 rounded px-1 py-0.5 hover:bg-muted/40"
                        >
                          <input
                            type="checkbox"
                            className="mt-0.5"
                            checked={checked}
                            disabled={busy}
                            onChange={() => {
                              setSelectedExistingIds((prev) =>
                                checked ? prev.filter((id) => id !== doc.id) : [...prev, doc.id],
                              );
                            }}
                          />
                          <span className="text-[11px] leading-snug">{doc.file_name}</span>
                        </label>
                      );
                    })
                  )}
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className={toolbarOutlineButtonClass}
                  disabled={busy || selectedExistingIds.length === 0}
                  onClick={() => {
                    if (selectedExistingIds.length) {
                      void onSelectExistingDocuments(selectedExistingIds);
                    }
                  }}
                >
                  Re-analyze selected (recovery)
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}

        {comparisonRows.length > 0 ? (
          <div className="overflow-x-auto rounded border border-border/40">
            <table className="w-full min-w-[720px] text-left text-[11px]">
              <thead className="bg-muted/40">
                <tr>
                  <th className="px-2 py-1.5 font-medium">Include in comparison</th>
                  <th className="px-2 py-1.5 font-medium">Submitted</th>
                  <th className="px-2 py-1.5 font-medium">Utility-issued</th>
                  <th className="px-2 py-1.5 font-medium">Accepted value</th>
                  <th className="px-2 py-1.5 font-medium">Status</th>
                  <th className="px-2 py-1.5 font-medium">Action</th>
                </tr>
              </thead>
              <tbody>
                {comparisonRows.map((row) => {
                  const field = String(row.field || "");
                  const included = isRowIncluded(row);
                  const utilityDisplay =
                    row.utility_issued_display != null
                      ? String(row.utility_issued_display)
                      : formatCell(row.utility_issued);
                  const acceptedDisplay = formatCell(
                    row.accepted != null ? row.accepted : row.utility_issued,
                  );
                  const isEditing = editingField === field;
                  const candidates = Array.isArray(row.utility_candidates)
                    ? (row.utility_candidates as Array<Record<string, unknown>>)
                    : [];
                  return (
                    <tr
                      key={field}
                      className={cn(
                        "border-t border-border/30",
                        !included && "bg-muted/20 text-muted-foreground",
                      )}
                    >
                      <td className="px-2 py-1.5 align-top">
                        <label className="flex items-start gap-1.5">
                          <Checkbox
                            checked={included}
                            disabled={busy || !canEditInclusion}
                            onCheckedChange={(checked) => {
                              void toggleComparisonInclusion(field, checked === true);
                            }}
                            aria-label={`Include ${String(row.label || row.field)} in comparison`}
                          />
                          <span className="text-[10px] leading-snug">
                            {included ? "Included" : "Excluded"}
                          </span>
                        </label>
                      </td>
                      <td className="px-2 py-1.5 align-top">
                        <div className="font-medium text-foreground">
                          {String(row.label || row.field)}
                        </div>
                        <div className={mutedClass}>{formatCell(row.submitted)}</div>
                      </td>
                      <td className="px-2 py-1.5 align-top">
                        <div className="text-foreground">{utilityDisplay}</div>
                        <div className={`${mutedClass} text-[10px]`}>immutable source</div>
                      </td>
                      <td className="px-2 py-1.5 align-top">
                        {isEditing ? (
                          <div className="space-y-1">
                            {candidates.length > 0 ? (
                              <Select
                                value={editDraft || undefined}
                                onValueChange={setEditDraft}
                              >
                                <SelectTrigger className="h-7 text-[11px]">
                                  <SelectValue placeholder="Pick candidate" />
                                </SelectTrigger>
                                <SelectContent>
                                  {candidates.map((c, i) => (
                                    <SelectItem
                                      key={`${String(c.value)}-${i}`}
                                      value={String(c.value)}
                                      className="text-xs"
                                    >
                                      {String(c.value)} ({String(c.document_name || "doc")})
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            ) : (
                              <Input
                                className="h-7 text-[11px]"
                                value={editDraft}
                                onChange={(e) => setEditDraft(e.target.value)}
                              />
                            )}
                            <div className="flex flex-wrap gap-1">
                              <Button
                                type="button"
                                size="sm"
                                className="h-6 px-2 text-[10px]"
                                disabled={busy || !editDraft.trim()}
                                onClick={() => {
                                  const utility = row.utility_issued;
                                  const next = editDraft.trim();
                                  const differs =
                                    String(next) !== String(utility ?? "") &&
                                    !(utility == null && !next);
                                  void saveAccepted(
                                    field,
                                    /^\d+(\.\d+)?$/.test(next) ? Number(next) : next,
                                    differs || row.utility_conflict === true,
                                  );
                                }}
                              >
                                Save
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                className="h-6 px-2 text-[10px]"
                                onClick={() => {
                                  setEditingField(null);
                                  setEditDraft("");
                                }}
                              >
                                Cancel
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <div>
                            <div className="font-medium text-foreground">{acceptedDisplay}</div>
                            {row.operator_override === true ? (
                              <Badge variant="outline" className="mt-0.5 text-[9px] font-normal">
                                Operator override
                              </Badge>
                            ) : null}
                            {row.override_reason ? (
                              <div className={`${mutedClass} mt-0.5 text-[10px]`}>
                                {String(row.override_reason)}
                              </div>
                            ) : null}
                          </div>
                        )}
                      </td>
                      <td className="px-2 py-1.5 align-top">{statusLabel(row)}</td>
                      <td className="px-2 py-1.5 align-top">
                        <div className="space-y-1">
                          <div className={mutedClass}>{String(row.required_action || "—")}</div>
                          {canEditAccepted && !isEditing ? (
                            <div className="flex flex-wrap gap-1">
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className={`h-6 px-2 text-[10px] ${toolbarOutlineButtonClass}`}
                                disabled={busy}
                                onClick={() => {
                                  setEditingField(field);
                                  setEditDraft(
                                    row.accepted != null
                                      ? String(row.accepted)
                                      : row.utility_issued != null
                                        ? String(row.utility_issued)
                                        : "",
                                  );
                                }}
                              >
                                Edit
                              </Button>
                              {row.operator_override === true || row.utility_conflict === true ? (
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="ghost"
                                  className="h-6 px-2 text-[10px]"
                                  disabled={busy || row.utility_issued == null}
                                  onClick={() => {
                                    if (!onUpdateAcceptedFields) return;
                                    void onUpdateAcceptedFields({ reset_fields: [field] });
                                  }}
                                >
                                  Reset to utility
                                </Button>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className={mutedClass}>
            Upload utility COS / design documents (auto-analyzes after save), or wait for a
            classified email/portal attachment. Clean matches complete Stage 6 automatically.
            Select existing → Re-analyze is recovery / debug only.
          </p>
        )}

        {overrideRows.length > 0 && !isApproved ? (
          <div className="rounded border border-amber-500/30 bg-amber-500/5 px-2.5 py-2">
            <p className="font-medium text-foreground">
              Overrides before approval ({overrideRows.length})
            </p>
            <ul className={`${mutedClass} mt-1 list-inside list-disc`}>
              {overrideRows.map((r) => (
                <li key={String(r.field)}>
                  {String(r.label || r.field)}: {formatCell(r.utility_issued)} →{" "}
                  {formatCell(r.accepted)}
                  {r.override_reason ? ` — ${String(r.override_reason)}` : ""}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {historyVersions.length > 0 ? (
          <div className={`${mutedClass} text-[10px]`}>
            Prior COS versions preserved:{" "}
            {historyVersions
              .map((r) => `v${String(r.version)}${r.review_status === "approved" ? " (approved)" : ""}`)
              .join(", ")}
          </div>
        ) : null}

        <div className="flex flex-wrap gap-1">
          {hasMaterial && onAcceptDeviation ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className={toolbarOutlineButtonClass}
              disabled={busy || isApproved}
              onClick={() => {
                const notes = window.prompt("Reason for accepting material deviation");
                if (notes && notes.trim()) onAcceptDeviation(notes.trim());
              }}
            >
              Accept deviation
            </Button>
          ) : null}
          {onRequestRevision ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className={toolbarOutlineButtonClass}
              disabled={busy || isApproved}
              onClick={() => {
                const notes = window.prompt("Revision request notes");
                if (notes && notes.trim()) onRequestRevision(notes.trim());
              }}
            >
              Request revision
            </Button>
          ) : null}
          {onFlag ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className={toolbarOutlineButtonClass}
              disabled={busy}
              onClick={onFlag}
            >
              Flag for review
            </Button>
          ) : null}
          {onReject ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className={toolbarOutlineButtonClass}
              disabled={busy || isApproved}
              onClick={() => {
                const reason = window.prompt("Why is this the wrong document?");
                if (reason && reason.trim()) onReject(reason.trim());
              }}
            >
              Reject document
            </Button>
          ) : null}
        </div>

        {coordinationId ? (
          <p className={`${mutedClass} text-[10px]`}>Record {coordinationId.slice(0, 8)}…</p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function qbStatusLabel(status: string | null | undefined, lastError?: string | null): string {
  switch (String(status || "not_ready")) {
    case "not_ready":
      return "Not ready to bill";
    case "ready":
      return "Ready to bill";
    case "pending":
      return "Creating client invoice";
    case "succeeded":
      return "Client invoice created";
    case "retry":
      return "Client invoice failed — auto-retry scheduled";
    case "failed":
      return lastError ? `Client invoice failed — ${lastError.replace(/^\[[^\]]+\]\s*/, "")}` : "Client invoice failed — retry or review";
    case "uncertain":
      return "Checking for an existing invoice";
    default:
      return String(status);
  }
}

function canRetryClientInvoice(cost: CoordinationCost): boolean {
  if (!cost.paid_at || cost.quickbooks_invoice_id) return false;
  const status = String(cost.qb_sync_status || "");
  return status === "failed" || status === "retry" || status === "uncertain";
}

function varianceTone(pct: string | number | null | undefined): string {
  const n = Number(pct);
  if (!Number.isFinite(n)) return "text-muted-foreground";
  if (n > 20) return "text-destructive";
  if (n > 15) return "text-amber-700 dark:text-amber-400";
  if (n > 5) return "text-amber-700 dark:text-amber-400";
  return "text-foreground";
}

function etaSourceLabel(entry: Record<string, unknown>): string {
  const source = String(entry.source || entry.recorded_at ? entry.source || "recorded" : "unknown");
  if (source === "utility_email") return "Utility email";
  if (source === "operator") return "Operator";
  if (source === "portal") return "Portal";
  if (source === "cos_seed") return "COS seed";
  return source.replace(/_/g, " ");
}

export function CostsEquipmentWorkflowPanel({
  costs,
  equipment,
  busy,
  error,
  lifecycleStatus,
  onSaveCost,
  onCreateEquipment,
  onCheckInEquipment,
  onApproveCost,
  onRecordPayment,
  onOverrideBill,
  onRetryInvoice,
  onCompleteStage7,
  onCompleteStage8,
  mutedClass,
  sectionTitleClass,
  toolbarOutlineButtonClass,
  formatWhen,
}: PanelCommonProps & {
  costs: CoordinationCost[];
  equipment: CoordinationEquipment[];
  busy: boolean;
  error: string | null;
  lifecycleStatus?: UciLifecycleStatus | null;
  onSaveCost: (payload: { cost_type: string; estimated_amount?: string; actual_amount?: string }) => void;
  onCreateEquipment: (payload: { equipment_type: string; initial_eta?: string }) => void;
  onCheckInEquipment: (equipmentId: string, payload: { current_eta?: string; status?: string }) => void;
  onApproveCost?: (costId: string) => void;
  onRecordPayment?: (costId: string, paymentMethod: string) => void;
  onOverrideBill?: (costId: string) => void;
  onRetryInvoice?: (costId: string) => void;
  onCompleteStage7?: () => void;
  onCompleteStage8?: () => void;
}) {
  const [costType, setCostType] = useState<(typeof UCI_COST_TYPES)[number]>("CIAC");
  const [estimated, setEstimated] = useState("");
  const [actual, setActual] = useState("");
  const [equipmentType, setEquipmentType] = useState("transformer");
  const [equipmentEta, setEquipmentEta] = useState("");
  const [checkInEta, setCheckInEta] = useState<Record<string, string>>({});

  return (
    <div className="space-y-3">
      {error ? (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      {lifecycleStatus?.record_attention?.length ? (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs">
          {lifecycleStatus.record_attention.map((item) => (
            <p key={item.code}>{item.label}</p>
          ))}
        </div>
      ) : null}

      <Card className="border-border/60">
        <CardHeader className="pb-2">
          <CardTitle className={sectionTitleClass}>Costs</CardTitle>
          <CardDescription className="text-xs">
            Estimate vs actual, client approval, payment, then client invoice. Zero markup.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-xs">
          {costs.length === 0 ? (
            <p className={mutedClass}>No cost rows yet. COS may seed a CIAC estimate; that does not finish Stage 7.</p>
          ) : (
            costs.map((cost) => {
              const approval = String(cost.client_approval_status || "pending");
              return (
                <div key={cost.id} className="space-y-1.5 rounded border border-border/40 px-2 py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium">{cost.cost_type}</p>
                    {cost.variance_pct != null ? (
                      <Badge variant="secondary" className={cn("text-[10px]", varianceTone(cost.variance_pct))}>
                        Variance {cost.variance_pct}%
                      </Badge>
                    ) : null}
                    {cost.billing_hold ? (
                      <Badge variant="destructive" className="text-[10px]">
                        Billing hold
                      </Badge>
                    ) : null}
                  </div>
                  <p className={mutedClass}>
                    Estimate {cost.estimated_amount ?? "—"} · Actual {cost.actual_amount ?? "—"}
                  </p>
                  <p className={mutedClass}>
                    Approval: {approval}
                    {cost.paid_at ? ` · Paid ${formatWhen(cost.paid_at)}` : " · Not paid"}
                    {cost.client_billed_at ? ` · Client billed ${formatWhen(cost.client_billed_at)}` : ""}
                  </p>
                  <p className={mutedClass}>{qbStatusLabel(cost.qb_sync_status, cost.qb_last_error)}</p>
                  {cost.qb_last_error && cost.qb_sync_status !== "succeeded" ? (
                    <p className="text-[10px] text-destructive">{cost.qb_last_error}</p>
                  ) : null}
                  {cost.qb_attempt_count != null && cost.qb_attempt_count > 0 ? (
                    <p className={`${mutedClass} text-[10px]`}>Invoice attempts: {cost.qb_attempt_count}</p>
                  ) : null}
                  {canRetryClientInvoice(cost) && cost.updated_at ? (
                    <p className={`${mutedClass} text-[10px]`}>
                      Last invoice attempt {formatWhen(cost.updated_at)}
                    </p>
                  ) : null}
                  {cost.quickbooks_invoice_id ? (
                    <p className={`${mutedClass} text-[10px]`}>
                      QuickBooks invoice {cost.quickbooks_invoice_id}
                    </p>
                  ) : null}
                  <div className="flex flex-wrap gap-1.5">
                    {approval !== "approved" && onApproveCost ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className={toolbarOutlineButtonClass}
                        disabled={busy}
                        onClick={() => onApproveCost(cost.id)}
                      >
                        Approve (zero markup)
                      </Button>
                    ) : null}
                    {!cost.paid_at && onRecordPayment ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className={toolbarOutlineButtonClass}
                        disabled={busy}
                        onClick={() => onRecordPayment(cost.id, "utility")}
                      >
                        Record utility paid
                      </Button>
                    ) : null}
                    {cost.billing_hold && onOverrideBill ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className={toolbarOutlineButtonClass}
                        disabled={busy}
                        onClick={() => onOverrideBill(cost.id)}
                      >
                        Override billing hold
                      </Button>
                    ) : null}
                    {canRetryClientInvoice(cost) && onRetryInvoice ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className={toolbarOutlineButtonClass}
                        disabled={busy}
                        onClick={() => onRetryInvoice(cost.id)}
                      >
                        Retry client invoice
                      </Button>
                    ) : null}
                  </div>
                </div>
              );
            })
          )}
          <div className="grid gap-2 sm:grid-cols-3">
            <Select value={costType} onValueChange={(value) => setCostType(value as (typeof UCI_COST_TYPES)[number])}>
              <SelectTrigger className="h-8" aria-label="Cost type">
                <SelectValue placeholder="Cost type" />
              </SelectTrigger>
              <SelectContent>
                {UCI_COST_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {type === "CIAC" ? "CIAC" : type.replace(/_/g, " ")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input value={estimated} onChange={(e) => setEstimated(e.target.value)} placeholder="Estimate" />
            <Input value={actual} onChange={(e) => setActual(e.target.value)} placeholder="Actual" />
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className={toolbarOutlineButtonClass}
            disabled={busy}
            onClick={() =>
              onSaveCost({
                cost_type: costType,
                estimated_amount: estimated || undefined,
                actual_amount: actual || undefined,
              })
            }
          >
            Add cost
          </Button>
          {lifecycleStatus?.guards?.can_complete_stage_7 && onCompleteStage7 ? (
            <Button type="button" size="sm" disabled={busy} onClick={onCompleteStage7}>
              Mark Stage 7 complete
            </Button>
          ) : (
            <p className={mutedClass}>
              Stage 7 completes when every known cost is approved, paid, and billed to the client. QuickBooks sync is optional.
            </p>
          )}
        </CardContent>
      </Card>

      <Card className="border-border/60">
        <CardHeader className="pb-2">
          <CardTitle className={sectionTitleClass}>Long-lead equipment</CardTitle>
          <CardDescription className="text-xs">
            Stage 8 is complete when the procurement queue has current ETAs. Installed is not required.
            Manual check-in is recovery when the daily job did not get a reply.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-xs">
          {equipment.length === 0 ? (
            <p className={mutedClass}>No equipment rows yet. COS may seed type and size only.</p>
          ) : (
            equipment.map((item) => {
              const history = Array.isArray(item.eta_history)
                ? (item.eta_history as Array<Record<string, unknown>>)
                : [];
              return (
                <div key={item.id} className="space-y-1.5 rounded border border-border/40 px-2 py-2">
                  <p className="font-medium">
                    {item.equipment_type}
                    {item.equipment_size ? ` · ${item.equipment_size}` : ""} · {item.status}
                  </p>
                  <p className={mutedClass}>
                    Current ETA {formatWhen(item.current_eta)} · Next automatic check-in{" "}
                    {formatWhen(item.next_check_in_at)}
                  </p>
                  {history.length ? (
                    <ol className="space-y-0.5">
                      {history.slice(-5).map((entry, idx) => (
                        <li key={`${item.id}-eta-${idx}`} className={mutedClass}>
                          {String(entry.eta || "—")} · {etaSourceLabel(entry)} ·{" "}
                          {formatWhen(String(entry.observed_at || entry.recorded_at || ""))}
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <p className={mutedClass}>No ETA timeline yet.</p>
                  )}
                  <div className="flex flex-wrap items-end gap-2">
                    <Input
                      className="h-8 w-40"
                      type="date"
                      value={checkInEta[item.id] || ""}
                      onChange={(e) => setCheckInEta((prev) => ({ ...prev, [item.id]: e.target.value }))}
                      aria-label={`Recovery ETA for ${item.equipment_type}`}
                    />
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2"
                      disabled={busy}
                      onClick={() =>
                        onCheckInEquipment(item.id, {
                          current_eta: checkInEta[item.id] || item.current_eta || undefined,
                        })
                      }
                    >
                      Recovery check-in
                    </Button>
                  </div>
                </div>
              );
            })
          )}
          <div className="grid gap-2 sm:grid-cols-2">
            <Input
              value={equipmentType}
              onChange={(e) => setEquipmentType(e.target.value)}
              placeholder="Equipment type"
            />
            <Input
              type="date"
              value={equipmentEta}
              onChange={(e) => setEquipmentEta(e.target.value)}
              aria-label="Initial ETA"
            />
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className={toolbarOutlineButtonClass}
            disabled={busy || !equipmentType.trim()}
            onClick={() =>
              onCreateEquipment({
                equipment_type: equipmentType.trim(),
                initial_eta: equipmentEta || undefined,
              })
            }
          >
            Add equipment
          </Button>
          {lifecycleStatus?.guards?.can_complete_stage_8 && onCompleteStage8 ? (
            <Button type="button" size="sm" disabled={busy} onClick={onCompleteStage8}>
              Mark Stage 8 complete
            </Button>
          ) : (
            <p className={mutedClass}>Stage 8 completes when every in-scope item has a current ETA.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function meterStatusLabel(status: string | undefined): string {
  switch (status) {
    case "waiting_on_inspection_release":
      return "Waiting for inspection release";
    case "not_in_stage_9":
      return "Meter-set work starts at Stage 9";
    case "request_or_confirm_date":
      return "Request or confirm a meter-set date";
    case "awaiting_site_readiness":
      return "48-hour site checklist pending";
    case "ready_to_complete_stage_9":
      return "Ready to mark Stage 9 complete";
    case "meter_set_scheduled":
      return "Meter set scheduled";
    default:
      return status ? status.replace(/_/g, " ") : "Not started";
  }
}

const CLOSEOUT_ARTIFACT_KEYS = [
  "utility_confirmation",
  "final_meter_reading",
  "commissioning_signoff",
] as const;

export type CloseoutArtifactKey = (typeof CLOSEOUT_ARTIFACT_KEYS)[number];

function asMetaRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function readCloseoutArtifacts(record: CoordinationRecord | null | undefined): Record<string, unknown> {
  return asMetaRecord(asMetaRecord(record?.metadata).closeout_artifacts);
}

function closeoutChecklistFlag(record: CoordinationRecord | null | undefined, key: string): boolean {
  const closeout = asMetaRecord(asMetaRecord(record?.metadata).uci_closeout_package);
  const checklist = Array.isArray(closeout.checklist) ? closeout.checklist : [];
  return checklist.some((item) => asMetaRecord(item).key === key && asMetaRecord(item).completed === true);
}

/** Mirrors backend closeout artifact guards so UI status matches persisted state. */
export function hasCloseoutArtifactOnRecord(
  record: CoordinationRecord | null | undefined,
  key: CloseoutArtifactKey,
): boolean {
  const artifacts = readCloseoutArtifacts(record);
  if (key === "utility_confirmation") {
    return Boolean(
      artifacts.utility_confirmation ||
        artifacts.utility_confirmation_doc_id ||
        closeoutChecklistFlag(record, "utility_energization_confirmed"),
    );
  }
  if (key === "final_meter_reading") {
    return Boolean(artifacts.final_meter_reading || artifacts.final_meter_reading_doc_id);
  }
  return Boolean(artifacts.commissioning_signoff || artifacts.commissioning_signoff_doc_id);
}

export function getCloseoutArtifactEvidence(
  record: CoordinationRecord | null | undefined,
  key: CloseoutArtifactKey,
): Record<string, unknown> | null {
  const evidence = readCloseoutArtifacts(record)[key];
  return evidence && typeof evidence === "object" && !Array.isArray(evidence)
    ? (evidence as Record<string, unknown>)
    : null;
}

export type CloseoutEvidenceSourceType =
  | "communication"
  | "stage_9_milestone"
  | "uploaded_document"
  | "existing_record";

export type CloseoutEvidenceStatus = "confirmed" | "inherited" | "missing";

export interface CloseoutEvidenceResolution {
  status: CloseoutEvidenceStatus;
  sourceType: CloseoutEvidenceSourceType | null;
  sourceName: string | null;
  sourceId: string | null;
  capturedAt: string | null;
  confirmedBy: string | null;
  note: string | null;
  docId: string | null;
}

const CLOSEOUT_EVIDENCE_SOURCE_LABELS: Record<CloseoutEvidenceSourceType, string> = {
  communication: "communication",
  stage_9_milestone: "Stage 9 milestone",
  uploaded_document: "uploaded document",
  existing_record: "existing record",
};

function closeoutArtifactDocId(
  record: CoordinationRecord | null | undefined,
  key: CloseoutArtifactKey,
): string | null {
  const artifacts = readCloseoutArtifacts(record);
  const docKey = `${key}_doc_id`;
  const raw = artifacts[docKey];
  return typeof raw === "string" && raw.trim() ? raw.trim() : null;
}

function communicationHaystack(comm: CoordinationCommunication): string {
  return `${comm.raw_subject ?? ""} ${comm.raw_body ?? ""} ${comm.parsed_summary ?? ""}`.toLowerCase();
}

function communicationDisplayName(comm: CoordinationCommunication): string {
  const subject = String(comm.raw_subject || "").trim();
  if (subject) return subject.length > 72 ? `${subject.slice(0, 69)}…` : subject;
  const summary = String(comm.parsed_summary || "").trim();
  if (summary) return summary.length > 72 ? `${summary.slice(0, 69)}…` : summary;
  return formatCommunicationClassification(comm.classification);
}

function findInboundCommunication(
  communications: CoordinationCommunication[],
  predicate: (comm: CoordinationCommunication) => boolean,
): CoordinationCommunication | undefined {
  return (
    communications.find((comm) => comm.direction === "inbound" && predicate(comm)) ||
    communications.find(predicate)
  );
}

function mapPersistedEvidenceSource(
  evidence: Record<string, unknown>,
  docId: string | null,
  checklistOnly: boolean,
): Pick<CloseoutEvidenceResolution, "sourceType" | "sourceName" | "sourceId" | "docId"> {
  const communicationId =
    typeof evidence.communication_id === "string" ? evidence.communication_id : null;
  const evidenceDocId = typeof evidence.doc_id === "string" ? evidence.doc_id : docId;
  const source = String(evidence.source || "");

  if (communicationId || source.includes("communication") || source === "energization_confirmation") {
    return {
      sourceType: "communication",
      sourceName: typeof evidence.label === "string" ? evidence.label : "Utility communication",
      sourceId: communicationId,
      docId: evidenceDocId,
    };
  }
  if (source === "stage_9_milestone") {
    return {
      sourceType: "stage_9_milestone",
      sourceName: typeof evidence.label === "string" ? evidence.label : "Stage 9 milestone",
      sourceId: communicationId,
      docId: evidenceDocId,
    };
  }
  if (evidenceDocId) {
    return {
      sourceType: "uploaded_document",
      sourceName: evidenceDocId,
      sourceId: evidenceDocId,
      docId: evidenceDocId,
    };
  }
  if (checklistOnly) {
    return {
      sourceType: "stage_9_milestone",
      sourceName: "Closeout checklist — utility energization confirmed",
      sourceId: "utility_energization_confirmed",
      docId: null,
    };
  }
  return {
    sourceType: "existing_record",
    sourceName: typeof evidence.label === "string" ? evidence.label : "Persisted closeout artifact",
    sourceId: typeof evidence.kind === "string" ? evidence.kind : null,
    docId: null,
  };
}

function findInheritedUtilityConfirmation(
  communications: CoordinationCommunication[],
): CoordinationCommunication | undefined {
  return findInboundCommunication(
    communications,
    (comm) => String(comm.classification || "") === "energization_confirmation",
  );
}

function findInheritedFinalMeterReading(
  communications: CoordinationCommunication[],
  milestones: CoordinationMilestone[],
): {
  communication?: CoordinationCommunication;
  milestone?: CoordinationMilestone;
} {
  const communication = findInboundCommunication(communications, (comm) =>
    /final meter reading|meter reading attached|meter read(ing)?/.test(communicationHaystack(comm)),
  );
  const milestone = milestones.find(
    (m) => m.milestone_type === "meter_set" && m.status === "completed",
  );
  return { communication, milestone };
}

function findInheritedCommissioningSignoff(
  communications: CoordinationCommunication[],
): CoordinationCommunication | undefined {
  return findInboundCommunication(communications, (comm) =>
    /commissioning/.test(communicationHaystack(comm)),
  );
}

/** Resolves Stage 10 evidence from persisted artifacts, documents, milestones, and communications. */
export function resolveCloseoutArtifactEvidence(params: {
  record: CoordinationRecord | null | undefined;
  key: CloseoutArtifactKey;
  communications?: CoordinationCommunication[];
  milestones?: CoordinationMilestone[];
}): CloseoutEvidenceResolution {
  const { record, key, communications = [], milestones = [] } = params;
  const evidence = getCloseoutArtifactEvidence(record, key);
  const docId = closeoutArtifactDocId(record, key);
  const checklistUtility =
    key === "utility_confirmation" && closeoutChecklistFlag(record, "utility_energization_confirmed");

  if (hasCloseoutArtifactOnRecord(record, key)) {
    if (evidence) {
      const checklistOnly = checklistUtility && !evidence.communication_id && !evidence.doc_id;
      const mapped = mapPersistedEvidenceSource(evidence, docId, checklistOnly);
      return {
        status: "confirmed",
        ...mapped,
        capturedAt: typeof evidence.captured_at === "string" ? evidence.captured_at : null,
        confirmedBy:
          typeof evidence.confirmed_by === "string"
            ? evidence.confirmed_by
            : evidence.source === "operator"
              ? "Operator"
              : null,
        note: typeof evidence.label === "string" ? evidence.label : null,
      };
    }
    if (docId) {
      return {
        status: "confirmed",
        sourceType: "uploaded_document",
        sourceName: docId,
        sourceId: docId,
        capturedAt: null,
        confirmedBy: null,
        note: null,
        docId,
      };
    }
    if (checklistUtility) {
      return {
        status: "confirmed",
        sourceType: "stage_9_milestone",
        sourceName: "Closeout checklist — utility energization confirmed",
        sourceId: "utility_energization_confirmed",
        capturedAt: null,
        confirmedBy: null,
        note: null,
        docId: null,
      };
    }
  }

  if (key === "utility_confirmation") {
    const comm = findInheritedUtilityConfirmation(communications);
    if (comm) {
      return {
        status: "inherited",
        sourceType: "communication",
        sourceName: communicationDisplayName(comm),
        sourceId: comm.id,
        capturedAt: comm.message_timestamp || comm.created_at,
        confirmedBy: null,
        note: null,
        docId: null,
      };
    }
  }

  if (key === "final_meter_reading") {
    const inherited = findInheritedFinalMeterReading(communications, milestones);
    if (inherited.communication) {
      return {
        status: "inherited",
        sourceType: "communication",
        sourceName: communicationDisplayName(inherited.communication),
        sourceId: inherited.communication.id,
        capturedAt:
          inherited.communication.message_timestamp || inherited.communication.created_at,
        confirmedBy: null,
        note: null,
        docId: null,
      };
    }
    if (inherited.milestone) {
      const when =
        inherited.milestone.actual_date ||
        inherited.milestone.occurred_at ||
        inherited.milestone.created_at;
      return {
        status: "inherited",
        sourceType: "stage_9_milestone",
        sourceName: "Meter set completed",
        sourceId: inherited.milestone.id,
        capturedAt: when ?? null,
        confirmedBy: null,
        note: null,
        docId: null,
      };
    }
  }

  if (key === "commissioning_signoff") {
    const comm = findInheritedCommissioningSignoff(communications);
    if (comm) {
      return {
        status: "inherited",
        sourceType: "communication",
        sourceName: communicationDisplayName(comm),
        sourceId: comm.id,
        capturedAt: comm.message_timestamp || comm.created_at,
        confirmedBy: null,
        note: null,
        docId: null,
      };
    }
  }

  return {
    status: "missing",
    sourceType: null,
    sourceName: null,
    sourceId: null,
    capturedAt: null,
    confirmedBy: null,
    note: null,
    docId: null,
  };
}

export function formatCloseoutEvidenceSourceLabel(resolution: CloseoutEvidenceResolution): string | null {
  if (!resolution.sourceType) return null;
  const base = CLOSEOUT_EVIDENCE_SOURCE_LABELS[resolution.sourceType];
  if (resolution.sourceName) return `${base} · ${resolution.sourceName}`;
  return base;
}

function CloseoutArtifactEvidenceRow({
  artifactKey,
  label,
  resolution,
  closeoutBusy,
  onConfirm,
  mutedClass,
  formatWhen,
}: {
  artifactKey: CloseoutArtifactKey;
  label: string;
  resolution: CloseoutEvidenceResolution;
  closeoutBusy: boolean;
  onConfirm: (payload: {
    kind: CloseoutArtifactKey;
    label?: string;
    doc_id?: string;
    communication_id?: string;
    source?: string;
  }) => void;
  mutedClass: string;
  formatWhen: (iso: string | null | undefined) => string;
}) {
  const [note, setNote] = useState("");
  const [docRef, setDocRef] = useState("");
  const [showConfirmForm, setShowConfirmForm] = useState(false);

  const sourceLabel = formatCloseoutEvidenceSourceLabel(resolution);

  const submitConfirmation = () => {
    const trimmedNote = note.trim();
    const trimmedDoc = docRef.trim();
    if (resolution.status === "missing" && !trimmedNote) return;

    const defaultLabel =
      resolution.status === "inherited" && sourceLabel
        ? `Confirmed from ${sourceLabel}`
        : trimmedNote;

    onConfirm({
      kind: artifactKey,
      label: trimmedNote || defaultLabel,
      doc_id: trimmedDoc || undefined,
      communication_id:
        resolution.status === "inherited" && resolution.sourceType === "communication"
          ? resolution.sourceId || undefined
          : undefined,
      source:
        resolution.status === "inherited" && resolution.sourceType === "communication"
          ? "communication"
          : resolution.status === "inherited" && resolution.sourceType === "stage_9_milestone"
            ? "stage_9_milestone"
            : "operator",
    });
    setShowConfirmForm(false);
    setNote("");
    setDocRef("");
  };

  return (
    <li className="rounded-md border border-border/50 px-2 py-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1 space-y-1">
          <p className="font-medium">{label}</p>
          {resolution.status === "confirmed" ? (
            <>
              <p className="text-teal">
                <CheckCircle2 className="mr-1 inline h-3 w-3 shrink-0" />
                Found / Confirmed
              </p>
              {sourceLabel ? <p className={mutedClass}>Source: {sourceLabel}</p> : null}
              {resolution.sourceId ? (
                <p className={cn("tabular-nums", mutedClass)}>Ref: {resolution.sourceId}</p>
              ) : null}
              {resolution.capturedAt ? (
                <p className={cn("tabular-nums", mutedClass)}>{formatWhen(resolution.capturedAt)}</p>
              ) : null}
              {resolution.confirmedBy ? (
                <p className={mutedClass}>Confirmed by {resolution.confirmedBy}</p>
              ) : null}
              {resolution.note && resolution.note !== resolution.sourceName ? (
                <p className={mutedClass}>Note: {resolution.note}</p>
              ) : null}
            </>
          ) : resolution.status === "inherited" ? (
            <>
              <p className="text-amber-700 dark:text-amber-400">
                Found in prior UCI records — confirm to attach
              </p>
              {sourceLabel ? <p className={mutedClass}>Source: {sourceLabel}</p> : null}
              {resolution.sourceId ? (
                <p className={cn("tabular-nums", mutedClass)}>Ref: {resolution.sourceId}</p>
              ) : null}
              {resolution.capturedAt ? (
                <p className={cn("tabular-nums", mutedClass)}>{formatWhen(resolution.capturedAt)}</p>
              ) : null}
            </>
          ) : (
            <p className="text-muted-foreground">
              Not found in prior UCI records — manual confirmation required
            </p>
          )}
        </div>
        {resolution.status === "confirmed" ? (
          <Badge variant="secondary" className="shrink-0 text-[10px] text-teal">
            <CheckCircle2 className="mr-1 inline h-3 w-3" />
            Confirmed
          </Badge>
        ) : null}
      </div>

      {resolution.status !== "confirmed" ? (
        <div className="mt-2 space-y-2">
          {showConfirmForm ? (
            <>
              <Textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={
                  resolution.status === "missing"
                    ? "Confirmation note (required for external evidence)"
                    : "Optional note"
                }
                className="min-h-[52px] text-xs"
                rows={2}
              />
              <Input
                value={docRef}
                onChange={(e) => setDocRef(e.target.value)}
                placeholder="Evidence reference or document ID (optional)"
                className="h-8 text-xs"
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={closeoutBusy || (resolution.status === "missing" && !note.trim())}
                  onClick={submitConfirmation}
                >
                  {closeoutBusy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
                  Confirm evidence
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={closeoutBusy}
                  onClick={() => setShowConfirmForm(false)}
                >
                  Cancel
                </Button>
              </div>
            </>
          ) : (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={closeoutBusy}
              onClick={() => setShowConfirmForm(true)}
            >
              {resolution.status === "inherited" ? "Confirm from UCI record" : "Confirm manually"}
            </Button>
          )}
        </div>
      ) : null}
    </li>
  );
}

export function hasMeterSetRequestSent(
  recordId: string | null | undefined,
  communications: CoordinationCommunication[] = [],
): boolean {
  if (!recordId) return false;
  return communications.some((comm) => {
    if (comm.direction !== "outbound") return false;
    const meta = asMetaRecord(comm.agent_processed_metadata);
    if (String(meta.idempotency_key || "") === `meter_set_request:${recordId}`) return true;
    return String(meta.template_id || comm.classification || "") === "uci.meter_set_request.v1";
  });
}

export function meterSetCrewCompleted(milestones: CoordinationMilestone[] = []): boolean {
  return milestones.some((m) => m.milestone_type === "meter_set" && m.status === "completed");
}

export function meterSetNoShowRecorded(record: CoordinationRecord | null | undefined): boolean {
  const meter = asMetaRecord(asMetaRecord(record?.metadata).uci_meter_set);
  return meter.no_show === true && String(meter.last_outcome || "") === "no_show";
}

function toIsoOrNull(value: unknown): string | null {
  if (value == null || value === "") return null;
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

export function resolveMeterSetScheduledAt(
  record: CoordinationRecord | null | undefined,
  milestones: CoordinationMilestone[] = [],
): string | null {
  const column = toIsoOrNull(record?.meter_set_scheduled_at);
  if (column) return column;
  const meter = asMetaRecord(asMetaRecord(record?.metadata).uci_meter_set);
  const fromMeta = toIsoOrNull(meter.scheduled_at) || toIsoOrNull(meter.scheduled_date);
  if (fromMeta) return fromMeta;
  const milestone = milestones.find(
    (m) =>
      m.milestone_type === "meter_set" &&
      (m.status === "scheduled" || m.status === "completed"),
  );
  return toIsoOrNull(milestone?.target_date);
}

export function resolveSiteReadinessConfirmedAt(
  record: CoordinationRecord | null | undefined,
): string | null {
  const column = toIsoOrNull(record?.site_readiness_confirmed_at);
  if (column) return column;
  const site = asMetaRecord(asMetaRecord(record?.metadata).site_readiness);
  return toIsoOrNull(site.confirmed_at);
}

export function deriveCloseoutPdfInfo(
  record: CoordinationRecord | null | undefined,
  archivedFileName?: string | null,
) {
  const closeoutPackage = asMetaRecord(asMetaRecord(record?.metadata).uci_closeout_package);
  const documentId =
    record?.closeout_package_doc_id ||
    (typeof closeoutPackage.document_id === "string" ? closeoutPackage.document_id : null);
  const generatedAt =
    typeof closeoutPackage.generated_at === "string" ? closeoutPackage.generated_at : null;
  const metadataFileName =
    typeof closeoutPackage.file_name === "string" ? closeoutPackage.file_name : null;
  const fallbackFileName = record?.id ? `uci-closeout-${String(record.id).slice(0, 8)}.pdf` : null;

  return {
    documentId,
    generatedAt,
    fileName: archivedFileName || metadataFileName || fallbackFileName,
    isArchived: Boolean(documentId),
  };
}

export function deriveMeterSetCloseoutActionState(params: {
  record: CoordinationRecord | null | undefined;
  milestones?: CoordinationMilestone[];
  communications?: CoordinationCommunication[];
  closeoutPdfFileName?: string | null;
}) {
  const { record, milestones = [], communications = [], closeoutPdfFileName = null } = params;
  const completedMilestone = milestones.find(
    (m) => m.milestone_type === "meter_set" && m.status === "completed",
  );
  const closeoutPdf = deriveCloseoutPdfInfo(record, closeoutPdfFileName);
  const meterSetScheduledAt = resolveMeterSetScheduledAt(record, milestones);
  const siteReadinessConfirmedAt = resolveSiteReadinessConfirmedAt(record);

  return {
    inspectionRelease: Boolean(record?.inspection_release_received_at),
    inspectionReleaseAt: record?.inspection_release_received_at ?? null,
    meterSetRequested: hasMeterSetRequestSent(record?.id, communications),
    meterSetScheduled: Boolean(meterSetScheduledAt),
    meterSetScheduledAt,
    siteReadinessConfirmed: Boolean(siteReadinessConfirmedAt),
    siteReadinessConfirmedAt,
    crewCompleted: meterSetCrewCompleted(milestones),
    crewCompletedAt: completedMilestone?.actual_date ?? completedMilestone?.occurred_at ?? null,
    noShowRecorded: meterSetNoShowRecorded(record),
    energizationCaptured: Boolean(record?.energization_actual_date),
    energizationActualDate: record?.energization_actual_date ?? null,
    closeoutPdfGenerated: closeoutPdf.isArchived,
    closeoutPdfDocumentId: closeoutPdf.documentId,
    closeoutPdfFileName: closeoutPdf.fileName,
    closeoutPdfGeneratedAt: closeoutPdf.generatedAt,
    artifacts: Object.fromEntries(
      CLOSEOUT_ARTIFACT_KEYS.map((key) => [key, hasCloseoutArtifactOnRecord(record, key)]),
    ) as Record<CloseoutArtifactKey, boolean>,
  };
}

function WorkflowCompletedActionButton({
  completed,
  completedLabel,
  pendingLabel,
  timestamp,
  busy,
  disabled,
  onClick,
  toolbarOutlineButtonClass,
  formatWhen,
  allowRepeat = false,
}: {
  completed: boolean;
  completedLabel: string;
  pendingLabel: string;
  timestamp?: string | null;
  busy?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  toolbarOutlineButtonClass: string;
  formatWhen: (iso: string | null | undefined) => string;
  allowRepeat?: boolean;
}) {
  if (completed && !allowRepeat) {
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className={cn(toolbarOutlineButtonClass, "pointer-events-none border-teal/40 text-teal opacity-100")}
          disabled
        >
          <CheckCircle2 className="mr-1 h-3 w-3 shrink-0" />
          {completedLabel}
        </Button>
        {timestamp ? (
          <span className="tabular-nums text-[10px] text-muted-foreground">{formatWhen(timestamp)}</span>
        ) : null}
      </div>
    );
  }

  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      className={toolbarOutlineButtonClass}
      disabled={busy || disabled}
      onClick={onClick}
    >
      {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
      {pendingLabel}
    </Button>
  );
}

export function MeterSetCloseoutPanel({
  record,
  lifecycleStatus,
  milestones = [],
  communications = [],
  meterBusy,
  closeoutBusy,
  error,
  onRecordInspectionRelease,
  onSaveSiteContact,
  onRequestMeterSet,
  onConfirmMeterSetDate,
  onConfirmSiteReadiness,
  onRecordOutcome,
  onCompleteStage9,
  onAttachArtifact,
  onMarkEnergized,
  onResolveDateConflict,
  onGenerateCloseout,
  onOpenCloseoutPdf,
  onCompleteStage10,
  closeoutPdfOpenBusy = false,
  closeoutPdfFileName = null,
  mutedClass,
  sectionTitleClass,
  toolbarOutlineButtonClass,
  formatWhen,
}: PanelCommonProps & {
  record?: CoordinationRecord | null;
  lifecycleStatus?: UciLifecycleStatus | null;
  milestones?: CoordinationMilestone[];
  communications?: CoordinationCommunication[];
  meterBusy: boolean;
  closeoutBusy: boolean;
  error: string | null;
  onRecordInspectionRelease: () => void;
  onSaveSiteContact: (payload: {
    site_contact_name?: string;
    site_contact_email?: string;
    site_contact_phone?: string;
  }) => void;
  onRequestMeterSet: () => void;
  onConfirmMeterSetDate: (scheduledDate: string) => void;
  onConfirmSiteReadiness: () => void;
  onRecordOutcome: (payload: { outcome: string; actual_date?: string; reschedule_date?: string }) => void;
  onCompleteStage9: () => void;
  onAttachArtifact: (payload: {
    kind: CloseoutArtifactKey;
    label?: string;
    doc_id?: string;
    communication_id?: string;
    source?: string;
  }) => void;
  onMarkEnergized: (actualDate: string) => void;
  onResolveDateConflict: () => void;
  onGenerateCloseout: () => void;
  onOpenCloseoutPdf?: () => void;
  onCompleteStage10: () => void;
  closeoutPdfOpenBusy?: boolean;
  closeoutPdfFileName?: string | null;
}) {
  const [scheduledDate, setScheduledDate] = useState("");
  const [energizeDate, setEnergizeDate] = useState("");
  const [siteName, setSiteName] = useState(record?.site_contact_name || "");
  const [siteEmail, setSiteEmail] = useState(record?.site_contact_email || "");
  const [sitePhone, setSitePhone] = useState(record?.site_contact_phone || "");
  const meter = lifecycleStatus?.meter_set;
  const closeout = lifecycleStatus?.closeout;
  const rollup = lifecycleStatus?.project_rollup;
  const actionState = deriveMeterSetCloseoutActionState({
    record,
    milestones,
    communications,
    closeoutPdfFileName,
  });
  const allowDateReconfirm = actionState.noShowRecorded;
  const meterSetScheduledAt = actionState.meterSetScheduledAt;
  const siteReadinessConfirmedAt = actionState.siteReadinessConfirmedAt;

  useEffect(() => {
    setSiteName(record?.site_contact_name || "");
    setSiteEmail(record?.site_contact_email || "");
    setSitePhone(record?.site_contact_phone || "");
  }, [record?.site_contact_name, record?.site_contact_email, record?.site_contact_phone]);

  useEffect(() => {
    if (meterSetScheduledAt) {
      setScheduledDate(String(meterSetScheduledAt).slice(0, 10));
    }
  }, [meterSetScheduledAt]);

  useEffect(() => {
    if (record?.energization_actual_date) {
      setEnergizeDate(String(record.energization_actual_date).slice(0, 10));
    }
  }, [record?.energization_actual_date]);

  const closeoutArtifactRows: Array<{ key: CloseoutArtifactKey; label: string }> = [
    { key: "utility_confirmation", label: "Utility confirmation" },
    { key: "final_meter_reading", label: "Final meter reading" },
    { key: "commissioning_signoff", label: "Commissioning sign-off" },
  ];

  return (
    <div className="space-y-3">
      {error ? (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      {rollup?.banner ? (
        <div className="rounded-md border border-border/60 bg-muted/20 px-3 py-2 text-xs">
          <p className="font-medium">{rollup.banner}</p>
          <p className={mutedClass}>
            Project utility coordination completes only when every utility record is Stage 10 completed.
          </p>
        </div>
      ) : null}

      <Card className="border-border/60">
        <CardHeader className="pb-2">
          <CardTitle className={sectionTitleClass}>Inspection release & meter set</CardTitle>
          <CardDescription className="text-xs">{meterStatusLabel(meter?.status)}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-xs">
          <p className={mutedClass}>
            Inspection release {record?.inspection_release_received_at ? formatWhen(record.inspection_release_received_at) : "not recorded"}
            . Meter set {meterSetScheduledAt ? formatWhen(meterSetScheduledAt) : "not scheduled"}
            . Site readiness {siteReadinessConfirmedAt ? formatWhen(siteReadinessConfirmedAt) : "not confirmed"}.
          </p>
          <WorkflowCompletedActionButton
            completed={actionState.inspectionRelease}
            completedLabel="Inspection release recorded ✓"
            pendingLabel="Record inspection release"
            timestamp={actionState.inspectionReleaseAt}
            busy={meterBusy}
            onClick={onRecordInspectionRelease}
            toolbarOutlineButtonClass={toolbarOutlineButtonClass}
            formatWhen={formatWhen}
          />

          <div className="grid gap-2 sm:grid-cols-3">
            <Input value={siteName} onChange={(e) => setSiteName(e.target.value)} placeholder="Site contact name" />
            <Input value={siteEmail} onChange={(e) => setSiteEmail(e.target.value)} placeholder="Site contact email" />
            <Input value={sitePhone} onChange={(e) => setSitePhone(e.target.value)} placeholder="Site contact phone" />
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className={toolbarOutlineButtonClass}
            disabled={meterBusy}
            onClick={() =>
              onSaveSiteContact({
                site_contact_name: siteName || undefined,
                site_contact_email: siteEmail || undefined,
                site_contact_phone: sitePhone || undefined,
              })
            }
          >
            Save site contact
          </Button>

          {record?.inspection_release_received_at ? (
            <div className="flex flex-wrap items-end gap-2">
              <WorkflowCompletedActionButton
                completed={actionState.meterSetRequested}
                completedLabel="Requested ✓"
                pendingLabel="Request meter set"
                busy={meterBusy}
                onClick={onRequestMeterSet}
                toolbarOutlineButtonClass={toolbarOutlineButtonClass}
                formatWhen={formatWhen}
              />
              <Input
                type="date"
                className="h-8 w-40"
                value={scheduledDate}
                onChange={(e) => setScheduledDate(e.target.value)}
                aria-label="Confirmed meter-set date"
                disabled={actionState.meterSetScheduled && !allowDateReconfirm}
              />
              <WorkflowCompletedActionButton
                completed={actionState.meterSetScheduled && !allowDateReconfirm}
                completedLabel="Date confirmed ✓"
                pendingLabel="Confirm date"
                timestamp={actionState.meterSetScheduledAt}
                busy={meterBusy}
                disabled={!scheduledDate}
                allowRepeat={allowDateReconfirm}
                onClick={() => onConfirmMeterSetDate(scheduledDate)}
                toolbarOutlineButtonClass={toolbarOutlineButtonClass}
                formatWhen={formatWhen}
              />
              <WorkflowCompletedActionButton
                completed={actionState.siteReadinessConfirmed}
                completedLabel="Site ready ✓"
                pendingLabel="Confirm site readiness"
                timestamp={actionState.siteReadinessConfirmedAt}
                busy={meterBusy}
                onClick={onConfirmSiteReadiness}
                toolbarOutlineButtonClass={toolbarOutlineButtonClass}
                formatWhen={formatWhen}
              />
              <WorkflowCompletedActionButton
                completed={actionState.crewCompleted}
                completedLabel="Crew completed ✓"
                pendingLabel="Crew completed"
                timestamp={actionState.crewCompletedAt}
                busy={meterBusy}
                disabled={!scheduledDate && !actionState.meterSetScheduled}
                onClick={() => onRecordOutcome({ outcome: "completed", actual_date: scheduledDate || undefined })}
                toolbarOutlineButtonClass={toolbarOutlineButtonClass}
                formatWhen={formatWhen}
              />
              <WorkflowCompletedActionButton
                completed={actionState.noShowRecorded}
                completedLabel="No-show recorded ✓"
                pendingLabel="Record no-show"
                busy={meterBusy}
                onClick={() => onRecordOutcome({ outcome: "no_show" })}
                toolbarOutlineButtonClass={toolbarOutlineButtonClass}
                formatWhen={formatWhen}
              />
            </div>
          ) : (
            <p className={mutedClass}>Choreography does not start until inspection release is recorded in this record.</p>
          )}

          {lifecycleStatus?.guards?.can_complete_stage_9 ? (
            <Button type="button" size="sm" disabled={meterBusy} onClick={onCompleteStage9}>
              Mark Stage 9 complete
            </Button>
          ) : (
            <p className={mutedClass}>
              Stage 9 is marked complete only after release, scheduled meter set, milestone, and site readiness.
            </p>
          )}
        </CardContent>
      </Card>

      <Card className="border-border/60">
        <CardHeader className="pb-2">
          <CardTitle className={sectionTitleClass}>Energization & closeout</CardTitle>
          <CardDescription className="text-xs">
            Hard-block without utility confirmation, final meter reading, commissioning sign-off, and the five-section PDF.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-xs">
          {record?.energization_date_conflict ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 px-2 py-1.5">
              <p>Energization date conflicts with the target date.</p>
              <Button type="button" size="sm" variant="outline" disabled={closeoutBusy} onClick={onResolveDateConflict}>
                Keep actual date
              </Button>
            </div>
          ) : null}
          <ul className="space-y-2">
            {closeoutArtifactRows.map(({ key, label }) => {
              const resolution = resolveCloseoutArtifactEvidence({
                record,
                key,
                communications,
                milestones,
              });
              return (
                <CloseoutArtifactEvidenceRow
                  key={key}
                  artifactKey={key}
                  label={label}
                  resolution={resolution}
                  closeoutBusy={closeoutBusy}
                  onConfirm={onAttachArtifact}
                  mutedClass={mutedClass}
                  formatWhen={formatWhen}
                />
              );
            })}
            <li className="flex flex-wrap items-center justify-between gap-2">
              <span>
                Closeout PDF: {actionState.closeoutPdfGenerated ? "archived" : "not generated"}
                {actionState.closeoutPdfGenerated && actionState.closeoutPdfGeneratedAt ? (
                  <span className={cn("ml-1 tabular-nums", mutedClass)}>
                    · {formatWhen(actionState.closeoutPdfGeneratedAt)}
                  </span>
                ) : null}
                {actionState.closeoutPdfGenerated && actionState.closeoutPdfFileName ? (
                  <span className={cn("ml-1", mutedClass)}>· {actionState.closeoutPdfFileName}</span>
                ) : null}
              </span>
              <div className="flex flex-wrap items-center gap-1.5">
                {actionState.closeoutPdfGenerated && onOpenCloseoutPdf ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className={toolbarOutlineButtonClass}
                    disabled={closeoutPdfOpenBusy}
                    onClick={onOpenCloseoutPdf}
                  >
                    {closeoutPdfOpenBusy ? (
                      <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                    ) : (
                      <Eye className="mr-1 h-3 w-3 shrink-0" />
                    )}
                    View closeout PDF
                  </Button>
                ) : null}
                {actionState.closeoutPdfGenerated ? (
                  <Badge variant="secondary" className="text-[10px]">
                    <CheckCircle2 className="mr-1 inline h-3 w-3" />
                    Archived ✓
                  </Badge>
                ) : null}
              </div>
            </li>
          </ul>
          <div className="flex flex-wrap items-end gap-2">
            <Input
              type="date"
              className="h-8 w-40"
              value={energizeDate}
              onChange={(e) => setEnergizeDate(e.target.value)}
              aria-label="Energization date"
              disabled={actionState.energizationCaptured}
            />
            <WorkflowCompletedActionButton
              completed={actionState.energizationCaptured}
              completedLabel="Energized ✓"
              pendingLabel="Mark energized"
              timestamp={actionState.energizationActualDate}
              busy={closeoutBusy}
              disabled={!energizeDate}
              onClick={() => onMarkEnergized(energizeDate)}
              toolbarOutlineButtonClass={toolbarOutlineButtonClass}
              formatWhen={formatWhen}
            />
            <WorkflowCompletedActionButton
              completed={actionState.closeoutPdfGenerated}
              completedLabel="PDF generated ✓"
              pendingLabel="Generate closeout PDF"
              timestamp={actionState.closeoutPdfGeneratedAt}
              busy={closeoutBusy}
              onClick={onGenerateCloseout}
              toolbarOutlineButtonClass={toolbarOutlineButtonClass}
              formatWhen={formatWhen}
            />
            {lifecycleStatus?.guards?.can_complete_stage_10 ? (
              <Button type="button" size="sm" disabled={closeoutBusy} onClick={onCompleteStage10}>
                Mark Stage 10 complete
              </Button>
            ) : null}
          </div>
          {closeout?.missing?.length ? (
            <p className={mutedClass}>Still needed: {closeout.missing.join(", ").replace(/_/g, " ")}</p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

export function LifecycleProposalActions({
  proposal,
  lifecycleProposals,
  busy,
  onApply,
  onReject,
  formatLifecycleState,
  mutedClass,
}: {
  proposal: UciLifecycleProposalRow;
  lifecycleProposals: UciLifecycleProposalsPayload;
  busy: boolean;
  onApply: () => void;
  onReject: () => void;
  formatLifecycleState: (state: string | undefined) => string;
  mutedClass: string;
}) {
  if (proposal.applied || proposal.rejected) return null;
  if (proposal.blocked_reason) return null;

  return (
    <div className="mt-2 flex flex-wrap gap-2">
      <Button type="button" size="sm" disabled={busy} onClick={onApply}>
        {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
        Accept stage {proposal.proposed_stage}
      </Button>
      <Button type="button" size="sm" variant="outline" disabled={busy} onClick={onReject}>
        Reject
      </Button>
      <span className={cn("self-center text-[10px]", mutedClass)}>
        {formatLifecycleState(proposal.proposed_state)} · checksum protected
      </span>
    </div>
  );
}

export function useSyncRunPolling(
  coordinationId: string | null,
  pollFn: (id: string) => Promise<{ runs: UciPortalSyncRun[]; activeRun: UciPortalSyncRun | null }>,
  onTerminal?: () => void,
) {
  const [runs, setRuns] = useState<UciPortalSyncRun[]>([]);
  const [activeRun, setActiveRun] = useState<UciPortalSyncRun | null>(null);
  const [loading, setLoading] = useState(false);
  const [pollError, setPollError] = useState<string | null>(null);
  const failCountRef = useRef(0);
  const inFlightRef = useRef(false);
  const onTerminalRef = useRef(onTerminal);

  useEffect(() => {
    onTerminalRef.current = onTerminal;
  }, [onTerminal]);

  const refresh = useCallback(async () => {
    if (!coordinationId || inFlightRef.current) return;
    inFlightRef.current = true;
    setLoading(true);
    try {
      const result = await pollFn(coordinationId);
      failCountRef.current = 0;
      setPollError(null);
      setRuns(result.runs);
      setActiveRun(result.activeRun);
      const terminal = ["completed", "failed", "cancelled"].includes(
        String(result.activeRun?.status || "").toLowerCase(),
      );
      if (terminal) onTerminalRef.current?.();
    } catch (e: unknown) {
      failCountRef.current += 1;
      setPollError(e instanceof Error ? e.message : "Failed to load sync runs");
    } finally {
      inFlightRef.current = false;
      setLoading(false);
    }
  }, [coordinationId, pollFn]);

  useEffect(() => {
    if (!coordinationId) {
      setRuns([]);
      setActiveRun(null);
      setPollError(null);
      failCountRef.current = 0;
      return;
    }

    let cancelled = false;
    let timeoutId = 0;
    let delayMs = 4000;

    const schedule = () => {
      if (cancelled) return;
      timeoutId = window.setTimeout(() => {
        if (cancelled) return;
        void refresh().finally(() => {
          if (cancelled) return;
          if (failCountRef.current > 0) {
            delayMs = Math.min(delayMs * 2, 60000);
          } else {
            delayMs = 4000;
          }
          schedule();
        });
      }, delayMs);
    };

    void refresh();
    const storedJobId = sessionStorage.getItem(`uci-active-sync-run:${coordinationId}`);
    if (storedJobId) {
      schedule();
    }

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
      failCountRef.current = 0;
      inFlightRef.current = false;
    };
  }, [coordinationId, refresh]);

  return { runs, activeRun, loading, pollError, refresh };
}

export function getRecordProviderMapping(
  record: CoordinationRecord | null | undefined,
): UciProviderMappingMetadata | null {
  if (!record?.metadata) return null;
  const raw = record.metadata.uci_provider_mapping;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  return raw as UciProviderMappingMetadata;
}
