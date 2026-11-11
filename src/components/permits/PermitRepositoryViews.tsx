import React from "react";
import { format } from "date-fns";
import { Link } from "react-router-dom";
import { StatusPill, type StatusTone } from "@/components/design/ProductPrimitives";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  currentRows,
  permitFreshness,
  sectionLabel,
  sectionTone,
  type Freshness,
  type PermitListRow,
} from "@/lib/centralPermits";
import { permitQueuePath } from "@/lib/permitQueue";

type Row = Record<string, unknown>;

const str = (v: unknown): string => (v === null || v === undefined ? "" : String(v));

export function formatTimestamp(value: unknown): string {
  if (!value) return "—";
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? "—" : format(d, "MMM d, yyyy h:mm a");
}

const FRESHNESS: Record<Freshness, { tone: StatusTone; label: string }> = {
  fresh: { tone: "good", label: "Fresh" },
  stale: { tone: "warn", label: "Stale" },
  never: { tone: "default", label: "Never synced" },
};

export function FreshnessPill({ lastSyncedAt, now }: { lastSyncedAt: string | null | undefined; now?: Date }) {
  const f = FRESHNESS[permitFreshness(lastSyncedAt, now)];
  return <StatusPill tone={f.tone}>{f.label}</StatusPill>;
}

export function SectionStatusPill({ status }: { status: string | null | undefined }) {
  return <StatusPill tone={sectionTone(status)}>{str(status).replace("_", " ") || "unknown"}</StatusPill>;
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return <p className="py-8 text-center text-sm text-muted-foreground">{children}</p>;
}

const MATCH_LABEL: Record<string, string> = { permit_number: "Permit #", permit: "Details", comments: "Comments" };

