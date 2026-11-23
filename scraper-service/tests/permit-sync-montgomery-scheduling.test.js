"use strict";

/**
 * D-146..D-149: Montgomery County MD (montgomery-projectdox) on the nightly schedule next to DC, offline on the
 * real migration chain. The Scheduling tab save replayed as PostgREST runs it, the enqueue at a DST-correct
 * 06:00 America/New_York, the separate claims and the single-worker wait when DC and Montgomery overlap, the
 * monitor, the prepared budget script, the worker-scope deferral and the retry of due failed files.
 * Nothing here reaches a portal, a browser or production.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createDeepDb } = require("./helpers/permit-sync-deep");
const { pgliteWorkerRpc } = require("./helpers/permit-sync-rpc");
const fx = require("./helpers/permit-repo-fixtures");
const entry = require("../permit-sync/worker-entry");
const { runJob } = require("../permit-sync/core/worker");
const { planDeepPass, buildFileGate } = require("../permit-sync/deep/policy");

const ADMIN = "70000000-0000-4000-8000-000000000001";
const OWNER = "70000000-0000-4000-8000-000000000002";
const DC = "70000000-0000-4000-8000-0000000000d1";
const MONT = "70000000-0000-4000-8000-0000000000e1";
const ENVELOPE = '{"pc_v":"1","iv":"aXY=","at":"YXQ=","ct":"Y3Q="}';
const DC_SLOT = { frequency: "daily", time: "04:00", timezone: "America/New_York" };
const MONT_SLOT = { frequency: "daily", time: "06:00", timezone: "America/New_York" };
const SCRIPTS = path.join(__dirname, "../../scripts/permit-repo/scheduling");

async function setup() {
  const h = await createDeepDb();
  for (const id of [ADMIN, OWNER]) await h.db.query(`INSERT INTO auth.users (id, email) VALUES ($1, $2)`, [id, `${id.slice(-1)}@test.invalid`]);
  await h.db.query(`INSERT INTO public.profiles (user_id) VALUES ($1), ($2) ON CONFLICT (user_id) DO NOTHING`, [ADMIN, OWNER]);
  await h.db.query(`INSERT INTO public.user_roles (user_id, role) VALUES ($1, 'admin')`, [ADMIN]);
  await h.db.query(
    `INSERT INTO public.portal_credentials (id, user_id, jurisdiction, portal_username, portal_password, permit_number)
     VALUES ($1, $3, 'Washington DC - ProjectDox', 'dc-acct@example.test', $4, 'B1'), ($2, $3, 'Montgomery County MD - Avolve', 'mc-acct@example.test', $4, 'COMBUILD-1000001')`,
    [DC, MONT, OWNER, ENVELOPE],
  );
  const admin = (sql, params = []) => h.db.transaction(async (tx) => {
    await tx.query(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [ADMIN]);
    await tx.exec(`SET LOCAL ROLE authenticated`);
    return (await tx.query(sql, params)).rows;
  });
  await admin(`SELECT admin_set_permit_sync_source($1, 'dc-projectdox', false, '{}'::jsonb)`, [DC]);
  await admin(`SELECT admin_set_permit_sync_source($1, 'montgomery-projectdox', false, '{}'::jsonb)`, [MONT]);
  // supabase.rpc('admin_set_permit_sync_schedule', scheduleSavePayload(...)) for Daily, the time, America/New_York.
  const save = async (credentialId, enabled, schedule) => (await admin(
    `SELECT public.admin_set_permit_sync_schedule(p_credential_id => $1, p_enabled => $2, p_schedule => $3::jsonb, p_deep_defaults => $4::jsonb, p_max_attempts => $5) AS r`,
    [credentialId, enabled, JSON.stringify(schedule), null, null],
  ))[0].r;
  const source = async (id) => (await h.db.query(`SELECT * FROM permit_sync_sources WHERE credential_id = $1`, [id])).rows[0];
  const jobs = async () => (await h.db.query(`SELECT id, credential_id, adapter_key, trigger, worker_mode, status, lease_worker_id FROM permit_sync_jobs ORDER BY created_at, adapter_key`)).rows;
  const enabledYesterday = (id) => h.db.query(`UPDATE permit_sync_sources SET schedule_enabled_at = now() - interval '1 day', last_scheduled_at = NULL WHERE credential_id = $1`, [id]);
  const monitor = () => h.svc(`SELECT permit_sync_monitor()`);
  const alerts = async () => (await h.db.query(`SELECT category, alert_key, title, detail, data FROM permit_sync_alerts WHERE resolved_at IS NULL ORDER BY alert_key`)).rows;
  return { h, admin, save, source, jobs, enabledYesterday, monitor, alerts };
}

const nyTime = (iso) => new Date(iso).toLocaleString("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

test("Scheduling tab lists Montgomery; the save at 06:00 America/New_York keeps the budget scope and never runs a slot before it was enabled", async () => {
  const s = await setup();
  const overview = (await s.admin(`SELECT get_permit_sync_overview() AS o`))[0].o;
  const listed = overview.filter((o) => o.can_refresh).map((o) => o.adapter_key).sort();
  assert.deepEqual(listed, ["dc-projectdox", "montgomery-projectdox"], "SchedulePanel renders one row per can_refresh source");

  await s.h.db.exec(fs.readFileSync(path.join(SCRIPTS, "05-montgomery-budget.sql"), "utf8"));
  assert.equal((await s.source(MONT)).settings.central_budget_scope, "montgomery");
  assert.equal((await s.source(DC)).settings.central_budget_scope, undefined, "DC keeps the env scope");
  const budget = await s.h.svc(`SELECT permit_ai_budget_status('montgomery')`);
  assert.equal(Number(budget.cap_usd), 3);
  assert.equal(budget.approved, true);

  const out = await s.save(MONT, true, MONT_SLOT);
  assert.deepEqual([out.automation_enabled, out.status], [true, "active"]);
  assert.equal(nyTime(out.next_run_at), "06:00");
  const nyOffsetHours = (new Date(out.next_run_at).getUTCHours() - 6 + 24) % 24;
  assert.ok([4, 5].includes(nyOffsetHours), "11:00 UTC in EST, 10:00 UTC in EDT");
  const stored = await s.source(MONT);
  assert.deepEqual(stored.settings.schedule, MONT_SLOT);
  assert.equal(stored.settings.central_budget_scope, "montgomery", "the save merges settings; the budget scope survives");
  assert.equal(stored.visible_to_all, (await s.source(MONT)).visible_to_all);

  assert.equal(await s.h.svc(`SELECT enqueue_permit_sync_runs()`), 0, "a slot before enabling never runs");
  assert.equal(await s.h.count("permit_sync_jobs"), 0);
  await s.enabledYesterday(MONT);
  assert.equal(await s.h.svc(`SELECT enqueue_permit_sync_runs()`), 1);
  assert.equal(await s.h.svc(`SELECT enqueue_permit_sync_runs()`), 0, "the same slot is not enqueued twice");
  const [j] = await s.jobs();
  assert.deepEqual([j.credential_id, j.adapter_key, j.trigger, j.worker_mode, j.status], [MONT, "montgomery-projectdox", "scheduled", "deep", "queued"]);
  assert.equal((await s.source(DC)).automation_enabled, false, "DC is untouched");

  // The first-run check is read-only and parses on the real schema.
  const before = await s.h.count("permit_sync_jobs");
  const check = (await s.h.db.query(fs.readFileSync(path.join(SCRIPTS, "06-verify-montgomery-first-run.sql"), "utf8"))).rows[0].montgomery_first_run;
  assert.equal(check.sources.length, 1);
  assert.equal(check.sources[0].credential_encrypted, true);
  assert.equal(check.scheduled_jobs_today.length, 1);
  assert.equal(await s.h.count("permit_sync_jobs"), before);
  assert.equal(JSON.stringify(check).includes("example.test"), false, "no username in the check output");
});

test("06:00 America/New_York fires once a day at 11:00Z (EST) / 10:00Z (EDT), always two hours after DC's 04:00", async () => {
  const { h } = await setup();
  const fired = async (sched, fromIso, toIso, lastRun) => {
    const out = [];
    let last = lastRun;
    for (let t = Date.parse(fromIso); t < Date.parse(toIso); t += 5 * 60 * 1000) {
      const now = new Date(t).toISOString();
      const slot = (await h.db.query(`SELECT public._permit_sync_due_slot($1::jsonb, $2, $3, $4) AS s`, [JSON.stringify(sched), last, "2026-01-01T00:00:00Z", now])).rows[0].s;
      if (slot) {
        out.push(new Date(slot).toISOString());
        last = slot;
      }
    }
    return out;
  };
  const spring = await fired(MONT_SLOT, "2026-03-07T00:00:00Z", "2026-03-10T00:00:00Z", "2026-03-06T11:00:00Z");
  assert.deepEqual(spring, ["2026-03-07T11:00:00.000Z", "2026-03-08T10:00:00.000Z", "2026-03-09T10:00:00.000Z"]);
  const fall = await fired(MONT_SLOT, "2026-10-31T00:00:00Z", "2026-11-03T00:00:00Z", "2026-10-30T10:00:00Z");
  assert.deepEqual(fall, ["2026-10-31T10:00:00.000Z", "2026-11-01T11:00:00.000Z", "2026-11-02T11:00:00.000Z"]);
  const dc = await fired(DC_SLOT, "2026-10-31T00:00:00Z", "2026-11-03T00:00:00Z", "2026-10-30T08:00:00Z");
  assert.deepEqual(fall.map((m, i) => (Date.parse(m) - Date.parse(dc[i])) / 3600e3), [2, 2, 2]);
  // Enabled at 06:30 local: today's 06:00 slot is never run; the next one is tomorrow's.
  const enabledAt = "2026-11-18T11:30:00Z";
  const none = (await h.db.query(`SELECT public._permit_sync_due_slot($1::jsonb, NULL, $2, $3) AS s`, [JSON.stringify(MONT_SLOT), enabledAt, "2026-11-18T12:00:00Z"])).rows[0].s;
  assert.equal(none, null);
  const next = (await h.db.query(`SELECT public._permit_sync_due_slot($1::jsonb, NULL, $2, $3) AS s`, [JSON.stringify(MONT_SLOT), enabledAt, "2026-11-19T11:05:00Z"])).rows[0].s;
  assert.equal(new Date(next).toISOString(), "2026-11-19T11:00:00.000Z");
});

test("DC and Montgomery overlap: separate claims; one worker runs one job and the other waits, without a queued_unclaimed alert", async () => {
  const s = await setup();
  const deep = pgliteWorkerRpc(s.h, { mode: "deep" });
  await s.save(DC, true, DC_SLOT);
  await s.save(MONT, true, MONT_SLOT);

  // DC's slot first; the single deep worker claims it.
  await s.enabledYesterday(DC);
  assert.equal(await s.h.svc(`SELECT enqueue_permit_sync_runs()`), 1);
  await deep.workerBeat("w1", "idle", null, {});
  const dcJob = await deep.claim("w1", 300);
  assert.equal(dcJob.adapter_key, "dc-projectdox");
  await deep.workerBeat("w1", "busy", dcJob.id, {});

  // DC is still running at Montgomery's slot: the Montgomery job is enqueued anyway (another login) and waits.
  await s.enabledYesterday(MONT);
  assert.equal(await s.h.svc(`SELECT enqueue_permit_sync_runs()`), 1, "a running DC job does not skip Montgomery's slot");
  const mont = (await s.jobs()).find((j) => j.adapter_key === "montgomery-projectdox");
  assert.equal(mont.status, "queued");
  await s.h.db.query(`UPDATE permit_sync_jobs SET next_attempt_at = now() - interval '40 minutes' WHERE id = $1`, [mont.id]);
  await s.monitor();
  assert.deepEqual((await s.alerts()).map((a) => a.category), [], "every live deep worker is busy: waiting is expected");

  // A second, idle worker that does not claim it is a real problem.
  await deep.workerBeat("w2", "idle", null, {});
  await s.monitor();
  const raised = await s.alerts();
  assert.deepEqual(raised.map((a) => a.category), ["queued_unclaimed"]);
  assert.equal(JSON.stringify(raised).includes("example.test"), false, "alert text carries no username");
  assert.match(raised[0].detail, /Montgomery County MD/);

  // Separate claims: the per-login lock does not couple the two portals.
  const montJob = await deep.claim("w2", 300);
  assert.equal(montJob.id, mont.id);
  const running = (await s.jobs()).filter((j) => j.status === "running").map((j) => [j.adapter_key, j.lease_worker_id]).sort();
  assert.deepEqual(running, [["dc-projectdox", "w1"], ["montgomery-projectdox", "w2"]]);
  await s.monitor();
  assert.deepEqual(await s.alerts(), [], "claimed: the alert resolves");
  assert.equal(await deep.claim("w3", 300), null, "nothing else to claim");

  // A wait of more than 4 hours behind busy workers is reported again.
  await deep.finish(montJob.id, "w2", "completed", null, null, { permits_ok: 0 }, false, null);
  await s.h.db.query(`UPDATE permit_sync_workers SET status = 'stopped' WHERE worker_id = 'w2'`);
  await s.h.db.query(`UPDATE permit_sync_sources SET last_scheduled_at = NULL, schedule_enabled_at = now() - interval '2 days' WHERE credential_id = $1`, [MONT]);
  assert.equal(await s.h.svc(`SELECT enqueue_permit_sync_runs()`), 1);
  await s.h.db.query(`UPDATE permit_sync_jobs SET next_attempt_at = now() - interval '5 hours' WHERE status = 'queued'`);
  await s.monitor();
  assert.deepEqual((await s.alerts()).map((a) => a.category), ["queued_unclaimed"]);
});

test("a worker narrowed to DC ProjectIDs hands a Montgomery job back (attempt kept) before any credential read or browser", async () => {
  const s = await setup();
  const deep = pgliteWorkerRpc(s.h, { mode: "deep" });
  const full = { PERMIT_SYNC_WORKER_ENABLED: "true", PERMIT_SYNC_LIVE_PORTAL_APPROVED: "A-3", SUPABASE_URL: "u", SUPABASE_SERVICE_ROLE_KEY: "k", PORTAL_CREDENTIALS_ENCRYPTION_KEY: "x", PERMIT_SYNC_MODE: "deep" };
  assert.equal(entry.startupCheck({ ...full, PERMIT_SYNC_ONLY_PORTAL_RECORD_IDS: "11105,montgomery-projectdox:200100" }).ok, true);
  for (const bad of ["B2407514", "other-portal:200100", "montgomery-projectdox:abc"]) {
    assert.equal(entry.startupCheck({ ...full, PERMIT_SYNC_ONLY_PORTAL_RECORD_IDS: bad }).ok, false, bad);
  }
  assert.deepEqual(entry.scopeForAdapter(["11105", "9187"], "dc-projectdox"), ["11105", "9187"], "plain ids are DC's, as before");
  assert.deepEqual(entry.scopeForAdapter(["11105", "montgomery-projectdox:200100"], "montgomery-projectdox"), ["200100"]);
  assert.equal(entry.scopeForAdapter(null, "montgomery-projectdox"), null);

  await s.save(MONT, true, MONT_SLOT);
  await s.enabledYesterday(MONT);
  await s.h.svc(`SELECT enqueue_permit_sync_runs()`);
  const job = await deep.claim("w1", 300);
  const env = ["11105"];
  const open = entry.buildOpenAdapter({
    supabase: { from() { throw new Error("no credential read"); } },
    env: { PERMIT_SYNC_MODE: "deep" },
    launchContext: async () => { throw new Error("no browser"); },
    lock: async () => { throw new Error("no lock"); },
    scope: env,
  });
  await assert.rejects(open(job), (e) => e.code === "deferred_worker_scope");
  const r = await runJob({ job, rpc: deep, openAdapter: open, workerId: "w1", scope: (j) => entry.scopeForAdapter(env, j.adapter_key) });
  assert.deepEqual([r.outcome, r.code], ["released", "deferred_worker_scope"]);
  const row = (await s.h.db.query(`SELECT status, attempt_count, error_code, next_attempt_at > now() + interval '9 minutes' AS later FROM permit_sync_jobs WHERE id = $1`, [job.id])).rows[0];
  assert.deepEqual(row, { status: "retry_wait", attempt_count: 0, error_code: "deferred_worker_scope", later: true });
  await assert.rejects(deep.release(job.id, "w1", "made_up_reason", null, 30), /unknown release reason/);
});

test("the scheduled run retries only due failed files (the 9 open on 2026-11-18), never backoff or exhausted ones", () => {
  const now = Date.parse("2026-11-19T11:05:00Z");
  const past = "2026-11-18T20:00:00Z";
  const doc = (id, o) => ({ portal_file_id: String(id), download_permitted: false, size_bytes: 1000, ...o });
  const documents = [
    ...Array.from({ length: 6 }, (_, i) => doc(100 + i, { download_status: "failed", capture_attempts: 1, capture_next_attempt_at: past })),
    ...Array.from({ length: 2 }, (_, i) => doc(200 + i, { download_status: "failed", capture_attempts: 2, capture_next_attempt_at: past })),
    doc(300, { download_status: "failed", capture_attempts: 1, capture_next_attempt_at: past, download_permitted: true }),
    doc(400, { download_status: "failed", capture_attempts: 1, capture_next_attempt_at: "2026-11-19T15:00:00Z" }),
    doc(500, { download_status: "failed", capture_attempts: 5, capture_next_attempt_at: past }),
    doc(600, { download_status: "stored", storage_path: "x", sha256: "y" }),
  ];
  const hashes = { status: "a", files: "b", reviews: "c", tasks: "d", workflows: "e" };
  const plan = planDeepPass({ previousHashes: hashes, hashes, documents, now });
  assert.equal(plan.run, true);
  assert.equal(plan.pendingDocuments, 9, "the 9 due failures, nothing else");
  assert.deepEqual(plan.tabs, ["files"]);
  const gate = buildFileGate(documents, { now });
  const decisions = documents.map((d) => [d.portal_file_id, gate(d.portal_file_id).reason]);
  assert.deepEqual(decisions.filter(([, r]) => r === "retry").length, 9);
  assert.deepEqual(Object.fromEntries(decisions.filter(([id]) => ["400", "500", "600"].includes(id))), { 400: "retry_backoff", 500: "retry_exhausted", 600: "already_stored" });
  assert.equal(gate("105").accessPath, "viewer", "Montgomery view-only files go through the viewer's GET RetrieveFile");
});

test("central processing paused for budget raises one alert per adapter, without names or comment text", async () => {
  const s = await setup();
  await s.h.rpc("apply_permit_discovery", fx.discovery({ credentialId: DC }));
  const permits = (await s.h.db.query(`SELECT id FROM permits ORDER BY portal_record_id LIMIT 3`)).rows.map((r) => r.id);
  await s.h.db.query(`UPDATE permits SET adapter_key = 'montgomery-projectdox' WHERE id = ANY ($1::uuid[])`, [permits.slice(0, 2)]);
  await s.h.db.query(`INSERT INTO permit_comment_processing_state (permit_id, status, last_error) SELECT unnest($1::uuid[]), 'paused', 'budget_not_found'`, [permits]);
  await s.monitor();
  const a = (await s.alerts()).filter((x) => x.category === "central_budget_paused");
  assert.deepEqual(a.map((x) => [x.alert_key, x.data.permits]), [["central_budget_paused:dc-projectdox", 1], ["central_budget_paused:montgomery-projectdox", 2]]);
  assert.match(a[1].detail, /^montgomery-projectdox: 2 permit\(s\) paused for budget since /);
  await s.h.db.query(`UPDATE permit_comment_processing_state SET status = 'completed'`);
  await s.monitor();
  assert.deepEqual((await s.alerts()).filter((x) => x.category === "central_budget_paused"), [], "auto-resolves");
});
