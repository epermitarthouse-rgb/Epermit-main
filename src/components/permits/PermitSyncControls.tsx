import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, RefreshCw } from "lucide-react";
import { AlertBanner, StatusPill } from "@/components/design/ProductPrimitives";
import { formatTimestamp } from "@/components/permits/PermitRepositoryViews";
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
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { cancelSyncJob, loadPermitProgress, loadSyncOverview, requestPermitRefresh, requestSourceRefresh } from "@/lib/centralPermits";
import {
  batchLine,
  isPermitBusy,
  jobStateLabel,
  jobTone,
  permitCountsLine,
  phaseLabel,
  phaseTone,
  refreshAllConfirmation,
  refreshResultMessage,
  sourceAllowsManualRefresh,
  sourceOpenJob,
  type PermitProgress,
  type RefreshResult,
  type SyncSourceOverview,
} from "@/lib/permitSync";

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export const SYNC_QUERY_KEY = ["central-permits", "sync"] as const;

/** Sources with refresh state. Polls every 10 s while a refresh is open, every 60 s otherwise. */
export function useSyncOverview(enabled = true) {
  return useQuery({
    queryKey: [...SYNC_QUERY_KEY, "overview"],
    queryFn: loadSyncOverview,
    enabled,
    refetchInterval: (q) => ((q.state.data ?? []).some((s) => sourceOpenJob(s)) ? 10000 : 60000),
  });
}

/** Latest refresh state for the given permits; polls every 10 s while any of them is queued or running. */
export function usePermitProgress(permitIds: string[], enabled = true) {
  const ids = [...permitIds].sort();
  return useQuery({
    queryKey: [...SYNC_QUERY_KEY, "permits", ids],
    queryFn: () => loadPermitProgress(ids),
    enabled: enabled && ids.length > 0,
    refetchInterval: (q) => ([...(q.state.data?.values() ?? [])].some(isPermitBusy) ? 10000 : 60000),
  });
}

function useRefreshToast() {
  const { toast } = useToast();
  const qc = useQueryClient();
  return {
    onSuccess: (r: RefreshResult) => {
      const m = refreshResultMessage(r);
      toast({ title: m.title, description: m.detail });
      void qc.invalidateQueries({ queryKey: SYNC_QUERY_KEY });
    },
    onError: (e: unknown) => toast({ title: "Refresh not started", description: errorText(e), variant: "destructive" }),
  };
}

/**
 * Refresh All (per source). The confirmation names the jurisdiction and the number of permits the source sees,
 * and says when a refresh is already open (the request then joins it instead of starting another).
 */
