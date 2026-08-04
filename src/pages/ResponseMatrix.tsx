import { useState, useEffect, useCallback, useRef, useMemo, Fragment, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAuth } from "@/hooks/useAuth";
import { useResolvedProjectId } from "@/hooks/useResolvedProjectId";
import { ReviewTimer, type ReviewTimerHandle } from "@/components/shadow/ReviewTimer";
import { supabase } from "@/lib/supabase";
import {
  autoDraftPayloadFromRow,
  buildFullCommentContext,
  getGroundedDraftValidationError,
  GROUNDED_NO_REVIEW_TEXT_MESSAGE,
  GroundedValidationSkip,
  groundedDraftPayloadFromRow,
  parseStoredCodeReferences,
} from "@/lib/groundedCommentContext";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { useGroundedDraftQueue } from "@/hooks/useGroundedDraftQueue";
import { Loader2, Save, Wand2, ArrowLeft, CheckCircle2, ShieldCheck, FileDown, UserCheck, Copy, FileQuestion, PenTool, PenLine, AlertCircle, ChevronDown, ChevronRight, Sparkles, RotateCcw, Filter, RefreshCw, FileSearch, ListChecks } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ExportPackageDialog } from "@/components/response-matrix/ExportPackageDialog";
import { ResponseMatrixExportMenu } from "@/components/response-matrix/ResponseMatrixExportMenu";
import { SuggestedResponsePanel } from "@/components/response-matrix/SuggestedResponsePanel";
import { useProjectTeam } from "@/hooks/useProjectTeam";
import { effectiveResponseStatus, responseStatusBadgeClass } from "@/lib/responseApproval";
import {
  classifyResponseLifecycle,
  countLifecycleMetrics,
  parseResponseMatrixMetric,
  type ResponseMatrixMetric,
} from "@/lib/responseMatrixMetrics";
import { getModifiedCommentIds } from "@/components/response-matrix/RoundChangeSummary";
import { useResponsePackageDrafts } from "@/hooks/useResponsePackageDrafts";
import { cn } from "@/lib/utils";
import { PageHeader, Panel } from "@/components/design/ProductPrimitives";
import { PlanMarkupWorkspace } from "@/components/plans/PlanMarkupWorkspace";
import { useApprovalGate } from "@/components/plans/ArchitectApprovalDialog";
import type { PanelComment } from "@/components/plans/CommentPlanPanel";

const RESPONSE_MATRIX_STYLES = `
  @keyframes response-fade-in { from { opacity: 0; } to { opacity: 1; } }
  @keyframes icon-shimmer { 0%, 100% { opacity: 1; filter: drop-shadow(0 0 4px hsl(var(--accent-teal) / 0.35)); } 50% { opacity: 0.9; filter: drop-shadow(0 0 10px hsl(var(--accent-teal) / 0.45)); } }
  .auto-draft-icon { animation: icon-shimmer 2.5s ease-in-out infinite; }
  .response-text-fade-in { animation: response-fade-in 0.3s ease-out; }
`;

const STATUS_OPTIONS = [
  "Pending Review",
  "Pending",
  "Approved",
  "Rejected",
  "Draft",
  "Ready for Review",
] as const;

/** Exclude report metadata lines that were mistakenly parsed as comments. */
const REPORT_METADATA_PHRASES = [
  "Created in ProjectDox version",
  "Report Generated:",
  "Workflow Started:",
  "Report date:",
  "Project Name:",
  "Upload and Submit",
  "Workflow Routing Slip",
  "Total Review Comments:",
  "Elapsed Days:",
  "Time Elapsed:",
  "Number of Files:",
  "Plan Review - Review Comments Report",
  "No data found.",
];

function isReportMetadataRow(row: {
  original_text?: string | null;
  previous_comment_text?: string | null;
  ingest_source?: string | null;
}): boolean {
  // Manual / uploaded / pasted workflow rows are never portal report metadata.
  if (row.ingest_source === "manual_letter" || row.ingest_source === "fallback_llm") {
    return false;
  }
  const t = (row.original_text ?? "").trim();
  const previous = (row.previous_comment_text ?? "").trim();
  const combined = t || previous;
  if (combined.length < 15) return true;
  return REPORT_METADATA_PHRASES.some((phrase) => combined.includes(phrase));
}

function manualCommentSourceBadgeLabel(row: {
  source_document_id?: string | null;
}): string {
  return row.source_document_id ? "Manual uploaded comments" : "Manual entry";
}

function statusBorderClass(status: string | null): string {
  const s = (status ?? "").toLowerCase();
  if (s === "pending" || s === "pending review" || s === "draft") return "border-l-warning";
  if (s === "approved") return "border-l-success";
  if (s === "rejected") return "border-l-destructive";
  if (s.includes("ready")) return "border-l-[hsl(var(--chart-2))]";
  return "border-l-border";
}

function statusBadgeClass(status: string): string {
  const s = status.toLowerCase();
  if (s === "pending" || s === "pending review" || s === "draft") {
    return "bg-warning/15 text-amber-950 border-warning/40";
  }
  if (s === "approved") {
    return "bg-success/10 text-emerald-950 border-emerald-700/40";
  }
  if (s === "rejected") {
    return "bg-destructive/15 text-red-950 border-red-700/35";
  }
  if (s.includes("ready")) {
    return "border-sky-700/35 bg-sky-500/[0.13] text-sky-950";
  }
  return "bg-muted/80 text-muted-foreground border-border";
}

/** Closed trigger pill: navy surface + cream ink (dropdown menu items keep light chips via statusBadgeClass). */
function statusSelectTriggerAccentClass(status: string): string {
  const s = status.toLowerCase();
  if (s === "pending" || s === "pending review" || s === "draft") {
    return "border-warning/55 shadow-[inset_0_0_0_1px_hsl(var(--warning)_/_0.12)]";
  }
  if (s === "approved") {
    return "border-teal/50 shadow-[inset_0_0_0_1px_hsl(var(--accent-teal)_/_0.18)]";
  }
  if (s === "rejected") {
    return "border-red-400/55 shadow-[inset_0_0_0_1px_hsl(var(--destructive)_/_0.15)]";
  }
  if (s.includes("ready")) {
    return "border-sky-400/50 shadow-[inset_0_0_0_1px_rgba(56,189,248,0.12)]";
  }
  return "border-teal/40 shadow-[inset_0_0_0_1px_hsl(var(--accent-teal)_/_0.1)]";
}

const DISCIPLINE_COLORS: Record<string, string> = {
  zoning: "bg-violet-500/15 text-violet-700 border-violet-500/30",
  structural: "bg-blue-500/15 text-blue-700 border-blue-500/30",
  architectural: "bg-teal/15 text-foreground border-teal/30",
  mechanical: "bg-gold/12 text-primary-deep border-gold/32",
  mep: "bg-gold/12 text-primary-deep border-gold/32",
  electrical: "bg-yellow-500/15 text-yellow-700 border-yellow-500/30",
  fire: "bg-red-500/15 text-red-700 border-red-500/30",
  general: "bg-muted/90 text-muted-foreground border-border",
};

function disciplineBadgeClass(discipline: string | null): string {
  if (!discipline) return DISCIPLINE_COLORS.general;
  const key = discipline.toLowerCase().replace(/\s+/g, "");
  return DISCIPLINE_COLORS[key] ?? DISCIPLINE_COLORS.general;
}

function CodeRefChip({ value }: { value: string | null | undefined }) {
  const text = value?.trim() ?? "";
  const copy = () => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    toast.success("Code reference copied");
  };
  if (!text) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="group/code flex items-center gap-1 max-w-full">
      <span className="text-xs font-mono-data bg-primary/10 text-foreground px-2 py-1 rounded border border-primary/35 truncate">
        {text}
      </span>
      <button
        type="button"
        onClick={copy}
        className="opacity-0 group-hover/code:opacity-100 p-1 rounded shrink-0 transition-opacity hover:bg-muted/70"
        aria-label="Copy code reference"
      >
        <Copy className="h-3.5 w-3.5 text-muted-foreground" />
      </button>
    </div>
  );
}

function MarkupStatusBadge({ commentId, projectId }: { commentId: string; projectId: string }) {
  const [status, setStatus] = useState<"none" | "pending" | "approved" | "rejected">("none");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("plan_markups")
        .select("status")
        .eq("project_id", projectId)
        .eq("comment_id", commentId)
        .limit(1);
      if (cancelled || error || !data || data.length === 0) return;
      setStatus(data[0].status as "pending" | "approved" | "rejected");
    })();
    return () => { cancelled = true; };
  }, [commentId, projectId]);

  if (status === "none") return <span className="text-muted-foreground text-xs">—</span>;

  const variant = status === "approved" ? "default" : status === "rejected" ? "destructive" : "secondary";
  return (
    <Badge
      variant={variant}
      className="text-[10px]"
      data-testid={`badge-markup-status-${commentId}`}
    >
      {status === "approved" ? "Marked" : status === "pending" ? "Pending" : "Rejected"}
    </Badge>
  );
}

