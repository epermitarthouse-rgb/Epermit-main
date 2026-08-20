import { useEffect, useMemo, useState } from "react";
import { AlertCircle, CheckCircle2, ChevronDown, Loader2 } from "lucide-react";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import {
  DEFAULT_LOAD_REVIEW_TAB,
  consolidateCandidatesForReview,
  findReplacementCandidate,
  formatCandidateEntityLabel,
  formatCandidateFieldLabel,
  formatCandidateValue,
  formatVerifiedApprovalMethod,
  getApprovedVerifiedValues,
  getLoadReviewSummaryHeader,
  getLoadReviewTabCandidates,
  getUnresolvedBlockingReason,
  groupCandidatesByEntity,
  groupPendingReviewCandidates,
  groupStaleHistoryCandidates,
  isCandidateApprovalBlocked,
  persistLoadReviewTab,
  readStoredLoadReviewTab,
  verifiedValueSatisfiesConnectedLoad,
  type LoadReviewTab,
  type PendingReviewGroup,
  type UciLoadCandidate,
  type UciLoadProfileSummary,
  type UciVerifiedLoadValue,
} from "@/lib/uciLoadProfile";
import {
  getDefaultReviewQueueTab,
  getLoadExtractionEligibility,
  getLoadProfileScopeCopy,
} from "@/lib/uciLoadProfileWorkspace";

const PENDING_GROUP_LABELS: Record<PendingReviewGroup, string> = {
  package_eligible: "Package-eligible project / service values",
  panels: "Panels",
  equipment: "Equipment",
  specification_reference: "Specification references",
};

const PENDING_GROUP_ORDER: PendingReviewGroup[] = [
  "package_eligible",
  "panels",
  "equipment",
  "specification_reference",
];

export type CandidateResolutionState = Record<
  string,
  {
    action: "approve" | "edit_approve" | "reject" | "keep_unresolved";
    status: "pending" | "error";
    error?: string;
  }
>;

