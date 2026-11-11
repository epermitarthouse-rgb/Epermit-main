"use strict";

/**
 * Fixture-driven end-to-end runs: real queue + repository SQL (PGlite), real worker core, real DC
 * adapter and normalizers, real read-only guard, offline portal (tests/helpers/dc-fixture-transport.js).
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const { createPermitRepoDb } = require("./helpers/permit-repo-db");
const { pgliteWorkerRpc } = require("./helpers/permit-sync-rpc");
const { createDcFixtureTransport } = require("./helpers/dc-fixture-transport");
const { createDcAdapter } = require("../permit-sync/adapters/dc-projectdox/adapter");
const { runOnce, runLoop } = require("../permit-sync/core/worker");
const { MfaRequiredError, SessionEndedError, LeaseLostError } = require("../permit-sync/core/errors");

const OWNER = "00000000-0000-4000-8000-000000000001";
const ADMIN = "00000000-0000-4000-8000-000000000002";
const CRED = "00000000-0000-4000-8000-0000000000c1";

async function setup() {
  const h = await createPermitRepoDb();
  await h.createUser(OWNER);
  await h.createUser(ADMIN, { role: "admin" });
  await h.createCredential(CRED, OWNER);
  await h.asUser(ADMIN, (tx) => tx.query(`SELECT admin_set_permit_sync_source($1, 'dc-projectdox', true, '{"account_download": false}'::jsonb)`, [CRED]));
  const rpc = pgliteWorkerRpc(h);
  const enqueue = () => h.svc(`SELECT enqueue_permit_sync_runs()`);
  const jobRow = async () => (await h.db.query(`SELECT * FROM permit_sync_jobs ORDER BY created_at DESC LIMIT 1`)).rows[0];
  return { h, rpc, enqueue, jobRow };
}

function opener(transport, wrap = (a) => a) {
  return async () => ({ adapter: wrap(createDcAdapter({ transport, accountDownload: false })), close: async () => {} });
}

test("end to end: 28 permits ingested through the guard; second run produces no changes", async () => {
  const { h, rpc, enqueue, jobRow } = await setup();
  const transport = createDcFixtureTransport();
  await enqueue();
  const r1 = await runOnce({ rpc, openAdapter: opener(transport), workerId: "w1" });
  assert.equal(r1.outcome, "completed");
  assert.equal(r1.metrics.discovered, 28);
  assert.equal(r1.metrics.discovery_complete, true);
  assert.equal(r1.metrics.permits_ok, 28);
  assert.equal(r1.metrics.permits_failed, 0);
  assert.equal(r1.metrics.sections.reviews.failed || 0, 0);
  assert.equal(r1.metrics.sections.reviews.ok, 28, "every permit with a workflow has a corrections JSON read");
  assert.equal(r1.metrics.sections.status.ok, 28);
  assert.deepEqual(transport.guard.violations(), [], "every request was allowlisted");
  assert.ok(transport.requests.length > 100);

  assert.equal(await h.count("permits"), 28);
  assert.equal(await h.count("permit_review_comments"), 3);
  assert.equal(await h.count("permit_reports"), 28 * 5);
  const docs = (await h.db.query(`SELECT download_status FROM permit_documents`)).rows;
  assert.equal(docs.length, 2);
  assert.ok(docs.every((d) => d.download_status === "not_permitted"));
  const d = (await h.db.query(`SELECT status, unresolved_comments, uncompleted_tasks, title FROM permits WHERE portal_record_id = '11854'`)).rows[0];
  assert.deepEqual(d, { status: "resubmit", unresolved_comments: 1, uncompleted_tasks: 1, title: "Project D2500488" });
  const job = await jobRow();
  assert.equal(job.status, "completed");
  assert.equal(job.metrics.permits_ok, 28);

  await enqueue();
  const r2 = await runOnce({ rpc, openAdapter: opener(createDcFixtureTransport()), workerId: "w1" });
  assert.equal(r2.metrics.permits_ok, 28);
  assert.equal(r2.metrics.changes, 0, "identical portal state → no changes");
  assert.equal(r2.metrics.snapshots_inserted, 0);
});

test("crash mid-run: a new worker resumes from the checkpoint without duplicates", async () => {
  const { h, rpc, enqueue, jobRow } = await setup();
  await enqueue();
  let calls = 0;
  const crashing = (adapter) => ({
    ...adapter,
    async fetchPermit(record) {
      calls += 1;
      if (calls === 11) throw new LeaseLostError();
      return adapter.fetchPermit(record);
    },
  });
  const r1 = await runOnce({ rpc, openAdapter: opener(createDcFixtureTransport(), crashing), workerId: "w1" });
  assert.equal(r1.outcome, "lease_lost");
  let job = await jobRow();
  assert.equal(job.status, "running", "a crashed worker leaves the job running");
  assert.equal(job.checkpoint.done.length, 10);

  assert.equal((await runOnce({ rpc, openAdapter: opener(createDcFixtureTransport()), workerId: "w2" })).idle, true, "lease still held");
  await h.db.query(`UPDATE permit_sync_jobs SET lease_expires_at = now() - interval '1 second'`);
  const t2 = createDcFixtureTransport();
  const r2 = await runOnce({ rpc, openAdapter: opener(t2), workerId: "w2" });
  assert.equal(r2.metrics.permits_skipped_done, 10);
  assert.equal(r2.metrics.permits_ok, 18);
  assert.equal(t2.requests.filter((q) => q.route === "dashboard").length, 0, "discovery not repeated");
  job = await jobRow();
  assert.equal(job.attempt_count, 2);
  assert.equal(job.checkpoint.done.length, 28);
  assert.equal(new Set(job.checkpoint.done).size, 28);
  assert.equal(await h.count("permits"), 28);
  assert.equal(await h.count("permit_section_state", "section = 'status'"), 28);
});

test("a guard violation aborts the run as failed_unrecoverable and is not retried", async () => {
  const { h, rpc, enqueue, jobRow } = await setup();
  await enqueue();
  const transport = createDcFixtureTransport({ violateOn: "11854" });
  const r = await runOnce({ rpc, openAdapter: opener(transport), workerId: "w1" });
  assert.equal(r.outcome, "failed_unrecoverable");
  assert.equal(r.code, "safety_violation");
  assert.equal(transport.guard.violations().length, 1);
  assert.match(transport.guard.violations()[0].reason, /deny pattern/);
  const job = await jobRow();
  assert.equal(job.status, "failed_unrecoverable");
  assert.equal(job.error_code, "safety_violation");
  assert.equal((await runOnce({ rpc, openAdapter: opener(createDcFixtureTransport()), workerId: "w1" })).idle, true);
  assert.ok((await h.count("permits")) === 28, "discovery data already ingested is kept");
});

test("a section failure keeps prior data; a permit failure is isolated; session loss retries and resumes", async () => {
  const { h, rpc, enqueue, jobRow } = await setup();
  await enqueue();
  await runOnce({ rpc, openAdapter: opener(createDcFixtureTransport()), workerId: "w1" });

  await enqueue();
  const broken = createDcFixtureTransport({
    fail: { workflow_status: new Set(["11854"]) },
    mutate: (route, pid, data) => (route === "project_corrections" && pid === "11854" ? [] : data),
  });
  const wrapped = { ...rpc, applyBatch: async (b) => {
    if (b.permit.portal_record_id === "9187") throw new Error("injected apply failure");
    return rpc.applyBatch(b);
  } };
  const r = await runOnce({ rpc: wrapped, openAdapter: opener(broken), workerId: "w1" });
  assert.equal(r.outcome, "completed_with_warnings");
  assert.equal(r.metrics.permits_failed, 1);
  assert.equal(r.metrics.permits_ok, 27);
  assert.equal(await h.count("permit_review_comments", "removed_at IS NULL"), 3, "empty Reviews read does not delete comments");
  const st = (await h.db.query(`SELECT s.section, s.status FROM permit_section_state s JOIN permits p ON p.id = s.permit_id WHERE p.portal_record_id = '11854' AND s.section IN ('status', 'reviews') ORDER BY 1`)).rows;
  assert.deepEqual(st, [{ section: "reviews", status: "suspect_empty" }, { section: "status", status: "failed" }]);
  const p = (await h.db.query(`SELECT status, unresolved_comments FROM permits WHERE portal_record_id = '11854'`)).rows[0];
  assert.deepEqual(p, { status: "resubmit", unresolved_comments: 1 }, "failed status read keeps stored values");
  const events = (await h.db.query(`SELECT code, data FROM permit_sync_events WHERE code = 'permit_failed'`)).rows;
  assert.equal(events.length, 1);
  assert.equal(events[0].data.portal_record_id, "9187");

  await enqueue();
  let n = 0;
  const flaky = (adapter) => ({ ...adapter, async fetchPermit(rec) {
    n += 1;
    if (n === 5) throw new SessionEndedError();
    return adapter.fetchPermit(rec);
  } });
  const s1 = await runOnce({ rpc, openAdapter: opener(createDcFixtureTransport(), flaky), workerId: "w1" });
  assert.equal(s1.code, "session_ended");
  let job = await jobRow();
  assert.equal(job.status, "retry_wait");
  assert.equal(job.checkpoint.done.length, 4);
  await h.db.query(`UPDATE permit_sync_jobs SET next_attempt_at = now() WHERE id = $1`, [job.id]);
  const s2 = await runOnce({ rpc, openAdapter: opener(createDcFixtureTransport()), workerId: "w1" });
  assert.equal(s2.metrics.permits_skipped_done, 4);
  job = await jobRow();
  assert.equal(job.checkpoint.done.length, 28);
  assert.equal(job.status, "completed");
});

test("Reviews: a failed corrections JSON read falls back to the SSRS report; both failing keeps stored comments", async () => {
  const { h, rpc, enqueue } = await setup();
  await enqueue();
  const t1 = createDcFixtureTransport({ fail: { project_corrections_json: new Set(["11854"]) } });
  const r1 = await runOnce({ rpc, openAdapter: opener(t1), workerId: "w1" });
  assert.deepEqual(t1.guard.violations(), []);
  assert.ok(t1.requests.some((q) => q.route === "review_comments_report" && q.allowed), "report fetched through the guard");
  assert.equal(r1.metrics.sections.reviews.ok, 28);
  assert.equal(await h.count("permit_review_comments", "removed_at IS NULL AND source_kind = 'report'"), 3);

  await enqueue();
  const t2 = createDcFixtureTransport({ fail: { project_corrections_json: new Set(["11854"]), review_comments_report: new Set(["11854"]) } });
  const r2 = await runOnce({ rpc, openAdapter: opener(t2), workerId: "w1" });
  assert.equal(r2.outcome, "completed_with_warnings");
  assert.equal(r2.metrics.sections.reviews.failed, 1);
  assert.equal(await h.count("permit_review_comments", "removed_at IS NULL"), 3, "a failed read never deletes comments");
});

test("MFA at login parks the source in waiting_user; admin cancel stops a running worker", async () => {
  const { h, rpc, enqueue, jobRow } = await setup();
  await enqueue();
  const r = await runOnce({ rpc, openAdapter: async () => { throw new MfaRequiredError(); }, workerId: "w1" });
  assert.equal(r.outcome, "waiting_user");
  assert.equal((await jobRow()).status, "waiting_user");
  assert.equal((await h.db.query(`SELECT status FROM permit_sync_sources`)).rows[0].status, "waiting_user");
  assert.equal(await h.count("permits"), 0, "nothing scraped before login");

  await h.asUser(ADMIN, (tx) => tx.query(`SELECT admin_resume_permit_sync_source($1)`, [CRED]));
  await enqueue();
  let applied = 0;
  const cancelling = { ...rpc, applyBatch: async (b) => {
    applied += 1;
    if (applied === 3) await h.asUser(ADMIN, (tx) => tx.query(`SELECT admin_cancel_permit_sync_job(id) FROM permit_sync_jobs WHERE status = 'running'`));
    return rpc.applyBatch(b);
  } };
  const c = await runOnce({ rpc: cancelling, openAdapter: opener(createDcFixtureTransport()), workerId: "w1" });
  assert.equal(c.outcome, "lease_lost");
  assert.equal(applied, 3, "worker stops at the next heartbeat after cancellation");
  assert.equal((await jobRow()).status, "cancelled");
});

test("supervised mode (once): one claim attempt, no sleep, no second claim after a retryable failure", async () => {
  const { rpc, enqueue, jobRow } = await setup();
  let slept = 0;
  const sleep = async () => { slept += 1; };
  let claims = 0;
  const countingRpc = { ...rpc, claim: async (...a) => { claims += 1; return rpc.claim(...a); } };

  const idle = await runLoop({ rpc: countingRpc, openAdapter: async () => { throw new Error("unused"); }, workerId: "w", once: true, sleep });
  assert.equal(idle.idle, true);
  assert.equal(claims, 1);

  await enqueue();
  const openAdapter = async () => { throw new SessionEndedError(); };
  const r = await runLoop({ rpc: countingRpc, openAdapter, workerId: "w", once: true, sleep });
  assert.equal(r.idle, false);
  assert.equal(r.code, "session_ended");
  assert.equal((await jobRow()).status, "retry_wait");
  assert.equal(claims, 2, "the retry is left for a later, approved run");
  assert.equal(slept, 0);
});
