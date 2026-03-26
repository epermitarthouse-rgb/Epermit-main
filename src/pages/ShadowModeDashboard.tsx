import React, { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useSelectedProject } from "@/contexts/SelectedProjectContext";
import { supabase } from "@/lib/supabase";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ArrowLeft,
  RefreshCw,
  Shield,
  Activity,
  BarChart3,
  Clock,
  Target,
  CheckCircle,
  AlertTriangle,
  XCircle,
  Loader2,
  TrendingUp,
  FileDown,
  Info,
  ShieldAlert,
  Trophy,
  Timer,
  Zap,
  Bell,
  CircleDot,
} from "lucide-react";
import { AdminPageShell } from "@/components/admin/AdminPageShell";

interface OverallMetrics {
  total_predictions: number;
  matches: number;
  partials: number;
  mismatches: number;
  pending: number;
  accuracy_percent: number;
  avg_confidence: number;
}

interface AgentPerformance {
  agent_name: string;
  predictions: number;
  matches: number;
  partials: number;
  mismatches: number;
  pending: number;
  accuracy: number;
  avg_confidence: number;
}

interface BaselineMetrics {
  total_baselines: number;
  unique_disciplines: number;
  baseline_coverage_percent: number;
  total_timed_reviews: number;
  avg_time_per_comment: number;
}

interface ValidationGate {
  total_comments: number;
  total_projects: number;
  comments_goal: number;
  projects_goal: number;
}

interface AuditEntry {
  id: string;
  action_type: string;
  routing_decision: string;
  created_at: string;
}

interface ShadowPrediction {
  id: string;
  comment_id: string;
  agent_name: string;
  project_id: string;
  prediction_data: {
    ai_discipline?: string;
    portal_discipline?: string;
    assigned_discipline?: string;
    [key: string]: unknown;
  };
  match_status: string;
  confidence_score: number;
  created_at: string;
  parsed_comments?: {
    original_text?: string;
  };
}

interface CircuitBreakerAgent {
  agent_name: string;
  status: "active" | "warning" | "disabled";
  predictions_24h: number;
  mismatches_24h: number;
  fail_rate_24h: number;
  consecutive_fails: number;
  reason: string | null;
}

interface CircuitBreakerData {
  checked_at: string;
  agents: CircuitBreakerAgent[];
}

type ActiveFilter = "total" | "accuracy" | "confidence" | "mismatches" | "high-risk";

interface ShadowMetricsData {
  overall: OverallMetrics;
  agent_performance: AgentPerformance[];
  baseline: BaselineMetrics;
  validation_gate: ValidationGate;
  recent_audit: AuditEntry[];
}

const AGENT_THRESHOLDS: Record<string, number> = {
  "Comment Parser": 90,
  "Guardian Agent": 90,
  "Discipline Classifier": 85,
  "Code Reference": 80,
  "Similar Matcher": 75,
  "Response Matrix Gen": 70,
};
const DEFAULT_THRESHOLD = 80;

function getAgentThreshold(agentName: string): number {
  for (const [key, value] of Object.entries(AGENT_THRESHOLDS)) {
    if (agentName.toLowerCase().includes(key.toLowerCase())) return value;
  }
  return DEFAULT_THRESHOLD;
}

function StatCard({
  title,
  value,
  subtitle,
  icon: Icon,
  variant = "default",
  active = false,
  glowColor,
  onClick,
}: {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: typeof Activity;
  variant?: "default" | "success" | "warning" | "danger";
  active?: boolean;
  glowColor?: string;
  onClick?: () => void;
}) {
  const variantStyles = {
    default: "border-border",
    success: "border-green-500/30 bg-green-500/5",
    warning: "border-yellow-500/30 bg-yellow-500/5",
    danger: "border-red-500/30 bg-red-500/5",
  };
  const iconStyles = {
    default: "text-muted-foreground",
    success: "text-green-500",
    warning: "text-yellow-500",
    danger: "text-red-500",
  };

  return (
    <Card
      className={`${variantStyles[variant]} cursor-pointer transition-transform duration-150 hover:scale-[1.03] ${active && glowColor ? `ring-2 ${glowColor} shadow-lg` : ""}`}
      data-testid={`stat-card-${title.toLowerCase().replace(/\s+/g, "-")}`}
      onClick={onClick}
    >
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {title}
        </CardTitle>
        <Icon className={`h-4 w-4 ${iconStyles[variant]}`} />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold" data-testid={`stat-value-${title.toLowerCase().replace(/\s+/g, "-")}`}>{value}</div>
        {subtitle && (
          <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>
        )}
      </CardContent>
    </Card>
  );
}

