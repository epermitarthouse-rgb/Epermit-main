import { useState, useEffect, useCallback, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/hooks/useAuth";
import { useSelectedProject } from "@/contexts/SelectedProjectContext";
import { useScrape } from "@/contexts/ScrapeContext";
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
} from "lucide-react";
import { Link, useNavigate } from "react-router-dom";

function getScraperBaseUrl() {
  const raw =
    import.meta.env.VITE_API_BASE_URL || "https://epermit-production.up.railway.app";
  if (/^https?:\/\//i.test(raw)) return raw;
  if (/localhost|127\.0\.0\.1/i.test(raw)) return `http://${raw}`;
  return `https://${raw}`;
}
const SCRAPER_URL = getScraperBaseUrl();

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
  const [firstJurisdiction, setFirstJurisdiction] = useState<string | null>(
    null,
  );
  const [latestProjectId, setLatestProjectId] = useState<string | null>(null);
  const [latestPermitNumber, setLatestPermitNumber] = useState<string | null>(
    null,
  );
  const [projectBySelectedId, setProjectBySelectedId] = useState<{
    id: string;
    permit_number: string | null;
    jurisdiction: string | null;
    credential_id: string | null;
  } | null>(null);

  const [chainPhase, setChainPhase] = useState<ChainPhase>("idle");
  const [chainError, setChainError] = useState<string | null>(null);
  const [isShadowMode, setIsShadowMode] = useState(false);
  const realtimeTriggeredRef = useRef(false);
  const chainPipelineRef = useRef<((projectId: string) => Promise<void>) | null>(null);

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
    if (scrape.isScraping) {
      setPortalStatus("checking");
      if (scrape.scrapeOverlay) {
        const pct = scrape.scrapeOverlay.total > 0
          ? Math.round((scrape.scrapeOverlay.progress / scrape.scrapeOverlay.total) * 100)
          : 0;
        setPortalStatusText(pct > 0 ? `Scraping... ${pct}%` : scrape.scrapeOverlay.stepText);
      }
    } else if (scrape.scrapeOverlay?.phase === "done") {
      setPortalStatus("done");
      setPortalStatusText("Done");
    }
  }, [scrape.isScraping, scrape.scrapeOverlay]);

  const cp = pipelineResult?.comment_parser;
  const dc = pipelineResult?.discipline_classifier;
  const parserSucceeded = cp != null && !cp.error && cp.done === true;
  const commentParserFailed = cp != null && !!cp.error;
  const classifierDone = dc != null && !dc.error;
  const classifierFailed = dc != null && !!dc.error;

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

  const [enrichmentRunning, setEnrichmentRunning] = useState(false);
  const [enrichmentResult, setEnrichmentResult] = useState<number | null>(null);

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
      const { data: projRow } = await supabase
        .from("projects")
        .select("is_shadow_mode")
        .eq("id", projectIdToUse)
        .maybeSingle();
      const { data, error } = await supabase.functions.invoke(
        "context-reference-engine",
        {
          body: {
            projectId: projectIdToUse,
            is_shadow_mode: projRow?.is_shadow_mode === true,
          },
        },
      );
      if (error) throw error;
      const count = (data as { enriched_count?: number })?.enriched_count ?? 0;
      setEnrichmentResult(count);
      await queryClient.invalidateQueries({ queryKey: ["parsed_comments"] });
      await queryClient.invalidateQueries({
        queryKey: ["parsed_comments_code_ref_check"],
      });
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

  const [routerRunning, setRouterRunning] = useState(false);
  const [routerResult, setRouterResult] = useState<number | null>(null);

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
      const { data: projRow } = await supabase
        .from("projects")
        .select("is_shadow_mode")
        .eq("id", projectIdToUse)
        .maybeSingle();
      const { data, error } = await supabase.functions.invoke(
        "auto-router-agent",
        {
          body: {
            projectId: projectIdToUse,
            is_shadow_mode: projRow?.is_shadow_mode === true,
          },
        },
      );
      if (error) throw error;
      const count = (data as { routed_count?: number })?.routed_count ?? 0;
      setRouterResult(count);
      await queryClient.invalidateQueries({ queryKey: ["parsed_comments"] });
      await queryClient.invalidateQueries({
        queryKey: ["parsed_comments_assigned_check"],
      });
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
    const { data: cred } = await supabase
      .from("portal_credentials")
      .select("jurisdiction")
      .eq("user_id", user.id)
      .limit(1)
      .maybeSingle();
    if (cred?.jurisdiction) setFirstJurisdiction(cred.jurisdiction);

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
        .select("id, permit_number, jurisdiction, credential_id")
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

  const runChainedPipeline = useCallback(
    async (projectId: string) => {
      console.log("[CHAIN DEBUG] runChainedPipeline called with projectId:", projectId);
      setChainError(null);

      const { data: projectRow, error: projectRowErr } = await supabase
        .from("projects")
        .select("is_shadow_mode, portal_data")
        .eq("id", projectId)
        .maybeSingle();

      if (projectRowErr) {
        console.error("[CHAIN DEBUG] Failed to fetch project row:", projectRowErr.message);
      }

      const portalData = projectRow?.portal_data as Record<string, unknown> | null;
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
      console.log("[CHAIN DEBUG] shadowActive:", shadowActive);
      if (shadowActive) {
        toast.info("Shadow Mode active — all results will be logged to shadow tables.");
      }

      setChainPhase("intake");
      toast.info("Chain Step 2/5: Intake Pipeline (parsing PDFs)...");
      setParserRunning(true);
      setParserProgress(null);
      let cursor: { pdfIndex: number } | undefined;
      const pollIntervalMs = 2500;
      const maxRounds = 60;
      let totalParsed = 0;
      let totalSkipped = 0;
      let intakeClassifiedCount = 0;
      let round = 0;
      let intakeFailed = false;
      try {
        while (round < maxRounds) {
          console.log("[CHAIN DEBUG] Intake round:", round, "cursor:", cursor);
          const { data: pipelineData, error: pipelineError } =
            await supabase.functions.invoke("intake-pipeline-agent", {
              body: {
                project_id: projectId,
                is_shadow_mode: shadowActive,
                ...(cursor && { cursor }),
              },
            });
          console.log("[CHAIN DEBUG] Intake response — data:", JSON.stringify(pipelineData)?.slice(0, 500), "error:", pipelineError);
          if (pipelineError) {
            console.warn("Intake pipeline error:", pipelineError);
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

          const cpData = pipelineData.comment_parser;
          const dcData = pipelineData.discipline_classifier;
          totalParsed += cpData?.parsed_count ?? 0;
          totalSkipped += cpData?.skipped_count ?? 0;
          intakeClassifiedCount += dcData?.classified_count ?? 0;
          setPipelineResult({
            comment_parser: {
              ...cpData,
              parsed_count: totalParsed,
              skipped_count: totalSkipped,
            },
            discipline_classifier: dcData,
          });

          if (
            cpData?.total_pdfs != null &&
            (cpData.next_cursor?.pdfIndex ?? 0) >= 0
          ) {
            setParserProgress({
              pdfIndex: cpData.next_cursor?.pdfIndex ?? 0,
              totalPdfs: cpData.total_pdfs,
            });
          }

          if (cpData?.done === true && !cpData?.error) {
            await queryClient.invalidateQueries({
              queryKey: ["parsed_comments"],
            });
            const classified = dcData?.classified_count ?? 0;
            if (totalParsed > 0 || classified > 0) {
              toast.success(
                `Intake complete: ${totalParsed} parsed, ${classified} classified.`,
              );
            }
            break;
          }

          if (cpData?.error && cpData.error !== "timeout") {
            intakeFailed = true;
            setChainError(`Parser: ${cpData.error}`);
            await logChainFailure(
              projectId,
              "comment-parser-agent",
              cpData.error,
            );
            break;
          }

          if (
            cpData?.error === "timeout" ||
            (cpData?.next_cursor != null && !cpData?.done)
          ) {
            cursor = cpData?.error === "timeout" ? undefined : cpData.next_cursor;
            await new Promise((r) => setTimeout(r, pollIntervalMs));
            round++;
            continue;
          }
          break;
        }
      } catch (e) {
        intakeFailed = true;
        const errMsg = e instanceof Error ? e.message : String(e);
        console.warn("Intake pipeline failed:", errMsg);
        setChainError(`Intake: ${errMsg}`);
        await logChainFailure(projectId, "intake-pipeline-agent", errMsg);
      } finally {
        setParserRunning(false);
        setParserProgress(null);
      }

      if (intakeFailed) {
        toast.error("Chain stopped: Intake Pipeline failed. Error logged.");
        setTimeout(() => setChainPhase("idle"), 8000);
        return;
      }

      console.log("=== CLASSIFIER DEBUG ===");
      console.log("Project ID:", projectId);

      const { data: preClassRows, error: preClassErr } = await supabase
        .from("parsed_comments")
        .select("id, original_text, discipline, status")
        .eq("project_id", projectId);

      const preRows = preClassRows ?? [];
      const unclassifiedRows = preRows.filter((r: { discipline: string | null }) => !r.discipline || r.discipline === "General" || r.discipline === "Unclassified" || r.discipline === "");
      if (!preClassErr) {
        console.log("Parsed comments found:", preRows.length);
        console.log("Unclassified:", unclassifiedRows.length, "Pending:", preRows.filter((r: { status: string | null }) => r.status === "Pending").length);
        console.log("Discipline breakdown:", preRows.reduce((acc: Record<string, number>, r: { discipline: string | null }) => {
          const d = r.discipline ?? "null";
          acc[d] = (acc[d] || 0) + 1;
          return acc;
        }, {}));
      }

      const intakeAlreadyClassified = intakeClassifiedCount > 0 && unclassifiedRows.length === 0;

      setChainPhase("classifier");

      if (intakeAlreadyClassified) {
        console.log(`Intake already classified ${intakeClassifiedCount} comments — skipping redundant Step 3 call`);
        toast.success(`Classifier complete: ${intakeClassifiedCount} classified (via intake pipeline).`);
      } else {
        toast.info("Chain Step 3/5: Discipline Classifier...");
        console.log("Calling classifier edge function...");
        console.log("Body:", JSON.stringify({ project_id: projectId, is_shadow_mode: shadowActive }));
        let classifierFailed2 = false;
        try {
          const { data: classData, error: classError } =
            await supabase.functions.invoke("discipline-classifier-agent", {
              body: {
                project_id: projectId,
                is_shadow_mode: shadowActive,
              },
            });
          console.log("Classifier response:", classData);
          console.log("Classifier error:", classError);
          if (classError) {
            classifierFailed2 = true;
            const errMsg =
              typeof classError === "string"
                ? classError
                : classError?.message ?? "Unknown classifier error";
            setChainError(`Classifier: ${errMsg}`);
            await logChainFailure(
              projectId,
              "discipline-classifier-agent",
              errMsg,
            );
          } else {
            const classified =
              (classData as { classified_count?: number })?.classified_count ?? 0;
            setPipelineResult((prev) => ({
              ...prev,
              discipline_classifier: {
                classified_count: (prev?.discipline_classifier?.classified_count ?? 0) + classified,
              },
            }));
            const debugTotal = (classData as { debug_total_comments?: number })?.debug_total_comments;
            if (classified === 0 && debugTotal && debugTotal > 0) {
              toast.info(`All ${debugTotal} comments already classified. Nothing new to classify.`);
            } else if (classified === 0) {
              toast.info("No comments found to classify.");
            } else {
              toast.success(`Classifier complete: ${classified} classified.`);
            }

            const { data: postClassRows } = await supabase
              .from("parsed_comments")
              .select("id, discipline, status")
              .eq("project_id", projectId);
            if (postClassRows) {
              console.log("=== POST-CLASSIFIER CHECK ===");
              console.log("Total comments after:", postClassRows.length);
              console.log("Post-classifier discipline breakdown:", postClassRows.reduce((acc: Record<string, number>, r: { discipline: string | null }) => {
                const d = r.discipline ?? "null";
                acc[d] = (acc[d] || 0) + 1;
                return acc;
              }, {}));
            }
          }
        } catch (e) {
          classifierFailed2 = true;
          const errMsg = e instanceof Error ? e.message : String(e);
          console.warn("Discipline classifier failed:", errMsg);
          setChainError(`Classifier: ${errMsg}`);
          await logChainFailure(
            projectId,
            "discipline-classifier-agent",
            errMsg,
          );
        }

        if (classifierFailed2) {
          toast.error("Chain stopped: Classifier failed. Error logged.");
          setTimeout(() => setChainPhase("idle"), 8000);
          return;
        }
      }

      setChainPhase("enrichment");
      toast.info("Chain Step 4/5: Context & Reference Engine...");
      setEnrichmentRunning(true);
      setEnrichmentResult(null);
      let enrichFailed = false;
      try {
        const { data: enrichData, error: enrichError } =
          await supabase.functions.invoke("context-reference-engine", {
            body: {
              projectId: projectId,
              is_shadow_mode: shadowActive,
            },
          });
        if (enrichError) {
          enrichFailed = true;
          const errMsg =
            typeof enrichError === "string"
              ? enrichError
              : enrichError?.message ?? "Unknown enrichment error";
          setChainError(`Enrichment: ${errMsg}`);
          await logChainFailure(
            projectId,
            "context-reference-engine",
            errMsg,
          );
        } else {
          const count =
            (enrichData as { enriched_count?: number })?.enriched_count ?? 0;
          setEnrichmentResult(count);
          await queryClient.invalidateQueries({
            queryKey: ["parsed_comments"],
          });
          await queryClient.invalidateQueries({
            queryKey: ["parsed_comments_code_ref_check"],
          });
          toast.success(`Enrichment complete: ${count} enriched.`);
        }
      } catch (e) {
        enrichFailed = true;
        const errMsg = e instanceof Error ? e.message : String(e);
        console.warn("Context reference engine failed:", errMsg);
        setChainError(`Enrichment: ${errMsg}`);
        await logChainFailure(projectId, "context-reference-engine", errMsg);
      } finally {
        setEnrichmentRunning(false);
      }

      if (enrichFailed) {
        toast.error("Chain stopped: Enrichment failed. Error logged.");
        setTimeout(() => setChainPhase("idle"), 8000);
        return;
      }

      setChainPhase("router");
      toast.info("Chain Step 5/5: Auto-Router Agent...");
      setRouterRunning(true);
      setRouterResult(null);
      let routeFailed = false;
      try {
        const { data: routeData, error: routeError } =
          await supabase.functions.invoke("auto-router-agent", {
            body: {
              projectId: projectId,
              is_shadow_mode: shadowActive,
            },
          });
        if (routeError) {
          routeFailed = true;
          const errMsg =
            typeof routeError === "string"
              ? routeError
              : routeError?.message ?? "Unknown router error";
          setChainError(`Router: ${errMsg}`);
          await logChainFailure(projectId, "auto-router-agent", errMsg);
        } else {
          const count =
            (routeData as { routed_count?: number })?.routed_count ?? 0;
          setRouterResult(count);
          await queryClient.invalidateQueries({
            queryKey: ["parsed_comments"],
          });
          await queryClient.invalidateQueries({
            queryKey: ["parsed_comments_assigned_check"],
          });
          toast.success(`Auto-Router complete: ${count} routed.`);
        }
      } catch (e) {
        routeFailed = true;
        const errMsg = e instanceof Error ? e.message : String(e);
        console.warn("Auto-router agent failed:", errMsg);
        setChainError(`Router: ${errMsg}`);
        await logChainFailure(projectId, "auto-router-agent", errMsg);
      } finally {
        setRouterRunning(false);
      }

      if (routeFailed) {
        toast.error("Chain stopped: Auto-Router failed. Error logged.");
        setTimeout(() => setChainPhase("idle"), 8000);
        return;
      }

      setChainPhase("complete");
      toast.success(
        shadowActive
          ? "Full chain complete! All results logged to shadow tables."
          : "Full chain complete! All agents finished successfully.",
      );
      toast.info("View scraped data on the Portal Data page.", {
        action: {
          label: "View",
          onClick: () => navigate("/portal-data"),
        },
      });
      setTimeout(() => setChainPhase("idle"), 5000);
    },
    [queryClient, navigate],
  );

  useEffect(() => {
    chainPipelineRef.current = runChainedPipeline;
  }, [runChainedPipeline]);

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

  const runManualCheck = async (scrapeMode: "standard" | "all" | "files" | "comments" | "supporting_docs" = "standard") => {
    const projectIdToUse = projectBySelectedId?.id ?? latestProjectId;
    const permitNumberToUse =
      projectBySelectedId?.permit_number ?? latestPermitNumber;

    if (!projectIdToUse) {
      toast.error(
        "No project found. Select a project in the sidebar or create one first.",
      );
      return;
    }

    if (!session?.access_token) {
      toast.error("You must be logged in to run this check.");
      return;
    }

    if (!permitNumberToUse || String(permitNumberToUse).trim() === "") {
      toast.error(
        "Permit # is required. Set it in the sidebar: select the project, then enter Permit # under the project dropdown.",
      );
      return;
    }

    setChainPhase("scraping");
    setChainError(null);
    setPipelineResult(null);
    setEnrichmentResult(null);
    setRouterResult(null);
    setPortalStatus("checking");
    setPortalStatusText("Connecting...");
    toast.info("Chain Step 1/5: Portal Scraping...");

    try {
      const { data: projectRow } = await supabase
        .from("projects")
        .select("credential_id")
        .eq("id", projectIdToUse)
        .maybeSingle();

      const credentialId = projectRow?.credential_id;

      if (!credentialId) {
        throw new Error(
          "No portal credential linked to this project. Select a credential in the sidebar dropdown under \"Portal Credential\", then try again.",
        );
      }

      const { data: credentials, error: credError } = await supabase
        .from("portal_credentials")
        .select("id, portal_username, portal_password, permit_number, login_url, jurisdiction")
        .eq("user_id", user!.id);

      if (credError) throw new Error("Failed to load portal credentials");
      if (!credentials?.length)
        throw new Error(
          "No portal credentials found. Add credentials in Settings.",
        );

      const cred = credentials.find((c) => c.id === credentialId);

      if (!cred) {
        throw new Error(
          "The linked credential was not found. Please re-select a credential in the sidebar dropdown under \"Portal Credential\".",
        );
      }

      const loginUrl = cred.login_url?.trim();
      if (!loginUrl) {
        throw new Error(
          `Missing Portal URL for ${cred.jurisdiction || "this jurisdiction"}. Please update Settings.`,
        );
      }

      const username = cred.portal_username;
      const password = cred.portal_password;

      toast.info("Logging into portal...");

      let loginRes: Response;
      try {
        loginRes = await fetch(`${SCRAPER_URL}/api/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username, password, portalUrl: loginUrl }),
        });
      } catch (fetchErr) {
        throw new Error("SCRAPER_OFFLINE");
      }

      if (!loginRes.ok) {
        const errData = await loginRes.json().catch(() => ({}));
        throw new Error(
          errData.error || `Scraper login failed (${loginRes.status})`,
        );
      }

      const loginData = (await loginRes.json()) as { sessionId: string };
      const { sessionId } = loginData;

      toast.success("Scraping started — you can continue using the app.");

      const scrapeRes = await fetch(`${SCRAPER_URL}/api/scrape`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          permitNumber: String(permitNumberToUse).trim(),
          scrapeMode,
          userId: user!.id,
          projectId: projectIdToUse,
        }),
      });

      if (!scrapeRes.ok) {
        const errData = await scrapeRes.json().catch(() => ({}));
        throw new Error(errData.error || "Failed to start scrape");
      }

      scrape.startScrapeSession(sessionId, projectIdToUse, String(permitNumberToUse).trim());
    } catch (error) {
      console.error(error);
      scrape.cleanupScrapeState();
      setPortalStatus("idle");
      setPortalStatusText("Error");
      setChainPhase("idle");
      const msg = error instanceof Error ? error.message : String(error);
      const projectId = projectBySelectedId?.id ?? latestProjectId;
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
    }
  };

  const chainRunning = chainPhase !== "idle" && chainPhase !== "complete";

  const steps = [
    {
      title: "Portal Monitor Agent",
      status: portalStatus,
      description:
        portalStatus === "checking"
          ? chainPhase === "scraping"
            ? "Scraping (Step 1/5)"
            : "Running"
          : portalStatus === "done"
            ? "Complete"
            : portalStatusText
              ? `Status: ${portalStatusText}`
              : "Idle",
      action: (
        <div className="flex flex-col gap-2 mt-2">
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
                onClick={() => runManualCheck("standard")}
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
                <DropdownMenuContent align="end">
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
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
          <Button
            size="sm"
            variant="outline"
            asChild
            className="group/btn transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md active:scale-[0.98]"
          >
            <Link to="/portal-data" className="flex items-center">
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
          <Link to="/comment-review">
            <ExternalLink className="h-4 w-4 mr-2" />
            Open Comment Review
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
          <Link to="/classified-comments">
            <ExternalLink className="h-4 w-4 mr-2" />
            View Classified Comments
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

  return (
    <Card className="relative overflow-hidden border-0 bg-white/5 backdrop-blur-sm border border-white/10 rounded-xl shadow-xl">
      <div className="absolute inset-0 rounded-xl border border-transparent bg-gradient-to-br from-emerald-500/20 via-transparent to-transparent bg-[length:200%_200%] animate-shimmer pointer-events-none" />
      <div className="absolute inset-0 rounded-xl ring-1 ring-inset ring-emerald-500/20 pointer-events-none" />
      <CardHeader className="relative">
        <CardTitle className="flex items-center gap-2 text-lg flex-wrap">
          <span className="flex items-center gap-2">
            <Workflow
              className="h-5 w-5 text-emerald-400 animate-pulse-glow"
              style={{ boxShadow: "0 0 12px rgba(16, 185, 129, 0.3)" }}
            />
            DesignCheck Intake Pipeline
          </span>
          <span className="inline-flex items-center rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-xs font-medium text-emerald-400">
            AI-Powered
          </span>
          {chainRunning && (
            <span className="inline-flex items-center rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-0.5 text-xs font-medium text-amber-400 animate-pulse" data-testid="badge-chain-running">
              Chain Active
            </span>
          )}
          {chainPhase === "complete" && (
            <span className="inline-flex items-center rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-xs font-medium text-emerald-400" data-testid="badge-chain-complete">
              Chain Complete
            </span>
          )}
          {isShadowMode && chainPhase !== "idle" && (
            <span className="inline-flex items-center rounded-full border border-purple-500/30 bg-purple-500/10 px-2.5 py-0.5 text-xs font-medium text-purple-400" data-testid="badge-shadow-mode">
              Shadow Mode
            </span>
          )}
        </CardTitle>
        <CardDescription>
          {chainRunning
            ? `Agent chain in progress — ${chainPhase} step active. All agents fire sequentially.`
            : "Agentic workflow status (Steps 1-5). Run a manual portal check to trigger the full chain."}
        </CardDescription>
        {chainError && (
          <p className="text-xs text-red-400 mt-1" data-testid="text-chain-error">
            Last error: {chainError}
          </p>
        )}
      </CardHeader>
      <CardContent className="relative space-y-0">
        {steps.map((step, i) => (
          <div
            key={i}
            className="flex gap-4 group transition-transform duration-200 hover:scale-[1.02]"
            style={{
              animation: "fade-in-up 0.4s ease-out forwards",
              animationDelay: `${i * 100}ms`,
              opacity: 0,
            }}
          >
            <div className="flex flex-col items-center shrink-0">
              <div
                className={`w-9 h-9 rounded-full flex items-center justify-center border-2 transition-all duration-300 group-hover:shadow-lg ${
                  step.status === "checking"
                    ? "border-emerald-500 bg-emerald-500/20 text-emerald-400 shadow-[0_0_12px_rgba(16,185,129,0.3)] [animation:spin_0.8s_linear_infinite]"
                    : step.status === "done"
                      ? "border-emerald-500 bg-emerald-500/20 text-emerald-500"
                      : step.status === "failed"
                        ? "border-red-500 bg-red-500/10 text-red-500 animate-status-shake"
                        : "border-muted-foreground/40 bg-muted/50 text-muted-foreground animate-pulse-glow"
                }`}
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
                <div className="w-0.5 flex-1 min-h-[24px] my-1 bg-border overflow-hidden">
                  <div
                    className="w-full bg-emerald-500/60 transition-all duration-500 ease-out min-h-0"
                    style={{ height: step.status === "done" ? "100%" : "0%" }}
                  />
                </div>
              )}
            </div>
            <div className="pb-4 min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="font-medium">{step.title}</p>
                <span
                  className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${
                    step.status === "checking"
                      ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                      : step.status === "done"
                        ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                        : step.status === "failed"
                          ? "bg-red-500/10 text-red-400 border border-red-500/20"
                          : step.status === "waiting"
                            ? "bg-muted/50 text-muted-foreground border border-border animate-pulse-glow"
                            : "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                  }`}
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
              <p className="text-sm text-muted-foreground mt-0.5">
                {step.description}
              </p>
              <div className="mt-2 [&_button]:transition-all [&_button]:duration-200 [&_button:hover]:-translate-y-0.5 [&_button:hover]:shadow-md [&_button:active]:scale-[0.98]">
                {"action" in step && step.action}
              </div>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
