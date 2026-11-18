// Run: node --import tsx --test supabase/functions/_shared/centralCommentProcessing.test.ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { costUsd, inputTokenUpperBound, priceOf, reservationUsd, utf8Bytes } from "./aiCost.ts";
import {
  driveCentralPermit,
  runCentralStage,
  type CentralDb,
  type ChatCaller,
  type StageResponse,
  type WorkItem,
} from "./centralCommentProcessing.ts";
import {
  CENTRAL_MAX_BODY_CHARS,
  CENTRAL_PROCESSING_VERSION,
  NO_PROJECT_LIMITATION,
  PRELIMINARY_LIMITATION,
  centralClassifierUserContent,
  centralLimitations,
  codeBasis,
  isClassified,
  parseCentralEnrichment,
  parseClassifications,
} from "./commentPrompts.ts";

describe("cost bounds (D-123)", () => {
  it("the input bound is at least the byte count (a BPE token covers one byte or more)", () => {
    const text = "Provide ADA clearance per IBC 1104.2 — résumé ✓";
    assert.ok(inputTokenUpperBound([text]) >= utf8Bytes(text));
    assert.ok(utf8Bytes(text) > text.length, "multi-byte characters count in bytes");
  });

  it("reservation covers any real cost of the same call", () => {
    const messages = ["system prompt", "x".repeat(4000)];
    const reserve = reservationUsd({ model: "gpt-4o", messages, maxOutputTokens: 2048 });
    const worst = costUsd({ model: "gpt-4o", inputTokens: utf8Bytes(messages.join("")), outputTokens: 2048 });
    assert.ok(reserve >= worst);
    assert.equal(costUsd({ model: "gpt-4o", inputTokens: 1_000_000, outputTokens: 0 }), 2.5);
    assert.equal(costUsd({ model: "gpt-4o", inputTokens: 0, outputTokens: 1_000_000 }), 10);
  });

  it("an unpriced model is refused rather than counted as free", () => {
    assert.throws(() => priceOf("gpt-5-unknown"), /no price/);
  });
});

describe("prompt helpers", () => {
  it("central inputs carry only permit-level fields", () => {
    const content = centralClassifierUserContent([{ body: "Provide plat.", department: "DOB", comment_type: "Comment", jurisdiction: "Washington DC" }]);
    assert.equal(content, "[0] Department: DOB | Type: Comment | Jurisdiction: Washington DC\nProvide plat.");
  });

  it("parses classifications; skipped and out-of-range indexes are absent, unknown disciplines are Other", () => {
    const m = parseClassifications('```json\n{"classifications":[{"index":0,"discipline":"Fire","confidence_score":1.4},{"index":2,"discipline":"Nope"},{"index":9,"discipline":"Civil"}]}\n```', 3)!;
    assert.deepEqual([...m.keys()], [0, 2]);
    assert.equal(m.get(0)!.confidence, 1);
    assert.equal(m.get(2)!.discipline, "Other");
    assert.equal(parseClassifications("not json", 3), null);
  });

  it("parses enrichment items by index or position", () => {
    const m = parseCentralEnrichment('{"items":[{"index":1,"code_reference":"NFPA 13","guidance":"g"},{"code_reference":"","guidance":""}]}', 2)!;
    assert.equal(m.get(1)!.code_reference, "NFPA 13");
    assert.equal(m.get(1)!.guidance, "g");
  });

  it("code provenance is decided from the text: cited only when the comment names it", () => {
    assert.equal(codeBasis("IBC 1104.2", "Provide clearance per IBC Section 1104.2."), "cited");
    assert.equal(codeBasis("IBC 1104.2", "Provide clearance per 1104.2"), "cited");
    assert.equal(codeBasis("IBC 1104.2", "Provide accessible clearance."), "inferred");
    assert.equal(codeBasis("", "anything"), "none");
  });

  it("limitations always say preliminary and no project documents", () => {
    const l = centralLimitations({ basis: "inferred", confidence: 0.5, truncated: true, guidance: "" });
    assert.equal(l[0], PRELIMINARY_LIMITATION);
    assert.equal(l[1], NO_PROJECT_LIMITATION);
    assert.equal(l.length, 6);
    assert.ok(l.some((x) => x.includes(String(CENTRAL_MAX_BODY_CHARS))));
  });

  it("General and Unclassified are not classifications", () => {
    assert.equal(isClassified("General"), false);
    assert.equal(isClassified(""), false);
    assert.equal(isClassified("Civil"), true);
  });
});