function MatchStatusBadge({ status }: { status: string }) {
  switch (status) {
    case "match":
      return (
        <Badge variant="outline" className="border-green-500 text-green-600 bg-green-500/10">
          <CheckCircle className="h-3 w-3 mr-1" /> Match
        </Badge>
      );
    case "partial":
      return (
        <Badge variant="outline" className="border-yellow-500 text-yellow-600 bg-yellow-500/10">
          <AlertTriangle className="h-3 w-3 mr-1" /> Partial
        </Badge>
      );
    case "mismatch":
      return (
        <Badge variant="outline" className="border-red-500 text-red-600 bg-red-500/10">
          <XCircle className="h-3 w-3 mr-1" /> Mismatch
        </Badge>
      );
    default:
      return (
        <Badge variant="secondary">
          <Clock className="h-3 w-3 mr-1" /> Pending
        </Badge>
      );
  }
}

class ShadowDashboardErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("ShadowModeDashboard crashed:", error, info.componentStack);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="container mx-auto p-6 max-w-7xl" data-testid="shadow-dashboard-error">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-red-400">
                <AlertTriangle className="h-5 w-5" />
                Dashboard Error
              </CardTitle>
              <CardDescription>
                The Shadow Mode Dashboard encountered an error. Check the browser console for details.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <pre className="text-xs text-red-400 bg-red-500/5 rounded p-3 overflow-auto max-h-40">
                {this.state.error?.message}
              </pre>
              <Button
                variant="outline"
                className="mt-4"
                onClick={() => this.setState({ hasError: false, error: null })}
                data-testid="button-retry-dashboard"
              >
                Retry
              </Button>
            </CardContent>
          </Card>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function ShadowModeDashboardWrapper() {
  return (
    <ShadowDashboardErrorBoundary>
      <ShadowModeDashboardInner />
    </ShadowDashboardErrorBoundary>
  );
}

