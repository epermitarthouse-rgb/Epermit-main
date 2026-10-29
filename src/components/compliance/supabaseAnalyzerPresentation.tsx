import React, { useId, type ReactNode } from "react";
import {
  AlertCircle,
  AlertTriangle,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronDown,
  Edit,
  FileText,
  Info,
  ListChecks,
  Loader2,
  MapPin,
  Scale,
  Table as TableIcon,
  X,
} from "lucide-react";
import { Link } from "react-router-dom";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Panel } from "@/components/design/ProductPrimitives";
import type { SupabaseAnalyzerFinding, SupabaseAnalyzerSheetJob } from "@/lib/supabaseAnalyzer/client";
import {
  effectiveSheetSeverity,
  nextRunSeverityFilter,
  projectAnalyzerReview,
  reviewDecisionLabel,
  sheetFilterEmptyMessage,
  type FindingReviewDecision,
  type FindingSeverityFilter,
} from "@/lib/supabaseAnalyzer/reviewDecisions";
import { existingDrawingsLabel } from "@/lib/supabaseAnalyzer/pendingSelection";
import { countSeverity, type SeverityTotals } from "@/lib/supabaseAnalyzer/exportDataset";
import {
  PENDING_DISCIPLINE,
  disciplineSortIndex,
  displayDisciplineForSheet,
} from "@/lib/supabaseAnalyzer/disciplineDisplay";
import { cn } from "@/lib/utils";
import {
  bytesLabel,
  conciseObservation,
  sheetErrorMessage,
  statusLabel,
  statusVariant,
} from "@/components/compliance/supabaseAnalyzerLabels";

export type { FindingSeverityFilter };

const severityConfig = {
  critical: {
    icon: AlertCircle,
    color: "text-destructive",
    bg: "bg-muted/30 dark:bg-muted/40",
    border: "border-destructive",
    iconBg: "bg-destructive/15",
    label: "Critical",
  },
  warning: {
    icon: AlertTriangle,
    color: "text-amber-600 dark:text-amber-400",
    bg: "bg-muted/30 dark:bg-muted/40",
    border: "border-amber-500 dark:border-amber-400",
    iconBg: "bg-amber-500/15",
    label: "Warning",
  },
  advisory: {
    icon: Info,
    color: "text-blue-600 dark:text-blue-400",
    bg: "bg-muted/30 dark:bg-muted/40",
    border: "border-blue-500 dark:border-blue-400",
    iconBg: "bg-blue-500/15",
    label: "Advisory",
  },
} as const;

const PENDING_GRID_CLASS = "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3";

function severityOf(severity: string) {
  if (severity === "critical" || severity === "warning" || severity === "advisory") return severity;
  return "advisory";
}

function sheetNumber(job: SupabaseAnalyzerSheetJob) {
  return job.detected_sheet_number || `Sheet ${job.ordinal}`;
}

function findingCountLabel(job: SupabaseAnalyzerSheetJob, count: number, visible: number, filtered: boolean) {
  if (job.status !== "completed") return "—";
  return filtered ? `${visible} of ${count}` : String(count);
}

