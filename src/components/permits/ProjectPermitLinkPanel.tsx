import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { AlertBanner, Panel } from "@/components/design/ProductPrimitives";
import {
  LinkedProjectsList,
  NoPermitLinkNotice,
  PermitPickerResults,
  ProjectPermitBanner,
} from "@/components/permits/PermitLinkViews";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSelectedProjectOptional } from "@/contexts/SelectedProjectContext";
import { useRequireAdmin } from "@/hooks/useRequireAdmin";
import { useToast } from "@/hooks/use-toast";
import { FEATURE_FLAG, useFeatureFlag } from "@/hooks/useFeatureFlags";
import {
  linkProjectToPermit,
  listPermitProjectLinks,
  loadProjectPermitLink,
  searchPermits,
  unlinkProjectFromPermit,
} from "@/lib/centralPermits";

function errorText(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Portal Harvest side of R-1: shows the permit linked to a project and lets platform admins
 * link or unlink one. Renders nothing while `module.central_permits` is off.
 * A link grants no data access (D-006); the RPCs re-check admin and write an audit event.
 */
export function ProjectPermitLinkPanel({ projectId }: { projectId: string | null | undefined }) {
  const { enabled } = useFeatureFlag(FEATURE_FLAG.MODULE_CENTRAL_PERMITS);
  const { isAdmin } = useRequireAdmin();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState("");
  const [submitted, setSubmitted] = useState("");
  const active = enabled && !!projectId;

  const linkQuery = useQuery({
    queryKey: ["central-permits", "project-link", projectId],
    queryFn: () => loadProjectPermitLink(projectId as string),
    enabled: active,
  });
  const link = linkQuery.data ?? null;

  const picker = useQuery({
    queryKey: ["central-permits", "picker", projectId, submitted],
    queryFn: () => searchPermits({ query: submitted, limit: 8 }),
    enabled: active && isAdmin && !link && submitted.trim().length >= 3,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["central-permits"] });

  const linkMutation = useMutation({
    mutationFn: (permitId: string) => linkProjectToPermit(projectId as string, permitId),
    onSuccess: () => {
      toast({ title: "Project linked to permit" });
      setDraft("");
      setSubmitted("");
      invalidate();
    },
    onError: (e) => toast({ title: "Link failed", description: errorText(e), variant: "destructive" }),
  });

  const unlinkMutation = useMutation({
    mutationFn: (permitId: string) => unlinkProjectFromPermit(projectId as string, permitId),
    onSuccess: () => {
      toast({ title: "Permit unlinked" });
      invalidate();
    },
    onError: (e) => toast({ title: "Unlink failed", description: errorText(e), variant: "destructive" }),
  });

  if (!active) return null;

  const busy = linkMutation.isPending || unlinkMutation.isPending;

  return (
    <Panel title="Permit record" eyebrow="Central permit repository" className="space-y-3">
      {linkQuery.isLoading ? (
        <p className="text-sm text-muted-foreground">Checking for a linked permit…</p>
      ) : linkQuery.error ? (
        <AlertBanner tone="bad" title="Could not read the permit link" detail={errorText(linkQuery.error)} />
      ) : link ? (
        <ProjectPermitBanner
          link={link}
          isAdmin={isAdmin}
          busy={busy}
          onUnlink={() => unlinkMutation.mutate(link.permit_id)}
        />
      ) : (
        <NoPermitLinkNotice isAdmin={isAdmin} />
      )}

      {isAdmin && !link && !linkQuery.isLoading ? (
        <div className="space-y-2">
          <form
            className="flex flex-wrap gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              setSubmitted(draft.trim());
            }}
          >
            <Input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Permit number or keyword (3+ characters)"
              className="max-w-xs"
              aria-label="Search permits to link"
            />
            <Button type="submit" variant="outline" disabled={draft.trim().length < 3}>
              Search permits
            </Button>
          </form>
          {picker.isLoading ? (
            <p className="text-sm text-muted-foreground">Searching…</p>
          ) : picker.error ? (
            <AlertBanner tone="bad" title="Search failed" detail={errorText(picker.error)} />
          ) : picker.data ? (
            <PermitPickerResults
              rows={picker.data.rows}
              busy={busy}
              onPick={(permitId) => linkMutation.mutate(permitId)}
            />
          ) : null}
        </div>
      ) : null}
    </Panel>
  );
}

/** Permit Repository side of R-1: the projects linked to a permit, with admin unlink. */
export function PermitProjectLinksPanel({ permitId }: { permitId: string }) {
  const { enabled } = useFeatureFlag(FEATURE_FLAG.MODULE_CENTRAL_PERMITS);
  const { isAdmin } = useRequireAdmin();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const selection = useSelectedProjectOptional();
  const active = enabled && !!permitId;

  const linksQuery = useQuery({
    queryKey: ["central-permits", "permit-links", permitId],
    queryFn: () => listPermitProjectLinks(permitId),
    enabled: active,
  });

  const unlinkMutation = useMutation({
    mutationFn: (projectId: string) => unlinkProjectFromPermit(projectId, permitId),
    onSuccess: () => {
      toast({ title: "Project unlinked" });
      queryClient.invalidateQueries({ queryKey: ["central-permits"] });
    },
    onError: (e) => toast({ title: "Unlink failed", description: errorText(e), variant: "destructive" }),
  });

  if (!active) return null;

  const openProject = selection
    ? (projectId: string) => {
        selection.setSelectedProjectId(projectId);
        navigate("/portal-data");
      }
    : undefined;

  return (
    <Panel title="Linked projects" eyebrow="Portal Harvest">
      {linksQuery.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading linked projects…</p>
      ) : linksQuery.error ? (
        <AlertBanner tone="bad" title="Could not load linked projects" detail={errorText(linksQuery.error)} />
      ) : (
        <LinkedProjectsList
          links={linksQuery.data ?? []}
          isAdmin={isAdmin}
          busy={unlinkMutation.isPending}
          onUnlink={(projectId) => unlinkMutation.mutate(projectId)}
          onOpenProject={openProject}
        />
      )}
    </Panel>
  );
}