function ShadowModeDashboardInner() {
  useAuth();
  const navigate = useNavigate();
  const { selectedProjectId } = useSelectedProject();
  const [activeFilter, setActiveFilter] = useState<ActiveFilter>("total");
  const [data, setData] = useState<ShadowMetricsData | null>(null);
  const [predictions, setPredictions] = useState<ShadowPrediction[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [circuitBreaker, setCircuitBreaker] = useState<CircuitBreakerData | null>(null);
  const [exporting, setExporting] = useState(false);
  const [projects, setProjects] = useState<{ id: string; name: string; permit_number: string | null }[]>([]);

  const fetchPredictions = useCallback(async (projectId: string | null) => {
    try {
      let query = supabase
        .from("shadow_predictions")
        .select("id, comment_id, agent_name, project_id, prediction_data, match_status, confidence_score, created_at, parsed_comments(original_text)")
        .order("created_at", { ascending: false })
        .limit(100);
      if (projectId) query = query.eq("project_id", projectId);
      const { data: rows, error: fetchErr } = await query;
      if (fetchErr) throw fetchErr;
      setPredictions((rows as unknown as ShadowPrediction[]) ?? []);
    } catch (err) {
      console.error("Failed to fetch shadow predictions:", err);
    }
  }, []);

  const fetchMetrics = useCallback(async (projectId: string | null, isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const body: Record<string, string> = {};
      if (projectId) body.project_id = projectId;
      const { data: result, error: fnError } = await supabase.functions.invoke(
        "shadow-metrics",
        { body }
      );
      if (fnError) throw fnError;
      setData(result as ShadowMetricsData);
    } catch (err) {
      console.error("Failed to fetch shadow metrics:", err);
      setError(
        err instanceof Error ? err.message : "Failed to load shadow metrics"
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const fetchCircuitBreaker = useCallback(async (projectId: string | null) => {
    try {
      const body: Record<string, string> = {};
      if (projectId) body.project_id = projectId;
      const { data: result, error: fnError } = await supabase.functions.invoke(
        "circuit-breaker-check",
        { body }
      );
      if (fnError) throw fnError;
      if (result && typeof result === "object" && Array.isArray((result as CircuitBreakerData).agents)) {
        setCircuitBreaker(result as CircuitBreakerData);
      } else {
        setCircuitBreaker({ checked_at: new Date().toISOString(), agents: [] });
      }
    } catch (err) {
      console.error("Failed to fetch circuit breaker status:", err);
      setCircuitBreaker({ checked_at: new Date().toISOString(), agents: [] });
    }
  }, []);

  useEffect(() => {
    fetchMetrics(selectedProjectId);
    fetchPredictions(selectedProjectId);
    fetchCircuitBreaker(selectedProjectId);
    supabase
      .from("projects")
      .select("id, name, permit_number")
      .then(({ data }) => {
        if (data) setProjects(data as { id: string; name: string; permit_number: string | null }[]);
      });
  }, [fetchMetrics, fetchPredictions, fetchCircuitBreaker, selectedProjectId]);

  const exportWeeklyReport = useCallback(async () => {
    setExporting(true);
    try {
      const body: Record<string, string> = {};
      if (selectedProjectId) body.project_id = selectedProjectId;
      const { data: report, error: fnError } = await supabase.functions.invoke(
        "export-weekly-report",
        { body }
      );
      if (fnError) throw fnError;

      const reportData = report as Record<string, unknown>;
      const exec = reportData.executive_summary as Record<string, unknown>;
      const agents = (reportData.agent_performance ?? []) as Record<string, unknown>[];
      const baseline = reportData.baseline_metrics as Record<string, unknown>;
      const calibration = reportData.confidence_calibration as Record<string, unknown>;
      const rawPreds = (reportData.raw_predictions ?? []) as Record<string, unknown>[];
      const meta = reportData.report_metadata as Record<string, unknown>;

      const lines: string[] = [];
      const addRow = (...cells: (string | number)[]) => lines.push(cells.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","));

      addRow("SHADOW MODE WEEKLY REPORT");
      addRow("Period", `${meta.period_start} to ${meta.period_end}`);
      addRow("Generated", String(meta.generated_at));
      addRow("Project Filter", String(meta.project_filter));
      addRow("");

      addRow("EXECUTIVE SUMMARY");
      addRow("Total Predictions", Number(exec.total_predictions));
      addRow("Actionable Comments", Number(exec.actionable_comments));
      addRow("Pending Review", Number(exec.pending_review));
      addRow("Overall Accuracy %", Number(exec.overall_accuracy_percent));
      addRow("Avg Confidence %", Number(exec.avg_confidence_percent));
      addRow("Matches", Number(exec.matches));
      addRow("Partials", Number(exec.partials));
      addRow("Mismatches", Number(exec.mismatches));
      addRow("");

      addRow("AGENT PERFORMANCE");
      addRow("Agent", "Predictions", "Matches", "Partials", "Mismatches", "Pending", "Accuracy %", "Avg Confidence %");
      for (const a of agents) {
        addRow(String(a.agent_name), Number(a.predictions), Number(a.matches), Number(a.partials), Number(a.mismatches), Number(a.pending), Number(a.accuracy), Number(a.avg_confidence));
      }
      addRow("");

      addRow("BASELINE METRICS");
      addRow("Total Baselines", Number(baseline.total_baselines));
      addRow("Unique Disciplines", Number(baseline.unique_disciplines));
      addRow("Baseline Coverage %", Number(baseline.baseline_coverage_percent));
      addRow("Timed Reviews", Number(baseline.timed_reviews));
      addRow("Avg Time per Comment (min)", Number(baseline.avg_time_per_comment_minutes));
      addRow("");

      addRow("CONFIDENCE CALIBRATION - HIGH RISK ERRORS");
      addRow("High Risk Count", Number(calibration.high_risk_count));
      if (Array.isArray(calibration.high_risk_predictions) && calibration.high_risk_predictions.length > 0) {
        addRow("Agent", "Confidence %", "AI Prediction", "Human Baseline", "Comment Snippet", "Date");
        for (const hr of calibration.high_risk_predictions as Record<string, unknown>[]) {
          addRow(String(hr.agent_name), Number(hr.confidence), String(hr.ai_prediction), String(hr.human_baseline), String(hr.comment_snippet), String(hr.created_at));
        }
      }
      addRow("");

      addRow("RAW PREDICTIONS (last 7 days)");
      addRow("Agent", "Status", "Confidence %", "AI Prediction", "Human Baseline", "Comment Snippet", "Project ID", "Date");
      for (const p of rawPreds) {
        addRow(String(p.agent_name), String(p.match_status), Number(p.confidence), String(p.ai_prediction), String(p.human_baseline), String(p.comment_snippet), String(p.project_id), String(p.created_at));
      }

      const csv = lines.join("\n");
      const blob = new Blob([csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `shadow-mode-weekly-report-${(meta.period_end as string) ?? new Date().toISOString().split("T")[0]}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Failed to export weekly report:", err);
    } finally {
      setExporting(false);
    }
  }, [selectedProjectId]);

  if (loading) {
    return (
      <div className="container mx-auto p-6 max-w-7xl space-y-6">
        <div className="flex items-center gap-3 mb-6">
          <Skeleton className="h-8 w-8 rounded" />
          <Skeleton className="h-8 w-64" />
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <Card key={i}>
              <CardHeader className="pb-2">
                <Skeleton className="h-4 w-24" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-8 w-16" />
                <Skeleton className="h-3 w-32 mt-2" />
              </CardContent>
            </Card>
          ))}
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <Skeleton className="h-5 w-40" />
            </CardHeader>
            <CardContent className="space-y-4">
              {[...Array(3)].map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <Skeleton className="h-5 w-40" />
            </CardHeader>
            <CardContent className="space-y-4">
              {[...Array(3)].map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  const overall = data?.overall ?? {
    total_predictions: 0,
    matches: 0,
    partials: 0,
    mismatches: 0,
    pending: 0,
    accuracy_percent: 0,
    avg_confidence: 0,
  };
  const agents = data?.agent_performance ?? [];
  const baseline = data?.baseline ?? {
    total_baselines: 0,
    unique_disciplines: 0,
    baseline_coverage_percent: 0,
    total_timed_reviews: 0,
    avg_time_per_comment: 0,
  };
  const validationGate = data?.validation_gate ?? {
    total_comments: 0,
    total_projects: 0,
    comments_goal: 300,
    projects_goal: 30,
  };
  const recentAudit = data?.recent_audit ?? [];

  const toggleFilter = (filter: ActiveFilter) => {
    setActiveFilter((prev) => (prev === filter ? "total" : filter));
  };

  const confidentButWrongCount = predictions.filter(
    (p) => p.match_status === "mismatch" && p.confidence_score >= 0.8
  ).length;

  const displayedPredictions = (() => {
    let result = [...predictions];
    if (activeFilter === "mismatches") {
      result = result.filter((p) => p.match_status === "mismatch");
    } else if (activeFilter === "accuracy") {
      result = result.filter((p) => p.match_status === "match");
    } else if (activeFilter === "confidence") {
      result.sort((a, b) => (a.confidence_score ?? 0) - (b.confidence_score ?? 0));
    } else if (activeFilter === "high-risk") {
      result = result.filter((p) => p.match_status === "mismatch" && p.confidence_score >= 0.8);
    }
    return result;
  })();

  const projectPermitMap = new Map((projects ?? []).map((p) => [p.id, p.permit_number || p.name]));

  const toggleRowExpand = (id: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const shadowModeActions = (
    <div className="flex items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        onClick={() => navigate("/admin")}
        data-testid="button-back-admin"
      >
        <ArrowLeft className="h-4 w-4 mr-2" />
        Back to Admin
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={exportWeeklyReport}
        disabled={exporting}
        data-testid="button-export-report"
      >
        {exporting ? (
          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
        ) : (
          <FileDown className="h-4 w-4 mr-2" />
        )}
        {exporting ? "Generating..." : "Export Report"}
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={() => { fetchMetrics(selectedProjectId, true); fetchPredictions(selectedProjectId); fetchCircuitBreaker(selectedProjectId); }}
        disabled={refreshing}
        data-testid="button-refresh-metrics"
      >
        {refreshing ? (
          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
        ) : (
          <RefreshCw className="h-4 w-4 mr-2" />
        )}
        Refresh
      </Button>
    </div>
  );

  return (
    <AdminPageShell
      title="Shadow Mode Dashboard"
      description="AI pipeline testing & baseline comparison"
      breadcrumbs={[{ label: "Shadow Mode" }]}
      actions={shadowModeActions}
    >
      <div className="space-y-6 max-w-7xl" data-testid="shadow-mode-dashboard">
      <div className="flex items-start gap-3 rounded-lg border border-primary/20 bg-primary/5 p-4" data-testid="text-explainer">
        <Info className="h-5 w-5 text-primary mt-0.5 shrink-0" />
        <p className="text-sm text-muted-foreground leading-relaxed">
          Shadow Mode safely runs the AI pipeline in parallel with historical human data. It compares the AI's autonomous classifications against actual expeditor decisions to mathematically prove system accuracy before live deployment.
        </p>
      </div>

      {selectedProjectId && (
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="text-xs" data-testid="badge-project-filtered">
            Filtered by sidebar project
          </Badge>
        </div>
      )}

      {error && (
        <Card className="border-red-500/30 bg-red-500/5">
          <CardContent className="pt-6">
            <p className="text-red-600 text-sm" data-testid="text-error-message">{error}</p>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Total Predictions"
          value={overall.total_predictions}
          subtitle={`Processed ${overall.total_predictions} comments, with ${overall.pending} currently awaiting a human baseline.`}
          icon={Activity}
          active={activeFilter === "total"}
          glowColor="ring-blue-500/60"
          onClick={() => toggleFilter("total")}
        />
        <StatCard
          title="Overall Accuracy"
          value={`${overall.accuracy_percent}%`}
          subtitle={`The AI matched the human expeditor on ${overall.matches} out of ${overall.matches + overall.mismatches + overall.partials} actionable comments (excludes ${overall.pending} pending).`}
          icon={Target}
          variant={
            overall.accuracy_percent >= 80
              ? "success"
              : overall.accuracy_percent >= 50
                ? "warning"
                : "danger"
          }
          active={activeFilter === "accuracy"}
          glowColor="ring-[#FF6B2B]/60"
          onClick={() => toggleFilter("accuracy")}
        />
        <StatCard
          title="Avg Confidence"
          value={`${(overall.avg_confidence * 100).toFixed(0)}%`}
          subtitle={`The LLM is operating with ${(overall.avg_confidence * 100).toFixed(0)}% self-reported certainty.`}
          icon={TrendingUp}
          variant={
            overall.avg_confidence >= 0.8
              ? "success"
              : overall.avg_confidence >= 0.6
                ? "warning"
                : "danger"
          }
          active={activeFilter === "confidence"}
          glowColor="ring-green-500/60"
          onClick={() => toggleFilter("confidence")}
        />
        <StatCard
          title="Mismatches"
          value={overall.mismatches}
          subtitle={`The AI had ${overall.mismatches} direct disagreement${overall.mismatches !== 1 ? "s" : ""} with the human expeditor.`}
          icon={AlertTriangle}
          variant={overall.mismatches > 0 ? "danger" : "success"}
          active={activeFilter === "mismatches"}
          glowColor="ring-red-500/60"
          onClick={() => toggleFilter("mismatches")}
        />
      </div>

      <Card
        data-testid="card-high-risk-errors"
        className={`${confidentButWrongCount > 0 ? "border-red-500/30 bg-red-500/5" : "border-green-500/30 bg-green-500/5"} cursor-pointer transition-transform duration-150 hover:scale-[1.01] ${activeFilter === "high-risk" ? "ring-2 ring-red-500/60 shadow-lg" : ""}`}
        onClick={() => toggleFilter("high-risk")}
      >
        <div className="flex items-center gap-3 px-4 py-3">
          <ShieldAlert className={`h-5 w-5 ${confidentButWrongCount > 0 ? "text-red-500" : "text-green-500"} shrink-0`} />
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold">
                {confidentButWrongCount} High-Risk Error{confidentButWrongCount !== 1 ? "s" : ""}
              </span>
              {confidentButWrongCount > 0 ? (
                <Badge variant="destructive" className="text-[10px] px-1.5 py-0">
                  Calibration Risk
                </Badge>
              ) : (
                <Badge variant="default" className="bg-green-600 text-white text-[10px] px-1.5 py-0">
                  Clean
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              {confidentButWrongCount > 0
                ? "Predictions where the AI was ≥80% confident but gave the wrong answer. Click to filter the table below."
                : "No predictions with ≥80% confidence scored as mismatches. Click to verify."}
            </p>
          </div>
        </div>
      </Card>

      <Card data-testid="card-agent-performance" className="py-0">
        <div className="flex items-center gap-3 px-4 py-2 border-b">
          <BarChart3 className="h-4 w-4 text-muted-foreground shrink-0" />
          <span className="text-sm font-medium whitespace-nowrap">Agent Performance</span>
          {agents.length === 0 ? (
            <span className="text-xs text-muted-foreground">No predictions yet</span>
          ) : (
            <div className="flex items-center gap-4 overflow-x-auto flex-1">
              {agents.map((agent) => {
                const threshold = getAgentThreshold(agent.agent_name);
                const passing = agent.accuracy >= threshold;
                const cbAgent = circuitBreaker?.agents?.find(
                  (cb) => cb.agent_name.toLowerCase() === agent.agent_name.toLowerCase()
                );
                const cbStatus = cbAgent?.status ?? "active";
                return (
                  <div key={agent.agent_name} className="flex items-center gap-2 shrink-0" data-testid={`agent-row-${agent.agent_name.toLowerCase().replace(/\s+/g, "-")}`}>
                    <span className="text-xs text-muted-foreground truncate max-w-[140px]">{agent.agent_name}</span>
                    <Progress value={agent.accuracy} className="h-1.5 w-20" />
                    <Badge variant={passing ? "default" : "destructive"} className="text-[10px] px-1.5 py-0">
                      {agent.accuracy}%
                    </Badge>
                    {passing ? (
                      <CheckCircle className="h-3 w-3 text-green-500 shrink-0" />
                    ) : (
                      <XCircle className="h-3 w-3 text-red-500 shrink-0" />
                    )}
                    {cbStatus === "disabled" ? (
                      <Badge
                        variant="destructive"
                        className="text-[10px] px-1.5 py-0 shrink-0 gap-1"
                        title={cbAgent?.reason ?? ""}
                        data-testid={`badge-cb-disabled-${agent.agent_name.toLowerCase().replace(/\s+/g, "-")}`}
                      >
                        <Zap className="h-2.5 w-2.5" />
                        DISABLED
                      </Badge>
                    ) : cbStatus === "warning" ? (
                      <Badge
                        variant="outline"
                        className="text-[10px] px-1.5 py-0 border-orange-500 text-orange-500 bg-orange-500/10 shrink-0 gap-1"
                        title={cbAgent?.reason ?? ""}
                        data-testid={`badge-cb-warning-${agent.agent_name.toLowerCase().replace(/\s+/g, "-")}`}
                      >
                        <Bell className="h-2.5 w-2.5" />
                        {cbAgent?.consecutive_fails} FAILS
                      </Badge>
                    ) : (
                      <Badge
                        variant="outline"
                        className="text-[10px] px-1.5 py-0 border-green-500 text-green-500 bg-green-500/10 shrink-0 gap-1"
                        data-testid={`badge-cb-active-${agent.agent_name.toLowerCase().replace(/\s+/g, "-")}`}
                      >
                        <CircleDot className="h-2.5 w-2.5" />
                        ACTIVE
                      </Badge>
                    )}
                    <span className="text-[10px] text-muted-foreground">≥{threshold}% · {agent.predictions}p</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </Card>

      <Card data-testid="card-baseline-metrics" className="py-0">
        <div className="flex items-center gap-3 px-4 py-3">
          <Clock className="h-4 w-4 text-muted-foreground shrink-0" />
          <span className="text-sm font-medium whitespace-nowrap">Baseline Metrics</span>
          {baseline.total_baselines === 0 && baseline.unique_disciplines === 0 ? (
            <span className="text-xs text-muted-foreground">No human baseline data recorded</span>
          ) : (
            <div className="flex items-center gap-6 flex-1 overflow-x-auto">
              <div className="flex flex-col shrink-0" data-testid="text-total-baselines">
                <span className="text-xs"><span className="font-semibold">{baseline.total_baselines}</span> <span className="text-muted-foreground">total baselines</span></span>
                <span className="text-[10px] text-muted-foreground leading-tight">Comments explicitly categorized by the human expeditor in the portal.</span>
              </div>
              <div className="flex flex-col shrink-0" data-testid="text-unique-disciplines">
                <span className="text-xs"><span className="font-semibold">{baseline.unique_disciplines}</span> <span className="text-muted-foreground">unique disciplines</span></span>
                <span className="text-[10px] text-muted-foreground leading-tight">Distinct routing departments utilized by the human.</span>
              </div>
              <div className="flex flex-col shrink-0" data-testid="text-baseline-coverage">
                <span className="text-xs"><span className="font-semibold">{baseline.baseline_coverage_percent}%</span> <span className="text-muted-foreground">baseline coverage</span></span>
                <span className="text-[10px] text-muted-foreground leading-tight">Percentage of the total comments the human actually addressed.</span>
              </div>
              <div className="flex flex-col shrink-0" data-testid="text-avg-time">
                <span className="text-xs flex items-center gap-1">
                  <Timer className="h-3 w-3" />
                  <span className="font-semibold">{baseline.avg_time_per_comment > 0 ? `${baseline.avg_time_per_comment} min` : "—"}</span>
                  <span className="text-muted-foreground">avg per comment</span>
                </span>
                <span className="text-[10px] text-muted-foreground leading-tight">Average time the human spent reviewing each comment ({baseline.total_timed_reviews} timed).</span>
              </div>
            </div>
          )}
        </div>
      </Card>

      <Card data-testid="card-validation-gate" className="py-0">
        <div className="flex items-center gap-3 px-4 py-3">
          <Trophy className="h-4 w-4 text-muted-foreground shrink-0" />
          <span className="text-sm font-medium whitespace-nowrap">Validation Gate Progress</span>
          <div className="flex items-center gap-6 flex-1">
            <div className="flex flex-col gap-1 min-w-[180px]" data-testid="gate-comments">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Total Shadow Comments</span>
                <span className="font-semibold">
                  {validationGate.total_comments} / {validationGate.comments_goal}
                  {validationGate.total_comments >= validationGate.comments_goal && (
                    <CheckCircle className="inline h-3 w-3 ml-1 text-green-500" />
                  )}
                </span>
              </div>
              <Progress
                value={Math.min((validationGate.total_comments / validationGate.comments_goal) * 100, 100)}
                className="h-2"
              />
            </div>
            <div className="flex flex-col gap-1 min-w-[180px]" data-testid="gate-projects">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Total Shadow Projects</span>
                <span className="font-semibold">
                  {validationGate.total_projects} / {validationGate.projects_goal}
                  {validationGate.total_projects >= validationGate.projects_goal && (
                    <CheckCircle className="inline h-3 w-3 ml-1 text-green-500" />
                  )}
                </span>
              </div>
              <Progress
                value={Math.min((validationGate.total_projects / validationGate.projects_goal) * 100, 100)}
                className="h-2"
              />
            </div>
            {validationGate.total_comments >= validationGate.comments_goal &&
              validationGate.total_projects >= validationGate.projects_goal ? (
              <Badge variant="default" className="bg-green-600 text-white text-[10px] shrink-0">
                <CheckCircle className="h-3 w-3 mr-1" /> Gate Passed
              </Badge>
            ) : (
              <Badge variant="secondary" className="text-[10px] shrink-0">
                In Progress
              </Badge>
            )}
          </div>
        </div>
      </Card>

      <Card data-testid="card-prediction-comparison">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Target className="h-5 w-5" />
                Prediction Comparison
              </CardTitle>
              <CardDescription>
                Side-by-side view of AI predictions vs. human expeditor decisions
              </CardDescription>
            </div>
            {activeFilter !== "total" && (
              <Badge variant="outline" className="text-xs" data-testid="badge-active-filter">
                {activeFilter === "mismatches" && "Showing Mismatches Only"}
                {activeFilter === "accuracy" && "Showing Matches Only"}
                {activeFilter === "confidence" && "Sorted by Confidence ↑"}
                {activeFilter === "high-risk" && "Showing High-Risk Errors Only"}
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {displayedPredictions.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              {predictions.length === 0
                ? "No predictions recorded yet. Enable Shadow Mode on a project and run the pipeline to see results."
                : "No rows match the active filter."}
            </p>
          ) : (
            <div className="rounded-md border overflow-auto max-h-[500px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-[200px]">Comment Snippet</TableHead>
                    <TableHead>Project</TableHead>
                    <TableHead>AI Prediction</TableHead>
                    <TableHead>Human Baseline</TableHead>
                    <TableHead>Confidence</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {displayedPredictions.map((pred) => {
                    const fullText = pred.parsed_comments?.original_text || "—";
                    const isLong = fullText.length > 120;
                    const isExpanded = expandedRows.has(pred.id);
                    const isConfidentButWrong = pred.match_status === "mismatch" && pred.confidence_score >= 0.8;
                    return (
                      <TableRow
                        key={pred.id}
                        data-testid={`prediction-row-${pred.id}`}
                        className={isConfidentButWrong ? "bg-red-500/8 border-l-2 border-l-red-500" : ""}
                      >
                        <TableCell className="text-sm max-w-[280px] align-top">
                          <div data-testid={`text-comment-snippet-${pred.id}`}>
                            {isConfidentButWrong && (
                              <div className="flex items-center gap-1 mb-1" data-testid={`alert-confident-wrong-${pred.id}`}>
                                <ShieldAlert className="h-3.5 w-3.5 text-red-500 shrink-0" />
                                <span className="text-[10px] font-semibold text-red-500">Confident But Wrong</span>
                              </div>
                            )}
                            <span className={isExpanded ? "" : "line-clamp-2"}>{fullText}</span>
                            {isLong && (
                              <button
                                className="text-xs text-primary hover:underline mt-0.5 block"
                                onClick={() => toggleRowExpand(pred.id)}
                                data-testid={`button-expand-${pred.id}`}
                              >
                                {isExpanded ? "Show less" : "Read more"}
                              </button>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-xs font-mono text-muted-foreground whitespace-nowrap align-top" data-testid={`text-project-${pred.id}`}>
                          {projectPermitMap.get(pred.project_id) || pred.project_id?.slice(0, 8) || "—"}
                        </TableCell>
                        <TableCell className="align-top">
                          <Badge variant="outline" className="font-mono text-xs" data-testid={`text-ai-prediction-${pred.id}`}>
                            {pred.prediction_data?.ai_discipline || "—"}
                          </Badge>
                        </TableCell>
                        <TableCell className="align-top">
                          {(pred.prediction_data?.portal_discipline || pred.prediction_data?.assigned_discipline) ? (
                            <Badge variant="secondary" className="font-mono text-xs" data-testid={`text-human-baseline-${pred.id}`}>
                              {pred.prediction_data.portal_discipline || pred.prediction_data.assigned_discipline}
                            </Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground" data-testid={`text-human-baseline-${pred.id}`}>No baseline</span>
                          )}
                        </TableCell>
                        <TableCell className={`text-sm font-mono align-top ${isConfidentButWrong ? "text-red-500 font-bold" : ""}`} data-testid={`text-confidence-${pred.id}`}>
                          {(pred.confidence_score * 100).toFixed(1)}%
                        </TableCell>
                        <TableCell className="align-top" data-testid={`badge-status-${pred.id}`}>
                          <MatchStatusBadge status={pred.match_status} />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card data-testid="card-audit-trail">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Recent Audit Trail
          </CardTitle>
          <CardDescription>
            Last 50 pipeline actions (immutable log)
          </CardDescription>
        </CardHeader>
        <CardContent>
          {recentAudit.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              No audit entries yet. Run the pipeline to generate entries.
            </p>
          ) : (
            <div className="rounded-md border overflow-auto max-h-[400px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Action</TableHead>
                    <TableHead>Routing</TableHead>
                    <TableHead>Timestamp</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recentAudit.map((entry) => (
                    <TableRow key={entry.id}>
                      <TableCell className="font-mono text-sm">
                        {entry.action_type}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            entry.routing_decision === "live_update"
                              ? "default"
                              : "secondary"
                          }
                        >
                          {entry.routing_decision}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {new Date(entry.created_at).toLocaleString()}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
      </div>
    </AdminPageShell>
  );
}
