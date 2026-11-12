"use strict";

/**
 * Local fault injection on the real migration chain (PGlite), the real worker core and the DC adapter over the
 * offline fixture portal: shutdown mid-run, a worker crash (expired lease), a manual scrape holding the login,
 * a cancel mid-run, retries running out, and the per-permit progress the Permit Queue reads (D-096, D-098).
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const { createDeepDb } = require("./helpers/permit-sync-deep");
const { pgliteWorkerRpc } = require("./helpers/permit-sync-rpc");
const { createDcFixtureTransport } = require("./helpers/dc-fixture-transport");
const { createDcAdapter } = require("../permit-sync/adapters/dc-projectdox/adapter");
const { runOnce } = require("../permit-sync/core/worker");
const { DeferredError, SessionEndedError, LeaseLostError } = require("../permit-sync/core/errors");
const entry = require("../permit-sync/worker-entry");

const OWNER = "60000000-0000-4000-8000-000000000001";
const ADMIN = "60000000-0000-4000-8000-000000000002";
const CRED = "60000000-0000-4000-8000-0000000000c1";

async function setup() {
  const h = await createDeepDb();
  for (const id of [OWNER, ADMIN]) await h.db.query(`INSERT INTO auth.users (id, email) VALUES ($1, $2)`, [id, `${id.slice(-1)}@test.invalid`]);
  await h.db.query(`INSERT INTO public.profiles (user_id) VALUES ($1), ($2) ON CONFLICT (user_id) DO NOTHING`, [OWNER, ADMIN]);
  await h.db.query(`INSERT INTO public.user_roles (user_id, role) VALUES ($1, 'admin')`, [ADMIN]);
  await h.db.query(`INSERT INTO public.portal_credentials (id, user_id, jurisdiction, portal_username, portal_password, permit_number) VALUES ($1, $2, 'Washington DC - ProjectDox', 'acct', '{"pc_v":"1","iv":"aXY=","at":"YXQ=","ct":"Y3Q="}', 'B1')`, [CRED, OWNER]);
  const admin = (sql, params = []) => h.db.transaction(async (tx) => {
    await tx.query(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [ADMIN]);
    await tx.exec(`SET LOCAL ROLE authenticated`);
    return (await tx.query(sql, params)).rows;
  });
  await admin(`SELECT admin_set_permit_sync_source($1, 'dc-projectdox', false, '{"account_download": false}'::jsonb)`, [CRED]);
  const refreshAll = async () => (await admin(`SELECT request_permit_sync_refresh($1) AS r`, [CRED]))[0].r;
  const job = async (id) => (await h.db.query(`SELECT * FROM permit_sync_jobs WHERE id = $1`, [id])).rows[0];
  const phases = async (id) => (await h.db.query(`SELECT phase, count(*)::int AS n FROM permit_sync_job_permits WHERE job_id = $1 GROUP BY phase ORDER BY phase`, [id])).rows;
  return { h, admin, refreshAll, job, phases, rpc: pgliteWorkerRpc(h, { mode: "deep" }) };
}

function opener(wrap = (a) => a, extra = {}) {
  return async () => ({ adapter: wrap(createDcAdapter({ transport: createDcFixtureTransport(), accountDownload: false })), close: async () => {}, ...extra });
}

/** Aborts the controller when the adapter has fetched `n` permits. */
function abortAfter(n, controller) {
  let calls = 0;
  return (adapter) => ({
    ...adapter,
    async fetchPermit(record) {
      const out = await adapter.fetchPermit(record);
      calls += 1;
      if (calls === n) controller.abort();
      return out;
    },
  });
}

test("shutdown mid-run: the job is released with its checkpoint and attempt, and the next worker finishes it", async () => {
  const { h, refreshAll, job, phases, rpc } = await setup();
  const r = await refreshAll();
  const controller = new AbortController();
  const first = await runOnce({ rpc, openAdapter: opener(abortAfter(5, controller)), workerId: "w1", signal: controller.signal });
  assert.equal(first.outcome, "released");
  assert.equal(first.code, "worker_shutdown");
  let j = await job(r.job_id);
  assert.deepEqual([j.status, j.attempt_count, j.release_count, j.phase], ["retry_wait", 0, 1, "released"]);
  assert.equal(j.checkpoint.done.length, 5, "permits finished before the signal are kept");
  assert.equal(j.checkpoint.discovered.length, 28);
  assert.deepEqual(await phases(r.job_id), [{ phase: "completed", n: 5 }, { phase: "retrying", n: 23 }], "open rows wait for the job to resume");

  await h.db.query(`UPDATE permit_sync_jobs SET next_attempt_at = now() WHERE id = $1`, [r.job_id]);
  const second = await runOnce({ rpc, openAdapter: opener(), workerId: "w2" });
  assert.equal(second.outcome, "completed");
  assert.equal(second.metrics.permits_skipped_done, 5);
  assert.equal(second.metrics.permits_ok, 23);
  j = await job(r.job_id);
  assert.deepEqual([j.status, j.attempt_count], ["completed", 1], "the restart did not use an attempt");
  assert.deepEqual(await phases(r.job_id), [{ phase: "completed", n: 28 }]);
});

