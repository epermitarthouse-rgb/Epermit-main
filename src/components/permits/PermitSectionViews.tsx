import React from "react";
import { AlertBanner, StatusPill, type StatusTone } from "@/components/design/ProductPrimitives";
import { SimpleTable, SourcesView, formatTimestamp } from "@/components/permits/PermitRepositoryViews";
import { Button } from "@/components/ui/button";
import { currentRows, sectionLabel, type PermitDetail } from "@/lib/centralPermits";
import {
  DC_SECTION_SOURCES,
  EXTRACTION_STATUS_LABEL,
  INFO_FIELD_LABELS,
  PERMIT_SECTIONS,
  classifySectionState,
  dcProjectPageUrl,
  formatPortalValue,
  latestSnapshot,
  sectionStateMap,
  snapshotsFor,
  statusSubWorkflows,
  type ExtractionStatus,
  type PermitSection,
} from "@/lib/permitSections";
import {
  DOCUMENT_VIEW_LABEL,
  REPORT_CONTENT_LABEL,
  buildFolderTree,
  documentViewState,
  groupReviews,
  isUnresolved,
  reportContentState,
  reportTable,
  type FileGroup,
  type FolderNode,
} from "@/lib/permitQueue";

/**
 * Permit Queue section views (D-064). Read-only: nothing here changes portal state. Diagnostics
 * (hashes, snapshot and job ids, source routes, portal ids) render only in PermitDiagnosticsView,
 * which the page shows to platform admins. Personal-name columns are never rendered.
 */

type Row = Record<string, unknown>;

const str = (v: unknown): string => (v === null || v === undefined ? "" : String(v));
const dash = (v: unknown): string => str(v) || "—";
const yesNo = (v: unknown): string => (v === true ? "Yes" : v === false ? "No" : "—");

const STATUS_TONE: Record<ExtractionStatus, StatusTone> = {
  ok: "good",
  partial: "warn",
  absent: "default",
  inaccessible: "bad",
  not_captured: "warn",
};

export function ExtractionStatusPill({ status }: { status: ExtractionStatus }) {
  return <StatusPill tone={STATUS_TONE[status]}>{EXTRACTION_STATUS_LABEL[status]}</StatusPill>;
}

function Muted({ children }: { children: React.ReactNode }) {
  return <p className="py-6 text-center text-sm text-muted-foreground">{children}</p>;
}

function FieldList({ fields }: { fields: Array<[string, React.ReactNode]> }) {
  return (
    <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
      {fields.map(([k, v]) => (
        <div key={k} className="flex justify-between gap-4 border-b border-border/40 py-1">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="break-words text-right">{v === "" || v === null || v === undefined ? "—" : v}</dd>
        </div>
      ))}
    </dl>
  );
}

function Mono({ children }: { children: React.ReactNode }) {
  return <span className="break-all font-mono text-xs">{children}</span>;
}

function formatBytes(v: unknown): string {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** Capture status and time for one section, without diagnostics. */
export function SectionStatusLine({ state }: { state: Row | null }) {
  const cls = classifySectionState(state);
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground" data-section-status>
      <ExtractionStatusPill status={cls.status} />
      {state?.last_ok_at ? <span>Last captured {formatTimestamp(state.last_ok_at)}</span> : null}
    </div>
  );
}

function noDataMessage(state: Row | null, what: string): string {
  const cls = classifySectionState(state);
  if (cls.status === "absent") return `The portal does not offer ${what} for this permit.`;
  if (cls.status === "inaccessible") return `${what} could not be read from the portal (${cls.reason}).`;
  if (cls.status === "not_captured") return `${what} were not captured.`;
  return `The portal listed no ${what}.`;
}

// ---- Tasks ------------------------------------------------------------------

export function TasksSectionView({ tasks, state }: { tasks: Row[]; state: Row | null; snapshots?: Row[] }) {
  const visible = currentRows(tasks);
  return (
    <div className="space-y-4">
      <SectionStatusLine state={state} />
      {visible.length ? (
        <SimpleTable
          empty=""
          rows={visible}
          columns={[
            ["Task", (r) => dash(r.name)],
            ["Group", (r) => dash(r.group_name)],
            ["Status", (r) => dash(r.status)],
            ["Accepted", (r) => yesNo(r.accepted)],
            ["Assigned to this account", (r) => yesNo(r.assigned_to_current_account)],
            ["Started", (r) => formatTimestamp(r.started_at)],
            ["Due", (r) => formatTimestamp(r.due_at)],
            ["Completed", (r) => formatTimestamp(r.completed_at)],
          ]}
        />
      ) : (
        <Muted>{noDataMessage(state, "open tasks")}</Muted>
      )}
      {tasks.length > visible.length ? <p className="text-xs text-muted-foreground">{tasks.length - visible.length} earlier task rows are no longer listed on the portal (kept as history).</p> : null}
    </div>
  );
}

