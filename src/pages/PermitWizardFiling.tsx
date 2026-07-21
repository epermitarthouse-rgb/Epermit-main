import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AlertBanner, MetricCard, PageHeader, Panel, ServicePill, StatusPill } from "@/components/design/ProductPrimitives";
import { filingStatusTone } from "@/adapters/filingStatusAdapter";
import { cn } from "@/lib/utils";
import {
  Rocket,
  Loader2,
  RefreshCw,
  Check,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Shield,
  Bot,
  FileSearch,
  KeyRound,
  FileText,
  Tags,
  UserCheck,
  MonitorPlay,
  Send,
  Eye,
  Activity,
  ChevronRight,
  Plus,
  Filter,
  Globe,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/hooks/useAuth";
import { useSelectedProject } from "@/contexts/SelectedProjectContext";
import { useProjects } from "@/hooks/useProjects";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";
import { FilingReviewPanel } from "@/components/permit-wizard/FilingReviewPanel";
import { StartFilingDialog } from "@/components/permit-wizard/StartFilingDialog";
import { AgentRunDetail } from "@/components/permit-wizard/AgentRunDetail";

interface Municipality {
  id: string;
  municipality_key: string;
  display_name: string;
  short_name: string;
  state: string;
  portal_type: string;
  is_active: boolean;
}

const FALLBACK_MUNICIPALITIES: Municipality[] = [
  { id: 'fb-1', municipality_key: 'dc_dob', display_name: 'DC Department of Buildings', short_name: 'DC DOB', state: 'DC', portal_type: 'accela', is_active: true },
  { id: 'fb-2', municipality_key: 'fairfax_county_va', display_name: 'Fairfax County Land Development Services', short_name: 'Fairfax Co.', state: 'VA', portal_type: 'accela', is_active: true },
  { id: 'fb-3', municipality_key: 'baltimore_city_md', display_name: 'Baltimore City Housing & Community Development', short_name: 'Baltimore City', state: 'MD', portal_type: 'accela', is_active: true },
  { id: 'fb-4', municipality_key: 'howard_county_md', display_name: 'Howard County Inspections, Licenses & Permits', short_name: 'Howard Co.', state: 'MD', portal_type: 'accela', is_active: true },
  { id: 'fb-5', municipality_key: 'arlington_county_va', display_name: 'Arlington County Inspection Services', short_name: 'Arlington Co.', state: 'VA', portal_type: 'accela', is_active: true },
  { id: 'fb-6', municipality_key: 'anne_arundel_county_md', display_name: 'Anne Arundel County Inspections & Permits', short_name: 'Anne Arundel Co.', state: 'MD', portal_type: 'accela', is_active: true },
  { id: 'fb-7', municipality_key: 'pg_county_md', display_name: "Prince George's County DPIE", short_name: 'PG County', state: 'MD', portal_type: 'momentum_liferay', is_active: true },
  { id: 'fb-8', municipality_key: 'montgomery_county_md', display_name: 'Montgomery County DPS', short_name: 'Montgomery Co.', state: 'MD', portal_type: 'aspnet_webforms', is_active: true },
  { id: 'fb-9', municipality_key: 'alexandria_va', display_name: 'City of Alexandria Code Administration', short_name: 'Alexandria', state: 'VA', portal_type: 'energov', is_active: true },
  { id: 'fb-10', municipality_key: 'loudoun_county_va', display_name: 'Loudoun County Building & Development', short_name: 'Loudoun Co.', state: 'VA', portal_type: 'energov', is_active: true },
];

interface Filing {
  id: string;
  project_id?: string;
  user_id?: string;
  filing_status: string;
  permit_type?: string;
  permit_subtype?: string;
  review_track?: string;
  property_address?: string;
  scope_of_work?: string;
  construction_value?: number;
  property_type?: string;
  estimated_fee?: number;
  application_id?: string;
  confirmation_number?: string;
  municipality?: string | null;
  credential_id?: string | null;
  approval_package?: Record<string, unknown> | null;
  approval_decision?: string | null;
  approved_by?: string | null;
  approved_at?: string | null;
  approval_notes?: string | null;
  submitted_at?: string | null;
  created_at: string;
  updated_at: string;
}

interface AgentRun {
  id: string;
  filing_id: string;
  agent_name: string;
  layer: number;
  status: string;
  input_data?: Record<string, unknown> | null;
  output_data?: Record<string, unknown> | null;
  error_message?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  created_at: string;
}

const AGENT_CONFIG = [
  { name: "property_intelligence", label: "Property Intelligence", icon: FileSearch, layer: 1, number: "01" },
  { name: "license_validation", label: "License Validation", icon: KeyRound, layer: 1, number: "02" },
  { name: "document_preparation", label: "Document Preparation", icon: FileText, layer: 1, number: "03" },
  { name: "permit_classifier", label: "Permit Classifier", icon: Tags, layer: 1, number: "04" },
  { name: "pre_submission_review", label: "Human Review Gate", icon: UserCheck, layer: 1, number: "05" },
  { name: "authentication", label: "Portal Authentication", icon: Shield, layer: 2, number: "06" },
  { name: "form_filing", label: "Form Filing", icon: MonitorPlay, layer: 2, number: "07" },
  { name: "submission_finalization", label: "Submission", icon: Send, layer: 2, number: "08" },
  { name: "status_monitor", label: "Status Monitor", icon: Eye, layer: 3, number: "09" },
];

const LAYER_LABELS: Record<number, string> = {
  1: "Pre-Flight",
  2: "Execution",
  3: "Post-Submission",
};

const STAGE_GROUPS: { name: string; agents: string[] }[] = [
  { name: "Property & license intake", agents: ["property_intelligence", "license_validation"] },
  { name: "Document prep & classification", agents: ["document_preparation", "permit_classifier"] },
  { name: "Human review gate", agents: ["pre_submission_review"] },
  { name: "Portal authentication & filing", agents: ["authentication", "form_filing"] },
  { name: "Submission", agents: ["submission_finalization"] },
  { name: "Status monitoring & issuance", agents: ["status_monitor"] },
];

const STATUS_BADGE: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline"; className?: string }> = {
  pending: { label: "Pending", variant: "secondary" },
  running: { label: "Running", variant: "default", className: "bg-blue-600 dark:bg-blue-500" },
  completed: { label: "Completed", variant: "default", className: "bg-emerald-600 dark:bg-emerald-500" },
  failed: { label: "Failed", variant: "destructive" },
  escalated: { label: "Escalated", variant: "default", className: "bg-amber-600 dark:bg-amber-500" },
  waiting_human: { label: "Awaiting Review", variant: "default", className: "bg-amber-600 dark:bg-amber-500" },
};

