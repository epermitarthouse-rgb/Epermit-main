import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ResponseMatrixPermitStripView } from "@/components/permits/PermitPipelineViews";
import { useToast } from "@/hooks/use-toast";
import { FEATURE_FLAG, useFeatureFlag } from "@/hooks/useFeatureFlags";
import {
  loadPipelineOverview,
  loadPortalCommentMarkers,
  processingToast,
  requestCommentProcessing,
  type PortalCommentMarker,
} from "@/lib/projectPermits";

const EMPTY = new Map<string, PortalCommentMarker>();

/** Comments that left the portal or changed there after they were answered, keyed by comment id. */
export function usePortalCommentMarkers(projectId: string | null | undefined): ReadonlyMap<string, PortalCommentMarker> {
  const { enabled } = useFeatureFlag(FEATURE_FLAG.MODULE_CENTRAL_PERMITS);
  const q = useQuery({
    queryKey: ["project-permits", "markers", projectId],
    queryFn: () => loadPortalCommentMarkers(projectId as string),
    enabled: enabled && !!projectId,
    staleTime: 60_000,
  });
  return q.data ?? EMPTY;
}

/** The permits feeding this Response Matrix, with their processing state. Hidden when none are linked. */
export function ResponseMatrixPermitStrip({ projectId }: { projectId: string | null | undefined }) {
  const { enabled } = useFeatureFlag(FEATURE_FLAG.MODULE_CENTRAL_PERMITS);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const q = useQuery({
    queryKey: ["project-permits", "overview", "project", projectId],
    queryFn: () => loadPipelineOverview({ projectIds: [projectId as string] }),
    enabled: enabled && !!projectId,
    refetchInterval: (query) =>
      query.state.data?.some((r) => r.processing_state === "processing" || r.processing_state === "waiting") ? 15_000 : false,
  });
  const process = useMutation({
    mutationFn: () => requestCommentProcessing(projectId as string),
    onSuccess: (r) => {
      toast({ title: processingToast(r) });
      queryClient.invalidateQueries({ queryKey: ["project-permits"] });
    },
    onError: (e) => toast({ title: "Could not start processing", description: e instanceof Error ? e.message : String(e), variant: "destructive" }),
  });
  if (!enabled || !projectId) return null;
  const rows = q.data ?? [];
  return (
    <ResponseMatrixPermitStripView
      rows={rows}
      canProcess={rows.some((r) => r.can_edit)}
      busy={process.isPending}
      onProcess={() => process.mutate()}
    />
  );
}
