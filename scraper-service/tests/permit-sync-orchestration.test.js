"use strict";

/**
 * 20261113100000_permit_sync_orchestration.sql on the real migration chain (PGlite): one request path with
 * coalescing (D-094), the same-login claim lock (D-095), release without spending an attempt, per-permit
 * progress (D-096), schedules that never fire for a time already passed, authorization, and the monitor (D-099).
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const { createDeepDb } = require("./helpers/permit-sync-deep");
const { pgliteWorkerRpc } = require("./helpers/permit-sync-rpc");
const fx = require("./helpers/permit-repo-fixtures");

const OWNER = "50000000-0000-4000-8000-000000000001";
const ADMIN = "50000000-0000-4000-8000-000000000002";
const MANAGER = "50000000-0000-4000-8000-000000000003";
const VIEWER = "50000000-0000-4000-8000-000000000004";
const OTHER = "50000000-0000-4000-8000-000000000005";
const CRED = "50000000-0000-4000-8000-0000000000c1";
const CRED2 = "50000000-0000-4000-8000-0000000000c2";
const ENVELOPE = '{"pc_v":"1","iv":"aXY=","at":"YXQ=","ct":"Y3Q="}';

async function setup() {
  const h = await createDeepDb();
  const users = [OWNER, ADMIN, MANAGER, VIEWER, OTHER];
  for (const id of users) await h.db.query(`INSERT INTO auth.users (id, email) VALUES ($1, $2)`, [id, `${id.slice(-1)}@test.invalid`]);
  await h.db.query(`INSERT INTO public.profiles (user_id) SELECT unnest($1::uuid[]) ON CONFLICT (user_id) DO NOTHING`, [users]);
  await h.db.query(`INSERT INTO public.user_roles (user_id, role) VALUES ($1, 'admin')`, [ADMIN]);
  // Two credential rows for the same DC login (as in production: de8592f9 and 0610eaa5).
  await h.db.query(`INSERT INTO public.portal_credentials (id, user_id, jurisdiction, portal_username, portal_password, permit_number) VALUES ($1, $3, 'Washington DC - ProjectDox', 'Acct@Example.test', $4, 'B1'), ($2, $3, 'Washington DC - ProjectDox', 'acct@example.test ', $4, 'B2')`, [CRED, CRED2, OWNER, ENVELOPE]);
  await h.db.query(`INSERT INTO public.user_portal_credential_grants (user_id, credential_id, grant_level) VALUES ($1, $3, 'manage'), ($2, $3, 'use')`, [MANAGER, VIEWER, CRED]);
  const as = (uid) => (sql, params = []) => h.db.transaction(async (tx) => {
    await tx.query(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [uid]);
    await tx.exec(`SET LOCAL ROLE authenticated`);
    return (await tx.query(sql, params)).rows;
  });
  const admin = as(ADMIN);
  for (const c of [CRED, CRED2]) await admin(`SELECT admin_set_permit_sync_source($1, 'dc-projectdox', false, '{}'::jsonb)`, [c]);
  await h.rpc("apply_permit_discovery", fx.discovery({ credentialId: CRED }));
  const permits = (await h.db.query(`SELECT id, portal_record_id FROM permits ORDER BY portal_record_id`)).rows;
  const one = async (fn, sql, params) => (await fn(sql, params))[0];
  const refreshAll = (fn = admin, cred = CRED) => one(fn, `SELECT request_permit_sync_refresh($1) AS r`, [cred]).then((x) => x.r);
  const refreshPermits = (ids, fn = admin, cred = CRED) => one(fn, `SELECT request_permit_sync_refresh($1, $2::uuid[]) AS r`, [cred, ids]).then((x) => x.r);
  const refreshPermit = (id, fn = admin) => one(fn, `SELECT request_permit_refresh($1) AS r`, [id]).then((x) => x.r);
  const job = async (id) => (await h.db.query(`SELECT * FROM permit_sync_jobs WHERE id = $1`, [id])).rows[0];
  const rows = async (id) => (await h.db.query(`SELECT portal_record_id, phase FROM permit_sync_job_permits WHERE job_id = $1 ORDER BY portal_record_id`, [id])).rows;
  return { h, as, admin, permits, refreshAll, refreshPermits, refreshPermit, job, rows, deep: pgliteWorkerRpc(h, { mode: "deep" }) };
}

test("the migration enqueues nothing; a refresh is a coalescible deep job with a queued row per permit", async () => {
  const { h, permits, refreshAll, job, rows } = await setup();
  assert.equal(await h.count("permit_sync_jobs"), 0, "replaying the chain creates no job");
  assert.equal(await h.svc(`SELECT enqueue_permit_sync_runs()`), 0, "no automation, no schedule: nothing");
  assert.equal(permits.length, 28);

  const r = await refreshAll();
  assert.equal(r.result, "created");
  const j = await job(r.job_id);
  assert.equal(j.worker_mode, "deep");
  assert.equal(j.coalescible, true);
  assert.equal(j.max_attempts, 5);
  assert.deepEqual(j.options, {}, "every permit, worker caps");
  assert.equal((await rows(r.job_id)).length, 28);
  assert.ok((await rows(r.job_id)).every((x) => x.phase === "queued"));
});

test("requests coalesce into the queued job; one follow-up queues behind a running job", async () => {
  const { h, permits, refreshAll, refreshPermits, refreshPermit, job, deep } = await setup();
  const [a, b, c] = permits;

  const first = await refreshPermit(a.id);
  assert.equal(first.result, "created");
  assert.deepEqual((await job(first.job_id)).options.only_portal_record_ids, [a.portal_record_id]);
  const second = await refreshPermits([b.id]);
  assert.equal(second.job_id, first.job_id);
  assert.equal(second.result, "merged");
  assert.deepEqual((await job(first.job_id)).options.only_portal_record_ids, [a.portal_record_id, b.portal_record_id].sort());
  const all = await refreshAll();
  assert.equal(all.job_id, first.job_id, "Refresh All widens the queued job instead of queuing another");
  assert.equal((await job(first.job_id)).options.only_portal_record_ids, undefined);
  assert.equal(await h.count("permit_sync_jobs"), 1);

  const claimed = await deep.claim("w1", 300);
  assert.equal(claimed.id, first.job_id);
  assert.equal(claimed.phase, "authenticating");
  assert.equal((await refreshPermit(c.id)).result, "already_covered", "the running all-permit job has not reached it yet");

  await deep.heartbeat(claimed.id, "w1", 300, { done: [c.portal_record_id] });
  const follow = await refreshPermit(c.id);
  assert.equal(follow.result, "queued_follow_up");
  assert.notEqual(follow.job_id, claimed.id);
  assert.equal((await refreshPermit(a.id)).job_id, follow.job_id, "later requests merge into the follow-up");
  assert.equal(await h.count("permit_sync_jobs", "status = 'queued'"), 1);
  await assert.rejects(h.db.query(`INSERT INTO permit_sync_jobs (credential_id, adapter_key, trigger) VALUES ($1, 'dc-projectdox', 'manual')`, [CRED]), /uq_permit_sync_jobs_one_queued/);

  assert.equal(await deep.claim("w2", 300), null, "the follow-up waits for the job in flight");
  await deep.finish(claimed.id, "w1", "completed", null, null, {}, false, null);
  assert.equal((await deep.claim("w2", 300)).id, follow.job_id);
});

test("a request pulls a job in back-off forward and reprocesses what was asked for, unless the portal rate-limited it", async () => {
  const { permits, refreshAll, refreshPermit, job, deep, h } = await setup();
  const [a, b] = permits;
  const r = await refreshAll();
  const claimed = await deep.claim("w1", 300);
  await deep.heartbeat(claimed.id, "w1", 300, { done: [a.portal_record_id, b.portal_record_id] });
  await deep.finish(claimed.id, "w1", "failed", "session_ended", "x", {}, true, null);
  const waiting = await job(r.job_id);
  assert.equal(waiting.status, "retry_wait");
  assert.ok(new Date(waiting.next_attempt_at) > new Date());

  const m = await refreshPermit(a.id);
  assert.deepEqual([m.job_id, m.result, m.status], [r.job_id, "merged", "retry_wait"]);
  const after = await job(r.job_id);
  assert.deepEqual(after.checkpoint.done, [b.portal_record_id]);
  assert.ok(new Date(after.next_attempt_at) <= new Date());

  await h.db.query(`UPDATE permit_sync_jobs SET error_code = 'rate_limited', next_attempt_at = now() + interval '1 hour' WHERE id = $1`, [r.job_id]);
  await refreshPermit(b.id);
  assert.ok(new Date((await job(r.job_id)).next_attempt_at) > new Date(Date.now() + 50 * 60 * 1000), "rate-limit back-off is kept");
});

test("one session per portal login: a second source on the same username is not claimed while the first runs", async () => {
  const { h, admin, refreshAll, deep } = await setup();
  await h.rpc("apply_permit_discovery", fx.discovery({ credentialId: CRED2 }));
  const j1 = await refreshAll();
  const j2 = await refreshAll(admin, CRED2);
  const first = await deep.claim("w1", 300);
  assert.equal(first.id, j1.job_id);
  assert.equal(await deep.claim("w2", 300), null, "same jurisdiction + username (case and spaces ignored) is locked");
  await h.db.query(`UPDATE permit_sync_jobs SET lease_expires_at = now() - interval '1 second' WHERE id = $1`, [first.id]);
  const reclaimed = await deep.claim("w2", 300);
  assert.equal(reclaimed.id, first.id, "an expired lease is recovered before the other source");
  await deep.finish(first.id, "w2", "completed", null, null, {}, false, null);
  assert.equal((await deep.claim("w3", 300)).id, j2.job_id);
});

test("release on shutdown gives the attempt back, keeps the checkpoint, and marks open rows retrying", async () => {
  const { permits, refreshAll, job, rows, deep, h } = await setup();
  const r = await refreshAll();
  const c = await deep.claim("w1", 300);
  assert.equal(c.attempt_count, 1);
  await h.svc(`SELECT report_permit_sync_progress($1, 'w1', $2::jsonb)`, [c.id, JSON.stringify({ phase: "processing", permits: [{ portal_record_id: permits[0].portal_record_id, phase: "downloading_files", files_total: 10, files_captured: 4 }] })]);
  assert.equal(await h.svc(`SELECT release_permit_sync_job($1, 'other', 'worker_shutdown', NULL, 0)`, [c.id]), false, "holder-checked");
  assert.equal(await h.svc(`SELECT release_permit_sync_job($1, 'w1', 'worker_shutdown', $2::jsonb, 0)`, [c.id, JSON.stringify({ done: [permits[1].portal_record_id] })]), true);
  const j = await job(r.job_id);
  assert.deepEqual([j.status, j.attempt_count, j.release_count, j.error_code, j.phase], ["retry_wait", 0, 1, "worker_shutdown", "released"]);
  assert.deepEqual(j.checkpoint.done, [permits[1].portal_record_id]);
  const open = (await rows(r.job_id)).find((x) => x.portal_record_id === permits[0].portal_record_id);
  assert.equal(open.phase, "retrying");
  await assert.rejects(h.svc(`SELECT release_permit_sync_job($1, 'w1', 'because', NULL, 0)`, [c.id]), /unknown release reason/);

  const again = await deep.claim("w2", 300);
  assert.equal(again.id, r.job_id);
  assert.equal(again.attempt_count, 1, "a restart does not use up the job's attempts");
  assert.equal((await rows(r.job_id)).find((x) => x.portal_record_id === permits[0].portal_record_id).phase, "queued");
});

test("progress: holder-checked writes, counts kept when omitted, settled by cancel, readable only by permit readers", async () => {
  const { h, as, admin, permits, refreshAll, rows, deep } = await setup();
  const r = await refreshAll();
  const c = await deep.claim("w1", 300);
  const id = permits[0].portal_record_id;
  const report = (worker, body) => h.svc(`SELECT report_permit_sync_progress($1, $2, $3::jsonb)`, [c.id, worker, JSON.stringify(body)]);
  assert.equal(await report("intruder", { phase: "processing" }), false);
  assert.equal(await report("w1", { phase: "processing", current_portal_record_id: id, permits: [{ portal_record_id: id, phase: "downloading_files", files_total: 72, files_captured: 10, reports_total: 5 }] }), true);
  assert.equal(await report("w1", { permits: [{ portal_record_id: id, phase: "exporting_reports", files_captured: 72 }] }), true);
  const row = (await h.db.query(`SELECT * FROM permit_sync_job_permits WHERE job_id = $1 AND portal_record_id = $2`, [c.id, id])).rows[0];
  assert.deepEqual([row.phase, row.files_total, row.files_captured, row.reports_total], ["exporting_reports", 72, 72, 5]);
  assert.ok(row.started_at && !row.finished_at);
  await assert.rejects(report("w1", { permits: [{ portal_record_id: id, phase: "dancing" }] }), /permit_sync_job_permits_phase_check|violates check/);
  await assert.rejects(report("w1", { permits: [{ portal_record_id: id, files_total: -1 }] }), /non-negative/);
  await assert.rejects(report("w1", { phase: "napping" }), /permit_sync_jobs_phase_check|violates check/);

  const progress = async (fn) => fn(`SELECT * FROM get_permit_sync_progress($1::uuid[])`, [[permits[0].id, permits[1].id]]);
  const viewer = await progress(as(VIEWER));
  assert.equal(viewer.length, 2, "a 'use' grantee reads the source's permits");
  assert.equal(viewer.find((x) => x.permit_id === permits[0].id).phase, "exporting_reports");
  assert.equal((await progress(as(OTHER))).length, 0, "no access, no rows");
  const summary = (await as(VIEWER)(`SELECT get_permit_sync_job_progress($1) AS j`, [c.id]))[0].j;
  assert.equal(summary.permits_total, 28);
  assert.equal(summary.files_captured, 72);
  assert.equal(summary.current_portal_record_id, id);
  await assert.rejects(as(OTHER)(`SELECT get_permit_sync_job_progress($1)`, [c.id]), /Not authorized/);

  await admin(`SELECT cancel_permit_sync_job($1)`, [c.id]);
  const settled = await rows(r.job_id);
  assert.ok(settled.every((x) => x.phase === "cancelled"), "cancel settles every open row");
  assert.equal(await report("w1", { phase: "processing" }), false, "a cancelled job takes no more progress");
});

test("finishing settles requested permits that were never processed as skipped", async () => {
  const { h, permits, refreshAll, rows, deep } = await setup();
  const r = await refreshAll();
  const c = await deep.claim("w1", 300);
  await h.svc(`SELECT report_permit_sync_progress($1, 'w1', $2::jsonb)`, [c.id, JSON.stringify({ permits: [{ portal_record_id: permits[0].portal_record_id, phase: "completed" }] })]);
  await deep.finish(c.id, "w1", "completed_with_warnings", null, null, {}, false, null);
  const out = await rows(r.job_id);
  assert.equal(out.filter((x) => x.phase === "completed").length, 1);
  assert.equal(out.filter((x) => x.phase === "skipped").length, 27);
});

test("authorization: refresh needs admin or a 'manage' grant; 'use' sees the overview without refresh rights", async () => {
  const { h, as, permits, refreshAll, refreshPermit } = await setup();
  await assert.rejects(refreshAll(as(VIEWER)), /Not authorized/);
  await assert.rejects(refreshAll(as(OTHER)), /Not authorized/);
  await assert.rejects(refreshPermit(permits[0].id, as(OTHER)), /Not authorized/);
  await assert.rejects(h.db.transaction(async (tx) => { await tx.exec(`SET LOCAL ROLE anon`); return tx.query(`SELECT request_permit_sync_refresh($1)`, [CRED]); }), /permission denied/);
  const r = await refreshPermit(permits[0].id, as(MANAGER));
  assert.equal(r.credential_id, CRED);
  assert.equal(await h.count("platform_audit_events", "action = 'permit_sync.refresh_request'"), 1);

  const ov = (await as(VIEWER)(`SELECT get_permit_sync_overview() AS o`))[0].o;
  assert.equal(ov.length, 1, "only sources the user has a grant on");
  assert.deepEqual([ov[0].credential_id, ov[0].permit_count, ov[0].can_refresh], [CRED, 28, false]);
  assert.equal(ov[0].queued_job.permits_total, 1);
  assert.equal(JSON.stringify(ov).includes("acct@example"), false, "no usernames in the overview");
  assert.equal((await as(OTHER)(`SELECT get_permit_sync_overview() AS o`))[0].o.length, 0);
  await assert.rejects(as(MANAGER)(`SELECT admin_set_permit_sync_schedule($1, true, '{}'::jsonb)`, [CRED]), /Not authorized/);
  await assert.rejects(as(MANAGER)(`SELECT admin_permit_sync_scheduler_status()`), /Not authorized/);

  const outside = (await h.db.query(`INSERT INTO permits (adapter_key, portal_record_id) VALUES ('dc-projectdox', '999999') RETURNING id`)).rows[0].id;
  await assert.rejects(h.db.transaction(async (tx) => {
    await tx.query(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [ADMIN]);
    await tx.exec(`SET LOCAL ROLE authenticated`);
    return tx.query(`SELECT request_permit_sync_refresh($1, $2::uuid[])`, [CRED, [outside]]);
  }), /not seen by this source/);
});

test("blocked sources refuse requests; a waiting_user job must be resumed first", async () => {
  const { h, admin, refreshAll, deep } = await setup();
  const r = await refreshAll();
  const c = await deep.claim("w1", 300);
  await deep.finish(c.id, "w1", "waiting_user", "mfa_required", "mfa", {}, false, null);
  await assert.rejects(refreshAll(), /source status waiting_user does not allow runs/);
  await admin(`SELECT admin_resume_permit_sync_source($1)`, [CRED]);
  assert.equal((await h.db.query(`SELECT status FROM permit_sync_jobs WHERE id = $1`, [r.job_id])).rows[0].status, "cancelled");
  assert.equal((await refreshAll()).result, "created");
});

test("schedule: validated, explicit timezone, never fires for a time already passed, then once per slot", async () => {
  const { h, admin } = await setup();
  const set = (enabled, schedule) => admin(`SELECT admin_set_permit_sync_schedule($1, $2, $3::jsonb, NULL, NULL) AS r`, [CRED, enabled, schedule ? JSON.stringify(schedule) : null]);
  await assert.rejects(set(true, null), /set a schedule before enabling/);
  for (const bad of [{ frequency: "hourly", time: "04:00", timezone: "UTC" }, { frequency: "daily", time: "4am", timezone: "UTC" }, { frequency: "daily", time: "04:00" }, { frequency: "daily", time: "04:00", timezone: "Mars/Olympus" }, { frequency: "weekly", time: "04:00", timezone: "UTC" }]) {
    await assert.rejects(set(true, bad), /schedule|timezone|weekday/, JSON.stringify(bad));
  }
  // Slot one minute ago: enabling now must not start it.
  const past = new Date(Date.now() - 60 * 1000);
  const hhmm = `${String(past.getUTCHours()).padStart(2, "0")}:${String(past.getUTCMinutes()).padStart(2, "0")}`;
  const out = (await set(true, { frequency: "daily", time: hhmm, timezone: "UTC" }))[0].r;
  assert.equal(out.automation_enabled, true);
  assert.ok(new Date(out.next_run_at) > new Date(Date.now() + 23 * 3600 * 1000), "next run is tomorrow");
  assert.equal(await h.svc(`SELECT enqueue_permit_sync_runs()`), 0, "a slot before enabling never runs");
  assert.equal(await h.count("permit_sync_jobs"), 0);

  // Pretend the schedule was enabled yesterday: today's slot is due once.
  await h.db.query(`UPDATE permit_sync_sources SET schedule_enabled_at = now() - interval '1 day' WHERE credential_id = $1`, [CRED]);
  assert.equal(await h.svc(`SELECT enqueue_permit_sync_runs()`), 1);
  assert.equal(await h.svc(`SELECT enqueue_permit_sync_runs()`), 0, "the same slot is not enqueued twice");
  const j = (await h.db.query(`SELECT trigger, worker_mode, coalescible FROM permit_sync_jobs`)).rows;
  assert.deepEqual(j, [{ trigger: "scheduled", worker_mode: "deep", coalescible: true }]);
  assert.equal((await h.db.query(`SELECT last_schedule_result FROM permit_sync_sources WHERE credential_id = $1`, [CRED])).rows[0].last_schedule_result, "created");

  await set(false, null);
  assert.equal((await h.db.query(`SELECT automation_enabled, schedule_enabled_at FROM permit_sync_sources WHERE credential_id = $1`, [CRED])).rows[0].automation_enabled, false);
  const status = (await admin(`SELECT admin_permit_sync_scheduler_status() AS s`))[0].s;
  assert.deepEqual(status.cron_jobs, [], "the migration schedules no cron job");
});

test("only one source per login may be scheduled", async () => {
  const { admin } = await setup();
  const sched = JSON.stringify({ frequency: "daily", time: "04:00", timezone: "America/New_York" });
  await admin(`SELECT admin_set_permit_sync_schedule($1, true, $2::jsonb)`, [CRED, sched]);
  await assert.rejects(admin(`SELECT admin_set_permit_sync_schedule($1, true, $2::jsonb)`, [CRED2, sched]), /same portal login already drives automation/);
});

test("monitor: detects offline worker, stuck and unclaimed jobs, login failures; dedups and auto-resolves", async () => {
  const { h, refreshAll, deep } = await setup();
  const monitor = () => h.svc(`SELECT permit_sync_monitor()`);
  const open = async () => (await h.db.query(`SELECT category, alert_key, occurrences FROM permit_sync_alerts WHERE resolved_at IS NULL ORDER BY alert_key`)).rows;
  assert.equal((await monitor()).open, 0, "nothing to report on an idle system");

  const r = await refreshAll();
  await h.db.query(`UPDATE permit_sync_jobs SET next_attempt_at = now() - interval '20 minutes' WHERE id = $1`, [r.job_id]);
  await monitor();
  assert.deepEqual((await open()).map((a) => a.category).sort(), ["queued_unclaimed", "worker_offline"]);
  await monitor();
  assert.ok((await open()).every((a) => a.occurrences === 2), "repeated detections update the open alert");

  await h.svc(`SELECT permit_sync_worker_heartbeat('w1', 'deep', 'idle', NULL, '{}'::jsonb)`);
  const c = await deep.claim("w1", 300);
  await h.db.query(`UPDATE permit_sync_jobs SET lease_expires_at = now() - interval '5 minutes' WHERE id = $1`, [c.id]);
  await monitor();
  assert.deepEqual((await open()).map((a) => a.category), ["job_stuck"], "worker back and job claimed: those alerts resolve");
  assert.equal(await h.count("permit_sync_alerts", "resolved_at IS NOT NULL"), 2);

  await h.db.query(`UPDATE permit_sync_jobs SET lease_expires_at = now() + interval '5 minutes' WHERE id = $1`, [c.id]);
  await deep.finish(c.id, "w1", "failed_unrecoverable", "auth_failed", "bad password for acct@example.test", {}, false, null);
  await h.db.query(`UPDATE permit_sync_sources SET status = 'auth_failed', consecutive_auth_failures = 2 WHERE credential_id = $1`, [CRED]);
  await monitor();
  const alerts = (await h.db.query(`SELECT category, severity, title, detail FROM permit_sync_alerts WHERE resolved_at IS NULL`)).rows;
  assert.deepEqual(alerts.map((a) => [a.category, a.severity]), [["login_failure", "critical"]]);
  assert.equal(JSON.stringify(alerts).includes("acct@example"), false, "alert text carries no username or portal message");
  await assert.rejects(h.db.transaction(async (tx) => {
    await tx.query(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [MANAGER]);
    await tx.exec(`SET LOCAL ROLE authenticated`);
    return tx.query(`SELECT permit_sync_monitor()`);
  }), /permission denied/);
});

test("monitor: discovery drop, missing deep content, and the schedule not being enqueued", async () => {
  const { h, admin, refreshAll, deep } = await setup();
  const monitor = () => h.svc(`SELECT permit_sync_monitor()`);
  const cats = async () => (await h.db.query(`SELECT DISTINCT category FROM permit_sync_alerts WHERE resolved_at IS NULL ORDER BY 1`)).rows.map((x) => x.category);
  await h.svc(`SELECT permit_sync_worker_heartbeat('w1', 'deep', 'idle', NULL, '{}'::jsonb)`);
  for (const discovered of [28, 20]) {
    await refreshAll();
    const c = await deep.claim("w1", 300);
    await deep.finish(c.id, "w1", "completed", null, null, { discovered, permits_ok: discovered, deep: discovered === 28 ? { deep_passes: 28 } : {} }, false, null);
  }
  await monitor();
  assert.deepEqual(await cats(), ["discovery_drop", "missing_deep_content"]);

  await admin(`SELECT admin_set_permit_sync_schedule($1, true, '{"frequency":"daily","time":"00:00","timezone":"UTC"}'::jsonb)`, [CRED]);
  await h.db.query(`UPDATE permit_sync_sources SET schedule_enabled_at = now() - interval '3 days', last_scheduled_at = now() - interval '2 days' WHERE credential_id = $1`, [CRED]);
  await h.db.query(`UPDATE permit_sync_jobs SET completed_at = completed_at - interval '3 days'`);
  await h.db.query(`UPDATE permit_sync_workers SET last_seen_at = now()`);
  await monitor();
  const now = await cats();
  assert.ok(now.includes("no_recent_success"));
  if (new Date().getUTCHours() >= 1) assert.ok(now.includes("schedule_missed"), "today's 00:00 UTC slot is over an hour late");
});

test("scheduling scripts: sync cron refuses until a full deep refresh finished; none of them enqueue; disable removes all", async () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const dir = path.join(__dirname, "..", "..", "scripts", "permit-repo", "scheduling");
  const script = (name) => fs.readFileSync(path.join(dir, name), "utf8");
  const { h, admin, refreshPermit, refreshAll, permits, deep } = await setup();
  const cronJobs = async () => (await h.db.query(`SELECT jobname FROM cron.job WHERE jobname LIKE 'permit-sync-%' ORDER BY 1`)).rows.map((r) => r.jobname);

  await assert.rejects(h.db.exec(script("02-enable-sync-cron.sql")), /no source has a schedule enabled/);
  await admin(`SELECT admin_set_permit_sync_schedule($1, true, '{"frequency":"daily","time":"02:00","timezone":"America/New_York"}'::jsonb)`, [CRED]);
  await assert.rejects(h.db.exec(script("02-enable-sync-cron.sql")), /without a finished full deep refresh/);

  const single = await refreshPermit(permits[0].id);
  let c = await deep.claim("w1", 300);
  await deep.finish(c.id, "w1", "completed", null, null, {}, false, null);
  assert.equal(c.id, single.job_id);
  await assert.rejects(h.db.exec(script("02-enable-sync-cron.sql")), /without a finished full deep refresh/, "a one-permit refresh is not a full refresh");

  await refreshAll();
  c = await deep.claim("w1", 300);
  await deep.finish(c.id, "w1", "completed_with_warnings", null, null, {}, false, null);
  const jobsBefore = await h.count("permit_sync_jobs");
  await h.db.exec(script("02-enable-sync-cron.sql"));
  await h.db.exec(script("01-enable-monitor-cron.sql"));
  assert.deepEqual(await cronJobs(), ["permit-sync-alert-notifier", "permit-sync-enqueue", "permit-sync-monitor"]);
  assert.equal(await h.count("permit_sync_jobs"), jobsBefore, "installing cron enqueues nothing by itself");
  const status = await admin(`SELECT admin_permit_sync_scheduler_status() AS s`);
  assert.equal(status[0].s.cron_jobs.length, 3);

  await h.db.exec(script("99-disable-all.sql"));
  await h.db.exec(script("99-disable-all.sql"));
  assert.deepEqual(await cronJobs(), []);
});