const FILING_STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  preflight: { label: "Pre-Flight", className: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300 border-0" },
  awaiting_approval: { label: "Awaiting Approval", className: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300 border-0" },
  approved: { label: "Approved", className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300 border-0" },
  filing: { label: "Filing", className: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300 border-0" },
  submitted: { label: "Submitted", className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300 border-0" },
  failed: { label: "Failed", className: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300 border-0" },
  cancelled: { label: "Cancelled", className: "" },
};

const AGENT_STATUS_TONE: Record<string, "default" | "good" | "warn" | "bad" | "info"> = {
  pending: "default",
  running: "info",
  completed: "good",
  failed: "bad",
  escalated: "warn",
  waiting_human: "warn",
};

function TaskRow({
  config,
  run,
  isActive,
  onClick,
}: {
  config: (typeof AGENT_CONFIG)[number];
  run?: AgentRun;
  isActive: boolean;
  onClick: () => void;
}) {
  const status = run?.status || "pending";
  const badge = STATUS_BADGE[status] || STATUS_BADGE.pending;
  const tone = AGENT_STATUS_TONE[status] || "default";
  const isRunning = status === "running";
  const isDone = status === "completed";

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-3 rounded-lg border border-border px-4 py-3 transition-colors",
        isActive && "border-primary bg-primary/5",
        run && "cursor-pointer",
      )}
      onClick={run ? onClick : undefined}
      data-testid={`card-agent-${config.name}`}
    >
      <span
        className={cn(
          "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border",
          isDone
            ? "border-success bg-success/20 text-success"
            : isRunning
            ? "border-primary bg-primary/20 text-primary"
            : status === "failed"
            ? "border-destructive bg-destructive/10 text-destructive"
            : status === "escalated" || status === "waiting_human"
            ? "border-warning bg-warning/10 text-warning"
            : "border-border text-muted-foreground",
        )}
      >
        {isDone ? (
          <Check className="h-3.5 w-3.5" />
        ) : isRunning ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : status === "failed" ? (
          <XCircle className="h-3.5 w-3.5" />
        ) : status === "escalated" || status === "waiting_human" ? (
          <AlertTriangle className="h-3.5 w-3.5" />
        ) : (
          <span className="block h-1.5 w-1.5 rounded-full bg-current" />
        )}
      </span>
      <div className="min-w-[220px] flex-1">
        <div className={cn("text-sm font-medium", isDone && "text-muted-foreground line-through")}>
          {config.label}
        </div>
        <div className="mt-1 flex items-center gap-2">
          <span className="text-xs text-muted-foreground font-mono">{config.number}</span>
          <ServicePill kind="permit">{LAYER_LABELS[config.layer]}</ServicePill>
        </div>
      </div>
      <StatusPill tone={tone} data-testid={`badge-agent-status-${config.name}`}>
        {badge.label}
      </StatusPill>
      <Button
        size="sm"
        variant={isRunning ? "default" : "outline"}
        disabled={!run}
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
      >
        {run ? "Open" : "Queued"} <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  );
}

export default function PermitWizardFiling() {
  const { user, loading: authLoading } = useAuth();
  const { selectedProjectId, setSelectedProjectId } = useSelectedProject();
  const { projects } = useProjects();
  const navigate = useNavigate();

  const [filings, setFilings] = useState<Filing[]>([]);
  const [agentRuns, setAgentRuns] = useState<AgentRun[]>([]);
  const [selectedFiling, setSelectedFiling] = useState<Filing | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [startDialogOpen, setStartDialogOpen] = useState(false);
  const [reviewDialogOpen, setReviewDialogOpen] = useState(false);
  const [selectedAgentRun, setSelectedAgentRun] = useState<AgentRun | null>(null);
  const [agentDetailOpen, setAgentDetailOpen] = useState(false);
  const [screenshots, setScreenshots] = useState<Array<{ id: string; filing_id: string; agent_name: string; step_name: string; screenshot_url: string; field_audit?: Record<string, unknown> | null; created_at: string }>>([]);
  const [municipalities, setMunicipalities] = useState<Municipality[]>([]);
  const [municipalityFilter, setMunicipalityFilter] = useState<string>("__all__");

  const selectedProject = projects.find((p) => p.id === selectedProjectId) || null;

  useEffect(() => {
    if (!authLoading && !user) {
      navigate("/auth");
    }
  }, [user, authLoading, navigate]);

  useEffect(() => {
    supabase
      .from("municipality_configs")
      .select("id, municipality_key, display_name, short_name, state, portal_type, is_active")
      .eq("is_active", true)
      .order("display_name", { ascending: true })
      .then(({ data, error }) => {
        if (error || !data || data.length === 0) {
          setMunicipalities(FALLBACK_MUNICIPALITIES);
        } else {
          setMunicipalities(data);
        }
      });
  }, []);

  const getMunicipalityInfo = useCallback((key: string | null | undefined) => {
    if (!key) return null;
    return municipalities.find((m) => m.municipality_key === key) || null;
  }, [municipalities]);

  const PORTAL_TYPE_LABELS: Record<string, string> = {
    accela: "Accela",
    momentum_liferay: "Momentum",
    aspnet_webforms: "ASP.NET",
    energov: "EnerGov",
  };

  const filteredFilings = municipalityFilter === "__all__"
    ? filings
    : filings.filter((f) => f.municipality === municipalityFilter);

  const fetchFilings = useCallback(async () => {
    if (!user) return;
    try {
      let query = supabase
        .from("permit_filings")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });

      if (selectedProjectId) {
        query = query.eq("project_id", selectedProjectId);
      }

      const { data, error } = await query;
      if (error) throw error;
      setFilings(data || []);

      if (data && data.length > 0) {
        const current = selectedFiling
          ? data.find((f) => f.id === selectedFiling.id) || data[0]
          : data[0];
        setSelectedFiling(current);
      } else {
        setSelectedFiling(null);
      }
    } catch (err) {
      console.error("Failed to fetch filings:", err);
    }
  }, [user, selectedProjectId, selectedFiling]);

  const fetchAgentRuns = useCallback(async () => {
    if (!selectedFiling) {
      setAgentRuns([]);
      return;
    }
    try {
      const { data, error } = await supabase
        .from("agent_runs")
        .select("*")
        .eq("filing_id", selectedFiling.id)
        .order("created_at", { ascending: true });

      if (error) throw error;
      setAgentRuns(data || []);
    } catch (err) {
      console.error("Failed to fetch agent runs:", err);
    }
  }, [selectedFiling]);

  useEffect(() => {
    if (user) {
      setLoading(true);
      fetchFilings().finally(() => setLoading(false));
    }
  }, [user, selectedProjectId]);

  const fetchScreenshots = useCallback(async () => {
    if (!selectedFiling) {
      setScreenshots([]);
      return;
    }
    try {
      const { data, error } = await supabase
        .from("filing_screenshots")
        .select("*")
        .eq("filing_id", selectedFiling.id)
        .order("created_at", { ascending: true });

      if (error) throw error;
      setScreenshots(data || []);
    } catch (err) {
      console.error("Failed to fetch screenshots:", err);
    }
  }, [selectedFiling]);

  useEffect(() => {
    fetchAgentRuns();
    fetchScreenshots();
  }, [selectedFiling?.id]);

  useEffect(() => {
    if (!selectedFiling) return;
    const isActive = ["preflight", "filing"].includes(selectedFiling.filing_status);
    if (!isActive) return;

    const interval = setInterval(() => {
      fetchFilings();
      fetchAgentRuns();
      fetchScreenshots();
    }, 5000);

    return () => clearInterval(interval);
  }, [selectedFiling?.id, selectedFiling?.filing_status]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await Promise.all([fetchFilings(), fetchAgentRuns(), fetchScreenshots()]);
    setRefreshing(false);
  };

  const handleFilingStarted = (filingId: string) => {
    fetchFilings().then(() => {
      const found = filings.find((f) => f.id === filingId);
      if (found) setSelectedFiling(found);
    });
  };

  const getRunForAgent = (agentName: string) => {
    return agentRuns.find((r) => r.agent_name === agentName);
  };

  const layerAgents = (layer: number) => AGENT_CONFIG.filter((a) => a.layer === layer);

  const totalFilings = filings.length;
  const awaitingApprovalCount = filings.filter((f) => f.filing_status === "awaiting_approval").length;
  const municipalityCount = new Set(filings.map((f) => f.municipality).filter(Boolean)).size;
  const selectedAgentCompleted = selectedFiling
    ? agentRuns.filter((r) => r.status === "completed").length
    : 0;
  const agentProgressLabel = selectedFiling ? `${selectedAgentCompleted}/${AGENT_CONFIG.length}` : "—";
  const agentProgressHint = selectedFiling
    ? `${FILING_STATUS_CONFIG[selectedFiling.filing_status]?.label || selectedFiling.filing_status} · ${selectedFiling.property_address || "Selected filing"}`
    : "Select a filing to see pipeline progress";

  const stagePhases = (() => {
    if (!selectedFiling) return [];
    let currentAssigned = false;
    return STAGE_GROUPS.map((group) => {
      const statuses = group.agents.map((name) => getRunForAgent(name)?.status || "pending");
      const done = statuses.every((s) => s === "completed");
      const failed = statuses.some((s) => s === "failed");
      const blocked = statuses.some((s) => s === "waiting_human" || s === "escalated");
      const started = statuses.some((s) => s !== "pending");
      const completedCount = statuses.filter((s) => s === "completed").length;

      let summary: string;
      if (failed) summary = "Blocked — an agent step failed here.";
      else if (blocked) summary = "Waiting on a human review decision.";
      else if (done) summary = "Completed for this filing.";
      else if (started) summary = `${completedCount}/${group.agents.length} steps complete.`;
      else summary = "Not started yet.";

      let current = false;
      if (!done && !currentAssigned) {
        current = true;
        currentAssigned = true;
      }

      return { name: group.name, done, current, failed, blocked, summary };
    });
  })();

  const operatorGuidance = (() => {
    if (!selectedFiling) {
      return { text: "Select a filing from the queue to see live pipeline guidance and next steps.", action: null as null | { label: string; onClick: () => void } };
    }
    const failedRun = agentRuns.find((r) => r.status === "failed");
    const blockedRun = agentRuns.find((r) => r.status === "waiting_human" || r.status === "escalated");
    if (selectedFiling.filing_status === "failed" || failedRun) {
      return {
        text: failedRun?.error_message
          ? `${AGENT_CONFIG.find((a) => a.name === failedRun.agent_name)?.label || failedRun.agent_name} failed: ${failedRun.error_message}`
          : "A pipeline step failed for this filing. Review the agent log below before retrying.",
        action: failedRun ? { label: "View agent log", onClick: () => { setSelectedAgentRun(failedRun); setAgentDetailOpen(true); } } : null,
      };
    }
    if (selectedFiling.filing_status === "awaiting_approval") {
      return {
        text: `${selectedFiling.property_address || "This filing"} has cleared automated pre-flight checks and needs a human approval decision to continue to submission.`,
        action: { label: "Review & Decide", onClick: () => setReviewDialogOpen(true) },
      };
    }
    if (blockedRun) {
      return {
        text: `${AGENT_CONFIG.find((a) => a.name === blockedRun.agent_name)?.label || blockedRun.agent_name} is waiting on a decision before the pipeline can continue.`,
        action: { label: "View agent log", onClick: () => { setSelectedAgentRun(blockedRun); setAgentDetailOpen(true); } },
      };
    }
    if (selectedFiling.filing_status === "submitted") {
      return {
        text: "This filing has been submitted to the portal. Status monitoring will keep watching for jurisdiction updates.",
        action: null,
      };
    }
    return {
      text: "Pipeline is progressing automatically. No action is needed right now — new steps will appear here as agents complete.",
      action: null,
    };
  })();

  if (authLoading) {
    return (
      <div className="min-h-[80vh] flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Permit Filing"
        title="Phase · Filing workflow"
        body="Multi-municipality autonomous filing pipeline. Start, monitor, and review real filing statuses with utility coordination dependencies surfaced in the same flow."
        action={
          <div className="flex flex-wrap items-center gap-2">
            <ServicePill kind="permit">Permit expediting</ServicePill>
            <ServicePill kind="utility">Utility coordination</ServicePill>
            <Button
              variant="outline"
              size="sm"
              onClick={handleRefresh}
              disabled={refreshing}
              data-testid="button-refresh"
              className="pilot-button-ghost"
            >
              <RefreshCw className={`mr-1 h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Button
              onClick={() => setStartDialogOpen(true)}
              data-testid="button-start-filing"
              className="pilot-button-primary"
            >
              <Plus className="mr-1 h-4 w-4" />
              Start New Filing
            </Button>
          </div>
        }
      />
      <div className="space-y-6">
        <div className="grid gap-4 md:grid-cols-4">
          <MetricCard
            label="Total filings"
            value={totalFilings}
            icon={FileText}
            detail={municipalityFilter === "__all__" ? "All municipalities" : "Filtered view active"}
          />
          <MetricCard
            label="Awaiting approval"
            value={awaitingApprovalCount}
            icon={UserCheck}
            detail={awaitingApprovalCount > 0 ? "Needs a review decision" : "Nothing pending review"}
          />
          <MetricCard
            label="Agent pipeline"
            value={agentProgressLabel}
            icon={Activity}
            detail={agentProgressHint}
          />
          <MetricCard
            label="Municipalities"
            value={municipalityCount}
            icon={Globe}
            detail="Active portal jurisdictions in this view"
          />
        </div>

        {selectedFiling?.filing_status === "awaiting_approval" && (
          <AlertBanner
            tone="warn"
            title="A filing is awaiting your review"
            detail={`${selectedFiling.property_address || "This filing"} is ready for an approval decision. Open Review & Decide to continue the pipeline.`}
          />
        )}
        {selectedFiling?.filing_status === "failed" && (
          <AlertBanner
            tone="bad"
            title="Filing failed"
            detail="Check agent logs below for details on what went wrong before retrying."
          />
        )}

        {!selectedProjectId && !loading && filings.length === 0 && (
          <div className="pilot-card border-dashed mb-6 border-2 flex flex-col items-center justify-center py-12 text-center">
            <Bot className="h-12 w-12 text-muted-foreground/50 mb-4" />
            <h3 className="font-semibold mb-2" data-testid="text-no-project">Get Started with Permit Filing</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Start a new filing to create a project and initiate the autonomous permit filing pipeline, or select an existing project from the sidebar.
            </p>
            <Button
              onClick={() => setStartDialogOpen(true)}
              data-testid="button-start-filing-no-project"
            >
              <Plus className="h-4 w-4 mr-1" />
              Start New Filing
            </Button>
          </div>
        )}

        {selectedProjectId && loading && (
          <div className="space-y-4">
            <Skeleton className="h-40 w-full" />
            <div className="grid lg:grid-cols-3 gap-4">
              <Skeleton className="h-60" />
              <Skeleton className="h-60" />
              <Skeleton className="h-60" />
            </div>
          </div>
        )}

        {selectedProjectId && !loading && filings.length > 0 && municipalities.length > 0 && (
          <div className="mb-4">
            <Select value={municipalityFilter} onValueChange={setMunicipalityFilter}>
              <SelectTrigger className="w-[260px]" data-testid="select-municipality-filter">
                <div className="flex items-center gap-2">
                  <Filter className="h-4 w-4 text-muted-foreground" />
                  <SelectValue placeholder="Filter by municipality" />
                </div>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All Municipalities</SelectItem>
                {municipalities.map((m) => (
                  <SelectItem key={m.municipality_key} value={m.municipality_key}>
                    {m.short_name} ({m.state})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {selectedProjectId && !loading && filings.length === 0 && (
          <div className="pilot-card border-dashed border-2 flex flex-col items-center justify-center py-12 text-center">
            <Rocket className="h-12 w-12 text-muted-foreground/50 mb-4" />
            <h3 className="font-semibold mb-2" data-testid="text-no-filings">No Filings Yet</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Start a new filing to initiate the autonomous permit filing pipeline.
            </p>
            <Button
              onClick={() => setStartDialogOpen(true)}
              data-testid="button-start-filing-empty"
            >
              <Plus className="h-4 w-4 mr-1" />
              Start New Filing
            </Button>
          </div>
        )}

        {selectedProjectId && !loading && filings.length > 0 && (
          <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
            <div className="space-y-4 lg:self-start">
              <Panel eyebrow="Filing queue" title="Filings" className="lg:self-start">
                <ScrollArea className="max-h-64">
                  <div className="space-y-2 pr-2">
                    {filteredFilings.map((filing) => {
                      const statusCfg = FILING_STATUS_CONFIG[filing.filing_status] || { label: filing.filing_status, className: "" };
                      const isSelected = selectedFiling?.id === filing.id;
                      const muniInfo = getMunicipalityInfo(filing.municipality);
                      return (
                        <Card
                          key={filing.id}
                          className={`cursor-pointer transition-colors ${isSelected ? "border-primary" : ""}`}
                          onClick={() => setSelectedFiling(filing)}
                          data-testid={`card-filing-${filing.id}`}
                        >
                          <CardContent className="p-3">
                            <div className="flex items-center justify-between gap-2 mb-1">
                              <StatusPill
                                tone={filingStatusTone(filing.filing_status)}
                                data-testid={`badge-filing-status-${filing.id}`}
                              >
                                {statusCfg.label}
                              </StatusPill>
                              <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                            </div>
                            {muniInfo && (
                              <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                                <Badge variant="outline" className="text-xs" data-testid={`badge-filing-municipality-${filing.id}`}>
                                  <Globe className="h-3 w-3 mr-1" />
                                  {muniInfo.short_name} ({muniInfo.state})
                                </Badge>
                                <span className="text-xs text-muted-foreground">
                                  {PORTAL_TYPE_LABELS[muniInfo.portal_type] || muniInfo.portal_type}
                                </span>
                              </div>
                            )}
                            <p className="text-sm font-medium truncate" data-testid={`text-filing-address-${filing.id}`}>
                              {filing.property_address || "No address"}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {new Date(filing.created_at).toLocaleDateString()}
                            </p>
                            {filing.confirmation_number && (
                              <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-1" data-testid={`text-confirmation-${filing.id}`}>
                                Conf: {filing.confirmation_number}
                              </p>
                            )}
                          </CardContent>
                        </Card>
                      );
                    })}
                    {filteredFilings.length === 0 && filings.length > 0 && (
                      <p className="text-sm text-muted-foreground text-center py-4" data-testid="text-no-filtered-filings">
                        No filings match the selected municipality filter.
                      </p>
                    )}
                  </div>
                </ScrollArea>
              </Panel>

              {selectedFiling && (
                <aside className="pilot-card p-5" data-testid="panel-workflow-stages">
                  <p className="pilot-kicker mb-4">Workflow stages</p>
                  <ol className="space-y-4">
                    {stagePhases.map((phase, index) => (
                      <li key={phase.name} className="flex gap-3">
                        <div
                          className={cn(
                            "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-[10px] font-bold",
                            phase.failed
                              ? "border-destructive bg-destructive/10 text-destructive"
                              : phase.done
                              ? "border-success bg-success/20 text-success"
                              : phase.current
                              ? "border-primary bg-primary/20 text-primary"
                              : "border-border bg-muted text-muted-foreground",
                          )}
                        >
                          {phase.done ? <Check className="h-3.5 w-3.5" /> : index + 1}
                        </div>
                        <div>
                          <div className={cn("text-sm", phase.current ? "font-bold text-foreground" : "text-foreground/80")}>
                            {phase.name}
                          </div>
                          <div className="mt-0.5 text-xs text-muted-foreground">{phase.summary}</div>
                        </div>
                      </li>
                    ))}
                  </ol>
                </aside>
              )}
            </div>

            <div className="space-y-4">
              {selectedFiling && (
                <>
                  <Panel
                    eyebrow="Operator queue"
                    title={
                      <span className="flex items-center gap-2">
                        <Activity className="h-5 w-5" />
                        Outstanding tasks
                      </span>
                    }
                    action={
                      selectedFiling.filing_status === "awaiting_approval" && (
                        <Button
                          size="sm"
                          onClick={() => setReviewDialogOpen(true)}
                          data-testid="button-open-review"
                          className="pilot-button-primary"
                        >
                          <UserCheck className="h-4 w-4 mr-1" />
                          Review & Decide
                        </Button>
                      )
                    }
                  >
                    <p className="mb-4 text-sm text-muted-foreground">
                      {selectedFiling.property_address || "Filing"} — {FILING_STATUS_CONFIG[selectedFiling.filing_status]?.label || selectedFiling.filing_status}
                      {(() => {
                        const muni = getMunicipalityInfo(selectedFiling.municipality);
                        return muni ? ` — ${muni.short_name} (${PORTAL_TYPE_LABELS[muni.portal_type] || muni.portal_type})` : "";
                      })()}
                    </p>
                    <div className="space-y-5">
                      {[1, 2, 3].map((layer) => {
                        const agents = layerAgents(layer);
                        return (
                          <div key={layer}>
                            <div className="mb-2 flex items-center gap-2">
                              <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
                                Layer {layer} · {LAYER_LABELS[layer]}
                              </span>
                            </div>
                            <div className="grid gap-2">
                              {agents.map((agentCfg) => {
                                const agentRun = getRunForAgent(agentCfg.name);
                                return (
                                  <TaskRow
                                    key={agentCfg.name}
                                    config={agentCfg}
                                    run={agentRun}
                                    isActive={selectedAgentRun?.agent_name === agentCfg.name && agentDetailOpen}
                                    onClick={() => {
                                      if (agentRun) {
                                        setSelectedAgentRun(agentRun);
                                        setAgentDetailOpen(true);
                                      }
                                    }}
                                  />
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </Panel>

                  <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
                    <Panel title="Operator guidance" eyebrow="Co-pilot">
                      <p className="text-sm leading-6 text-muted-foreground">{operatorGuidance.text}</p>
                      {operatorGuidance.action && (
                        <div className="mt-4">
                          <Button size="sm" className="pilot-button-primary" onClick={operatorGuidance.action.onClick}>
                            {operatorGuidance.action.label}
                          </Button>
                        </div>
                      )}
                    </Panel>

                    <Panel title="Filing details" eyebrow="Reference">
                      <div className="space-y-3">
                        <div className="rounded-lg border border-border bg-muted/20 p-4">
                          <div className="flex items-center justify-between gap-3">
                            <div className="text-sm font-medium text-foreground">Municipality & portal</div>
                            <StatusPill tone={selectedFiling.municipality ? "good" : "default"}>
                              {selectedFiling.municipality ? "Assigned" : "Unassigned"}
                            </StatusPill>
                          </div>
                          <p className="mt-2 text-xs leading-5 text-muted-foreground">
                            {(() => {
                              const muni = getMunicipalityInfo(selectedFiling.municipality);
                              return muni
                                ? `${muni.display_name} — ${PORTAL_TYPE_LABELS[muni.portal_type] || muni.portal_type} portal`
                                : "No municipality has been matched to this filing yet.";
                            })()}
                          </p>
                        </div>
                        <div className="rounded-lg border border-border bg-muted/20 p-4">
                          <div className="flex items-center justify-between gap-3">
                            <div className="text-sm font-medium text-foreground">Filing identifiers</div>
                            <StatusPill tone={selectedFiling.confirmation_number ? "good" : "default"}>
                              {selectedFiling.confirmation_number ? "Confirmed" : "Pending"}
                            </StatusPill>
                          </div>
                          <p className="mt-2 text-xs leading-5 text-muted-foreground">
                            {selectedFiling.application_id ? `Application: ${selectedFiling.application_id}. ` : ""}
                            {selectedFiling.confirmation_number
                              ? `Confirmation: ${selectedFiling.confirmation_number}.`
                              : "No confirmation number yet — this appears once the portal accepts the submission."}
                          </p>
                        </div>
                      </div>
                    </Panel>
                  </div>

                  {selectedFiling.filing_status === "submitted" && (
                    <AlertBanner
                      tone="good"
                      title="Filing submitted successfully"
                      detail={
                        <div className="space-y-0.5">
                          {selectedFiling.application_id && (
                            <p data-testid="text-application-id">Application ID: {selectedFiling.application_id}</p>
                          )}
                          {selectedFiling.confirmation_number && (
                            <p data-testid="text-confirmation-number">Confirmation: {selectedFiling.confirmation_number}</p>
                          )}
                          {selectedFiling.submitted_at && (
                            <p className="text-xs opacity-80">
                              Submitted: {new Date(selectedFiling.submitted_at).toLocaleString()}
                            </p>
                          )}
                        </div>
                      }
                    />
                  )}

                  {selectedFiling.filing_status === "failed" && (
                    <AlertBanner
                      tone="bad"
                      title="Filing failed"
                      detail="Check agent logs above for details on what went wrong."
                    />
                  )}

                  {selectedFiling.approval_decision && (
                    <Panel
                      eyebrow={selectedFiling.approved_at ? new Date(selectedFiling.approved_at).toLocaleString() : undefined}
                      title={
                        <span className="flex items-center gap-2 text-base">
                          {selectedFiling.approval_decision === "approved" ? (
                            <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                          ) : (
                            <XCircle className="h-4 w-4 text-destructive" />
                          )}
                          Decision: {selectedFiling.approval_decision === "approved" ? "Approved" : "Rejected"}
                        </span>
                      }
                    >
                      {selectedFiling.approval_notes ? (
                        <p className="text-sm" data-testid="text-decision-notes">{selectedFiling.approval_notes}</p>
                      ) : null}
                    </Panel>
                  )}
                </>
              )}
            </div>
          </div>
        )}

        <StartFilingDialog
          open={startDialogOpen}
          onOpenChange={setStartDialogOpen}
          project={selectedProject}
          onFilingStarted={handleFilingStarted}
          onProjectCreated={(newProject) => {
            setSelectedProjectId(newProject.id);
          }}
        />

        <FilingReviewPanel
          filing={selectedFiling}
          isLoading={false}
          onDecisionMade={() => {
            fetchFilings();
            setReviewDialogOpen(false);
          }}
          asDialog
          dialogOpen={reviewDialogOpen}
          onDialogClose={() => setReviewDialogOpen(false)}
        />

        <AgentRunDetail
          run={selectedAgentRun}
          screenshots={screenshots}
          open={agentDetailOpen}
          onOpenChange={(open) => {
            setAgentDetailOpen(open);
            if (!open) setSelectedAgentRun(null);
          }}
        />
      </div>
    </div>
  );
}
