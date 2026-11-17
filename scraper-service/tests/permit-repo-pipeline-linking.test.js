"use strict";

/**
 * 20261117100000_permit_pipeline_linking.sql on the real migration chain (PGlite): project linking by
 * editors, the comment-content fingerprint that decides when a project needs processing (robust to the
 * portal_data hash flip, D-101), claim/finish leasing and back-off, user retry, the read model, and the
 * approval-trigger relaxation for service-role pipeline writes.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const { replay } = require("./helpers/replay-migrations");
const fx = require("./helpers/permit-repo-fixtures");

const U = {
  owner: "20000000-0000-4000-8000-000000000001",
  noPermit: "20000000-0000-4000-8000-000000000002",
  reader: "20000000-0000-4000-8000-000000000003",
  admin: "20000000-0000-4000-8000-000000000004",
  blocked: "20000000-0000-4000-8000-000000000005",
};
const CRED = "20000000-0000-4000-8000-0000000000c1";
const PROJECT = "20000000-0000-4000-8000-0000000000f1";
const PROJECT_B = "20000000-0000-4000-8000-0000000000f2";

let db;
let PERMIT; // D2500488 (portal 11854), 3 review comments
let OTHER_PERMIT; // a permit without comments

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
const one = async (tx, sql, params) => (await tx.query(sql, params)).rows[0];

const claim = (projectIds = [PROJECT], worker = "w1") =>
  asService(async (tx) => (await tx.query(`SELECT * FROM public.permit_pipeline_claim($1, 5, 300, $2::uuid[])`, [worker, projectIds])).rows);
const finish = (fp, outcome, { worker = "w1", error = null, project = PROJECT } = {}) =>
  asService(async (tx) => (await one(tx, `SELECT public.permit_pipeline_finish($1, $2, $3, $4, NULL, $5) AS s`, [project, worker, fp, outcome, error])).s);
const state = async (project = PROJECT) => (await db.query(`SELECT * FROM public.project_comment_pipeline_state WHERE project_id = $1`, [project])).rows[0];
const syncBatch = (batch) => asService((tx) => tx.query(`SELECT public.apply_permit_sync_batch($1::jsonb)`, [JSON.stringify(batch)]));

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
  await db.query(`INSERT INTO public.user_portal_credential_grants (user_id, credential_id, grant_level) VALUES ($1, $3, 'use'), ($2, $3, 'use')`, [U.owner, U.reader, CRED]);
  await asService((tx) => tx.query(`SELECT public.apply_permit_discovery($1::jsonb)`, [JSON.stringify(fx.discovery({ credentialId: CRED }))]));
  await syncBatch(fx.resubmitBatch({ credentialId: CRED }));
  PERMIT = (await db.query(`SELECT id FROM public.permits WHERE portal_record_id = '11854'`)).rows[0].id;
  OTHER_PERMIT = (await db.query(`SELECT id FROM public.permits WHERE portal_record_id <> '11854' ORDER BY portal_record_id LIMIT 1`)).rows[0].id;

  await db.query(`INSERT INTO public.projects (id, name, user_id) VALUES ($1, 'Linked project', $3), ($2, 'Other project', $3)`, [PROJECT, PROJECT_B, U.owner]);
  await db.query(`INSERT INTO public.user_project_access_overrides (user_id, project_id, access_level) VALUES ($1, $3, 'read'), ($2, $3, 'none')`, [U.reader, U.blocked, PROJECT]);
});

test("editors link permits they can read; a link needs both project edit access and permit access", async () => {
  assert.equal(await asUser(U.owner, async (tx) => (await one(tx, `SELECT public.link_project_permits($1, $2::uuid[]) AS n`, [PROJECT, [PERMIT, PERMIT]])).n), 1);
  assert.equal(await asUser(U.owner, async (tx) => (await one(tx, `SELECT public.link_project_permits($1, $2::uuid[]) AS n`, [PROJECT, [PERMIT]])).n), 0, "re-linking is a no-op");
  const audit = await db.query(`SELECT actor_id, action, target_id FROM public.platform_audit_events WHERE action = 'permit.link_project'`);
  assert.deepEqual(audit.rows, [{ actor_id: U.owner, action: "permit.link_project", target_id: PERMIT }]);

  await assert.rejects(asUser(U.noPermit, (tx) => tx.query(`SELECT public.link_project_permits($1, $2::uuid[])`, [PROJECT_B, [PERMIT]])), /permit not available/);
  await assert.rejects(asUser(U.reader, (tx) => tx.query(`SELECT public.link_project_permits($1, $2::uuid[])`, [PROJECT, [PERMIT]])), /not allowed/);
  await assert.rejects(asUser(U.blocked, (tx) => tx.query(`SELECT public.link_project_permits($1, $2::uuid[])`, [PROJECT, [PERMIT]])), /not allowed/);
  await assert.rejects(asUser(null, (tx) => tx.query(`SELECT public.link_project_permits($1, $2::uuid[])`, [PROJECT, [PERMIT]])), /authentication required/);
  await assert.rejects(asUser(U.owner, (tx) => tx.query(`SELECT public.link_project_permits($1, '{}'::uuid[])`, [PROJECT])), /between 1 and 50/);
  await assert.rejects(asUser(U.owner, (tx) => tx.query(`INSERT INTO public.project_permits (project_id, permit_id) VALUES ($1, $2)`, [PROJECT_B, PERMIT])), /permission denied/, "direct writes stay closed");
});

test("internal pipeline functions and the state table are service-only", async () => {
  await assert.rejects(asUser(U.owner, (tx) => tx.query(`SELECT * FROM public.permit_pipeline_claim('x', 1, 60, NULL)`)), /permission denied/);
  await assert.rejects(asUser(U.owner, (tx) => tx.query(`SELECT public._project_permit_comment_fingerprint($1)`, [PROJECT])), /permission denied/);
  await assert.rejects(asUser(U.owner, (tx) => tx.query(`INSERT INTO public.project_comment_pipeline_state (project_id) VALUES ($1)`, [PROJECT_B])), /permission denied/);
});

test("a linked project is claimed once, leased, and not claimed again after it completes", async () => {
  const [c] = await claim();
  assert.equal(c.project_id, PROJECT);
  assert.equal(c.owner_user_id, U.owner);
  assert.equal(c.attempts, 1);
  assert.match(c.fingerprint, /^[0-9a-f]{32}$/);
  assert.deepEqual(await claim([PROJECT], "w2"), [], "leased to w1");
  assert.equal(await finish(c.fingerprint, "completed", { worker: "w2" }), "lease_lost", "only the lease owner finishes");
  assert.equal(await finish(c.fingerprint, "completed"), "completed");
  assert.deepEqual(await claim(), [], "up to date");
  assert.deepEqual(await claim([PROJECT_B]), [], "a project without links is never claimed");
});

test("re-scrapes that change nothing (and portal_data hash flips) do not make the project due", async () => {
  await syncBatch(fx.resubmitBatch({ credentialId: CRED, capturedAt: "2026-11-06T15:00:00Z" }));
  await db.query(`UPDATE public.projects SET portal_data_hash = md5(random()::text) WHERE id = $1`, [PROJECT]);
  assert.deepEqual(await claim(), []);
});

test("new or changed comment content makes the project due again", async () => {
  const rows = fx.corrections.rows.map((r, i) => (i === 0 ? { ...r, text: `${r.text} Also provide a revised site plan.` } : r));
  await syncBatch(fx.resubmitBatch({ credentialId: CRED, rows, capturedAt: "2026-11-07T15:00:00Z" }));
  const [c] = await claim();
  assert.equal(c.project_id, PROJECT);
  assert.equal(c.attempts, 1, "new content starts a fresh attempt count");
  assert.equal(c.pipeline_run_id, null);
  assert.equal(await finish(c.fingerprint, "completed"), "completed");
});

test("failures back off and block after five attempts; released runs resume at once without counting", async () => {
  await asUser(U.owner, (tx) => tx.query(`SELECT public.request_project_comment_processing($1)`, [PROJECT]));
  let [c] = await claim();
  assert.equal(c.force_requested, true, "a user request runs even when up to date");
  assert.equal(await finish(c.fingerprint, "released"), "due");
  [c] = await claim();
  assert.ok(c, "released work resumes on the next sweep");
  assert.equal(c.attempts, 1, "a continuation is not a failure");

  for (let i = 1; i <= 5; i += 1) {
    const outcome = await finish(c.fingerprint, "failed", { error: `boom ${i}` });
    assert.equal(outcome, i < 5 ? "failed" : "blocked");
    assert.deepEqual(await claim(), [], "backing off");
    if (i < 5) {
      await db.query(`UPDATE public.project_comment_pipeline_state SET next_attempt_at = now() - interval '1 second' WHERE project_id = $1`, [PROJECT]);
      [c] = await claim();
      assert.equal(c.attempts, i + 1);
    }
  }
  const s = await state();
  assert.equal(s.status, "blocked");
  assert.equal(s.last_error, "boom 5");

  await asUser(U.owner, (tx) => tx.query(`SELECT public.request_project_comment_processing($1)`, [PROJECT]));
  [c] = await claim();
  assert.ok(c, "Try again unblocks");
  assert.equal(await finish(c.fingerprint, "completed"), "completed");
  assert.equal((await state()).force_requested, false);
  await assert.rejects(asUser(U.reader, (tx) => tx.query(`SELECT public.request_project_comment_processing($1)`, [PROJECT])), /not allowed/);
});

test("an invocation that keeps getting cut off (lease expires without a finish) ends up needing attention", async () => {
  await asUser(U.owner, (tx) => tx.query(`SELECT public.request_project_comment_processing($1)`, [PROJECT]));
  for (let i = 1; i <= 5; i += 1) {
    const [c] = await claim();
    assert.equal(c.attempts, i);
    await db.query(`UPDATE public.project_comment_pipeline_state SET lease_expires_at = now() - interval '1 second' WHERE project_id = $1`, [PROJECT]);
  }
  assert.deepEqual(await claim(), []);
  const s = await state();
  assert.equal(s.status, "blocked");
  assert.equal(s.last_error, "processing was interrupted repeatedly");
  await asUser(U.owner, (tx) => tx.query(`SELECT public.request_project_comment_processing($1)`, [PROJECT]));
  const [c] = await claim();
  assert.equal(await finish(c.fingerprint, "completed"), "completed");
});

test("the overview shows processing state to people with project and permit access; errors to admins only", async () => {
  const rows = await asUser(U.owner, async (tx) => (await tx.query(`SELECT * FROM public.get_comment_pipeline_overview(NULL, $1::uuid[])`, [[PERMIT]])).rows);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].project_id, PROJECT);
  assert.equal(rows[0].project_name, "Linked project");
  assert.equal(rows[0].processing_state, "processed");
  assert.equal(rows[0].portal_comments, 3);
  assert.equal(rows[0].can_edit, true);
  assert.equal(rows[0].last_error, null);

  assert.deepEqual(await asUser(U.noPermit, async (tx) => (await tx.query(`SELECT * FROM public.get_comment_pipeline_overview($1::uuid[], NULL)`, [[PROJECT]])).rows), [], "no permit access, no row");
  assert.deepEqual(await asUser(U.blocked, async (tx) => (await tx.query(`SELECT * FROM public.get_comment_pipeline_overview($1::uuid[], NULL)`, [[PROJECT]])).rows), [], "no project access, no row");
  const readerRows = await asUser(U.reader, async (tx) => (await tx.query(`SELECT can_edit FROM public.get_comment_pipeline_overview($1::uuid[], NULL)`, [[PROJECT]])).rows);
  assert.deepEqual(readerRows, [{ can_edit: false }]);

  await db.query(`UPDATE public.project_comment_pipeline_state SET last_error = 'diagnostic' WHERE project_id = $1`, [PROJECT]);
  const adminRows = await asUser(U.admin, async (tx) => (await tx.query(`SELECT last_error FROM public.get_comment_pipeline_overview($1::uuid[], NULL)`, [[PROJECT]])).rows);
  assert.deepEqual(adminRows, [{ last_error: "diagnostic" }]);
  const ownerRows = await asUser(U.owner, async (tx) => (await tx.query(`SELECT last_error FROM public.get_comment_pipeline_overview($1::uuid[], NULL)`, [[PROJECT]])).rows);
  assert.deepEqual(ownerRows, [{ last_error: null }]);
});

test("a linked permit without comments reads as no_comments and is never claimed on its own", async () => {
  await asUser(U.owner, (tx) => tx.query(`SELECT public.link_project_permits($1, $2::uuid[])`, [PROJECT_B, [OTHER_PERMIT]]));
  const rows = await asUser(U.owner, async (tx) => (await tx.query(`SELECT processing_state FROM public.get_comment_pipeline_overview($1::uuid[], NULL)`, [[PROJECT_B]])).rows);
  assert.deepEqual(rows, [{ processing_state: "no_comments" }]);
});

test("losing permit access stops processing; unlinking keeps the project's comments", async () => {
  await db.query(`INSERT INTO public.parsed_comments (project_id, original_text, status, ingest_source, portal_permit_id, portal_comment_key) VALUES ($1, 'ref: 1', 'Pending', 'raw_ref', $2, 'ref:1')`, [PROJECT, PERMIT]);
  await db.query(`UPDATE public.user_portal_credential_grants SET grant_level = 'none' WHERE user_id = $1`, [U.owner]);
  await db.query(`UPDATE public.project_comment_pipeline_state SET completed_fingerprint = NULL WHERE project_id = $1`, [PROJECT]);
  assert.deepEqual(await claim(), [], "the owner can no longer read the permit, so nothing is processed");
  await db.query(`UPDATE public.user_portal_credential_grants SET grant_level = 'use' WHERE user_id = $1`, [U.owner]);

  assert.equal(await asUser(U.owner, async (tx) => (await one(tx, `SELECT public.unlink_project_permit($1, $2) AS ok`, [PROJECT, PERMIT])).ok), true);
  const kept = await db.query(`SELECT count(*)::int AS n FROM public.parsed_comments WHERE project_id = $1`, [PROJECT]);
  assert.equal(kept.rows[0].n, 1);
  await assert.rejects(asUser(U.reader, (tx) => tx.query(`SELECT public.unlink_project_permit($1, $2)`, [PROJECT, PERMIT])), /not allowed/);
});

test("service-role pipeline writes pass the approval trigger only when they leave the response alone", async () => {
  const id = (
    await asUser(U.owner, async (tx) =>
      one(tx, `INSERT INTO public.parsed_comments (project_id, original_text, status, ingest_source, response_text, response_status) VALUES ($1, 'ref: 9', 'Pending', 'raw_ref', 'Our reply', 'Approved') RETURNING id, approved_by`, [PROJECT]),
    )
  ).id;
  const approved = (await db.query(`SELECT approved_by FROM public.parsed_comments WHERE id = $1`, [id])).rows[0];
  assert.equal(approved.approved_by, U.owner);

  await asService((tx) => tx.query(`UPDATE public.parsed_comments SET portal_removed_at = now(), assigned_to = 'Civil' WHERE id = $1`, [id]));
  const after = (await db.query(`SELECT response_status, approved_by, portal_removed_at IS NOT NULL AS removed FROM public.parsed_comments WHERE id = $1`, [id])).rows[0];
  assert.deepEqual(after, { response_status: "Approved", approved_by: U.owner, removed: true });

  await assert.rejects(asService((tx) => tx.query(`UPDATE public.parsed_comments SET response_text = 'changed' WHERE id = $1`, [id])), /Authentication required/);
  await asUser(U.owner, (tx) => tx.query(`UPDATE public.parsed_comments SET response_text = 'edited' WHERE id = $1`, [id]));
  const edited = (await db.query(`SELECT response_status, approved_by, last_edited_by FROM public.parsed_comments WHERE id = $1`, [id])).rows[0];
  assert.deepEqual(edited, { response_status: "Draft", approved_by: null, last_edited_by: U.owner }, "user edits behave as before");
});
