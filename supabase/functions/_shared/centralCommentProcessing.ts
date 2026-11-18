/**
 * Central (permit-level) comment processing (D-121..D-124). discipline-classifier-agent and
 * context-reference-engine run these in `mode: "central"`; the permit-comment-pipeline dispatcher drives them
 * per claimed permit. Inputs are permit-level only (comment text, department, type, jurisdiction): no project,
 * team, document or user data is read, so results are as shareable as the comment itself (permit RLS).
 *
 * Every AI call is reserved against an approved budget first (permit_ai_budget_reserve) and settled with the
 * real token usage after it, so a call that could pass the cap is never made. Work is chosen by the database
 * (permit_central_work: only comments without a result for their input hash and processing version), so a
 * re-run, a crash or a second invocation never pays twice for finished work.
 *
 * Pure module: the database (rpc), the model call and the clock are injected.
 */

import { costUsd, reservationUsd } from "./aiCost.ts";
import {
  CENTRAL_CLASSIFIER_MAX_TOKENS,
  CENTRAL_ENRICHMENT_MAX_TOKENS,
  CENTRAL_ENRICHMENT_PROMPT_VERSION,
  CENTRAL_ENRICHMENT_SYSTEM_PROMPT,
  CENTRAL_MODEL,
  CLASSIFIER_CHUNK,
  CLASSIFIER_PROMPT_VERSION,
  CLASSIFIER_SYSTEM_PROMPT,
  ENRICHMENT_CHUNK,
  centralBody,
  centralClassifierUserContent,
  centralEnrichmentUserContent,
  centralLimitations,
  codeBasis,
  parseCentralEnrichment,
  parseClassifications,
} from "./commentPrompts.ts";
import { stableHash } from "./permitRepositoryComments.ts";

export type CentralStage = "classify" | "enrich";

type RpcResult = { data: unknown; error: { message?: string; code?: string } | null };
export type CentralDb = { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<RpcResult> };

export type ChatRequest = { model: string; system: string; user: string; maxTokens: number };
export type ChatResult = { content: string | null; inputTokens: number | null; outputTokens: number | null };
export type ChatCaller = (req: ChatRequest) => Promise<ChatResult>;

export type WorkItem = {
  comment_id: string;
  input_hash: string;
  body: string | null;
  department: string | null;
  comment_type: string | null;
  jurisdiction: string | null;
  insight_id: string | null;
  discipline: string | null;
  discipline_confidence: number | null;
};

export type StageResult = {
  stage: CentralStage;
  processed: number;
  failed: number;
  ai_calls: number;
  cost_usd: number;
  batches: number;
  has_more: boolean;
  budget_exhausted?: boolean;
  budget_reason?: string;
  error?: string;
};