export function ConnectedLoadReviewPanel({
  summary,
  selectedPepcoApplicationId,
  providerName,
  providerSlug,
  connectedLoadReady,
  candidateBusy,
  candidateResolutionState,
  mutedClass,
  toolbarOutlineButtonClass,
  onExtractCandidates,
  onResolveCandidate,
}: {
  summary: UciLoadProfileSummary;
  selectedPepcoApplicationId: string | null;
  providerName?: string | null;
  providerSlug?: string | null;
  connectedLoadReady: boolean;
  candidateBusy: boolean;
  candidateResolutionState: CandidateResolutionState;
  mutedClass: string;
  toolbarOutlineButtonClass: string;
  onExtractCandidates: (refresh?: boolean) => void;
  onResolveCandidate: (
    candidateId: string,
    action: "approve" | "edit_approve" | "reject" | "keep_unresolved",
    opts?: { edited_value?: string; edited_unit?: string; review_note?: string },
  ) => void;
}) {
  const [activeTab, setActiveTab] = useState<LoadReviewTab>(() => {
    const stored = readStoredLoadReviewTab();
    if (stored) return stored;
    return getDefaultReviewQueueTab(summary, selectedPepcoApplicationId);
  });
  const [editCandidateId, setEditCandidateId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [editUnit, setEditUnit] = useState("");
  const [rejectCandidateId, setRejectCandidateId] = useState<string | null>(null);
  const [openStaleGroups, setOpenStaleGroups] = useState<Record<string, boolean>>({});

  useEffect(() => {
    persistLoadReviewTab(activeTab);
  }, [activeTab]);

  const header = useMemo(
    () => getLoadReviewSummaryHeader(summary, selectedPepcoApplicationId),
    [summary, selectedPepcoApplicationId],
  );

  const pendingCandidates = useMemo(
    () => getLoadReviewTabCandidates(summary, "pending", selectedPepcoApplicationId),
    [summary, selectedPepcoApplicationId],
  );
  const pendingGroups = useMemo(
    () => groupPendingReviewCandidates(pendingCandidates),
    [pendingCandidates],
  );
  const unresolvedCandidates = useMemo(
    () => getLoadReviewTabCandidates(summary, "unresolved", selectedPepcoApplicationId),
    [summary, selectedPepcoApplicationId],
  );
  const staleCandidates = useMemo(
    () => getLoadReviewTabCandidates(summary, "stale", selectedPepcoApplicationId),
    [summary, selectedPepcoApplicationId],
  );
  const rejectedCandidates = useMemo(
    () => getLoadReviewTabCandidates(summary, "rejected", selectedPepcoApplicationId),
    [summary, selectedPepcoApplicationId],
  );
  const approvedCandidates = useMemo(
    () => getLoadReviewTabCandidates(summary, "approved", selectedPepcoApplicationId),
    [summary, selectedPepcoApplicationId],
  );
  const approvedValues = useMemo(() => getApprovedVerifiedValues(summary), [summary]);
  const scopeCopy = getLoadProfileScopeCopy({
    providerName,
    providerSlug,
    selectedApplicationId: selectedPepcoApplicationId,
  });
  const extractionEligibility = getLoadExtractionEligibility({
    providerSlug,
    selectedPortalApplicationId: selectedPepcoApplicationId,
    hasAnalyzedLoadProfile: Boolean(summary),
  });
  const staleGroups = useMemo(
    () =>
      groupStaleHistoryCandidates(
        staleCandidates,
        summary.load_extraction?.last_extracted_at ?? null,
      ),
    [staleCandidates, summary.load_extraction?.last_extracted_at],
  );

  const tabCount = (tab: LoadReviewTab): number => header.counts[tab];

  return (
    <div className="mt-4 space-y-3 rounded-md border border-border/60 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-foreground">Connected load review</p>
          <p className={cn("text-[11px]", mutedClass)}>
            Extract candidates from available project, manual-upload, and scoped portal documents,
            then approve values with evidence before package build.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className={toolbarOutlineButtonClass}
            disabled={candidateBusy || !extractionEligibility.eligible}
            title={extractionEligibility.disabledReason ?? undefined}
            onClick={() => onExtractCandidates(false)}
          >
            {candidateBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Extract candidates
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={toolbarOutlineButtonClass}
            disabled={candidateBusy || !extractionEligibility.eligible}
            title={extractionEligibility.disabledReason ?? undefined}
            onClick={() => onExtractCandidates(true)}
          >
            Refresh
          </Button>
        </div>
      </div>

      <p className={cn("text-xs", mutedClass)}>{scopeCopy}</p>

      <LoadReviewSummaryHeader
        header={header}
        connectedLoadReady={connectedLoadReady}
        mutedClass={mutedClass}
      />

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as LoadReviewTab)}>
        <TabsList
          className="grid h-auto w-full grid-cols-2 gap-1 sm:grid-cols-3 lg:grid-cols-5"
          aria-label="Connected load review tabs"
        >
          <TabsTrigger value="pending">Pending ({tabCount("pending")})</TabsTrigger>
          <TabsTrigger value="approved">Approved ({tabCount("approved")})</TabsTrigger>
          <TabsTrigger value="unresolved">Unresolved ({tabCount("unresolved")})</TabsTrigger>
          <TabsTrigger value="stale">Stale ({tabCount("stale")})</TabsTrigger>
          <TabsTrigger value="rejected">Rejected ({tabCount("rejected")})</TabsTrigger>
        </TabsList>

        <TabsContent value="pending" className="mt-3 space-y-4">
          {pendingCandidates.length === 0 ? (
            <EmptyTabState
              title="No pending candidates"
              description="Run extraction after adding or synchronizing documents, or check Unresolved and Stale tabs."
              mutedClass={mutedClass}
            />
          ) : (
            PENDING_GROUP_ORDER.map((groupKey) => {
              const items = pendingGroups[groupKey];
              if (items.length === 0) return null;
              const entityGroups = groupCandidatesByEntity(items);
              return (
                <section key={groupKey} aria-label={PENDING_GROUP_LABELS[groupKey]}>
                  <p className={cn("text-xs font-medium uppercase tracking-wide", mutedClass)}>
                    {PENDING_GROUP_LABELS[groupKey]} ({items.length})
                  </p>
                  <div className="mt-2 space-y-3">
                    {entityGroups.map((entityGroup) => (
                      <div
                        key={entityGroup.entityKey}
                        className="rounded-md border border-border/40 bg-muted/10 p-2"
                      >
                        <p className="text-sm font-medium text-foreground">{entityGroup.entityLabel}</p>
                        <CandidateList
                          candidates={entityGroup.candidates}
                          candidateResolutionState={candidateResolutionState}
                          editCandidateId={editCandidateId}
                          editValue={editValue}
                          editUnit={editUnit}
                          mutedClass={mutedClass}
                          showActions
                          entityFirst
                          onEditStart={(c) => {
                            setEditCandidateId(c.candidate_id);
                            setEditValue(
                              c.normalized_value != null ? String(c.normalized_value) : c.raw_value,
                            );
                            setEditUnit(c.unit ?? "");
                          }}
                          onEditCancel={() => setEditCandidateId(null)}
                          onEditValueChange={setEditValue}
                          onEditUnitChange={setEditUnit}
                          onResolve={onResolveCandidate}
                          onRejectRequest={setRejectCandidateId}
                        />
                      </div>
                    ))}
                  </div>
                </section>
              );
            })
          )}
        </TabsContent>

        <TabsContent value="approved" className="mt-3">
          {approvedCandidates.length === 0 ? (
            <EmptyTabState
              title="No approved values"
              description="Approve candidates from Pending or Unresolved to populate verified load profile values."
              mutedClass={mutedClass}
            />
          ) : (
            <ul className="space-y-3">
              {consolidateCandidatesForReview(approvedCandidates).map((factGroup) => {
                const candidateIds = new Set(
                  factGroup.candidates.map((candidate) => candidate.candidate_id),
                );
                const matchesCandidate = (entry: UciVerifiedLoadValue) =>
                  candidateIds.has(entry.original_candidate_id) ||
                  entry.evidence_sources?.some((source) =>
                    candidateIds.has(source.candidate_id),
                  );
                const verified =
                  approvedValues.find(({ entry }) => matchesCandidate(entry)) ??
                  (summary.verified_values_history ?? [])
                    .map((entry) => ({ key: entry.field_key, entry }))
                    .find(({ entry }) => matchesCandidate(entry));
                return (
                  <ApprovedCandidateCard
                    key={factGroup.logicalFactKey}
                    candidate={factGroup.primary}
                    evidenceCandidates={factGroup.candidates}
                    verified={verified}
                    mutedClass={mutedClass}
                  />
                );
              })}
            </ul>
          )}
        </TabsContent>

        <TabsContent value="unresolved" className="mt-3">
          {unresolvedCandidates.length === 0 ? (
            <EmptyTabState
              title="No unresolved items"
              description="Conflicts, ambiguous values, and blocked candidates appear here when present."
              mutedClass={mutedClass}
            />
          ) : (
            <div className="space-y-3">
              {groupCandidatesByEntity(unresolvedCandidates).map((entityGroup) => (
                <div
                  key={entityGroup.entityKey}
                  className="rounded-md border border-border/40 bg-muted/10 p-2"
                >
                  <p className="text-sm font-medium text-foreground">{entityGroup.entityLabel}</p>
                  <CandidateList
                    candidates={entityGroup.candidates}
                    candidateResolutionState={candidateResolutionState}
                    editCandidateId={editCandidateId}
                    editValue={editValue}
                    editUnit={editUnit}
                    mutedClass={mutedClass}
                    showActions
                    showBlockingReason
                    entityFirst
                    onEditStart={(c) => {
                      setEditCandidateId(c.candidate_id);
                      setEditValue(
                        c.normalized_value != null ? String(c.normalized_value) : c.raw_value,
                      );
                      setEditUnit(c.unit ?? "");
                    }}
                    onEditCancel={() => setEditCandidateId(null)}
                    onEditValueChange={setEditValue}
                    onEditUnitChange={setEditUnit}
                    onResolve={onResolveCandidate}
                    onRejectRequest={setRejectCandidateId}
                  />
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="stale" className="mt-3 space-y-2">
          {staleCandidates.length === 0 ? (
            <EmptyTabState
              title="No stale history"
              description="Superseded candidates from prior extraction schema versions appear here."
              mutedClass={mutedClass}
            />
          ) : (
            staleGroups.map((group) => {
              const groupKey = `${group.schemaVersion}|${group.extractedAt ?? ""}`;
              const isOpen = openStaleGroups[groupKey] === true;
              return (
                <Collapsible
                  key={groupKey}
                  open={isOpen}
                  onOpenChange={(open) =>
                    setOpenStaleGroups((prev) => ({ ...prev, [groupKey]: open }))
                  }
                >
                  <CollapsibleTrigger className="flex w-full items-center justify-between rounded-md border border-border/50 bg-muted/20 px-3 py-2 text-left text-sm hover:bg-muted/30">
                    <span>
                      Schema {group.schemaVersion}
                      {group.extractedAt ? ` · extracted ${group.extractedAt}` : ""}
                      <span className={cn("ml-2 text-xs", mutedClass)}>
                        ({group.candidates.length} candidate
                        {group.candidates.length === 1 ? "" : "s"})
                      </span>
                    </span>
                    <ChevronDown
                      className={cn("h-4 w-4 shrink-0 transition-transform", isOpen && "rotate-180")}
                    />
                  </CollapsibleTrigger>
                  <CollapsibleContent className="pt-2">
                    <CandidateList
                      candidates={group.candidates}
                      candidateResolutionState={candidateResolutionState}
                      editCandidateId={null}
                      editValue=""
                      editUnit=""
                      mutedClass={mutedClass}
                      showActions={false}
                      readOnly
                      replacementResolver={(c) =>
                        findReplacementCandidate(c, summary, selectedPepcoApplicationId)
                      }
                    />
                  </CollapsibleContent>
                </Collapsible>
              );
            })
          )}
        </TabsContent>

        <TabsContent value="rejected" className="mt-3">
          {rejectedCandidates.length === 0 ? (
            <EmptyTabState
              title="No rejected candidates"
              description="Rejected candidates remain visible here for audit purposes only."
              mutedClass={mutedClass}
            />
          ) : (
            <ul className="space-y-3">
              {rejectedCandidates.map((candidate) => (
                <li
                  key={candidate.candidate_id}
                  className="rounded border border-border/50 bg-muted/20 p-2 text-sm"
                >
                  <CandidateMeta candidate={candidate} mutedClass={mutedClass} />
                  {candidate.resolved_at ? (
                    <p className={cn("mt-1 text-xs", mutedClass)}>
                      Rejected {candidate.resolved_at}
                      {candidate.resolved_by ? ` · ${candidate.resolved_by}` : ""}
                    </p>
                  ) : null}
                  {candidate.review_note ? (
                    <p className={cn("mt-1 text-xs", mutedClass)}>Note: {candidate.review_note}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </TabsContent>
      </Tabs>

      <AlertDialog
        open={rejectCandidateId != null}
        onOpenChange={(open) => {
          if (!open) setRejectCandidateId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reject candidate?</AlertDialogTitle>
            <AlertDialogDescription>
              This candidate will move to the Rejected tab. It will not be restored automatically.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (rejectCandidateId) {
                  onResolveCandidate(rejectCandidateId, "reject");
                  setRejectCandidateId(null);
                }
              }}
            >
              Reject
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function LoadReviewSummaryHeader({
  header,
  connectedLoadReady,
  mutedClass,
}: {
  header: ReturnType<typeof getLoadReviewSummaryHeader>;
  connectedLoadReady: boolean;
  mutedClass: string;
}) {
  const { counts } = header;
  return (
    <div className="space-y-2 rounded-md border border-border/40 bg-muted/10 p-2">
      <div className="flex flex-wrap items-center gap-2">
        {connectedLoadReady ? (
          <Badge variant="secondary">Connected load data complete</Badge>
        ) : (
          <Badge variant="outline">Connected load data incomplete</Badge>
        )}
        <Badge variant="outline">
          Package-eligible approved: {header.packageEligibleApprovedCount}
        </Badge>
        {header.extractionStatus ? (
          <Badge variant="mutedLight" className="capitalize">
            Extraction {header.extractionStatus}
          </Badge>
        ) : null}
      </div>
      <p className={cn("text-xs tabular-nums", mutedClass)}>
        Pending {counts.pending} · Approved {counts.approved} · Unresolved {counts.unresolved} ·
        Stale {counts.stale} · Rejected {counts.rejected}
        {header.lastExtractedAt ? ` · Last extraction ${header.lastExtractedAt}` : ""}
      </p>
    </div>
  );
}

function EmptyTabState({
  title,
  description,
  mutedClass,
}: {
  title: string;
  description: string;
  mutedClass: string;
}) {
  return (
    <div className="rounded-md border border-dashed border-border/50 px-3 py-6 text-center">
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className={cn("mt-1 text-xs", mutedClass)}>{description}</p>
    </div>
  );
}

function ApprovedCandidateCard({
  candidate,
  evidenceCandidates,
  verified,
  mutedClass,
}: {
  candidate: UciLoadCandidate;
  evidenceCandidates: UciLoadCandidate[];
  verified?: { key: string; entry: UciVerifiedLoadValue };
  mutedClass: string;
}) {
  const entry = verified?.entry;
  const satisfiesPackage =
    entry && verified ? verifiedValueSatisfiesConnectedLoad(verified.key, entry) : false;
  const displayValue = entry
    ? entry.value != null && typeof entry.value !== "object"
      ? String(entry.value)
      : JSON.stringify(entry.value)
    : formatCandidateValue(candidate);

  return (
    <li className="rounded border border-emerald-500/40 bg-emerald-500/5 p-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden="true" />
        <Badge variant="secondary">Approved</Badge>
        {satisfiesPackage ? (
          <Badge variant="secondary">Satisfies connected_load_data</Badge>
        ) : (
          <Badge variant="mutedLight">Review / supporting value</Badge>
        )}
        {entry?.edited ? <Badge variant="outline">Edited</Badge> : null}
      </div>
      <CandidateMeta
        candidate={candidate}
        evidenceCandidates={evidenceCandidates}
        mutedClass={mutedClass}
      />
      <p className={cn("mt-1 text-xs", mutedClass)}>
        {displayValue}
        {(entry?.unit ?? candidate.unit) ? ` ${entry?.unit ?? candidate.unit}` : ""}
      </p>
      {entry ? (
        <p className={cn("mt-1 text-xs text-emerald-800 dark:text-emerald-200")}>
          Verified input created · {formatVerifiedApprovalMethod(entry.method)} · {entry.approved_at}
        </p>
      ) : (
        <p className={cn("mt-1 flex items-center gap-1 text-xs text-amber-800 dark:text-amber-200")}>
          <AlertCircle className="h-3 w-3" aria-hidden="true" />
          Approval is persisted; this value has since been superseded or needs projection recovery.
        </p>
      )}
      {entry?.review_note ? (
        <p className={cn("mt-1 text-xs", mutedClass)}>Note: {entry.review_note}</p>
      ) : null}
    </li>
  );
}

function CandidateList({
  candidates,
  candidateResolutionState,
  editCandidateId,
  editValue,
  editUnit,
  mutedClass,
  showActions,
  showBlockingReason = false,
  readOnly = false,
  entityFirst = false,
  replacementResolver,
  onEditStart,
  onEditCancel,
  onEditValueChange,
  onEditUnitChange,
  onResolve,
  onRejectRequest,
}: {
  candidates: UciLoadCandidate[];
  candidateResolutionState: CandidateResolutionState;
  editCandidateId: string | null;
  editValue: string;
  editUnit: string;
  mutedClass: string;
  showActions: boolean;
  showBlockingReason?: boolean;
  readOnly?: boolean;
  entityFirst?: boolean;
  replacementResolver?: (candidate: UciLoadCandidate) => UciLoadCandidate | null;
  onEditStart?: (candidate: UciLoadCandidate) => void;
  onEditCancel?: () => void;
  onEditValueChange?: (value: string) => void;
  onEditUnitChange?: (value: string) => void;
  onResolve?: (
    candidateId: string,
    action: "approve" | "edit_approve" | "reject" | "keep_unresolved",
    opts?: { edited_value?: string; edited_unit?: string; review_note?: string },
  ) => void;
  onRejectRequest?: (candidateId: string) => void;
}) {
  return (
    <ul className="mt-2 space-y-3">
      {consolidateCandidatesForReview(candidates).map((factGroup) => {
        const candidate = factGroup.primary;
        const resolution = candidateResolutionState[candidate.candidate_id];
        const resolving = resolution?.status === "pending";
        const isEditing = editCandidateId === candidate.candidate_id;
        const approvalBlocked = isCandidateApprovalBlocked(candidate);
        const replacement = replacementResolver?.(candidate) ?? null;

        return (
          <li
            key={factGroup.logicalFactKey}
            className="rounded border border-border/50 bg-muted/20 p-2 text-sm"
          >
            <CandidateMeta
              candidate={candidate}
              evidenceCandidates={factGroup.candidates}
              mutedClass={mutedClass}
              entityFirst={entityFirst}
            />
            {showBlockingReason ? (
              <p className={cn("mt-1 text-xs font-medium text-amber-800 dark:text-amber-200")}>
                {getUnresolvedBlockingReason(candidate)}
              </p>
            ) : null}
            {!showBlockingReason && candidate.approval_blocked_reason ? (
              <p className={cn("mt-1 text-xs text-amber-800 dark:text-amber-200", mutedClass)}>
                {candidate.approval_blocked_reason}
              </p>
            ) : null}
            {replacement ? (
              <p className={cn("mt-1 text-xs text-emerald-800 dark:text-emerald-200", mutedClass)}>
                Current candidate: {formatCandidateFieldLabel(replacement.field_key)} ={" "}
                {formatCandidateValue(replacement)}
                {replacement.unit ? ` ${replacement.unit}` : ""} ({replacement.candidate_id})
              </p>
            ) : null}
            {readOnly ? (
              <p className={cn("mt-2 text-xs", mutedClass)}>Approval disabled — stale / superseded</p>
            ) : null}
            {showActions && !readOnly && isEditing && onResolve && onEditCancel && onEditValueChange && onEditUnitChange ? (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Input
                  className="h-8 w-28 text-xs"
                  placeholder="Value"
                  value={editValue}
                  onChange={(e) => onEditValueChange(e.target.value)}
                  aria-label="Edited value"
                />
                <Input
                  className="h-8 w-20 text-xs"
                  placeholder="Unit"
                  value={editUnit}
                  onChange={(e) => onEditUnitChange(e.target.value)}
                  aria-label="Edited unit"
                />
                <Button
                  type="button"
                  size="sm"
                  disabled={resolving || !editValue.trim()}
                  onClick={() => {
                    onResolve(candidate.candidate_id, "edit_approve", {
                      edited_value: editValue.trim(),
                      edited_unit: editUnit.trim() || undefined,
                    });
                    onEditCancel();
                  }}
                >
                  Save & approve
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={onEditCancel}>
                  Cancel
                </Button>
              </div>
            ) : null}
            {showActions && !readOnly && !isEditing && onResolve && onEditStart && onRejectRequest ? (
              <div className="mt-2 flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={resolving || approvalBlocked}
                  aria-disabled={resolving || approvalBlocked}
                  title={approvalBlocked ? candidate.approval_blocked_reason ?? "Approval blocked" : undefined}
                  onClick={() => onResolve(candidate.candidate_id, "approve")}
                >
                  {resolving && resolution.action === "approve" ? (
                    <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                  ) : null}
                  Approve
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={resolving}
                  onClick={() => onEditStart(candidate)}
                >
                  Edit & approve
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={resolving}
                  onClick={() => onRejectRequest(candidate.candidate_id)}
                >
                  Reject
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={resolving}
                  onClick={() => onResolve(candidate.candidate_id, "keep_unresolved")}
                >
                  Keep unresolved
                </Button>
              </div>
            ) : null}
            {resolution?.status === "error" ? (
              <p
                className="mt-2 flex items-center gap-1 text-xs text-destructive"
                role="alert"
              >
                <AlertCircle className="h-3 w-3 shrink-0" aria-hidden="true" />
                {resolution.error || "Action failed. Try again."}
              </p>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function CandidateMeta({
  candidate,
  evidenceCandidates = [candidate],
  mutedClass,
  entityFirst = false,
}: {
  candidate: UciLoadCandidate;
  evidenceCandidates?: UciLoadCandidate[];
  mutedClass: string;
  entityFirst?: boolean;
}) {
  const displayValue = formatCandidateValue(candidate);
  const fieldLabel = formatCandidateFieldLabel(candidate.field_key);
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{fieldLabel}</span>
        {!entityFirst ? (
          <Badge variant="outline">{formatCandidateEntityLabel(candidate)}</Badge>
        ) : null}
        <Badge variant="outline">{candidate.status}</Badge>
        {candidate.can_satisfy_package ? (
          <Badge variant="secondary">Can satisfy package</Badge>
        ) : (
          <Badge variant="mutedLight">Review only</Badge>
        )}
        {candidate.conflict_group ? <Badge variant="destructive">Conflict</Badge> : null}
        {candidate.ambiguous ? <Badge variant="mutedLight">Unresolved value</Badge> : null}
        {candidate.status === "stale" ? <Badge variant="destructive">Stale</Badge> : null}
      </div>
      <p className={cn("mt-1 text-sm text-foreground")}>
        {fieldLabel}: {displayValue}
        {candidate.unit ? ` ${candidate.unit}` : ""}
      </p>
      {candidate.schedule_heading ? (
        <p className={cn("mt-1 text-xs", mutedClass)}>Heading: {candidate.schedule_heading}</p>
      ) : null}
      {evidenceCandidates.length > 1 ? (
        <Badge variant="secondary" className="mt-1">
          {evidenceCandidates.length} agreeing sources
        </Badge>
      ) : null}
      <ul className="mt-1 space-y-1">
        {evidenceCandidates.map((evidence) => (
          <li key={evidence.candidate_id} className={cn("text-xs", mutedClass)}>
            <span>
              Source: {evidence.source_document_name}
              {evidence.page_number != null ? ` · p.${evidence.page_number}` : ""} ·{" "}
              {evidence.extraction_method}
              {evidence.confidence != null ? ` · conf ${evidence.confidence}` : ""}
            </span>
            {evidence.evidence_text ? (
              <span className="block italic">&ldquo;{evidence.evidence_text}&rdquo;</span>
            ) : null}
          </li>
        ))}
      </ul>
    </>
  );
}