export function ExistingDrawingsPanel({
  jobs,
  count,
  remaining,
  expanded,
  onToggle,
  selectedIds,
  onToggleJob,
  onSelectAll,
  onDeselectAll,
  onReanalyzeSelected,
  onReanalyzeAll,
  selectionDisabled,
  selectedDisabled,
  allDisabled,
}: {
  jobs: SupabaseAnalyzerSheetJob[];
  count: number;
  remaining: number;
  expanded: boolean;
  onToggle: () => void;
  selectedIds: ReadonlySet<string>;
  onToggleJob: (jobId: string, checked: boolean) => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onReanalyzeSelected: () => void;
  onReanalyzeAll: () => void;
  selectionDisabled: boolean;
  selectedDisabled: boolean;
  allDisabled: boolean;
}) {
  const panelId = useId();
  return (
    <section
      className="space-y-3 rounded-xl border border-border/60 bg-card p-4 text-left"
      data-testid="existing-drawings"
    >
      <div className="space-y-1">
        <h3 className="text-sm font-semibold text-foreground">Existing Drawings</h3>
        <p className="text-sm text-foreground" data-testid="existing-drawings-count">
          {existingDrawingsLabel(count)}
        </p>
        <p className="text-sm text-muted-foreground" data-testid="analyzer-remaining-capacity">
          Remaining capacity: {remaining} sheets
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-expanded={expanded}
          aria-controls={panelId}
          onClick={onToggle}
          data-testid="view-existing-drawings"
        >
          <ChevronDown
            className={cn("mr-2 h-4 w-4 transition-transform", expanded && "rotate-180")}
            aria-hidden
          />
          View existing drawings
        </Button>
        <Button
          type="button"
          variant="gold"
          size="sm"
          disabled={selectedDisabled}
          onClick={onReanalyzeSelected}
          data-testid="reanalyze-selected"
        >
          Reanalyze Selected
        </Button>
        <Button
          type="button"
          variant="outlineGold"
          size="sm"
          disabled={allDisabled}
          onClick={onReanalyzeAll}
          data-testid="reanalyze-all"
        >
          Reanalyze All
        </Button>
      </div>
      {expanded ? (
        <div id={panelId} className="space-y-2">
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={selectionDisabled || jobs.length === 0}
              onClick={onSelectAll}
              data-testid="select-all-drawings"
            >
              Select All
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={selectionDisabled || selectedIds.size === 0}
              onClick={onDeselectAll}
              data-testid="deselect-all-drawings"
            >
              Deselect All
            </Button>
          </div>
          <div className="max-h-80 overflow-auto rounded-lg border border-border/60">
            <table className="w-full min-w-[36rem] text-left text-sm" data-testid="existing-drawings-list">
              <thead className="sticky top-0 bg-muted text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Select</th>
                  <th className="px-3 py-2 font-medium">Sheet</th>
                  <th className="px-3 py-2 font-medium">Title</th>
                  <th className="px-3 py-2 font-medium">File</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => {
                  const sheet = job.detected_sheet_number || `Sheet ${job.ordinal}`;
                  const checked = selectedIds.has(job.id);
                  return (
                    <tr key={job.id} className="border-t border-border/60" data-testid="existing-drawing-row">
                      <td className="px-3 py-2">
                        <Checkbox
                          checked={checked}
                          disabled={selectionDisabled}
                          onCheckedChange={(value) => onToggleJob(job.id, value === true)}
                          aria-label={`Select ${sheet}`}
                          data-testid="existing-drawing-checkbox"
                        />
                      </td>
                      <td className="px-3 py-2 font-medium text-foreground">{sheet}</td>
                      <td className="px-3 py-2 text-foreground">{job.detected_sheet_title || "—"}</td>
                      <td className="max-w-[16rem] truncate px-3 py-2 text-muted-foreground" title={job.original_file_name}>
                        {job.original_file_name}
                      </td>
                      <td className="px-3 py-2">
                        <Badge variant={statusVariant(job.status)} className="text-[10px]">
                          {statusLabel(job.status)}
                        </Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div id={panelId} hidden />
      )}
    </section>
  );
}

export function PendingDrawingCards({
  files,
  submitting,
  onRemove,
}: {
  files: Array<{ name: string; size: number }>;
  submitting: boolean;
  onRemove: (index: number) => void;
}) {
  return (
    <div className="space-y-2 text-left" data-testid="analyzer-new-uploads">
      <p className="text-sm font-medium text-foreground">Selected drawings</p>
      <div className={PENDING_GRID_CLASS}>
        {files.map((file, index) => (
          <div
            key={`${file.name}:${file.size}:${index}`}
            className="relative rounded-lg border bg-card p-3"
            data-testid="analyzer-upload-card"
          >
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="absolute -top-2 -right-2 h-6 w-6 rounded-full bg-destructive text-destructive-foreground"
              disabled={submitting}
              onClick={() => onRemove(index)}
              aria-label={`Remove ${file.name}`}
            >
              <X className="h-3 w-3" />
            </Button>
            <div className="mb-2 flex h-20 items-center justify-center rounded bg-muted">
              <FileText className="h-8 w-8 text-muted-foreground" />
            </div>
            <p className="truncate text-xs font-medium" title={file.name}>{file.name}</p>
            <p className="text-xs text-muted-foreground">{bytesLabel(file.size)}</p>
            <Badge variant="outline" className="mt-2 text-[10px]">Ready</Badge>
          </div>
        ))}
      </div>
    </div>
  );
}

export function FindingsMatrix({
  counts,
  active,
  processing,
  onSelect,
}: {
  counts: SeverityTotals;
  active: FindingSeverityFilter;
  processing: boolean;
  onSelect: (filter: FindingSeverityFilter) => void;
}) {
  const cards: Array<{
    key: FindingSeverityFilter;
    label: string;
    value: number;
    icon: typeof AlertCircle;
  }> = [
    { key: "all", label: "All Findings", value: counts.all, icon: ListChecks },
    { key: "critical", label: "Critical", value: counts.critical, icon: AlertCircle },
    { key: "warning", label: "Warning", value: counts.warning, icon: AlertTriangle },
    { key: "advisory", label: "Advisory", value: counts.advisory, icon: Info },
  ];
  return (
    <div className="space-y-2" data-testid="supabase-findings-matrix">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((card) => {
          const selected = active === card.key;
          const Icon = card.icon;
          return (
            <button
              key={card.key}
              type="button"
              aria-pressed={selected}
              data-testid={`findings-matrix-${card.key}`}
              onClick={() => onSelect(nextRunSeverityFilter(active, card.key))}
              className={cn(
                "pilot-card-raised cursor-pointer p-5 text-left transition-shadow hover:ring-1 hover:ring-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                selected && "ring-2 ring-primary",
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="pilot-kicker">{card.label}</p>
                  <p className="mt-2 font-display text-3xl font-semibold tracking-tight text-foreground md:text-4xl">{card.value}</p>
                </div>
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                  <Icon className="h-5 w-5" aria-hidden />
                </div>
              </div>
            </button>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">
        {processing
          ? "Observations from analyzed sheets. Sheets still in progress are not counted as zero findings."
          : "Observations saved for this analysis."}
      </p>
    </div>
  );
}

function reviewBadgeClass(decision: FindingReviewDecision["decision"]) {
  if (decision === "accepted") return "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300";
  if (decision === "modified") return "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300";
  return "bg-muted text-muted-foreground";
}

function SheetSeverityFilters({
  sheetId,
  counts,
  active,
  onSelect,
}: {
  sheetId: string;
  counts: SeverityTotals;
  active: FindingSeverityFilter;
  onSelect: (filter: FindingSeverityFilter) => void;
}) {
  const items: Array<{
    key: FindingSeverityFilter;
    label: string;
    count: number;
    icon?: typeof AlertCircle;
    activeClass: string;
  }> = [
    { key: "all", label: "All", count: counts.all, activeClass: "bg-background text-foreground shadow-sm dark:bg-obsidian-sunken" },
    { key: "critical", label: "Critical", count: counts.critical, icon: AlertCircle, activeClass: "bg-destructive/10 text-destructive" },
    { key: "warning", label: "Warning", count: counts.warning, icon: AlertTriangle, activeClass: "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-400" },
    { key: "advisory", label: "Advisory", count: counts.advisory, icon: Info, activeClass: "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-400" },
  ];
  return (
    <div
      role="group"
      aria-label="Filter findings on this sheet"
      className="grid h-auto w-full grid-cols-4 gap-1 rounded-md border border-border/50 bg-muted/50 p-1 dark:border-[hsl(var(--border-obsidian-strong)/0.28)] dark:bg-card/40"
    >
      {items.map((item) => {
        const selected = active === item.key;
        const Icon = item.icon;
        return (
          <button
            key={item.key}
            type="button"
            aria-pressed={selected}
            data-testid={`sheet-filter-${sheetId}-${item.key}`}
            onClick={() => onSelect(item.key)}
            className={cn(
              "inline-flex items-center justify-center gap-1.5 rounded-sm px-2 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              selected ? item.activeClass : "text-muted-foreground hover:text-foreground",
            )}
          >
            {Icon ? <Icon className={cn("h-3.5 w-3.5", item.key === "critical" && "text-destructive", item.key === "warning" && "text-amber-600", item.key === "advisory" && "text-blue-600")} /> : null}
            <span className="hidden sm:inline">{item.label}</span>
            <Badge
              variant={item.key === "critical" ? "destructive" : "secondary"}
              className={cn(
                "h-5 px-1.5 text-xs",
                item.key === "warning" && "border-0 bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300",
                item.key === "advisory" && "border-0 bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
              )}
            >
              {item.count}
            </Badge>
          </button>
        );
      })}
    </div>
  );
}

export function SupabaseFindingCard({
  finding,
  review,
  reportId = null,
  expanded,
  saving,
  onToggle,
  onAccept,
  onModify,
  onReject,
}: {
  finding: SupabaseAnalyzerFinding;
  review: FindingReviewDecision | null;
  reportId?: string | null;
  expanded: boolean;
  saving: boolean;
  onToggle: () => void;
  onAccept: () => void;
  onModify: () => void;
  onReject: () => void;
}) {
  const severity = severityOf(finding.severity);
  const config = severityConfig[severity];
  const Icon = config.icon;
  const panelId = useId();
  return (
    <div
      className={cn(
        "group relative rounded-xl border shadow-sm transition-all duration-200",
        review
          ? "border-l-4 border-l-teal/25 border-border/40 bg-muted/20 dark:border-[hsl(var(--border-obsidian-strong)/0.28)] dark:bg-muted/20"
          : cn("border-l-4 hover:shadow-lg", config.border, config.bg),
      )}
      data-testid="supabase-finding-card"
      data-severity={severity}
      data-decision={review?.decision || "none"}
      data-finding-id={finding.id}
      data-report-id={reportId || undefined}
      data-expanded={expanded ? "true" : "false"}
    >
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <button
            type="button"
            className="flex min-w-0 flex-1 items-start gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-expanded={expanded}
            aria-controls={panelId}
            onClick={onToggle}
          >
            <div className={cn("shrink-0 rounded-lg p-2.5", config.iconBg)}>
              <Icon className={cn("h-5 w-5", config.color)} />
            </div>
            <div className="min-w-0 flex-1">
              <h4 className="font-semibold leading-tight text-foreground">
                {reportId ? (
                  <span className="mr-2 font-mono text-sm font-medium text-muted-foreground" data-testid="finding-report-id">
                    {reportId}
                  </span>
                ) : null}
                {finding.title}
              </h4>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                {finding.category ? (
                  <Badge variant="outline" className="text-xs font-normal">{finding.category}</Badge>
                ) : null}
                <Badge variant="outline" className="text-xs font-normal">{config.label}</Badge>
                {finding.suggested_code_reference ? (
                  <Badge variant="secondary" className="font-mono text-xs">{finding.suggested_code_reference}</Badge>
                ) : null}
                {review ? (
                  <Badge className={cn("gap-1 text-xs", reviewBadgeClass(review.decision))}>
                    {review.decision === "accepted" ? <Check className="h-3 w-3" /> : null}
                    {review.decision === "modified" ? <Edit className="h-3 w-3" /> : null}
                    {review.decision === "rejected" ? <X className="h-3 w-3" /> : null}
                    {reviewDecisionLabel(review.decision)}
                  </Badge>
                ) : null}
              </div>
              {expanded ? null : (
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {conciseObservation(finding.observation)}
                </p>
              )}
            </div>
            <ChevronDown
              className={cn("mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform", expanded && "rotate-180")}
              aria-hidden
            />
          </button>
          <div className="flex shrink-0 flex-col gap-1.5">
            <Button
              type="button"
              size="sm"
              variant="gold"
              className={cn("gap-1.5", review?.decision === "accepted" && "ring-2 ring-primary")}
              aria-pressed={review?.decision === "accepted"}
              disabled={saving}
              onClick={onAccept}
            >
              <Check className="h-3.5 w-3.5" />
              Accept
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outlineGold"
              className={cn("gap-1.5", review?.decision === "modified" && "ring-2 ring-primary")}
              aria-pressed={review?.decision === "modified"}
              disabled={saving}
              onClick={onModify}
            >
              <Edit className="h-3.5 w-3.5" />
              Modify
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className={cn("gap-1.5 text-muted-foreground hover:text-foreground", review?.decision === "rejected" && "ring-2 ring-primary")}
              aria-pressed={review?.decision === "rejected"}
              disabled={saving}
              onClick={onReject}
            >
              <X className="h-3.5 w-3.5" />
              Reject
            </Button>
          </div>
        </div>
        {expanded ? (
          <div id={panelId} className="mt-3 space-y-3 text-sm">
            <div>
              <p className="font-medium text-foreground">Observation</p>
              <p className="mt-1 leading-relaxed text-muted-foreground">{finding.observation}</p>
            </div>
            <div>
              <p className="font-medium text-foreground">Drawing evidence</p>
              <p className="mt-1 leading-relaxed text-muted-foreground">{finding.drawing_evidence}</p>
              {finding.drawing_location ? (
                <p className="mt-1 flex items-center gap-1.5 text-muted-foreground">
                  <MapPin className="h-3.5 w-3.5" />
                  {finding.drawing_location}
                </p>
              ) : null}
            </div>
            <div className="flex items-center gap-1.5 text-sm">
              <Scale className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-muted-foreground">
                {finding.suggested_code_reference || "Code reference not specified"}
                {finding.code_edition ? ` (${finding.code_edition})` : ""}
              </span>
            </div>
            <div className="rounded-lg border border-border/50 bg-muted/40 p-3 dark:border-[hsl(var(--border-obsidian-strong)/0.35)] dark:bg-card/35">
              <div className="mb-1.5 flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-teal" />
                <span className="text-sm font-medium text-foreground">Recommended action</span>
              </div>
              <p className="text-sm leading-relaxed text-muted-foreground">{finding.recommendation}</p>
            </div>
            {review?.decision === "modified" && review.modified_response ? (
              <div className="rounded-lg border border-border/50 bg-muted/40 p-3 dark:border-[hsl(var(--border-obsidian-strong)/0.35)] dark:bg-card/35">
                <div className="mb-1.5 flex items-center gap-2">
                  <Edit className="h-4 w-4 text-teal" />
                  <span className="text-sm font-medium text-foreground">Reviewer response</span>
                </div>
                <p className="text-sm leading-relaxed text-muted-foreground">{review.modified_response}</p>
              </div>
            ) : null}
          </div>
        ) : (
          <div id={panelId} hidden />
        )}
      </div>
    </div>
  );
}

export function DrawingReviewList({
  jobs,
  findingsByJob,
  severityFilter,
  sheetSeverity,
  activeDiscipline,
  onDiscipline,
  onSheetSeverity,
  reviewsByFinding,
  reportIdByFindingId,
  savingFindingId,
  onAccept,
  onModify,
  onReject,
  expandedJobIds,
  onToggleJob,
  expandedFindingIds,
  onToggleFinding,
  onRetry,
  retryDisabled = false,
}: {
  jobs: SupabaseAnalyzerSheetJob[];
  findingsByJob: Map<string, SupabaseAnalyzerFinding[]>;
  severityFilter: FindingSeverityFilter;
  sheetSeverity: Readonly<Record<string, FindingSeverityFilter | undefined>>;
  activeDiscipline: string;
  onDiscipline: (discipline: string) => void;
  onSheetSeverity: (jobId: string, filter: FindingSeverityFilter) => void;
  reviewsByFinding: ReadonlyMap<string, FindingReviewDecision>;
  reportIdByFindingId?: ReadonlyMap<string, string>;
  savingFindingId: string | null;
  onAccept: (finding: SupabaseAnalyzerFinding) => void;
  onModify: (finding: SupabaseAnalyzerFinding) => void;
  onReject: (finding: SupabaseAnalyzerFinding) => void;
  expandedJobIds: ReadonlySet<string>;
  onToggleJob: (jobId: string) => void;
  expandedFindingIds: ReadonlySet<string>;
  onToggleFinding: (findingId: string) => void;
  onRetry: (jobId: string) => void;
  retryDisabled?: boolean;
}) {
  const grouped = new Map<string, SupabaseAnalyzerSheetJob[]>();
  for (const job of jobs) {
    const label = displayDisciplineForSheet(job).display;
    const list = grouped.get(label) || [];
    list.push(job);
    grouped.set(label, list);
  }
  const groups = [...grouped.entries()].sort(
    (left, right) => disciplineSortIndex(left[0]) - disciplineSortIndex(right[0]) || left[0].localeCompare(right[0]),
  );
  const flatFindings = jobs.flatMap((job) => findingsByJob.get(job.id) || []);
  const filterView = projectAnalyzerReview({
    sheets: jobs.map((job) => ({ id: job.id, discipline: displayDisciplineForSheet(job).display })),
    findings: flatFindings,
    discipline: activeDiscipline,
    runSeverity: severityFilter,
    sheetSeverity,
  });
  const visibleIds = new Set(filterView.sheets.map((sheet) => sheet.id));
  const visibleGroups = groups
    .map(([discipline, disciplineJobs]) => [discipline, disciplineJobs.filter((job) => visibleIds.has(job.id))] as const)
    .filter(([, disciplineJobs]) => disciplineJobs.length > 0);

  return (
    <div className="space-y-3" data-testid="supabase-drawing-list">
      <div className="flex flex-wrap gap-2" role="toolbar" aria-label="Filter drawings by discipline">
        <Button
          type="button"
          size="sm"
          variant={activeDiscipline === "all" ? "tealData" : "outline"}
          aria-pressed={activeDiscipline === "all"}
          onClick={() => onDiscipline("all")}
        >
          All disciplines
          <Badge variant="secondary" className="ml-1.5 h-5 px-1.5 text-[10px]">{jobs.length}</Badge>
        </Button>
        {groups.map(([discipline, disciplineJobs]) => (
          <Button
            key={discipline}
            type="button"
            size="sm"
            variant={activeDiscipline === discipline ? "tealData" : "outline"}
            aria-pressed={activeDiscipline === discipline}
            onClick={() => onDiscipline(discipline)}
          >
            {discipline}
            <Badge variant="secondary" className="ml-1.5 h-5 px-1.5 text-[10px]">{disciplineJobs.length}</Badge>
          </Button>
        ))}
      </div>
      {filterView.emptyMessage ? (
        <p className="text-sm text-muted-foreground" data-testid="finding-filter-empty">
          {filterView.emptyMessage}
        </p>
      ) : null}
      <div className="space-y-4">
        {visibleGroups.map(([discipline, disciplineJobs]) => (
          <section key={discipline} className="space-y-2" aria-label={discipline}>
            {activeDiscipline === "all" ? (
              <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{discipline}</h3>
            ) : null}
            <div className="space-y-2">
              {disciplineJobs.map((job) => {
                const findings = findingsByJob.get(job.id) || [];
                const visibleFindings = filterView.findingsBySheet.get(job.id) || [];
                const sheetFilter = effectiveSheetSeverity(severityFilter, sheetSeverity, job.id);
                const counts = countSeverity(findings);
                const sheetEmpty = sheetFilterEmptyMessage(findings.length, visibleFindings.length, sheetFilter);
                const expanded = expandedJobIds.has(job.id);
                const panelId = `sheet-panel-${job.id}`;
                const disciplineLabel = displayDisciplineForSheet(job).display;
                return (
                  <div key={job.id} className="rounded-lg border border-border/60" data-testid="supabase-sheet-row">
                    <button
                      type="button"
                      className="flex w-full items-center gap-3 px-3 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      aria-expanded={expanded}
                      aria-controls={panelId}
                      onClick={() => onToggleJob(job.id)}
                    >
                      <ChevronDown
                        className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", expanded && "rotate-180")}
                        aria-hidden
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-foreground">
                          {sheetNumber(job)}
                          {job.detected_sheet_title ? ` — ${job.detected_sheet_title}` : ""}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {disciplineLabel}
                          {job.original_file_name ? ` · ${job.original_file_name}` : ""}
                        </span>
                      </span>
                      <Badge variant={statusVariant(job.status)} className="shrink-0 text-[10px]">
                        {statusLabel(job.status)}
                      </Badge>
                      <span
                        className="min-w-8 shrink-0 text-right text-xs text-muted-foreground"
                        data-testid={`sheet-finding-count-${job.id}`}
                        aria-label={job.status !== "completed"
                          ? "Finding count pending"
                          : sheetFilter === "all"
                            ? `${findings.length} findings`
                            : `${visibleFindings.length} of ${findings.length} findings shown`}
                      >
                        {findingCountLabel(job, findings.length, visibleFindings.length, sheetFilter !== "all")}
                      </span>
                    </button>
                    <div id={panelId} hidden={!expanded}>
                    {expanded ? (
                      <div className="space-y-3 border-t border-border/60 px-3 py-3">
                        {job.status === "processing" || job.status === "queued" || job.status === "upload_pending" ? (
                          <div className="flex items-center text-sm text-muted-foreground">
                            <Loader2 className={cn("mr-2 h-4 w-4", job.status === "processing" && "animate-spin")} />
                            {job.status === "processing" ? "Reviewing drawing content" : statusLabel(job.status)}
                          </div>
                        ) : null}
                        {job.status === "failed" && job.error_code !== "run_cancelled" ? (
                          <Alert variant="destructive">
                            <AlertCircle className="h-4 w-4" />
                            <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
                              <span>{sheetErrorMessage(job.error_code)}</span>
                              <Button size="sm" variant="outlineGold" onClick={() => onRetry(job.id)} disabled={retryDisabled}>
                                Retry
                              </Button>
                            </AlertDescription>
                          </Alert>
                        ) : null}
                        {job.status === "cancelled" || job.error_code === "run_cancelled" ? (
                          <p className="text-sm text-muted-foreground">{sheetErrorMessage(job.error_code || "run_cancelled")}</p>
                        ) : null}
                        {job.analysis_summary && job.status !== "completed" ? (
                          <p className="text-sm text-muted-foreground">{job.analysis_summary}</p>
                        ) : null}
                        {job.status === "completed" ? (
                          <div className="space-y-3">
                            <div className="space-y-1">
                              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Sheet summary</p>
                              <p className="text-sm font-medium text-foreground">
                                {sheetNumber(job)}
                                {job.detected_sheet_title ? ` — ${job.detected_sheet_title}` : ""}
                              </p>
                              {job.analysis_summary ? (
                                <p className="text-sm leading-relaxed text-muted-foreground">{job.analysis_summary}</p>
                              ) : null}
                              <p className="text-sm text-foreground" data-testid={`sheet-finding-total-${job.id}`}>
                                {counts.all} findings
                              </p>
                            </div>
                            <SheetSeverityFilters
                              sheetId={job.id}
                              counts={counts}
                              active={sheetFilter}
                              onSelect={(filter) => onSheetSeverity(job.id, filter)}
                            />
                            <p className="text-xs text-muted-foreground">
                              Showing {visibleFindings.length} of {findings.length} · Critical {counts.critical} · Warning {counts.warning} · Advisory {counts.advisory}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              Reviewer decisions record a response to the recommendation. They are not an independent code-compliance verification.
                            </p>
                          </div>
                        ) : null}
                        {job.status === "completed" && findings.length === 0 ? (
                          <p className="text-sm text-muted-foreground">
                            No supported review observations were returned for this sheet.
                          </p>
                        ) : null}
                        {sheetEmpty ? (
                          <p className="text-sm text-muted-foreground" data-testid={`sheet-filter-empty-${job.id}`}>
                            {sheetEmpty}
                          </p>
                        ) : null}
                        <div className="space-y-3">
                          {visibleFindings.map((finding) => (
                            <SupabaseFindingCard
                              key={finding.id}
                              finding={finding}
                              review={reviewsByFinding.get(finding.id) || null}
                              reportId={reportIdByFindingId?.get(finding.id) || null}
                              expanded={expandedFindingIds.has(finding.id)}
                              saving={savingFindingId === finding.id}
                              onToggle={() => onToggleFinding(finding.id)}
                              onAccept={() => onAccept(finding)}
                              onModify={() => onModify(finding)}
                              onReject={() => onReject(finding)}
                            />
                          ))}
                        </div>
                      </div>
                    ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

export function AnalyzerSideActions({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <aside className="space-y-4 lg:sticky lg:top-4 lg:self-start">
      <Panel eyebrow="Actions" title="Download report">
        <div className="space-y-2">{children}</div>
      </Panel>
      <Panel eyebrow="Cross-reference" title="Related tools">
        <div className="space-y-2 text-sm">
          <Link
            to="/code-reference"
            className="flex items-center gap-2 rounded-md border border-border/60 px-3 py-2 text-foreground transition-colors hover:border-primary/60 hover:text-primary"
          >
            <BookOpen className="h-4 w-4 text-primary" />
            Code Reference Library
          </Link>
          <Link
            to="/response-matrix"
            className="flex items-center gap-2 rounded-md border border-border/60 px-3 py-2 text-foreground transition-colors hover:border-primary/60 hover:text-primary"
          >
            <TableIcon className="h-4 w-4 text-primary" />
            Response Matrix
          </Link>
        </div>
      </Panel>
    </aside>
  );
}
