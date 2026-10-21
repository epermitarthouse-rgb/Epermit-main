import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import {
  AlertCircle,
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  Clock,
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
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MetricCard, Panel } from "@/components/design/ProductPrimitives";
import type { SupabaseAnalyzerFinding, SupabaseAnalyzerSheetJob } from "@/lib/supabaseAnalyzer/client";
import { cn } from "@/lib/utils";
import {
  bytesLabel,
  disciplineName,
  sheetErrorMessage,
  sheetIdentity,
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

const PENDING_GRID_CLASS = "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3";

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

export function AnalyzerProgressStrip({
  total,
  queued,
  processing,
  completed,
  failed,
}: {
  total: number;
  queued: number;
  processing: number;
  completed: number;
  failed: number;
}) {
  const cards: Array<{ label: string; value: number; icon: LucideIcon; detail: string; className?: string }> = [
    { label: "Total", value: total, icon: FileText, detail: "Sheets in this analysis" },
    { label: "Queued", value: queued, icon: Clock, detail: "Waiting to start" },
    {
      label: "Processing",
      value: processing,
      icon: Loader2,
      detail: "Sheets currently in review",
      className: "border-l-4 border-l-amber-500 dark:border-l-amber-400",
    },
    {
      label: "Completed",
      value: completed,
      icon: CheckCircle2,
      detail: "Sheets with a saved review",
      className: "border-l-4 border-l-teal",
    },
    {
      label: "Failed",
      value: failed,
      icon: AlertCircle,
      detail: "Sheets that need a retry",
      className: "border-l-4 border-l-destructive",
    },
  ];
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5" data-testid="supabase-analyzer-progress">
      {cards.map((card) => (
        <MetricCard
          key={card.label}
          label={card.label}
          value={card.value}
          icon={card.icon}
          detail={card.detail}
          className={card.className}
        />
      ))}
    </div>
  );
}

function severityOf(severity: string) {
  if (severity === "critical" || severity === "warning" || severity === "advisory") return severity;
  return "advisory";
}

export function SupabaseFindingCard({ finding }: { finding: SupabaseAnalyzerFinding }) {
  const severity = severityOf(finding.severity);
  const config = severityConfig[severity];
  const Icon = config.icon;
  return (
    <div
      className={cn(
        "rounded-xl border border-l-4 shadow-sm",
        config.border,
        config.bg,
      )}
      data-testid="supabase-finding-card"
      data-severity={severity}
    >
      <div className="p-4">
        <div className="mb-2 flex items-start gap-3">
          <div className={cn("shrink-0 rounded-lg p-2.5", config.iconBg)}>
            <Icon className={cn("h-5 w-5", config.color)} />
          </div>
          <div className="min-w-0 flex-1">
            <h4 className="font-semibold leading-tight text-foreground">{finding.title}</h4>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <Badge variant="outline" className="text-xs font-normal">{config.label}</Badge>
              <Badge variant="secondary" className="text-xs font-normal">{finding.category}</Badge>
              {finding.suggested_code_reference ? (
                <Badge variant="secondary" className="font-mono text-xs">{finding.suggested_code_reference}</Badge>
              ) : null}
            </div>
          </div>
        </div>
        <div className="space-y-3 text-sm">
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
              <span className="text-sm font-medium text-foreground">Recommended action</span>
            </div>
            <p className="text-sm leading-relaxed text-muted-foreground">{finding.recommendation}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

export function SheetFindings({
  job,
  findings,
  onRetry,
}: {
  job: SupabaseAnalyzerSheetJob;
  findings: SupabaseAnalyzerFinding[];
  onRetry: (jobId: string) => void;
}) {
  const counts = {
    all: findings.length,
    critical: findings.filter((finding) => finding.severity === "critical").length,
    warning: findings.filter((finding) => finding.severity === "warning").length,
    advisory: findings.filter((finding) => finding.severity === "advisory").length,
  };
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-border/60 bg-muted/20 px-4 py-3">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Sheet</p>
          <p className="truncate text-sm font-medium text-foreground">{sheetIdentity(job)}</p>
          <p className="truncate text-xs text-muted-foreground">{job.original_file_name}</p>
          <p className="mt-1 text-xs text-muted-foreground">{disciplineName(job.discipline)}</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={statusVariant(job.status)}>{statusLabel(job.status)}</Badge>
          {job.status === "failed" ? (
            <Button size="sm" variant="outlineGold" onClick={() => onRetry(job.id)}>
              Retry
            </Button>
          ) : null}
        </div>
      </div>
      {job.status === "processing" || job.status === "queued" || job.status === "upload_pending" ? (
        <div className="flex items-center text-sm text-muted-foreground">
          <Loader2 className={cn("mr-2 h-4 w-4", job.status === "processing" && "animate-spin")} />
          {job.status === "processing" ? "Reviewing drawing content" : statusLabel(job.status)}
        </div>
      ) : null}
      {job.status === "failed" ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{sheetErrorMessage(job.error_code)}</AlertDescription>
        </Alert>
      ) : null}
      {job.status === "completed" && job.analysis_summary ? (
        <p className="text-sm text-muted-foreground">{job.analysis_summary}</p>
      ) : null}
      {job.status === "completed" && findings.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No supported review observations were returned for this sheet.
        </p>
      ) : null}
      {findings.length > 0 ? (
        <Tabs key={job.id} defaultValue="all" className="w-full">
          <div className="rounded-lg border border-border/40 bg-muted/15 px-4 py-3">
            <TabsList className="grid h-auto w-full grid-cols-4 border border-border/50 bg-muted/50 p-1">
              <TabsTrigger value="all">All <Badge variant="secondary" className="ml-1.5 h-5 px-1.5 text-xs">{counts.all}</Badge></TabsTrigger>
              <TabsTrigger value="critical">Critical <Badge variant="destructive" className="ml-1.5 h-5 px-1.5 text-xs">{counts.critical}</Badge></TabsTrigger>
              <TabsTrigger value="warning">Warning <Badge className="ml-1.5 h-5 border-0 bg-amber-100 px-1.5 text-xs text-amber-700">{counts.warning}</Badge></TabsTrigger>
              <TabsTrigger value="advisory">Advisory <Badge className="ml-1.5 h-5 border-0 bg-blue-100 px-1.5 text-xs text-blue-700">{counts.advisory}</Badge></TabsTrigger>
            </TabsList>
          </div>
          {(["all", "critical", "warning", "advisory"] as const).map((tab) => {
            const visible = tab === "all" ? findings : findings.filter((finding) => finding.severity === tab);
            return (
              <TabsContent key={tab} value={tab} className="mt-3 space-y-3">
                {visible.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    No {tab === "all" ? "" : `${tab} `}observations on this sheet.
                  </p>
                ) : visible.map((finding) => <SupabaseFindingCard key={finding.id} finding={finding} />)}
              </TabsContent>
            );
          })}
        </Tabs>
      ) : null}
    </div>
  );
}