test("worker crash: an expired lease is reclaimed (one attempt), open rows go back to queued, and the run resumes", async () => {
  const { h, refreshAll, job, phases, rpc } = await setup();
  const r = await refreshAll();
  let calls = 0;
  const crashing = (adapter) => ({ ...adapter, async fetchPermit(record) { calls += 1; if (calls === 8) throw new LeaseLostError(); return adapter.fetchPermit(record); } });
  assert.equal((await runOnce({ rpc, openAdapter: opener(crashing), workerId: "w1" })).outcome, "lease_lost");
  assert.equal((await job(r.job_id)).status, "running", "a dead worker leaves the job running until its lease expires");
  assert.equal((await phases(r.job_id)).find((p) => p.phase === "reading_info").n, 1, "the permit being read when it died");

  await h.db.query(`UPDATE permit_sync_jobs SET lease_expires_at = now() - interval '1 second' WHERE id = $1`, [r.job_id]);
  const again = await runOnce({ rpc, openAdapter: opener(), workerId: "w2" });
  assert.equal(again.outcome, "completed");
  assert.equal(again.metrics.permits_skipped_done, 7);
  assert.equal((await job(r.job_id)).attempt_count, 2);
  assert.deepEqual(await phases(r.job_id), [{ phase: "completed", n: 28 }]);
});

test("a manual scrape holding the login defers the job without spending an attempt", async () => {
  const { refreshAll, job, rpc } = await setup();
  const r = await refreshAll();
  const busy = async () => { throw new DeferredError("a manual DC scrape is using this portal login; deferred"); };
  const out = await runOnce({ rpc, openAdapter: busy, workerId: "w1" });
  assert.deepEqual([out.outcome, out.code], ["released", "deferred_manual_scrape"]);
  const j = await job(r.job_id);
  assert.deepEqual([j.status, j.attempt_count, j.error_code], ["retry_wait", 0, "deferred_manual_scrape"]);
  const wait = (new Date(j.next_attempt_at) - Date.now()) / 1000;
  assert.ok(wait > 100 && wait <= 120, `retried after about two minutes (${wait}s)`);
});

test("the manual-scrape lock in worker-entry raises the deferral, not a failure", async () => {
  const fakeSupabase = {
    from(table) {
      const q = {
        select() { return q; }, eq() { return q; }, in() { return q; }, gt() { return q; },
        limit() { return Promise.resolve({ data: [{ id: "s1", credential_id: null, scraper_session_id: "manual-1", metadata: { portal_subtype: "dc-planreview" } }], error: null }); },
        then(res, rej) { return Promise.resolve({ data: [{ id: "c1", jurisdiction: "Washington DC" }], error: null }).then(res, rej); },
      };
      return table === "portal_credentials" || table === "scrape_jobs" ? q : null;
    },
  };
  await assert.rejects(entry.deferWhileManualScrape({ supabase: fakeSupabase, username: "acct" }), (e) => e instanceof DeferredError);
});

test("cancel mid-run: the worker stops at the next heartbeat; finished permits stay, the rest are cancelled", async () => {
  const { admin, refreshAll, job, phases, rpc } = await setup();
  const r = await refreshAll();
  let calls = 0;
  const cancelling = (adapter) => ({
    ...adapter,
    async fetchPermit(record) {
      calls += 1;
      if (calls === 4) await admin(`SELECT cancel_permit_sync_job($1)`, [r.job_id]);
      return adapter.fetchPermit(record);
    },
  });
  const out = await runOnce({ rpc, openAdapter: opener(cancelling), workerId: "w1" });
  assert.equal(out.outcome, "lease_lost");
  assert.equal((await job(r.job_id)).status, "cancelled");
  const p = Object.fromEntries((await phases(r.job_id)).map((x) => [x.phase, x.n]));
  assert.equal(p.completed, 3);
  assert.equal(p.cancelled, 25, "the permit in progress and the rest are cancelled");
});

test("bounded retries: a failing session backs off and the job fails after max_attempts (5)", async () => {
  const { h, refreshAll, job, rpc } = await setup();
  const r = await refreshAll();
  const failing = async () => { throw new SessionEndedError(); };
  const delays = [];
  for (let i = 1; i <= 5; i += 1) {
    await h.db.query(`UPDATE permit_sync_jobs SET next_attempt_at = now() WHERE id = $1`, [r.job_id]);
    const out = await runOnce({ rpc, openAdapter: failing, workerId: `w${i}` });
    assert.equal(out.outcome, "failed");
    const j = await job(r.job_id);
    if (i < 5) {
      assert.equal(j.status, "retry_wait");
      delays.push(Math.round((new Date(j.next_attempt_at) - Date.now()) / 60000));
    } else {
      assert.equal(j.status, "failed", "no sixth attempt");
    }
  }
  assert.deepEqual(delays, [5, 10, 20, 40], "exponential back-off in minutes");
  assert.equal((await runOnce({ rpc, openAdapter: failing, workerId: "w6" })).idle, true);
});

