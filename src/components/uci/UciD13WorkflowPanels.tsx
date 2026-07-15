import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronRight, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  UCI_COMMUNICATION_CATEGORIES,
  formatCommunicationClassification,
} from "@/lib/uciCommunicationClassifier";
import type {
  CoordinationCommunication,
  CoordinationCost,
  CoordinationEquipment,
  CoordinationRecord,
  LifecycleState,
  UciLifecycleProposalRow,
  UciLifecycleProposalsPayload,
  UciPortalSyncRun,
  UciPortfolioViewResponse,
  UciProviderMappingMetadata,
} from "@/types/uci";

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
  mutedClass,
  toolbarOutlineButtonClass,
}: {
  comm: CoordinationCommunication;
  busy: boolean;
  onReclassify: (communicationId: string, classification: string) => void;
  mutedClass: string;
  toolbarOutlineButtonClass: string;
}) {
  const [category, setCategory] = useState(comm.classification || "unclassified");
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
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
      <span className={cn("text-[10px]", mutedClass)}>Human override preserved</span>
    </div>
  );
}

export function CosAnalysisPanel({
  coordinationId,
  metadata,
  busy,
  error,
  onAnalyze,
  mutedClass,
  sectionTitleClass,
  toolbarOutlineButtonClass,
}: PanelCommonProps & {
  coordinationId: string;
  metadata: Record<string, unknown>;
  busy: boolean;
  error: string | null;
  onAnalyze: () => void;
}) {
  const analysis = metadata.uci_cos_analysis as Record<string, unknown> | undefined;
  return (
    <Card className="border-border/60">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className={sectionTitleClass}>COS / design review</CardTitle>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className={toolbarOutlineButtonClass}
            disabled={busy}
            onClick={onAnalyze}
          >
            {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
            Analyze
          </Button>
        </div>
      </CardHeader>
      <CardContent className="text-xs">
        {error ? <p className="text-destructive">{error}</p> : null}
        {analysis ? (
          <pre className="max-h-40 overflow-auto rounded bg-muted/20 p-2 text-[10px]">
            {JSON.stringify(analysis, null, 2)}
          </pre>
        ) : (
          <p className={mutedClass}>
            Run discrepancy analysis against load profile and classified COS communications.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export function CostsEquipmentWorkflowPanel({
  costs,
  equipment,
  busy,
  error,
  onSaveCost,
  onCreateEquipment,
  onCheckInEquipment,
  mutedClass,
  sectionTitleClass,
  toolbarOutlineButtonClass,
  formatWhen,
}: PanelCommonProps & {
  costs: CoordinationCost[];
  equipment: CoordinationEquipment[];
  busy: boolean;
  error: string | null;
  onSaveCost: (payload: { cost_type: string; estimated_amount?: string; actual_amount?: string }) => void;
  onCreateEquipment: (payload: { equipment_type: string; initial_eta?: string }) => void;
  onCheckInEquipment: (equipmentId: string, payload: { current_eta?: string }) => void;
}) {
  const [costType, setCostType] = useState("ciac_estimate");
  const [estimated, setEstimated] = useState("");
  const [actual, setActual] = useState("");
  const [equipmentType, setEquipmentType] = useState("transformer");
  const [equipmentEta, setEquipmentEta] = useState("");

  return (
    <div className="space-y-3">
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      <Card className="border-border/60">
        <CardHeader className="pb-2">
          <CardTitle className={sectionTitleClass}>Costs</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-xs">
          {costs.length === 0 ? (
            <p className={mutedClass}>No cost rows yet.</p>
          ) : (
            costs.map((cost) => (
              <div key={cost.id} className="rounded border border-border/40 px-2 py-1.5">
                <p className="font-medium">{cost.cost_type}</p>
                <p className={mutedClass}>
                  Est {cost.estimated_amount ?? "—"} · Actual {cost.actual_amount ?? "—"}
                  {cost.variance_pct != null ? ` · Var ${cost.variance_pct}%` : ""}
                </p>
              </div>
            ))
          )}
          <div className="grid gap-2 sm:grid-cols-3">
            <Input value={costType} onChange={(e) => setCostType(e.target.value)} placeholder="cost_type" />
            <Input value={estimated} onChange={(e) => setEstimated(e.target.value)} placeholder="estimated" />
            <Input value={actual} onChange={(e) => setActual(e.target.value)} placeholder="actual" />
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className={toolbarOutlineButtonClass}
            disabled={busy || !costType.trim()}
            onClick={() =>
              onSaveCost({
                cost_type: costType.trim(),
                estimated_amount: estimated || undefined,
                actual_amount: actual || undefined,
              })
            }
          >
            Save cost
          </Button>
        </CardContent>
      </Card>

      <Card className="border-border/60">
        <CardHeader className="pb-2">
          <CardTitle className={sectionTitleClass}>Equipment</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-xs">
          {equipment.length === 0 ? (
            <p className={mutedClass}>No equipment rows yet.</p>
          ) : (
            equipment.map((item) => (
              <div key={item.id} className="rounded border border-border/40 px-2 py-1.5">
                <p className="font-medium">
                  {item.equipment_type} · {item.status}
                </p>
                <p className={mutedClass}>
                  ETA {formatWhen(item.current_eta)} · Last check-in {formatWhen(item.last_check_in_at)}
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="mt-1 h-7 px-2"
                  disabled={busy}
                  onClick={() => onCheckInEquipment(item.id, { current_eta: item.current_eta ?? undefined })}
                >
                  Record check-in
                </Button>
              </div>
            ))
          )}
          <div className="grid gap-2 sm:grid-cols-2">
            <Input
              value={equipmentType}
              onChange={(e) => setEquipmentType(e.target.value)}
              placeholder="equipment_type"
            />
            <Input
              value={equipmentEta}
              onChange={(e) => setEquipmentEta(e.target.value)}
              placeholder="initial_eta (ISO)"
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
        </CardContent>
      </Card>
    </div>
  );
}

export function MeterSetCloseoutPanel({
  recordMetadata,
  meterBusy,
  closeoutBusy,
  error,
  onPrepareMeterSet,
  onPrepareCloseout,
  mutedClass,
  sectionTitleClass,
  toolbarOutlineButtonClass,
}: PanelCommonProps & {
  recordMetadata: Record<string, unknown>;
  meterBusy: boolean;
  closeoutBusy: boolean;
  error: string | null;
  onPrepareMeterSet: (scheduledDate?: string) => void;
  onPrepareCloseout: () => void;
}) {
  const meterSet = recordMetadata.uci_meter_set_checklist as Record<string, unknown> | undefined;
  const closeout = recordMetadata.uci_closeout_package as Record<string, unknown> | undefined;
  const [scheduledDate, setScheduledDate] = useState("");

  return (
    <div className="space-y-3">
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      <Card className="border-border/60">
        <CardHeader className="pb-2">
          <CardTitle className={sectionTitleClass}>Meter set preparation</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-xs">
          {meterSet ? (
            <pre className="max-h-32 overflow-auto rounded bg-muted/20 p-2 text-[10px]">
              {JSON.stringify(meterSet, null, 2)}
            </pre>
          ) : (
            <p className={mutedClass}>Generate 48h pre-meter-set checklist and milestone row.</p>
          )}
          <Input
            type="date"
            value={scheduledDate}
            onChange={(e) => setScheduledDate(e.target.value)}
            className="h-8"
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            className={toolbarOutlineButtonClass}
            disabled={meterBusy}
            onClick={() => onPrepareMeterSet(scheduledDate || undefined)}
          >
            {meterBusy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
            Prepare meter set
          </Button>
        </CardContent>
      </Card>

      <Card className="border-border/60">
        <CardHeader className="pb-2">
          <CardTitle className={sectionTitleClass}>Closeout preparation</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-xs">
          {closeout ? (
            <pre className="max-h-32 overflow-auto rounded bg-muted/20 p-2 text-[10px]">
              {JSON.stringify(closeout, null, 2)}
            </pre>
          ) : (
            <p className={mutedClass}>Generate energization closeout checklist metadata.</p>
          )}
          <Button
            type="button"
            size="sm"
            variant="outline"
            className={toolbarOutlineButtonClass}
            disabled={closeoutBusy}
            onClick={onPrepareCloseout}
          >
            {closeoutBusy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
            Prepare closeout
          </Button>
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
      if (terminal) onTerminal?.();
    } catch (e: unknown) {
      failCountRef.current += 1;
      setPollError(e instanceof Error ? e.message : "Failed to load sync runs");
    } finally {
      inFlightRef.current = false;
      setLoading(false);
    }
  }, [coordinationId, pollFn, onTerminal]);

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