export function RefreshAllButton({ sources }: { sources: SyncSourceOverview[] }) {
  const refreshable = sources.filter((s) => s.can_refresh && s.permit_count > 0 && sourceAllowsManualRefresh(s.status));
  const [target, setTarget] = useState<SyncSourceOverview | null>(null);
  const handlers = useRefreshToast();
  const run = useMutation({ mutationFn: (credentialId: string) => requestSourceRefresh(credentialId), ...handlers });
  if (!refreshable.length) return null;
  const confirmation = target ? refreshAllConfirmation(target) : null;
  return (
    <>
      {refreshable.map((s) => (
        <Button key={s.credential_id} variant="secondary" disabled={run.isPending} onClick={() => setTarget(s)}>
          <RefreshCw className="mr-2 h-4 w-4" />
          Refresh all{refreshable.length > 1 ? ` · ${s.jurisdiction}` : ""}
        </Button>
      ))}
      <AlertDialog open={!!target} onOpenChange={(o) => { if (!o) setTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmation?.title}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                {confirmation?.body.map((line) => <p key={line}>{line}</p>)}
                {confirmation?.joins ? <p className="font-medium text-foreground">{confirmation.joins}</p> : null}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => { if (target) run.mutate(target.credential_id); setTarget(null); }}>
              {confirmation?.confirm}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/** One banner per source with a refresh queued or running: phase, recorded counts, current permit, cancel. */
export function SyncBatchBanner({ sources }: { sources: SyncSourceOverview[] }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const cancel = useMutation({
    mutationFn: (jobId: string) => cancelSyncJob(jobId),
    onSuccess: () => {
      toast({ title: "Refresh cancelled", description: "Files and reports already captured are kept." });
      void qc.invalidateQueries({ queryKey: SYNC_QUERY_KEY });
    },
    onError: (e) => toast({ title: "Could not cancel", description: errorText(e), variant: "destructive" }),
  });
  const open = sources.map((s) => ({ s, job: sourceOpenJob(s) })).filter((x) => x.job);
  if (!open.length) return null;
  return (
    <div className="space-y-2">
      {open.map(({ s, job }) => job && (
        <div key={s.credential_id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3" data-sync-banner>
          <div className="min-w-0 space-y-1 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">{s.jurisdiction}</span>
              <StatusPill tone={jobTone(job.status)}>{jobStateLabel(job)}</StatusPill>
              <span className="text-muted-foreground">{job.scope === "all" ? "All permits" : "Selected permits"} · {job.trigger === "scheduled" ? "scheduled" : "requested"} {formatTimestamp(job.created_at)}</span>
            </div>
            <p className="tabular-nums">{batchLine(job)}</p>
            {job.status === "running" && job.current_permit_number ? <p className="text-muted-foreground">Now: {job.current_permit_number}</p> : null}
            {job.status === "retry_wait" ? <p className="text-muted-foreground">Next attempt {formatTimestamp(job.next_attempt_at)} (attempt {job.attempt_count} of {job.max_attempts} used)</p> : null}
            {s.queued_job && s.active_job ? <p className="text-muted-foreground">Another refresh is queued after this one ({s.queued_job.permits_total} permits).</p> : null}
          </div>
          {s.can_refresh ? (
            <Button size="sm" variant="outline" disabled={cancel.isPending} onClick={() => cancel.mutate(job.id)}>Cancel refresh</Button>
          ) : null}
        </div>
      ))}
    </div>
  );
}

export function RefreshPermitButton({ permitId, progress, size = "sm" }: { permitId: string; progress?: PermitProgress | null; size?: "sm" | "default" }) {
  const handlers = useRefreshToast();
  const run = useMutation({ mutationFn: () => requestPermitRefresh(permitId), ...handlers });
  const busy = isPermitBusy(progress);
  return (
    <Button size={size} variant="outline" disabled={run.isPending || busy} onClick={() => run.mutate()} title={busy ? phaseLabel(progress?.phase) : "Refresh this permit from the portal"}>
      {run.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
      {busy ? phaseLabel(progress?.phase) : "Refresh"}
    </Button>
  );
}

/** Compact cell for the queue list: phase, counts, last successful refresh. */
export function PermitSyncCell({ progress }: { progress?: PermitProgress | null }) {
  if (!progress || (!progress.phase && !progress.last_success_at)) return <span className="text-xs text-muted-foreground">Not refreshed yet</span>;
  const counts = permitCountsLine(progress);
  return (
    <div className="space-y-0.5 text-xs">
      {progress.phase ? <StatusPill tone={phaseTone(progress.phase)}>{phaseLabel(progress.phase)}</StatusPill> : null}
      {counts ? <p className="tabular-nums text-muted-foreground">{counts}</p> : null}
      {progress.last_success_at ? <p className="text-muted-foreground">Last refreshed {formatTimestamp(progress.last_success_at)}</p> : null}
    </div>
  );
}

/** Detail-page block above the tabs. */
export function PermitSyncPanel({ progress, action }: { progress?: PermitProgress | null; action?: React.ReactNode }) {
  const counts = permitCountsLine(progress);
  const tone = phaseTone(progress?.phase);
  const detail = (
    <div className="space-y-1">
      {counts ? <p className="tabular-nums">{counts}</p> : null}
      <p>Last successful refresh: {progress?.last_success_at ? formatTimestamp(progress.last_success_at) : "never"}</p>
      {progress?.phase === "retrying" && progress.next_attempt_at ? <p>Next attempt {formatTimestamp(progress.next_attempt_at)}</p> : null}
      {progress?.message && (progress.phase === "failed" || progress.phase === "completed_with_warnings" || progress.phase === "completed") ? <p>{progress.message}</p> : null}
    </div>
  );
  return (
    <div className="flex flex-wrap items-start justify-between gap-3" data-permit-sync-panel>
      <AlertBanner className="min-w-[280px] flex-1" tone={tone === "info" ? "info" : tone} title={`Portal refresh: ${phaseLabel(progress?.phase)}`} detail={detail} />
      {action}
    </div>
  );
}
