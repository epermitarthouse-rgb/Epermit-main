/**
 * permit-comment-pipeline (D-113). Moves linked-permit comments into the Response Matrix without a browser.
 *
 *   action "sweep"   service-role bearer (pg_cron via invoke_permit_comment_pipeline(), or the deep worker):
 *                    claims projects whose linked-permit comment fingerprint is not yet processed.
 *   action "process" signed-in user with edit access to `project_id` ("Process comments now" / "Try again"):
 *                    records the request (audited), then processes that project.
 *
 * Each claimed project runs through intake-pipeline-agent in service mode as the project owner (D-063), in the
 * background (EdgeRuntime.waitUntil), within PERMIT_PIPELINE_BUDGET_MS. Unfinished work is released and resumes
 * on the next sweep. Not deployed automatically.
 *
 * Env: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, PERMITPILOT_SERVICE_PIPELINE_SECRET,
 *      PERMIT_PIPELINE_BUDGET_MS (default 140000; keep below the plan's edge wall-clock limit).
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { verifyProcessorRequest } from "../_shared/processorAuth.ts";
import { serviceForwardHeadersFromEnv } from "../_shared/serviceExecutionDeno.ts";
import { driveClaimedProject, type ClaimedProject } from "../_shared/permitCommentPipeline.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SWEEP_LIMIT = 2;

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceKey) return json({ error: "not_configured" }, 500);
  if (!Deno.env.get("PERMITPILOT_SERVICE_PIPELINE_SECRET")) {
    console.log(JSON.stringify({ event: "permit_comment_pipeline_skipped", reason: "service_mode_disabled" }));
    return json({ error: "Comment processing is not enabled yet." }, 503);
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  let projectIds: string[] | null = null;

  if (verifyProcessorRequest(req).authorized) {
    if (Array.isArray(body.project_ids)) {
      projectIds = body.project_ids.filter((id): id is string => typeof id === "string" && UUID.test(id)).slice(0, 50);
      if (projectIds.length === 0) return json({ claimed: 0 });
    }
  } else {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
    const projectId = typeof body.project_id === "string" && UUID.test(body.project_id) ? body.project_id : null;
    if (body.action !== "process" || !projectId) return json({ error: "project_id is required" }, 400);
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });
    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData?.user) return json({ error: "Unauthorized" }, 401);
    // Runs as the user: checks edit access and the link, records the request in the audit log.
    const { error: requestError } = await userClient.rpc("request_project_comment_processing", { p_project_id: projectId });
    if (requestError) {
      const status = requestError.code === "42501" ? 403 : requestError.code === "P0002" ? 404 : 400;
      return json({ error: requestError.message }, status);
    }
    projectIds = [projectId];
  }

  const budgetMs = Math.max(30_000, Number(Deno.env.get("PERMIT_PIPELINE_BUDGET_MS")) || 140_000);
  const workerId = `edge-${crypto.randomUUID()}`;
  const { data: claimed, error: claimError } = await admin.rpc("permit_pipeline_claim", {
    p_worker: workerId,
    p_limit: projectIds ? projectIds.length : SWEEP_LIMIT,
    p_lease_seconds: Math.ceil(budgetMs / 1000) + 120,
    p_project_ids: projectIds,
  });
  if (claimError) {
    console.error(JSON.stringify({ event: "permit_comment_pipeline_claim_failed", code: claimError.code }));
    return json({ error: "claim_failed" }, 500);
  }
  const claims = (claimed ?? []) as ClaimedProject[];
  if (claims.length === 0) return json({ claimed: 0 });

  const deadline = Date.now() + budgetMs;
  const intakeUrl = `${supabaseUrl.replace(/\/$/, "")}/functions/v1/intake-pipeline-agent`;
  const callIntake = async (actingUserId: string, payload: Record<string, unknown>) => {
    const res = await fetch(intakeUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: anonKey, ...serviceForwardHeadersFromEnv(actingUserId) },
      body: JSON.stringify(payload),
    });
    const text = await res.text();
    let data: Record<string, unknown> | null = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    return { status: res.status, data };
  };

  const work = (async () => {
    for (const c of claims) {
      const result = Date.now() < deadline
        ? await driveClaimedProject({ claim: c, callIntake, deadline })
        : { outcome: "released" as const, pipelineRunId: c.pipeline_run_id, rounds: 0 };
      const { data: finished, error: finishError } = await admin.rpc("permit_pipeline_finish", {
        p_project_id: c.project_id,
        p_worker: workerId,
        p_fingerprint: c.fingerprint,
        p_outcome: result.outcome,
        p_pipeline_run_id: result.pipelineRunId,
        p_error: "error" in result ? result.error ?? null : null,
      });
      console.log(JSON.stringify({
        event: "permit_comment_pipeline_project",
        project_id: c.project_id,
        outcome: result.outcome,
        state: finishError ? "finish_failed" : finished,
        rounds: result.rounds,
        attempts: c.attempts,
      }));
    }
  })().catch((e) => console.error(JSON.stringify({ event: "permit_comment_pipeline_failed", message: String(e?.message ?? e).slice(0, 200) })));

  if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) {
    EdgeRuntime.waitUntil(work);
  } else {
    await work;
  }
  return json({ claimed: claims.length, project_ids: claims.map((c) => c.project_id) }, 202);
});
