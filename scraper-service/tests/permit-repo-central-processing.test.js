"use strict";

/**
 * Central comment processing (20261118150000_central_comment_processing.sql, D-121..D-124, D-130..D-132) on the
 * real migration chain (PGlite), driven by the real stage code (supabase/functions/_shared, loaded through tsx)
 * with a fake model that counts calls:
 *   - every comment of synthetic permits with 6, 53, 59, 81 and 200 comments is processed, with reconciliation
 *     (source = processed + pending + failed + needs_attention + skipped) and no duplicate model calls;
 *   - only input or version changes re-run AI; the budget stops before the cap and resumes without repeats;
 *   - RLS: results follow permit read access; writes are service-only;
 *   - reuse on link: a linked project takes central results with zero classification/enrichment calls, the
 *     field-source trigger marks human edits, and rows shaped like ff193644's are left unchanged.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { require: tsxRequire } = require("tsx/cjs/api");

const { replay } = require("./helpers/replay-migrations");
const fx = require("./helpers/permit-repo-fixtures");

const SHARED = path.join(__dirname, "..", "..", "supabase", "functions", "_shared");
const central = tsxRequire(path.join(SHARED, "centralCommentProcessing.ts"), __filename);
const prompts = tsxRequire(path.join(SHARED, "commentPrompts.ts"), __filename);
const merge = tsxRequire(path.join(SHARED, "permitRepositoryComments.ts"), __filename);
const VERSION = prompts.CENTRAL_PROCESSING_VERSION;

const U = {
  owner: "30000000-0000-4000-8000-000000000001",
  hidden: "30000000-0000-4000-8000-000000000002",
  admin: "30000000-0000-4000-8000-000000000003",
};
const CRED = "30000000-0000-4000-8000-0000000000c1";
const PROJECT = "30000000-0000-4000-8000-0000000000f1";
const LEGACY_PROJECT = "30000000-0000-4000-8000-0000000000f2";
const SCOPE = "test-cap";

let db;
const P = {}; // dataset size -> permit id

const asUser = (sub, fn) =>
  db.transaction(async (tx) => {
    await tx.query(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [sub || ""]);
    await tx.exec(`SET LOCAL ROLE authenticated`);
    return fn(tx);
  });
const asService = (fn) =>
  db.transaction(async (tx) => {
    await tx.query(`SELECT set_config('request.jwt.claim.sub', '', true)`);
    await tx.exec(`SET LOCAL ROLE service_role`);
    return fn(tx);
  });

const SCALAR = new Set(["permit_ai_budget_reserve", "permit_ai_budget_settle", "permit_central_record", "permit_central_finish", "permit_ai_budget_status"]);
const CASTS = { p_results: "jsonb", p_permit_ids: "uuid[]", p_reserve_usd: "numeric", p_cost_usd: "numeric" };

/** CentralDb over PGlite as service_role: the same RPC names and named arguments as the edge function. */
const centralDb = {
  rpc: async (fn, args) => {
    const keys = Object.keys(args);
    const list = keys.map((k, i) => `${k} => $${i + 1}${CASTS[k] ? `::${CASTS[k]}` : ""}`).join(", ");
    const values = keys.map((k) => (k === "p_results" ? JSON.stringify(args[k]) : args[k]));
    try {
      const rows = await asService(async (tx) => (await tx.query(`SELECT * FROM public.${fn}(${list})`, values)).rows);
      return { data: SCALAR.has(fn) ? rows[0][fn] : rows, error: null };
    } catch (e) {
      return { data: null, error: { message: e.message } };
    }
  },
};

