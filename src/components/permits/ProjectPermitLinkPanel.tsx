import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { AlertBanner, Panel } from "@/components/design/ProductPrimitives";
import { LinkedPermitList, PermitLinkedProjectList } from "@/components/permits/PermitPipelineViews";
import { ProjectPermitPicker } from "@/components/permits/ProjectPermitPicker";
import { Button } from "@/components/ui/button";
import { useSelectedProjectOptional } from "@/contexts/SelectedProjectContext";
import { useAuth } from "@/hooks/useAuth";
import { useRequireAdmin } from "@/hooks/useRequireAdmin";
import { useToast } from "@/hooks/use-toast";
import { FEATURE_FLAG, useFeatureFlag } from "@/hooks/useFeatureFlags";
import type { PermitListRow } from "@/lib/centralPermits";
import { listPermitProjectLinks } from "@/lib/centralPermits";
import {
  canEditProject,
  linkPermitsToProject,
  listProjectPermits,
  loadPipelineOverview,
  processingToast,
  requestCommentProcessing,
  summarizeProjectState,
  unlinkPermitFromProject,
  type PipelineOverviewRow,
} from "@/lib/projectPermits";

function errorText(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}

const ACTIVE_STATES = new Set(["waiting", "processing", "retrying"]);

/** Re-reads processing state while something is in flight. */
function refetchWhileActive(rows: PipelineOverviewRow[] | undefined): number | false {
  return rows?.some((r) => ACTIVE_STATES.has(r.processing_state)) ? 15_000 : false;
}

/** Opens a project's Response Matrix (or Portal Harvest) by selecting it first, as the rest of the app does. */
function useOpenProject() {
  const navigate = useNavigate();
  const selection = useSelectedProjectOptional();
  if (!selection) return null;
  return (projectId: string, path: "/response-matrix" | "/portal-data") => {
    selection.setSelectedProjectId(projectId);
    navigate(path);
  };
}

/**
 * Portal Harvest: the permits linked to the selected project, whether their comments are in the Response
 * Matrix, and (for editors) linking more permits, unlinking, and re-processing. Renders nothing while
 * `module.central_permits` is off. Unlinking never removes comments already in the Response Matrix.
 */
export function ProjectPermitLinkPanel({ projectId }: { projectId: string | null | undefined }) {
  const { enabled } = useFeatureFlag(FEATURE_FLAG.MODULE_CENTRAL_PERMITS);
  const { isAdmin } = useRequireAdmin();
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const open = useOpenProject();
  const [adding, setAdding] = useState(false);
  const [choice, setChoice] = useState<PermitListRow[]>([]);
  const active = enabled && !!projectId;
  const pid = projectId as string;

  const permitsQuery = useQuery({
    queryKey: ["project-permits", "linked", projectId],
    queryFn: () => listProjectPermits(pid),
    enabled: active,
  });
  const overviewQuery = useQuery({
    queryKey: ["project-permits", "overview", "project", projectId],
    queryFn: () => loadPipelineOverview({ projectIds: [pid] }),
    enabled: active && (permitsQuery.data?.length ?? 0) > 0,
    refetchInterval: (q) => refetchWhileActive(q.state.data),
  });
  const editQuery = useQuery({
    queryKey: ["project-permits", "can-edit", projectId, user?.id],
    queryFn: () => canEditProject(user!.id, pid),
    enabled: active && !!user,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["project-permits"] });
    queryClient.invalidateQueries({ queryKey: ["central-permits"] });
  };

  const processMutation = useMutation({
    mutationFn: () => requestCommentProcessing(pid),
    onSuccess: (r) => {
      toast({ title: processingToast(r) });
      invalidate();
    },
    onError: (e) => toast({ title: "Could not start processing", description: errorText(e), variant: "destructive" }),
  });

  const linkMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      const added = await linkPermitsToProject(pid, ids);
      const processing = await requestCommentProcessing(pid).catch(() => null);
      return { added, processing };
    },
    onSuccess: ({ added, processing }) => {
      toast({
        title: added === 1 ? "Permit linked" : `${added} permits linked`,
        description: processing ? processingToast(processing) : "Comments will be added to the Response Matrix shortly.",
      });
      setChoice([]);
      setAdding(false);
      invalidate();
    },
    onError: (e) => toast({ title: "Could not link", description: errorText(e), variant: "destructive" }),
  });

  const unlinkMutation = useMutation({
    mutationFn: (permitId: string) => unlinkPermitFromProject(pid, permitId),
    onSuccess: () => {
      toast({ title: "Permit unlinked", description: "Comments already in the Response Matrix are kept." });
      invalidate();
    },
    onError: (e) => toast({ title: "Could not unlink", description: errorText(e), variant: "destructive" }),
  });

  if (!active) return null;

  const permits = permitsQuery.data ?? [];
  const overview = new Map((overviewQuery.data ?? []).map((r) => [r.permit_id, r]));
  const canEdit = editQuery.data === true || isAdmin;
  const busy = linkMutation.isPending || unlinkMutation.isPending || processMutation.isPending;
  const summary = summarizeProjectState(overviewQuery.data ?? []);
  const retry = summary === "needs_attention" || summary === "retrying";

  return (
    <Panel
      title="Permit records"
      eyebrow="Linked permits"
      className="space-y-3"
      action={
        permits.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {open ? (
              <Button size="sm" variant="outline" onClick={() => open(pid, "/response-matrix")}>
                Open Response Matrix
              </Button>
            ) : null}
            {canEdit && summary && summary !== "no_comments" ? (
              <Button size="sm" variant="ghost" disabled={busy || summary === "processing"} onClick={() => processMutation.mutate()}>
                {retry ? "Try again" : "Process comments now"}
              </Button>
            ) : null}
          </div>
        ) : null
      }
    >
      {permitsQuery.isLoading ? (
        <p className="text-sm text-muted-foreground">Checking for linked permits…</p>
      ) : permitsQuery.error ? (
        <AlertBanner tone="bad" title="Could not load linked permits" detail="Please refresh the page." />
      ) : (
        <LinkedPermitList
          permits={permits}
          overview={overview}
          canEdit={canEdit}
          isAdmin={isAdmin}
          busy={busy}
          onUnlink={(permitId) => unlinkMutation.mutate(permitId)}
        />
      )}

      {canEdit && !permitsQuery.isLoading ? (
        adding ? (
          <div className="space-y-3 rounded-md border border-border/60 p-3">
            <ProjectPermitPicker selected={choice} onChange={setChoice} excludeProjectId={pid} />
            <div className="flex flex-wrap gap-2">
              <Button size="sm" disabled={busy || choice.length === 0} onClick={() => linkMutation.mutate(choice.map((r) => r.id))}>
                {choice.length > 1 ? `Link ${choice.length} permits` : "Link permit"}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => { setAdding(false); setChoice([]); }}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
            {permits.length > 0 ? "Link another permit" : "Link a permit"}
          </Button>
        )
      ) : null}
    </Panel>
  );
}