/** In-memory stand-in for the central RPCs: work queue, budget with reserve/settle, recorded results. */
function fakeDb(opts: { items: number; capUsd: number; stage?: "classify" | "enrich" }) {
  const pending = Array.from({ length: opts.items }, (_, i): WorkItem => ({
    comment_id: `c${i}`,
    input_hash: `h${i}`,
    body: `Comment ${i} per IBC 1605.${i}`,
    department: "DOB",
    comment_type: "Comment",
    jurisdiction: "Washington DC",
    insight_id: opts.stage === "enrich" ? `i${i}` : null,
    discipline: opts.stage === "enrich" ? "Structural" : null,
    discipline_confidence: opts.stage === "enrich" ? 0.9 : null,
  }));
  const ledger: Array<{ id: string; reserved: number; status: string; cost: number | null }> = [];
  const recorded: Array<Record<string, unknown>> = [];
  const used = () => ledger.reduce((n, l) => n + (l.status === "settled" ? l.cost ?? l.reserved : Math.max(l.reserved, l.cost ?? 0)), 0);
  const db: CentralDb = {
    rpc: async (fn, args) => {
      if (fn === "permit_central_work") return { data: pending.slice(0, Number(args.p_limit)), error: null };
      if (fn === "permit_ai_budget_reserve") {
        const r = Number(args.p_reserve_usd);
        if (used() + r > opts.capUsd) return { data: { ok: false, reason: "budget_exhausted" }, error: null };
        const id = `l${ledger.length}`;
        ledger.push({ id, reserved: r, status: "reserved", cost: null });
        return { data: { ok: true, ledger_id: id }, error: null };
      }
      if (fn === "permit_ai_budget_settle") {
        const l = ledger.find((x) => x.id === args.p_ledger_id)!;
        l.status = String(args.p_status);
        l.cost = args.p_cost_usd == null ? l.reserved : Number(args.p_cost_usd);
        return { data: true, error: null };
      }
      if (fn === "permit_central_record") {
        const results = args.p_results as Array<Record<string, unknown>>;
        recorded.push(...results);
        for (const r of results) {
          const i = pending.findIndex((p) => p.comment_id === r.comment_id);
          if (i >= 0 && r.ok) pending.splice(i, 1);
        }
        return { data: { processed: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length }, error: null };
      }
      throw new Error(`unexpected rpc ${fn}`);
    },
  };
  return { db, ledger, recorded, pending, used };
}

const answerAll: ChatCaller = async (req) => {
  const n = (req.user.match(/^\[\d+\]/gm) ?? []).length;
  const content = req.system.startsWith("Classify")
    ? JSON.stringify({ classifications: Array.from({ length: n }, (_, index) => ({ index, discipline: "Structural", confidence_score: 0.9 })) })
    : JSON.stringify({ items: Array.from({ length: n }, (_, index) => ({ index, code_reference: "IBC 1605", guidance: "Usually answered with calculations." })) });
  return { content, inputTokens: Math.ceil(req.user.length / 4), outputTokens: 30 * n };
};