/** Fake model: answers every item unless its text contains SKIPME; counts calls per stage. */
function fakeModel() {
  const calls = { classify: 0, enrich: 0, bodies: [] };
  const ai = async (req) => {
    const items = req.user.split(/\n\n(?=\[\d+\] )/);
    const stage = req.system.startsWith("Classify") ? "classify" : "enrich";
    calls[stage] += 1;
    calls.bodies.push(...items.map((x) => `${stage}:${x.split("\n").slice(1).join("\n")}`));
    const answered = items.map((x, index) => ({ x, index })).filter(({ x }) => !x.includes("SKIPME"));
    const content = stage === "classify"
      ? JSON.stringify({ classifications: answered.map(({ index }) => ({ index, discipline: index % 2 ? "Structural" : "Civil", confidence_score: 0.92 })) })
      : JSON.stringify({ items: answered.map(({ x, index }) => ({ index, code_reference: x.includes("1605") ? "IBC 1605.2" : "DCMR 12-A", guidance: "Usually answered with a revised sheet." })) });
    return { content, inputTokens: Math.ceil(req.user.length / 4) + 400, outputTokens: 25 * items.length };
  };
  return { ai, calls };
}

/** One dispatcher round for one permit: claim, drive classify then enrich through the stage code, finish. */
async function processPermit(permitId, model, { scope = SCOPE } = {}) {
  const claimed = await asService(async (tx) =>
    (await tx.query(`SELECT * FROM public.permit_central_claim('w1', $1, 1, 300, $2::uuid[])`, [VERSION, [permitId]])).rows);
  if (claimed.length === 0) return { claimed: false };
  const [claim] = claimed;
  const invoke = async (stage, body) => {
    assert.equal(body.mode, "central");
    assert.ok(!("project_id" in body));
    const data = await central.runCentralStage({ stage, db: centralDb, ai: model.ai, permitId: body.permit_id, version: body.processing_version, budgetScope: body.budget_scope, deadline: Number.POSITIVE_INFINITY });
    return { status: data.error ? 500 : 200, data };
  };
  const r = await central.driveCentralPermit({ claim, invoke, version: VERSION, budgetScope: scope, deadline: Number.POSITIVE_INFINITY });
  const state = await asService(async (tx) =>
    (await tx.query(`SELECT public.permit_central_finish($1, 'w1', $2, $3, $4, $5) AS s`, [permitId, claim.fingerprint, VERSION, r.outcome, r.error ?? null])).rows[0].s);
  return { claimed: true, ...r, state };
}

const summary = async (permitId) =>
  (await asService((tx) => tx.query(`SELECT * FROM public.permit_central_summary($1::uuid[], $2)`, [[permitId], VERSION]))).rows[0];

async function addComments(permitId, n, { prefix = "Synthetic", duplicatesEvery = 0, empty = [] } = {}) {
  for (let i = 1; i <= n; i += 1) {
    const dupOf = duplicatesEvery && i % duplicatesEvery === 0 ? i - 1 : i;
    const body = empty.includes(i) ? "  " : `${prefix} comment ${dupOf}: provide calculations per IBC 1605.${dupOf % 7} for the ${dupOf % 2 ? "roof" : "slab"}.`;
    await db.query(
      `INSERT INTO public.permit_review_comments (permit_id, portal_comment_key, ref_number, department, comment_type, cycle, status, body)
       VALUES ($1, $2, $3, 'DOB Structural', 'Comment', 1, 'Unresolved', $4)`,
      [permitId, `ref:${i}`, i, body],
    );
  }
}