function commentPreviewText(row: ParsedCommentRow): string {
  const ctx = buildFullCommentContext(row);
  return ctx.display_primary_text;
}

function ConfidenceBadge({ value }: { value: string | null | undefined }) {
  if (!value) return null;
  const v = value.toLowerCase();
  const cls =
    v === "high"
      ? "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300 border-emerald-600/35"
      : v === "low"
        ? "bg-amber-500/15 text-amber-900 dark:text-amber-300 border-amber-600/35"
        : "bg-sky-500/15 text-sky-900 dark:text-sky-300 border-sky-600/35";
  return (
    <Badge variant="outline" className={cn("text-[10px] font-medium capitalize", cls)}>
      {value} confidence
    </Badge>
  );
}

function RelevanceBadge({ value }: { value?: string }) {
  if (!value) return null;
  const v = value.toLowerCase();
  const cls =
    v === "high"
      ? "text-emerald-800 dark:text-emerald-300"
      : v === "low"
        ? "text-amber-800 dark:text-amber-300"
        : "text-sky-800 dark:text-sky-300";
  return <span className={cn("text-xs font-semibold uppercase tracking-wide", cls)}>{value}</span>;
}

function EvidenceCitationCard({ item, index }: { item: GroundedEvidenceItem; index: number }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3 space-y-1.5 shadow-sm dark:border-border/60 dark:bg-muted/40">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-semibold text-foreground dark:text-foreground">
          Citation {index + 1}
        </p>
        <RelevanceBadge value={item.relevance} />
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        <dt className="text-muted-foreground dark:text-muted-foreground font-medium">File</dt>
        <dd className="text-foreground dark:text-foreground break-all">{item.file_name ?? "Document"}</dd>
        {item.page_number != null && (
          <>
            <dt className="text-muted-foreground dark:text-muted-foreground font-medium">Page</dt>
            <dd className="text-foreground dark:text-foreground">{item.page_number}</dd>
          </>
        )}
        {item.sheet_label && (
          <>
            <dt className="text-muted-foreground dark:text-muted-foreground font-medium">Sheet</dt>
            <dd className="text-foreground dark:text-foreground font-mono-data">{item.sheet_label}</dd>
          </>
        )}
        {item.sheet_title && (
          <>
            <dt className="text-muted-foreground dark:text-muted-foreground font-medium">Title</dt>
            <dd className="text-foreground dark:text-foreground">{item.sheet_title}</dd>
          </>
        )}
      </dl>
      {item.snippet && (
        <div className="pt-1 border-t border-border/80 dark:border-border/50">
          <p className="text-xs font-medium text-muted-foreground dark:text-muted-foreground mb-1">Evidence</p>
          <p className="text-sm text-foreground dark:text-foreground whitespace-pre-wrap break-words leading-relaxed">
            {item.snippet}
          </p>
        </div>
      )}
    </div>
  );
}

function DetailSection({
  title,
  children,
  variant = "default",
}: {
  title: string;
  children: ReactNode;
  variant?: "default" | "warning" | "action";
}) {
  const borderCls =
    variant === "warning"
      ? "border-amber-500/40 bg-amber-500/5 dark:bg-amber-500/10"
      : variant === "action"
        ? "border-teal/35 bg-teal/5 dark:bg-teal/10"
        : "border-border bg-card/80 dark:border-border/60 dark:bg-muted/30";
  return (
    <section className={cn("rounded-lg border p-4 space-y-2", borderCls)}>
      <h4 className="text-xs font-mono uppercase tracking-[0.14em] text-muted-foreground dark:text-muted-foreground">
        {title}
      </h4>
      <div className="text-sm text-foreground dark:text-foreground leading-relaxed whitespace-pre-wrap break-words">
        {children}
      </div>
    </section>
  );
}

