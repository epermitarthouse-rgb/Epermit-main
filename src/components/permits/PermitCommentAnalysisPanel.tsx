import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertBanner, Panel, StatusPill } from "@/components/design/ProductPrimitives";
import { CentralProcessingPill } from "@/components/permits/PermitPipelineViews";
import { formatTimestamp } from "@/components/permits/PermitRepositoryViews";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { FEATURE_FLAG, useFeatureFlag } from "@/hooks/useFeatureFlags";
import {
  loadCentralDiagnostics,
  loadPermitCommentProcessing,
  retryCentralProcessing,
  type AiBudgetStatus,
  type CentralDiagnosticsRow,
  type PermitCommentProcessing,
} from "@/lib/projectPermits";

/** Permit page: the permit-level analysis state in plain language (D-121). Nothing technical here. */
export function PermitCommentAnalysisSummaryView({ row }: { row: PermitCommentProcessing | undefined }) {
  if (!row || row.processing_state === "no_comments") return null;
  const analysed = row.processed;
  const total = row.source_comments - row.skipped;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-border/60 bg-card px-3 py-2 text-sm" data-testid="permit-comment-analysis">
      <span className="text-muted-foreground">Comment analysis</span>
      <CentralProcessingPill state={row.processing_state} />
      <span className="text-xs text-muted-foreground tabular-nums">
        {analysed} of {total} comment{total === 1 ? "" : "s"} analysed
      </span>
      <span className="text-xs text-muted-foreground">Preliminary AI analysis, not a verified code review.</span>
    </div>
  );
}

const dash = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : String(v));
const usd = (n: number) => `$${n.toFixed(4)}`;

/** Admin Diagnostics tab: versions, fingerprints, failures, cost, and the AI budgets. */
export function CentralDiagnosticsView({
  row,
  budgets,
  busy,
  onRetry,
}: {
  row: CentralDiagnosticsRow | undefined;
  budgets: AiBudgetStatus[];
  busy?: boolean;
  onRetry?: () => void;
}) {
  return (
    <div className="space-y-3 text-sm" data-testid="central-diagnostics">
      {row ? (
        <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
          <dt className="text-muted-foreground">State</dt>
          <dd>{dash(row.status)}</dd>
          <dt className="text-muted-foreground">Processing version</dt>
          <dd className="font-mono text-xs">{dash(row.processing_version)}</dd>
          <dt className="text-muted-foreground">Fingerprint</dt>
          <dd className="font-mono text-xs">
            {dash(row.current_fingerprint)}
            {row.completed_fingerprint && row.completed_fingerprint !== row.current_fingerprint ? " (changed since last completion)" : ""}
          </dd>
          <dt className="text-muted-foreground">Comments</dt>
          <dd className="tabular-nums">
            {row.source_comments} = {row.processed} processed + {row.pending} pending + {row.failed} failed + {row.needs_attention} needs attention + {row.skipped} skipped
          </dd>
          <dt className="text-muted-foreground">Attempts</dt>
          <dd>{dash(row.attempts)}{row.next_attempt_at ? ` · next ${formatTimestamp(row.next_attempt_at)}` : ""}</dd>
          <dt className="text-muted-foreground">Last error</dt>
          <dd className="break-words">{dash(row.last_error)}</dd>
          <dt className="text-muted-foreground">Last completed</dt>
          <dd>{row.last_completed_at ? formatTimestamp(row.last_completed_at) : "—"}</dd>
          <dt className="text-muted-foreground">AI usage</dt>
          <dd className="tabular-nums">
            {row.ai_calls} calls · {row.input_tokens} in / {row.output_tokens} out tokens · {usd(row.cost_usd)}
          </dd>
        </dl>
      ) : (
        <p className="text-muted-foreground">Not analysed yet.</p>
      )}
      {budgets.length ? (
        <div>
          <div className="mb-1 text-xs font-medium text-muted-foreground">AI budgets</div>
          <ul className="space-y-1">
            {budgets.map((b) => (
              <li key={b.scope} className="flex flex-wrap items-center gap-2 tabular-nums">
                <span className="font-mono text-xs">{b.scope}</span>
                <span>
                  {usd(b.used_usd)} of {usd(b.cap_usd)} · {b.calls} calls
                </span>
                {b.closed ? <StatusPill tone="default">Closed</StatusPill> : b.approved ? <StatusPill tone="good">Approved</StatusPill> : <StatusPill tone="warn">Not approved</StatusPill>}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {onRetry ? (
        <Button size="sm" variant="outline" disabled={busy} onClick={onRetry}>
          Analyse comments again
        </Button>
      ) : null}
    </div>
  );
}

export function PermitCommentAnalysisSummary({ permitId }: { permitId: string }) {
  const { enabled } = useFeatureFlag(FEATURE_FLAG.MODULE_CENTRAL_PERMITS);
  const q = useQuery({
    queryKey: ["permit-comment-processing", [permitId]],
    queryFn: () => loadPermitCommentProcessing([permitId]),
    enabled: enabled && !!permitId,
    staleTime: 30_000,
    refetchInterval: (query) => (query.state.data?.get(permitId)?.processing_state === "processing" ? 30_000 : false),
  });
  if (!enabled || q.error) return null;
  return <PermitCommentAnalysisSummaryView row={q.data?.get(permitId)} />;
}

export function PermitCommentAnalysisDiagnostics({ permitId }: { permitId: string }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const q = useQuery({
    queryKey: ["permit-comment-processing", "diagnostics", permitId],
    queryFn: () => loadCentralDiagnostics([permitId]),
    enabled: !!permitId,
  });
  const retry = useMutation({
    mutationFn: () => retryCentralProcessing(permitId),
    onSuccess: () => {
      toast({ title: "Comment analysis will run again on the next sweep." });
      queryClient.invalidateQueries({ queryKey: ["permit-comment-processing"] });
    },
    onError: (e) => toast({ title: "Could not retry", description: e instanceof Error ? e.message : String(e), variant: "destructive" }),
  });
  if (q.error) return <AlertBanner tone="bad" title="Could not load comment analysis diagnostics" detail="Please refresh the page." />;
  if (!q.data?.available) return null;
  return (
    <Panel title="Comment analysis" eyebrow="Permit-level preliminary AI analysis">
      <CentralDiagnosticsView row={q.data.rows[0]} budgets={q.data.budgets} busy={retry.isPending} onRetry={() => retry.mutate()} />
    </Panel>
  );
}
