import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/design/ProductPrimitives";
import { formatTimestamp } from "@/components/permits/PermitRepositoryViews";
import type { PermitListRow } from "@/lib/centralPermits";
import { permitQueuePath } from "@/lib/permitQueue";
import {
  PROCESSING_LABELS,
  discussionOf,
  type LinkedPermit,
  type PipelineOverviewRow,
  type PortalCommentMarker,
  type ProcessingState,
} from "@/lib/projectPermits";

/** Presentational pieces for permit linking and comment processing (D-110..D-116). No data access here. */

export function ProcessingStatePill({ state }: { state: ProcessingState | null | undefined }) {
  if (!state) return null;
  const s = PROCESSING_LABELS[state];
  return (
    <StatusPill tone={s.tone} title={s.detail} data-processing-state={state}>
      {s.label}
    </StatusPill>
  );
}

function commentsLine(row: PipelineOverviewRow | undefined): string | null {
  if (!row || row.processing_state === "no_comments") return null;
  const parts = [`${row.comments_in_matrix} of ${row.portal_comments} comments in the Response Matrix`];
  if (row.comments_changed > 0) parts.push(`${row.comments_changed} updated on the portal`);
  if (row.comments_removed > 0) parts.push(`${row.comments_removed} no longer on the portal`);
  return parts.join(" · ");
}