test.before(async () => {
  ({ db } = await replay());
  for (const [label, id] of Object.entries(U)) {
    await db.query(`INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES ($1, $2, '{}'::jsonb)`, [id, `${label}@test.invalid`]);
  }
  await db.query(`INSERT INTO public.profiles (user_id) SELECT id FROM auth.users ON CONFLICT (user_id) DO NOTHING`);
  await db.query(`INSERT INTO public.user_roles (user_id, role) VALUES ($1, 'admin')`, [U.admin]);
  await db.query(
    `INSERT INTO public.portal_credentials (id, user_id, jurisdiction, portal_username, portal_password, permit_number) VALUES ($1, $2, 'Washington DC', 'acct', '{"pc_v":"1","iv":"aXY=","at":"YXQ=","ct":"Y3Q="}', 'D2500488')`,
    [CRED, U.admin],
  );
  await db.query(`INSERT INTO public.user_portal_credential_grants (user_id, credential_id, grant_level) VALUES ($1, $2, 'use')`, [U.owner, CRED]);
  await asService((tx) => tx.query(`SELECT public.apply_permit_discovery($1::jsonb)`, [JSON.stringify(fx.discovery({ credentialId: CRED }))]));

  const permits = (await db.query(`SELECT id FROM public.permits WHERE portal_record_id <> '11854' ORDER BY portal_record_id LIMIT 8`)).rows.map((r) => r.id);
  [6, 53, 59, 81, 200, "budget", "legacy", "link"].forEach((k, i) => { P[k] = permits[i]; });
  await addComments(P[6], 6, { prefix: "Set6" });
  await addComments(P[53], 53, { prefix: "Set53" });
  await addComments(P[59], 59, { prefix: "Set59", duplicatesEvery: 10, empty: [7, 33] });
  await addComments(P[81], 81, { prefix: "Set81", empty: [81] });
  await addComments(P[200], 200, { prefix: "Set200" });
  await addComments(P.budget, 100, { prefix: "Budgeted" });
  await addComments(P.legacy, 6, { prefix: "Legacy" });
  await addComments(P.link, 53, { prefix: "Linked" });

  await db.query(`INSERT INTO public.permit_ai_budgets (scope, cap_usd, approved_at, approved_by) VALUES ($1, 5, now(), 'test')`, [SCOPE]);
});

for (const n of [6, 53, 59, 81, 200]) {
  test(`central processing: all ${n} comments are processed once and the counts reconcile`, async () => {
    const model = fakeModel();
    const r = await processPermit(P[n], model);
    assert.equal(r.outcome, "completed");
    assert.equal(r.state, "completed");

    const s = await summary(P[n]);
    assert.equal(s.source_comments, n);
    assert.equal(s.processed + s.pending + s.failed + s.needs_attention + s.skipped, s.source_comments, "reconciliation");
    assert.equal(s.pending + s.failed + s.needs_attention, 0, "nothing silently left behind");

    const { rows: [d] } = await db.query(
      `SELECT count(DISTINCT public._permit_comment_input_hash(c.body, c.department, c.comment_type, p.jurisdiction)) FILTER (WHERE btrim(c.body) <> '')::int AS distinct_inputs,
              count(*) FILTER (WHERE btrim(c.body) = '')::int AS empty
       FROM public.permit_review_comments c JOIN public.permits p ON p.id = c.permit_id WHERE c.permit_id = $1`, [P[n]]);
    assert.equal(s.skipped, d.empty, "empty bodies are skipped, and counted");
    assert.equal(s.processed, n - d.empty);
    assert.equal(model.calls.classify, Math.ceil(d.distinct_inputs / prompts.CLASSIFIER_CHUNK), "one model call per batch of distinct inputs");
    assert.equal(model.calls.enrich, Math.ceil(d.distinct_inputs / prompts.ENRICHMENT_CHUNK));
    const sent = model.calls.bodies.filter((b) => b.startsWith("classify:"));
    assert.equal(new Set(sent).size, sent.length, "no input is sent twice");

    const copies = (await db.query(`SELECT count(*)::int AS n FROM public.permit_comment_insights WHERE permit_id = $1 AND copied_from_insight_id IS NOT NULL`, [P[n]])).rows[0].n;
    assert.equal(copies, s.processed - d.distinct_inputs, "duplicate inputs are copied without a call");

    const again = await processPermit(P[n], fakeModel());
    assert.equal(again.claimed, false, "up to date: not claimed again");
    const direct = fakeModel();
    const res = await central.runCentralStage({ stage: "classify", db: centralDb, ai: direct.ai, permitId: P[n], version: VERSION, budgetScope: SCOPE, deadline: Number.POSITIVE_INFINITY });
    assert.equal(res.ai_calls + direct.calls.classify, 0, "re-running a finished stage makes no call");
  });
}

