import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const PARSER_TIMEOUT_MS = 60_000;
const CLASSIFIER_TIMEOUT_MS = 60_000;
/** Per-batch enrichment timeout (one OpenAI round of ≤20 comments). */
const ENRICHMENT_TIMEOUT_MS = 90_000;
/** Max context-reference-engine invocations per pipeline call (each processes one batch). */
const ENRICHMENT_MAX_PIPELINE_ROUNDS = 50;
/**
 * Soft wall-clock budget for enrichment inside one intake-pipeline invoke.
 * Leaves headroom under typical edge limits; UI/pipeline can continue.
 */
const ENRICHMENT_INVOKE_BUDGET_MS = 100_000;
const ROUTER_TIMEOUT_MS = 60_000;

type StageStatus = "pending" | "running" | "completed" | "completed_with_warnings" | "failed" | "skipped";

type PipelineStages = {
  comment_parser?: { status: StageStatus; parsed_count?: number; error?: string };
  discipline_classifier?: { status: StageStatus; classified_count?: number; error?: string };
  enrichment?: { status: StageStatus; enriched_count?: number; error?: string };
  auto_routing?: { status: StageStatus; routed_count?: number; error?: string };
};

async function fetchWithTimeout(
  url: string,
  options: Omit<RequestInit, "signal"> & { timeoutMs?: number },
): Promise<Response> {
  const { timeoutMs = PARSER_TIMEOUT_MS, ...fetchOptions } = options;
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...fetchOptions, signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}

async function invokeJson(
  url: string,
  headers: Record<string, string>,
  body: Record<string, unknown>,
  timeoutMs: number,
): Promise<{ ok: boolean; status: number; json: Record<string, unknown> }> {
  const res = await fetchWithTimeout(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    timeoutMs,
  });
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { message: text.slice(0, 500) };
  }
  return { ok: res.ok, status: res.status, json };
}

function stageOrder(): Array<keyof PipelineStages> {
  return ["comment_parser", "discipline_classifier", "enrichment", "auto_routing"];
}

function defaultStages(): PipelineStages {
  return {
    comment_parser: { status: "pending" },
    discipline_classifier: { status: "pending" },
    enrichment: { status: "pending" },
    auto_routing: { status: "pending" },
  };
}