/** Project side: the permits linked to one project, with processing state and actions. */
export function LinkedPermitList({
  permits,
  overview,
  canEdit,
  isAdmin,
  busy,
  onUnlink,
}: {
  permits: LinkedPermit[];
  overview: ReadonlyMap<string, PipelineOverviewRow>;
  canEdit: boolean;
  isAdmin: boolean;
  busy?: boolean;
  onUnlink?: (permitId: string) => void;
}) {
  if (permits.length === 0) {
    return <p className="text-sm text-muted-foreground">No permit is linked to this project yet.</p>;
  }
  return (
    <ul className="divide-y divide-border/40 text-sm" data-testid="linked-permit-list">
      {permits.map((p) => {
        const row = overview.get(p.permit_id);
        const line = commentsLine(row);
        return (
          <li key={p.permit_id} className="flex flex-wrap items-start justify-between gap-3 py-3">
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono font-semibold">{p.permit_number}</span>
                <ProcessingStatePill state={row?.processing_state} />
              </div>
              <div className="text-muted-foreground">
                {[p.jurisdiction, p.address, p.status_raw].filter(Boolean).join(" · ") || "Details not available"}
              </div>
              {line ? <div className="text-xs text-muted-foreground">{line}</div> : null}
              {isAdmin && row?.last_error ? (
                <div className="text-xs text-destructive" data-testid="pipeline-diagnostic">
                  Admin diagnostic: {row.last_error}
                </div>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Link to={permitQueuePath(p.permit_id)} className="font-medium text-primary hover:underline">
                Open permit →
              </Link>
              {canEdit && onUnlink ? (
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => onUnlink(p.permit_id)}>
                  Unlink
                </Button>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** Permit side: the projects a permit is linked to, with processing state and navigation. */
export function PermitLinkedProjectList({
  rows,
  hiddenCount,
  isAdmin,
  busy,
  onOpenProject,
  onOpenMatrix,
  onProcess,
  onUnlink,
}: {
  rows: PipelineOverviewRow[];
  /** Links to projects the caller cannot see. */
  hiddenCount?: number;
  isAdmin: boolean;
  busy?: boolean;
  onOpenProject?: (projectId: string) => void;
  onOpenMatrix?: (projectId: string) => void;
  onProcess?: (projectId: string) => void;
  onUnlink?: (projectId: string) => void;
}) {
  if (rows.length === 0 && !hiddenCount) {
    return <p className="text-sm text-muted-foreground">No projects are linked to this permit.</p>;
  }
  return (
    <div className="space-y-2">
      <ul className="divide-y divide-border/40 text-sm" data-testid="permit-linked-projects">
        {rows.map((r) => {
          const line = commentsLine(r);
          const retryable = r.processing_state === "needs_attention" || r.processing_state === "retrying" || r.processing_state === "waiting";
          return (
            <li key={r.project_id} className="flex flex-wrap items-start justify-between gap-3 py-3">
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{r.project_name ?? "Project"}</span>
                  <ProcessingStatePill state={r.processing_state} />
                </div>
                <div className="text-xs text-muted-foreground">
                  Linked {formatTimestamp(r.linked_at)}
                  {r.last_completed_at ? ` · Last processed ${formatTimestamp(r.last_completed_at)}` : ""}
                </div>
                {line ? <div className="text-xs text-muted-foreground">{line}</div> : null}
                {isAdmin && r.last_error ? (
                  <div className="text-xs text-destructive" data-testid="pipeline-diagnostic">
                    Admin diagnostic: {r.last_error}
                  </div>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {onOpenMatrix ? (
                  <Button size="sm" variant="outline" onClick={() => onOpenMatrix(r.project_id)}>
                    Response Matrix
                  </Button>
                ) : null}
                {onOpenProject ? (
                  <Button size="sm" variant="ghost" onClick={() => onOpenProject(r.project_id)}>
                    Portal Harvest
                  </Button>
                ) : null}
                {r.can_edit && onProcess && r.processing_state !== "no_comments" ? (
                  <Button size="sm" variant="ghost" disabled={busy || r.processing_state === "processing"} onClick={() => onProcess(r.project_id)}>
                    {retryable ? "Try again" : "Process again"}
                  </Button>
                ) : null}
                {r.can_edit && onUnlink ? (
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => onUnlink(r.project_id)}>
                    Unlink
                  </Button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
      {hiddenCount ? (
        <p className="text-xs text-muted-foreground">
          Also linked to {hiddenCount} project{hiddenCount === 1 ? "" : "s"} you do not have access to.
        </p>
      ) : null}
    </div>
  );
}

/** Search results with add/remove, and a warning when a permit already belongs to another project. */
export function PermitChoiceList({
  rows,
  selectedIds,
  existingLinks,
  excludeProjectId,
  onToggle,
}: {
  rows: PermitListRow[];
  selectedIds: ReadonlySet<string>;
  existingLinks?: ReadonlyMap<string, Array<{ project_id: string; project_name: string | null }>>;
  excludeProjectId?: string | null;
  onToggle: (row: PermitListRow) => void;
}) {
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">No matching permits.</p>;
  return (
    <ul className="divide-y divide-border/40 text-sm" data-testid="permit-choice-list">
      {rows.map((r) => {
        const selected = selectedIds.has(r.id);
        const others = (existingLinks?.get(r.id) ?? []).filter((l) => l.project_id !== excludeProjectId);
        return (
          <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
            <div className="min-w-0">
              <div>
                <span className="font-mono font-semibold">{r.permit_number}</span>
                <span className="ml-2 text-muted-foreground">
                  {[r.jurisdiction, r.address, r.status_raw ?? r.status].filter(Boolean).join(" · ")}
                </span>
              </div>
              {others.length > 0 ? (
                <div className="text-xs text-warning" data-testid="permit-already-linked">
                  Already linked to {others.map((o) => o.project_name ?? "another project").join(", ")}
                </div>
              ) : null}
            </div>
            <Button type="button" size="sm" variant={selected ? "secondary" : "outline"} onClick={() => onToggle(r)} aria-pressed={selected}>
              {selected ? "Selected" : "Select"}
            </Button>
          </li>
        );
      })}
    </ul>
  );
}

/** Response Matrix: a comment that left the portal, or whose portal text changed after it was answered. */
export function PortalCommentMarkerBadge({ marker }: { marker: PortalCommentMarker | undefined }) {
  if (!marker) return null;
  return (
    <div className="mt-1 space-y-1" data-testid="portal-comment-marker">
      {marker.removed_at ? (
        <StatusPill tone="warn" title={`No longer listed on the portal since ${formatTimestamp(marker.removed_at)}. Your response is kept.`}>
          No longer on portal
        </StatusPill>
      ) : null}
      {marker.latest_text ? (
        <details className="text-xs">
          <summary className="cursor-pointer">
            <StatusPill tone="info" className="cursor-pointer">Updated on portal</StatusPill>
          </summary>
          <p className="mt-1 whitespace-pre-wrap rounded border border-border/60 bg-muted/30 p-2 text-muted-foreground">
            {discussionOf(marker.latest_text)}
          </p>
        </details>
      ) : null}
    </div>
  );
}

/** Response Matrix header strip: which permits feed this project and their processing state. */
export function ResponseMatrixPermitStripView({
  rows,
  canProcess,
  busy,
  onProcess,
}: {
  rows: PipelineOverviewRow[];
  canProcess: boolean;
  busy?: boolean;
  onProcess?: () => void;
}) {
  if (rows.length === 0) return null;
  const needsRetry = rows.some((r) => r.processing_state === "needs_attention" || r.processing_state === "retrying");
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md border border-border/60 bg-card px-3 py-2 text-xs" data-testid="response-matrix-permit-strip">
      <span className="text-muted-foreground">Comments from</span>
      {rows.map((r) => (
        <span key={r.permit_id} className="inline-flex items-center gap-2">
          <Link to={permitQueuePath(r.permit_id)} className="font-mono font-semibold text-primary hover:underline">
            {r.permit_number}
          </Link>
          <ProcessingStatePill state={r.processing_state} />
        </span>
      ))}
      {canProcess && onProcess ? (
        <Button size="sm" variant="ghost" className="ml-auto h-7" disabled={busy} onClick={onProcess}>
          {needsRetry ? "Try again" : "Check for new comments"}
        </Button>
      ) : null}
    </div>
  );
}
