import { useQuery } from "@tanstack/react-query";
import { CentralProcessingPill, ProcessingStatePill } from "@/components/permits/PermitPipelineViews";
import { FEATURE_FLAG, useFeatureFlag } from "@/hooks/useFeatureFlags";
import {
  loadPermitCommentProcessing,
  loadPipelineOverview,
  summarizeProjectState,
  type PermitCommentProcessing,
  type PipelineOverviewRow,
} from "@/lib/projectPermits";

/** Comment-processing rows for the linked permits on the current page, grouped by permit. */
export function usePermitCommentStates(permitIds: string[], enabled: boolean) {
  const { enabled: flagOn } = useFeatureFlag(FEATURE_FLAG.MODULE_CENTRAL_PERMITS);
  const ids = [...new Set(permitIds)].sort();
  const q = useQuery({
    queryKey: ["project-permits", "overview", "permits", ids],
    queryFn: () => loadPipelineOverview({ permitIds: ids }),
    enabled: enabled && flagOn && ids.length > 0,
    staleTime: 30_000,
    refetchInterval: (query) =>
      query.state.data?.some((r) => r.processing_state === "processing" || r.processing_state === "waiting") ? 20_000 : false,
  });
  const byPermit = new Map<string, PipelineOverviewRow[]>();
  for (const row of q.data ?? []) {
    const list = byPermit.get(row.permit_id) ?? [];
    list.push(row);
    byPermit.set(row.permit_id, list);
  }
  return { byPermit, ready: flagOn && enabled };
}

/** Permit-level analysis state (D-121) for every permit on the current page, linked or not. */
export function usePermitCentralProcessing(permitIds: string[], enabled: boolean) {
  const { enabled: flagOn } = useFeatureFlag(FEATURE_FLAG.MODULE_CENTRAL_PERMITS);
  const ids = [...new Set(permitIds)].sort();
  const q = useQuery({
    queryKey: ["permit-comment-processing", ids],
    queryFn: () => loadPermitCommentProcessing(ids),
    enabled: enabled && flagOn && ids.length > 0,
    staleTime: 30_000,
    refetchInterval: (query) => ([...(query.state.data?.values() ?? [])].some((r) => r.processing_state === "processing") ? 30_000 : false),
  });
  return { byPermit: q.data ?? new Map<string, PermitCommentProcessing>(), ready: flagOn && enabled };
}

/**
 * Permit Queue cell: the permit-level analysis state (any permit), then whether its comments reached the
 * Response Matrix of the linked projects you can see.
 */
export function PermitCommentsCell({ rows, central }: { rows: PipelineOverviewRow[] | undefined; central?: PermitCommentProcessing }) {
  const state = summarizeProjectState(rows ?? []);
  const centralState = central && central.processing_state !== "no_comments" ? central.processing_state : null;
  if (!state && !centralState) return <span className="text-sm text-muted-foreground">—</span>;
  const inMatrix = Math.max(0, ...(rows ?? []).map((r) => r.comments_in_matrix ?? 0));
  return (
    <div className="flex flex-col items-start gap-1">
      <CentralProcessingPill state={centralState} />
      <ProcessingStatePill state={state} />
      {inMatrix > 0 ? (
        <span className="text-xs text-muted-foreground tabular-nums">
          {inMatrix} comment{inMatrix === 1 ? "" : "s"} in matrix
        </span>
      ) : null}
    </div>
  );
}