describe("runCentralStage", () => {
  it("processes every item in batches and settles real usage", async () => {
    const f = fakeDb({ items: 81, capUsd: 5 });
    const r = await runCentralStage({ stage: "classify", db: f.db, ai: answerAll, permitId: "p", version: CENTRAL_PROCESSING_VERSION, budgetScope: "test", deadline: Number.POSITIVE_INFINITY });
    assert.equal(r.processed, 81);
    assert.equal(r.ai_calls, 2);
    assert.equal(r.has_more, false);
    assert.ok(f.ledger.every((l) => l.status === "settled" && l.cost! <= l.reserved));
    assert.ok(Math.abs(r.cost_usd - f.used()) < 1e-9);
  });

  it("stops before a call that could pass the cap; the call is never made", async () => {
    const f = fakeDb({ items: 200, capUsd: 0.09 });
    let calls = 0;
    const ai: ChatCaller = async (req) => {
      calls++;
      return answerAll(req);
    };
    const r = await runCentralStage({ stage: "classify", db: f.db, ai, permitId: "p", version: CENTRAL_PROCESSING_VERSION, budgetScope: "test", deadline: Number.POSITIVE_INFINITY });
    assert.equal(r.budget_exhausted, true);
    assert.equal(r.has_more, true);
    assert.equal(calls, f.ledger.length, "one reservation per call made, none for the refused one");
    assert.ok(f.used() <= 0.09);
    assert.ok(f.pending.length > 0);
  });

  it("a model error keeps the reservation counted (settled failed) and records nothing", async () => {
    const f = fakeDb({ items: 6, capUsd: 5 });
    const r = await runCentralStage({ stage: "classify", db: f.db, ai: async () => { throw new Error("429"); }, permitId: "p", version: "v", budgetScope: "test", deadline: Number.POSITIVE_INFINITY });
    assert.match(r.error!, /429/);
    assert.equal(f.ledger[0].status, "failed");
    assert.equal(f.ledger[0].cost, f.ledger[0].reserved);
    assert.equal(f.recorded.length, 0);
  });

  it("unknown usage is recorded at the reserved amount", async () => {
    const f = fakeDb({ items: 6, capUsd: 5 });
    await runCentralStage({ stage: "classify", db: f.db, ai: async (req) => ({ ...(await answerAll(req)), inputTokens: null }), permitId: "p", version: "v", budgetScope: "test", deadline: Number.POSITIVE_INFINITY });
    assert.equal(f.ledger[0].cost, f.ledger[0].reserved);
  });

  it("enrichment results carry provenance and limitations", async () => {
    const f = fakeDb({ items: 3, capUsd: 5, stage: "enrich" });
    await runCentralStage({ stage: "enrich", db: f.db, ai: answerAll, permitId: "p", version: "v", budgetScope: "test", deadline: Number.POSITIVE_INFINITY });
    const r = f.recorded[0];
    assert.equal(r.code_basis, "cited");
    assert.deepEqual(r.code_references, [{ code: "IBC 1605", basis: "cited" }]);
    assert.equal((r.limitations as string[])[0], PRELIMINARY_LIMITATION);
  });

  it("does not start a batch without time for it", async () => {
    const f = fakeDb({ items: 6, capUsd: 5 });
    const r = await runCentralStage({ stage: "classify", db: f.db, ai: answerAll, permitId: "p", version: "v", budgetScope: "test", deadline: 1000, now: () => 990, reserveMs: 25 });
    assert.equal(r.has_more, true);
    assert.equal(f.ledger.length, 0);
  });
});

describe("driveCentralPermit", () => {
  const claim = { permit_id: "p", fingerprint: "f", attempts: 1 };
  const scripted = (responses: StageResponse[]) => {
    const calls: Array<{ stage: string; body: Record<string, unknown> }> = [];
    return {
      calls,
      invoke: async (stage: "classify" | "enrich", body: Record<string, unknown>) => {
        calls.push({ stage, body });
        return responses.shift() ?? { status: 200, data: { has_more: false } };
      },
    };
  };

  it("classifies until done, then enriches until done", async () => {
    const s = scripted([
      { status: 200, data: { has_more: true, processed: 45, batches: 1, ai_calls: 1, cost_usd: 0.02 } },
      { status: 200, data: { has_more: false, processed: 36, ai_calls: 1, cost_usd: 0.015 } },
      { status: 200, data: { has_more: false, processed: 81, ai_calls: 5, cost_usd: 0.1 } },
    ]);
    const r = await driveCentralPermit({ claim, invoke: s.invoke, version: "v", budgetScope: "b", deadline: Number.POSITIVE_INFINITY });
    assert.equal(r.outcome, "completed");
    assert.deepEqual(s.calls.map((c) => c.stage), ["classify", "classify", "enrich"]);
    assert.equal(r.ai_calls, 7);
    assert.equal(s.calls[0].body.mode, "central");
    assert.equal(s.calls[0].body.processing_version, "v");
    assert.ok(!("project_id" in s.calls[0].body), "no project data in central calls");
  });

  it("a refused budget pauses; an error fails; running out of time releases", async () => {
    assert.equal((await driveCentralPermit({ claim, invoke: scripted([{ status: 200, data: { has_more: true, budget_exhausted: true } }]).invoke, version: "v", budgetScope: "b", deadline: Number.POSITIVE_INFINITY })).outcome, "paused");
    assert.equal((await driveCentralPermit({ claim, invoke: scripted([{ status: 500, data: { error: "x" } }]).invoke, version: "v", budgetScope: "b", deadline: Number.POSITIVE_INFINITY })).outcome, "failed");
    assert.equal((await driveCentralPermit({ claim, invoke: scripted([]).invoke, version: "v", budgetScope: "b", deadline: 10, now: () => 0 })).outcome, "released");
  });
});
