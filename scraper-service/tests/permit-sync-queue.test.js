"use strict";

/**
 * Real-SQL tests for supabase/migrations/20261111100100_permit_sync_queue.sql (PGlite / Postgres 16).
 * PGlite has a single connection, so SKIP LOCKED contention between two live transactions is not
 * exercised; lease ownership, expiry, retry and cancellation semantics are.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const { createPermitRepoDb } = require("./helpers/permit-repo-db");

const ADMIN = "00000000-0000-4000-8000-000000000002";
const USER = "00000000-0000-4000-8000-000000000004";
const OWNER = "00000000-0000-4000-8000-000000000001";
const CRED = "00000000-0000-4000-8000-0000000000c1";
const CRED_OFF = "00000000-0000-4000-8000-0000000000c2";

async function setup() {
  const h = await createPermitRepoDb();
  await h.createUser(OWNER);
  await h.createUser(ADMIN, { role: "admin" });
  await h.createUser(USER);
  await h.createCredential(CRED, OWNER);
  await h.db.query(`INSERT INTO portal_credentials (id, user_id, jurisdiction, portal_username, portal_password) VALUES ($1, $2, 'Washington DC', 'other', '{"pc_v":"1","iv":"aXY=","at":"YXQ=","ct":"Y3Q="}')`, [CRED_OFF, OWNER]);
  const admin = (sql, params) => h.asUser(ADMIN, (tx) => tx.query(sql, params));
  await admin(`SELECT admin_set_permit_sync_source($1, 'dc-projectdox', true, '{}'::jsonb)`, [CRED]);
  await admin(`SELECT admin_set_permit_sync_source($1, 'dc-projectdox', false, '{}'::jsonb)`, [CRED_OFF]);
  const claim = async (worker = "w1") => {
    const j = await h.svc(`SELECT to_jsonb(j) FROM claim_permit_sync_job($1, 300) j`, [worker]);
    return j && j.id ? j : null;
  };
  const job = async (id) => (await h.db.query(`SELECT * FROM permit_sync_jobs WHERE id = $1`, [id])).rows[0];
  const source = async (cred = CRED) => (await h.db.query(`SELECT status, consecutive_auth_failures, last_login_ok_at FROM permit_sync_sources WHERE credential_id = $1`, [cred])).rows[0];
  return { h, admin, claim, job, source };
}

test("enqueue: schedule only for active automated sources, one active job per source", async () => {
  const { h, admin } = await setup();
  assert.equal(await h.svc(`SELECT enqueue_permit_sync_runs()`), 1);
  assert.equal(await h.svc(`SELECT enqueue_permit_sync_runs()`), 0, "busy sources are skipped");
  const first = (await h.db.query(`SELECT id FROM permit_sync_jobs WHERE credential_id = $1`, [CRED])).rows[0].id;
  const manual = (await admin(`SELECT admin_request_permit_sync($1) AS id`, [CRED])).rows[0].id;
  assert.equal(manual, first, "manual request returns the existing active job");
  await assert.rejects(
    h.db.query(`INSERT INTO permit_sync_jobs (credential_id, adapter_key, trigger) VALUES ($1, 'dc-projectdox', 'manual')`, [CRED]),
    /uq_permit_sync_jobs_one_active/,
  );
  await assert.rejects(h.svc(`SELECT _permit_sync_enqueue($1, 'scheduled', NULL)`, [CRED_OFF]), /permission denied/, "internal helper");
  await assert.rejects(h.db.query(`SELECT _permit_sync_enqueue($1, 'scheduled', NULL)`, [CRED_OFF]), /automation is disabled/);
  const manualOff = (await admin(`SELECT admin_request_permit_sync($1) AS id`, [CRED_OFF])).rows[0].id;
  assert.ok(manualOff, "an admin may run a non-automated source manually");
  assert.equal(await h.count("platform_audit_events", "action = 'permit_sync.request'"), 2);
});

test("lease: only the holder heartbeats, checkpoints and finishes; expired leases are reclaimed", async () => {
  const { h, claim, job } = await setup();
  await h.svc(`SELECT enqueue_permit_sync_runs()`);
  const j1 = await claim("w1");
  assert.equal(j1.status, "running");
  assert.equal(j1.attempt_count, 1);
  assert.equal(await claim("w2"), null, "a leased job cannot be claimed");

  assert.equal(await h.svc(`SELECT heartbeat_permit_sync_job($1, 'w2', 300, NULL)`, [j1.id]), false);
  assert.equal(await h.svc(`SELECT heartbeat_permit_sync_job($1, 'w1', 300, '{"done":["11854"]}'::jsonb)`, [j1.id]), true);
  assert.deepEqual((await job(j1.id)).checkpoint, { done: ["11854"] });

  await h.db.query(`UPDATE permit_sync_jobs SET lease_expires_at = now() - interval '1 second' WHERE id = $1`, [j1.id]);
  const j2 = await claim("w2");
  assert.equal(j2.id, j1.id, "crashed worker's job is reclaimed");
  assert.equal(j2.attempt_count, 2);
  assert.deepEqual(j2.checkpoint, { done: ["11854"] }, "checkpoint survives reclaim");
  assert.equal(await h.svc(`SELECT heartbeat_permit_sync_job($1, 'w1', 300, NULL)`, [j1.id]), false, "old worker lost the lease");
  assert.equal(await h.svc(`SELECT (finish_permit_sync_job($1, 'w1', 'completed')).id`, [j1.id]), null);
  assert.equal(await h.svc(`SELECT log_permit_sync_event($1, 'w1', 'info', 'x')`, [j1.id]), false);

  const done = await h.svc(`SELECT to_jsonb(finish_permit_sync_job($1, 'w2', 'completed', NULL, NULL, '{"permits":28}'::jsonb))`, [j1.id]);
  assert.equal(done.status, "completed");
  assert.deepEqual(done.metrics, { permits: 28 });
  assert.equal(done.lease_worker_id, null);
});

test("retry: retryable failures back off and stop at max_attempts; final lease expiry fails the job", async () => {
  const { h, claim, job } = await setup();
  await h.svc(`SELECT enqueue_permit_sync_runs()`);
  let j = await claim();
  let r = await h.svc(`SELECT to_jsonb(finish_permit_sync_job($1, 'w1', 'failed', 'transient', 'timeout', NULL, true))`, [j.id]);
  assert.equal(r.status, "retry_wait");
  assert.ok(new Date(r.next_attempt_at) > new Date(Date.now() + 200 * 1000), "first backoff is ~5 minutes");
  assert.equal(await claim(), null, "not claimable before next_attempt_at");

  await h.db.query(`UPDATE permit_sync_jobs SET next_attempt_at = now() WHERE id = $1`, [j.id]);
  j = await claim();
  assert.equal(j.attempt_count, 2);
  r = await h.svc(`SELECT to_jsonb(finish_permit_sync_job($1, 'w1', 'failed', 'transient', 'timeout', NULL, true))`, [j.id]);
  assert.ok(new Date(r.next_attempt_at) > new Date(Date.now() + 500 * 1000), "second backoff doubles");

  await h.db.query(`UPDATE permit_sync_jobs SET next_attempt_at = now() WHERE id = $1`, [j.id]);
  j = await claim();
  assert.equal(j.attempt_count, 3);
  r = await h.svc(`SELECT to_jsonb(finish_permit_sync_job($1, 'w1', 'failed', 'transient', 'timeout', NULL, true))`, [j.id]);
  assert.equal(r.status, "failed", "max_attempts reached");
  assert.ok(r.completed_at);

  await h.svc(`SELECT enqueue_permit_sync_runs()`);
  const k = await claim();
  await h.db.query(`UPDATE permit_sync_jobs SET attempt_count = max_attempts, lease_expires_at = now() - interval '1 second' WHERE id = $1`, [k.id]);
  assert.equal(await claim(), null);
  const dead = await job(k.id);
  assert.equal(dead.status, "failed");
  assert.equal(dead.error_code, "lease_expired");
});

test("cancellation cannot be overwritten by the worker", async () => {
  const { h, admin, claim, job } = await setup();
  await h.svc(`SELECT enqueue_permit_sync_runs()`);
  const j = await claim();
  await admin(`SELECT admin_cancel_permit_sync_job($1)`, [j.id]);
  assert.equal(await h.svc(`SELECT heartbeat_permit_sync_job($1, 'w1', 300, NULL)`, [j.id]), false);
  assert.equal(await h.svc(`SELECT (finish_permit_sync_job($1, 'w1', 'completed')).id`, [j.id]), null);
  assert.equal((await job(j.id)).status, "cancelled");
  await assert.rejects(admin(`SELECT admin_cancel_permit_sync_job($1)`, [j.id]), /active job not found/);
});

test("auth failures pause the source after two in a row; MFA waits for a user; admin resume", async () => {
  const { h, admin, claim, source } = await setup();
  for (let i = 1; i <= 2; i += 1) {
    await h.svc(`SELECT enqueue_permit_sync_runs()`);
    const j = await claim();
    await h.svc(`SELECT finish_permit_sync_job($1, 'w1', 'failed_unrecoverable', 'auth_failed', 'invalid credentials')`, [j.id]);
    assert.equal((await source()).consecutive_auth_failures, i);
  }
  assert.equal((await source()).status, "auth_failed");
  assert.equal(await h.svc(`SELECT enqueue_permit_sync_runs()`), 0);
  await assert.rejects(admin(`SELECT admin_request_permit_sync($1)`, [CRED]), /does not allow runs/);

  await admin(`SELECT admin_resume_permit_sync_source($1)`, [CRED]);
  assert.deepEqual({ ...(await source()), last_login_ok_at: null }, { status: "active", consecutive_auth_failures: 0, last_login_ok_at: null });

  await h.svc(`SELECT enqueue_permit_sync_runs()`);
  let j = await claim();
  const w = await h.svc(`SELECT to_jsonb(finish_permit_sync_job($1, 'w1', 'waiting_user', 'mfa_required', 'MFA prompt shown'))`, [j.id]);
  assert.equal(w.status, "waiting_user");
  assert.equal((await source()).status, "waiting_user");
  assert.equal(await claim(), null, "no claims while waiting for the user");
  await assert.rejects(admin(`SELECT admin_request_permit_sync($1)`, [CRED]), /does not allow runs/);

  await admin(`SELECT admin_resume_permit_sync_source($1)`, [CRED]);
  assert.equal((await h.db.query(`SELECT status FROM permit_sync_jobs WHERE id = $1`, [j.id])).rows[0].status, "cancelled");
  await h.svc(`SELECT enqueue_permit_sync_runs()`);
  j = await claim();
  await h.svc(`SELECT finish_permit_sync_job($1, 'w1', 'completed')`, [j.id]);
  const s = await source();
  assert.equal(s.status, "active");
  assert.ok(s.last_login_ok_at);
});

test("disabling automation stops scheduled claims; plaintext credentials cannot be resumed into runs", async () => {
  const { h, admin, claim } = await setup();
  await h.svc(`SELECT enqueue_permit_sync_runs()`);
  await admin(`SELECT admin_set_permit_sync_source($1, 'dc-projectdox', false, '{}'::jsonb)`, [CRED]);
  assert.equal(await claim(), null, "queued scheduled job is not claimed once automation is off");

  const PLAIN = "00000000-0000-4000-8000-0000000000c3";
  await h.db.query(`INSERT INTO portal_credentials (id, user_id, jurisdiction, portal_username, portal_password) VALUES ($1, $2, 'Washington DC', 'plain', 'secret')`, [PLAIN, OWNER]);
  await admin(`SELECT admin_set_permit_sync_source($1, 'dc-projectdox', false, '{}'::jsonb)`, [PLAIN]);
  await assert.rejects(admin(`SELECT admin_request_permit_sync($1)`, [PLAIN]), /does not allow runs/);
  await assert.rejects(admin(`SELECT admin_resume_permit_sync_source($1)`, [PLAIN]), /must be encrypted/);
});

test("privileges: workers are service-role only; jobs and events are admin-read-only; events append-only", async () => {
  const { h, admin, claim } = await setup();
  await h.svc(`SELECT enqueue_permit_sync_runs()`);
  const j = await claim();
  for (const sql of [
    `SELECT claim_permit_sync_job('x', 300)`,
    `SELECT heartbeat_permit_sync_job('${j.id}', 'w1', 300, NULL)`,
    `SELECT finish_permit_sync_job('${j.id}', 'w1', 'completed')`,
    `SELECT log_permit_sync_event('${j.id}', 'w1', 'info', 'x')`,
    `SELECT enqueue_permit_sync_runs()`,
    `UPDATE permit_sync_jobs SET status = 'completed'`,
    `INSERT INTO permit_sync_events (job_id, level, code) VALUES ('${j.id}', 'info', 'x')`,
  ]) {
    await assert.rejects(h.asUser(ADMIN, (tx) => tx.query(sql)), /permission denied/, sql);
    await assert.rejects(h.asUser(USER, (tx) => tx.query(sql)), /permission denied/, sql);
  }
  await assert.rejects(h.asUser(USER, (tx) => tx.query(`SELECT admin_request_permit_sync($1)`, [CRED])), /Not authorized/);
  await assert.rejects(h.asUser(USER, (tx) => tx.query(`SELECT admin_cancel_permit_sync_job($1)`, [j.id])), /Not authorized/);
  await assert.rejects(h.asUser(USER, (tx) => tx.query(`SELECT admin_resume_permit_sync_source($1)`, [CRED])), /Not authorized/);

  const seen = async (uid, t) => h.asUser(uid, async (tx) => (await tx.query(`SELECT count(*)::int AS n FROM ${t}`)).rows[0].n);
  assert.equal(await seen(ADMIN, "permit_sync_jobs"), 1);
  assert.ok((await seen(ADMIN, "permit_sync_events")) >= 2);
  assert.equal(await seen(USER, "permit_sync_jobs"), 0);
  assert.equal(await seen(USER, "permit_sync_events"), 0);
  await assert.rejects(h.asAnon((tx) => tx.query(`SELECT 1 FROM permit_sync_jobs`)), /permission denied/);

  await assert.rejects(h.svc(`UPDATE permit_sync_events SET code = 'x'`), /permission denied|append-only/);
  await assert.rejects(h.db.query(`DELETE FROM permit_sync_events`), /append-only/);
  void admin;
});

test("deleting the source credential cascades through jobs and events; direct deletes stay blocked", async () => {
  const { h, admin, claim } = await setup();
  // Supabase grants the service role full table privileges; the app's DELETE /api/portal-credentials/:id
  // runs `supabase.from("portal_credentials").delete().eq("id", id)` with that role.
  await h.db.query(`GRANT ALL ON public.portal_credentials TO service_role`);
  const jobId = (await admin(`SELECT admin_request_permit_sync($1) AS id`, [CRED])).rows[0].id;
  const j = await claim();
  assert.equal(j.id, jobId);
  await h.svc(`SELECT log_permit_sync_event($1, 'w1', 'info', 'progress')`, [jobId]);
  await h.svc(`SELECT finish_permit_sync_job($1, 'w1', 'completed')`, [jobId]);
  const events = await h.count("permit_sync_events", "job_id = $1", [jobId]);
  assert.ok(events >= 3);

  // Owner and service role: no direct UPDATE, DELETE or TRUNCATE on events, no direct job delete.
  await assert.rejects(h.db.query(`UPDATE permit_sync_events SET code = 'x' WHERE job_id = $1`, [jobId]), /append-only/);
  await assert.rejects(h.db.query(`DELETE FROM permit_sync_events WHERE job_id = $1`, [jobId]), /append-only/);
  await assert.rejects(h.svc(`DELETE FROM permit_sync_events WHERE job_id = $1`, [jobId]), /permission denied|append-only/);
  await assert.rejects(h.db.query(`TRUNCATE permit_sync_events`), /append-only/);
  await assert.rejects(h.db.query(`DELETE FROM permit_sync_jobs WHERE id = $1`, [jobId]), /deleted only with their source/);
  await assert.rejects(h.svc(`DELETE FROM permit_sync_jobs WHERE id = $1`, [jobId]), /deleted only with their source/);
  await assert.rejects(h.db.query(`TRUNCATE permit_sync_jobs CASCADE`), /append-only|deleted only with their source/);
  // A trigger-nested direct delete still fails while the parent job exists.
  await h.db.exec(`
    CREATE TABLE nested_probe (id int);
    CREATE FUNCTION nested_probe_fn() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN DELETE FROM permit_sync_events; RETURN NEW; END $$;
    CREATE TRIGGER nested_probe_t AFTER INSERT ON nested_probe FOR EACH ROW EXECUTE FUNCTION nested_probe_fn();
  `);
  await assert.rejects(h.db.query(`INSERT INTO nested_probe VALUES (1)`), /append-only/);
  assert.equal(await h.count("permit_sync_events", "job_id = $1", [jobId]), events);

  // The app's delete path succeeds and removes the source, its jobs and their events.
  await h.asService((tx) => tx.query(`DELETE FROM portal_credentials WHERE id = $1`, [CRED]));
  assert.equal(await h.count("portal_credentials", "id = $1", [CRED]), 0);
  assert.equal(await h.count("permit_sync_sources", "credential_id = $1", [CRED]), 0);
  assert.equal(await h.count("permit_sync_jobs", "credential_id = $1", [CRED]), 0);
  assert.equal(await h.count("permit_sync_events", "job_id = $1", [jobId]), 0);

  // Deleting a source row directly (admin removes automation config) cascades the same way.
  const offJob = (await admin(`SELECT admin_request_permit_sync($1) AS id`, [CRED_OFF])).rows[0].id;
  await h.asService((tx) => tx.query(`DELETE FROM permit_sync_sources WHERE credential_id = $1`, [CRED_OFF]));
  assert.equal(await h.count("permit_sync_events", "job_id = $1", [offJob]), 0);
});