export function SheetNavigator({
  groups,
  activeDiscipline,
  onDiscipline,
  selectedJobId,
  onSelectJob,
}: {
  groups: Array<[string, SupabaseAnalyzerSheetJob[]]>;
  activeDiscipline: string;
  onDiscipline: (discipline: string) => void;
  selectedJobId: string | null;
  onSelectJob: (jobId: string) => void;
}) {
  const total = groups.reduce((sum, [, jobs]) => sum + jobs.length, 0);
  const visible = activeDiscipline === "all"
    ? groups.flatMap(([, jobs]) => jobs)
    : groups.find(([name]) => name === activeDiscipline)?.[1] || [];
  return (
    <div className="space-y-3" data-testid="supabase-sheet-navigator">
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant={activeDiscipline === "all" ? "tealData" : "outline"}
          onClick={() => onDiscipline("all")}
        >
          All disciplines
          <Badge variant="secondary" className="ml-1.5 h-5 px-1.5 text-[10px]">{total}</Badge>
        </Button>
        {groups.map(([discipline, jobs]) => (
          <Button
            key={discipline}
            type="button"
            size="sm"
            variant={activeDiscipline === discipline ? "tealData" : "outline"}
            onClick={() => onDiscipline(discipline)}
          >
            {discipline}
            <Badge variant="secondary" className="ml-1.5 h-5 px-1.5 text-[10px]">{jobs.length}</Badge>
          </Button>
        ))}
      </div>
      <ScrollArea className="h-[28rem] rounded-lg border border-border/60">
        <div className="space-y-1 p-2">
          {visible.map((job) => {
            const selected = job.id === selectedJobId;
            return (
              <button
                key={job.id}
                type="button"
                onClick={() => onSelectJob(job.id)}
                className={cn(
                  "flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left transition-colors",
                  selected
                    ? "border-teal/40 bg-teal/[0.08] ring-1 ring-teal/30"
                    : "border-transparent hover:bg-muted/40",
                )}
                aria-current={selected ? "true" : undefined}
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-foreground">{sheetIdentity(job)}</span>
                  <span className="block truncate text-xs text-muted-foreground">{job.original_file_name}</span>
                </span>
                <Badge variant={statusVariant(job.status)} className="shrink-0 text-[10px]">
                  {statusLabel(job.status)}
                </Badge>
              </button>
            );
          })}
        </div>
      </ScrollArea>
      <p className="text-xs text-muted-foreground">
        {visible.length} sheet{visible.length === 1 ? "" : "s"}
        {activeDiscipline === "all" ? "" : ` in ${activeDiscipline}`}
      </p>
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
