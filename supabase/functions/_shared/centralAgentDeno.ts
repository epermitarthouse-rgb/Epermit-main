import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { runCentralStage, type CentralStage, type ChatCaller } from "./centralCommentProcessing.ts";
import { CENTRAL_PROCESSING_VERSION } from "./commentPrompts.ts";
import { isUuid } from "./serviceExecution.ts";
import { resolveCentralExecution } from "./serviceExecutionDeno.ts";

const BUDGET_SCOPE_RE = /^[a-z0-9][a-z0-9._-]{2,63}$/;

function json(body: unknown, status: number, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...headers, "Content-Type": "application/json" } });
}

const openAiChat: (apiKey: string) => ChatCaller = (apiKey) => async (req) => {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: req.model,
      messages: [
        { role: "system", content: req.system },
        { role: "user", content: req.user },
      ],
      max_tokens: req.maxTokens,
      temperature: 0,
      response_format: { type: "json_object" },
    }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`OpenAI HTTP ${res.status}: ${String(data?.error?.message ?? "").slice(0, 120)}`);
  return {
    content: data?.choices?.[0]?.message?.content ?? null,
    inputTokens: typeof data?.usage?.prompt_tokens === "number" ? data.usage.prompt_tokens : null,
    outputTokens: typeof data?.usage?.completion_tokens === "number" ? data.usage.completion_tokens : null,
  };
};

/**
 * `mode: "central"` of discipline-classifier-agent (classify) and context-reference-engine (enrich), D-121.
 * Off unless CENTRAL_PROCESSING_ENABLED=true; service secret + service key only; permit-level data only.
 */
export async function handleCentralStage(
  req: Request,
  body: Record<string, unknown>,
  stage: CentralStage,
  corsHeaders: Record<string, string>,
): Promise<Response> {
  if (Deno.env.get("CENTRAL_PROCESSING_ENABLED") !== "true") {
    return json({ error: "Central processing is disabled" }, 403, corsHeaders);
  }
  const auth = resolveCentralExecution(req);
  if ("error" in auth) return json({ error: auth.error }, auth.status, corsHeaders);

  const permitId = body.permit_id;
  const version = body.processing_version;
  const budgetScope = body.budget_scope;
  if (!isUuid(permitId)) return json({ error: "permit_id is required" }, 400, corsHeaders);
  if (version !== CENTRAL_PROCESSING_VERSION) {
    // Results are labelled with the version of the prompts in this deployment; never with another one.
    return json({ error: `processing_version mismatch (deployed: ${CENTRAL_PROCESSING_VERSION})` }, 409, corsHeaders);
  }
  if (typeof budgetScope !== "string" || !BUDGET_SCOPE_RE.test(budgetScope)) {
    return json({ error: "budget_scope is required" }, 400, corsHeaders);
  }
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!apiKey || !url || !serviceKey) return json({ error: "Central processing is not configured" }, 500, corsHeaders);

  const budgetMs = Math.max(10_000, Math.min(120_000, Number(body.budget_ms) || 60_000));
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  try {
    const result = await runCentralStage({
      stage,
      db: { rpc: (fn, args) => admin.rpc(fn, args) },
      ai: openAiChat(apiKey),
      permitId,
      version,
      budgetScope,
      deadline: Date.now() + budgetMs,
    });
    return json(result, 200, corsHeaders);
  } catch (e) {
    return json({ stage, error: String((e as Error)?.message ?? e).slice(0, 300) }, 500, corsHeaders);
  }
}
