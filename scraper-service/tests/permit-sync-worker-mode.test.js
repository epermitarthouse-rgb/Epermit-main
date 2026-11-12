"use strict";

/**
 * D-073: deep jobs cannot be claimed by the deployed JSON-only worker. That worker calls the two-argument
 * claim_permit_sync_job; after 20261111120000_permit_deep_capture.sql it returns JSON jobs only. Real migration
 * chain on PGlite. The last test re-creates the claim function exactly as 20261111100100 defines it (the code
 * the deployed worker was built against) and shows it WOULD claim the deep job: the redefinition is what
 * protects it.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { createDeepDb } = require("./helpers/permit-sync-deep");
const { pgliteWorkerRpc } = require("./helpers/permit-sync-rpc");
const { supabaseWorkerRpc } = require("../permit-sync/core/worker");

const OWNER = "40000000-0000-4000-8000-000000000001";
const ADMIN = "40000000-0000-4000-8000-000000000002";
const USER = "40000000-0000-4000-8000-000000000003";
const CRED = "40000000-0000-4000-8000-0000000000c1";
const QUEUE_SQL = path.join(__dirname, "..", "..", "supabase", "migrations", "20261111100100_permit_sync_queue.sql");

async function setup() {
  const h = await createDeepDb();
  for (const id of [OWNER, ADMIN, USER]) await h.db.query(`INSERT INTO auth.users (id, email) VALUES ($1, $2)`, [id, `${id.slice(-1)}@test.invalid`]);
  await h.db.query(`INSERT INTO public.profiles (user_id) VALUES ($1), ($2), ($3) ON CONFLICT (user_id) DO NOTHING`, [OWNER, ADMIN, USER]);
  await h.db.query(`INSERT INTO public.user_roles (user_id, role) VALUES ($1, 'admin')`, [ADMIN]);
  await h.db.query(`INSERT INTO public.portal_credentials (id, user_id, jurisdiction, portal_username, portal_password, permit_number) VALUES ($1, $2, 'Washington DC - ProjectDox', 'acct', '{"pc_v":"1","iv":"aXY=","at":"YXQ=","ct":"Y3Q="}', 'B2407514')`, [CRED, OWNER]);
  const as = (uid) => (sql, params = []) => h.db.transaction(async (tx) => {
    await tx.query(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [uid]);
    await tx.exec(`SET LOCAL ROLE authenticated`);
    return (await tx.query(sql, params)).rows;
  });
  const admin = as(ADMIN);
  await admin(`SELECT admin_set_permit_sync_source($1, 'dc-projectdox', false, '{"account_download": false}'::jsonb)`, [CRED]);
  const oldClaim = async (worker = "railway-old") => {
    const j = await h.svc(`SELECT to_jsonb(j) FROM claim_permit_sync_job($1, 300) j`, [worker]);
    return j && j.id ? j : null;
  };
  const requestDeep = async (options = {}) => (await admin(`SELECT admin_request_permit_deep_sync($1, $2::jsonb) AS id`, [CRED, JSON.stringify(options)]))[0].id;
  return { h, admin, user: as(USER), oldClaim, requestDeep };
}

test("a deep job is invisible to the two-argument claim the deployed worker calls, queued or with an expired lease", async () => {
  const { h, oldClaim, requestDeep } = await setup();
  const id = await requestDeep({ only_portal_record_ids: ["11105"], max_files: 3, max_bytes: 1048576 });
  const row = (await h.db.query(`SELECT worker_mode, options, status, trigger FROM permit_sync_jobs WHERE id = $1`, [id])).rows[0];
  assert.deepEqual(row, { worker_mode: "deep", options: { only_portal_record_ids: ["11105"], max_files: 3, max_bytes: 1048576 }, status: "queued", trigger: "manual" });

  assert.equal(await oldClaim(), null, "queued deep job: not claimable by the old RPC");
  const deep = pgliteWorkerRpc(h, { mode: "deep" });
  const j = await deep.claim("local-deep", 300);
  assert.equal(j.id, id);
  assert.equal(j.worker_mode, "deep");
  assert.deepEqual(j.options.only_portal_record_ids, ["11105"]);

  await h.db.query(`UPDATE permit_sync_jobs SET lease_expires_at = now() - interval '1 second' WHERE id = $1`, [id]);
  assert.equal(await oldClaim(), null, "a deep job whose lease expired is not reclaimed by the old RPC either");
  assert.equal((await h.db.query(`SELECT status, attempt_count FROM permit_sync_jobs WHERE id = $1`, [id])).rows[0].attempt_count, 1);
  assert.equal((await pgliteWorkerRpc(h, { mode: "json" }).claim("json-new", 300)), null, "a JSON worker on the new RPC does not take it");
  assert.equal((await deep.claim("local-deep-2", 300)).id, id, "only a deep worker reclaims it");
});

test("JSON jobs keep working on the old RPC; the v2 RPC refuses an unknown mode", async () => {
  const { h, admin, oldClaim } = await setup();
  // D-093: requests are deep unless the source is set to JSON.
  await admin(`SELECT admin_set_permit_sync_source($1, 'dc-projectdox', false, '{"account_download": false, "worker_mode": "json"}'::jsonb)`, [CRED]);
  const jsonId = (await admin(`SELECT admin_request_permit_sync($1) AS id`, [CRED]))[0].id;
  assert.equal((await pgliteWorkerRpc(h, { mode: "deep" }).claim("d", 300)), null, "a deep worker never takes a JSON job");
  const j = await oldClaim();
  assert.equal(j.id, jsonId);
  assert.equal(j.worker_mode, "json");
  await assert.rejects(h.svc(`SELECT claim_permit_sync_job_v2('w', 300, 'other')`), /unknown worker mode/);
  await assert.rejects(h.svc(`SELECT _permit_sync_claim('w', 300, 'deep')`), /permission denied/, "internal claim is not callable by the service role");
});

test("deep requests: admin only, audited, validated options, never merged into an active job", async () => {
  const { h, user, admin, requestDeep } = await setup();
  await assert.rejects(user(`SELECT admin_request_permit_deep_sync($1, '{}'::jsonb)`, [CRED]), /Not authorized/);
  await assert.rejects(h.db.transaction(async (tx) => { await tx.exec(`SET LOCAL ROLE anon`); return tx.query(`SELECT admin_request_permit_deep_sync($1, '{}'::jsonb)`, [CRED]); }), /permission denied/);
  for (const bad of [{ nope: 1 }, { only_portal_record_ids: [] }, { only_portal_record_ids: ["abc"] }, { only_portal_record_ids: [11105] }, { max_files: -1 }, { max_files: 1.5 }, { max_bytes: "10" }]) {
    await assert.rejects(requestDeep(bad), /option|ProjectID|max_files|max_bytes/, JSON.stringify(bad));
  }
  const id = await requestDeep({ only_portal_record_ids: ["11105"] });
  await assert.rejects(requestDeep({ only_portal_record_ids: ["9187"] }), /already has an active job/);
  await assert.rejects(admin(`SELECT admin_request_permit_sync($1) AS id`, [CRED]), /controlled job with exact options is queued/,
    "Sync now never widens a queued exact-options job (D-094)");
  assert.equal(await h.count("permit_sync_jobs", "credential_id = $1", [CRED]), 1);
  assert.equal(await h.count("platform_audit_events", "action = 'permit_sync.request_deep'"), 1);
  assert.equal(await h.count("permit_sync_events", "job_id = $1 AND code = 'enqueued'", [id]), 1);
});

test("worker rpc: a job of the other mode is refused even if a claim returned one", async () => {
  const fake = (row) => ({ rpc: async () => ({ data: row, error: null }) });
  await assert.rejects(supabaseWorkerRpc(fake({ id: "j", worker_mode: "deep" })).claim("w", 300), /claimed a deep job in json mode/);
  await assert.rejects(supabaseWorkerRpc(fake({ id: "j", worker_mode: "json" }), { mode: "deep" }).claim("w", 300), /claimed a json job in deep mode/);
  const calls = [];
  const rec = { rpc: async (fn, args) => { calls.push([fn, args]); return { data: { id: null }, error: null }; } };
  await supabaseWorkerRpc(rec, { mode: "deep" }).claim("w", 300);
  await supabaseWorkerRpc(rec).claim("w", 300);
  assert.deepEqual(calls, [
    ["claim_permit_sync_job_v2", { p_worker_id: "w", p_lease_ttl_seconds: 300, p_worker_mode: "deep" }],
    ["claim_permit_sync_job", { p_worker_id: "w", p_lease_ttl_seconds: 300 }],
  ]);
});

test("control: the claim function as the deployed worker's migration defines it WOULD claim the deep job", async () => {
  const { h, oldClaim, requestDeep } = await setup();
  const id = await requestDeep({ only_portal_record_ids: ["11105"] });
  const src = fs.readFileSync(QUEUE_SQL, "utf8");
  const m = src.match(/CREATE OR REPLACE FUNCTION public\.claim_permit_sync_job\([\s\S]*?\n\$\$;/);
  assert.ok(m, "old claim function found in the queue migration");
  await h.db.exec(m[0]);
  const j = await oldClaim();
  assert.equal(j && j.id, id, "without the redefinition the old worker would take the deep job and run it as JSON");
});
