import { useState, useEffect, useCallback, useRef, useMemo } from "react";
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
import { useSelectedProject } from "@/contexts/SelectedProjectContext";
import { ReviewTimer, type ReviewTimerHandle } from "@/components/shadow/ReviewTimer";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2, Save, Wand2, ArrowLeft, CheckCircle2, ShieldCheck, FileDown, UserCheck, Copy, FileQuestion, PenTool, PenLine, AlertCircle, ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ExportPackageDialog } from "@/components/response-matrix/ExportPackageDialog";
import { getModifiedCommentIds } from "@/components/response-matrix/RoundChangeSummary";
import { useResponsePackageDrafts } from "@/hooks/useResponsePackageDrafts";
import { cn } from "@/lib/utils";
import { Section } from "@/components/ui/Section";
import { Eyebrow } from "@/components/ui/Typography";
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

function isReportMetadataRow(row: { original_text?: string | null }): boolean {
  const t = (row.original_text ?? "").trim();
  if (t.length < 15) return true;
  return REPORT_METADATA_PHRASES.some((phrase) => t.includes(phrase));
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
  return "bg-cream-sunken/80 text-ink-secondary-light border-cream-sunken";
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
  architectural: "bg-teal/15 text-ink-primary-light border-teal/30",
  mechanical: "bg-gold/12 text-gold-deep border-gold/32",
  mep: "bg-gold/12 text-gold-deep border-gold/32",
  electrical: "bg-yellow-500/15 text-yellow-700 border-yellow-500/30",
  fire: "bg-red-500/15 text-red-700 border-red-500/30",
  general: "bg-cream-sunken/90 text-ink-secondary-light border-cream-sunken",
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
  if (!text) return <span className="text-ink-tertiary-light">—</span>;
  return (
    <div className="group/code flex items-center gap-1 max-w-full">
      <span className="text-xs font-mono-data bg-gold-soft/90 text-ink-primary-light px-2 py-1 rounded border border-gold/35 truncate">
        {text}
      </span>
      <button
        type="button"
        onClick={copy}
        className="opacity-0 group-hover/code:opacity-100 p-1 rounded shrink-0 transition-opacity hover:bg-cream-sunken/70"
        aria-label="Copy code reference"
      >
        <Copy className="h-3.5 w-3.5 text-ink-tertiary-light" />
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

  if (status === "none") return <span className="text-ink-tertiary-light text-xs">—</span>;

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

function ResponseCell({
  row,
  draftingId,
  onUpdate,
}: {
  row: ParsedCommentRow;
  draftingId: string | null;
  onUpdate: (value: string) => void;
}) {
  const isDrafting = draftingId === row.id;
  const text = row.response_text ?? "";
  const [justFilled, setJustFilled] = useState(false);
  useEffect(() => {
    if (!isDrafting && text.length > 0) {
      setJustFilled(true);
      const t = setTimeout(() => setJustFilled(false), 400);
      return () => clearTimeout(t);
    }
  }, [isDrafting, text.length]);
  return (
    <div className={cn("space-y-1", justFilled && "response-text-fade-in")}>
      <Textarea
        value={text}
        onChange={(e) => onUpdate(e.target.value)}
        placeholder={isDrafting ? "Drafting..." : "Official response..."}
        className={cn(
          "min-h-[80px] resize-y border-cream-sunken bg-cream-raised text-ink-primary-light placeholder:text-ink-tertiary-light shadow-inner",
          "dark:border-cream-sunken dark:bg-cream-raised dark:text-ink-primary-light dark:placeholder:text-ink-tertiary-light",
          "transition-shadow duration-200",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/35 focus-visible:border-cream-sunken focus-visible:ring-offset-2 focus-visible:ring-offset-cream"
        )}
        disabled={isDrafting}
      />
      <p className="text-xs text-ink-tertiary-light text-right tabular-nums">
        {text.length} characters
      </p>
    </div>
  );
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
}

export default function ResponseMatrix() {
  const { user, loading: authLoading } = useAuth();
  const { selectedProjectId: sidebarProjectId } = useSelectedProject();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const projectIdParam = searchParams.get("projectId") ?? searchParams.get("project") ?? searchParams.get("project_id");
  const filterPending = searchParams.get("filter") === "pending";

  const projectId = projectIdParam ?? sidebarProjectId;
  const [saving, setSaving] = useState(false);
  const timerRef = useRef<ReviewTimerHandle>(null);
  const [draftingId, setDraftingId] = useState<string | null>(null);
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
  const [planMarkupOpen, setPlanMarkupOpen] = useState(false);
  const { hasPendingMarkups, pendingCount, refetch: refetchApproval, qualityCheckBlocked } = useApprovalGate(projectId ?? undefined);
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
      .select("*")
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
  const rows =
    filterPending && withoutMetadata.length > 0
      ? withoutMetadata.filter(
          (r) =>
            (r.status ?? "").toLowerCase() === "pending" ||
            r.response_text == null ||
            String(r.response_text).trim() === ""
        )
      : withoutMetadata;

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

  const runAutoDraft = useCallback(async (row: ParsedCommentRow) => {
    setDraftingId(row.id);
    try {
      const { data, error } = await supabase.functions.invoke("generate-response", {
        body: {
          comment_text: row.original_text,
          code_reference: row.code_reference || "",
          discipline: row.discipline,
        },
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
        .update({ response_text: text })
        .eq("id", row.id);
      if (updateError) throw updateError;
      queryClient.setQueryData<ParsedCommentRow[]>(["parsed_comments", row.project_id], (prev) =>
        (prev ?? []).map((r) => (r.id === row.id ? { ...r, response_text: text } : r))
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


  const runRouteComments = useCallback(async () => {
    if (!projectId) {
      toast.error("Select a project first");
      return;
    }
    setRouting(true);
    try {
      const { data, error } = await supabase.functions.invoke("auto-router-agent", {
        body: { project_id: projectId },
      });
      if (error) throw error;
      const payload = data as { routed_count?: number; error?: string };
      if (payload?.error) {
        toast.error(payload.error);
        return;
      }
      const routedCount = payload?.routed_count ?? 0;
      toast.success(`Routed ${routedCount} comments`);
      queryClient.invalidateQueries({ queryKey: ["parsed_comments", projectId] });
    } catch (e) {
      console.warn("Route comments failed:", e);
      toast.error("Route comments failed");
    } finally {
      setRouting(false);
    }
  }, [projectId, queryClient]);

  const applySuggestion = useCallback(
    (commentId: string, suggested_improvement: string) => {
      updateRow(commentId, "response_text", suggested_improvement);
      toast.success("Suggestion applied to draft. Click Save Changes to persist.");
    },
    [updateRow]
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
            response_text: row.response_text || null,
            assigned_to: row.assigned_to || null,
            sheet_reference: row.sheet_reference || null,
            status: row.status,
          })
          .eq("id", row.id);
        if (error) throw error;
      }
      toast.success("Changes saved");
      fetchComments();
    } catch (err: unknown) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }, [user, rows, fetchComments]);

  if (authLoading) {
    return (
      <div className="min-h-[80vh] flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-teal" />
      </div>
    );
  }

  return (
    <div className="min-h-[80vh] w-full min-w-0 overflow-x-hidden bg-cream">
      <style>{RESPONSE_MATRIX_STYLES}</style>
      <Section variant="cream" className="pt-10 pb-8 border-b border-cream-sunken">
        <div className="max-w-[1600px] mx-auto px-4 md:px-6 w-full min-w-0">
        <header className="flex flex-col gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => navigate("/dashboard")}
              className="shrink-0 text-ink-secondary-light hover:text-ink-primary-light hover:bg-cream-sunken"
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div className="min-w-0 pl-2 border-l-2 border-gold/40">
              <Eyebrow>RESPONSE MATRIX</Eyebrow>
              <h1 className="mt-2 font-display text-4xl sm:text-5xl text-ink-primary-light leading-tight">
                Response <em className="text-gold italic">Matrix</em>
              </h1>
              <p className="text-ink-secondary-light text-sm mt-2 max-w-2xl leading-relaxed">
                Manage and draft official responses to permit comments.
              </p>
              <div className="h-0.5 w-16 mt-2 bg-gradient-to-r from-gold/70 to-transparent rounded-full" />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3 gap-y-2">
            {projectId && (
              <span className="inline-flex items-center justify-center rounded-full border border-gold/35 bg-gold/12 text-gold-deep text-xs font-medium h-6 min-w-[24px] px-2 shrink-0">
                {withoutMetadata.length} comment{withoutMetadata.length !== 1 ? "s" : ""}
              </span>
            )}
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outlineGold"
                    size="sm"
                    disabled={!projectId}
                    data-testid="button-actions-dropdown"
                    className="shrink-0"
                  >
                    Actions
                    <ChevronDown className="h-3.5 w-3.5 ml-1.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuItem
                    onClick={runValidateCompleteness}
                    disabled={!projectId || validating}
                    data-testid="menu-validate-completeness"
                  >
                    {validating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
                    Validate Completeness
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={runQualityCheck}
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
                    onClick={() => setPlanMarkupOpen(true)}
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
                    onClick={() => setExportDialogOpen(true)}
                    disabled={!projectId}
                    data-testid="menu-export-response-package"
                  >
                    <FileDown className="h-4 w-4 mr-2" />
                    Export Response Package
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={runRouteComments}
                    disabled={!projectId || routing}
                    data-testid="menu-route-comments"
                  >
                    {routing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <UserCheck className="h-4 w-4 mr-2" />}
                    Route Comments
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <ReviewTimer ref={timerRef} projectId={projectId} commentCount={rows.length} />
              <div className="ml-auto">
                <Button variant="gold" onClick={saveChanges} disabled={saving || rows.length === 0} className="shrink-0">
                  {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
                  Save Changes
                </Button>
              </div>
            </div>
          </div>
        </header>
        </div>
      </Section>

      <div className="max-w-[1600px] mx-auto px-4 md:px-6 w-full min-w-0 space-y-4 py-6">

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
                : "Run the Comment Parser agent to extract comments from your portal reports."}
            </p>
            <Button variant="outline" size="sm" className="mt-4" onClick={() => navigate("/dashboard")}>
              Go to Dashboard
            </Button>
          </div>
        ) : (
          <>
          {filterPending && (
            <p className="text-sm text-muted-foreground mb-2">
              <Badge variant="secondary">Showing pending comments only</Badge>
            </p>
          )}
          <div className="rounded-xl border border-cream-sunken bg-cream-raised shadow-cream overflow-hidden">
            <div className="overflow-x-auto bg-gradient-to-b from-cream via-cream-raised/95 to-cream-raised">
            <Table
              wrapperClassName="rounded-none border-0 shadow-none bg-transparent dark:border-0"
              className="w-full min-w-[900px]"
            >
              <TableHeader className="dark:[&_tr]:!bg-transparent">
                <TableRow className="border-b border-obsidian-raised/70 !bg-obsidian-raised hover:!bg-obsidian dark:!border-obsidian-raised/55 dark:!bg-obsidian-raised dark:hover:!bg-obsidian">
                  <TableHead className="w-[120px] table-head-sticky px-4 py-3 sm:px-5 sm:py-3.5 text-left text-[10px] font-mono uppercase tracking-[0.16em] text-ink-secondary-dark dark:text-ink-secondary-dark">
                    Status
                  </TableHead>
                  <TableHead className="w-[100px] table-head-sticky px-4 py-3 sm:px-5 sm:py-3.5 text-left text-[10px] font-mono uppercase tracking-[0.16em] text-ink-secondary-dark dark:text-ink-secondary-dark">
                    Discipline
                  </TableHead>
                  <TableHead className="min-w-[220px] table-head-sticky px-4 py-3 sm:px-5 sm:py-3.5 text-left text-[10px] font-mono uppercase tracking-[0.16em] text-ink-secondary-dark dark:text-ink-secondary-dark">
                    City Comment
                  </TableHead>
                  <TableHead className="w-[140px] table-head-sticky px-4 py-3 font-mono-data sm:px-5 sm:py-3.5 text-left text-[10px] uppercase tracking-[0.16em] text-ink-secondary-dark dark:text-ink-secondary-dark">
                    Code Ref.
                  </TableHead>
                  <TableHead className="min-w-[300px] w-full table-head-sticky px-4 py-3 sm:px-5 sm:py-3.5 text-left text-[10px] font-mono uppercase tracking-[0.16em] text-ink-secondary-dark dark:text-ink-secondary-dark">
                    Response
                  </TableHead>
                  <TableHead className="w-[100px] table-head-sticky px-4 py-3 sm:px-5 sm:py-3.5 text-left text-[10px] font-mono uppercase tracking-[0.16em] text-ink-secondary-dark dark:text-ink-secondary-dark">
                    Auto-Draft
                  </TableHead>
                  <TableHead className="min-w-[240px] w-[260px] table-head-sticky whitespace-normal px-4 py-3 text-left text-[10px] font-mono uppercase tracking-[0.16em] text-ink-secondary-dark dark:text-ink-secondary-dark sm:px-5 sm:py-3.5">
                    Assigned To
                  </TableHead>
                  <TableHead className="w-[80px] table-head-sticky px-4 py-3 sm:px-5 sm:py-3.5 text-left text-[10px] font-mono uppercase tracking-[0.16em] text-ink-secondary-dark dark:text-ink-secondary-dark">
                    Markup
                  </TableHead>
                  <TableHead className="w-[100px] table-head-sticky px-4 py-3 font-mono-data sm:px-5 sm:py-3.5 text-left text-[10px] uppercase tracking-[0.16em] text-ink-secondary-dark dark:text-ink-secondary-dark">
                    Sheet Ref.
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row, idx) => (
                  <TableRow
                    key={row.id}
                    className={cn(
                      "!border-transparent border-t border-cream-sunken bg-cream hover:!bg-cream-sunken/50 dark:bg-cream dark:hover:!bg-cream-sunken/50 dark:!border-transparent",
                      idx % 2 === 1 &&
                        "!bg-cream-raised hover:!bg-cream-sunken/50 dark:!bg-cream-raised dark:hover:!bg-cream-sunken/50",
                      "text-ink-primary-light transition-colors duration-150",
                      statusBorderClass(row.status),
                    )}
                  >
                    <TableCell className="align-middle w-[120px] text-ink-primary-light dark:!text-ink-primary-light">
                      <Select
                        value={row.status}
                        onValueChange={(v) => updateRow(row.id, "status", v)}
                      >
                        <SelectTrigger
                          className={cn(
                            "inline-flex min-h-8 min-w-0 w-full max-w-full items-center gap-2 rounded-full border px-3 py-1.5 font-semibold text-ink-primary-dark shadow-sm ring-offset-transparent",
                            "bg-obsidian hover:bg-obsidian-raised",
                            "dark:bg-obsidian dark:text-ink-primary-dark dark:hover:bg-obsidian-raised dark:ring-offset-obsidian",
                            "!text-ink-primary-dark text-[11px] leading-tight hover:!text-ink-primary-dark md:text-xs",
                            "focus-visible:border-transparent focus-visible:ring-2 focus-visible:ring-teal/40 focus-visible:ring-offset-2 focus-visible:ring-offset-cream",
                            "dark:!text-ink-primary-dark dark:hover:!text-ink-primary-dark [&>span:first-child]:!text-ink-primary-dark",
                            "[&>span:first-child[data-placeholder]]:!text-ink-tertiary-dark",
                            "[&_svg]:!h-4 [&_svg]:!w-4 [&_svg]:!shrink-0 [&_svg]:!opacity-95 [&_svg]:!text-ink-secondary-dark dark:[&_svg]:!text-ink-secondary-dark",
                            "[&>span:first-child]:truncate",
                            statusSelectTriggerAccentClass(row.status),
                          )}
                        >
                          {/* Explicit children ⇒ Radix does not portal ItemText badge nodes into trigger (fixes dark emerald on obsidian pill). */}
                          <SelectValue>{row.status}</SelectValue>
                        </SelectTrigger>
                        <SelectContent
                          position="popper"
                          sideOffset={4}
                          className={cn(
                            "z-[200] rounded-lg border border-cream-sunken bg-cream-raised text-ink-primary-light shadow-cream",
                            "dark:border-cream-sunken dark:bg-cream-raised dark:text-ink-primary-light",
                          )}
                        >
                          {STATUS_OPTIONS.map((s) => (
                            <SelectItem
                              key={s}
                              value={s}
                              className={cn(
                                "rounded-md py-2.5 pl-8 pr-2 text-sm font-tight text-ink-primary-light",
                                "outline-none cursor-pointer transition-colors dark:text-ink-primary-light",
                                "data-[highlighted]:bg-cream-sunken data-[highlighted]:text-ink-primary-light",
                                "dark:data-[highlighted]:bg-cream-sunken dark:data-[highlighted]:text-ink-primary-light",
                                "aria-selected:bg-gold-soft/70 aria-selected:border-l-[3px] aria-selected:border-l-gold aria-selected:text-ink-primary-light",
                              )}
                            >
                              <span
                                className={cn(
                                  "inline-flex max-w-[min(18rem,var(--radix-select-trigger-width))] whitespace-normal rounded-full border px-2.5 py-0.5 text-xs font-medium",
                                  statusBadgeClass(s),
                                )}
                              >
                                {s}
                              </span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className="align-middle text-ink-primary-light dark:!text-ink-primary-light">
                      <span
                        className={cn(
                          "inline-flex rounded-full px-2.5 py-1 text-xs font-medium border max-w-[200px] truncate",
                          disciplineBadgeClass(row.discipline),
                          "contrast-more:bg-muted contrast-more:text-foreground contrast-more:border-border contrast-more:ring-0",
                        )}
                      >
                        {row.discipline}
                      </span>
                    </TableCell>
                    <TableCell className="max-w-[280px] align-top text-sm text-ink-secondary-light dark:!text-ink-secondary-light">
                      {row.original_text}
                    </TableCell>
                    <TableCell className="min-w-[140px] w-[140px] align-top text-ink-primary-light dark:!text-ink-primary-light">
                      {row.code_reference?.trim() ? (
                        <CodeRefChip value={row.code_reference} />
                      ) : (
                        <span className="text-ink-tertiary-light">-</span>
                      )}
                    </TableCell>
                    <TableCell className="min-w-[300px] align-top p-2 text-ink-primary-light dark:!text-ink-primary-light">
                      <div className="space-y-1">
                        {modifiedCommentIds.has(row.id) && (
                          <Badge
                            variant="secondary"
                            className="bg-amber-500/15 text-amber-700 border-amber-500/30 text-[10px]"
                            data-testid={`badge-modified-${row.id}`}
                          >
                            <PenLine className="h-3 w-3 mr-0.5" />
                            Modified
                          </Badge>
                        )}
                        <ResponseCell
                          row={row}
                          draftingId={draftingId}
                          onUpdate={(v) => updateRow(row.id, "response_text", v)}
                        />
                      </div>
                    </TableCell>
                    <TableCell className="w-[100px] align-top text-ink-primary-light dark:!text-ink-primary-light">
                      <Button
                        variant="outlineGold"
                        size="sm"
                        onClick={() => runAutoDraft(row)}
                        disabled={draftingId === row.id}
                        className="shrink-0 transition-transform hover:scale-[1.02] hover:shadow-md [&_svg]:shrink-0 inline-flex items-center"
                      >
                        <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center">
                          {draftingId === row.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Wand2 className="h-4 w-4 auto-draft-icon" />
                          )}
                        </span>
                        <span className="ml-1 hidden sm:inline">Auto-Draft</span>
                      </Button>
                    </TableCell>
                    <TableCell className="min-w-[240px] max-w-none w-[260px] align-top whitespace-normal p-2 text-ink-primary-light dark:!text-ink-primary-light">
                      <Input
                        value={row.assigned_to ?? ""}
                        onChange={(e) => updateRow(row.id, "assigned_to", e.target.value)}
                        placeholder="Name or email"
                        className="h-9 min-h-9 w-full min-w-[12rem] max-w-none border-cream-sunken bg-cream-raised text-sm leading-normal text-ink-primary-light shadow-inner placeholder:text-ink-tertiary-light focus-visible:border-cream-sunken focus-visible:ring-gold/35 focus-visible:ring-offset-2 focus-visible:ring-offset-cream dark:border-cream-sunken dark:bg-cream-raised dark:text-ink-primary-light dark:placeholder:text-ink-tertiary-light md:text-sm"
                      />
                    </TableCell>
                    <TableCell className="w-[80px] align-middle text-ink-primary-light dark:!text-ink-primary-light">
                      <MarkupStatusBadge commentId={row.id} projectId={row.project_id} />
                    </TableCell>
                    <TableCell className="align-top p-2 text-ink-primary-light dark:!text-ink-primary-light">
                      <Input
                        value={row.sheet_reference ?? ""}
                        onChange={(e) => updateRow(row.id, "sheet_reference", e.target.value)}
                        placeholder="e.g. A1.02"
                        className="h-8 border-cream-sunken bg-cream-raised text-ink-primary-light shadow-inner placeholder:text-ink-tertiary-light focus-visible:border-cream-sunken focus-visible:ring-gold/35 focus-visible:ring-offset-2 focus-visible:ring-offset-cream dark:border-cream-sunken dark:bg-cream-raised dark:text-ink-primary-light dark:placeholder:text-ink-tertiary-light"
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            </div>
          </div>
          </>
        )}
      </div>
    </div>
  );
}
