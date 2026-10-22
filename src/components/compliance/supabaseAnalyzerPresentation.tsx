import { useId, type ReactNode } from "react";
import {
  AlertCircle,
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  FileText,
  Info,
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
import { Panel } from "@/components/design/ProductPrimitives";
import type { SupabaseAnalyzerFinding, SupabaseAnalyzerSheetJob } from "@/lib/supabaseAnalyzer/client";
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

export type FindingSeverityFilter = "all" | "critical" | "warning" | "advisory";

const PENDING_GRID_CLASS = "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3";

function severityOf(severity: string) {
  if (severity === "critical" || severity === "warning" || severity === "advisory") return severity;
  return "advisory";
}

function sheetNumber(job: SupabaseAnalyzerSheetJob) {
  return job.detected_sheet_number || `Sheet ${job.ordinal}`;
}

function findingCountLabel(job: SupabaseAnalyzerSheetJob, count: number) {
  if (job.status !== "completed") return "—";
  return String(count);
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
  const cards: Array<{ key: FindingSeverityFilter; label: string; value: number }> = [
    { key: "all", label: "All Findings", value: counts.all },
    { key: "critical", label: "Critical", value: counts.critical },
    { key: "warning", label: "Warning", value: counts.warning },
    { key: "advisory", label: "Advisory", value: counts.advisory },
  ];
  return (
    <div className="space-y-2" data-testid="supabase-findings-matrix">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((card) => {
          const selected = active === card.key;
          return (
            <button
              key={card.key}
              type="button"
              aria-pressed={selected}
              data-testid={`findings-matrix-${card.key}`}
              onClick={() => onSelect(selected && card.key !== "all" ? "all" : card.key)}
              className={cn(
                "rounded-lg border px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                selected ? "border-teal/50 bg-teal/[0.08]" : "border-border/60 bg-card hover:bg-muted/40",
              )}
            >
              <p className="text-xs font-medium text-muted-foreground">{card.label}</p>
              <p className="text-xl font-semibold text-foreground">{card.value}</p>
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

export function SupabaseFindingCard({
  finding,
  expanded,
  onToggle,
}: {
  finding: SupabaseAnalyzerFinding;
  expanded: boolean;
  onToggle: () => void;
}) {
  const severity = severityOf(finding.severity);
  const config = severityConfig[severity];
  const Icon = config.icon;
  const panelId = useId();
  return (
    <div
      className={cn("rounded-xl border border-l-4 shadow-sm", config.border, config.bg)}
      data-testid="supabase-finding-card"
      data-severity={severity}
      data-expanded={expanded ? "true" : "false"}
    >
      <button
        type="button"
        className="flex w-full items-start gap-3 p-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={onToggle}
      >
        <div className={cn("shrink-0 rounded-lg p-2.5", config.iconBg)}>
          <Icon className={cn("h-5 w-5", config.color)} />
        </div>
        <div className="min-w-0 flex-1">
          <h4 className="font-semibold leading-tight text-foreground">{finding.title}</h4>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <Badge variant="outline" className="text-xs font-normal">{config.label}</Badge>
            {finding.suggested_code_reference ? (
              <Badge variant="secondary" className="font-mono text-xs">{finding.suggested_code_reference}</Badge>
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
      {expanded ? (
        <div id={panelId} className="space-y-3 px-4 pb-4 text-sm">
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
          <div className="flex items-start gap-1.5">
            <Scale className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <div>
              <p className="font-medium text-foreground">Code Reference</p>
              <p className="mt-1 text-muted-foreground">{finding.suggested_code_reference || "Not specified"}</p>
            </div>
          </div>
          <div className="rounded-lg border border-border/50 bg-muted/40 p-3 dark:border-[hsl(var(--border-obsidian-strong)/0.35)] dark:bg-card/35">
            <div className="mb-1.5 flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-teal" />
              <span className="text-sm font-medium text-foreground">Recommended Action</span>
            </div>
            <p className="text-sm leading-relaxed text-muted-foreground">{finding.recommendation}</p>
          </div>
        </div>
      ) : (
        <div id={panelId} hidden />
      )}
    </div>
  );
}

export function DrawingReviewList({
  jobs,
  findingsByJob,
  severityFilter,
  activeDiscipline,
  onDiscipline,
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
  activeDiscipline: string;
  onDiscipline: (discipline: string) => void;
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
  const visibleGroups = activeDiscipline === "all"
    ? groups
    : groups.filter(([discipline]) => discipline === activeDiscipline);

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
      <div className="space-y-4">
        {visibleGroups.map(([discipline, disciplineJobs]) => (
          <section key={discipline} className="space-y-2" aria-label={discipline}>
            {activeDiscipline === "all" ? (
              <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{discipline}</h3>
            ) : null}
            <div className="space-y-2">
              {disciplineJobs.map((job) => {
                const findings = findingsByJob.get(job.id) || [];
                const visibleFindings = severityFilter === "all"
                  ? findings
                  : findings.filter((finding) => finding.severity === severityFilter);
                const counts = countSeverity(findings);
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
                        className="w-8 shrink-0 text-right text-xs text-muted-foreground"
                        aria-label={job.status === "completed" ? `${findings.length} findings` : "Finding count pending"}
                      >
                        {findingCountLabel(job, findings.length)}
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
                        {job.analysis_summary ? (
                          <p className="text-sm text-muted-foreground">{job.analysis_summary}</p>
                        ) : null}
                        {job.status === "completed" ? (
                          <p className="text-xs text-muted-foreground">
                            Critical {counts.critical} · Warning {counts.warning} · Advisory {counts.advisory}
                          </p>
                        ) : null}
                        {job.status === "completed" && findings.length === 0 ? (
                          <p className="text-sm text-muted-foreground">
                            No supported review observations were returned for this sheet.
                          </p>
                        ) : null}
                        {job.status === "completed" && findings.length > 0 && visibleFindings.length === 0 ? (
                          <p className="text-sm text-muted-foreground">
                            No {severityFilter} observations on this sheet.
                          </p>
                        ) : null}
                        <div className="space-y-2">
                          {visibleFindings.map((finding) => (
                            <SupabaseFindingCard
                              key={finding.id}
                              finding={finding}
                              expanded={expandedFindingIds.has(finding.id)}
                              onToggle={() => onToggleFinding(finding.id)}
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