// ---- Files ------------------------------------------------------------------

export function FileViewAction({ doc, onView, busy }: { doc: Row; onView?: (doc: Row) => void; busy?: boolean }) {
  const state = documentViewState(doc);
  if (state === "viewable" && onView) {
    return (
      <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => onView(doc)} data-file-view>
        {busy ? "Opening…" : "View"}
      </Button>
    );
  }
  return <span className="text-xs text-muted-foreground" data-file-state={state}>{DOCUMENT_VIEW_LABEL[state]}</span>;
}

function versionLabel(v: unknown): string {
  return str(v) ? `v${str(v)}` : "—";
}

function FileGroupRows({ group, onView, busyId }: { group: FileGroup; onView?: (doc: Row) => void; busyId?: string | null }) {
  const d = group.latest;
  const earlier = group.versions.slice(1);
  return (
    <tr className="border-b border-border/40 align-top" data-file-row>
      <td className="py-2 pr-3">
        <span className="break-all">{dash(d.file_name)}</span>
        {earlier.length ? (
          <details className="mt-1 text-xs text-muted-foreground">
            <summary className="cursor-pointer">Earlier versions ({earlier.length})</summary>
            <ul className="mt-1 space-y-1">
              {earlier.map((v) => (
                <li key={str(v.id)} className="flex flex-wrap items-center gap-2" data-file-version>
                  <span>{versionLabel(v.version)}</span>
                  <span>{dash(v.file_status)}</span>
                  <span>{formatTimestamp(v.uploaded_at)}</span>
                  <FileViewAction doc={v} onView={onView} busy={busyId === str(v.id)} />
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </td>
      <td className="py-2 pr-3">{versionLabel(d.version)}</td>
      <td className="py-2 pr-3">{dash(d.file_status)}</td>
      <td className="py-2 pr-3 whitespace-nowrap">{formatBytes(d.size_bytes)}</td>
      <td className="py-2 pr-3">{dash(d.page_count)}</td>
      <td className="py-2 pr-3 whitespace-nowrap">{formatTimestamp(d.uploaded_at)}</td>
      <td className="py-2">
        <FileViewAction doc={d} onView={onView} busy={busyId === str(d.id)} />
      </td>
    </tr>
  );
}

function FileTable({ files, onView, busyId }: { files: FileGroup[]; onView?: (doc: Row) => void; busyId?: string | null }) {
  if (!files.length) return null;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border/60 text-left text-xs text-muted-foreground">
            <th className="py-1 pr-3 font-medium">File</th>
            <th className="py-1 pr-3 font-medium">Version</th>
            <th className="py-1 pr-3 font-medium">Status</th>
            <th className="py-1 pr-3 font-medium">Size</th>
            <th className="py-1 pr-3 font-medium">Pages</th>
            <th className="py-1 pr-3 font-medium">Uploaded</th>
            <th className="py-1 font-medium">Copy</th>
          </tr>
        </thead>
        <tbody>
          {files.map((g) => <FileGroupRows key={g.key} group={g} onView={onView} busyId={busyId} />)}
        </tbody>
      </table>
    </div>
  );
}

function FolderTreeNode({ node, depth, onView, busyId }: { node: FolderNode; depth: number; onView?: (doc: Row) => void; busyId?: string | null }) {
  const f = node.folder;
  return (
    <details open={depth === 0 && node.totalFiles > 0 && node.totalFiles <= 25} className="rounded-md border border-border/50" data-folder={str(f.name)}>
      <summary className="flex cursor-pointer flex-wrap items-center gap-2 px-3 py-2 text-sm">
        <span className="font-medium">{dash(f.name)}</span>
        <span className="text-xs text-muted-foreground">
          {node.totalFiles} file{node.totalFiles === 1 ? "" : "s"}
          {f.files_count !== null && f.files_count !== undefined ? ` · portal lists ${str(f.files_count)}` : ""}
        </span>
        {f.download_permitted === false ? <StatusPill tone="default">Not downloadable on portal</StatusPill> : null}
      </summary>
      <div className="space-y-2 px-3 pb-3">
        <FileTable files={node.files} onView={onView} busyId={busyId} />
        {node.children.map((c) => <FolderTreeNode key={str(c.folder.id) || str(c.folder.portal_folder_id)} node={c} depth={depth + 1} onView={onView} busyId={busyId} />)}
      </div>
    </details>
  );
}

export function FilesSectionView({
  folders,
  documents,
  state,
  onViewDocument,
  busyDocumentId,
}: {
  folders: Row[];
  documents: Row[];
  state: Row | null;
  snapshots?: Row[];
  onViewDocument?: (doc: Row) => void;
  busyDocumentId?: string | null;
}) {
  const visibleDocs = currentRows(documents);
  const { roots, unfiled } = buildFolderTree(currentRows(folders), visibleDocs);
  const stored = visibleDocs.filter((d) => documentViewState(d) === "viewable").length;
  return (
    <div className="space-y-4">
      <SectionStatusLine state={state} />
      <AlertBanner
        tone="default"
        title={stored ? `${stored} of ${visibleDocs.length} files can be opened` : "No file copies are stored yet"}
        detail={
          stored
            ? "Only files with a stored copy open. Other files show their portal details."
            : "Folders and file details are shown as listed on the portal. A file opens here only after its copy has been captured."
        }
      />
      {!roots.length && !unfiled.length ? <Muted>{noDataMessage(state, "files")}</Muted> : null}
      <div className="space-y-2">
        {roots.map((n) => <FolderTreeNode key={str(n.folder.id) || str(n.folder.portal_folder_id)} node={n} depth={0} onView={onViewDocument} busyId={busyDocumentId} />)}
      </div>
      {unfiled.length ? (
        <div className="space-y-2">
          <h4 className="text-sm font-medium">Files without a listed folder ({unfiled.length})</h4>
          <FileTable files={unfiled} onView={onViewDocument} busyId={busyDocumentId} />
        </div>
      ) : null}
    </div>
  );
}

// ---- Status (permit status, workflows, review steps) --------------------------

export function StatusSectionView({ permit, state, snapshots }: { permit: Row; state: Row | null; snapshots: Row[] }) {
  const snap = latestSnapshot(snapshots, "status");
  const payload = (snap?.payload ?? null) as Row | null;
  const summary = (permit.summary ?? {}) as Row;
  const byGroup = (Array.isArray(summary.unresolved_by_group) ? summary.unresolved_by_group : []) as Row[];
  return (
    <div className="space-y-4">
      <SectionStatusLine state={state} />
      {payload ? (
        <>
          <FieldList
            fields={[
              ["Project status", dash(payload.ProjectStatus)],
              ["Review type", dash(payload.ReviewType)],
              ["Calendar type", dash(payload.CalendarType)],
              ["Time elapsed", formatPortalValue(payload.TimeElapsed)],
              ["Total number of files", dash(payload.TotalNumberOfFiles)],
              ["Uncompleted tasks", dash(payload.UncompleteTaskCount)],
              ["Prescreen status", Array.isArray(payload.PrescreenStatus) && payload.PrescreenStatus.length ? formatPortalValue(payload.PrescreenStatus) : "—"],
              ["Unresolved comments", dash(permit.unresolved_comments)],
            ]}
          />
          {byGroup.length ? (
            <SimpleTable
              empty=""
              rows={byGroup}
              columns={[
                ["Department", (r) => dash(r.group)],
                ["Unresolved", (r) => dash(r.unresolved)],
              ]}
            />
          ) : null}
        </>
      ) : (
        <Muted>{noDataMessage(state, "status data")}</Muted>
      )}
    </div>
  );
}

export function WorkflowsSectionView({ workflows, state, snapshots }: { workflows: Row[]; state: Row | null; snapshots: Row[] }) {
  const visible = currentRows(workflows);
  const steps = statusSubWorkflows(latestSnapshot(snapshots, "status")?.payload);
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <h4 className="text-sm font-medium">Workflows</h4>
        <SectionStatusLine state={state} />
        {visible.length ? (
          <SimpleTable
            empty=""
            rows={visible}
            columns={[
              ["Workflow", (r) => dash(r.name)],
              ["Subtype", (r) => dash(r.subtype)],
              ["State", (r) => dash(r.state)],
              ["Current activity", (r) => dash(r.current_activity)],
              ["Coordinator group", (r) => dash(r.coordinator_group)],
              ["Version", (r) => [str(r.version_num), str(r.version_title)].filter(Boolean).join(" · ") || "—"],
              ["Started", (r) => formatTimestamp(r.started_at)],
              ["Updated", (r) => formatTimestamp(r.portal_updated_at)],
              ["Completed", (r) => formatTimestamp(r.completed_at)],
            ]}
          />
        ) : (
          <Muted>{noDataMessage(state, "workflows")}</Muted>
        )}
      </div>
      <div className="space-y-2">
        <h4 className="text-sm font-medium">Review steps</h4>
        {steps.length ? (
          <SimpleTable
            empty=""
            rows={steps}
            columns={[
              ["Step", (r) => dash(r.SubWorkflow)],
              ["Status", (r) => dash(r.StatusName)],
              ["Unresolved comments", (r) => dash(r.UnresolvedComments)],
              ["By department", (r) => {
                const g = Array.isArray(r.UnresolvedByGroup) ? (r.UnresolvedByGroup as Row[]) : [];
                return g.length ? g.map((x) => `${str(x.GroupName)}: ${str(x.UnresolvedComments ?? 0)}`).join(", ") : "—";
              }],
              ["Open tasks", (r) => {
                const t = Array.isArray(r.UncompletedTasks) ? (r.UncompletedTasks as Row[]) : [];
                return t.length ? t.map((x) => [str(x.TaskName), str(x.GroupName)].filter(Boolean).join(" · ")).join("; ") : "—";
              }],
              ["Applicant time", (r) => formatPortalValue(r.ApplicationDuration) || "—"],
              ["Jurisdiction time", (r) => formatPortalValue(r.JurisdictionDuration) || "—"],
              ["Total time", (r) => formatPortalValue(r.TotalDuration) || "—"],
            ]}
          />
        ) : (
          <p className="text-sm text-muted-foreground">No review steps in the status capture.</p>
        )}
      </div>
    </div>
  );
}

// ---- Info -------------------------------------------------------------------

export function InfoSectionView({ permit, state, snapshots }: { permit: Row; state: Row | null; snapshots: Row[] }) {
  const snap = latestSnapshot(snapshots, "info");
  const payload = (snap?.payload ?? null) as Row | null;
  const known = new Set(INFO_FIELD_LABELS.map(([k]) => k));
  const extra = payload ? Object.keys(payload).filter((k) => !known.has(k)).sort() : [];
  return (
    <div className="space-y-4">
      <SectionStatusLine state={state} />
      {payload ? (
        <FieldList
          fields={[
            ["Permit number", dash(permit.permit_number)],
            ...INFO_FIELD_LABELS.map(([k, label]) => [label, formatPortalValue(payload[k])] as [string, React.ReactNode]),
            ...extra.map((k) => [k, formatPortalValue(payload[k])] as [string, React.ReactNode]),
          ]}
        />
      ) : (
        <Muted>{noDataMessage(state, "project info fields")}</Muted>
      )}
    </div>
  );
}

// ---- Reports ----------------------------------------------------------------

export function ReportsSectionView({
  reports,
  state,
  selectedReportKey,
  onViewReport,
  viewer,
}: {
  reports: Row[];
  state: Row | null;
  snapshots?: Row[];
  selectedReportKey?: string | null;
  onViewReport?: (report: Row) => void;
  viewer?: React.ReactNode;
}) {
  const visible = currentRows(reports);
  const captured = visible.filter((r) => reportContentState(r) === "captured").length;
  return (
    <div className="space-y-4">
      <SectionStatusLine state={state} />
      {!captured && visible.length ? (
        <AlertBanner
          tone="default"
          title="Report contents have not been captured yet"
          detail="These are the reports the portal offers for this permit. A report opens here only after its content has been captured."
        />
      ) : null}
      <SimpleTable
        empty={noDataMessage(state, "reports")}
        rows={visible}
        columns={[
          ["Report", (r) => dash(r.name)],
          ["Category", (r) => dash(r.category)],
          ["Content", (r) => {
            const s = reportContentState(r);
            return <span data-report-state={s}>{REPORT_CONTENT_LABEL[s]}</span>;
          }],
          ["Captured", (r) => formatTimestamp(r.content_captured_at)],
          ["", (r) =>
            reportContentState(r) === "captured" && onViewReport ? (
              <Button
                type="button"
                size="sm"
                variant={selectedReportKey === str(r.report_key) ? "secondary" : "outline"}
                onClick={() => onViewReport(r)}
                data-report-view
              >
                View
              </Button>
            ) : null],
        ]}
      />
      {viewer}
    </div>
  );
}

/** One captured report version: export files (signed URL on demand), structured rows, then text. */
export function ReportContentBody({
  report,
  content,
  versions = [],
  onOpenFile,
}: {
  report: Row;
  content: Row | null;
  versions?: Row[];
  onOpenFile?: (path: string) => void;
}) {
  if (!content) {
    return <Muted>The content of this report is not available.</Muted>;
  }
  const table = reportTable(content.structured_rows);
  const pdf = str(content.pdf_storage_path);
  const excel = str(content.excel_storage_path);
  return (
    <div className="space-y-3 rounded-lg border border-border/60 p-4" data-report-content>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-medium">{dash(report.name)}</p>
          <p className="text-xs text-muted-foreground">
            Version {dash(content.version)} · captured {formatTimestamp(content.captured_at)}
            {versions.length > 1 ? ` · ${versions.length} versions stored` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {pdf && onOpenFile ? <Button type="button" size="sm" variant="outline" onClick={() => onOpenFile(pdf)}>Open PDF</Button> : null}
          {excel && onOpenFile ? <Button type="button" size="sm" variant="outline" onClick={() => onOpenFile(excel)}>Open Excel</Button> : null}
        </div>
      </div>
      {table.columns.length ? (
        <div className="max-h-[480px] overflow-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border/60 text-left text-muted-foreground">
                {table.columns.map((c, i) => <th key={`${c}-${i}`} className="py-1 pr-3 font-medium">{c}</th>)}
              </tr>
            </thead>
            <tbody>
              {table.body.map((r, i) => (
                <tr key={i} className="border-b border-border/30 align-top">
                  {r.map((cell, j) => <td key={j} className="whitespace-pre-wrap py-1 pr-3">{cell}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {str(content.text_content) ? (
        <pre className="max-h-[480px] overflow-auto whitespace-pre-wrap rounded bg-muted/40 p-3 text-xs">{str(content.text_content)}</pre>
      ) : null}
      {!table.columns.length && !str(content.text_content) && !pdf && !excel ? <Muted>This report version has no readable content.</Muted> : null}
    </div>
  );
}

// ---- Reviews ----------------------------------------------------------------

export function ReviewsSectionView({ comments, responses, state }: { comments: Row[]; responses: Row[]; state: Row | null; snapshots?: Row[] }) {
  const visible = currentRows(comments);
  const groups = groupReviews(visible, currentRows(responses));
  return (
    <div className="space-y-4">
      <SectionStatusLine state={state} />
      {!visible.length ? <Muted>{noDataMessage(state, "review comments")}</Muted> : null}
      {groups.map((g) => (
        <section key={g.cycle} className="space-y-3" data-review-cycle={g.cycle}>
          <h4 className="text-sm font-semibold">
            Review cycle {g.cycle} · {g.total} comment{g.total === 1 ? "" : "s"} · {g.unresolved} unresolved
          </h4>
          {g.departments.map((d) => (
            <div key={d.department} className="space-y-2 rounded-lg border border-border/50 p-3" data-review-department={d.department}>
              <p className="text-sm font-medium">
                {d.department} <span className="text-xs font-normal text-muted-foreground">· {d.cards.length} comment{d.cards.length === 1 ? "" : "s"}{d.unresolved ? ` · ${d.unresolved} unresolved` : ""}</span>
              </p>
              <ol className="space-y-3">
                {d.cards.map(({ comment: c, thread }) => (
                  <li key={str(c.id)} className="rounded-md border border-border/60 bg-background p-3" data-review-comment>
                    <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span className="font-mono">Ref #{str(c.ref_number) || "?"}</span>
                      {c.status ? <StatusPill tone={isUnresolved(c.status) ? "warn" : "default"}>{str(c.status)}</StatusPill> : null}
                      {c.comment_type ? <span>{str(c.comment_type)}</span> : null}
                      {c.reviewer_role ? <span>{str(c.reviewer_role)}</span> : null}
                      <span>{formatTimestamp(c.reviewed_at)}</span>
                      {c.response_required === true ? <span>Response required</span> : null}
                      {c.file_name ? <span>File: {str(c.file_name)}</span> : null}
                    </div>
                    <p className="whitespace-pre-wrap text-sm">{str(c.body)}</p>
                    {thread.length ? (
                      <div className="mt-3 space-y-2">
                        <p className="text-xs font-medium text-muted-foreground">Discussion ({thread.length})</p>
                        {thread.map((r) => (
                          <div key={str(r.id)} className="border-l-2 border-primary/40 pl-3 text-sm" data-review-response>
                            <p className="text-xs text-muted-foreground">
                              #{str(r.seq)}{r.responder_role ? ` · ${str(r.responder_role)}` : ""} · {formatTimestamp(r.responded_at)}
                            </p>
                            <p className="whitespace-pre-wrap">{str(r.body)}</p>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}

// ---- Diagnostics (platform admins only) ----------------------------------------

/** Extraction status, where the data came from, which job wrote it, and when. */
export function SectionProvenance({ section, state, snapshots }: { section: PermitSection; state: Row | null; snapshots: Row[] }) {
  const cls = classifySectionState(state);
  const snaps = snapshotsFor(snapshots, section);
  const latest = snaps[0] ?? null;
  return (
    <div className="space-y-3 rounded-lg border border-border/60 bg-muted/30 p-3" data-section-provenance={section}>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">{sectionLabel(section)}</span>
        <ExtractionStatusPill status={cls.status} />
        <span className="text-muted-foreground">{cls.reason}</span>
      </div>
      <FieldList
        fields={[
          ["Stored status", dash(state?.status)],
          ["Source kind", dash(state?.source_kind ?? latest?.source_kind)],
          ["Source route", <span className="text-xs">{DC_SECTION_SOURCES[section].join(" · ")}</span>],
          ["Job (run) id", latest?.run_id ? <Mono>{str(latest.run_id)}</Mono> : "—"],
          ["Captured at", formatTimestamp(latest?.captured_at)],
          ["Snapshot id", latest ? <Mono>{str(latest.id)}</Mono> : "—"],
          ["Snapshots stored", String(snaps.length)],
          ["Snapshot size", latest?.payload_bytes ? `${Number(latest.payload_bytes).toLocaleString()} bytes` : "—"],
          ["Last attempt", formatTimestamp(state?.last_attempt_at)],
          ["Last success", formatTimestamp(state?.last_ok_at)],
          ["Item count", dash(state?.item_count)],
          ["Content hash", state?.content_hash ? <Mono>{str(state.content_hash).slice(0, 16)}…</Mono> : "—"],
          ["Last error", dash(state?.last_error)],
          ["Consecutive failures", dash(state?.consecutive_failures)],
        ]}
      />
    </div>
  );
}

/** One row per section: the seven-section completeness view for a permit. */
export function ExtractionOverview({ states, snapshots }: { states: Row[]; snapshots: Row[] }) {
  const byName = sectionStateMap(states);
  const rows = PERMIT_SECTIONS.map((s) => ({ section: s, state: byName.get(s) ?? null, latest: latestSnapshot(snapshots, s) }));
  return (
    <SimpleTable
      empty="No sections."
      rows={rows as unknown as Row[]}
      columns={[
        ["Section", (r) => sectionLabel(str(r.section))],
        ["Extraction", (r) => <ExtractionStatusPill status={classifySectionState(r.state as Row | null).status} />],
        ["Items", (r) => dash((r.state as Row | null)?.item_count)],
        ["Source", (r) => dash((r.state as Row | null)?.source_kind)],
        ["Captured at", (r) => formatTimestamp((r.latest as Row | null)?.captured_at)],
        ["Snapshot", (r) => ((r.latest as Row | null) ? <Mono>{str((r.latest as Row).id).slice(0, 8)}…</Mono> : "—")],
      ]}
    />
  );
}

/** Where this permit record came from: portal page, jobs, and the portal account links. */
export function PermitProvenance({ permit, snapshots, sources }: { permit: Row; snapshots: Row[]; sources: Row[] }) {
  const runIds = [...new Set(snapshots.map((s) => str(s.run_id)).filter(Boolean))];
  return (
    <FieldList
      fields={[
        ["Adapter", dash(permit.adapter_key)],
        ["Portal project id", dash(permit.portal_record_id)],
        ["Portal page (open from the DC dashboard)", <Mono>{dcProjectPageUrl(permit.portal_record_id)}</Mono>],
        ["Sync jobs that wrote snapshots", runIds.length ? <span className="space-y-1">{runIds.map((id) => <Mono key={id}>{id} </Mono>)}</span> : "—"],
        ["Portal accounts listing it", String(sources.length)],
        ["First seen", formatTimestamp(permit.first_seen_at)],
        ["Last seen on portal", formatTimestamp(permit.last_seen_at)],
        ["Last synced", formatTimestamp(permit.last_synced_at)],
        ["Last changed", formatTimestamp(permit.last_changed_at)],
        ["Record id", <Mono>{dash(permit.id)}</Mono>],
      ]}
    />
  );
}

function DiagnosticsBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h4 className="text-sm font-semibold">{title}</h4>
      {children}
    </section>
  );
}

/**
 * Admin-only: extraction provenance, hashes, snapshot and job ids, source routes and portal ids.
 * Renders nothing for anyone else. RLS is still the data boundary; this only hides the detail.
 */
export function PermitDiagnosticsView({ isAdmin, detail }: { isAdmin: boolean; detail: PermitDetail }) {
  if (!isAdmin) return null;
  const states = sectionStateMap(detail.sections);
  return (
    <div className="space-y-6" data-permit-diagnostics>
      <DiagnosticsBlock title="Extraction by section">
        <ExtractionOverview states={detail.sections} snapshots={detail.snapshots} />
      </DiagnosticsBlock>
      <DiagnosticsBlock title="Provenance">
        <PermitProvenance permit={detail.permit} snapshots={detail.snapshots} sources={detail.sources} />
      </DiagnosticsBlock>
      <DiagnosticsBlock title="Section sources and hashes">
        <div className="space-y-3">
          {PERMIT_SECTIONS.map((s) => <SectionProvenance key={s} section={s} state={states.get(s) ?? null} snapshots={detail.snapshots} />)}
        </div>
      </DiagnosticsBlock>
      <DiagnosticsBlock title="Portal accounts">
        <SourcesView sources={detail.sources} />
      </DiagnosticsBlock>
      <DiagnosticsBlock title="Task and workflow ids">
        <SimpleTable
          empty="No tasks or workflows."
          rows={[
            ...currentRows(detail.workflows).map((w) => ({ id: w.id, kind: "Workflow", name: w.name, portal_id: w.portal_workflow_id, hash: w.content_hash })),
            ...currentRows(detail.tasks).map((t) => ({ id: t.id, kind: "Task", name: t.name, portal_id: t.portal_task_id, hash: t.content_hash })),
          ]}
          columns={[
            ["Kind", (r) => dash(r.kind)],
            ["Name", (r) => dash(r.name)],
            ["Portal id", (r) => <Mono>{dash(r.portal_id)}</Mono>],
            ["Content hash", (r) => (r.hash ? <Mono>{str(r.hash).slice(0, 16)}…</Mono> : "—")],
          ]}
        />
      </DiagnosticsBlock>
      <DiagnosticsBlock title="File capture">
        <SimpleTable
          empty="No files."
          rows={currentRows(detail.documents)}
          columns={[
            ["File", (r) => <span className="break-all">{dash(r.file_name)}</span>],
            ["Portal file id", (r) => <Mono>{dash(r.portal_file_id)}</Mono>],
            ["Folder id", (r) => <Mono>{dash(r.portal_folder_id)}</Mono>],
            ["Download permitted", (r) => yesNo(r.download_permitted)],
            ["Download status", (r) => dash(r.download_status)],
            ["Storage path", (r) => <Mono>{dash(r.storage_path)}</Mono>],
            ["SHA-256", (r) => (r.sha256 ? <Mono>{str(r.sha256).slice(0, 16)}…</Mono> : "—")],
            ["Error", (r) => dash(r.download_error)],
          ]}
        />
      </DiagnosticsBlock>
      <DiagnosticsBlock title="Report capture">
        <SimpleTable
          empty="No reports."
          rows={currentRows(detail.reports)}
          columns={[
            ["Report", (r) => dash(r.name)],
            ["Report key", (r) => <Mono>{dash(r.report_key)}</Mono>],
            ["Portal report id", (r) => <Mono>{dash(r.portal_report_id)}</Mono>],
            ["Content status", (r) => dash(r.content_status ?? "not_captured (column missing)")],
            ["Latest content id", (r) => <Mono>{dash(r.latest_content_id)}</Mono>],
            ["Error", (r) => dash(r.content_error)],
          ]}
        />
      </DiagnosticsBlock>
    </div>
  );
}