/** Permit Queue detail: the projects this permit feeds, whether its comments reached each Response Matrix. */
export function PermitProjectLinksPanel({ permitId }: { permitId: string }) {
  const { enabled } = useFeatureFlag(FEATURE_FLAG.MODULE_CENTRAL_PERMITS);
  const { isAdmin } = useRequireAdmin();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const open = useOpenProject();
  const active = enabled && !!permitId;

  const overviewQuery = useQuery({
    queryKey: ["project-permits", "overview", "permit", permitId],
    queryFn: () => loadPipelineOverview({ permitIds: [permitId] }),
    enabled: active,
    refetchInterval: (q) => refetchWhileActive(q.state.data),
  });
  // All links the caller can see on the permit side, to count projects hidden from them.
  const linksQuery = useQuery({
    queryKey: ["central-permits", "permit-links", permitId],
    queryFn: () => listPermitProjectLinks(permitId),
    enabled: active,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["project-permits"] });
    queryClient.invalidateQueries({ queryKey: ["central-permits"] });
  };

  const processMutation = useMutation({
    mutationFn: (projectId: string) => requestCommentProcessing(projectId),
    onSuccess: (r) => {
      toast({ title: processingToast(r) });
      invalidate();
    },
    onError: (e) => toast({ title: "Could not start processing", description: errorText(e), variant: "destructive" }),
  });
  const unlinkMutation = useMutation({
    mutationFn: (projectId: string) => unlinkPermitFromProject(projectId, permitId),
    onSuccess: () => {
      toast({ title: "Project unlinked", description: "Comments already in its Response Matrix are kept." });
      invalidate();
    },
    onError: (e) => toast({ title: "Could not unlink", description: errorText(e), variant: "destructive" }),
  });

  if (!active) return null;

  const rows = overviewQuery.data ?? [];
  const visible = new Set(rows.map((r) => r.project_id));
  const hiddenCount = (linksQuery.data ?? []).filter((l) => !visible.has(l.project_id)).length;

  return (
    <Panel title="Linked projects" eyebrow="Response Matrix">
      {overviewQuery.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading linked projects…</p>
      ) : overviewQuery.error ? (
        <AlertBanner tone="bad" title="Could not load linked projects" detail="Please refresh the page." />
      ) : (
        <PermitLinkedProjectList
          rows={rows}
          hiddenCount={hiddenCount}
          isAdmin={isAdmin}
          busy={processMutation.isPending || unlinkMutation.isPending}
          onOpenMatrix={open ? (projectId) => open(projectId, "/response-matrix") : undefined}
          onOpenProject={open ? (projectId) => open(projectId, "/portal-data") : undefined}
          onProcess={(projectId) => processMutation.mutate(projectId)}
          onUnlink={(projectId) => unlinkMutation.mutate(projectId)}
        />
      )}
    </Panel>
  );
}
