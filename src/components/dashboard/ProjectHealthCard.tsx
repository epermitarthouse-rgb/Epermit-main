import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";
import { Loader2, FileText, Clock, CheckCircle, Shield, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { useMemo } from "react";

interface ProjectHealthCardProps {
  projectId: string | null;
}

interface ProjectRow {
  id: string;
  last_checked_at: string | null;
  deadline: string | null;
}

interface CommentRow {
  id: string;
  status: string | null;
  response_text: string | null;
}

function daysBetween(start: Date, end: Date): number {
  const ms = end.getTime() - start.getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

function hoursBetween(start: Date, end: Date): number {
  const ms = end.getTime() - start.getTime();
  return Math.floor(ms / (1000 * 60 * 60));
}

export function ProjectHealthCard({ projectId }: ProjectHealthCardProps) {
  const navigate = useNavigate();
  const { data, isLoading } = useQuery({
    queryKey: ["project-health", projectId],
    queryFn: async () => {
      if (!projectId) return null;
      const [projectRes, commentsRes] = await Promise.all([
        supabase
          .from("projects")
          .select("id, last_checked_at, deadline, portal_data")
          .eq("id", projectId)
          .single(),
        supabase
          .from("parsed_comments")
          .select("id, status, response_text")
          .eq("project_id", projectId),
      ]);

      const project = projectRes.data as ProjectRow & { portal_data?: { tabs?: { reports?: { pdfs?: { fileName?: string }[] } } } } | null;
      const comments = (commentsRes.data ?? []) as CommentRow[];

      const pdfs = project?.portal_data?.tabs?.reports?.pdfs ?? [];
      const hasReviewCommentsReport = pdfs.some(
        (p) => (p.fileName ?? "").includes("Review Comments")
      );

      const now = new Date();
      const lastCheckedAt = project?.last_checked_at ? new Date(project.last_checked_at) : null;
      const deadline = project?.deadline ? new Date(project.deadline) : null;

      const daysSinceCheck = lastCheckedAt != null ? daysBetween(lastCheckedAt, now) : null;
      const daysUntilDeadline = deadline != null ? daysBetween(now, deadline) : null;
      const hoursSinceCheck = lastCheckedAt != null ? hoursBetween(lastCheckedAt, now) : null;

      const total_comments = comments.length;
      const pending_comments = comments.filter(
        (c) =>
          (c.status ?? "").toLowerCase() === "pending" ||
          c.response_text == null ||
          String(c.response_text).trim() === ""
      ).length;
      const ready_comments = comments.filter(
        (c) => (c.status ?? "").toLowerCase() === "ready for review"
      ).length;
      const approved_comments = comments.filter(
        (c) => (c.status ?? "").toLowerCase() === "approved"
      ).length;

      return {
        lastCheckedAt,
        deadline,
        daysSinceCheck,
        daysUntilDeadline,
        hoursSinceCheck,
        total_comments,
        pending_comments,
        ready_comments,
        approved_comments,
        hasReviewCommentsReport: !!hasReviewCommentsReport,
      };
    },
    enabled: !!projectId,
  });

  const healthPercent = data
    ? (data.total_comments > 0 ? Math.round(((data.total_comments - data.pending_comments) / data.total_comments) * 100) : 100)
    : 100;
  const strokeOffset = useMemo(() => 283 - (283 * healthPercent) / 100, [healthPercent]);

  if (!projectId) return null;
  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }
  if (!data) return null;

  const {
    lastCheckedAt,
    deadline,
    daysSinceCheck,
    daysUntilDeadline,
    hoursSinceCheck,
    total_comments,
    pending_comments,
    ready_comments,
    approved_comments,
    hasReviewCommentsReport,
  } = data;

  const ringColor = healthPercent > 70 ? "emerald" : healthPercent >= 30 ? "amber" : "red";

  const lastCheckText =
    lastCheckedAt == null
      ? "Never"
      : (hoursSinceCheck ?? 0) < 1
        ? "Just checked"
        : (hoursSinceCheck ?? 0) < 24
          ? `${hoursSinceCheck} hour${(hoursSinceCheck ?? 0) === 1 ? "" : "s"} ago`
          : `${daysSinceCheck} day${(daysSinceCheck ?? 0) === 1 ? "" : "s"} ago`;
  const lastCheckVariant = lastCheckedAt == null ? "muted" : (hoursSinceCheck ?? 0) < 1 ? "green" : (hoursSinceCheck ?? 0) < 24 ? "amber" : "red";

  const deadlineText =
    deadline == null
      ? "Not set"
      : daysUntilDeadline != null && daysUntilDeadline < 0
        ? `${format(deadline, "MMM d, yyyy")} (${Math.abs(daysUntilDeadline)} days ago)`
        : `${format(deadline, "MMM d, yyyy")} (in ${daysUntilDeadline} days)`;

  const statusVariant =
    deadline != null && (daysUntilDeadline ?? 0) < 0
      ? "red"
      : pending_comments > 0
        ? "orange"
        : "green";

  const deadlineNear =
    deadline != null && daysUntilDeadline != null && daysUntilDeadline >= 0 && daysUntilDeadline <= 7;
  const allClear =
    total_comments > 0 &&
    pending_comments === 0 &&
    (deadline == null || (daysUntilDeadline ?? 0) > 7);

  const buttonLabel =
    pending_comments > 0
      ? "Resolve comments"
      : total_comments === 0 && hasReviewCommentsReport
        ? "Open Comment Review"
        : total_comments === 0
          ? "Run Manual Check"
          : deadlineNear
            ? "Review before deadline"
            : "All clear";

  const handleActionClick = () => {
    if (!projectId) return;
    if (pending_comments > 0) {
      navigate(`/response-matrix?project_id=${encodeURIComponent(projectId)}&filter=pending`);
    } else if (total_comments === 0 && hasReviewCommentsReport) {
      navigate("/comment-review");
    } else if (total_comments === 0) {
      navigate("/dashboard");
    } else if (deadlineNear) {
      navigate(`/response-matrix?project_id=${encodeURIComponent(projectId)}`);
    }
  };

  const deadlineProgress =
    deadline != null && daysUntilDeadline != null && daysUntilDeadline >= 0
      ? (() => {
          const total = 30;
          const remaining = Math.min(daysUntilDeadline, total);
          return Math.round(((total - remaining) / total) * 100);
        })()
      : null;

  return (
    <Card className="relative overflow-hidden border border-white/10 bg-white/5 backdrop-blur-sm rounded-xl">
      <CardHeader className="pb-2 flex flex-row items-start justify-between gap-4">
        <CardTitle className="text-base">Project Health</CardTitle>
        <div className="shrink-0 relative w-14 h-14">
          <svg className="w-14 h-14 -rotate-90" viewBox="0 0 36 36">
            <circle
              cx="18"
              cy="18"
              r="14"
              fill="none"
              className="stroke-muted/30"
              strokeWidth="3"
            />
            <circle
              cx="18"
              cy="18"
              r="14"
              fill="none"
              strokeWidth="3"
              strokeLinecap="round"
              className={cn(
                "transition-[stroke-dashoffset] duration-1000 ease-out",
                ringColor === "emerald" && "stroke-emerald-500",
                ringColor === "amber" && "stroke-amber-500",
                ringColor === "red" && "stroke-red-500"
              )}
              strokeDasharray="283"
              strokeDashoffset={strokeOffset}
            />
          </svg>
          <span className="absolute inset-0 flex items-center justify-center text-xs font-bold text-foreground">
            {healthPercent}%
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <div className="rounded-lg border border-l-4 border-l-zinc-400 bg-muted/30 p-2 transition-shadow hover:shadow-md">
            <FileText className="h-4 w-4 text-muted-foreground mb-1" />
            <p className="text-xl font-bold leading-tight">{total_comments}</p>
            <p className="text-xs text-muted-foreground">Total</p>
          </div>
          <div className="rounded-lg border border-l-4 border-l-amber-500 bg-amber-500/5 p-2 transition-shadow hover:shadow-md">
            <Clock className="h-4 w-4 text-amber-500 mb-1" />
            <p className="text-xl font-bold leading-tight">{pending_comments}</p>
            <p className="text-xs text-muted-foreground">Pending</p>
          </div>
          <div className="rounded-lg border border-l-4 border-l-blue-500 bg-blue-500/5 p-2 transition-shadow hover:shadow-md">
            <CheckCircle className="h-4 w-4 text-blue-500 mb-1" />
            <p className="text-xl font-bold leading-tight">{ready_comments}</p>
            <p className="text-xs text-muted-foreground">Ready</p>
          </div>
          <div className="rounded-lg border border-l-4 border-l-emerald-500 bg-emerald-500/5 p-2 transition-shadow hover:shadow-md">
            <Shield className="h-4 w-4 text-emerald-500 mb-1" />
            <p className="text-xl font-bold leading-tight">{approved_comments}</p>
            <p className="text-xs text-muted-foreground">Approved</p>
          </div>
        </div>

        <div className="flex items-center gap-2 text-sm">
          <Clock className={cn("h-4 w-4 shrink-0", lastCheckVariant === "green" && "text-emerald-500", lastCheckVariant === "amber" && "text-amber-500", lastCheckVariant === "red" && "text-red-500", lastCheckVariant === "muted" && "text-muted-foreground")} />
          {lastCheckVariant === "green" && <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse shrink-0" />}
          <span className={cn(lastCheckVariant === "green" && "text-emerald-600 dark:text-emerald-400", lastCheckVariant === "amber" && "text-amber-600 dark:text-amber-400", lastCheckVariant === "red" && "text-red-600 dark:text-red-400", lastCheckVariant === "muted" && "text-muted-foreground")}>
            Last portal check: {lastCheckText}
            {lastCheckVariant === "red" && lastCheckedAt != null && " ⚠"}
          </span>
        </div>

        <div className="space-y-1">
          <p className="text-sm text-muted-foreground">
            {deadline == null ? (
              <>Deadline: {deadlineText} · <button type="button" onClick={() => navigate("/projects")} className="text-emerald-500 hover:underline">Set deadline</button></>
            ) : (
              <span className={cn(deadlineNear && "text-amber-600 dark:text-amber-400 font-medium", (daysUntilDeadline ?? 0) < 0 && "text-red-600 dark:text-red-400")}>
                Deadline: {deadlineText}
              </span>
            )}
          </p>
          {deadlineProgress != null && deadline != null && (
            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
              <div
                className={cn("h-full rounded-full transition-all duration-500", deadlineNear ? "bg-amber-500" : (daysUntilDeadline ?? 0) < 0 ? "bg-red-500" : "bg-emerald-500/60")}
                style={{ width: `${Math.min(deadlineProgress, 100)}%` }}
              />
            </div>
          )}
        </div>

        {(pending_comments > 0 || statusVariant === "red") && (
          <div className="rounded-lg bg-gradient-to-r from-red-500/10 to-transparent border border-red-500/20 p-3 animate-pulse-glow">
            <p className="text-sm font-medium text-red-700 dark:text-red-400 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              Action required
            </p>
            <p className="text-xs text-muted-foreground mt-1">Resolve pending comments to stay on track.</p>
            <Button
              size="sm"
              className="mt-2 hover:shadow-[0_0_12px_rgba(239,68,68,0.3)] transition-shadow"
              variant={pending_comments > 0 ? "default" : "outline"}
              disabled={allClear}
              onClick={handleActionClick}
            >
              {buttonLabel}
            </Button>
          </div>
        )}

        {!(pending_comments > 0 || statusVariant === "red") && (
          <div className="pt-1 flex flex-wrap items-center gap-2">
            <span
              className={cn(
                "inline-flex items-center rounded-full px-3 py-1 text-xs font-medium border",
                statusVariant === "green" && "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
                statusVariant === "orange" && "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
                statusVariant === "red" && "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20"
              )}
            >
              {statusVariant === "green" ? "On track" : statusVariant === "orange" ? "Action required" : "Deadline passed"}
            </span>
            <Button size="sm" variant="outline" disabled={allClear} onClick={handleActionClick}>
              {buttonLabel}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
