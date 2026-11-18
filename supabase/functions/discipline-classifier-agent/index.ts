import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { serviceUserResponse } from "../_shared/serviceExecution.ts";
import { resolveServiceExecution } from "../_shared/serviceExecutionDeno.ts";
import { handleCentralStage } from "../_shared/centralAgentDeno.ts";
import { CLASSIFIER_CHUNK, CLASSIFIER_SYSTEM_PROMPT, parseClassifications, type Classification } from "../_shared/commentPrompts.ts";
import {
  CLASSIFIER_ELIGIBLE_OR_FILTERS,
  runClassifierLoop,
  type ClassifierRow,
  type RowUpdate,
} from "../_shared/commentProcessingStatus.ts";
import OpenAI from "https://esm.sh/openai@4.28.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/** Default time budget of one incremental call; the caller continues while `has_more` (D-130). */
const DEFAULT_BUDGET_MS = 50_000;
/** A chunk is not started with less than this left (one model call). */
const CHUNK_RESERVE_MS = 20_000;

type Row = ClassifierRow & { original_text: string; project_id: string; discipline: string | null };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const peek = await req.clone().json().catch(() => ({}));
    if (peek && typeof peek === "object" && (peek as Record<string, unknown>).mode === "central") {
      return await handleCentralStage(req, peek as Record<string, unknown>, "classify", corsHeaders);
    }

    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    if (!OPENAI_API_KEY) return json({ code: 500, message: "OpenAI API key not configured" }, 500);

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !anonKey) return json({ code: 500, message: "SUPABASE_URL or SUPABASE_ANON_KEY not configured" }, 500);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return json({ code: 401, message: "Missing or invalid Authorization header" }, 401);
    }
    const token = authHeader.replace(/^\s*Bearer\s+/i, "").trim();
    if (!token) return json({ code: 401, message: "Invalid JWT" }, 401);

    const serviceAuth = await resolveServiceExecution(req, "discipline-classifier-agent", (b) => b.project_id);
    if ("error" in serviceAuth) return json({ code: serviceAuth.status, message: serviceAuth.error }, serviceAuth.status);

    const supabase = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false },
    });
    const { data: { user }, error: userError } = serviceAuth.mode === "service"
      ? serviceUserResponse(serviceAuth.actingUserId)
      : await supabase.auth.getUser();
    if (userError || !user) {
      console.warn("JWT validation failed:", userError?.message ?? "No user");
      return json({ code: 401, message: "Invalid JWT" }, 401);
    }

    const adminClient = serviceRoleKey ? createClient(supabaseUrl, serviceRoleKey) : supabase;

    const body = await req.json().catch(() => ({}));
    const projectId = body.project_id as string | undefined;
    /** When true (Classified Comments / manual refresh), classify every row for `project_id`. */
    const reclassifyAll = body.reclassify_all === true;
    /** Optional cap on rows sent in this call; without it an incremental call works until done or out of time. */
    const rowCap = typeof body.batch_limit === "number" && body.batch_limit > 0
      ? Math.min(body.batch_limit, 500)
      : (reclassifyAll ? 500 : Number.POSITIVE_INFINITY);
    const budgetMs = Math.max(10_000, Math.min(120_000, Number(body.budget_ms) || DEFAULT_BUDGET_MS));
    const deadline = Date.now() + budgetMs;

    let isShadowMode = false;
    if (projectId) {
      const { data: project } = await supabase
        .from("projects")
        .select("id, user_id, is_shadow_mode")
        .eq("id", projectId)
        .single();
      if (!project || project.user_id !== user.id) return json({ code: 404, message: "Project not found or access denied" }, 404);
      isShadowMode = project.is_shadow_mode === true;
    }

    const projectIdsResult = await supabase.from("projects").select("id").eq("user_id", user.id);
    const projectIds = (projectIdsResult.data ?? []).map((p: { id: string }) => p.id);
    if (projectIds.length === 0) return json({ classified_count: 0, remaining: 0, has_more: false });
    const projectFilter = projectId ? [projectId] : projectIds;

    if (reclassifyAll && !projectId) {
      return json({ code: 400, message: "reclassify_all requires project_id", classified_count: 0 }, 400);
    }

    let parsedCommentsTotalForProject: number | null = null;
    if (projectId) {
      const { count } = await adminClient
        .from("parsed_comments")
        .select("*", { count: "exact", head: true })
        .eq("project_id", projectId);
      parsedCommentsTotalForProject = count ?? null;
    }

    const COLUMNS = "id, original_text, project_id, discipline, processing_attempts";
    /** Incremental eligibility (D-130): unclassified, not set by a person, not set aside after repeated failures. */
    const eligible = () => {
      let q = adminClient.from("parsed_comments").select(COLUMNS).in("project_id", projectFilter);
      for (const f of CLASSIFIER_ELIGIBLE_OR_FILTERS) q = q.or(f);
      return q;
    };

    const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
    const totals = { classified: 0, failed: 0, needs_attention: 0, rows_sent: 0, shadow_logged: 0, labels: 0, other: 0 };

    const callModel = async (chunk: Row[]) => {
      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          { role: "system", content: CLASSIFIER_SYSTEM_PROMPT },
          { role: "user", content: chunk.map((c, i) => `[${i}] ${c.original_text}`).join("\n\n") },
        ],
        max_tokens: 8192,
        response_format: { type: "json_object" },
      });
      return parseClassifications(response.choices?.[0]?.message?.content, chunk.length);
    };
    const write = async (u: RowUpdate) => {
      const { error } = await adminClient.from("parsed_comments").update(u.patch).eq("id", u.id);
      if (error) console.warn("parsed_comments update failed for comment", u.id, error.message);
      return !error;
    };
    const onClassified = async (row: Row, c: Classification) => {
      totals.labels++;
      if (c.discipline === "Other") totals.other++;
      if (isShadowMode) {
        const { error: shadowErr } = await adminClient.from("shadow_predictions").insert({
          project_id: row.project_id,
          comment_id: row.id,
          agent_name: "Discipline Classifier",
          prediction_data: { ai_discipline: c.discipline, assigned_discipline: c.discipline },
          confidence_score: c.confidence,
          match_status: "match",
        });
        if (shadowErr) console.warn("shadow_predictions insert failed for comment", row.id, shadowErr.message);
        else totals.shadow_logged++;
      }
      const { error: auditErr } = await adminClient.from("audit_trail").insert({
        project_id: row.project_id,
        actor_id: "Discipline Classifier",
        action_type: "classification",
        routing_decision: isShadowMode ? "shadow_match" : "live_update",
        input_hash: row.id,
      });
      if (auditErr) console.warn("audit_trail insert failed for comment", row.id, auditErr.message);
    };

    let fetchError: string | null = null;
    const loop = async (fetchEligible: (limit: number) => Promise<Row[]>, cap: number) => {
      const r = await runClassifierLoop({
        fetchEligible,
        classify: callModel,
        write,
        onClassified,
        rowCap: cap,
        chunkSize: CLASSIFIER_CHUNK,
        deadline,
        reserveMs: CHUNK_RESERVE_MS,
      });
      totals.classified += r.classified;
      totals.failed += r.failed;
      totals.needs_attention += r.needs_attention;
      totals.rows_sent += r.rows_sent;
      return r;
    };

    try {
      if (reclassifyAll) {
        const { data, error } = await adminClient
          .from("parsed_comments")
          .select(COLUMNS)
          .in("project_id", projectFilter)
          .or("discipline_source.is.null,discipline_source.neq.human")
          .order("created_at", { ascending: true })
          .limit(rowCap);
        if (error) return json({ code: 500, message: error.message }, 500);
        // One pass over a fixed list (rows stay eligible after classification, so it is not re-queried).
        const queue = (data ?? []) as Row[];
        await loop(async (limit) => queue.splice(0, limit), queue.length);
      } else {
        const r = await loop(async (limit) => {
          const { data, error } = await eligible().order("created_at", { ascending: true }).limit(limit);
          if (error) {
            fetchError = error.message;
            return [];
          }
          return (data ?? []) as Row[];
        }, rowCap);
        if (fetchError) return json({ code: 500, message: fetchError, classified_count: totals.classified, has_more: true }, 500);
        if (r.stopped === "write_failed") {
          return json({ code: 500, message: "Could not save classifications", classified_count: totals.classified, has_more: true }, 500);
        }
      }
    } catch (e) {
      // Model or network error: nothing is marked done; the caller retries and resumes from the database.
      return json({
        code: 500,
        message: e instanceof Error ? e.message : "Model call failed",
        classified_count: totals.classified,
        failed_count: totals.failed,
        rows_sent: totals.rows_sent,
        has_more: true,
      }, 500);
    }

    let remaining = 0;
    if (!reclassifyAll) {
      const { count, error } = await adminClient
        .from("parsed_comments")
        .select("id", { count: "exact", head: true })
        .in("project_id", projectFilter)
        .or(CLASSIFIER_ELIGIBLE_OR_FILTERS[0])
        .or(CLASSIFIER_ELIGIBLE_OR_FILTERS[1])
        .or(CLASSIFIER_ELIGIBLE_OR_FILTERS[2]);
      remaining = error ? 1 : (count ?? 0);
    }

    if (totals.labels > 0 && totals.other / totals.labels > 0.5) {
      console.log("[WARN] Over 50% classified as Other — prompt may need tuning");
    }
    const mode = isShadowMode ? "shadow" : "live";
    console.log(
      `discipline-classifier [${mode}]: rows_sent=${totals.rows_sent}, classified=${totals.classified}, failed=${totals.failed}, needs_attention=${totals.needs_attention}, remaining=${remaining}, reclassify_all=${reclassifyAll}`,
    );

    return json({
      classified_count: totals.classified,
      failed_count: totals.failed,
      needs_attention_count: totals.needs_attention,
      rows_sent: totals.rows_sent,
      remaining,
      has_more: remaining > 0,
      parsed_comments_total: parsedCommentsTotalForProject ?? totals.rows_sent,
      reclassify_all: reclassifyAll,
      shadow_logged_count: totals.shadow_logged,
      mode,
    });
  } catch (error) {
    console.error("Error in discipline-classifier-agent:", error);
    return json({ code: 500, message: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});
