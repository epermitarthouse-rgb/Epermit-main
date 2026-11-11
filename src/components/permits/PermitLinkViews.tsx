import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { formatTimestamp } from "@/components/permits/PermitRepositoryViews";
import type { PermitListRow, PermitProjectLink, ProjectPermitLink } from "@/lib/centralPermits";
import { permitQueuePath } from "@/lib/permitQueue";

/** Presentational pieces for the project ↔ permit links (R-1). No data access or hooks here. */

export function ProjectPermitBanner({
  link,
  isAdmin,
  busy,
  onUnlink,
}: {
  link: ProjectPermitLink;
  isAdmin: boolean;
  busy?: boolean;
  onUnlink?: () => void;
}) {
  return (
    <div data-testid="project-permit-banner" className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border/60 p-3 text-sm">
      <div>
        <div className="font-medium">
          Permit record <span className="font-mono">{link.permit_number}</span>
        </div>
        <div className="text-muted-foreground">
          {link.jurisdiction ?? "Jurisdiction unknown"} · {link.status_raw ?? "Status unknown"} · Last synced{" "}
          {formatTimestamp(link.last_synced_at)}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Link to={permitQueuePath(link.permit_id)} className="font-medium text-primary hover:underline">
          Open in Permit Queue →
        </Link>
        {isAdmin && onUnlink ? (
          <Button size="sm" variant="ghost" disabled={busy} onClick={onUnlink}>
            Unlink
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export function NoPermitLinkNotice({ isAdmin }: { isAdmin: boolean }) {
  return (
    <p className="text-sm text-muted-foreground">
      {isAdmin
        ? "This project is not linked to a permit record. Search for the permit below to link it."
        : "This project is not linked to a permit record."}
    </p>
  );
}

export function LinkedProjectsList({
  links,
  isAdmin,
  busy,
  onUnlink,
  onOpenProject,
}: {
  links: PermitProjectLink[];
  isAdmin: boolean;
  busy?: boolean;
  onUnlink?: (projectId: string) => void;
  onOpenProject?: (projectId: string) => void;
}) {
  if (links.length === 0) {
    return <p className="text-sm text-muted-foreground">No projects are linked to this permit.</p>;
  }
  return (
    <ul className="divide-y divide-border/40 text-sm">
      {links.map((l) => (
        <li key={l.project_id} className="flex flex-wrap items-center justify-between gap-3 py-2">
          <div>
            <div className="font-medium">{l.project_name ?? "Project not visible to your account"}</div>
            <div className="text-xs text-muted-foreground">Linked {formatTimestamp(l.created_at)}</div>
          </div>
          <div className="flex flex-wrap gap-2">
            {onOpenProject && l.project_name ? (
              <Button size="sm" variant="ghost" onClick={() => onOpenProject(l.project_id)}>
                Open in Portal Harvest
              </Button>
            ) : null}
            {isAdmin && onUnlink ? (
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => onUnlink(l.project_id)}>
                Unlink
              </Button>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

export function PermitPickerResults({
  rows,
  busy,
  onPick,
}: {
  rows: PermitListRow[];
  busy?: boolean;
  onPick: (permitId: string) => void;
}) {
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">No matching permits.</p>;
  }
  return (
    <ul className="divide-y divide-border/40 text-sm" data-testid="permit-picker-results">
      {rows.map((r) => (
        <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
          <div>
            <span className="font-mono font-semibold">{r.permit_number}</span>
            <span className="ml-2 text-muted-foreground">
              {r.jurisdiction ?? "—"} · {r.status_raw ?? r.status ?? "Status unknown"}
            </span>
          </div>
          <Button size="sm" disabled={busy} onClick={() => onPick(r.id)}>
            Link to project
          </Button>
        </li>
      ))}
    </ul>
  );
}