function shouldRunStage(
  stage: keyof PipelineStages,
  stages: PipelineStages,
  resumeFrom?: string,
): boolean {
  if (!resumeFrom) return true;
  const order = stageOrder();
  const resumeIdx = order.indexOf(resumeFrom as keyof PipelineStages);
  const stageIdx = order.indexOf(stage);
  if (resumeIdx < 0) return true;
  if (stageIdx < resumeIdx) {
    return stages[stage]?.status !== "completed" && stages[stage]?.status !== "completed_with_warnings";
  }
  return stageIdx >= resumeIdx;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const startTime = Date.now();
  console.log("[intake-pipeline] start");

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      return new Response(
        JSON.stringify({
          code: 500,
          message: "SUPABASE_URL, SUPABASE_ANON_KEY, or SUPABASE_SERVICE_ROLE_KEY not configured",
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ code: 401, message: "Missing or invalid Authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const token = authHeader.replace(/^\s*Bearer\s+/i, "").trim();
    if (!token) {
      return new Response(
        JSON.stringify({ code: 401, message: "Invalid JWT" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabase = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false },
    });
    const pipelineDb = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      console.warn("JWT validation failed:", userError?.message ?? "No user");
      return new Response(
        JSON.stringify({ code: 401, message: "Invalid JWT" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const body = await req.json().catch(() => ({}));
    const projectId = body.project_id as string | undefined;
    const cursor = body.cursor as { pdfIndex?: number } | undefined;
    const fullRefresh = body.full_refresh === true;
    const resumePipeline = body.resume_pipeline === true;
    const resumeFromStage = body.resume_from_stage as string | undefined;
    const forceRetry = body.force_retry === true;
    const pipelineRunId = body.pipeline_run_id as string | undefined;
    const parserTimeout = (body.parser_timeout_ms as number | undefined) ?? PARSER_TIMEOUT_MS;
    const classifierTimeout = (body.classifier_timeout_ms as number | undefined) ?? CLASSIFIER_TIMEOUT_MS;
    const enrichmentTimeout = (body.enrichment_timeout_ms as number | undefined) ?? ENRICHMENT_TIMEOUT_MS;
    const routerTimeout = (body.router_timeout_ms as number | undefined) ?? ROUTER_TIMEOUT_MS;
    const enrichmentOnly = body.run_enrichment_only === true;
    const routingOnly = body.run_routing_only === true;

    if (!projectId) {
      return new Response(
        JSON.stringify({ code: 400, message: "project_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { data: hasAccess, error: accessError } = await pipelineDb.rpc("has_project_access", {
      _user_id: user.id,
      _project_id: projectId,
    });
    if (accessError || !hasAccess) {
      return new Response(
        JSON.stringify({ code: 403, message: "Project not found or access denied" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { data: projectRow } = await supabase
      .from("projects")
      .select("portal_data_hash")
      .eq("id", projectId)
      .maybeSingle();

    const portalDataHash = (body.portal_data_hash as string | undefined) ??
      (projectRow?.portal_data_hash as string | undefined) ??
      null;
    const idempotencyKey = portalDataHash ? `hash:${portalDataHash}` : null;

    let runId = pipelineRunId;
    let stages: PipelineStages = defaultStages();

    if (runId) {
      const { data: existingRun } = await pipelineDb
        .from("project_pipeline_runs")
        .select("id, status, stages, portal_data_hash, idempotency_key")
        .eq("id", runId)
        .maybeSingle();
      if (!existingRun) {
        console.warn("[intake-pipeline] pipeline_run_id not found, will create new run:", runId);
        runId = undefined;
      } else {
        if (existingRun.stages && typeof existingRun.stages === "object") {
          stages = { ...defaultStages(), ...(existingRun.stages as PipelineStages) };
        }
        if (
          existingRun.portal_data_hash &&
          portalDataHash &&
          existingRun.portal_data_hash !== portalDataHash &&
          !forceRetry
        ) {
          return new Response(
            JSON.stringify({
              code: 409,
              message: "Pipeline run belongs to an older portal scrape",
              pipeline_run_id: runId,
              next_action: "stale_run",
            }),
            { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
      }
    } else if (idempotencyKey && !cursor) {
      const { data: existingByKey } = await pipelineDb
        .from("project_pipeline_runs")
        .select("id, status, stages, portal_data_hash")
        .eq("project_id", projectId)
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle();

      if (existingByKey && !forceRetry) {
        if (existingByKey.status === "running") {
          return new Response(
            JSON.stringify({
              project_id: projectId,
              pipeline_run_id: existingByKey.id,
              stages: existingByKey.stages,
              next_action: "poll_again",
              message: "Pipeline already running for this portal scrape",
            }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
        if (existingByKey.status === "completed" || existingByKey.status === "completed_with_warnings") {
          return new Response(
            JSON.stringify({
              project_id: projectId,
              pipeline_run_id: existingByKey.id,
              stages: existingByKey.stages,
              next_action: "complete",
            }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
        runId = existingByKey.id;
        if (existingByKey.stages && typeof existingByKey.stages === "object") {
          stages = { ...defaultStages(), ...(existingByKey.stages as PipelineStages) };
        }
      } else if (existingByKey && forceRetry) {
        runId = existingByKey.id;
        if (!resumePipeline && !enrichmentOnly && !routingOnly && !cursor) {
          stages = defaultStages();
        } else if (existingByKey.stages && typeof existingByKey.stages === "object") {
          stages = { ...defaultStages(), ...(existingByKey.stages as PipelineStages) };
          // Targeted retries must re-run the requested stage even if a prior run
          // marked it completed after a partial batch (historical 20-row ceiling).
          if (enrichmentOnly) {
            stages.enrichment = { status: "pending" };
          }
          if (routingOnly) {
            stages.auto_routing = { status: "pending" };
          }
        } else if (enrichmentOnly) {
          stages.enrichment = { status: "pending" };
        } else if (routingOnly) {
          stages.auto_routing = { status: "pending" };
        }
      }
    }

    if (resumePipeline && !runId) {
      const { data: latestRun } = await pipelineDb
        .from("project_pipeline_runs")
        .select("id, status, stages, portal_data_hash")
        .eq("project_id", projectId)
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (latestRun?.id) {
        runId = latestRun.id as string;
        if (latestRun.stages && typeof latestRun.stages === "object") {
          stages = { ...defaultStages(), ...(latestRun.stages as PipelineStages) };
        }
      }
    }

    const persistRun = async (
      patch: {
        status?: string;
        current_stage?: string | null;
        stages?: PipelineStages;
        error_message?: string | null;
        completed_at?: string | null;
      },
    ) => {
      const payload = {
        project_id: projectId,
        portal_data_hash: portalDataHash,
        idempotency_key: idempotencyKey,
        status: patch.status ?? "running",
        current_stage: patch.current_stage ?? null,
        stages: patch.stages ?? stages,
        error_message: patch.error_message ?? null,
        completed_at: patch.completed_at ?? null,
        updated_at: new Date().toISOString(),
      };

      if (runId) {
        const { data: updated, error: updErr } = await pipelineDb
          .from("project_pipeline_runs")
          .update(payload)
          .eq("id", runId)
          .select("id")
          .maybeSingle();
        if (updErr) {
          console.warn("[intake-pipeline] pipeline run update failed:", updErr.message);
        }
        if (updated?.id) return;
        console.warn("[intake-pipeline] pipeline run row missing for id", runId, "— inserting new row");
        runId = undefined;
      }

      const { data: inserted, error: insErr } = await pipelineDb
        .from("project_pipeline_runs")
        .insert(payload)
        .select("id")
        .single();
      if (insErr) {
        if (idempotencyKey && insErr.code === "23505") {
          const { data: existing } = await pipelineDb
            .from("project_pipeline_runs")
            .select("id")
            .eq("project_id", projectId)
            .eq("idempotency_key", idempotencyKey)
            .maybeSingle();
          if (existing?.id) {
            runId = existing.id as string;
            await pipelineDb.from("project_pipeline_runs").update(payload).eq("id", runId);
            return;
          }
        }
        console.warn("[intake-pipeline] pipeline run insert failed:", insErr.message);
        return;
      }
      if (inserted?.id) {
        runId = inserted.id as string;
      }
    };

    if (!runId && !cursor) {
      await persistRun({ status: "running", current_stage: "comment_parser", stages });
    }

    let effectiveResumeFrom = resumeFromStage;
    if (resumePipeline && !effectiveResumeFrom) {
      for (const stage of stageOrder()) {
        const st = stages[stage]?.status;
        if (st === "failed" || st === "pending" || st === "running") {
          effectiveResumeFrom = stage;
          break;
        }
      }
    }

    const baseUrl = `${supabaseUrl.replace(/\/$/, "")}/functions/v1`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Authorization": authHeader,
      "apikey": anonKey,
    };

    type ParserResult = {
      parsed_count?: number;
      skipped_count?: number;
      skipped_breakdown?: Record<string, number>;
      insert_error_count?: number;
      reconciliation?: Record<string, unknown>;
      pipeline_evidence?: Record<string, unknown>;
      portal_refresh?: Record<string, number>;
      portal_refresh_failed?: boolean;
      error?: string;
      code?: number;
      next_cursor?: { pdfIndex: number };
      done?: boolean;
      total_pdfs?: number;
      reason?: string;
      message?: string;
    };

    let commentParserResult: ParserResult = {};

    const runParser = !enrichmentOnly && !routingOnly && shouldRunStage("comment_parser", stages, effectiveResumeFrom) &&
      (resumePipeline || !stages.comment_parser ||
        stages.comment_parser.status === "pending" ||
        stages.comment_parser.status === "failed" ||
        stages.comment_parser.status === "running" ||
        forceRetry);

    if (runParser) {
      stages.comment_parser = { status: "running" };
      await persistRun({ current_stage: "comment_parser", stages });

      const parserStart = Date.now();
      console.log("[intake-pipeline] comment-parser start");
      try {
        const capturePipelineEvidence = body.capture_pipeline_evidence === true;
        const commentParserRes = await fetchWithTimeout(`${baseUrl}/comment-parser-agent`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            project_id: projectId,
            cursor,
            max_pdfs: 2,
            ...(fullRefresh ? { full_refresh: true } : {}),
            ...(capturePipelineEvidence ? { capture_pipeline_evidence: true } : {}),
          }),
          timeoutMs: parserTimeout,
        });
        const commentParserText = await commentParserRes.text();
        const bodyPreview = commentParserText.slice(0, 200);
        console.log("[intake-pipeline] comment-parser end status=" + commentParserRes.status + " bodyPreview=" + bodyPreview);

        let commentParserJson: Record<string, unknown> = {};
        try {
          commentParserJson = commentParserText ? JSON.parse(commentParserText) : {};
        } catch (parseErr) {
          console.warn("comment-parser response not JSON:", parseErr);
        }

        if (!commentParserRes.ok || commentParserJson.portal_refresh_failed === true) {
          const errMsg = (commentParserJson.message ?? commentParserJson.error ?? commentParserRes.statusText) as string;
          commentParserResult = {
            error: errMsg,
            code: (commentParserJson.code as number) ?? commentParserRes.status,
            reason: commentParserJson.reason as string | undefined,
            message: commentParserJson.message as string | undefined,
            done: commentParserJson.done === true,
          };
          stages.comment_parser = { status: "failed", error: errMsg };
          await persistRun({
            status: "failed",
            current_stage: "comment_parser",
            stages,
            error_message: errMsg,
          });
        } else {
          commentParserResult = {
            parsed_count: (commentParserJson.parsed_count as number) ?? 0,
            skipped_count: (commentParserJson.skipped_count as number) ?? 0,
            skipped_breakdown: commentParserJson.skipped_breakdown as Record<string, number> | undefined,
            insert_error_count: (commentParserJson.insert_error_count as number) ?? 0,
            reconciliation: commentParserJson.reconciliation as Record<string, unknown> | undefined,
            pipeline_evidence: commentParserJson.pipeline_evidence as Record<string, unknown> | undefined,
            portal_refresh: commentParserJson.portal_refresh as Record<string, number> | undefined,
            next_cursor: commentParserJson.next_cursor as { pdfIndex: number } | undefined,
            done: commentParserJson.done === true,
            total_pdfs: commentParserJson.total_pdfs as number | undefined,
            reason: commentParserJson.reason as string | undefined,
            message: commentParserJson.message as string | undefined,
          };
          if (commentParserResult.done) {
            stages.comment_parser = {
              status: "completed",
              parsed_count: commentParserResult.parsed_count,
            };
          }
        }
      } catch (err) {
        const isTimeout = err instanceof Error && err.name === "AbortError";
        const errMsg = isTimeout ? "timeout" : (err instanceof Error ? err.message : "Unknown error");
        commentParserResult = { error: errMsg, done: false };
        stages.comment_parser = { status: "failed", error: errMsg };
        await persistRun({
          status: "failed",
          current_stage: "comment_parser",
          stages,
          error_message: errMsg,
        });
        console.log("[intake-pipeline] comment-parser timeout or error:", errMsg);
      }
      console.log("[intake-pipeline] comment-parser duration ms:", Date.now() - parserStart);
    } else if (stages.comment_parser?.status === "completed") {
      commentParserResult = { done: true, parsed_count: stages.comment_parser.parsed_count };
    }

    const parserDone = enrichmentOnly || routingOnly ||
      (commentParserResult.done === true && !commentParserResult.error) ||
      stages.comment_parser?.status === "completed";
    if (!parserDone) {
      if (!commentParserResult.error) {
        await persistRun({ current_stage: "comment_parser", stages });
      }
      return new Response(
        JSON.stringify({
          project_id: projectId,
          pipeline_run_id: runId,
          comment_parser: commentParserResult,
          discipline_classifier: stages.discipline_classifier ?? { status: "pending" },
          enrichment: stages.enrichment ?? { status: "pending" },
          auto_routing: stages.auto_routing ?? { status: "pending" },
          stages,
          next_action: commentParserResult.error ? "retry_parser" : "poll_again",
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    await persistRun({ current_stage: "discipline_classifier", stages });

    let disciplineClassifierResult: { classified_count?: number; error?: string; code?: number; status?: StageStatus } =
      stages.discipline_classifier?.status === "completed"
        ? { classified_count: stages.discipline_classifier.classified_count, status: "completed" }
        : {};

    const runClassifier = !enrichmentOnly && !routingOnly && shouldRunStage("discipline_classifier", stages, effectiveResumeFrom) &&
      stages.discipline_classifier?.status !== "completed";

    if (runClassifier) {
      stages.discipline_classifier = { status: "running" };
      await persistRun({ current_stage: "discipline_classifier", stages });

      const classifierStart = Date.now();
      console.log("[intake-pipeline] discipline-classifier start");
      try {
        const { ok, json } = await invokeJson(
          `${baseUrl}/discipline-classifier-agent`,
          headers,
          { project_id: projectId },
          classifierTimeout,
        );
        if (!ok) {
          const errMsg = (json.message ?? json.error ?? "Classifier failed") as string;
          disciplineClassifierResult = { error: errMsg, code: json.code as number | undefined, status: "failed" };
          stages.discipline_classifier = { status: "failed", error: errMsg };
          await persistRun({
            status: "failed",
            current_stage: "discipline_classifier",
            stages,
            error_message: errMsg,
          });
        } else {
          const classified = (json.classified_count as number) ?? 0;
          disciplineClassifierResult = { classified_count: classified, status: "completed" };
          stages.discipline_classifier = { status: "completed", classified_count: classified };
        }
      } catch (err) {
        const isTimeout = err instanceof Error && err.name === "AbortError";
        const errMsg = isTimeout ? "timeout" : (err instanceof Error ? err.message : "Unknown error");
        disciplineClassifierResult = { error: errMsg, status: "failed" };
        stages.discipline_classifier = { status: "failed", error: errMsg };
        await persistRun({
          status: "failed",
          current_stage: "discipline_classifier",
          stages,
          error_message: errMsg,
        });
      }
      console.log("[intake-pipeline] discipline-classifier duration ms:", Date.now() - classifierStart);
    }

    if (disciplineClassifierResult.error) {
      return new Response(
        JSON.stringify({
          project_id: projectId,
          pipeline_run_id: runId,
          comment_parser: commentParserResult,
          discipline_classifier: disciplineClassifierResult,
          enrichment: { status: "pending" },
          auto_routing: { status: "pending" },
          stages,
          next_action: "retry_classifier",
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // One heavy stage per request after classifier to avoid edge-function timeouts.
    if (
      runClassifier &&
      stages.discipline_classifier?.status === "completed" &&
      !enrichmentOnly &&
      !routingOnly
    ) {
      await persistRun({ current_stage: "enrichment", stages });
      return new Response(
        JSON.stringify({
          project_id: projectId,
          pipeline_run_id: runId,
          comment_parser: commentParserResult,
          discipline_classifier: disciplineClassifierResult,
          enrichment: stages.enrichment ?? { status: "pending" },
          auto_routing: stages.auto_routing ?? { status: "pending" },
          stages,
          next_action: "poll_again",
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    let enrichmentResult: {
      enriched_count?: number;
      error?: string;
      status?: StageStatus;
      halted_reason?: string;
      eligible_count?: number;
      fetched_count?: number;
      remaining?: number;
      rounds?: number;
    } =
      stages.enrichment?.status === "completed"
        ? { enriched_count: stages.enrichment.enriched_count, status: "completed" }
        : {};

    const runEnrichment = (
      enrichmentOnly ||
      (!routingOnly && shouldRunStage("enrichment", stages, effectiveResumeFrom))
    ) && (
      (forceRetry && (enrichmentOnly || resumeFromStage === "enrichment")) ||
      stages.enrichment?.status !== "completed"
    );

    if (runEnrichment) {
      stages.enrichment = { status: "running" };
      await persistRun({ current_stage: "enrichment", stages });

      console.log("[intake-pipeline] context-reference-engine start (batched)");
      let totalEnriched = 0;
      let totalFetched = 0;
      let pipelineRounds = 0;
      let eligibleCount: number | undefined;
      let remaining: number | undefined;
      let halted: string | undefined;
      let needsContinue = false;
      const enrichStartedAt = Date.now();

      try {
        // One engine invoke = one BATCH_SIZE (20) OpenAI round. Continue until drained
        // so large projects (e.g. 62 comments) are fully enriched without a single
        // long request that hits the edge/parent timeout after ~20 rows.
        while (pipelineRounds < ENRICHMENT_MAX_PIPELINE_ROUNDS) {
          if (
            pipelineRounds > 0 &&
            Date.now() - enrichStartedAt > ENRICHMENT_INVOKE_BUDGET_MS
          ) {
            needsContinue = true;
            halted =
              `Enrichment pause after ${pipelineRounds} batch(es) to avoid timeout; ` +
              `${remaining ?? "more"} comments still need enrichment`;
            break;
          }

          pipelineRounds++;
          const { ok, json } = await invokeJson(
            `${baseUrl}/context-reference-engine`,
            headers,
            { project_id: projectId, projectId, max_rounds: 1 },
            enrichmentTimeout,
          );

          if (!ok) {
            const errMsg = (json.message ?? json.error ?? "Enrichment failed") as string;
            enrichmentResult = {
              error: errMsg,
              status: "failed",
              enriched_count: totalEnriched,
              eligible_count: eligibleCount,
              fetched_count: totalFetched,
              remaining,
              rounds: pipelineRounds,
            };
            stages.enrichment = { status: "failed", error: errMsg, enriched_count: totalEnriched };
            await persistRun({
              status: "failed",
              current_stage: "enrichment",
              stages,
              error_message: errMsg,
            });
            halted = errMsg;
            break;
          }

          const batchEnriched = (json.enriched_count as number) ?? 0;
          const batchFetched = (json.fetched_count as number) ?? 0;
          totalEnriched += batchEnriched;
          totalFetched += batchFetched;
          if (typeof json.eligible_count === "number" && eligibleCount == null) {
            eligibleCount = json.eligible_count;
          }
          if (typeof json.remaining === "number") {
            remaining = json.remaining;
          }
          const batchHalted = (json.halted_reason ?? json.warning ?? json.error) as string | undefined;

          console.log(
            JSON.stringify({
              event: "intake-pipeline.enrichment.batch",
              project_id: projectId,
              pipeline_round: pipelineRounds,
              batch_enriched: batchEnriched,
              batch_fetched: batchFetched,
              total_enriched: totalEnriched,
              remaining,
              has_more: json.has_more === true,
              halted_reason: batchHalted ?? null,
            }),
          );

          if (batchHalted && json.has_more !== true && batchEnriched === 0 && totalEnriched === 0) {
            enrichmentResult = {
              error: batchHalted,
              status: "failed",
              enriched_count: 0,
              eligible_count: eligibleCount,
              fetched_count: totalFetched,
              remaining,
              rounds: pipelineRounds,
              halted_reason: batchHalted,
            };
            stages.enrichment = { status: "failed", error: batchHalted };
            await persistRun({
              status: "failed",
              current_stage: "enrichment",
              stages,
              error_message: batchHalted,
            });
            halted = batchHalted;
            break;
          }

          if (json.has_more !== true) {
            halted = batchHalted;
            enrichmentResult = {
              enriched_count: totalEnriched,
              status: halted ? "completed_with_warnings" : "completed",
              halted_reason: halted,
              eligible_count: eligibleCount,
              fetched_count: totalFetched,
              remaining: remaining ?? 0,
              rounds: pipelineRounds,
            };
            stages.enrichment = {
              status: halted ? "completed_with_warnings" : "completed",
              enriched_count: totalEnriched,
            };
            break;
          }

          if (batchEnriched === 0) {
            halted = batchHalted ?? "Enrichment made no progress; stopping batch continuation";
            enrichmentResult = {
              enriched_count: totalEnriched,
              status: totalEnriched > 0 ? "completed_with_warnings" : "failed",
              error: totalEnriched > 0 ? undefined : halted,
              halted_reason: halted,
              eligible_count: eligibleCount,
              fetched_count: totalFetched,
              remaining,
              rounds: pipelineRounds,
            };
            stages.enrichment = {
              status: enrichmentResult.status as StageStatus,
              enriched_count: totalEnriched,
              error: enrichmentResult.error,
            };
            if (totalEnriched === 0) {
              await persistRun({
                status: "failed",
                current_stage: "enrichment",
                stages,
                error_message: halted,
              });
            }
            break;
          }
        }

        if (needsContinue && !enrichmentResult.status && !enrichmentResult.error) {
          enrichmentResult = {
            enriched_count: totalEnriched,
            status: "completed_with_warnings",
            halted_reason: halted,
            eligible_count: eligibleCount,
            fetched_count: totalFetched,
            remaining,
            rounds: pipelineRounds,
          };
          // Keep enrichment pending so a follow-up force_retry continues remaining rows.
          stages.enrichment = {
            status: "pending",
            enriched_count: totalEnriched,
          };
        } else if (!enrichmentResult.status && !enrichmentResult.error) {
          // Hit max pipeline rounds with work still remaining.
          halted =
            `Reached max enrichment rounds (${ENRICHMENT_MAX_PIPELINE_ROUNDS}); ` +
            `${remaining ?? "some"} comments may still need enrichment — run enrichment again`;
          enrichmentResult = {
            enriched_count: totalEnriched,
            status: "completed_with_warnings",
            halted_reason: halted,
            eligible_count: eligibleCount,
            fetched_count: totalFetched,
            remaining,
            rounds: pipelineRounds,
          };
          stages.enrichment = {
            status: "pending",
            enriched_count: totalEnriched,
          };
          needsContinue = true;
        }

        if (needsContinue) {
          (enrichmentResult as { needs_continue?: boolean }).needs_continue = true;
        }
      } catch (err) {
        const isTimeout = err instanceof Error && err.name === "AbortError";
        const errMsg = isTimeout ? "timeout" : (err instanceof Error ? err.message : "Unknown error");
        enrichmentResult = {
          error: errMsg,
          status: "failed",
          enriched_count: totalEnriched,
          eligible_count: eligibleCount,
          fetched_count: totalFetched,
          remaining,
          rounds: pipelineRounds,
        };
        stages.enrichment = { status: "failed", error: errMsg, enriched_count: totalEnriched };
        await persistRun({
          status: "failed",
          current_stage: "enrichment",
          stages,
          error_message: errMsg,
        });
      }
    }

    if (enrichmentResult.error) {
      return new Response(
        JSON.stringify({
          project_id: projectId,
          pipeline_run_id: runId,
          comment_parser: commentParserResult,
          discipline_classifier: disciplineClassifierResult,
          enrichment: enrichmentResult,
          auto_routing: { status: "pending" },
          stages,
          next_action: "retry_enrichment",
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Partial enrichment drain (timeout budget) — do not advance to routing yet.
    if (
      (enrichmentResult as { needs_continue?: boolean }).needs_continue === true &&
      body.run_enrichment_only !== true
    ) {
      await persistRun({ status: "running", current_stage: "enrichment", stages });
      return new Response(
        JSON.stringify({
          project_id: projectId,
          pipeline_run_id: runId,
          comment_parser: commentParserResult,
          discipline_classifier: disciplineClassifierResult,
          enrichment: enrichmentResult,
          auto_routing: stages.auto_routing ?? { status: "pending" },
          stages,
          next_action: "continue_enrichment",
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (
      runEnrichment &&
      (stages.enrichment?.status === "completed" ||
        stages.enrichment?.status === "completed_with_warnings") &&
      !routingOnly &&
      body.run_enrichment_only !== true
    ) {
      await persistRun({ current_stage: "auto_routing", stages });
      return new Response(
        JSON.stringify({
          project_id: projectId,
          pipeline_run_id: runId,
          comment_parser: commentParserResult,
          discipline_classifier: disciplineClassifierResult,
          enrichment: enrichmentResult,
          auto_routing: stages.auto_routing ?? { status: "pending" },
          stages,
          next_action: "poll_again",
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (body.run_enrichment_only === true) {
      const needsContinue =
        (enrichmentResult as { needs_continue?: boolean }).needs_continue === true;
      await persistRun({
        status: needsContinue ? "running" : "completed",
        current_stage: needsContinue ? "enrichment" : null,
        stages,
        completed_at: needsContinue ? null : new Date().toISOString(),
      });
      return new Response(
        JSON.stringify({
          project_id: projectId,
          pipeline_run_id: runId,
          enrichment: enrichmentResult,
          stages,
          next_action: needsContinue ? "continue_enrichment" : "complete",
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    let autoRoutingResult: { routed_count?: number; error?: string; status?: StageStatus } =
      stages.auto_routing?.status === "completed"
        ? { routed_count: stages.auto_routing.routed_count, status: "completed" }
        : {};

    const runRouter = (routingOnly || shouldRunStage("auto_routing", stages, effectiveResumeFrom)) &&
      stages.auto_routing?.status !== "completed";

    if (runRouter) {
      stages.auto_routing = { status: "running" };
      await persistRun({ current_stage: "auto_routing", stages });

      console.log("[intake-pipeline] auto-router-agent start");
      try {
        const { ok, json } = await invokeJson(
          `${baseUrl}/auto-router-agent`,
          headers,
          { project_id: projectId, projectId },
          routerTimeout,
        );
        if (!ok) {
          const errMsg = (json.message ?? json.error ?? "Auto routing failed") as string;
          autoRoutingResult = { error: errMsg, status: "failed" };
          stages.auto_routing = { status: "failed", error: errMsg };
          await persistRun({
            status: "failed",
            current_stage: "auto_routing",
            stages,
            error_message: errMsg,
          });
        } else {
          const routed = (json.routed_count as number) ?? 0;
          autoRoutingResult = { routed_count: routed, status: "completed" };
          stages.auto_routing = { status: "completed", routed_count: routed };
        }
      } catch (err) {
        const isTimeout = err instanceof Error && err.name === "AbortError";
        const errMsg = isTimeout ? "timeout" : (err instanceof Error ? err.message : "Unknown error");
        autoRoutingResult = { error: errMsg, status: "failed" };
        stages.auto_routing = { status: "failed", error: errMsg };
        await persistRun({
          status: "failed",
          current_stage: "auto_routing",
          stages,
          error_message: errMsg,
        });
      }
    }

    if (autoRoutingResult.error) {
      return new Response(
        JSON.stringify({
          project_id: projectId,
          pipeline_run_id: runId,
          comment_parser: commentParserResult,
          discipline_classifier: disciplineClassifierResult,
          enrichment: enrichmentResult,
          auto_routing: autoRoutingResult,
          stages,
          next_action: "retry_routing",
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (body.run_routing_only === true) {
      await persistRun({
        status: "completed",
        current_stage: null,
        stages,
        completed_at: new Date().toISOString(),
      });
      return new Response(
        JSON.stringify({
          project_id: projectId,
          pipeline_run_id: runId,
          auto_routing: autoRoutingResult,
          stages,
          next_action: "complete",
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const finalStatus = stages.enrichment?.status === "completed_with_warnings"
      ? "completed_with_warnings"
      : "completed";

    await persistRun({
      status: finalStatus,
      current_stage: null,
      stages,
      error_message: null,
      completed_at: new Date().toISOString(),
    });

    console.log("[intake-pipeline] total duration ms:", Date.now() - startTime);

    return new Response(
      JSON.stringify({
        project_id: projectId,
        pipeline_run_id: runId,
        comment_parser: commentParserResult,
        discipline_classifier: disciplineClassifierResult,
        enrichment: enrichmentResult,
        auto_routing: autoRoutingResult,
        stages,
        next_action: "complete",
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("[intake-pipeline] error:", error);
    return new Response(
      JSON.stringify({ code: 500, message: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
