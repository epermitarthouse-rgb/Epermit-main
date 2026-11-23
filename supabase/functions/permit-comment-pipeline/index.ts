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
 * Central (permit-level) processing, D-121..D-124 (service bearer only):
 *   "sweep"             runs a central pass first when enabled, then the project pass above.
 *   "central_sweep"     central pass only (optionally for `permit_ids`; the deep worker sends these after a sync).
 *   "central_dry_run"   no AI: inventory and pending work of `adapter_key` (permit_central_backfill_inventory).
 *   "central_backfill"  one-off pass over `adapter_key` against `budget_scope`; refused unless `approved: true` and
 *                       the budget row is approved and open. Every model call is reserved against the budget first.
 * The central pass runs only with CENTRAL_PROCESSING_ENABLED=true. Sweeps draw on CENTRAL_AI_BUDGET_SCOPE, except
 * for the permits of an adapter whose permit_sync_sources row names settings.central_budget_scope (D-147).
 *
 * Env: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, PERMITPILOT_SERVICE_PIPELINE_SECRET,
 *      PERMIT_PIPELINE_BUDGET_MS (default 140000; keep below the plan's edge wall-clock limit),
 *      CENTRAL_PROCESSING_ENABLED, CENTRAL_AI_BUDGET_SCOPE.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { verifyProcessorRequest } from "../_shared/processorAuth.ts";
import { centralForwardHeadersFromEnv, serviceForwardHeadersFromEnv } from "../_shared/serviceExecutionDeno.ts";
import { driveClaimedProject, type ClaimedProject } from "../_shared/permitCommentPipeline.ts";
import { driveCentralPermit, type CentralClaim, type CentralStage } from "../_shared/centralCommentProcessing.ts";
import { CENTRAL_PROCESSING_VERSION } from "../_shared/commentPrompts.ts";
import {
  BUDGET_SCOPE,
  hasSourceScopes,
  planPermitPasses,
  planSweepPasses,
  sourceScopes,
  type CentralPassPlan,
  type SourceScopes,
} from "../_shared/centralBudgetScopes.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SWEEP_LIMIT = 2;
const CENTRAL_SWEEP_LIMIT = 2;
const BACKFILL_LIMIT = 4;
const ADAPTER_KEY = /^[a-z0-9][a-z0-9-]{1,40}$/;
const CENTRAL_ACTIONS = new Set(["central_sweep", "central_dry_run", "central_backfill"]);

type Admin = {
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>;
};

/** Claims and drives permits through the central stages until `deadline`; one finish call per claim. */
async function runCentralPass(input: {
  admin: Admin;
  supabaseUrl: string;
  budgetScope: string;
  deadline: number;
  limit: number;
  permitIds: string[] | null;
  adapterKey: string | null;
}): Promise<{ claimed: number; results: Array<Record<string, unknown>> }> {
  const { admin, supabaseUrl, budgetScope, deadline } = input;
  const workerId = `central-${crypto.randomUUID()}`;
  const { data: claimed, error } = await admin.rpc("permit_central_claim", {
    p_worker: workerId,
    p_version: CENTRAL_PROCESSING_VERSION,
    p_limit: input.limit,
    p_lease_seconds: Math.ceil(Math.max(0, deadline - Date.now()) / 1000) + 120,
    p_permit_ids: input.permitIds,
    p_adapter_key: input.adapterKey,
  });
  if (error) {
    console.error(JSON.stringify({ event: "permit_central_claim_failed", code: error.code }));
    return { claimed: 0, results: [] };
  }
  const claims = (claimed ?? []) as CentralClaim[];
  const base = supabaseUrl.replace(/\/$/, "");
  const invoke = async (stage: CentralStage, payload: Record<string, unknown>) => {
    const fn = stage === "classify" ? "discipline-classifier-agent" : "context-reference-engine";
    const res = await fetch(`${base}/functions/v1/${fn}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...centralForwardHeadersFromEnv() },
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
  const results: Array<Record<string, unknown>> = [];
  for (const c of claims) {
    const r = Date.now() < deadline
      ? await driveCentralPermit({ claim: c, invoke, version: CENTRAL_PROCESSING_VERSION, budgetScope, deadline })
      : { outcome: "released" as const, rounds: 0, ai_calls: 0, cost_usd: 0 };
    const { data: state, error: finishError } = await admin.rpc("permit_central_finish", {
      p_permit_id: c.permit_id,
      p_worker: workerId,
      p_fingerprint: c.fingerprint,
      p_version: CENTRAL_PROCESSING_VERSION,
      p_outcome: r.outcome,
      p_error: "error" in r ? r.error ?? null : null,
    });
    const row = {
      event: "permit_central_permit",
      permit_id: c.permit_id,
      outcome: r.outcome,
      state: finishError ? "finish_failed" : state,
      rounds: r.rounds,
      ai_calls: r.ai_calls,
      cost_usd: Number(r.cost_usd.toFixed(6)),
    };
    console.log(JSON.stringify(row));
    results.push(row);
    if (r.outcome === "paused") break; // budget refused: the remaining claims are released below
  }
  for (const c of claims.slice(results.length)) {
    await admin.rpc("permit_central_finish", {
      p_permit_id: c.permit_id,
      p_worker: workerId,
      p_fingerprint: c.fingerprint,
      p_version: CENTRAL_PROCESSING_VERSION,
      p_outcome: "paused",
      p_error: "budget",
    });
  }
  return { claimed: claims.length, results };
}

type Reader = {
  from: (table: string) => {
    select: (cols: string) => PromiseLike<{ data: unknown; error: unknown }> & {
      in: (col: string, vals: string[]) => PromiseLike<{ data: unknown; error: unknown }>;
    };
  };
};

/** Source budget scopes (D-147). A read error leaves only the fallback scope, which is the pre-D-147 behaviour. */
async function loadSourceScopes(reader: Reader): Promise<SourceScopes> {
  const { data, error } = await reader.from("permit_sync_sources").select("adapter_key, settings");
  if (error) {
    console.error(JSON.stringify({ event: "permit_central_scopes_failed" }));
    return sourceScopes([]);
  }
  const s = sourceScopes((data ?? []) as Array<{ adapter_key: string | null; settings: Record<string, unknown> | null }>);
  if (s.conflicts.length) console.error(JSON.stringify({ event: "permit_central_scope_conflict", adapters: s.conflicts }));
  return s;
}

/** Runs the planned passes one after another until the shared deadline; results are concatenated. */
async function runPlannedPasses(
  plans: CentralPassPlan[],
  base: { admin: Admin; supabaseUrl: string; deadline: number; limit: number },
): Promise<{ claimed: number; results: Array<Record<string, unknown>> }> {
  const out = { claimed: 0, results: [] as Array<Record<string, unknown>> };
  for (const p of plans) {
    if (Date.now() >= base.deadline) break;
    const r = await runCentralPass({
      admin: base.admin,
      supabaseUrl: base.supabaseUrl,
      budgetScope: p.budgetScope,
      deadline: base.deadline,
      limit: p.permitIds ? p.permitIds.length : base.limit,
      permitIds: p.permitIds,
      adapterKey: p.adapterKey,
    });
    out.claimed += r.claimed;
    out.results.push(...r.results);
  }
  return out;
}

const sweepRotation = () => Math.floor(Date.now() / 300_000);

function centralEnabled(): boolean {
  return Deno.env.get("CENTRAL_PROCESSING_ENABLED") === "true";
}

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
  const budgetMs = Math.max(30_000, Number(Deno.env.get("PERMIT_PIPELINE_BUDGET_MS")) || 140_000);
  const startedAt = Date.now();
  const isService = verifyProcessorRequest(req).authorized;
  const action = typeof body.action === "string" ? body.action : "sweep";

  if (CENTRAL_ACTIONS.has(action)) {
    if (!isService) return json({ error: "Unauthorized" }, 401);
    const adapterKey = typeof body.adapter_key === "string" && ADAPTER_KEY.test(body.adapter_key) ? body.adapter_key : null;

    if (action === "central_dry_run") {
      const { data, error } = await admin.rpc("permit_central_backfill_inventory", {
        p_version: CENTRAL_PROCESSING_VERSION,
        p_adapter_key: adapterKey,
      });
      if (error) return json({ error: "inventory_failed" }, 500);
      return json({ dry_run: true, processing_version: CENTRAL_PROCESSING_VERSION, inventory: data, ai_calls: 0 });
    }

    if (!centralEnabled()) return json({ error: "Central processing is disabled" }, 403);
    let plans: CentralPassPlan[];
    let limit = CENTRAL_SWEEP_LIMIT;
    if (action === "central_backfill") {
      // Explicit, per-request approval on top of an approved budget row: a cron or worker never sends this.
      if (body.approved !== true) return json({ error: "central_backfill requires approved: true" }, 403);
      if (!adapterKey) return json({ error: "adapter_key is required" }, 400);
      const budgetScope = typeof body.budget_scope === "string" && BUDGET_SCOPE.test(body.budget_scope) ? body.budget_scope : null;
      if (!budgetScope) return json({ error: "budget_scope is required" }, 400);
      const { data: status, error } = await admin.rpc("permit_ai_budget_status", { p_scope: budgetScope });
      const st = (status ?? {}) as Record<string, unknown>;
      if (error || !status) return json({ error: "budget not found" }, 403);
      if (st.approved !== true || st.closed === true) return json({ error: "budget is not approved or is closed", budget: st }, 403);
      limit = BACKFILL_LIMIT;
      plans = [{ adapterKey, budgetScope, permitIds: null }];
    } else {
      const fallback = Deno.env.get("CENTRAL_AI_BUDGET_SCOPE")?.trim() || null;
      const scopes = await loadSourceScopes(admin as unknown as Reader);
      if ((!fallback || !BUDGET_SCOPE.test(fallback)) && !hasSourceScopes(scopes)) {
        return json({ error: "CENTRAL_AI_BUDGET_SCOPE is not set" }, 503);
      }
      if (Array.isArray(body.permit_ids)) {
        const permitIds = body.permit_ids.filter((id): id is string => typeof id === "string" && UUID.test(id)).slice(0, 50);
        if (permitIds.length === 0) return json({ claimed: 0 });
        let permits: Array<{ id: string; adapter_key: string | null }> = [];
        if (hasSourceScopes(scopes)) {
          const { data, error } = await admin.from("permits").select("id, adapter_key").in("id", permitIds);
          if (error) return json({ error: "permit lookup failed" }, 500);
          permits = (data ?? []) as typeof permits;
        }
        plans = planPermitPasses(scopes, fallback, permitIds, permits);
      } else {
        plans = planSweepPasses(scopes, fallback, sweepRotation());
      }
      if (plans.length === 0) return json({ claimed: 0 });
    }
    const centralRun = runPlannedPasses(plans, {
      admin,
      supabaseUrl,
      deadline: startedAt + budgetMs,
      limit,
    }).catch((e) => {
      console.error(JSON.stringify({ event: "permit_central_pass_failed", message: String(e?.message ?? e).slice(0, 200) }));
      return { claimed: 0, results: [] };
    });
    if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) {
      EdgeRuntime.waitUntil(centralRun);
      return json({ accepted: true, action, processing_version: CENTRAL_PROCESSING_VERSION }, 202);
    }
    return json(await centralRun, 200);
  }

  if (isService) {
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

  const workerId = `edge-${crypto.randomUUID()}`;
  const claimProjects = async (): Promise<ClaimedProject[] | null> => {
    const { data: claimed, error: claimError } = await admin.rpc("permit_pipeline_claim", {
      p_worker: workerId,
      p_limit: projectIds ? projectIds.length : SWEEP_LIMIT,
      p_lease_seconds: Math.ceil(Math.max(30_000, startedAt + budgetMs - Date.now()) / 1000) + 120,
      p_project_ids: projectIds,
    });
    if (claimError) {
      console.error(JSON.stringify({ event: "permit_comment_pipeline_claim_failed", code: claimError.code }));
      return null;
    }
    return (claimed ?? []) as ClaimedProject[];
  };

  // A cron sweep runs a central pass first (permit-level, shared by every project), using up to half of the
  // budget, and claims projects after it, so a project reuses results made in the same sweep (no double cost).
  const sweepPlans = isService && !projectIds && centralEnabled()
    ? planSweepPasses(await loadSourceScopes(admin as unknown as Reader), Deno.env.get("CENTRAL_AI_BUDGET_SCOPE"), sweepRotation())
    : [];
  const runCentral = sweepPlans.length > 0;
  let claims: ClaimedProject[] = [];
  if (!runCentral) {
    const c = await claimProjects();
    if (!c) return json({ error: "claim_failed" }, 500);
    if (c.length === 0) return json({ claimed: 0 });
    claims = c;
  }

  const deadline = startedAt + budgetMs;
  const intakeUrl = `${supabaseUrl.replace(/\/$/, "")}/functions/v1/intake-pipeline-agent`;
  const callIntake = async (actingUserId: string, payload: Record<string, unknown>) => {
    const res = await fetch(intakeUrl, {
      method: "POST",
      // apikey and Authorization both come from serviceForwardHeadersFromEnv: one key kind (never the anon key).
      headers: { "Content-Type": "application/json", ...serviceForwardHeadersFromEnv(actingUserId) },
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
    if (runCentral) {
      await runPlannedPasses(sweepPlans, {
        admin,
        supabaseUrl,
        deadline: startedAt + Math.floor(budgetMs / 2),
        limit: CENTRAL_SWEEP_LIMIT,
      }).catch((e) => console.error(JSON.stringify({ event: "permit_central_pass_failed", message: String(e?.message ?? e).slice(0, 200) })));
      if (deadline - Date.now() < 30_000) return;
      claims = (await claimProjects()) ?? [];
    }
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
  if (runCentral) return json({ accepted: true, central: true }, 202);
  return json({ claimed: claims.length, project_ids: claims.map((c) => c.project_id) }, 202);
});
