import type { ReactNode } from "react";
import { AlertBanner, PageHeader, Panel, StatCard, StatusPill } from "@/components/design/ProductPrimitives";
import { FreshnessPill, HistoryView, formatTimestamp } from "@/components/permits/PermitRepositoryViews";
import {
  ExtractionStatusPill,
  FilesSectionView,
  InfoSectionView,
  PermitDiagnosticsView,
  ReportsSectionView,
  ReviewsSectionView,
  StatusSectionView,
  TasksSectionView,
  WorkflowsSectionView,
} from "@/components/permits/PermitSectionViews";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { currentRows, type PermitDetail } from "@/lib/centralPermits";
import { classifySectionState, sectionStateMap, type PermitSection } from "@/lib/permitSections";
import { PERMIT_QUEUE_TABS, PERMIT_QUEUE_TAB_LABELS, type PermitQueueTab } from "@/lib/permitQueue";

type Row = Record<string, unknown>;

const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));

/** The stored sections behind each portal tab. Status also carries the workflows. */
const TAB_SECTIONS: Record<PermitQueueTab, PermitSection[]> = {
  tasks: ["tasks"],
  files: ["files"],
  status: ["status", "workflows"],
  info: ["info"],
  reports: ["reports"],
  reviews: ["reviews"],
};

export interface PermitQueueDetailViewProps {
  detail: PermitDetail;
  isAdmin: boolean;
  defaultTab?: PermitQueueTab | "history" | "diagnostics";
  /** Header actions (admin export). */
  actions?: ReactNode;
  /** Linked projects panel (project_permits). */
  linksPanel?: ReactNode;
  onViewDocument?: (doc: Row) => void;
  busyDocumentId?: string | null;
  selectedReportKey?: string | null;
  onViewReport?: (report: Row) => void;
  reportViewer?: ReactNode;
}

/** Permit Queue detail (D-064): tabs in the DC portal's order, read-only, diagnostics for admins only. */
export function PermitQueueDetailView({
  detail: d,
  isAdmin,
  defaultTab = "tasks",
  actions,
  linksPanel,
  onViewDocument,
  busyDocumentId,
  selectedReportKey,
  onViewReport,
  reportViewer,
}: PermitQueueDetailViewProps) {
  const p = d.permit;
  const states = sectionStateMap(d.sections);
  const state = (s: PermitSection) => states.get(s) ?? null;
  const counts: Partial<Record<PermitQueueTab, number>> = {
    tasks: currentRows(d.tasks).length,
    files: currentRows(d.documents).length,
    reports: currentRows(d.reports).length,
    reviews: currentRows(d.comments).length,
  };
  const incomplete = PERMIT_QUEUE_TABS.filter((t) =>
    TAB_SECTIONS[t].some((s) => {
      const c = classifySectionState(state(s)).status;
      return c !== "ok" && c !== "absent";
    }),
  );

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={[str(p.jurisdiction), str(p.review_type)].filter(Boolean).join(" · ") || "Permit"}
        title={<span className="font-mono">{str(p.permit_number)}</span>}
        body={[str(p.description) || str(p.title), str(p.address)].filter(Boolean).join(" · ") || undefined}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill tone="info">{str(p.status_raw) || str(p.status) || "Unknown"}</StatusPill>
            <FreshnessPill lastSyncedAt={p.last_synced_at as string | null} />
            {actions}
          </div>
        }
      />

      {p.removed_from_portal_at ? (
        <AlertBanner tone="warn" title="No longer listed on the portal" detail={`Last listed ${formatTimestamp(p.removed_from_portal_at)}. History is kept.`} />
      ) : null}
      {incomplete.length ? (
        <AlertBanner
          tone="warn"
          title="Some tabs are not fully captured"
          detail={`${incomplete.map((t) => PERMIT_QUEUE_TAB_LABELS[t]).join(", ")}: see the status on each tab.`}
        />
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Unresolved comments" value={str(p.unresolved_comments) || "—"} />
        <StatCard label="Open tasks" value={str(p.uncompleted_tasks) || "—"} />
        <StatCard label="Files (portal total)" value={str(p.total_files) || "—"} />
        <StatCard label="Review cycle" value={str(p.review_cycle) || "—"} hint={`Last synced ${formatTimestamp(p.last_synced_at)}`} />
      </div>

      {linksPanel}

      <Tabs defaultValue={defaultTab}>
        <TabsList className="h-auto flex-wrap" data-permit-tabs>
          {PERMIT_QUEUE_TABS.map((t) => (
            <TabsTrigger key={t} value={t} className="gap-1" data-permit-tab={t}>
              {PERMIT_QUEUE_TAB_LABELS[t]}
              {counts[t] !== undefined ? ` (${counts[t]})` : ""}
            </TabsTrigger>
          ))}
          <TabsTrigger value="history" data-permit-tab="history">History</TabsTrigger>
          {isAdmin ? <TabsTrigger value="diagnostics" data-permit-tab="diagnostics">Diagnostics</TabsTrigger> : null}
        </TabsList>
        {PERMIT_QUEUE_TABS.map((t) => (
          <TabsContent key={t} value={t}>
            <Panel title={PERMIT_QUEUE_TAB_LABELS[t]} action={<ExtractionStatusPill status={classifySectionState(state(TAB_SECTIONS[t][0])).status} />}>
              {t === "tasks" ? <TasksSectionView tasks={d.tasks} state={state("tasks")} /> : null}
              {t === "files" ? (
                <FilesSectionView folders={d.folders} documents={d.documents} state={state("files")} onViewDocument={onViewDocument} busyDocumentId={busyDocumentId} />
              ) : null}
              {t === "status" ? (
                <div className="space-y-6">
                  <StatusSectionView permit={p} state={state("status")} snapshots={d.snapshots} />
                  <WorkflowsSectionView workflows={d.workflows} state={state("workflows")} snapshots={d.snapshots} />
                </div>
              ) : null}
              {t === "info" ? <InfoSectionView permit={p} state={state("info")} snapshots={d.snapshots} /> : null}
              {t === "reports" ? (
                <ReportsSectionView reports={d.reports} state={state("reports")} selectedReportKey={selectedReportKey} onViewReport={onViewReport} viewer={reportViewer} />
              ) : null}
              {t === "reviews" ? <ReviewsSectionView comments={d.comments} responses={d.responses} state={state("reviews")} /> : null}
            </Panel>
          </TabsContent>
        ))}
        <TabsContent value="history">
          <Panel title="History" eyebrow={`Latest ${d.changes.length} changes (the JSON export has all of them)`}>
            <HistoryView changes={d.changes} />
          </Panel>
        </TabsContent>
        {isAdmin ? (
          <TabsContent value="diagnostics">
            <Panel title="Diagnostics" eyebrow="Platform admins only">
              <PermitDiagnosticsView isAdmin={isAdmin} detail={d} />
            </Panel>
          </TabsContent>
        ) : null}
      </Tabs>
    </div>
  );
}