/** Permit Queue list, in the columns of the DC portal dashboard plus the project link and freshness. */
export function PermitListTable({ rows, now, linkCounts }: { rows: PermitListRow[]; now?: Date; linkCounts?: ReadonlyMap<string, number> }) {
  if (!rows.length) return <EmptyState>No permits match. You only see permits you have been granted access to.</EmptyState>;
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Permit number</TableHead>
            <TableHead>Description</TableHead>
            <TableHead>Location</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Tasks</TableHead>
            <TableHead>Project</TableHead>
            <TableHead>Freshness</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => {
            const linked = linkCounts?.get(r.id) ?? 0;
            return (
              <TableRow key={r.id} data-permit-row>
                <TableCell>
                  <Link to={permitQueuePath(r.id)} className="font-mono font-semibold text-primary hover:underline">
                    {r.permit_number}
                  </Link>
                  {r.jurisdiction ? <p className="text-xs text-muted-foreground">{r.jurisdiction}</p> : null}
                  {r.matched_in ? <p className="text-[11px] text-muted-foreground">Matched in {MATCH_LABEL[r.matched_in]}</p> : null}
                </TableCell>
                <TableCell className="max-w-[320px] text-sm">{r.description || r.title || "—"}</TableCell>
                <TableCell className="text-sm">{r.address ?? "—"}</TableCell>
                <TableCell>
                  <span>{r.status_raw ?? r.status ?? "—"}</span>
                  {r.removed_from_portal_at ? <StatusPill tone="warn" className="ml-2">No longer on portal</StatusPill> : null}
                </TableCell>
                <TableCell className="text-right tabular-nums">{r.uncompleted_tasks ?? "—"}</TableCell>
                <TableCell className="text-sm">
                  {linkCounts ? (linked ? <StatusPill tone="info">Linked{linked > 1 ? ` (${linked})` : ""}</StatusPill> : <span className="text-muted-foreground">Not linked</span>) : "—"}
                </TableCell>
                <TableCell><FreshnessPill lastSyncedAt={r.last_synced_at} now={now} /></TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

export function SimpleTable({ columns, rows, empty }: { columns: Array<[string, (r: Row) => React.ReactNode]>; rows: Row[]; empty: string }) {
  if (!rows.length) return <EmptyState>{empty}</EmptyState>;
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            {columns.map(([h]) => <TableHead key={h}>{h}</TableHead>)}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r, i) => (
            <TableRow key={str(r.id) || i}>
              {columns.map(([h, cell]) => <TableCell key={h} className="align-top text-sm">{cell(r)}</TableCell>)}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export function SectionHealth({ sections }: { sections: Row[] }) {
  return (
    <SimpleTable
      empty="No sync has recorded section results yet."
      rows={sections}
      columns={[
        ["Section", (r) => sectionLabel(str(r.section))],
        ["Result", (r) => <SectionStatusPill status={str(r.status)} />],
        ["Items", (r) => str(r.item_count) || "—"],
        ["Last success", (r) => formatTimestamp(r.last_ok_at)],
        ["Last attempt", (r) => formatTimestamp(r.last_attempt_at)],
      ]}
    />
  );
}

export function ReviewsView({ comments, responses }: { comments: Row[]; responses: Row[] }) {
  const visible = currentRows(comments);
  if (!visible.length) return <EmptyState>No review comments captured.</EmptyState>;
  const byComment = new Map<string, Row[]>();
  for (const r of currentRows(responses)) {
    const k = str(r.comment_key);
    byComment.set(k, [...(byComment.get(k) ?? []), r]);
  }
  return (
    <ol className="space-y-3">
      {visible.map((c) => (
        <li key={str(c.id)} className="rounded-lg border border-border/60 p-4">
          <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="font-mono">Ref #{str(c.ref_number) || "?"}</span>
            {c.department ? <span>{str(c.department)}</span> : null}
            {c.cycle ? <span>Cycle {str(c.cycle)}</span> : null}
            {c.status ? <StatusPill tone={/unresolved/i.test(str(c.status)) ? "warn" : "default"}>{str(c.status)}</StatusPill> : null}
            <span>{formatTimestamp(c.reviewed_at)}</span>
          </div>
          <p className="whitespace-pre-wrap text-sm">{str(c.body)}</p>
          {(byComment.get(str(c.portal_comment_key)) ?? []).map((r) => (
            <div key={str(r.id)} className="mt-3 border-l-2 border-primary/40 pl-3 text-sm">
              <p className="text-xs text-muted-foreground">
                Response{r.responder_role ? ` · ${str(r.responder_role)}` : ""} · {formatTimestamp(r.responded_at)}
              </p>
              <p className="whitespace-pre-wrap">{str(r.body)}</p>
            </div>
          ))}
        </li>
      ))}
    </ol>
  );
}

export function TasksView({ workflows, tasks }: { workflows: Row[]; tasks: Row[] }) {
  return (
    <div className="space-y-6">
      <SimpleTable
        empty="No workflows captured."
        rows={currentRows(workflows)}
        columns={[
          ["Workflow", (r) => str(r.name) || str(r.subtype) || "—"],
          ["State", (r) => str(r.state) || "—"],
          ["Current activity", (r) => str(r.current_activity) || "—"],
          ["Started", (r) => formatTimestamp(r.started_at)],
          ["Completed", (r) => formatTimestamp(r.completed_at)],
        ]}
      />
      <SimpleTable
        empty="No open tasks."
        rows={currentRows(tasks)}
        columns={[
          ["Task", (r) => str(r.name) || "—"],
          ["Group", (r) => str(r.group_name) || "—"],
          ["Status", (r) => str(r.status) || "—"],
          ["Started", (r) => formatTimestamp(r.started_at)],
          ["Due", (r) => formatTimestamp(r.due_at)],
        ]}
      />
    </div>
  );
}

export function DocumentsView({ documents }: { documents: Row[] }) {
  return (
    <SimpleTable
      empty="No documents captured."
      rows={currentRows(documents)}
      columns={[
        ["File", (r) => <span className="break-all">{str(r.file_name)}</span>],
        ["Version", (r) => str(r.version) || "—"],
        ["Folder", (r) => str(r.folder_name) || "—"],
        ["Status", (r) => str(r.file_status) || "—"],
        ["Uploaded", (r) => formatTimestamp(r.uploaded_at)],
        ["Copy", (r) => (r.download_status === "stored" ? "Stored" : "Metadata only")],
      ]}
    />
  );
}

export function ReportsView({ reports }: { reports: Row[] }) {
  return (
    <SimpleTable
      empty="No reports listed."
      rows={currentRows(reports)}
      columns={[
        ["Report", (r) => str(r.name)],
        ["Category", (r) => str(r.category) || "—"],
        ["First seen", (r) => formatTimestamp(r.first_seen_at)],
      ]}
    />
  );
}

const CHANGE_TONE: Record<string, StatusTone> = { created: "info", updated: "default", removed: "warn", restored: "good" };

export function HistoryView({ changes }: { changes: Row[] }) {
  return (
    <SimpleTable
      empty="No changes recorded."
      rows={changes}
      columns={[
        ["When", (r) => formatTimestamp(r.detected_at)],
        ["Section", (r) => sectionLabel(str(r.section))],
        ["Change", (r) => <StatusPill tone={CHANGE_TONE[str(r.change_type)] ?? "default"}>{str(r.change_type)}</StatusPill>],
        ["Item", (r) => <span className="font-mono text-xs">{str(r.entity_key)}</span>],
        ["Fields", (r) => {
          const f = r.field_changes as Record<string, unknown> | null;
          return f ? Object.keys(f).sort().join(", ") : "—";
        }],
      ]}
    />
  );
}

export function SourcesView({ sources }: { sources: Row[] }) {
  return (
    <SimpleTable
      empty="No portal account currently lists this permit."
      rows={sources}
      columns={[
        ["Source account", (r) => <span className="font-mono text-xs">{str(r.credential_id).slice(0, 8)}…</span>],
        ["First seen", (r) => formatTimestamp(r.first_seen_at)],
        ["Last seen", (r) => formatTimestamp(r.last_seen_at)],
        ["Missing since", (r) => (r.unseen_since ? formatTimestamp(r.unseen_since) : "—")],
      ]}
    />
  );
}