test("progress from the deep hook: counts recorded per permit, warnings when items stay open", async () => {
  const { h, refreshAll, rpc } = await setup();
  const r = await refreshAll();
  const afterPermit = async ({ record, progress }) => {
    const open = record.portal_record_id === "11854";
    await progress({ phase: "downloading_files", files_total: 4, files_captured: 2, reports_total: 5, reports_captured: 0 });
    await progress({ phase: "exporting_reports", files_total: 4, files_captured: open ? 3 : 4, files_pending: open ? 1 : 0, reports_total: 5, reports_captured: 5 });
    return { deep_passes: 1, files_pending: open ? 1 : 0 };
  };
  const out = await runOnce({ rpc, openAdapter: opener(undefined, { afterPermit }), workerId: "w1" });
  assert.equal(out.outcome, "completed_with_warnings");
  const rows = (await h.db.query(`SELECT portal_record_id, phase, files_total, files_captured, files_pending, reports_captured, finished_at IS NOT NULL AS done FROM permit_sync_job_permits WHERE job_id = $1 ORDER BY portal_record_id`, [r.job_id])).rows;
  const d = rows.find((x) => x.portal_record_id === "11854");
  assert.deepEqual(d, { portal_record_id: "11854", phase: "completed_with_warnings", files_total: 4, files_captured: 3, files_pending: 1, reports_captured: 5, done: true });
  assert.equal(rows.filter((x) => x.phase === "completed" && x.files_captured === 4).length, 27);
  const summary = (await h.db.query(`SELECT _permit_sync_job_summary(j) AS s FROM permit_sync_jobs j WHERE id = $1`, [r.job_id])).rows[0].s;
  assert.deepEqual([summary.permits_total, summary.permits_done, summary.permits_with_warnings, summary.files_captured, summary.files_total], [28, 28, 1, 111, 112]);
});

test("worker liveness rows and /health", async () => {
  const { h } = await setup();
  const rpc = pgliteWorkerRpc(h, { mode: "deep" });
  await rpc.workerBeat("host:1", "busy", null, { rss_mb: 300 });
  assert.equal(await h.count("permit_sync_workers", "worker_id = 'host:1' AND status = 'busy'"), 1);
  await assert.rejects(rpc.workerBeat("host:1", "dancing", null, {}), /permit_sync_workers_status_check|violates check/);

  let t = 0;
  const state = entry.createWorkerState({ now: () => t, staleMs: 1000 });
  state.tick({ status: "idle" });
  assert.equal(state.healthy(), true);
  t = 2000;
  assert.equal(state.healthy(), false, "a loop that stopped ticking is unhealthy");
  state.tick({ status: "busy", jobId: "j" });
  t = 100000;
  assert.equal(state.healthy(), true, "a long job is not a stall");
  state.tick({ status: "stopped" });
  assert.equal(state.healthy(), false);

  const lines = [];
  entry.createLogger((l) => lines.push(l))("info", "job_claimed", { job: "j1" });
  const parsed = JSON.parse(lines[0]);
  assert.deepEqual([parsed.level, parsed.event, parsed.job, parsed.svc], ["info", "job_claimed", "j1", "permit-sync-worker"]);
});

test("the worker never enqueues: no request, enqueue or admin RPC appears in permit-sync code", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const root = path.join(__dirname, "..", "permit-sync");
  const files = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) (e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith(".js") && files.push(path.join(d, e.name))); };
  walk(root);
  assert.ok(files.length > 10);
  for (const f of files) {
    const src = fs.readFileSync(f, "utf8");
    assert.doesNotMatch(src, /request_permit_|enqueue_permit_sync_runs|admin_request_permit|admin_retry_permit|_permit_sync_request/, path.relative(root, f));
  }
});

test("startup: new tunables are validated and nothing is claimed when the worker is not enabled", async () => {
  const full = { PERMIT_SYNC_WORKER_ENABLED: "true", PERMIT_SYNC_LIVE_PORTAL_APPROVED: "A-3", SUPABASE_URL: "x", SUPABASE_SERVICE_ROLE_KEY: "y", PORTAL_CREDENTIALS_ENCRYPTION_KEY: "z", PERMIT_SYNC_MODE: "deep" };
  assert.equal(entry.startupCheck({ ...full, PERMIT_SYNC_LEASE_TTL_SECONDS: "600", PERMIT_SYNC_PERMIT_PAUSE_MS: "2000" }).ok, true);
  assert.equal(entry.startupCheck({ ...full, PERMIT_SYNC_IDLE_MS: "soon" }).ok, false);
  assert.equal(entry.startupCheck({ ...full, PERMIT_SYNC_HEALTH_PORT: "-1" }).ok, false);
  const logs = [];
  const orig = console.log;
  console.log = (l) => logs.push(l);
  try {
    assert.equal(await entry.main({ ...full, PERMIT_SYNC_WORKER_ENABLED: "false" }), 0);
  } finally {
    console.log = orig;
  }
  assert.equal(JSON.parse(logs[0]).event, "worker_not_started");
});