test("results are labelled preliminary, with provenance and limitations, and permit-level inputs only", async () => {
  const { rows } = await db.query(`SELECT * FROM public.permit_comment_insights WHERE permit_id = $1 AND is_current ORDER BY created_at LIMIT 3`, [P[6]]);
  for (const r of rows) {
    const body = (await db.query(`SELECT body FROM public.permit_review_comments WHERE id = $1`, [r.comment_id])).rows[0].body;
    assert.equal(r.analysis_kind, "preliminary_ai");
    assert.equal(r.status, "ready");
    assert.equal(r.processing_version, VERSION);
    assert.equal(r.code_reference, "IBC 1605.2");
    assert.equal(r.code_basis, body.includes("1605.2") ? "cited" : "inferred", "provenance is decided from the comment text");
    assert.equal(r.limitations[0], prompts.PRELIMINARY_LIMITATION);
    assert.equal(r.model, "gpt-4o");
    assert.match(r.classifier_prompt_version, /^classifier@/);
  }
  const cols = (await db.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'permit_comment_insights'`)).rows.map((r) => r.column_name);
  assert.ok(!cols.some((c) => /project|user|owner|team/.test(c)), "no project or user columns in central results");
});

test("an identical input on another permit is copied with no model call", async () => {
  const other = (await db.query(`SELECT id FROM public.permits WHERE portal_record_id <> '11854' ORDER BY portal_record_id OFFSET 8 LIMIT 1`)).rows[0].id;
  await addComments(other, 6, { prefix: "Set6" });
  const model = fakeModel();
  const r = await processPermit(other, model);
  assert.equal(r.outcome, "completed");
  assert.equal(model.calls.classify + model.calls.enrich, 0);
  const s = await summary(other);
  assert.equal(s.processed, 6);
  const copied = (await db.query(`SELECT count(*)::int AS n FROM public.permit_comment_insights WHERE permit_id = $1 AND copied_from_insight_id IS NOT NULL`, [other])).rows[0].n;
  assert.equal(copied, 6);
});

test("only an input change re-runs AI; a status change does not; history is kept", async () => {
  await db.query(`UPDATE public.permit_review_comments SET status = 'Resolved', cycle = 2 WHERE permit_id = $1`, [P[6]]);
  assert.equal((await processPermit(P[6], fakeModel())).claimed, false, "status and cycle are not inputs");

  await db.query(`UPDATE public.permit_review_comments SET body = body || ' Also show the load path.' WHERE permit_id = $1 AND ref_number = 2`, [P[6]]);
  const model = fakeModel();
  const r = await processPermit(P[6], model);
  assert.equal(r.outcome, "completed");
  assert.deepEqual([model.calls.classify, model.calls.enrich], [1, 1], "only the changed comment is sent");
  const hist = (await db.query(
    `SELECT i.is_current, i.superseded_at IS NOT NULL AS superseded FROM public.permit_comment_insights i
     JOIN public.permit_review_comments c ON c.id = i.comment_id WHERE c.permit_id = $1 AND c.ref_number = 2 ORDER BY i.created_at`, [P[6]])).rows;
  assert.deepEqual(hist, [{ is_current: false, superseded: true }, { is_current: true, superseded: false }]);
});

test("the budget stops before a call that could pass the cap, and resumes without repeating calls", async () => {
  await db.query(`INSERT INTO public.permit_ai_budgets (scope, cap_usd, approved_at, approved_by) VALUES ('tiny-cap', 0.12, now(), 'test')`);
  const model = fakeModel();
  const first = await processPermit(P.budget, model, { scope: "tiny-cap" });
  assert.equal(first.outcome, "paused");
  assert.equal(first.state, "paused");
  const status = (await asService((tx) => tx.query(`SELECT public.permit_ai_budget_status('tiny-cap') AS s`))).rows[0].s;
  assert.ok(Number(status.used_usd) <= 0.12, `spend ${status.used_usd} stays within the cap`);
  assert.equal(status.calls, model.calls.classify + model.calls.enrich, "every call made has a ledger row; the refused one has none");
  const mid = await summary(P.budget);
  assert.ok(mid.pending > 0);

  const reserved = (await db.query(`SELECT count(*)::int AS n FROM public.permit_ai_cost_ledger WHERE status = 'reserved'`)).rows[0].n;
  assert.equal(reserved, 0, "every reservation was settled");

  await db.query(`UPDATE public.permit_ai_budgets SET cap_usd = 5 WHERE scope = 'tiny-cap'`);
  await db.query(`UPDATE public.permit_comment_processing_state SET next_attempt_at = now() WHERE permit_id = $1`, [P.budget]);
  const second = await processPermit(P.budget, model, { scope: "tiny-cap" });
  assert.equal(second.outcome, "completed");
  assert.equal(model.calls.classify, Math.ceil(100 / prompts.CLASSIFIER_CHUNK), "no classify batch was repeated");
  assert.equal(model.calls.enrich, Math.ceil(100 / prompts.ENRICHMENT_CHUNK), "no enrich batch was repeated");
  const s = await summary(P.budget);
  assert.equal(s.processed, 100);

  await assert.rejects(asUser(U.owner, (tx) => tx.query(`SELECT public.permit_ai_budget_reserve('tiny-cap', 'classify', NULL, 'gpt-4o', 1, 0.01, NULL)`)), /permission denied/);
  const unapproved = await asService(async (tx) => {
    await tx.query(`INSERT INTO public.permit_ai_budgets (scope, cap_usd) VALUES ('not-approved', 5)`);
    return (await tx.query(`SELECT public.permit_ai_budget_reserve('not-approved', 'classify', NULL, 'gpt-4o', 1, 0.01, NULL) AS r`)).rows[0].r;
  });
  assert.deepEqual(unapproved, { ok: false, reason: "budget_not_approved" });
});

test("a comment the model keeps skipping is set aside as needs_attention; completion is refused while work is left", async () => {
  await db.query(`UPDATE public.permit_review_comments SET body = 'SKIPME ' || body WHERE permit_id = $1 AND ref_number = 3`, [P[53]]);
  const r = await processPermit(P[53], fakeModel());
  assert.equal(r.outcome, "completed");
  const s = await summary(P[53]);
  assert.equal(s.needs_attention, 1);
  assert.equal(s.processed + s.needs_attention + s.skipped, s.source_comments);
  const ui = await asUser(U.owner, async (tx) => (await tx.query(`SELECT * FROM public.get_permit_comment_processing($1::uuid[])`, [[P[53], P[6], P.link]])).rows);
  const byId = Object.fromEntries(ui.map((x) => [x.permit_id, x.processing_state]));
  assert.equal(byId[P[53]], "needs_attention");
  assert.equal(byId[P[6]], "ready");
  assert.equal(byId[P.link], "not_processed");

  await db.query(`UPDATE public.permit_review_comments SET body = body || ' (rev)' WHERE permit_id = $1 AND ref_number = 4`, [P[81]]);
  const [c] = await asService(async (tx) => (await tx.query(`SELECT * FROM public.permit_central_claim('w9', $1, 1, 300, $2::uuid[])`, [VERSION, [P[81]]])).rows);
  const st = await asService(async (tx) => (await tx.query(`SELECT public.permit_central_finish($1, 'w9', $2, $3, 'completed', NULL) AS s`, [P[81], c.fingerprint, VERSION])).rows[0].s);
  assert.equal(st, "failed", "\"completed\" with a pending comment is recorded as a failure");
  const last = (await db.query(`SELECT last_error FROM public.permit_comment_processing_state WHERE permit_id = $1`, [P[81]])).rows[0].last_error;
  assert.match(last, /incomplete: 1 pending/);

  await asUser(U.admin, (tx) => tx.query(`SELECT public.admin_retry_permit_comment_processing($1)`, [P[53]]));
  await db.query(`UPDATE public.permit_review_comments SET body = replace(body, 'SKIPME ', '') WHERE permit_id = $1 AND ref_number = 3`, [P[53]]);
  assert.equal((await processPermit(P[53], fakeModel())).outcome, "completed");
  assert.equal((await summary(P[53])).needs_attention, 0);
});

test("RLS: results follow permit read access; everything else is service-only", async () => {
  const visible = await asUser(U.owner, async (tx) => (await tx.query(`SELECT count(*)::int AS n FROM public.permit_comment_insights WHERE permit_id = $1`, [P[200]])).rows[0].n);
  assert.equal(visible, 200);
  const hidden = await asUser(U.hidden, async (tx) => (await tx.query(`SELECT count(*)::int AS n FROM public.permit_comment_insights`)).rows[0].n);
  assert.equal(hidden, 0, "a user without access to the permits sees no results");
  assert.deepEqual(await asUser(U.hidden, async (tx) => (await tx.query(`SELECT * FROM public.get_permit_comment_processing($1::uuid[])`, [[P[200]]])).rows), []);
  const nonReady = await asUser(U.owner, async (tx) => (await tx.query(`SELECT count(*)::int AS n FROM public.permit_comment_insights WHERE status <> 'ready'`)).rows[0].n);
  assert.equal(nonReady, 0, "unfinished rows are not shown");

  await assert.rejects(asUser(U.owner, (tx) => tx.query(`UPDATE public.permit_comment_insights SET discipline = 'Other'`)), /permission denied/);
  await assert.rejects(asUser(U.owner, (tx) => tx.query(`SELECT * FROM public.permit_central_work($1, $2, 'classify', 1)`, [P[6], VERSION])), /permission denied/);
  await assert.rejects(asUser(U.owner, (tx) => tx.query(`SELECT * FROM public.permit_comment_processing_state`)), /permission denied/);
  await assert.rejects(asUser(U.owner, (tx) => tx.query(`SELECT * FROM public.permit_ai_cost_ledger`)), /permission denied/);
  await assert.rejects(asUser(U.owner, (tx) => tx.query(`SELECT * FROM public.admin_get_central_processing_diagnostics(NULL)`)), /Not authorized/);
  const diag = await asUser(U.admin, async (tx) => (await tx.query(`SELECT * FROM public.admin_get_central_processing_diagnostics($1::uuid[])`, [[P.budget]])).rows[0]);
  assert.equal(diag.processing_version, VERSION);
  assert.ok(Number(diag.cost_usd) > 0 && diag.ai_calls > 0);
  assert.equal(diag.current_fingerprint, diag.completed_fingerprint);

  await assert.rejects(
    asService((tx) => tx.query(`SELECT public.permit_central_record($1, $2, 'classify', 'gpt-4o', 'x', $3::jsonb)`, [P[6], VERSION, JSON.stringify([{ comment_id: "00000000-0000-4000-8000-000000000000", input_hash: "h", ok: true, discipline: "Civil" }])]))
      .then((r) => { if (r.rows[0].permit_central_record.rejected !== 1) throw new Error("accepted"); throw new Error("rejected"); }),
    /rejected/,
    "results for comments of another permit are rejected",
  );
});

test("dry run inventory reconciles with no AI call", async () => {
  const rows = (await asService((tx) => tx.query(`SELECT * FROM public.permit_central_backfill_inventory($1, 'dc-projectdox')`, [VERSION]))).rows;
  const link = rows.find((r) => r.permit_id === P.link);
  assert.equal(link.source_comments, 53);
  assert.equal(link.pending, 53);
  assert.equal(link.distinct_inputs_to_send, 53);
  for (const r of rows) assert.equal(r.processed + r.pending + r.failed + r.needs_attention + r.skipped, r.source_comments);
});

// ---- Reuse on link -----------------------------------------------------------

async function projectRows(projectId) {
  return (await db.query(`SELECT * FROM public.parsed_comments WHERE project_id = $1 ORDER BY comment_number::int NULLS LAST, id`, [projectId])).rows;
}

/** comment-parser-agent's repository merge: same read (current insights RPC) and the pure plan, applied as service. */
async function mergeLinked(projectId, permitId) {
  const comments = (await db.query(
    `SELECT permit_id, portal_comment_key, ref_number, cycle, department, comment_type, file_name, body, status, reviewed_at::text
     FROM public.permit_review_comments WHERE permit_id = $1 AND removed_at IS NULL`, [permitId])).rows;
  const insights = (await centralDb.rpc("permit_central_current_insights", { p_permit_ids: [permitId] })).data;
  const plan = merge.planRepositoryCommentMerge({
    projectId,
    permits: [{ id: permitId, permit_number: "B0000000", reviews_complete: true }],
    comments,
    existing: await projectRows(projectId),
    now: new Date().toISOString(),
    insights,
  });
  await asService(async (tx) => {
    for (const row of plan.inserts) {
      const keys = Object.keys(row);
      await tx.query(`INSERT INTO public.parsed_comments (${keys.join(", ")}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(", ")})`, keys.map((k) => row[k]));
    }
    for (const u of plan.updates) {
      const keys = Object.keys(u.patch);
      await tx.query(`UPDATE public.parsed_comments SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(", ")} WHERE id = $1`, [u.id, ...keys.map((k) => u.patch[k])]);
    }
  });
  return plan;
}

/** Rows the project-mode classifier and context engine would send to the model (same rules as their filters). */
async function projectAiWork(projectId) {
  const { rows: [r] } = await db.query(
    `SELECT
       count(*) FILTER (WHERE (discipline IS NULL OR discipline IN ('General', 'Unclassified'))
         AND (ingest_source = 'raw_ref' OR status <> 'Approved')
         AND (discipline_source IS NULL OR discipline_source <> 'human')
         AND (processing_status IS NULL OR processing_status <> 'needs_attention'))::int AS classify,
       count(*) FILTER (WHERE (code_reference IS NULL OR code_reference = '')
         AND (code_reference_source IS NULL OR code_reference_source <> 'human') AND central_insight_id IS NULL)::int AS enrich
     FROM public.parsed_comments WHERE project_id = $1`, [projectId]);
  return r;
}

test("reuse on link: a linked project takes central results with zero classification or enrichment calls", async () => {
  const model = fakeModel();
  assert.equal((await processPermit(P.link, model)).outcome, "completed");
  const callsBefore = model.calls.classify + model.calls.enrich;

  await db.query(`INSERT INTO public.projects (id, name, user_id) VALUES ($1, 'Linked project', $2)`, [PROJECT, U.owner]);
  const fpBefore = (await asService((tx) => tx.query(`SELECT public._project_permit_comment_fingerprint($1) AS f`, [PROJECT]))).rows[0].f;
  assert.equal(fpBefore, null, "not linked yet");
  await asUser(U.owner, (tx) => tx.query(`SELECT public.link_project_permits($1, $2::uuid[])`, [PROJECT, [P.link]]));
  const fp = (await asService((tx) => tx.query(`SELECT public._project_permit_comment_fingerprint($1) AS f`, [PROJECT]))).rows[0].f;
  assert.match(fp, /^[0-9a-f]{32}$/);

  const plan = await mergeLinked(PROJECT, P.link);
  assert.equal(plan.stats.inserted, 53);
  assert.equal(plan.stats.central_applied, 53);
  const rows = await projectRows(PROJECT);
  assert.equal(rows.length, 53);
  for (const r of rows) {
    assert.ok(r.discipline && r.discipline_source === "central");
    assert.equal(r.code_reference_source, "central");
    assert.ok(r.central_insight_id);
    assert.equal(r.processing_status, "pending", "routing still runs per project");
  }
  assert.deepEqual(await projectAiWork(PROJECT), { classify: 0, enrich: 0 }, "classification and enrichment have nothing to send");
  assert.equal(model.calls.classify + model.calls.enrich, callsBefore, "linking made no model call");

  const owned = await db.query(`SELECT count(*)::int AS n FROM public.permit_comment_insights i JOIN public.parsed_comments pc ON pc.central_insight_id = i.id WHERE pc.project_id = $1`, [PROJECT]);
  assert.equal(owned.rows[0].n, 53);
  const leaked = await db.query(`SELECT count(*)::int AS n FROM public.permit_comment_insights WHERE guidance_text ILIKE '%Linked project%' OR guidance_text ILIKE $1`, [`%${PROJECT}%`]);
  assert.equal(leaked.rows[0].n, 0, "no project data in central tables");
});

test("field source: a signed-in edit becomes human and is never overwritten by a newer central result", async () => {
  const [first, second] = await projectRows(PROJECT);
  await asUser(U.owner, (tx) => tx.query(`UPDATE public.parsed_comments SET discipline = 'Fire', code_reference = 'NFPA 13' WHERE id = $1`, [first.id]));
  await asService((tx) => tx.query(`UPDATE public.parsed_comments SET assigned_to = 'Civil Engineer', assigned_to_source = 'project_ai' WHERE id = $1`, [second.id]));
  let rows = await projectRows(PROJECT);
  assert.equal(rows[0].discipline_source, "human");
  assert.equal(rows[0].code_reference_source, "human");
  assert.equal(rows[1].assigned_to_source, "project_ai", "service writes keep the source they set");

  // A newer central result for the edited comment (input changed on the portal, re-processed centrally).
  await db.query(`UPDATE public.permit_review_comments SET body = body || ' Include the wind load.' WHERE permit_id = $1 AND ref_number IN (1, 3)`, [P.link]);
  assert.equal((await processPermit(P.link, fakeModel())).outcome, "completed");
  const plan = await mergeLinked(PROJECT, P.link);
  rows = await projectRows(PROJECT);
  assert.equal(rows[0].discipline, "Fire", "a person's value is kept");
  assert.equal(rows[0].code_reference, "NFPA 13");
  assert.ok(rows[0].portal_changed_at || rows[0].central_update_at, "the change is flagged for a person");
  assert.equal(rows[2].discipline_source, "central");
  assert.match(rows[2].original_text, /Include the wind load/, "an unreviewed row takes the new text and its new central result");
  assert.ok(plan.stats.text_replaced >= 1);
});

test("rows shaped like ff193644's six keep rows, responses, approvals and response_md5 unchanged", async () => {
  await db.query(`INSERT INTO public.projects (id, name, user_id) VALUES ($1, 'Legacy project', $2)`, [LEGACY_PROJECT, U.owner]);
  const comments = (await db.query(`SELECT ref_number, body FROM public.permit_review_comments WHERE permit_id = $1 ORDER BY ref_number`, [P.legacy])).rows;
  for (const c of comments) {
    const text = [`ref: ${c.ref_number}`, "cycle: 1", "reviewed_by: DOB Structural", "type: Comment", "filename: ", "full_discussion_text:", c.body, "status: Unresolved", "source_report: Plan Review - Review Comments", "date_time: 03/01/2026 10:00 AM"].join("\n");
    await db.query(
      `INSERT INTO public.parsed_comments (project_id, original_text, discipline, code_reference, status, ingest_source, response_text, assigned_to)
       VALUES ($1, $2, $3, $4, 'Pending Review', 'raw_ref', $5, 'Project Manager')`,
      [LEGACY_PROJECT, text, c.ref_number % 2 ? "Structural" : null, c.ref_number <= 2 ? "IBC 1605" : null, `Response draft ${c.ref_number}`],
    );
  }
  const firstId = (await projectRows(LEGACY_PROJECT))[0].id;
  await asUser(U.owner, (tx) => tx.query(`UPDATE public.parsed_comments SET response_status = 'Approved' WHERE id = $1`, [firstId]));
  const snapshot = async () => (await db.query(
    `SELECT id, md5(coalesce(response_text, '')) AS response_md5, response_status, approved_at, approved_by, status, original_text, assigned_to
     FROM public.parsed_comments WHERE project_id = $1 ORDER BY id`, [LEGACY_PROJECT])).rows;
  const before = await snapshot();
  assert.ok(before[0].approved_at || before.some((r) => r.approved_at), "one row is approved");

  assert.equal((await processPermit(P.legacy, fakeModel())).outcome, "completed");
  await asUser(U.owner, (tx) => tx.query(`SELECT public.link_project_permits($1, $2::uuid[])`, [LEGACY_PROJECT, [P.legacy]]));
  const plan = await mergeLinked(LEGACY_PROJECT, P.legacy);
  assert.equal(plan.inserts.length, 0);
  assert.equal(plan.softRemovals.length, 0);

  const after = await snapshot();
  assert.equal(after.length, 6);
  assert.deepEqual(after, before, "rows, responses, approvals, statuses, text and assignments are unchanged");
  const filled = await projectRows(LEGACY_PROJECT);
  for (const r of filled) {
    assert.ok(r.discipline, "an empty discipline is filled from central");
    if (r.discipline_source !== "central") assert.equal(r.discipline_source, null, "an existing discipline keeps its unknown (human) source");
  }
});
