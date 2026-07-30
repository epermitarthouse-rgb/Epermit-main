import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { EyebrowDark, SectionTitle } from "@/components/ui/Typography";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/hooks/useAuth";
import { useSelectedProject } from "@/contexts/SelectedProjectContext";
import {
  useScrape,
  getPersistedAccelaSessionForProject,
  getPersistedScrapeSessionForProject,
} from "@/contexts/ScrapeContext";
import { isArlingtonAccelaStaleSessionScrapeError } from "@/lib/arlingtonAccelaSession";
import {
  durableScrapePortalLabel,
  durableScrapePortalStepStatus,
} from "@/lib/scrapeJobTypes";
import {
  arlingtonPlanReviewDocumentScrapeOpts,
  arlingtonPlanReviewProjectInformationScrapeOpts,
  arlingtonScrapeAllOpts,
  type ArlingtonScrapeTabOpts,
} from "@/lib/arlingtonPlanReviewScrapeScope";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";
import {
  CheckCircle2,
  ChevronDown,
  Circle,
  Loader2,
  RefreshCw,
  ExternalLink,
  XCircle,
  Workflow,
  FolderOpen,
  MessageSquare,
  Layers,
  FileBox,
  FileText,
  ClipboardList,
} from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import {
  isArlingtonPortalContext,
  isBaltimorePortal,
  isFairfaxPortal,
  isMontgomeryProjectDoxPortalCredential,
  isHowardProjectDoxPortalCredential,
  isPgcEplanPortalCredential,
  isWashingtonStyleProjectDoxCredential,
} from "@/lib/portalView";
import { getScraperBaseUrl } from "@/lib/scraperBaseUrl";
import {
  buildQuickScrapeRequestIdentity,
  resolveQuickScrapeSubmitFields,
} from "@/lib/quickScrapeFormState";

const SCRAPER_URL = getScraperBaseUrl();

const ARLINGTON_SCRAPE_MENU_OPTIONS = [
  "Scrape All",
  "Quick Scrape (Record Info Only)",
  "Attachments Only",
  "Plan Review Complete",
  "Plan Review - Plans & Documents",
  "Plan Review - Review Results & Mark-ups",
  "Plan Review - Approved Documents",
  "Plan Review - Project Information",
] as const;

/** Washington / general ProjectDox–style scraper modes */
type GeneralScrapeMode =
  | "standard"
  | "all"
  | "files"
  | "comments"
  | "supporting_docs";

/** Prince George's County ePlan modes (sent as scrapeMode to /api/scrape) */
type PgcScrapeMode =
  | "scrape_without_files"
  | "scrape_files_only"
  | "scrape_comments_only"
  | "scrape_review_tab"
  | "scrape_all";

/** Montgomery County Avolve ProjectDox modes (sent as scrapeMode to /api/scrape) */
type MontgomeryScrapeMode =
  | "montgomery_quick"
  | "montgomery_without_files"
  | "montgomery_files_only"
  | "montgomery_reports_only"
  | "montgomery_status_only"
  | "montgomery_tasks_only"
  | "montgomery_info_only"
  | "montgomery_all";

/** Howard County Avolve ProjectDox modes (same omit-tab matrix as Montgomery) */
type HowardScrapeMode =
  | "howard_quick"
  | "howard_without_files"
  | "howard_without_reports"
  | "howard_files_only"
  | "howard_reports_only"
  | "howard_status_only"
  | "howard_tasks_only"
  | "howard_info_only"
  | "howard_all";

type ScrapeModeParam =
  | GeneralScrapeMode
  | PgcScrapeMode
  | MontgomeryScrapeMode
  | HowardScrapeMode;

const WASHINGTON_SCRAPE_TAB_DEFS = [
  { key: "info", label: "Info" },
  { key: "status", label: "Status" },
  { key: "tasks", label: "Tasks" },
  { key: "reports", label: "Reports" },
  { key: "files", label: "Files" },
] as const;

type WashingtonTabKey = (typeof WASHINGTON_SCRAPE_TAB_DEFS)[number]["key"];

const BALTIMORE_SCRAPE_TAB_DEFS = [
  { key: "info", label: "Info" },
  { key: "attachments", label: "Attachments" },
] as const;

type BaltimoreTabKey = (typeof BALTIMORE_SCRAPE_TAB_DEFS)[number]["key"];

const FAIRFAX_SCRAPE_TAB_DEFS = [
  { key: "info", label: "Info" },
  { key: "attachments", label: "Attachments" },
] as const;

type FairfaxTabKey = (typeof FAIRFAX_SCRAPE_TAB_DEFS)[number]["key"];

const WASHINGTON_FILE_FOLDER_OPTIONS = [
  { key: "drawings", label: "Drawings" },
  { key: "supporting_documents", label: "Supporting Documents" },
  { key: "approved_drawings", label: "Approved Drawings" },
  { key: "approved_supporting_documents", label: "Approved Supporting Documents" },
] as const;

type PipelineResult = {
  comment_parser?: {
    parsed_count?: number;
    skipped_count?: number;
    error?: string;
    done?: boolean;
    next_cursor?: { pdfIndex: number };
    total_pdfs?: number;
  };
  discipline_classifier?: { classified_count?: number; error?: string };
};

type StepStatus =
  | "idle"
  | "checking"
  | "waiting"
  | "pending"
  | "done"
  | "failed";

type ChainPhase =
  | "idle"
  | "scraping"
  | "intake"
  | "classifier"
  | "enrichment"
  | "router"
  | "complete";

function syncChainPhaseFromStages(
  stages: Record<string, { status?: string }> | undefined,
  nextAction: string,
): ChainPhase {
  if (nextAction === "complete") return "complete";
  if (!stages) return "intake";
  if (stages.auto_routing?.status === "running") return "router";
  if (stages.enrichment?.status === "running") return "enrichment";
  if (stages.discipline_classifier?.status === "running") return "classifier";
  if (
    (stages.enrichment?.status === "pending" || !stages.enrichment?.status) &&
    (stages.discipline_classifier?.status === "completed" ||
      stages.discipline_classifier?.status === "completed_with_warnings")
  ) {
    return "enrichment";
  }
  if (
    (stages.auto_routing?.status === "pending" || !stages.auto_routing?.status) &&
    (stages.enrichment?.status === "completed" ||
      stages.enrichment?.status === "completed_with_warnings")
  ) {
    return "router";
  }
  if (stages.comment_parser?.status === "running") return "intake";
  return "intake";
}

async function logChainFailure(
  projectId: string,
  agentName: string,
  errorMsg: string,
) {
  try {
    await supabase.functions.invoke("shadow-evaluator", {
      body: {
        action: "log_failure",
        project_id: projectId,
        agent_name: agentName,
        error_message: errorMsg,
      },
    });
  } catch (e) {
    console.error(`Failed to log chain failure for ${agentName}:`, e);
  }
}