async function rpc<T>(db: CentralDb, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await db.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message ?? "failed"}`);
  return data as T;
}

export async function runCentralStage(input: {
  stage: CentralStage;
  db: CentralDb;
  ai: ChatCaller;
  permitId: string;
  version: string;
  budgetScope: string;
  deadline: number;
  now?: () => number;
  /** A batch is not started with less than this left (one model call). */
  reserveMs?: number;
  batchSize?: number;
}): Promise<StageResult> {
  const { stage, db, ai, permitId, version, budgetScope, deadline } = input;
  const now = input.now ?? (() => Date.now());
  const reserveMs = input.reserveMs ?? 25_000;
  const batchSize = input.batchSize ?? (stage === "classify" ? CLASSIFIER_CHUNK : ENRICHMENT_CHUNK);
  const out: StageResult = { stage, processed: 0, failed: 0, ai_calls: 0, cost_usd: 0, batches: 0, has_more: false };

  for (;;) {
    if (now() + reserveMs >= deadline) {
      out.has_more = true;
      return out;
    }
    const work = (await rpc<WorkItem[] | null>(db, "permit_central_work", {
      p_permit_id: permitId,
      p_version: version,
      p_stage: stage,
      p_limit: batchSize,
    })) ?? [];
    if (work.length === 0) return out;

    const system = stage === "classify" ? CLASSIFIER_SYSTEM_PROMPT : CENTRAL_ENRICHMENT_SYSTEM_PROMPT;
    const user = stage === "classify" ? centralClassifierUserContent(work) : centralEnrichmentUserContent(work);
    const maxTokens = stage === "classify" ? CENTRAL_CLASSIFIER_MAX_TOKENS : CENTRAL_ENRICHMENT_MAX_TOKENS;
    const reserveUsd = reservationUsd({ model: CENTRAL_MODEL, messages: [system, user], maxOutputTokens: maxTokens });
    const reservation = await rpc<{ ok: boolean; ledger_id?: string; reason?: string }>(db, "permit_ai_budget_reserve", {
      p_scope: budgetScope,
      p_stage: stage,
      p_permit_id: permitId,
      p_model: CENTRAL_MODEL,
      p_comment_count: work.length,
      p_reserve_usd: reserveUsd,
      p_request_hash: stableHash(`${version}|${stage}|${work.map((w) => `${w.comment_id}:${w.input_hash}`).sort().join(",")}`),
    });
    if (!reservation?.ok || !reservation.ledger_id) {
      out.has_more = true;
      out.budget_exhausted = true;
      out.budget_reason = reservation?.reason ?? "budget_refused";
      return out;
    }

    let result: ChatResult;
    try {
      result = await ai({ model: CENTRAL_MODEL, system, user, maxTokens });
    } catch (e) {
      // The call may have been billed; the reservation stays counted (settled as failed at its reserved amount).
      await rpc(db, "permit_ai_budget_settle", {
        p_ledger_id: reservation.ledger_id,
        p_status: "failed",
        p_input_tokens: null,
        p_output_tokens: null,
        p_cost_usd: null,
        p_error: String((e as Error)?.message ?? e).slice(0, 300),
      });
      out.has_more = true;
      out.error = `model call failed: ${String((e as Error)?.message ?? e).slice(0, 160)}`;
      return out;
    }
    out.ai_calls += 1;
    out.batches += 1;
    const usageKnown = result.inputTokens != null && result.outputTokens != null;
    const cost = usageKnown
      ? costUsd({ model: CENTRAL_MODEL, inputTokens: result.inputTokens!, outputTokens: result.outputTokens! })
      : reserveUsd;
    out.cost_usd += cost;
    await rpc(db, "permit_ai_budget_settle", {
      p_ledger_id: reservation.ledger_id,
      p_status: "settled",
      p_input_tokens: result.inputTokens,
      p_output_tokens: result.outputTokens,
      p_cost_usd: cost,
      p_error: usageKnown ? null : "usage not reported; reserved amount recorded",
    });

    const results = stage === "classify" ? classifyResults(work, result.content) : enrichResults(work, result.content);
    const recorded = await rpc<{ processed?: number; failed?: number }>(db, "permit_central_record", {
      p_permit_id: permitId,
      p_version: version,
      p_stage: stage,
      p_model: CENTRAL_MODEL,
      p_prompt_version: stage === "classify" ? CLASSIFIER_PROMPT_VERSION : CENTRAL_ENRICHMENT_PROMPT_VERSION,
      p_results: results,
    });
    out.processed += Number(recorded?.processed ?? 0);
    out.failed += Number(recorded?.failed ?? 0);
  }
}

export function classifyResults(work: WorkItem[], content: string | null): Record<string, unknown>[] {
  const parsed = parseClassifications(content, work.length);
  return work.map((w, i) => {
    const c = parsed?.get(i);
    if (!c) {
      return { comment_id: w.comment_id, input_hash: w.input_hash, ok: false, error: parsed ? "not classified by the model" : "invalid model output" };
    }
    return { comment_id: w.comment_id, input_hash: w.input_hash, ok: true, discipline: c.discipline, confidence: c.confidence };
  });
}

export function enrichResults(work: WorkItem[], content: string | null): Record<string, unknown>[] {
  const parsed = parseCentralEnrichment(content, work.length);
  return work.map((w, i) => {
    const e = parsed?.get(i);
    if (!e) {
      return { insight_id: w.insight_id, comment_id: w.comment_id, input_hash: w.input_hash, ok: false, error: parsed ? "not enriched by the model" : "invalid model output" };
    }
    const basis = codeBasis(e.code_reference, w.body);
    return {
      insight_id: w.insight_id,
      comment_id: w.comment_id,
      input_hash: w.input_hash,
      ok: true,
      code_reference: e.code_reference || null,
      code_basis: basis,
      code_references: e.code_reference ? [{ code: e.code_reference, basis }] : [],
      guidance_text: e.guidance || null,
      limitations: centralLimitations({
        basis,
        confidence: w.discipline_confidence,
        truncated: centralBody(w.body).truncated,
        guidance: e.guidance,
      }),
    };
  });
}

// ---- Dispatcher side ---------------------------------------------------------

export type CentralClaim = { permit_id: string; fingerprint: string; attempts: number };
export type StageResponse = { status: number; data: Record<string, unknown> | null };
export type StageInvoker = (stage: CentralStage, body: Record<string, unknown>) => Promise<StageResponse>;

export type CentralDriveOutcome = {
  outcome: "completed" | "released" | "failed" | "paused";
  rounds: number;
  ai_calls: number;
  cost_usd: number;
  error?: string;
};

/**
 * Drives one claimed permit: classify until nothing is left, then enrich until nothing is left. Unfinished work is
 * released (resumes next sweep), a refused budget pauses the permit, an error backs off. Completion is checked
 * again in the database (permit_central_finish refuses "completed" while comments are pending or failed).
 */
export async function driveCentralPermit(input: {
  claim: CentralClaim;
  invoke: StageInvoker;
  version: string;
  budgetScope: string;
  deadline: number;
  now?: () => number;
  reserveMs?: number;
  maxRounds?: number;
}): Promise<CentralDriveOutcome> {
  const { claim, invoke, version, budgetScope, deadline } = input;
  const now = input.now ?? (() => Date.now());
  const reserveMs = input.reserveMs ?? 30_000;
  const maxRounds = input.maxRounds ?? 40;
  const acc = { rounds: 0, ai_calls: 0, cost_usd: 0 };

  for (const stage of ["classify", "enrich"] as const) {
    for (;;) {
      if (acc.rounds >= maxRounds || now() + reserveMs >= deadline) return { outcome: "released", ...acc };
      acc.rounds += 1;
      let res: StageResponse;
      try {
        res = await invoke(stage, {
          mode: "central",
          permit_id: claim.permit_id,
          processing_version: version,
          budget_scope: budgetScope,
          budget_ms: Math.max(10_000, Math.min(110_000, deadline - now() - 10_000)),
        });
      } catch (e) {
        return { outcome: "failed", ...acc, error: `${stage} unreachable: ${String((e as Error)?.message ?? e).slice(0, 160)}` };
      }
      const d = res.data ?? {};
      acc.ai_calls += Number(d.ai_calls ?? 0);
      acc.cost_usd += Number(d.cost_usd ?? 0);
      if (d.budget_exhausted === true) {
        return { outcome: "paused", ...acc, error: `budget: ${String(d.budget_reason ?? "exhausted").slice(0, 80)}` };
      }
      if (res.status < 200 || res.status >= 300 || typeof d.error === "string") {
        const msg = typeof d.error === "string" ? d.error : typeof d.message === "string" ? d.message : `HTTP ${res.status}`;
        return { outcome: "failed", ...acc, error: `${stage}: ${msg.slice(0, 180)}` };
      }
      if (d.has_more !== true) break;
      if (Number(d.processed ?? 0) + Number(d.failed ?? 0) === 0 && Number(d.batches ?? 0) === 0) {
        // Out of time inside the agent before a batch: try again on the next invocation.
        return { outcome: "released", ...acc };
      }
    }
  }
  return { outcome: "completed", ...acc };
}