function CommentDetailPanel({
  row,
  isAutoDrafting,
  userId,
  canApprove,
  onRowUpdated,
  onUpdateAssigned,
  onUpdateSheetRef,
}: {
  row: ParsedCommentRow;
  isAutoDrafting: boolean;
  userId: string | undefined;
  canApprove: boolean;
  onRowUpdated: (id: string, patch: Partial<ParsedCommentRow>) => void;
  onUpdateAssigned: (value: string) => void;
  onUpdateSheetRef: (value: string) => void;
}) {
  const ctx = buildFullCommentContext(row);
  const previous = ctx.previous_comment_text;
  const existing = ctx.existing_response_text;
  const evidence = Array.isArray(row.grounded_evidence) ? row.grounded_evidence : [];

  return (
    <div className="px-4 py-5 sm:px-6 bg-muted/40 dark:bg-muted/50 border-t border-border dark:border-border/50 space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          <DetailSection title="City / reviewer comment">
            {(ctx.reviewer_name || ctx.comment_number) && (
              <p className="text-xs font-mono uppercase tracking-wide text-muted-foreground mb-2">
                {[ctx.reviewer_name, ctx.comment_number ? `#${ctx.comment_number}` : null]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            )}
            {ctx.display_primary_text ? (
              <p>{ctx.display_primary_text}</p>
            ) : (
              <p className="text-muted-foreground italic">No comment text</p>
            )}
            {row.ingest_source === "manual_letter" && (
              <Badge variant="outline" className="mt-2 text-[10px] border-teal/40 text-teal">
                {manualCommentSourceBadgeLabel(row)}
              </Badge>
            )}
          </DetailSection>

          {previous ? (
            <DetailSection title="Previous reviewer comment" variant="warning">
              <p>{previous}</p>
            </DetailSection>
          ) : null}

          {existing ? (
            <DetailSection title="Existing letter response">
              <p className="text-muted-foreground dark:text-muted-foreground">{existing}</p>
            </DetailSection>
          ) : null}
        </div>

        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <ConfidenceBadge value={row.grounded_confidence} />
            {row.grounded_generated_at && (
              <span className="text-xs text-muted-foreground dark:text-muted-foreground">
                Grounded {new Date(row.grounded_generated_at).toLocaleString()}
              </span>
            )}
          </div>

          <SuggestedResponsePanel
            row={row}
            isAutoDrafting={isAutoDrafting}
            userId={userId}
            canApprove={canApprove}
            onRowUpdated={onRowUpdated}
          />

          {row.required_action?.trim() ? (
            <DetailSection title="Required plan revision">{row.required_action}</DetailSection>
          ) : null}

          {row.missing_info_or_risk?.trim() ? (
            <DetailSection title="Missing / needs confirmation" variant="warning">
              {row.missing_info_or_risk}
            </DetailSection>
          ) : null}

          {evidence.length > 0 ? (
            <div className="space-y-2">
              <h4 className="text-xs font-mono uppercase tracking-[0.14em] text-muted-foreground dark:text-muted-foreground">
                Evidence found ({evidence.length})
              </h4>
              <div className="grid gap-3 sm:grid-cols-2">
                {evidence.map((item, i) => (
                  <EvidenceCitationCard key={i} item={item} index={i} />
                ))}
              </div>
            </div>
          ) : row.grounded_generated_at ? (
            <DetailSection title="Evidence found" variant="warning">
              No plan citations returned. Confirm drawings are prepared for AI or revise manually.
            </DetailSection>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2 pt-1">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground dark:text-muted-foreground">Assigned to</label>
              <Input
                value={row.assigned_to ?? ""}
                onChange={(e) => onUpdateAssigned(e.target.value)}
                placeholder="Name or email"
                className="border-border bg-card dark:bg-card-raised"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground dark:text-muted-foreground">Sheet reference</label>
              <Input
                value={row.sheet_reference ?? ""}
                onChange={(e) => onUpdateSheetRef(e.target.value)}
                placeholder="e.g. A1.02"
                className="border-border bg-card dark:bg-card-raised"
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground dark:text-muted-foreground">Plan markup</span>
            <MarkupStatusBadge commentId={row.id} projectId={row.project_id} />
          </div>
        </div>
      </div>
    </div>
  );
}

export interface GroundedEvidenceItem {
  document_id?: string;
  file_name?: string;
  page_number?: number | null;
  sheet_label?: string | null;
  sheet_title?: string | null;
  snippet?: string;
  relevance?: string;
}

export interface ParsedCommentRow {
  id: string;
  project_id: string;
  original_text: string;
  discipline: string;
  code_reference: string | null;
  status: string;
  page_number: number | null;
  response_text: string | null;
  assigned_to: string | null;
  sheet_reference: string | null;
  created_at: string;
  reviewer_name?: string | null;
  comment_number?: string | null;
  previous_comment_text?: string | null;
  existing_response_text?: string | null;
  code_references?: string[] | string | null;
  ingest_source?: string | null;
  source_document_id?: string | null;
  grounded_evidence?: GroundedEvidenceItem[] | null;
  required_action?: string | null;
  missing_info_or_risk?: string | null;
  grounded_confidence?: string | null;
  grounded_generated_at?: string | null;
  response_status?: string | null;
  ai_generated_response_text?: string | null;
  approved_at?: string | null;
  approved_by?: string | null;
  last_edited_at?: string | null;
  last_edited_by?: string | null;
  change_request_note?: string | null;
}

function CommentPreviewCell({ row, onExpand }: { row: ParsedCommentRow; onExpand: () => void }) {
  const ctx = buildFullCommentContext(row);
  const preview = commentPreviewText(row);
  const previous = ctx.previous_comment_text;
  const hasPreviousContext = Boolean(previous && ctx.should_expand_previous);

  return (
    <div className="max-w-[240px] space-y-1">
      {(ctx.reviewer_name || ctx.comment_number) && (
        <p className="text-[10px] font-mono uppercase tracking-wide text-muted-foreground dark:text-muted-foreground truncate">
          {[ctx.reviewer_name, ctx.comment_number ? `#${ctx.comment_number}` : null]
            .filter(Boolean)
            .join(" · ")}
        </p>
      )}
      <p
        className={cn(
          "text-sm line-clamp-2 leading-snug",
          preview
            ? "text-foreground dark:text-foreground"
            : "text-muted-foreground italic",
        )}
        title={preview || undefined}
      >
        {preview || "No comment text"}
      </p>
      {hasPreviousContext && (
        <p className="text-xs font-medium text-amber-800 dark:text-amber-300 line-clamp-1" title={previous}>
          Previous: {previous.slice(0, 80)}
          {previous.length > 80 ? "…" : ""}
        </p>
      )}
      <button
        type="button"
        onClick={onExpand}
        className="text-xs text-teal hover:underline font-medium"
      >
        View full comment
      </button>
    </div>
  );
}

function ResponsePreviewCell({ row }: { row: ParsedCommentRow }) {
  const text = row.response_text?.trim() ?? "";
  const hasGrounded = Boolean(row.grounded_generated_at || row.grounded_confidence);
  const approvalStatus = effectiveResponseStatus(row);
  return (
    <div className="max-w-[200px] space-y-1.5">
      {text ? (
        <p className="text-sm text-foreground dark:text-foreground line-clamp-2" title={text}>
          {text}
        </p>
      ) : (
        <p className="text-sm text-muted-foreground italic">No response yet</p>
      )}
      <div className="flex flex-wrap gap-1">
        {approvalStatus && (
          <Badge
            variant="outline"
            className={cn("text-[10px] font-medium", responseStatusBadgeClass(approvalStatus))}
          >
            {approvalStatus}
          </Badge>
        )}
        {hasGrounded && <ConfidenceBadge value={row.grounded_confidence} />}
        {row.required_action?.trim() && (
          <Badge variant="outline" className="text-[10px] border-teal/30 text-teal">
            Has action
          </Badge>
        )}
        {row.missing_info_or_risk?.trim() && (
          <Badge variant="outline" className="text-[10px] border-amber-500/40 text-amber-800 dark:text-amber-300">
            Gap noted
          </Badge>
        )}
      </div>
    </div>
  );
}

function ResponseConfidenceCell({ row }: { row: ParsedCommentRow }) {
  const text = row.response_text?.trim() ?? "";
  const hasGrounded = Boolean(row.grounded_generated_at || row.grounded_confidence);
  const approvalStatus = effectiveResponseStatus(row);
  return (
    <div className="max-w-[200px] space-y-1.5">
      {hasGrounded ? (
        <ConfidenceBadge value={row.grounded_confidence} />
      ) : (
        <span className="text-xs text-muted-foreground italic">No grounded draft yet</span>
      )}
      {approvalStatus && (
        <Badge
          variant="outline"
          className={cn("block w-fit text-[10px] font-medium", responseStatusBadgeClass(approvalStatus))}
        >
          {approvalStatus}
        </Badge>
      )}
      {text ? (
        <p className="text-xs text-muted-foreground line-clamp-2" title={text}>
          {text}
        </p>
      ) : null}
    </div>
  );
}

function commentMatrixSourceLabel(rows: ParsedCommentRow[]): string {
  const hasPortal = rows.some((r) => r.ingest_source === "raw_ref");
  const hasManual = rows.some((r) => r.ingest_source === "manual_letter");
  if (hasPortal && hasManual) return "Portal and manual uploaded comments";
  if (hasManual) return "Manual uploaded comments";
  if (hasPortal) return "Portal comments";
  return "Parsed comments";
}

export default function ResponseMatrix() {
  const { user, loading: authLoading } = useAuth();
  const { projectId } = useResolvedProjectId();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const filterPending = searchParams.get("filter") === "pending";
  // View label only (Lovable parity): default = Reconciliation (Response column).
  // `?view=scoring` swaps Response → AI Confidence. No reconciliation engine/backend.
  const scoringView = searchParams.get("view") === "scoring";
  const disciplineFilter = searchParams.get("discipline")?.trim() || "all";
  const metricFilter = parseResponseMatrixMetric(searchParams.get("metric"));
  const setMatrixView = useCallback(
    (v: "reconciliation" | "scoring") => {
      const next = new URLSearchParams(searchParams);
      if (v === "scoring") next.set("view", "scoring");
      else next.delete("view"); // Reconciliation = default comment/response queue
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
  );
  const togglePendingFilter = useCallback(() => {
    const next = new URLSearchParams(searchParams);
    if (filterPending) next.delete("filter");
    else next.set("filter", "pending");
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams, filterPending]);
  const setDisciplineFilter = useCallback(
    (value: string) => {
      const next = new URLSearchParams(searchParams);
      if (!value || value === "all") next.delete("discipline");
      else next.set("discipline", value);
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
  );
  const setMetricFilter = useCallback(
    (value: ResponseMatrixMetric | null) => {
      const next = new URLSearchParams(searchParams);
      if (!value) next.delete("metric");
      else next.set("metric", value);
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
  );
  const [saving, setSaving] = useState(false);
  const [reclassifying, setReclassifying] = useState(false);
  const timerRef = useRef<ReviewTimerHandle>(null);
  const [draftingId, setDraftingId] = useState<string | null>(null);
  const [expandedRowIds, setExpandedRowIds] = useState<Set<string>>(new Set());
  const [selectedRowIds, setSelectedRowIds] = useState<Set<string>>(new Set());
  const [validateOpen, setValidateOpen] = useState(false);
  const [validateResult, setValidateResult] = useState<{
    complete: boolean;
    stats: { total: number; responded: number; pending: number };
    missing: string[];
  } | null>(null);
  const [validating, setValidating] = useState(false);
  const [qualityCheckOpen, setQualityCheckOpen] = useState(false);
  const [qualityChecking, setQualityChecking] = useState(false);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [routing, setRouting] = useState(false);
  const [enriching, setEnriching] = useState(false);
  const [pipelineResuming, setPipelineResuming] = useState(false);
  const [planMarkupOpen, setPlanMarkupOpen] = useState(false);
  const [actionsMenuOpen, setActionsMenuOpen] = useState(false);
  const { hasPendingMarkups, pendingCount, refetch: refetchApproval, qualityCheckBlocked } = useApprovalGate(projectId ?? undefined);
  const { isOwner, isAdmin } = useProjectTeam(projectId);
  const canApproveResponses = isOwner || isAdmin;
  const { drafts: allDrafts } = useResponsePackageDrafts(projectId);
  const [qualityCheckResult, setQualityCheckResult] = useState<{
    project_id: string;
    results: Array<{
      id: string;
      score: number;
      flags: string[];
      notes: string;
      suggested_improvement: string;
    }>;
    summary: { avg_score: number; flagged_count: number; top_issues: string[] };
  } | null>(null);

  const fetchComments = useCallback(async (): Promise<ParsedCommentRow[]> => {
    if (!projectId) return [];
    const { data, error } = await supabase
      .from("parsed_comments")
      .select(
        "id, project_id, original_text, discipline, code_reference, status, page_number, response_text, assigned_to, sheet_reference, created_at, reviewer_name, comment_number, previous_comment_text, existing_response_text, code_references, ingest_source, source_document_id, grounded_evidence, required_action, missing_info_or_risk, grounded_confidence, grounded_generated_at, response_status, ai_generated_response_text, approved_at, approved_by, last_edited_at, last_edited_by, change_request_note",
      )
      .eq("project_id", projectId)
      .order("created_at", { ascending: true });
    if (error) {
      toast.error("Failed to load comments");
      return [];
    }
    return (data as ParsedCommentRow[]) || [];
  }, [projectId]);

  const queryClient = useQueryClient();
  const { data: allRows = [], isLoading: loading } = useQuery({
    queryKey: ["parsed_comments", projectId],
    queryFn: fetchComments,
    enabled: !!projectId,
  });

  const withoutMetadata = (allRows ?? []).filter((r) => !isReportMetadataRow(r));
  if (import.meta.env.DEV && allRows.length > withoutMetadata.length) {
    const excluded = allRows.filter((r) => isReportMetadataRow(r));
    console.info("[ResponseMatrix] Excluded metadata rows", {
      projectId,
      excludedCount: excluded.length,
      reasons: excluded.map((r) => ({
        id: r.id,
        ingest_source: r.ingest_source,
        textPreview: (r.original_text ?? r.previous_comment_text ?? "").slice(0, 40),
      })),
    });
  }
  const disciplineOptions = useMemo(() => {
    const keys = new Set<string>();
    for (const r of withoutMetadata) {
      const d = r.discipline?.trim();
      if (d) keys.add(d);
      else keys.add("Unclassified");
    }
    return Array.from(keys).sort((a, b) => {
      if (a === "Unclassified") return 1;
      if (b === "Unclassified") return -1;
      return a.localeCompare(b);
    });
  }, [withoutMetadata]);

  const rows = useMemo(() => {
    let next = withoutMetadata;
    if (filterPending && withoutMetadata.length > 0) {
      next = next.filter(
        (r) =>
          (r.status ?? "").toLowerCase() === "pending" ||
          r.response_text == null ||
          String(r.response_text).trim() === "",
      );
    }
    if (metricFilter) {
      next = next.filter((r) => classifyResponseLifecycle(r) === metricFilter);
    }
    if (disciplineFilter !== "all") {
      next = next.filter((r) => {
        const d = r.discipline?.trim() || "Unclassified";
        return d === disciplineFilter;
      });
    }
    return next;
  }, [withoutMetadata, filterPending, metricFilter, disciplineFilter]);

  const lastSubmittedDraft = useMemo(() => {
    return [...allDrafts]
      .filter((d) => d.status === "submitted" && d.comment_snapshot)
      .sort((a, b) => b.round_number - a.round_number)[0] ?? null;
  }, [allDrafts]);

  const modifiedCommentIds = useMemo(() => {
    return getModifiedCommentIds(withoutMetadata, lastSubmittedDraft);
  }, [withoutMetadata, lastSubmittedDraft]);

  useEffect(() => {
    if (!authLoading && !user) navigate("/auth");
  }, [user, authLoading, navigate]);

  const updateRow = (id: string, field: keyof ParsedCommentRow, value: string | null) => {
    if (!projectId) return;
    queryClient.setQueryData<ParsedCommentRow[]>(["parsed_comments", projectId], (prev) =>
      (prev ?? []).map((r) => (r.id === id ? { ...r, [field]: value } : r))
    );
  };

  const patchRow = useCallback(
    (id: string, patch: Partial<ParsedCommentRow>) => {
      if (!projectId) return;
      queryClient.setQueryData<ParsedCommentRow[]>(["parsed_comments", projectId], (prev) =>
        (prev ?? []).map((r) => (r.id === id ? { ...r, ...patch } : r)),
      );
    },
    [projectId, queryClient],
  );

  const runAutoDraft = useCallback(async (row: ParsedCommentRow) => {
    setDraftingId(row.id);
    try {
      const invokeBody = autoDraftPayloadFromRow(row);
      const { data, error } = await supabase.functions.invoke("generate-response", {
        body: invokeBody,
      });
      if (error) throw error;
      const payload = data as { suggested_response?: string } | null;
      const text = typeof payload?.suggested_response === "string" ? payload.suggested_response : "";
      if (!text) {
        toast.error("No response generated");
        return;
      }
      const { error: updateError } = await supabase
        .from("parsed_comments")
        .update({
          response_text: text,
          response_status: "AI Generated",
          ai_generated_response_text: text,
          approved_at: null,
          approved_by: null,
          change_request_note: null,
        })
        .eq("id", row.id);
      if (updateError) throw updateError;
      queryClient.setQueryData<ParsedCommentRow[]>(["parsed_comments", row.project_id], (prev) =>
        (prev ?? []).map((r) =>
          r.id === row.id
            ? {
                ...r,
                response_text: text,
                response_status: "AI Generated",
                ai_generated_response_text: text,
                approved_at: null,
                approved_by: null,
                change_request_note: null,
              }
            : r,
        ),
      );
      const snippet = text.length > 60 ? `${text.slice(0, 60).trim()}…` : text;
      toast.success(`Response drafted. ${snippet ? `"${snippet}"` : ""}`);
    } catch (err: unknown) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : "Auto-draft failed. You can retry.");
    } finally {
      setDraftingId(null);
    }
  }, [queryClient]);

  const executeGroundedDraftById = useCallback(
    async (commentId: string) => {
      const row =
        rows.find((r) => r.id === commentId) ??
        queryClient
          .getQueryData<ParsedCommentRow[]>(["parsed_comments", projectId])
          ?.find((r) => r.id === commentId);
      if (!row) throw new Error("Comment not found");

      const invokeBody = groundedDraftPayloadFromRow(row);
      const { data, error } = await supabase.functions.invoke("generate-grounded-response", {
        body: invokeBody,
      });
      if (error) throw error;

      const result = data as {
        error?: string;
        code?: string;
        suggested_response?: string;
        required_action?: string;
        missing_info_or_risk?: string;
        confidence?: string;
        evidence?: GroundedEvidenceItem[];
      } | null;

      if (result?.code === "no_review_text") {
        const message = result.error ?? GROUNDED_NO_REVIEW_TEXT_MESSAGE;
        toast.error(message);
        throw new GroundedValidationSkip(message);
      }

      if (result?.code === "no_prepared_documents") {
        throw new Error(
          result.error ??
            "No AI-prepared documents found. Go to Project Documents and click Prepare for AI on the plan set.",
        );
      }

      if (result?.error) {
        throw new Error(result.error);
      }

      const text = result?.suggested_response ?? "";
      const sheetRef =
        result?.evidence?.find((e) => e.relevance === "high" && e.sheet_label)?.sheet_label ??
        result?.evidence?.find((e) => e.sheet_label)?.sheet_label ??
        null;

      queryClient.setQueryData<ParsedCommentRow[]>(["parsed_comments", row.project_id], (prev) =>
        (prev ?? []).map((r) =>
          r.id === row.id
            ? {
                ...r,
                response_text: text,
                sheet_reference: sheetRef ?? r.sheet_reference,
                grounded_evidence: result?.evidence ?? [],
                required_action: result?.required_action ?? null,
                missing_info_or_risk: result?.missing_info_or_risk ?? null,
                grounded_confidence: result?.confidence ?? null,
                grounded_generated_at: new Date().toISOString(),
                response_status: text ? "AI Generated" : r.response_status ?? null,
                ai_generated_response_text: text || null,
                approved_at: null,
                approved_by: null,
                change_request_note: null,
              }
            : r,
        ),
      );

      if (text) {
        await supabase
          .from("parsed_comments")
          .update({
            response_status: "AI Generated",
            ai_generated_response_text: text,
            approved_at: null,
            approved_by: null,
            change_request_note: null,
          })
          .eq("id", row.id);
      }

      setExpandedRowIds((prev) => new Set(prev).add(row.id));
      toast.success(
        `Grounded draft ready (${result?.confidence ?? "unknown"} confidence, ${result?.evidence?.length ?? 0} citations)`,
      );
    },
    [rows, queryClient, projectId],
  );

  const {
    statusById: groundedStatusById,
    errorById: groundedErrorById,
    batchProgress: groundedBatchProgress,
    enqueue: enqueueGrounded,
    isBusy: isGroundedBusy,
    resetStatus: resetGroundedStatus,
  } = useGroundedDraftQueue(executeGroundedDraftById, 2);

  const runGroundedDraft = useCallback(
    (row: ParsedCommentRow) => {
      const validationError = getGroundedDraftValidationError(row);
      if (validationError) {
        toast.error(validationError);
        return;
      }
      resetGroundedStatus(row.id);
      enqueueGrounded([row.id]);
    },
    [enqueueGrounded, resetGroundedStatus],
  );

  const runBatchGrounded = useCallback(
    (ids: string[]) => {
      if (ids.length === 0) {
        toast.error("Select at least one comment");
        return;
      }
      const validIds: string[] = [];
      let skipped = 0;
      for (const id of ids) {
        const row =
          rows.find((r) => r.id === id) ??
          queryClient
            .getQueryData<ParsedCommentRow[]>(["parsed_comments", projectId])
            ?.find((r) => r.id === id);
        if (!row) continue;
        if (getGroundedDraftValidationError(row)) {
          skipped += 1;
          continue;
        }
        validIds.push(id);
      }
      if (validIds.length === 0) {
        toast.error(GROUNDED_NO_REVIEW_TEXT_MESSAGE);
        return;
      }
      if (skipped > 0) {
        toast.info(
          `Skipped ${skipped} comment${skipped === 1 ? "" : "s"} with no review text`,
        );
      }
      for (const id of validIds) resetGroundedStatus(id);
      const added = enqueueGrounded(validIds);
      if (added === 0) toast.info("Selected comments are already generating");
    },
    [enqueueGrounded, resetGroundedStatus, rows, queryClient, projectId],
  );

  const toggleExpandRow = useCallback((id: string) => {
    setExpandedRowIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectRow = useCallback((id: string) => {
    setSelectedRowIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    setSelectedRowIds((prev) =>
      prev.size === rows.length ? new Set() : new Set(rows.map((r) => r.id)),
    );
  }, [rows]);

  const runValidateCompleteness = useCallback(async () => {
    if (!projectId) {
      toast.error("Select a project first");
      return;
    }
    setValidating(true);
    setValidateResult(null);
    setValidateOpen(true);
    try {
      const { data, error } = await supabase.functions.invoke("validate-completeness-agent", {
        body: { project_id: projectId },
      });
      if (error) throw error;
      const payload = data as {
        complete?: boolean;
        stats?: { total: number; responded: number; pending: number };
        missing?: string[];
      };
      setValidateResult({
        complete: payload?.complete ?? false,
        stats: payload?.stats ?? { total: 0, responded: 0, pending: 0 },
        missing: Array.isArray(payload?.missing) ? payload.missing : [],
      });
    } catch (e) {
      console.warn("Validate completeness failed:", e);
      toast.error("Validation failed");
      setValidateResult({
        complete: false,
        stats: { total: 0, responded: 0, pending: 0 },
        missing: [],
      });
    } finally {
      setValidating(false);
    }
  }, [projectId]);

  const runQualityCheck = useCallback(async () => {
    if (!projectId) {
      toast.error("Select a project first");
      return;
    }
    setQualityChecking(true);
    setQualityCheckResult(null);
    setQualityCheckOpen(true);
    try {
      const { data, error } = await supabase.functions.invoke("guardian-quality-agent", {
        body: { project_id: projectId },
      });
      if (error) throw error;
      const payload = data as {
        project_id?: string;
        results?: Array<{ id: string; score: number; flags: string[]; notes: string; suggested_improvement: string }>;
        summary?: { avg_score?: number; flagged_count?: number; top_issues?: string[] };
      };
      setQualityCheckResult({
        project_id: payload?.project_id ?? projectId,
        results: Array.isArray(payload?.results) ? payload.results : [],
        summary: {
          avg_score: payload?.summary?.avg_score ?? 0,
          flagged_count: payload?.summary?.flagged_count ?? 0,
          top_issues: Array.isArray(payload?.summary?.top_issues) ? payload.summary.top_issues : [],
        },
      });
    } catch (e) {
      console.warn("Quality check failed:", e);
      toast.error("Quality check failed");
      setQualityCheckResult({
        project_id: projectId,
        results: [],
        summary: { avg_score: 0, flagged_count: 0, top_issues: [] },
      });
    } finally {
      setQualityChecking(false);
    }
  }, [projectId]);


  const runEnrichment = useCallback(async () => {
    if (!projectId) {
      toast.error("Select a project first");
      return;
    }
    setEnriching(true);
    try {
      const { data, error } = await supabase.functions.invoke("intake-pipeline-agent", {
        body: { project_id: projectId, run_enrichment_only: true, force_retry: true },
      });
      if (error) throw error;
      const payload = data as { enrichment?: { enriched_count?: number; error?: string }; next_action?: string };
      if (payload?.enrichment?.error) {
        toast.error(payload.enrichment.error);
        return;
      }
      const enrichedCount = payload?.enrichment?.enriched_count ?? 0;
      toast.success(`Enriched ${enrichedCount} comments`);
      queryClient.invalidateQueries({ queryKey: ["parsed_comments", projectId] });
      queryClient.invalidateQueries({ queryKey: ["parsed_comments_code_ref_check", projectId] });
    } catch (e) {
      console.warn("Run enrichment failed:", e);
      toast.error("Run enrichment failed");
    } finally {
      setEnriching(false);
    }
  }, [projectId, queryClient]);

  /** Re-runs the discipline model on every parsed row (from former Classified Comments page). */
  const refreshClassifications = useCallback(async () => {
    if (!projectId) {
      toast.error("Select a project first");
      return;
    }
    setReclassifying(true);
    try {
      const { count: totalInDb, error: countErr } = await supabase
        .from("parsed_comments")
        .select("id", { count: "exact", head: true })
        .eq("project_id", projectId);
      if (countErr) throw countErr;
      const loaded = totalInDb ?? 0;
      if (loaded === 0) {
        toast.info("No parsed comments in the database for this project yet.");
        return;
      }
      toast.info(`Sending ${loaded} parsed comment(s) to the discipline classifier…`);

      const { data, error } = await supabase.functions.invoke("discipline-classifier-agent", {
        body: { project_id: projectId, reclassify_all: true },
      });
      if (error) throw error;

      const payload = data as {
        code?: number;
        message?: string;
        classified_count?: number;
        rows_sent?: number;
        parsed_comments_total?: number;
      };
      if (payload?.code != null && payload.code >= 400) {
        throw new Error(payload.message ?? `Classifier returned ${payload.code}`);
      }

      const rowsSent = payload?.rows_sent ?? 0;
      const updated = payload?.classified_count ?? 0;
      const total = payload?.parsed_comments_total ?? loaded;

      await queryClient.invalidateQueries({ queryKey: ["parsed_comments"] });
      toast.success(
        `Discipline classifier: updated ${updated} row(s) (processed ${rowsSent} of ${total} parsed comment(s)).`,
      );
    } catch (e) {
      console.error("[ResponseMatrix] discipline-classifier-agent", e);
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(`Classifier failed: ${msg}`);
    } finally {
      setReclassifying(false);
    }
  }, [projectId, queryClient]);

  const runRouteComments = useCallback(async () => {
    if (!projectId) {
      toast.error("Select a project first");
      return;
    }
    setRouting(true);
    try {
      const { data, error } = await supabase.functions.invoke("intake-pipeline-agent", {
        body: { project_id: projectId, run_routing_only: true, force_retry: true },
      });
      if (error) throw error;
      const payload = data as { auto_routing?: { routed_count?: number; error?: string } };
      if (payload?.auto_routing?.error) {
        toast.error(payload.auto_routing.error);
        return;
      }
      const routedCount = payload?.auto_routing?.routed_count ?? 0;
      toast.success(`Routed ${routedCount} comments`);
      queryClient.invalidateQueries({ queryKey: ["parsed_comments", projectId] });
      queryClient.invalidateQueries({ queryKey: ["parsed_comments_assigned_check", projectId] });
    } catch (e) {
      console.warn("Route comments failed:", e);
      toast.error("Route comments failed");
    } finally {
      setRouting(false);
    }
  }, [projectId, queryClient]);

  const runResumePipeline = useCallback(async () => {
    if (!projectId) {
      toast.error("Select a project first");
      return;
    }
    setPipelineResuming(true);
    try {
      const { data: projectRow } = await supabase
        .from("projects")
        .select("portal_data_hash")
        .eq("id", projectId)
        .maybeSingle();
      const { data, error } = await supabase.functions.invoke("intake-pipeline-agent", {
        body: {
          project_id: projectId,
          resume_pipeline: true,
          force_retry: true,
          ...(projectRow?.portal_data_hash ? { portal_data_hash: projectRow.portal_data_hash } : {}),
        },
      });
      if (error) throw error;
      const payload = data as { next_action?: string; stages?: Record<string, { status?: string; error?: string }> };
      if (payload?.next_action === "complete") {
        toast.success("Pipeline resumed and completed");
      } else if (payload?.next_action?.startsWith("retry_")) {
        const failedStage = Object.entries(payload.stages ?? {}).find(([, v]) => v.status === "failed");
        toast.error(failedStage?.[1]?.error ?? `Pipeline stopped at ${payload.next_action}`);
      } else {
        toast.info("Pipeline resume in progress — check Agent Workflow for status");
      }
      queryClient.invalidateQueries({ queryKey: ["parsed_comments", projectId] });
      queryClient.invalidateQueries({ queryKey: ["project_pipeline_run", projectId] });
    } catch (e) {
      console.warn("Resume pipeline failed:", e);
      toast.error("Resume pipeline failed");
    } finally {
      setPipelineResuming(false);
    }
  }, [projectId, queryClient]);

  const applySuggestion = useCallback(
    (commentId: string, suggested_improvement: string) => {
      updateRow(commentId, "response_text", suggested_improvement);
      patchRow(commentId, {
        response_status: "Draft",
        approved_at: null,
        approved_by: null,
      });
      toast.success("Suggestion applied as draft. Save from the response panel to persist.");
    },
    [patchRow, updateRow],
  );

  const saveChanges = useCallback(async () => {
    if (!user || rows.length === 0) return;
    setSaving(true);
    if (timerRef.current?.isRunning()) {
      await timerRef.current.stopAndSave();
    }
    try {
      for (const row of rows) {
        const { error } = await supabase
          .from("parsed_comments")
          .update({
            assigned_to: row.assigned_to || null,
            sheet_reference: row.sheet_reference || null,
            status: row.status,
          })
          .eq("id", row.id);
        if (error) throw error;
      }
      toast.success("Changes saved");
      queryClient.invalidateQueries({ queryKey: ["parsed_comments", projectId] });
    } catch (err: unknown) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }, [user, rows, projectId, queryClient]);

  const matrixSourceLabel = commentMatrixSourceLabel(withoutMetadata);
  const pipelineBusy = enriching || routing || pipelineResuming;
  const lifecycleCounts = useMemo(
    () => countLifecycleMetrics(withoutMetadata),
    [withoutMetadata],
  );

  const runActionsMenuItem = useCallback((action: () => void) => {
    setActionsMenuOpen(false);
    action();
  }, []);

  const commentReviewPath = projectId
    ? `/comment-review?project_id=${encodeURIComponent(projectId)}`
    : "/comment-review";

  const metricChipLabel: Record<ResponseMatrixMetric, string> = {
    "needs-response": "Needs Response",
    "in-draft": "In Draft",
    accepted: "Accepted",
  };

  if (authLoading) {
    return (
      <div className="min-h-[80vh] flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-teal" />
      </div>
    );
  }

  return (
    <div className="min-h-[80vh] w-full min-w-0 space-y-3 overflow-x-hidden bg-background text-foreground">
      <style>{RESPONSE_MATRIX_STYLES}</style>
      <PageHeader
        compact
        className="mb-0"
        eyebrow="Response Matrix"
        title="Comment response queue"
        body={
          <>
            Draft and approve responses to permit comments.
            {withoutMetadata.length > 0 ? (
              <span className="text-muted-foreground/80"> · {matrixSourceLabel}</span>
            ) : null}
          </>
        }
        action={
          <div
            className="flex rounded-md border border-border bg-card p-0.5 text-xs"
            role="group"
            aria-label="Matrix view"
          >
            {(["reconciliation", "scoring"] as const).map((v) => {
              const active = (v === "scoring") === scoringView;
              return (
                <button
                  key={v}
                  type="button"
                  onClick={() => setMatrixView(v)}
                  aria-pressed={active}
                  title={
                    v === "scoring"
                      ? "Show AI confidence column"
                      : "Show response column (default queue view)"
                  }
                  className={cn(
                    "rounded px-3 py-1.5 transition-colors",
                    active
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {v === "scoring" ? "AI Scoring" : "Reconciliation"}
                </button>
              );
            })}
          </div>
        }
      />

      {/* Metric chips — lifecycle filters; Cross-service is Upcoming placeholder only */}
      <div
        className="flex min-w-0 flex-wrap items-center gap-1.5"
        role="group"
        aria-label="Response lifecycle metrics"
      >
        <button
          type="button"
          data-testid="metric-chip-all"
          aria-pressed={metricFilter == null}
          onClick={() => setMetricFilter(null)}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs transition-colors",
            metricFilter == null
              ? "border-primary bg-primary/10 font-medium text-foreground"
              : "border-border bg-card text-muted-foreground hover:text-foreground",
          )}
        >
          All
          <span className="font-data font-semibold tabular-nums text-foreground">
            {withoutMetadata.length}
          </span>
        </button>
        {(
          [
            ["needs-response", lifecycleCounts.needsResponse] as const,
            ["in-draft", lifecycleCounts.inDraft] as const,
            ["accepted", lifecycleCounts.accepted] as const,
          ] as const
        ).map(([key, count]) => (
          <button
            key={key}
            type="button"
            data-testid={`metric-chip-${key}`}
            aria-pressed={metricFilter === key}
            title={`Show ${metricChipLabel[key].toLowerCase()} comments`}
            onClick={() => setMetricFilter(metricFilter === key ? null : key)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs transition-colors",
              metricFilter === key
                ? "border-primary bg-primary/10 font-medium text-foreground"
                : "border-border bg-card text-muted-foreground hover:text-foreground",
            )}
          >
            <span>{metricChipLabel[key]}</span>
            <span className="font-data font-semibold tabular-nums text-foreground">{count}</span>
          </button>
        ))}
        <span
          className="inline-flex max-w-full flex-wrap items-center gap-1.5 rounded-md border border-dashed border-border bg-muted/30 px-2.5 py-1 text-xs text-muted-foreground"
          data-testid="metric-chip-cross-service"
        >
          <span>Cross-service</span>
          <span className="font-data font-semibold tabular-nums">—</span>
          <span
            className="inline-flex items-center rounded border border-border bg-muted/50 px-1.5 py-0.5 font-data text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
            data-testid="badge-cross-service-upcoming"
          >
            Upcoming
          </span>
          <span className="basis-full text-[10px] leading-snug text-muted-foreground sm:basis-auto sm:max-w-[14rem]">
            Utility/provider comments will appear after backend integration
          </span>
        </span>
      </div>

      {/* Compact command toolbar */}
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Button
          variant={filterPending ? "default" : "outline"}
          size="sm"
          className="h-8 shrink-0 gap-1 px-2 text-xs [&_svg]:size-3.5"
          onClick={togglePendingFilter}
          data-testid="matrix-pending-filter"
        >
          <Filter />
          {filterPending ? "Pending only" : "Filter"}
        </Button>
        {disciplineOptions.length > 0 ? (
          <Select value={disciplineFilter} onValueChange={setDisciplineFilter}>
            <SelectTrigger
              className="h-8 w-[140px] shrink-0 text-xs"
              data-testid="matrix-discipline-filter"
            >
              <SelectValue placeholder="Discipline" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All disciplines</SelectItem>
              {disciplineOptions.map((d) => (
                <SelectItem key={d} value={d}>
                  {d}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
        {projectId && (
          <span className="inline-flex h-6 min-w-[24px] shrink-0 items-center justify-center rounded-full border border-border bg-muted px-2 text-xs font-medium">
            {withoutMetadata.length} comment{withoutMetadata.length !== 1 ? "s" : ""}
          </span>
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate("/dashboard")}
          className="ml-auto h-8 shrink-0 gap-1 px-2 text-xs text-muted-foreground"
          aria-label="Back to dashboard"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Dashboard</span>
        </Button>
      </div>

      <div className="w-full min-w-0">
        <Panel className="overflow-hidden p-0" title={undefined}>
          <div className="border-b border-border px-4 py-2.5 sm:px-5">
            <p className="pilot-kicker mb-0.5">Reconciliation view</p>
            <h2 className="font-tight text-lg font-bold text-foreground">Comment response queue</h2>
          </div>

          {/* Sticky queue toolbar: Timer / Export / Actions / Save */}
          <div className="sticky top-0 z-30 flex flex-wrap items-center gap-2 border-b border-border bg-background/95 px-4 py-2 backdrop-blur supports-[backdrop-filter]:bg-background/90 sm:px-5">
            <ReviewTimer ref={timerRef} projectId={projectId} commentCount={rows.length} />
            <ResponseMatrixExportMenu projectId={projectId} rows={rows} />
            <DropdownMenu open={actionsMenuOpen} onOpenChange={setActionsMenuOpen}>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!projectId}
                  data-testid="button-actions-dropdown"
                  className="shrink-0"
                >
                  Actions
                  <ChevronDown className="h-3.5 w-3.5 ml-1.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onClick={() => runActionsMenuItem(runValidateCompleteness)}
                  disabled={!projectId || validating}
                  data-testid="menu-validate-completeness"
                >
                  {validating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
                  Validate Completeness
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => runActionsMenuItem(runQualityCheck)}
                  disabled={!projectId || qualityChecking || qualityCheckBlocked}
                  data-testid="menu-quality-check"
                >
                  {qualityChecking ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <ShieldCheck className="h-4 w-4 mr-2" />}
                  Quality Check
                  {qualityCheckBlocked && (
                    <AlertCircle className="h-3.5 w-3.5 ml-1 text-amber-500" />
                  )}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => runActionsMenuItem(() => setPlanMarkupOpen(true))}
                  disabled={!projectId}
                  data-testid="menu-plan-markup"
                >
                  <PenTool className="h-4 w-4 mr-2" />
                  Plan Markup
                  {hasPendingMarkups && (
                    <Badge variant="destructive" className="ml-1.5 text-[10px] px-1.5 py-0">
                      {pendingCount}
                    </Badge>
                  )}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => runActionsMenuItem(runEnrichment)}
                  disabled={!projectId || pipelineBusy}
                  data-testid="menu-run-enrichment"
                >
                  {enriching ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Sparkles className="h-4 w-4 mr-2" />}
                  Run Enrichment
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => runActionsMenuItem(runRouteComments)}
                  disabled={!projectId || pipelineBusy}
                  data-testid="menu-route-comments"
                >
                  {routing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <UserCheck className="h-4 w-4 mr-2" />}
                  Run Auto Routing
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => runActionsMenuItem(refreshClassifications)}
                  disabled={!projectId || reclassifying || pipelineBusy}
                  data-testid="menu-refresh-classifications"
                >
                  {reclassifying ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
                  Refresh Classifications
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => runActionsMenuItem(runResumePipeline)}
                  disabled={!projectId || pipelineBusy}
                  data-testid="menu-resume-pipeline"
                >
                  {pipelineResuming ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RotateCcw className="h-4 w-4 mr-2" />}
                  Resume Pipeline
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() =>
                    runActionsMenuItem(() =>
                      runBatchGrounded(
                        rows
                          .filter(
                            (r) =>
                              !r.response_text?.trim() ||
                              (r.status ?? "").toLowerCase() === "pending" ||
                              (r.status ?? "").toLowerCase() === "pending review",
                          )
                          .map((r) => r.id),
                      ),
                    )
                  }
                  disabled={rows.length === 0 || Boolean(groundedBatchProgress)}
                  data-testid="menu-auto-draft"
                >
                  {groundedBatchProgress ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <Sparkles className="h-4 w-4 mr-2" />
                  )}
                  Auto-Draft
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => runActionsMenuItem(() => navigate(commentReviewPath))}
                  data-testid="menu-upload-parse-comments"
                >
                  <FileSearch className="h-4 w-4 mr-2" />
                  Upload &amp; Parse Comments
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => runActionsMenuItem(() => navigate(commentReviewPath))}
                  data-testid="menu-review-parsed-comments"
                >
                  <ListChecks className="h-4 w-4 mr-2" />
                  Review Parsed Comments
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => runActionsMenuItem(() => setExportDialogOpen(true))}
                  disabled={!projectId}
                  data-testid="menu-export-response-package"
                >
                  <FileDown className="h-4 w-4 mr-2" />
                  Export Response Package
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              variant="gold"
              size="sm"
              onClick={saveChanges}
              disabled={saving || rows.length === 0}
              className="shrink-0 sm:ml-auto"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
              Save Changes
            </Button>
          </div>

          <div className="space-y-3 p-4 sm:p-5">

        <Dialog open={validateOpen} onOpenChange={setValidateOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Completeness check</DialogTitle>
              <DialogDescription>
                {validating
                  ? "Checking comments..."
                  : validateResult
                    ? validateResult.complete
                      ? "All comments have a response and are Ready for Review or Approved."
                      : `${validateResult.stats.pending} comment(s) still need a response and/or status update.`
                    : "Run a quick check to see if the project is ready for submission."}
              </DialogDescription>
            </DialogHeader>
            {!validating && validateResult && (
              <div className="py-2">
                <p className="text-base font-medium">
                  {validateResult.complete
                    ? "Project ready for submission."
                    : `Project NOT ready. ${validateResult.stats.pending} comment(s) still missing responses.`}
                </p>
                <p className="text-sm text-muted-foreground mt-2">
                  Total: {validateResult.stats.total} · Responded: {validateResult.stats.responded} · Pending: {validateResult.stats.pending}
                </p>
              </div>
            )}
          </DialogContent>
        </Dialog>

        <Dialog open={qualityCheckOpen} onOpenChange={setQualityCheckOpen}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Quality check</DialogTitle>
              <DialogDescription>
                {qualityChecking
                  ? "Reviewing responses..."
                  : qualityCheckResult
                    ? `Average score: ${qualityCheckResult.summary.avg_score.toFixed(1)} · ${qualityCheckResult.summary.flagged_count} flagged`
                    : "Score each response and flag vague or incomplete answers."}
              </DialogDescription>
            </DialogHeader>
            {!qualityChecking && qualityCheckResult && (
              <div className="space-y-4 py-2">
                <div className="flex gap-4 text-sm">
                  <span className="font-medium">Avg score: {qualityCheckResult.summary.avg_score.toFixed(1)}</span>
                  <span className="text-muted-foreground">Flagged: {qualityCheckResult.summary.flagged_count}</span>
                </div>
                {qualityCheckResult.summary.top_issues.length > 0 && (
                  <p className="text-sm text-muted-foreground">
                    Top issues: {qualityCheckResult.summary.top_issues.join("; ")}
                  </p>
                )}
                {qualityCheckResult.results.filter((r) => r.flags?.length > 0).length > 0 ? (
                  <div className="border rounded-md overflow-auto max-h-[50vh]">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-12">Score</TableHead>
                          <TableHead>Comment / Notes</TableHead>
                          <TableHead>Suggested improvement</TableHead>
                          <TableHead className="w-28">Action</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {qualityCheckResult.results
                          .filter((r) => r.flags?.length > 0)
                          .map((item) => {
                            const row = allRows.find((r) => r.id === item.id);
                            const commentPreview = row?.original_text?.slice(0, 80) ?? item.id;
                            return (
                              <TableRow key={item.id}>
                                <TableCell className="font-mono">{item.score}</TableCell>
                                <TableCell className="text-sm">
                                  <p className="truncate max-w-[200px]" title={row?.original_text ?? ""}>
                                    {commentPreview}
                                    {commentPreview.length >= 80 ? "…" : ""}
                                  </p>
                                  <p className="text-muted-foreground text-xs mt-1">{item.notes}</p>
                                  <Badge variant="secondary" className="mt-1">
                                    {item.flags?.join(", ")}
                                  </Badge>
                                </TableCell>
                                <TableCell className="text-sm max-w-[220px]">
                                  {item.suggested_improvement ? (
                                    <p className="line-clamp-3">{item.suggested_improvement}</p>
                                  ) : (
                                    <span className="text-muted-foreground">—</span>
                                  )}
                                </TableCell>
                                <TableCell>
                                  {item.suggested_improvement ? (
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      onClick={() => applySuggestion(item.id, item.suggested_improvement)}
                                    >
                                      Apply suggestion
                                    </Button>
                                  ) : null}
                                </TableCell>
                              </TableRow>
                            );
                          })}
                      </TableBody>
                    </Table>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No flagged items.</p>
                )}
              </div>
            )}
          </DialogContent>
        </Dialog>

        {projectId && (
          <ExportPackageDialog
            open={exportDialogOpen}
            onOpenChange={setExportDialogOpen}
            projectId={projectId}
            comments={rows.map((r) => ({ id: r.id, original_text: r.original_text, status: r.status, response_text: r.response_text }))}
          />
        )}

        {projectId && (
          <PlanMarkupWorkspace
            open={planMarkupOpen}
            onOpenChange={setPlanMarkupOpen}
            projectId={projectId}
            comments={withoutMetadata.map((r) => ({
              id: r.id,
              original_text: r.original_text,
              discipline: r.discipline,
              status: r.status,
              page_number: r.page_number,
              sheet_reference: r.sheet_reference,
              code_reference: r.code_reference,
              response_text: r.response_text,
            }))}
            onApprovalChanged={() => refetchApproval()}
          />
        )}

        {!projectId ? (
          <div className="flex flex-col items-center justify-center py-16 px-4 rounded-xl border border-dashed border-border bg-muted/20">
            <div className="flex items-center justify-center w-16 h-16 rounded-full bg-muted/50 mb-4">
              <FileQuestion className="h-8 w-8 text-muted-foreground" />
            </div>
            <p className="text-lg font-medium text-foreground">No project selected</p>
            <p className="text-sm text-muted-foreground mt-1 text-center max-w-sm">
              Select a project from the sidebar to load and manage parsed comments.
            </p>
            <Button variant="outline" size="sm" className="mt-4" onClick={() => navigate("/dashboard")}>
              Go to Dashboard
            </Button>
          </div>
        ) : loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 px-4 rounded-xl border border-dashed border-border bg-muted/20">
            <div className="flex items-center justify-center w-16 h-16 rounded-full bg-muted/50 mb-4">
              <FileQuestion className="h-8 w-8 text-muted-foreground" />
            </div>
            <p className="text-lg font-medium text-foreground">No comments found</p>
            <p className="text-sm text-muted-foreground mt-1 text-center max-w-sm">
              {filterPending
                ? "No pending comments for this project."
                : metricFilter
                  ? `No comments in “${metricChipLabel[metricFilter]}”.`
                  : disciplineFilter !== "all"
                    ? `No comments in discipline “${disciplineFilter}”.`
                    : "Upload or load portal comments in Comment Review, then return here to draft and approve responses."}
            </p>
            <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
              {metricFilter ? (
                <Button variant="outline" size="sm" onClick={() => setMetricFilter(null)}>
                  Clear metric filter
                </Button>
              ) : null}
              <Button variant="outline" size="sm" onClick={() => navigate("/dashboard")}>
                Go to Dashboard
              </Button>
            </div>
          </div>
        ) : (
          <>
          {(filterPending || metricFilter || disciplineFilter !== "all") && (
            <p className="text-sm text-muted-foreground mb-2 flex flex-wrap gap-2">
              {filterPending ? (
                <Badge variant="secondary">Showing pending comments only</Badge>
              ) : null}
              {metricFilter ? (
                <Badge variant="secondary">{metricChipLabel[metricFilter]}</Badge>
              ) : null}
              {disciplineFilter !== "all" ? (
                <Badge variant="secondary">Discipline: {disciplineFilter}</Badge>
              ) : null}
            </p>
          )}
          <p className="text-sm text-muted-foreground mb-2">{matrixSourceLabel}</p>
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <Button
              variant="outline"
              size="sm"
              disabled={selectedRowIds.size === 0 || Boolean(groundedBatchProgress)}
              onClick={() => runBatchGrounded([...selectedRowIds])}
              className="border-teal/40 text-teal hover:bg-teal/10"
            >
              <Sparkles className="h-4 w-4 mr-1.5" />
              Generate Grounded for Selected ({selectedRowIds.size})
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={rows.length === 0 || Boolean(groundedBatchProgress)}
              onClick={() =>
                runBatchGrounded(
                  rows
                    .filter(
                      (r) =>
                        !r.response_text?.trim() ||
                        (r.status ?? "").toLowerCase() === "pending" ||
                        (r.status ?? "").toLowerCase() === "pending review",
                    )
                    .map((r) => r.id),
                )
              }
              className="border-teal/40 text-teal hover:bg-teal/10"
            >
              Generate Grounded for Pending
            </Button>
            {groundedBatchProgress && (
              <span className="text-sm text-muted-foreground dark:text-muted-foreground flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin text-teal" />
                Generating {groundedBatchProgress.completed + groundedBatchProgress.active} of{" "}
                {groundedBatchProgress.total}…
              </span>
            )}
          </div>
          <div className="rounded-lg border border-border bg-card overflow-hidden">
            <div className="overflow-x-auto">
            <Table
              wrapperClassName="rounded-none border-0 shadow-none bg-transparent dark:border-0"
              className="w-full min-w-[960px]"
            >
              <TableHeader className="dark:[&_tr]:!bg-transparent">
                <TableRow className="border-b border-border !bg-muted/60 hover:!bg-muted/80">
                  <TableHead className="w-10 table-head-sticky px-2 py-3">
                    <Checkbox
                      checked={rows.length > 0 && selectedRowIds.size === rows.length}
                      onCheckedChange={toggleSelectAll}
                      aria-label="Select all comments"
                    />
                  </TableHead>
                  <TableHead className="w-10 table-head-sticky px-2 py-3" />
                  <TableHead className="w-[120px] table-head-sticky px-3 py-3 text-left text-[10px] font-mono uppercase tracking-[0.16em] text-muted-foreground">
                    Status
                  </TableHead>
                  <TableHead className="w-[100px] table-head-sticky px-3 py-3 text-left text-[10px] font-mono uppercase tracking-[0.16em] text-muted-foreground">
                    Discipline
                  </TableHead>
                  <TableHead className="min-w-[200px] table-head-sticky px-3 py-3 text-left text-[10px] font-mono uppercase tracking-[0.16em] text-muted-foreground">
                    Comment
                  </TableHead>
                  <TableHead className="w-[130px] table-head-sticky px-3 py-3 text-left text-[10px] font-mono uppercase tracking-[0.16em] text-muted-foreground">
                    Code Ref.
                  </TableHead>
                  <TableHead className="min-w-[180px] table-head-sticky px-3 py-3 text-left text-[10px] font-mono uppercase tracking-[0.16em] text-muted-foreground">
                    {scoringView ? "AI Confidence" : "Response"}
                  </TableHead>
                  <TableHead className="w-[120px] table-head-sticky px-3 py-3 text-left text-[10px] font-mono uppercase tracking-[0.16em] text-muted-foreground">
                    Draft
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row, idx) => {
                  const isExpanded = expandedRowIds.has(row.id);
                  const isAutoDrafting = draftingId === row.id;
                  const groundedStatus = groundedStatusById[row.id] ?? "idle";
                  const groundedBusy = isGroundedBusy(row.id);
                  const groundedError = groundedErrorById[row.id];

                  return (
                    <Fragment key={row.id}>
                      <TableRow
                        className={cn(
                          "border-t border-border bg-card hover:!bg-muted/40",
                          idx % 2 === 1 && "!bg-muted/20 hover:!bg-muted/50",
                          "text-foreground transition-colors duration-150",
                          statusBorderClass(row.status),
                          isExpanded && "!bg-muted/50",
                        )}
                      >
                        <TableCell className="align-middle w-10 px-2">
                          <Checkbox
                            checked={selectedRowIds.has(row.id)}
                            onCheckedChange={() => toggleSelectRow(row.id)}
                            aria-label={`Select comment ${row.comment_number ?? row.id}`}
                          />
                        </TableCell>
                        <TableCell className="align-middle w-10 px-2">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 shrink-0"
                            onClick={() => toggleExpandRow(row.id)}
                            aria-expanded={isExpanded}
                            aria-label={isExpanded ? "Collapse details" : "Expand details"}
                          >
                            {isExpanded ? (
                              <ChevronDown className="h-4 w-4" />
                            ) : (
                              <ChevronRight className="h-4 w-4" />
                            )}
                          </Button>
                        </TableCell>
                        <TableCell className="align-middle w-[120px]">
                          <Select value={row.status} onValueChange={(v) => updateRow(row.id, "status", v)}>
                            <SelectTrigger
                              className={cn(
                                "inline-flex min-h-8 min-w-0 w-full max-w-full items-center gap-2 rounded-full border px-3 py-1.5 font-semibold shadow-sm",
                                "bg-muted/60 hover:bg-muted/80 dark:bg-card dark:hover:bg-obsidian-raised",
                                "text-foreground dark:!text-foreground text-[11px] md:text-xs",
                                statusSelectTriggerAccentClass(row.status),
                              )}
                            >
                              <SelectValue>{row.status}</SelectValue>
                            </SelectTrigger>
                            <SelectContent position="popper" sideOffset={4}>
                              {STATUS_OPTIONS.map((s) => (
                                <SelectItem key={s} value={s}>
                                  <span className={cn("inline-flex rounded-full border px-2.5 py-0.5 text-xs font-medium", statusBadgeClass(s))}>
                                    {s}
                                  </span>
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell className="align-middle">
                          <span className={cn("inline-flex rounded-full px-2.5 py-1 text-xs font-medium border max-w-[120px] truncate", disciplineBadgeClass(row.discipline))}>
                            {row.discipline}
                          </span>
                        </TableCell>
                        <TableCell className="align-top py-3">
                          <CommentPreviewCell row={row} onExpand={() => toggleExpandRow(row.id)} />
                        </TableCell>
                        <TableCell className="align-top py-3">
                          {(() => {
                            const refs = parseStoredCodeReferences(row.code_references);
                            const primary = row.code_reference?.trim() || refs[0] || "";
                            if (!primary && refs.length === 0) {
                              return <span className="text-muted-foreground">—</span>;
                            }
                            return (
                              <div className="space-y-1">
                                {primary ? <CodeRefChip value={primary} /> : null}
                                {refs.length > 1 ? (
                                  <p className="text-[10px] text-muted-foreground dark:text-muted-foreground">
                                    +{refs.length - 1} more
                                  </p>
                                ) : null}
                              </div>
                            );
                          })()}
                        </TableCell>
                        <TableCell className="align-top py-3">
                          <div className="space-y-1">
                            {modifiedCommentIds.has(row.id) && (
                              <Badge variant="secondary" className="bg-amber-500/15 text-amber-800 border-amber-500/30 text-[10px]">
                                <PenLine className="h-3 w-3 mr-0.5" />
                                Modified
                              </Badge>
                            )}
                            {scoringView ? (
                              <ResponseConfidenceCell row={row} />
                            ) : (
                              <ResponsePreviewCell row={row} />
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="align-top py-3">
                          <div className="flex flex-col gap-1.5">
                            <Button
                              variant="outlineGold"
                              size="sm"
                              onClick={() => runAutoDraft(row)}
                              disabled={isAutoDrafting}
                              className="shrink-0 w-full"
                            >
                              {isAutoDrafting ? (
                                <Loader2 className="h-4 w-4 animate-spin mr-1" />
                              ) : (
                                <Wand2 className="h-4 w-4 auto-draft-icon mr-1" />
                              )}
                              Auto
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => runGroundedDraft(row)}
                              disabled={groundedBusy || isAutoDrafting}
                              className="shrink-0 w-full border-teal/40 text-teal hover:bg-teal/10"
                              title="Draft using uploaded plan evidence"
                            >
                              {groundedBusy ? (
                                <Loader2 className="h-4 w-4 animate-spin mr-1" />
                              ) : groundedStatus === "error" ? (
                                <RotateCcw className="h-4 w-4 mr-1" />
                              ) : (
                                <Sparkles className="h-4 w-4 mr-1" />
                              )}
                              {groundedStatus === "queued" ? "Queued" : "Grounded"}
                            </Button>
                            {groundedError && (
                              <p className="text-[10px] text-red-700 dark:text-red-400 leading-tight" title={groundedError}>
                                Failed — retry
                              </p>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                      {isExpanded && (
                        <TableRow className="hover:!bg-transparent">
                          <TableCell colSpan={8} className="p-0">
                            <CommentDetailPanel
                              row={row}
                              isAutoDrafting={isAutoDrafting}
                              userId={user?.id}
                              canApprove={canApproveResponses}
                              onRowUpdated={patchRow}
                              onUpdateAssigned={(v) => updateRow(row.id, "assigned_to", v)}
                              onUpdateSheetRef={(v) => updateRow(row.id, "sheet_reference", v)}
                            />
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  );
                })}
              </TableBody>
            </Table>
            </div>
          </div>
          </>
        )}
          </div>
        </Panel>
      </div>
    </div>
  );
}