export function AgentWorkflowStatus() {
  const { user, session } = useAuth();
  const navigate = useNavigate();
  const { selectedProjectId } = useSelectedProject();
  const queryClient = useQueryClient();
  const scrape = useScrape();

  const [portalStatus, setPortalStatus] = useState<StepStatus>("idle");
  const [portalStatusText, setPortalStatusText] = useState<string | null>(null);
  const [pipelineResult, setPipelineResult] = useState<PipelineResult | null>(
    null,
  );
  const [parserRunning, setParserRunning] = useState(false);
  const [parserProgress, setParserProgress] = useState<{
    pdfIndex: number;
    totalPdfs: number;
  } | null>(null);
  const [latestProjectId, setLatestProjectId] = useState<string | null>(null);
  const [latestPermitNumber, setLatestPermitNumber] = useState<string | null>(
    null,
  );
  const [projectBySelectedId, setProjectBySelectedId] = useState<{
    id: string;
    permit_number: string | null;
    jurisdiction: string | null;
    credential_id: string | null;
    portal_data: unknown;
  } | null>(null);

  const [chainPhase, setChainPhase] = useState<ChainPhase>("idle");
  const [chainError, setChainError] = useState<string | null>(null);
  const [isShadowMode, setIsShadowMode] = useState(false);
  const realtimeTriggeredRef = useRef(false);
  const scrapeEnqueuePendingRef = useRef(false);
  const pipelineTriggerInFlightRef = useRef(false);
  const pipelineResumeAttemptedRef = useRef<string | null>(null);
  const chainPipelineRef = useRef<
    ((projectId: string, opts?: { pipelineRunId?: string; resumePipeline?: boolean }) => Promise<void>) | null
  >(null);

  const [enrichmentRunning, setEnrichmentRunning] = useState(false);
  const [enrichmentResult, setEnrichmentResult] = useState<number | null>(null);
  const [routerRunning, setRouterRunning] = useState(false);
  const [routerResult, setRouterResult] = useState<number | null>(null);

  const { data: latestPipelineRun } = useQuery({
    queryKey: ["project_pipeline_run", selectedProjectId],
    queryFn: async () => {
      if (!selectedProjectId) return null;
      const { data, error } = await supabase
        .from("project_pipeline_runs")
        .select("id, status, current_stage, stages, error_message, started_at, completed_at")
        .eq("project_id", selectedProjectId)
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) return null;
      return data;
    },
    enabled: !!selectedProjectId,
    refetchInterval: chainPhase !== "idle" && chainPhase !== "complete" ? 3000 : false,
  });

  useEffect(() => {
    const projectId = projectBySelectedId?.id ?? latestProjectId;
    if (!projectId) return;

    realtimeTriggeredRef.current = false;

    const channel = supabase
      .channel(`project-portal-${projectId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "projects",
          filter: `id=eq.${projectId}`,
        },
        (payload) => {
          const oldHash = (payload.old as Record<string, unknown>)?.portal_data_hash;
          const newHash = (payload.new as Record<string, unknown>)?.portal_data_hash;

          if (newHash && oldHash !== newHash && !realtimeTriggeredRef.current) {
            if (pipelineTriggerInFlightRef.current) {
              console.log("[Realtime] pipeline already in flight — skipping duplicate trigger");
              return;
            }
            realtimeTriggeredRef.current = true;
            console.log("[Realtime] portal_data changed, auto-triggering chain for project:", projectId);
            toast.info("Portal data updated — auto-triggering agent chain...");
            loadDashboardData()
              .then(() => {
                if (chainPipelineRef.current) {
                  return chainPipelineRef.current(projectId);
                }
              })
              .catch((err) => {
                console.error("[Realtime] chain trigger failed:", err);
                toast.error("Auto-triggered chain failed. Try running manually.");
              })
              .finally(() => {
                realtimeTriggeredRef.current = false;
              });
          }
        },
      )
      .subscribe();

    return () => {
      realtimeTriggeredRef.current = false;
      supabase.removeChannel(channel);
    };
  }, [projectBySelectedId?.id, latestProjectId]);

  useEffect(() => {
    const jobStatus = scrape.scrapeJobStatus;
    const hasDurableJob = Boolean(scrape.activeJobId);

    if (hasDurableJob && jobStatus) {
      if (jobStatus === "cancelled") {
        setPortalStatus("idle");
        setPortalStatusText("Cancelled");
        return;
      }
      const step = durableScrapePortalStepStatus(jobStatus, true);
      setPortalStatus(step);
      setPortalStatusText(
        durableScrapePortalLabel(jobStatus, scrape.scrapeLiveMessage),
      );
      return;
    }

    if (scrape.isScraping) {
      setPortalStatus("checking");
      if (scrape.scrapeLiveMessage) {
        setPortalStatusText(scrape.scrapeLiveMessage);
      }
    } else if (
      scrape.scrapeJobStatus === "completed" ||
      scrape.scrapeJobStatus === "completed_with_warnings" ||
      scrape.scrapeJobStatus === "partial_external_blocker"
    ) {
      setPortalStatus("done");
      setPortalStatusText("Done");
    } else if (scrape.scrapeJobStatus === "waiting_user") {
      setPortalStatus("checking");
      setPortalStatusText(scrape.scrapeLiveMessage || "Waiting for user action");
    }
  }, [
    scrape.isScraping,
    scrape.scrapeLiveMessage,
    scrape.scrapeJobStatus,
    scrape.activeJobId,
  ]);

  const cp = pipelineResult?.comment_parser;
  const dc = pipelineResult?.discipline_classifier;
  const persistedStages = latestPipelineRun?.stages as
    | Record<string, { status?: string }>
    | undefined;
  const parserSucceeded =
    (cp != null && !cp.error && cp.done === true) ||
    persistedStages?.comment_parser?.status === "completed";
  const commentParserFailed =
    (cp != null && !!cp.error) ||
    persistedStages?.comment_parser?.status === "failed";
  const classifierDone =
    (dc != null && !dc.error) ||
    persistedStages?.discipline_classifier?.status === "completed" ||
    persistedStages?.discipline_classifier?.status === "completed_with_warnings";
  const classifierFailed =
    (dc != null && !!dc.error) ||
    persistedStages?.discipline_classifier?.status === "failed";

  const commentParserStatus: StepStatus =
    chainPhase === "intake"
      ? "checking"
      : commentParserFailed
        ? "failed"
        : parserRunning
          ? "checking"
          : parserSucceeded
            ? "done"
            : "waiting";

  const commentParserDescription =
    chainPhase === "intake"
      ? "Running (chained)..."
      : commentParserFailed
        ? "Failed"
        : parserRunning && parserProgress
          ? `Running... PDF ${parserProgress.pdfIndex}/${parserProgress.totalPdfs}`
          : parserSucceeded
            ? cp && (cp.parsed_count ?? 0) > 0
              ? `Complete (${cp.parsed_count} parsed / ${cp.skipped_count ?? 0} skipped)`
              : "Complete (No comments found)"
            : "Waiting for Doc";

  const rawClassifierStatus: StepStatus =
    chainPhase === "classifier"
      ? "checking"
      : classifierFailed
        ? "failed"
        : classifierDone
          ? "done"
          : "pending";

  const classifierStatus: StepStatus =
    commentParserStatus !== "done" && rawClassifierStatus === "done"
      ? "pending"
      : commentParserStatus !== "done" && rawClassifierStatus === "checking" && chainPhase !== "classifier"
        ? "pending"
        : rawClassifierStatus;

  useEffect(() => {
    if (!latestPipelineRun?.stages || chainPhase !== "idle") return;
    const stages = latestPipelineRun.stages as Record<string, { status?: string; parsed_count?: number; classified_count?: number; enriched_count?: number; routed_count?: number }>;
    if (stages.comment_parser?.status === "completed" || stages.comment_parser?.status === "failed") {
      setPipelineResult((prev) => ({
        ...prev,
        comment_parser: {
          done: stages.comment_parser?.status === "completed",
          parsed_count: stages.comment_parser?.parsed_count,
          error: stages.comment_parser?.status === "failed" ? latestPipelineRun.error_message ?? "failed" : undefined,
        },
        discipline_classifier: stages.discipline_classifier
          ? { classified_count: stages.discipline_classifier.classified_count, error: stages.discipline_classifier.status === "failed" ? stages.discipline_classifier.error : undefined }
          : prev?.discipline_classifier,
      }));
    }
    if (stages.enrichment?.enriched_count != null) {
      setEnrichmentResult(stages.enrichment.enriched_count);
    }
    if (stages.auto_routing?.routed_count != null) {
      setRouterResult(stages.auto_routing.routed_count);
    }
    if (
      latestPipelineRun.status === "completed" ||
      latestPipelineRun.status === "completed_with_warnings"
    ) {
      setChainPhase("complete");
    }
  }, [latestPipelineRun, chainPhase]);

  const { data: commentsForEnrichmentCheck } = useQuery({
    queryKey: ["parsed_comments_code_ref_check", selectedProjectId],
    queryFn: async (): Promise<
      { id: string; code_reference: string | null }[]
    > => {
      if (!selectedProjectId) return [];
      const { data, error } = await supabase
        .from("parsed_comments")
        .select("id, code_reference")
        .eq("project_id", selectedProjectId);
      if (error) return [];
      return (data ?? []) as { id: string; code_reference: string | null }[];
    },
    enabled: !!selectedProjectId,
  });

  const allCommentsHaveCodeRef =
    (commentsForEnrichmentCheck?.length ?? 0) > 0 &&
    (commentsForEnrichmentCheck ?? []).every(
      (r) => (r.code_reference ?? "").trim().length > 0,
    );

  const rawEnrichmentStatus: StepStatus =
    chainPhase === "enrichment"
      ? "checking"
      : persistedStages?.enrichment?.status === "completed" ||
          persistedStages?.enrichment?.status === "completed_with_warnings"
        ? "done"
        : allCommentsHaveCodeRef
          ? "done"
          : enrichmentRunning
            ? "checking"
            : enrichmentResult != null
              ? "done"
              : "pending";

  const enrichmentStatus: StepStatus =
    classifierStatus !== "done" && (rawEnrichmentStatus === "done" || (rawEnrichmentStatus === "checking" && chainPhase !== "enrichment"))
      ? "pending"
      : rawEnrichmentStatus;

  const enrichmentDescription =
    enrichmentStatus === "pending" && rawEnrichmentStatus !== "pending"
      ? "Waiting for upstream steps"
      : chainPhase === "enrichment"
        ? "Running (chained)..."
        : allCommentsHaveCodeRef && enrichmentStatus === "done"
          ? "Complete (all have code refs)"
          : enrichmentRunning && enrichmentStatus === "checking"
            ? "Running..."
            : enrichmentResult != null && enrichmentStatus === "done"
              ? `Done (${enrichmentResult} enriched)`
              : "Enriches comments with code references and draft responses";

  const runEnrichment = useCallback(async () => {
    const projectIdToUse =
      selectedProjectId ?? projectBySelectedId?.id ?? latestProjectId;
    if (!projectIdToUse || !session?.access_token) {
      toast.error("Select a project and ensure you are logged in.");
      return;
    }
    setEnrichmentRunning(true);
    setEnrichmentResult(null);
    try {
      const { data, error } = await supabase.functions.invoke("intake-pipeline-agent", {
        body: {
          project_id: projectIdToUse,
          run_enrichment_only: true,
          force_retry: true,
        },
      });
      if (error) throw error;
      const count = (data as { enrichment?: { enriched_count?: number } })?.enrichment?.enriched_count ?? 0;
      setEnrichmentResult(count);
      await queryClient.invalidateQueries({ queryKey: ["parsed_comments"] });
      await queryClient.invalidateQueries({ queryKey: ["parsed_comments_code_ref_check"] });
      await queryClient.invalidateQueries({ queryKey: ["project_pipeline_run", projectIdToUse] });
      toast.success(`${count} comment(s) enriched`);
    } catch (e) {
      console.warn("Context reference engine failed:", e);
      toast.error("Enrichment failed");
    } finally {
      setEnrichmentRunning(false);
    }
  }, [
    selectedProjectId,
    projectBySelectedId?.id,
    latestProjectId,
    session?.access_token,
    queryClient,
  ]);

  const { data: commentsForRouterCheck } = useQuery({
    queryKey: ["parsed_comments_assigned_check", selectedProjectId],
    queryFn: async (): Promise<
      { id: string; assigned_to: string | null }[]
    > => {
      if (!selectedProjectId) return [];
      const { data, error } = await supabase
        .from("parsed_comments")
        .select("id, assigned_to")
        .eq("project_id", selectedProjectId);
      if (error) return [];
      return (data ?? []) as { id: string; assigned_to: string | null }[];
    },
    enabled: !!selectedProjectId,
  });

  const allCommentsHaveAssigned =
    (commentsForRouterCheck?.length ?? 0) > 0 &&
    (commentsForRouterCheck ?? []).every(
      (r) => (r.assigned_to ?? "").trim().length > 0,
    );

  const rawRouterStatus: StepStatus =
    chainPhase === "router"
      ? "checking"
      : persistedStages?.auto_routing?.status === "completed"
        ? "done"
        : allCommentsHaveAssigned
          ? "done"
          : routerRunning
            ? "checking"
            : routerResult != null
              ? "done"
              : "pending";

  const routerStatus: StepStatus =
    enrichmentStatus !== "done" && (rawRouterStatus === "done" || (rawRouterStatus === "checking" && chainPhase !== "router"))
      ? "pending"
      : rawRouterStatus;

  const routerDescription =
    routerStatus === "pending" && rawRouterStatus !== "pending"
      ? "Waiting for upstream steps"
      : chainPhase === "router"
        ? "Running (chained)..."
        : allCommentsHaveAssigned && routerStatus === "done"
          ? "Complete (all assigned)"
          : routerRunning && routerStatus === "checking"
            ? "Running..."
            : routerResult != null && routerStatus === "done"
              ? `Done (${routerResult} routed)`
              : "Assigns comments to team members by discipline";

  const runAutoRoute = useCallback(async () => {
    const projectIdToUse =
      selectedProjectId ?? projectBySelectedId?.id ?? latestProjectId;
    if (!projectIdToUse || !session?.access_token) {
      toast.error("Select a project and ensure you are logged in.");
      return;
    }
    setRouterRunning(true);
    setRouterResult(null);
    try {
      const { data, error } = await supabase.functions.invoke("intake-pipeline-agent", {
        body: {
          project_id: projectIdToUse,
          run_routing_only: true,
          force_retry: true,
        },
      });
      if (error) throw error;
      const count = (data as { auto_routing?: { routed_count?: number } })?.auto_routing?.routed_count ?? 0;
      setRouterResult(count);
      await queryClient.invalidateQueries({ queryKey: ["parsed_comments"] });
      await queryClient.invalidateQueries({ queryKey: ["parsed_comments_assigned_check"] });
      await queryClient.invalidateQueries({ queryKey: ["project_pipeline_run", projectIdToUse] });
      toast.success(`${count} comment(s) routed`);
    } catch (e) {
      console.warn("Auto-router agent failed:", e);
      toast.error("Auto-route failed");
    } finally {
      setRouterRunning(false);
    }
  }, [
    selectedProjectId,
    projectBySelectedId?.id,
    latestProjectId,
    session?.access_token,
    queryClient,
  ]);

  const classifierDescription =
    classifierStatus === "pending" && rawClassifierStatus === "done"
      ? "Waiting for upstream steps"
      : chainPhase === "classifier"
        ? "Running (chained)..."
        : classifierFailed
          ? "Failed"
          : classifierDone && classifierStatus === "done"
            ? dc && (dc.classified_count ?? 0) > 0
              ? `Complete (${dc.classified_count} classified)`
              : "Complete (Nothing new to classify)"
            : "Pending";

  const loadDashboardData = useCallback(async () => {
    if (!user) return;

    const { data: project } = await supabase
      .from("projects")
      .select("id, portal_status, permit_number")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (project) {
      setLatestProjectId(project.id as string);
      setLatestPermitNumber((project.permit_number as string) ?? null);
      if (project.portal_status) {
        setPortalStatusText(project.portal_status as string);
      }
    }

    if (selectedProjectId) {
      const { data: sel } = await supabase
        .from("projects")
        .select("id, permit_number, jurisdiction, credential_id, portal_data")
        .eq("id", selectedProjectId)
        .eq("user_id", user.id)
        .maybeSingle();
      setProjectBySelectedId(
        sel
          ? {
              id: sel.id as string,
              permit_number: (sel.permit_number as string) ?? null,
              jurisdiction: (sel.jurisdiction as string) ?? null,
              credential_id: (sel.credential_id as string) ?? null,
              portal_data: sel.portal_data ?? null,
            }
          : null,
      );
    } else {
      setProjectBySelectedId(null);
    }
  }, [user, selectedProjectId]);

  useEffect(() => {
    loadDashboardData();
  }, [loadDashboardData]);

  const { data: linkedPortalCredential } = useQuery({
    queryKey: ["sidebar_portal_credential", selectedProjectId, user?.id],
    enabled: !!selectedProjectId && !!user?.id,
    queryFn: async () => {
      const { data: proj, error: projErr } = await supabase
        .from("projects")
        .select("credential_id")
        .eq("id", selectedProjectId!)
        .eq("user_id", user!.id)
        .maybeSingle();
      if (projErr || !proj?.credential_id) return null;
      const { data: cred, error: credErr } = await supabase
        .from("portal_credentials")
        .select("id, login_url, jurisdiction")
        .eq("id", proj.credential_id as string)
        .eq("user_id", user!.id)
        .maybeSingle();
      if (credErr) return null;
      return cred;
    },
  });

  const isPgcEplanCred = isPgcEplanPortalCredential(
    linkedPortalCredential ?? null,
  );
  const isMontgomeryCred = isMontgomeryProjectDoxPortalCredential(
    linkedPortalCredential ?? null,
  );
  const isHowardCred = isHowardProjectDoxPortalCredential(
    linkedPortalCredential ?? null,
  );
  const isWashingtonProjectDoxCred = isWashingtonStyleProjectDoxCredential(
    linkedPortalCredential ?? null,
  );
  const isBaltimoreCred = isBaltimorePortal(linkedPortalCredential ?? null);
  const isFairfaxCred = isFairfaxPortal(linkedPortalCredential ?? null);
  const arlingtonPortalContext = useMemo(
    () =>
      isArlingtonPortalContext({
        selectedCredential: linkedPortalCredential ?? null,
        portalUrl: linkedPortalCredential?.login_url ?? null,
        portalType: "accela",
        portalData: projectBySelectedId?.portal_data ?? null,
        project: projectBySelectedId,
      }),
    [linkedPortalCredential, projectBySelectedId],
  );
  const isArlingtonCred = arlingtonPortalContext.isArlington;
  const isMinimalTabsCred = isBaltimoreCred || isFairfaxCred;

  useEffect(() => {
    if (!isArlingtonCred) return;
    console.log(
      `[ArlingtonUI] scrape options source=Arlington options=${JSON.stringify([...ARLINGTON_SCRAPE_MENU_OPTIONS])}`,
    );
  }, [isArlingtonCred, arlingtonPortalContext.source]);

  const [washingtonScrapeTabs, setWashingtonScrapeTabs] = useState<
    Record<WashingtonTabKey, boolean>
  >({
    info: true,
    status: true,
    tasks: true,
    reports: true,
    files: true,
  });
  const [washingtonFileFolders, setWashingtonFileFolders] = useState<string[]>(
    [],
  );

  const clearWashingtonFileFolders = () => setWashingtonFileFolders([]);

  const [baltimoreScrapeTabs, setBaltimoreScrapeTabs] = useState<
    Record<BaltimoreTabKey, boolean>
  >({
    info: true,
    attachments: true,
  });

  const [fairfaxScrapeTabs, setFairfaxScrapeTabs] = useState<
    Record<FairfaxTabKey, boolean>
  >({
    info: true,
    attachments: true,
  });

  const getBaltimoreScrapeOptions = () => {
    const allKeys = BALTIMORE_SCRAPE_TAB_DEFS.map((t) => t.key);
    const picked = allKeys.filter((k) => baltimoreScrapeTabs[k]);
    const tabsPayload = picked.length > 0 ? picked : allKeys;
    return { tabs: tabsPayload as string[] };
  };

  const getFairfaxScrapeOptions = () => {
    const allKeys = FAIRFAX_SCRAPE_TAB_DEFS.map((t) => t.key);
    const picked = allKeys.filter((k) => fairfaxScrapeTabs[k]);
    const tabsPayload = picked.length > 0 ? picked : allKeys;
    return { tabs: tabsPayload as string[] };
  };

  const getWashingtonScrapeOptions = () => {
    const allKeys = WASHINGTON_SCRAPE_TAB_DEFS.map((t) => t.key);
    const picked = allKeys.filter((k) => washingtonScrapeTabs[k]);
    const tabsPayload = picked.length > 0 ? picked : allKeys;
    const targetFolders =
      tabsPayload.includes("files") && washingtonFileFolders.length > 0
        ? washingtonFileFolders
        : undefined;
    return { tabs: tabsPayload, targetFolders };
  };

  const runChainedPipeline = useCallback(
    async (
      projectId: string,
      opts?: { pipelineRunId?: string; resumePipeline?: boolean },
    ) => {
      if (pipelineTriggerInFlightRef.current) {
        console.log("[CHAIN DEBUG] pipeline already in flight — skipping duplicate trigger");
        return;
      }
      pipelineTriggerInFlightRef.current = true;
      console.log("[CHAIN DEBUG] runChainedPipeline called with projectId:", projectId, opts);
      setChainError(null);

      const { data: projectRow, error: projectRowErr } = await supabase
        .from("projects")
        .select("is_shadow_mode, portal_data, portal_data_hash")
        .eq("id", projectId)
        .maybeSingle();

      if (projectRowErr) {
        console.error("[CHAIN DEBUG] Failed to fetch project row:", projectRowErr.message);
      }

      const portalData = projectRow?.portal_data as Record<string, unknown> | null;
      const portalDataHash = (projectRow?.portal_data_hash as string | undefined) ?? undefined;
      const pdfs = (portalData?.tabs as Record<string, unknown>)?.reports as Record<string, unknown>;
      const pdfCount = Array.isArray(pdfs?.pdfs) ? pdfs.pdfs.length : 0;
      const reviewCommentPdfs = Array.isArray(pdfs?.pdfs)
        ? (pdfs.pdfs as { fileName?: string; text?: string }[]).filter(
            (p) => p.fileName?.toLowerCase().includes("review comments") && p.text && p.text.trim().length > 0
          )
        : [];
      console.log("[CHAIN DEBUG] portal_data check — total PDFs:", pdfCount, "review comment PDFs:", reviewCommentPdfs.length,
        reviewCommentPdfs.map(p => `${p.fileName} (${p.text?.length ?? 0} chars)`));
      if (reviewCommentPdfs.length === 0) {
        console.warn("[CHAIN DEBUG] ⚠️ No 'Review Comments' PDFs found in portal_data — comment parser will return 0 parsed");
      }

      const shadowActive = projectRow?.is_shadow_mode === true;
      setIsShadowMode(shadowActive);

      const isResume = opts?.resumePipeline === true;
      if (!isResume) {
        setChainPhase("intake");
        toast.info("Running post-scrape pipeline...");
      }
      setParserRunning(true);
      setParserProgress(null);
      setEnrichmentRunning(false);
      setRouterRunning(false);

      let cursor: { pdfIndex: number } | undefined;
      const pollIntervalMs = 2500;
      const maxRounds = 120;
      let round = 0;
      let pipelineRunId: string | undefined = opts?.pipelineRunId;
      let intakeFailed = false;
      let nextAction = "poll_again";

      try {
        while (round < maxRounds) {
          console.log("[CHAIN DEBUG] Intake round:", round, "cursor:", cursor, "pipeline_run_id:", pipelineRunId);
          const { data: pipelineData, error: pipelineError } =
            await supabase.functions.invoke("intake-pipeline-agent", {
              body: {
                project_id: projectId,
                is_shadow_mode: shadowActive,
                ...(portalDataHash ? { portal_data_hash: portalDataHash } : {}),
                ...(pipelineRunId ? { pipeline_run_id: pipelineRunId } : {}),
                ...(isResume && round === 0 ? { resume_pipeline: true } : {}),
                ...(!cursor && !pipelineRunId ? { full_refresh: true } : {}),
                ...(cursor && { cursor }),
              },
            });

          if (pipelineError) {
            intakeFailed = true;
            const errMsg =
              typeof pipelineError === "string"
                ? pipelineError
                : pipelineError?.message ?? "Unknown intake error";
            setChainError(`Intake: ${errMsg}`);
            await logChainFailure(projectId, "intake-pipeline-agent", errMsg);
            break;
          }
          if (pipelineData == null) break;

          pipelineRunId = (pipelineData.pipeline_run_id as string | undefined) ?? pipelineRunId;
          nextAction = (pipelineData.next_action as string | undefined) ?? "poll_again";

          const cpData = pipelineData.comment_parser;
          const dcData = pipelineData.discipline_classifier;
          const enrichData = pipelineData.enrichment as
            | { enriched_count?: number; error?: string; status?: string }
            | undefined;
          const routeData = pipelineData.auto_routing as
            | { routed_count?: number; error?: string; status?: string }
            | undefined;
          const stages = pipelineData.stages as Record<string, { status?: string }> | undefined;

          setPipelineResult({
            comment_parser: cpData,
            discipline_classifier: dcData,
          });

          const phase = syncChainPhaseFromStages(stages, nextAction);
          setChainPhase(phase);
          setParserRunning(phase === "intake");
          setEnrichmentRunning(phase === "enrichment");
          setRouterRunning(phase === "router");

          if (enrichData?.enriched_count != null) {
            setEnrichmentResult(enrichData.enriched_count);
          }
          if (routeData?.routed_count != null) {
            setRouterResult(routeData.routed_count);
          }

          if (
            cpData?.total_pdfs != null &&
            (cpData.next_cursor?.pdfIndex ?? 0) >= 0
          ) {
            setParserProgress({
              pdfIndex: cpData.next_cursor?.pdfIndex ?? 0,
              totalPdfs: cpData.total_pdfs,
            });
          }

          await queryClient.invalidateQueries({
            queryKey: ["project_pipeline_run", projectId],
          });

          if (nextAction === "complete") {
            await queryClient.invalidateQueries({ queryKey: ["parsed_comments"] });
            await queryClient.invalidateQueries({ queryKey: ["parsed_comments_code_ref_check"] });
            await queryClient.invalidateQueries({ queryKey: ["parsed_comments_assigned_check"] });
            const parsed = (cpData?.parsed_count as number | undefined) ?? 0;
            const classified = (dcData?.classified_count as number | undefined) ?? 0;
            const enriched = (enrichData?.enriched_count as number | undefined) ?? 0;
            const routed = (routeData?.routed_count as number | undefined) ?? 0;
            toast.success(
              `Pipeline complete: ${parsed} parsed, ${classified} classified, ${enriched} enriched, ${routed} routed.`,
            );
            setChainPhase("complete");
            break;
          }

          if (
            nextAction === "retry_parser" ||
            nextAction === "retry_classifier" ||
            nextAction === "retry_enrichment" ||
            nextAction === "retry_routing"
          ) {
            intakeFailed = true;
            const stageErr =
              cpData?.error ??
              dcData?.error ??
              enrichData?.error ??
              routeData?.error ??
              nextAction;
            setChainError(stageErr as string);
            await logChainFailure(projectId, "intake-pipeline-agent", String(stageErr));
            break;
          }

          if (nextAction === "stale_run") {
            intakeFailed = true;
            setChainError("A newer portal scrape superseded this pipeline run.");
            break;
          }

          if (nextAction === "poll_again") {
            if (cpData?.error === "timeout" || (cpData?.next_cursor != null && !cpData?.done)) {
              cursor = cpData?.error === "timeout" ? undefined : cpData.next_cursor;
            } else {
              cursor = undefined;
            }
            await new Promise((r) => setTimeout(r, pollIntervalMs));
            round++;
            continue;
          }

          console.warn("[CHAIN DEBUG] unknown next_action:", nextAction);
          break;
        }
      } catch (e) {
        intakeFailed = true;
        const errMsg = e instanceof Error ? e.message : String(e);
        setChainError(`Intake: ${errMsg}`);
        await logChainFailure(projectId, "intake-pipeline-agent", errMsg);
      } finally {
        setParserRunning(false);
        setParserProgress(null);
        setEnrichmentRunning(false);
        setRouterRunning(false);
        pipelineTriggerInFlightRef.current = false;
      }

      if (intakeFailed) {
        toast.error("Pipeline stopped due to a stage failure. Error logged.");
        setTimeout(() => setChainPhase("idle"), 8000);
        return;
      }

      if (nextAction === "complete") {
        toast.info("View scraped data on the Portal Data page.", {
          action: {
            label: "View",
            onClick: () => navigate("/portal-data"),
          },
        });
      }
    },
    [queryClient, navigate],
  );

  useEffect(() => {
    chainPipelineRef.current = runChainedPipeline;
  }, [runChainedPipeline]);

  useEffect(() => {
    const run = latestPipelineRun;
    if (!run || run.status !== "running" || !selectedProjectId) return;
    if (pipelineTriggerInFlightRef.current) return;
    if (chainPhase !== "idle") return;
    const runId = `${run.id}`;
    if (pipelineResumeAttemptedRef.current === runId) return;
    pipelineResumeAttemptedRef.current = runId;
    console.log("[CHAIN DEBUG] resuming in-flight pipeline run", runId);
    void runChainedPipeline(selectedProjectId, {
      pipelineRunId: runId,
      resumePipeline: true,
    });
  }, [latestPipelineRun, selectedProjectId, chainPhase, runChainedPipeline]);

  useEffect(() => {
    scrape.onScrapeCompleteRef.current = async (projectId: string) => {
      setPortalStatus("done");
      setPortalStatusText("Done");
      await loadDashboardData();
      await runChainedPipeline(projectId);
    };
    return () => {
      scrape.onScrapeCompleteRef.current = null;
    };
  }, [loadDashboardData, runChainedPipeline, scrape.onScrapeCompleteRef]);

  useEffect(() => {
    if (scrape.pendingCompletionProjectId) {
      const projectId = scrape.pendingCompletionProjectId;
      scrape.clearPendingCompletion();
      setPortalStatus("done");
      setPortalStatusText("Done");
      loadDashboardData().then(() => runChainedPipeline(projectId));
    }
  }, [scrape.pendingCompletionProjectId, scrape.clearPendingCompletion, loadDashboardData, runChainedPipeline]);

  useEffect(() => {
    if (scrape.lastScrapeOutcome && scrape.lastScrapeOutcome !== "done") {
      scrape.clearLastScrapeOutcome();
      setPortalStatus("idle");
      setPortalStatusText("");
      setChainPhase("idle");
    }
  }, [scrape.lastScrapeOutcome, scrape.clearLastScrapeOutcome]);

  const runManualCheck = async (
    scrapeMode: ScrapeModeParam = isPgcEplanCred
      ? "scrape_without_files"
      : isMontgomeryCred
        ? "montgomery_quick"
        : isHowardCred
          ? "howard_quick"
          : "standard",
    washingtonOpts?: { tabs: string[]; targetFolders?: string[] },
    baltimoreOpts?: { tabs: string[] },
    fairfaxOpts?: { tabs: string[] },
    arlingtonOpts?: ArlingtonScrapeTabOpts,
    runOpts?: { arlingtonPortalMonitor?: boolean },
  ) => {
    // Selected project UUID is source of truth — never fall back to another
    // project's permit (e.g. latest Washington B2606607) after a project switch.
    const submitFields = resolveQuickScrapeSubmitFields({
      selectedProjectId,
      selectedProject: projectBySelectedId,
    });

    if (!submitFields.ok) {
      if (submitFields.reason === "no_project" || submitFields.reason === "project_mismatch") {
        toast.error(
          "No project found. Select a project in the header Active Project control or create one first.",
        );
      } else if (submitFields.reason === "missing_permit") {
        toast.error(
          "Permit / Application # is required. Set it on the project (Edit Project or header Active Project), then try again.",
        );
      } else {
        toast.error(
          "No portal credential linked to this project. Select a credential in the header Active Project control (or Edit Project), then try again.",
        );
      }
      return;
    }

    const projectIdToUse = submitFields.projectId;
    const permitNumberToUse = submitFields.permitNumber;
    const credentialId = submitFields.credentialId;

    if (!session?.access_token) {
      toast.error("You must be logged in to run this check.");
      return;
    }

    if (scrapeEnqueuePendingRef.current) {
      toast.info("Scrape request already in progress.");
      return;
    }

    setChainPhase("scraping");
    setChainError(null);
    setPipelineResult(null);
    setEnrichmentResult(null);
    setRouterResult(null);
    setPortalStatus("checking");
    setPortalStatusText("Connecting...");

    try {
      const { data: credRow } = await supabase
        .from("portal_credentials")
        .select("login_url")
        .eq("id", credentialId)
        .eq("user_id", user!.id)
        .maybeSingle();

      const loginUrl = String(credRow?.login_url ?? "").trim();

      if (!loginUrl) {
        throw new Error(
          `Missing Portal URL for this credential. Please update Settings.`,
        );
      }

      const useArlingtonCustomTabsEarly =
        isArlingtonCred &&
        !!arlingtonOpts?.tabs &&
        arlingtonOpts.tabs.length > 0;

      const arlingtonPortalMonitor =
        runOpts?.arlingtonPortalMonitor === true &&
        useArlingtonCustomTabsEarly;

      const resolveAccelaSessionForProject = (projId: string): string | null => {
        const fromState = `${scrape.accelaSessionId || ""}`.trim();
        if (fromState) return fromState;
        const persisted = getPersistedAccelaSessionForProject(projId);
        if (persisted?.sessionId) return persisted.sessionId;
        const legacyActive = `${scrape.activeSessionId || ""}`.trim();
        if (legacyActive) return legacyActive;
        const legacyScrape = getPersistedScrapeSessionForProject(projId, user?.id);
        if (legacyScrape?.sessionId) return legacyScrape.sessionId;
        return null;
      };

      const useWashingtonCustomTabs =
        isWashingtonProjectDoxCred &&
        !!washingtonOpts?.tabs &&
        washingtonOpts.tabs.length > 0;

      const useBaltimoreCustomTabs =
        isBaltimoreCred &&
        !!baltimoreOpts?.tabs &&
        baltimoreOpts.tabs.length > 0;

      const useFairfaxCustomTabs =
        isFairfaxCred &&
        !!fairfaxOpts?.tabs &&
        fairfaxOpts.tabs.length > 0;

      const useArlingtonCustomTabs =
        isArlingtonCred &&
        !!arlingtonOpts?.tabs &&
        arlingtonOpts.tabs.length > 0;

      if (useArlingtonCustomTabs) {
        if (scrape.isScraping && scrape.activeJobId) {
          toast.info("Scrape already running for this project.");
          setChainPhase("idle");
          setPortalStatus("checking");
          setPortalStatusText(scrape.scrapeLiveMessage || "Scrape in progress");
          return;
        }
      }

      const maxAttempts = arlingtonPortalMonitor ? 2 : 1;
      let scrapeStarted = false;

      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const forceFreshLogin = attempt > 0;

        if (forceFreshLogin) {
          console.info(
            "[Arlington][AccelaSession] stale session detected; clearing and re-login",
          );
          scrape.clearAccelaBrowserSession(projectIdToUse);
        }

        let sessionId: string | null = null;
        if (useArlingtonCustomTabsEarly && !forceFreshLogin) {
          sessionId = resolveAccelaSessionForProject(projectIdToUse);
        }

        if (!sessionId) {
          setPortalStatusText(
            forceFreshLogin ? "Reconnecting to portal..." : "Logging into portal...",
          );

          let loginRes: Response;
          try {
            loginRes = await fetch(`${SCRAPER_URL}/api/login`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${session.access_token}`,
              },
              body: JSON.stringify({ credentialId, portalUrl: loginUrl }),
            });
          } catch {
            throw new Error("SCRAPER_OFFLINE");
          }

          if (!loginRes.ok) {
            const errData = await loginRes.json().catch(() => ({}));
            throw new Error(
              errData.error || `Scraper login failed (${loginRes.status})`,
            );
          }

          const loginData = (await loginRes.json()) as { sessionId?: string };
          sessionId = loginData.sessionId ? String(loginData.sessionId).trim() : "";
          if (!sessionId) {
            throw new Error(
              "Login succeeded but response had no sessionId — cannot start scrape.",
            );
          }
        } else {
          setPortalStatusText("Using active portal session...");
        }

        scrape.setAccelaSessionId(sessionId, {
          projectId: projectIdToUse,
          permitNumber: String(permitNumberToUse).trim(),
        });

        const scrapeBody: Record<string, unknown> = {
          ...buildQuickScrapeRequestIdentity({
            sessionId,
            userId: user!.id,
            projectId: projectIdToUse,
            permitNumber: permitNumberToUse,
          }),
        };

        if (useArlingtonCustomTabs) {
          scrapeBody.tabs = arlingtonOpts!.tabs;
          if (arlingtonOpts!.planReviewScope) {
            scrapeBody.planReviewScope = arlingtonOpts!.planReviewScope;
          }
          if (arlingtonOpts!.autoContinueDownloads != null) {
            scrapeBody.autoContinueDownloads = arlingtonOpts!.autoContinueDownloads;
          }
        } else if (useBaltimoreCustomTabs) {
          scrapeBody.tabs = baltimoreOpts!.tabs;
        } else if (useFairfaxCustomTabs) {
          scrapeBody.tabs = fairfaxOpts!.tabs;
        } else if (useWashingtonCustomTabs) {
          scrapeBody.tabs = washingtonOpts!.tabs;
          if (
            washingtonOpts!.tabs.includes("files") &&
            washingtonOpts!.targetFolders &&
            washingtonOpts!.targetFolders.length > 0
          ) {
            scrapeBody.targetFolders = washingtonOpts!.targetFolders;
          }
        } else {
          scrapeBody.scrapeMode = scrapeMode;
        }

        if (forceFreshLogin) {
          console.info(
            `[Arlington][AccelaSession] retrying scrape with fresh sessionId=${String(sessionId).slice(0, 8)}`,
          );
        }

        console.info("[portal chain] login OK; calling /api/scrape", {
          sessionIdPrefix: String(sessionId).slice(0, 12),
          projectId: projectIdToUse,
          permit: String(permitNumberToUse).trim(),
          tabs: scrapeBody.tabs ?? "(default scrapeMode)",
        });

        scrapeEnqueuePendingRef.current = true;
        const scrapeRes = await fetch(`${SCRAPER_URL}/api/scrape`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(scrapeBody),
        });

        if (!scrapeRes.ok) {
          const errData = await scrapeRes.json().catch(() => ({}));
          const errMsg = String(errData.error || "Failed to start scrape").trim();
          if (
            arlingtonPortalMonitor &&
            attempt === 0 &&
            isArlingtonAccelaStaleSessionScrapeError(errMsg)
          ) {
            continue;
          }
          throw new Error(errMsg);
        }

        const scrapePayload = (await scrapeRes.json().catch(() => ({}))) as {
          jobId?: string | null;
          reusedExistingJob?: boolean;
          runIntent?: string;
          queuePosition?: number;
          currentlyRunningJobId?: string | null;
        };

        if (scrapePayload.currentlyRunningJobId) {
          setPortalStatusText("Your scrape is queued — finishing the current worker cycle first.");
        } else if ((scrapePayload.queuePosition ?? 0) > 0) {
          setPortalStatusText("Your scrape is queued — it will run next.");
        } else if (scrapePayload.reusedExistingJob) {
          setPortalStatusText("Scrape already running — attached to existing job.");
        } else {
          setPortalStatusText("Scraping started");
        }
        scrape.startScrapeSession(
          sessionId,
          projectIdToUse,
          String(permitNumberToUse).trim(),
          scrapePayload.jobId ?? null,
        );
        scrapeStarted = true;
        break;
      }

      if (!scrapeStarted) {
        throw new Error("Failed to start scrape after session recovery.");
      }
    } catch (error) {
      console.error(error);
      scrape.cleanupScrapeState();
      setPortalStatus("idle");
      setPortalStatusText("Error");
      setChainPhase("idle");
      const msg = error instanceof Error ? error.message : String(error);
      const projectId = selectedProjectId ?? projectBySelectedId?.id ?? null;
      if (projectId) {
        await logChainFailure(projectId, "portal-scraper", msg);
      }
      const isOffline =
        msg === "SCRAPER_OFFLINE" ||
        msg.includes("Failed to fetch") ||
        msg.includes("NetworkError") ||
        msg.includes("Network request failed");
      if (isOffline) {
        toast.error(
          "Local Scraper is not running. Run 'node server.js' in the scraper-service folder, then retry.",
        );
      } else {
        toast.error(
          msg
            ? `${msg} Try again or check your connection.`
            : "Something went wrong. Try again.",
        );
      }
    } finally {
      scrapeEnqueuePendingRef.current = false;
    }
  };

  /** Arlington County Accela Portal Monitor — stale session clear + single retry. */
  const runArlingtonPortalMonitorCheck = (arlingtonOpts: ArlingtonScrapeTabOpts) =>
    runManualCheck("standard", undefined, undefined, undefined, arlingtonOpts, {
      arlingtonPortalMonitor: true,
    });

  const runArlingtonScrapeAll = () => {
    const payload = arlingtonScrapeAllOpts();
    console.log("[ArlingtonUI] scrape all request payload=", payload);
    return runArlingtonPortalMonitorCheck(payload);
  };

  const chainRunning = chainPhase !== "idle" && chainPhase !== "complete";

  const steps = [
    {
      title: "Portal Monitor Agent",
      status: portalStatus,
      description:
        portalStatus === "checking"
          ? chainPhase === "scraping"
            ? scrape.scrapeLiveMessage || "Scraping portal…"
            : "Running"
          : portalStatus === "done"
            ? "Complete"
            : portalStatusText
              ? `Status: ${portalStatusText}`
              : "Idle",
      action: (
        <div className="flex flex-col gap-2 mt-2 items-start">
          {portalStatus === "checking" ? (
            <Button
              size="sm"
              variant="destructive"
              onClick={scrape.cancelScrape}
              data-testid="button-cancel-scrape"
              className="transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md active:scale-[0.98]"
            >
              <XCircle className="h-4 w-4 mr-2" />
              Cancel Scrape
            </Button>
          ) : (
            <div className="flex items-center gap-0">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  if (isWashingtonProjectDoxCred) {
                    const o = getWashingtonScrapeOptions();
                    return runManualCheck("standard", {
                      tabs: o.tabs,
                      targetFolders: o.targetFolders,
                    });
                  }
                  if (isArlingtonCred) {
                    return runArlingtonPortalMonitorCheck({ tabs: ["info"] });
                  }
                  if (isBaltimoreCred) {
                    return runManualCheck(
                      "standard",
                      undefined,
                      getBaltimoreScrapeOptions(),
                    );
                  }
                  if (isFairfaxCred) {
                    return runManualCheck(
                      "standard",
                      undefined,
                      undefined,
                      getFairfaxScrapeOptions(),
                    );
                  }
                  return runManualCheck(
                    isPgcEplanCred
                      ? "scrape_without_files"
                      : isMontgomeryCred
                        ? "montgomery_quick"
                        : isHowardCred
                          ? "howard_quick"
                          : "standard",
                  );
                }}
                disabled={chainRunning}
                data-testid="button-run-manual-check"
                className="group/btn transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md active:scale-[0.98] rounded-r-none border-r-0"
              >
                <RefreshCw className="h-4 w-4 mr-2 transition-transform duration-300 group-hover/btn:rotate-180" />
                {chainRunning ? "Chain Running..." : "Quick Scrape"}
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={chainRunning}
                    data-testid="button-scrape-mode-dropdown"
                    className="px-1.5 rounded-l-none transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md active:scale-[0.98]"
                  >
                    <ChevronDown className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  data-testid={
                    isBaltimoreCred
                      ? "baltimore-scrape-tab-picker"
                      : isFairfaxCred
                        ? "fairfax-scrape-tab-picker"
                        : isArlingtonCred
                          ? "arlington-scrape-tab-picker"
                          : isWashingtonProjectDoxCred
                            ? "washington-scrape-tab-picker"
                            : undefined
                  }
                  className={
                    isWashingtonProjectDoxCred ||
                    isMinimalTabsCred ||
                    isArlingtonCred
                      ? "max-h-[min(80vh,22rem)] w-[min(100vw-2rem,17rem)] overflow-y-auto"
                      : undefined
                  }
                >
                  {isPgcEplanCred ? (
                    <>
                      <DropdownMenuItem
                        onClick={() => runManualCheck("scrape_without_files")}
                        data-testid="menu-scrape-pgc-without-files"
                      >
                        <RefreshCw className="h-4 w-4 mr-2" />
                        Scrape without files
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => runManualCheck("scrape_files_only")}
                        data-testid="menu-scrape-pgc-files-only"
                      >
                        <FolderOpen className="h-4 w-4 mr-2" />
                        Scrape files only
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => runManualCheck("scrape_comments_only")}
                        data-testid="menu-scrape-pgc-reports-only"
                      >
                        <FileText className="h-4 w-4 mr-2" />
                        Scrape comments only
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => runManualCheck("scrape_review_tab")}
                        data-testid="menu-scrape-pgc-review-tab"
                      >
                        <ClipboardList className="h-4 w-4 mr-2" />
                        Scrape review tab
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => runManualCheck("scrape_all")}
                        data-testid="menu-scrape-pgc-all"
                      >
                        <Layers className="h-4 w-4 mr-2" />
                        Scrape all
                      </DropdownMenuItem>
                    </>
                  ) : isMontgomeryCred ? (
                    <>
                      <DropdownMenuItem
                        onClick={() => runManualCheck("montgomery_quick")}
                        data-testid="menu-scrape-montgomery-quick"
                      >
                        <RefreshCw className="h-4 w-4 mr-2" />
                        Quick Scrape
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() =>
                          runManualCheck("montgomery_without_files")
                        }
                        data-testid="menu-scrape-montgomery-without-files"
                      >
                        <RefreshCw className="h-4 w-4 mr-2" />
                        Scrape without files
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => runManualCheck("montgomery_files_only")}
                        data-testid="menu-scrape-montgomery-files-only"
                      >
                        <FolderOpen className="h-4 w-4 mr-2" />
                        Scrape files only
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() =>
                          runManualCheck("montgomery_reports_only")
                        }
                        data-testid="menu-scrape-montgomery-reports-only"
                      >
                        <FileText className="h-4 w-4 mr-2" />
                        Scrape reports only
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => runManualCheck("montgomery_status_only")}
                        data-testid="menu-scrape-montgomery-status-only"
                      >
                        <ClipboardList className="h-4 w-4 mr-2" />
                        Scrape status only
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => runManualCheck("montgomery_tasks_only")}
                        data-testid="menu-scrape-montgomery-tasks-only"
                      >
                        <Layers className="h-4 w-4 mr-2" />
                        Scrape tasks only
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => runManualCheck("montgomery_info_only")}
                        data-testid="menu-scrape-montgomery-info-only"
                      >
                        <FileText className="h-4 w-4 mr-2" />
                        Scrape info only
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => runManualCheck("montgomery_all")}
                        data-testid="menu-scrape-montgomery-all"
                      >
                        <Layers className="h-4 w-4 mr-2" />
                        Scrape all
                      </DropdownMenuItem>
                    </>
                  ) : isHowardCred ? (
                    <>
                      <DropdownMenuItem
                        onClick={() => runManualCheck("howard_quick")}
                        data-testid="menu-scrape-howard-quick"
                      >
                        <RefreshCw className="h-4 w-4 mr-2" />
                        Quick Scrape
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() =>
                          runManualCheck("howard_without_files")
                        }
                        data-testid="menu-scrape-howard-without-files"
                      >
                        <RefreshCw className="h-4 w-4 mr-2" />
                        Scrape without files
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => runManualCheck("howard_files_only")}
                        data-testid="menu-scrape-howard-files-only"
                      >
                        <FolderOpen className="h-4 w-4 mr-2" />
                        Scrape files only
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() =>
                          runManualCheck("howard_reports_only")
                        }
                        data-testid="menu-scrape-howard-reports-only"
                      >
                        <FileText className="h-4 w-4 mr-2" />
                        Scrape reports only
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() =>
                          runManualCheck("howard_without_reports")
                        }
                        data-testid="menu-scrape-howard-without-reports"
                      >
                        <FileText className="h-4 w-4 mr-2" />
                        Scrape without reports
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => runManualCheck("howard_status_only")}
                        data-testid="menu-scrape-howard-status-only"
                      >
                        <ClipboardList className="h-4 w-4 mr-2" />
                        Scrape status only
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => runManualCheck("howard_tasks_only")}
                        data-testid="menu-scrape-howard-tasks-only"
                      >
                        <Layers className="h-4 w-4 mr-2" />
                        Scrape tasks only
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => runManualCheck("howard_info_only")}
                        data-testid="menu-scrape-howard-info-only"
                      >
                        <FileText className="h-4 w-4 mr-2" />
                        Scrape info only
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => runManualCheck("howard_all")}
                        data-testid="menu-scrape-howard-all"
                      >
                        <Layers className="h-4 w-4 mr-2" />
                        Scrape all
                      </DropdownMenuItem>
                    </>
                  ) : isArlingtonCred ? (
                    <>
                      <DropdownMenuItem
                        disabled={chainRunning}
                        onClick={() => runArlingtonScrapeAll()}
                        data-testid="menu-scrape-arlington-all"
                        title="Record Info, Attachments, and Plan Review (all scopes) with auto-continue downloads."
                      >
                        <Layers className="h-4 w-4 mr-2" />
                        Scrape All
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        disabled={chainRunning}
                        onClick={() =>
                          runArlingtonPortalMonitorCheck({ tabs: ["info"] })
                        }
                        data-testid="menu-scrape-arlington-quick"
                      >
                        <RefreshCw className="h-4 w-4 mr-2" />
                        Quick Scrape (Record Info Only)
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        disabled={chainRunning}
                        onClick={() =>
                          runArlingtonPortalMonitorCheck({ tabs: ["attachments"] })
                        }
                        data-testid="menu-scrape-arlington-attachments"
                      >
                        <FolderOpen className="h-4 w-4 mr-2" />
                        Attachments Only
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        disabled={chainRunning}
                        onClick={() =>
                          runArlingtonPortalMonitorCheck(
                            arlingtonPlanReviewDocumentScrapeOpts("all"),
                          )
                        }
                        data-testid="menu-scrape-arlington-plan-review-complete"
                        title="Includes Plans & Documents, Review Results & Mark-ups, Approved Documents, and Project Information."
                      >
                        <Layers className="h-4 w-4 mr-2" />
                        Plan Review Complete
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        disabled={chainRunning}
                        onClick={() =>
                          runArlingtonPortalMonitorCheck(
                            arlingtonPlanReviewDocumentScrapeOpts("planSet"),
                          )
                        }
                        data-testid="menu-scrape-arlington-pr-plan-set"
                      >
                        <FolderOpen className="h-4 w-4 mr-2" />
                        Plan Review - Plans & Documents
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        disabled={chainRunning}
                        onClick={() =>
                          runArlingtonPortalMonitorCheck(
                            arlingtonPlanReviewDocumentScrapeOpts("reviewResults"),
                          )
                        }
                        data-testid="menu-scrape-arlington-pr-review-results"
                      >
                        <ClipboardList className="h-4 w-4 mr-2" />
                        Plan Review - Review Results & Mark-ups
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        disabled={chainRunning}
                        onClick={() =>
                          runArlingtonPortalMonitorCheck(
                            arlingtonPlanReviewDocumentScrapeOpts("approvedDocuments"),
                          )
                        }
                        data-testid="menu-scrape-arlington-pr-approved"
                      >
                        <FileBox className="h-4 w-4 mr-2" />
                        Plan Review - Approved Documents
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        disabled={chainRunning}
                        onClick={() =>
                          runArlingtonPortalMonitorCheck(
                            arlingtonPlanReviewProjectInformationScrapeOpts(),
                          )
                        }
                        data-testid="menu-scrape-arlington-pr-project-info"
                      >
                        <FileText className="h-4 w-4 mr-2" />
                        Plan Review - Project Information
                      </DropdownMenuItem>
                    </>
                  ) : isMinimalTabsCred ? (
                    <>
                      <DropdownMenuLabel className="text-xs font-normal text-popover-foreground">
                        Tabs
                      </DropdownMenuLabel>
                      {(isBaltimoreCred
                        ? BALTIMORE_SCRAPE_TAB_DEFS
                        : FAIRFAX_SCRAPE_TAB_DEFS
                      ).map(({ key, label }) => (
                        <DropdownMenuCheckboxItem
                          key={key}
                          checked={
                            isBaltimoreCred
                              ? baltimoreScrapeTabs[key]
                              : fairfaxScrapeTabs[key]
                          }
                          onCheckedChange={(c) =>
                            isBaltimoreCred
                              ? setBaltimoreScrapeTabs((prev) => ({
                                  ...prev,
                                  [key]: !!c,
                                }))
                              : setFairfaxScrapeTabs((prev) => ({
                                  ...prev,
                                  [key]: !!c,
                                }))
                          }
                          onSelect={(e) => e.preventDefault()}
                          data-testid={
                            isBaltimoreCred
                              ? `baltimore-tab-${key}`
                              : `fairfax-tab-${key}`
                          }
                        >
                          {label}
                        </DropdownMenuCheckboxItem>
                      ))}
                      <DropdownMenuSeparator />
                      <DropdownMenuLabel className="text-xs font-normal text-popover-foreground">
                        Presets (single run)
                      </DropdownMenuLabel>
                      <DropdownMenuItem
                        onClick={() => {
                          if (isBaltimoreCred) {
                            setBaltimoreScrapeTabs({
                              info: true,
                              attachments: true,
                            });
                            return runManualCheck("standard", undefined, {
                              tabs: ["info", "attachments"],
                            });
                          }
                          setFairfaxScrapeTabs({
                            info: true,
                            attachments: true,
                          });
                          return runManualCheck("standard", undefined, undefined, {
                            tabs: ["info", "attachments"],
                          });
                        }}
                        data-testid={
                          isBaltimoreCred
                            ? "menu-scrape-baltimore-both"
                            : "menu-scrape-fairfax-both"
                        }
                      >
                        <RefreshCw className="h-4 w-4 mr-2" />
                        Quick scrape (both)
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => {
                          if (isBaltimoreCred) {
                            setBaltimoreScrapeTabs({
                              info: true,
                              attachments: false,
                            });
                            return runManualCheck("standard", undefined, {
                              tabs: ["info"],
                            });
                          }
                          setFairfaxScrapeTabs({
                            info: true,
                            attachments: false,
                          });
                          return runManualCheck("standard", undefined, undefined, {
                            tabs: ["info"],
                          });
                        }}
                        data-testid={
                          isBaltimoreCred
                            ? "menu-scrape-baltimore-info-only"
                            : "menu-scrape-fairfax-info-only"
                        }
                      >
                        <FileText className="h-4 w-4 mr-2" />
                        Info only
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => {
                          if (isBaltimoreCred) {
                            setBaltimoreScrapeTabs({
                              info: false,
                              attachments: true,
                            });
                            return runManualCheck("standard", undefined, {
                              tabs: ["attachments"],
                            });
                          }
                          setFairfaxScrapeTabs({
                            info: false,
                            attachments: true,
                          });
                          return runManualCheck("standard", undefined, undefined, {
                            tabs: ["attachments"],
                          });
                        }}
                        data-testid={
                          isBaltimoreCred
                            ? "menu-scrape-baltimore-attachments-only"
                            : "menu-scrape-fairfax-attachments-only"
                        }
                      >
                        <FolderOpen className="h-4 w-4 mr-2" />
                        Attachments only
                      </DropdownMenuItem>
                    </>
                  ) : isWashingtonProjectDoxCred ? (
                    <>
                      <DropdownMenuLabel className="text-xs font-normal text-popover-foreground">
                        Tabs
                      </DropdownMenuLabel>
                      {WASHINGTON_SCRAPE_TAB_DEFS.map(({ key, label }) => (
                        <DropdownMenuCheckboxItem
                          key={key}
                          checked={washingtonScrapeTabs[key]}
                          onCheckedChange={(c) =>
                            setWashingtonScrapeTabs((prev) => ({
                              ...prev,
                              [key]: !!c,
                            }))
                          }
                          onSelect={(e) => e.preventDefault()}
                          data-testid={`washington-tab-${key}`}
                        >
                          {label}
                        </DropdownMenuCheckboxItem>
                      ))}
                      {washingtonScrapeTabs.files ? (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuLabel className="text-xs font-normal text-popover-foreground">
                            Files — folders
                          </DropdownMenuLabel>
                          <DropdownMenuCheckboxItem
                            checked={washingtonFileFolders.length === 0}
                            onCheckedChange={(c) => {
                              if (c) clearWashingtonFileFolders();
                            }}
                            onSelect={(e) => e.preventDefault()}
                            className="pl-10"
                            data-testid="washington-files-all-folders"
                          >
                            All folders
                          </DropdownMenuCheckboxItem>
                          {WASHINGTON_FILE_FOLDER_OPTIONS.map(
                            ({ key: fk, label: fl }) => (
                              <DropdownMenuCheckboxItem
                                key={fk}
                                checked={washingtonFileFolders.includes(fk)}
                                onCheckedChange={(c) => {
                                  setWashingtonFileFolders((prev) => {
                                    if (c) {
                                      return prev.includes(fk)
                                        ? prev
                                        : [...prev, fk];
                                    }
                                    return prev.filter((k) => k !== fk);
                                  });
                                }}
                                onSelect={(e) => e.preventDefault()}
                                className="pl-10"
                                data-testid={`washington-folder-${fk}`}
                              >
                                {fl}
                              </DropdownMenuCheckboxItem>
                            ),
                          )}
                        </>
                      ) : null}
                      <DropdownMenuSeparator />
                      <DropdownMenuLabel className="text-xs font-normal text-popover-foreground">
                        Presets (single run)
                      </DropdownMenuLabel>
                      <DropdownMenuItem
                        onClick={() => runManualCheck("standard")}
                        data-testid="menu-scrape-standard"
                      >
                        <RefreshCw className="h-4 w-4 mr-2" />
                        Quick Scrape (no files)
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => runManualCheck("all")}
                        data-testid="menu-scrape-all"
                      >
                        <Layers className="h-4 w-4 mr-2" />
                        Full Scrape (with files)
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => runManualCheck("files")}
                        data-testid="menu-scrape-files"
                      >
                        <FolderOpen className="h-4 w-4 mr-2" />
                        Files Only
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => runManualCheck("comments")}
                        data-testid="menu-scrape-comments"
                      >
                        <MessageSquare className="h-4 w-4 mr-2" />
                        Comments Only
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => runManualCheck("supporting_docs")}
                        data-testid="menu-scrape-supporting-docs"
                      >
                        <FileBox className="h-4 w-4 mr-2" />
                        Scrape Supporting Docs Only
                      </DropdownMenuItem>
                    </>
                  ) : (
                    <>
                      <DropdownMenuItem
                        onClick={() => runManualCheck("standard")}
                        data-testid="menu-scrape-standard"
                      >
                        <RefreshCw className="h-4 w-4 mr-2" />
                        Quick Scrape
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => runManualCheck("all")}
                        data-testid="menu-scrape-all"
                      >
                        <Layers className="h-4 w-4 mr-2" />
                        Full Scrape (with files)
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => runManualCheck("files")}
                        data-testid="menu-scrape-files"
                      >
                        <FolderOpen className="h-4 w-4 mr-2" />
                        Files Only
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => runManualCheck("comments")}
                        data-testid="menu-scrape-comments"
                      >
                        <MessageSquare className="h-4 w-4 mr-2" />
                        Comments Only
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => runManualCheck("supporting_docs")}
                        data-testid="menu-scrape-supporting-docs"
                      >
                        <FileBox className="h-4 w-4 mr-2" />
                        Scrape Supporting Docs Only
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
          <Button
            size="sm"
            variant="outline"
            asChild
            className="group/btn w-fit shrink-0 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md active:scale-[0.98]"
          >
            <Link to="/portal-data" className="inline-flex items-center">
              <ExternalLink className="h-4 w-4 mr-2 transition-transform duration-300 group-hover/btn:scale-110" />
              View Portal Data
            </Link>
          </Button>
        </div>
      ),
    },
    {
      title: "Comment Parser Agent",
      status: commentParserStatus,
      description: commentParserDescription,
      action: (
        <Button size="sm" variant="outline" asChild className="mt-2" data-testid="link-comment-review">
          <Link
            to={
              selectedProjectId
                ? `/comment-review?project_id=${encodeURIComponent(selectedProjectId)}`
                : "/comment-review"
            }
          >
            <ExternalLink className="h-4 w-4 mr-2" />
            Upload &amp; Parse Comments
          </Link>
        </Button>
      ),
    },
    {
      title: "Discipline Classifier Agent",
      status: classifierStatus,
      description: classifierDescription,
      action: (
        <Button size="sm" variant="outline" asChild className="mt-2" data-testid="link-classified-comments">
          <Link
            to={
              selectedProjectId
                ? `/response-matrix?project_id=${encodeURIComponent(selectedProjectId)}`
                : "/response-matrix"
            }
          >
            <ExternalLink className="h-4 w-4 mr-2" />
            Open Response Matrix
          </Link>
        </Button>
      ),
    },
    {
      title: "Context & Reference Engine",
      status: enrichmentStatus,
      description: enrichmentDescription,
      action: (
        <Button
          size="sm"
          variant="outline"
          className="mt-2"
          onClick={runEnrichment}
          disabled={enrichmentRunning || !selectedProjectId || chainRunning}
          data-testid="button-run-enrichment"
        >
          {enrichmentRunning ? (
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
          ) : null}
          Run Enrichment
        </Button>
      ),
    },
    {
      title: "Auto-Router Agent",
      status: routerStatus,
      description: routerDescription,
      action: (
        <Button
          size="sm"
          variant="outline"
          className="mt-2"
          onClick={runAutoRoute}
          disabled={routerRunning || !selectedProjectId || chainRunning}
          data-testid="button-run-auto-route"
        >
          {routerRunning ? (
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
          ) : null}
          Run Auto-Route
        </Button>
      ),
    },
  ];

  const statusRingClass = (status: StepStatus) => {
    if (status === "checking") {
      return "border-teal bg-teal/15 text-teal shadow-[0_0_14px_hsl(var(--accent-teal)_/_0.35)]";
    }
    if (status === "done") {
      return "border-teal bg-teal/20 text-teal";
    }
    if (status === "failed") {
      return "border-destructive bg-destructive/15 text-destructive animate-status-shake";
    }
    if (status === "waiting") {
      return "border-gold/50 bg-gold/10 text-gold animate-pulse-glow";
    }
    if (status === "pending") {
      return "border-border bg-muted text-muted-foreground dark:border-obsidian-raised dark:bg-obsidian-sunken dark:text-ink-tertiary-dark";
    }
    return "border-border/60 bg-muted/70 text-muted-foreground animate-pulse-glow dark:border-ink-tertiary-dark/40 dark:bg-obsidian-raised dark:text-ink-secondary-dark";
  };

  const statusPillClass = (status: StepStatus) => {
    if (status === "checking") {
      return "border-teal/35 bg-teal/10 text-teal border";
    }
    if (status === "done") {
      return "border-teal/35 bg-teal/10 text-teal border";
    }
    if (status === "failed") {
      return "border-destructive/35 bg-destructive/10 text-destructive border";
    }
    if (status === "waiting") {
      return "border-gold/40 bg-gold/10 text-gold border animate-pulse-glow";
    }
    if (status === "pending") {
      return "border-border bg-muted text-muted-foreground border dark:border-obsidian-raised dark:text-ink-secondary-dark dark:bg-obsidian-sunken";
    }
    return "border-gold/30 bg-gold/10 text-gold border";
  };

  /** Pipeline aside: coerce to string — DB/JSON may return numeric permit (#). */
  const pipelinePermitTrim = String(
    projectBySelectedId?.permit_number ?? "",
  ).trim();
  const pipelineJurisdictionTrim = String(
    projectBySelectedId?.jurisdiction ?? "",
  ).trim();

  return (
    <div className="relative w-full text-foreground dark:text-ink-primary-dark">
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_min(100%,17.5rem)] lg:gap-8 xl:gap-10 lg:items-start">
        <div className="min-w-0 lg:max-w-3xl">
          <div className="mb-8">
            <EyebrowDark className="mb-2">Intake pipeline</EyebrowDark>
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0 max-w-3xl">
                <SectionTitle className="flex flex-wrap items-center gap-3 text-foreground dark:text-ink-primary-dark !text-2xl sm:!text-3xl">
                  <Workflow className="h-7 w-7 text-teal shrink-0" aria-hidden />
                  <span>PermitPilot Intake Pipeline</span>
                </SectionTitle>
                <p className="text-sm text-muted-foreground dark:text-ink-secondary-dark mt-2">
                  {chainRunning
                    ? `Agent chain in progress — ${chainPhase} step active. All agents fire sequentially.`
                    : "Agentic workflow status (Steps 1-5). Run a manual portal check to trigger the full chain."}
                </p>
                {chainError && (
                  <p className="text-xs text-destructive mt-2" data-testid="text-chain-error">
                    Last error: {chainError}
                  </p>
                )}
              </div>
              <div className="flex flex-wrap gap-2 shrink-0">
                <span className="inline-flex items-center rounded-full border border-teal/40 bg-teal/10 px-2.5 py-0.5 text-xs font-medium text-teal">
                  AI-Powered
                </span>
                {chainRunning && (
                  <span
                    className="inline-flex items-center rounded-full border border-gold/35 bg-gold/10 px-2.5 py-0.5 text-xs font-medium text-gold animate-pulse"
                    data-testid="badge-chain-running"
                  >
                    Chain Active
                  </span>
                )}
                {chainPhase === "complete" && (
                  <span
                    className="inline-flex items-center rounded-full border border-teal/40 bg-teal/10 px-2.5 py-0.5 text-xs font-medium text-teal"
                    data-testid="badge-chain-complete"
                  >
                    Chain Complete
                  </span>
                )}
                {isShadowMode && chainPhase !== "idle" && (
                  <span
                    className="inline-flex items-center rounded-full border border-teal/30 bg-teal/5 px-2.5 py-0.5 text-xs font-medium text-teal"
                    data-testid="badge-shadow-mode"
                  >
                    Shadow Mode
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="relative">
            {steps.map((step, i) => (
              <div
                key={i}
                className="flex gap-4 sm:gap-6 group transition-transform duration-200 hover:scale-[1.01]"
                style={{
                  animation: "fade-in-up 0.4s ease-out forwards",
                  animationDelay: `${i * 100}ms`,
                  opacity: 0,
                }}
              >
                <div className="flex flex-col items-center shrink-0">
                  <div
                    className={`w-9 h-9 rounded-full flex items-center justify-center border-2 transition-all duration-300 group-hover:shadow-lg ${statusRingClass(
                      step.status,
                    )}`}
                    style={
                      step.status === "checking"
                        ? { animation: "scrape-spin 0.8s linear infinite" }
                        : undefined
                    }
                  >
                    {step.status === "checking" ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : step.status === "done" ? (
                      <CheckCircle2
                        className="h-4 w-4"
                        style={{ animation: "scrape-scale-check 0.3s ease-out" }}
                      />
                    ) : step.status === "failed" ? (
                      <XCircle className="h-4 w-4" />
                    ) : (
                      <Circle className="h-4 w-4" />
                    )}
                  </div>
                  {i < steps.length - 1 && (
                    <div className="w-px flex-1 min-h-[24px] my-1 bg-gradient-to-b from-teal/60 to-teal/15 overflow-hidden rounded-full">
                      <div
                        className="w-full mx-auto bg-teal/70 transition-all duration-500 ease-out min-h-0 rounded-full"
                        style={{
                          width: "100%",
                          height: step.status === "done" ? "100%" : "0%",
                        }}
                      />
                    </div>
                  )}
                </div>
                <div className="pb-8 min-w-0 flex-1 last:pb-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-medium text-foreground dark:text-ink-primary-dark">{step.title}</p>
                    <span
                      className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${statusPillClass(
                        step.status,
                      )}`}
                    >
                      {step.status === "checking" && (
                        <span className="inline-flex gap-0.5 mr-1">
                          <span className="animate-pulse">.</span>
                          <span
                            className="animate-pulse"
                            style={{ animationDelay: "0.2s" }}
                          >
                            .
                          </span>
                          <span
                            className="animate-pulse"
                            style={{ animationDelay: "0.4s" }}
                          >
                            .
                          </span>
                        </span>
                      )}
                      {step.status === "done" && (
                        <CheckCircle2 className="h-3 w-3 mr-1 shrink-0" />
                      )}
                      {step.status === "failed" && (
                        <XCircle className="h-3 w-3 mr-1 shrink-0" />
                      )}
                      {step.status === "waiting" && "Waiting for Doc"}
                      {step.status === "pending" && "Pending"}
                      {step.status === "checking" && "Running"}
                      {step.status === "done" && "Complete"}
                      {step.status === "failed" && "Error"}
                      {![
                        "checking",
                        "done",
                        "failed",
                        "waiting",
                        "pending",
                      ].includes(step.status) && "Idle"}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground dark:text-ink-secondary-dark mt-0.5">
                    {step.description}
                  </p>
                  <div className="mt-2 [&_button]:transition-all [&_button]:duration-200 [&_button:hover]:-translate-y-0.5 [&_button:hover]:shadow-md [&_button:active]:scale-[0.98] [&_a.inline-flex]:transition-all">
                    {"action" in step && step.action}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <aside
          className="mt-10 min-w-0 rounded-xl border border-border bg-card p-4 text-sm shadow-md lg:mt-0 dark:border-[hsl(var(--border-obsidian-strong)/0.38)] dark:bg-gradient-to-br dark:from-obsidian-raised/92 dark:via-[hsl(219_52%_13%)] dark:to-obsidian-sunken dark:shadow-[0_10px_44px_-14px_rgba(0,0,0,0.52)] dark:ring-1 dark:ring-white/[0.05] dark:backdrop-blur-[1px]"
          aria-label="Pipeline context"
        >
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground dark:text-ink-secondary-dark mb-3">
            Pipeline context
          </p>
          {selectedProjectId ? (
            projectBySelectedId ? (
              <dl className="space-y-3 text-foreground dark:text-ink-primary-dark">
                <div>
                  <dt className="text-xs text-muted-foreground dark:text-ink-secondary-dark">Permit</dt>
                  <dd className="font-mono text-sm mt-0.5 tabular-nums">
                    {pipelinePermitTrim || "—"}
                  </dd>
                </div>
                {pipelineJurisdictionTrim ? (
                  <div>
                    <dt className="text-xs text-muted-foreground dark:text-ink-secondary-dark">Jurisdiction</dt>
                    <dd className="mt-0.5">{pipelineJurisdictionTrim}</dd>
                  </div>
                ) : null}
              </dl>
            ) : (
              <p className="text-xs text-muted-foreground dark:text-ink-secondary-dark leading-relaxed">
                Project is selected; permit and jurisdiction will appear here when loaded from your workspace.
              </p>
            )
          ) : (
            <p className="text-xs text-muted-foreground dark:text-ink-secondary-dark leading-relaxed">
              Select a project from the workspace to scope portal checks and the agent chain.
            </p>
          )}
        </aside>
      </div>
    </div>
  );
}
