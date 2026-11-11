"use strict";

/**
 * Phase 5 offline end to end for the DC deep mode: the real migration chain (PGlite), worker core, DC adapter,
 * read-only guard, deep runner, capture RPCs and pipeline driver; the portal, the manual scraper's browser
 * work, the bucket and the agent function are offline stand-ins. Nothing real is called.
 *
 *   run 1: 28 permits, JSON + deep pass; the worker crashes while downloading a file; a new worker resumes
 *          without downloading a stored file again
 *   run 2: a project is linked to one permit; only that permit gets a deep pass, its portal_data is written
 *          (no insert, no credential re-point) and the agent pipeline runs once
 *   run 3: nothing changed: 0 downloads, 0 deep passes, 0 agent runs, 0 changes
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const { createDeepDb, pgliteDeepRepo, memoryStorage, fakeDcDeep, fakeDeepTransport } = require("./helpers/permit-sync-deep");
const { pgliteWorkerRpc } = require("./helpers/permit-sync-rpc");
const { createDcFixtureTransport } = require("./helpers/dc-fixture-transport");
const { createDcAdapter } = require("../permit-sync/adapters/dc-projectdox/adapter");
const { runOnce } = require("../permit-sync/core/worker");
const { createDeepPass } = require("../permit-sync/deep/runner");
const { createPipelineDriver } = require("../permit-sync/deep/pipeline");
const { LeaseLostError } = require("../permit-sync/core/errors");

const OWNER = "30000000-0000-4000-8000-000000000001";
const ADMIN = "30000000-0000-4000-8000-000000000002";
const CRED = "30000000-0000-4000-8000-0000000000c1";
const PROJECT = "30000000-0000-4000-8000-0000000000a1";

/** Minimal supabase-js query chain over PGlite for the pipeline dedupe read (select/eq/in/limit). */
function pgliteSupabase(h) {
  return {
    from(table) {
      const where = [];
      const params = [];
      let limit = null;
      const chain = {
        select: () => chain,
        eq: (c, v) => { params.push(v); where.push(`${c} = $${params.length}`); return chain; },
        in: (c, vs) => { params.push(vs); where.push(`${c} = ANY($${params.length})`); return chain; },
        limit: (n) => { limit = n; return chain; },
        then: (resolve, reject) => h.db
          .query(`SELECT * FROM ${table}${where.length ? ` WHERE ${where.join(" AND ")}` : ""}${limit ? ` LIMIT ${limit}` : ""}`, params)
          .then((r) => resolve({ data: r.rows, error: null }), reject),
      };
      return chain;
    },
  };
}

async function setup() {
  const h = await createDeepDb();
  for (const id of [OWNER, ADMIN]) await h.db.query(`INSERT INTO auth.users (id, email) VALUES ($1, $2)`, [id, `${id.slice(-1)}@test.invalid`]);
  await h.db.query(`INSERT INTO public.profiles (user_id) VALUES ($1), ($2) ON CONFLICT (user_id) DO NOTHING`, [OWNER, ADMIN]);
  await h.db.query(`INSERT INTO public.user_roles (user_id, role) VALUES ($1, 'admin')`, [ADMIN]);
  await h.db.query(`INSERT INTO public.portal_credentials (id, user_id, jurisdiction, portal_username, portal_password, permit_number) VALUES ($1, $2, 'Washington DC - ProjectDox', 'acct', '{"pc_v":"1","iv":"aXY=","at":"YXQ=","ct":"Y3Q="}', 'B2407514')`, [CRED, OWNER]);
  await h.db.transaction(async (tx) => {
    await tx.query(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [ADMIN]);
    await tx.exec(`SET LOCAL ROLE authenticated`);
    await tx.query(`SELECT admin_set_permit_sync_source($1, 'dc-projectdox', true, '{"account_download": true}'::jsonb)`, [CRED]);
  });
  await h.db.query(`INSERT INTO public.projects (id, user_id, name, permit_number) VALUES ($1, $2, 'Linked project', 'B2407514')`, [PROJECT, OWNER]);

  const rpc = pgliteWorkerRpc(h, { mode: "deep" });
  const repo = pgliteDeepRepo(h);
  const storage = memoryStorage();
  const fetchCalls = [];
  const fetch = async (url, init) => {
    fetchCalls.push({ url, headers: init.headers, body: JSON.parse(init.body) });
    const first = fetchCalls.length % 2 === 1;
    const body = first
      ? { next_action: "poll_again", pipeline_run_id: "run-1", comment_parser: { next_cursor: { pdfIndex: 1 }, done: false } }
      : { next_action: "complete", pipeline_run_id: "run-1" };
    return { ok: true, status: 200, text: async () => JSON.stringify(body) };
  };
  const pipeline = createPipelineDriver({
    fetch, supabaseUrl: "https://example.invalid", serviceRoleKey: "service-key-test", serviceSecret: "service-secret-test",
    supabase: pgliteSupabase(h), sleep: async () => {},
  });
  const enqueue = (options = {}) => h.db.transaction(async (tx) => {
    await tx.query(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [ADMIN]);
    await tx.exec(`SET LOCAL ROLE authenticated`);
    return (await tx.query(`SELECT admin_request_permit_deep_sync($1, $2::jsonb) AS id`, [CRED, JSON.stringify(options)])).rows[0].id;
  });
  const job = async () => (await h.db.query(`SELECT * FROM permit_sync_jobs ORDER BY created_at DESC LIMIT 1`)).rows[0];
  return { h, rpc, repo, storage, pipeline, fetchCalls, enqueue, job, PROJECT, OWNER, CRED };
}

function opener({ dcDeep, repo, storage, pipeline, env = {} }) {
  return async (job) => {
    const transport = fakeDeepTransport(createDcFixtureTransport());
    const deep = createDeepPass({ dcDeep, transport, repo, storage, pipeline, username: "acct", credentialId: job.credential_id, env });
    return { adapter: createDcAdapter({ transport: deep.wrapTransport(transport), accountDownload: true }), afterPermit: deep.afterPermit, close: async () => {} };
  };
}

test("deep mode end to end: crash-safe capture, linked-project sync with one agent run, then a no-op run", async () => {
  const s = await setup();
  const { h } = s;
  let crashed = false;
  const dcDeep = fakeDcDeep(h, {
    onDownload: async (f) => {
      if (f.id === "700102" && !crashed) {
        crashed = true;
        throw new LeaseLostError();
      }
    },
  });
  const open = opener({ dcDeep, ...s });

  // Run 1, attempt 1: crashes while downloading the second file of 11105.
  await s.enqueue();
  const a1 = await runOnce({ rpc: s.rpc, openAdapter: open, workerId: "w1" });
  assert.equal(a1.outcome, "lease_lost");
  assert.deepEqual(dcDeep.calls.downloads, ["700101", "700102"]);
  const permit11105 = (await h.db.query(`SELECT id FROM permits WHERE portal_record_id = '11105'`)).rows[0].id;
  assert.deepEqual(
    (await h.db.query(`SELECT portal_file_id, download_status FROM permit_documents WHERE permit_id = $1 ORDER BY 1`, [permit11105])).rows,
    [{ portal_file_id: "700101", download_status: "stored" }, { portal_file_id: "700102", download_status: "not_requested" }],
    "the file stored before the crash is already recorded",
  );

  // Run 1, attempt 2 (new worker after the lease expired): resumes; the stored file is not downloaded again.
  await h.db.query(`UPDATE permit_sync_jobs SET lease_expires_at = now() - interval '1 second'`);
  const a2 = await runOnce({ rpc: s.rpc, openAdapter: open, workerId: "w2" });
  assert.equal(a2.outcome, "completed", JSON.stringify(a2.metrics));
  assert.deepEqual(dcDeep.calls.downloads, ["700101", "700102", "700102"], "only the interrupted file is fetched again");
  assert.equal(await h.count("permit_documents", "download_status = 'stored'"), 2);
  assert.deepEqual([...s.storage.objects.keys()].filter((k) => k.includes("/files/")).sort(), [
    `${permit11105}/files/700101_A-101.pdf`, `${permit11105}/files/700102_A-101.pdf`,
  ]);
  assert.equal(await h.count("permit_reports", "content_status = 'captured'"), 28 * 5);
  assert.equal(await h.count("permit_report_contents"), 28 * 5, "one version per report");
  assert.ok((await h.db.query(`SELECT pdf_storage_path FROM permit_report_contents LIMIT 1`)).rows[0].pdf_storage_path.match(/^[0-9a-f-]{36}\/reports\/[^/]+\/[0-9a-f]{64}\.pdf$/));
  assert.equal(await h.count("permit_deep_state"), 28);
  assert.equal(dcDeep.calls.syncs.length, 0, "no linked project yet: no portal_data written");
  assert.equal(s.fetchCalls.length, 0);
  assert.equal(await h.count("projects"), 1, "no project created");

  // Run 2: link the project to 11105; only that permit gets a deep pass (all tabs), with no new downloads.
  await h.db.query(`INSERT INTO project_permits (project_id, permit_id) VALUES ($1, $2)`, [PROJECT, permit11105]);
  const scrapesBefore = dcDeep.calls.scrapes.length;
  const downloadsBefore = dcDeep.calls.downloads.length;
  await s.enqueue();
  const r2 = await runOnce({ rpc: s.rpc, openAdapter: open, workerId: "w1" });
  assert.equal(r2.outcome, "completed", JSON.stringify(r2.metrics));
  assert.deepEqual(dcDeep.calls.scrapes.slice(scrapesBefore), [{ permit: "B2407514", tabs: ["status", "files", "tasks", "info", "reports"] }]);
  assert.equal(dcDeep.calls.downloads.length, downloadsBefore, "stored files are not fetched again");
  assert.deepEqual(dcDeep.calls.syncs, [{ projectId: PROJECT, userId: OWNER }]);
  assert.equal(r2.metrics.deep.portal_syncs, 1);
  assert.equal(r2.metrics.deep.pipeline_runs, 1);
  assert.equal(r2.metrics.deep.reports_captured, 0, "same report content: no new version");
  const proj = (await h.db.query(`SELECT portal_data, portal_data_hash FROM projects WHERE id = $1`, [PROJECT])).rows[0];
  assert.equal(proj.portal_data.permitRepositorySync.permit_id, permit11105);
  const files = proj.portal_data.tabs.files.folders[0].files;
  assert.deepEqual(files.map((f) => [f.fileId, f.downloadStatus, f.storageRef && f.storageRef.path]), [
    ["700101", "stored", `${permit11105}/files/700101_A-101.pdf`],
    ["700102", "stored", `${permit11105}/files/700102_A-101.pdf`],
  ]);
  assert.equal(s.fetchCalls.length, 2, "one pipeline run: poll_again then complete");
  const [c1, c2] = s.fetchCalls;
  assert.equal(c1.url, "https://example.invalid/functions/v1/intake-pipeline-agent");
  assert.equal(c1.headers.Authorization, "Bearer service-key-test");
  assert.equal(c1.headers["x-permitpilot-service-secret"], "service-secret-test");
  assert.equal(c1.headers["x-permitpilot-acting-user"], OWNER);
  assert.deepEqual(c1.body, { project_id: PROJECT, is_shadow_mode: false, portal_data_hash: proj.portal_data_hash, full_refresh: true });
  assert.deepEqual(c2.body, { project_id: PROJECT, is_shadow_mode: false, portal_data_hash: proj.portal_data_hash, pipeline_run_id: "run-1", cursor: { pdfIndex: 1 } });
  assert.equal((await h.db.query(`SELECT count(*)::int AS n FROM portal_credentials WHERE id = $1`, [CRED])).rows[0].n, 1);

  // Run 3: nothing changed.
  const before = { scrapes: dcDeep.calls.scrapes.length, downloads: dcDeep.calls.downloads.length, exports: dcDeep.calls.reportExports, puts: s.storage.puts.length, fetches: s.fetchCalls.length, hash: proj.portal_data_hash };
  await s.enqueue();
  const r3 = await runOnce({ rpc: s.rpc, openAdapter: open, workerId: "w1" });
  assert.equal(r3.outcome, "completed");
  assert.equal(r3.metrics.changes, 0);
  assert.equal(r3.metrics.deep.deep_passes, 0);
  assert.equal(r3.metrics.deep.deep_skipped, 28);
  assert.equal(dcDeep.calls.scrapes.length, before.scrapes, "no deep pass");
  assert.equal(dcDeep.calls.downloads.length, before.downloads, "0 downloads");
  assert.equal(dcDeep.calls.reportExports, before.exports, "0 report exports");
  assert.equal(s.storage.puts.length, before.puts, "0 uploads");
  assert.equal(s.fetchCalls.length, before.fetches, "0 agent runs");
  assert.equal((await h.db.query(`SELECT portal_data_hash FROM projects WHERE id = $1`, [PROJECT])).rows[0].portal_data_hash, before.hash);

  // Run 4 (D-072): a deep pass is forced (deep state and the project's sync bookkeeping removed) and the manual
  // scraper returns the same permit content with new scrape times, signed URLs, temp paths and SSRS render times.
  await h.db.query(`DELETE FROM permit_deep_state WHERE permit_id = $1`, [permit11105]);
  await h.db.query(`UPDATE projects SET portal_data = portal_data - 'permitRepositorySync' WHERE id = $1`, [PROJECT]);
  const changesBefore = await h.count("permit_changes");
  const versionsBefore = await h.count("permit_report_contents");
  const b4 = { scrapes: dcDeep.calls.scrapes.length, downloads: dcDeep.calls.downloads.length, fetches: s.fetchCalls.length, syncs: dcDeep.calls.syncs.length };
  await s.enqueue();
  const r4 = await runOnce({ rpc: s.rpc, openAdapter: open, workerId: "w1" });
  assert.equal(r4.outcome, "completed", JSON.stringify(r4.metrics));
  assert.equal(r4.metrics.deep.deep_passes, 1, "the forced deep pass ran");
  assert.equal(dcDeep.calls.scrapes.length, b4.scrapes + 1);
  assert.equal(dcDeep.calls.syncs.length, b4.syncs + 1, "portal_data sync ran");
  assert.equal(dcDeep.calls.downloads.length, b4.downloads, "0 downloads");
  assert.equal(r4.metrics.deep.portal_changed, 0, "content unchanged: portal_data_hash kept");
  assert.equal(s.fetchCalls.length, b4.fetches, "0 agent runs");
  assert.equal(r4.metrics.deep.reports_captured, 0, "SSRS render time is not a new report version");
  assert.equal(await h.count("permit_report_contents"), versionsBefore);
  assert.equal(await h.count("permit_changes"), changesBefore, "0 permit_changes");
  const after4 = (await h.db.query(`SELECT portal_data, portal_data_hash FROM projects WHERE id = $1`, [PROJECT])).rows[0];
  assert.equal(after4.portal_data_hash, before.hash);
  assert.equal(after4.portal_data.permitRepositorySync.permit_id, permit11105, "bookkeeping restored, so the next run skips the deep pass");

  // Run 5: back to the steady state.
  const r5 = await (async () => { await s.enqueue(); return runOnce({ rpc: s.rpc, openAdapter: open, workerId: "w1" }); })();
  assert.equal(r5.metrics.deep.deep_passes, 0);
  assert.equal(s.fetchCalls.length, b4.fetches);
});

test("deep-pass state is service-role only; a pipeline run already recorded for the hash (browser trigger) is not started again", async () => {
  const s = await setup();
  const asUser = (sql) => s.h.db.transaction(async (tx) => {
    await tx.query(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [OWNER]);
    await tx.exec(`SET LOCAL ROLE authenticated`);
    return tx.query(sql);
  });
  await assert.rejects(asUser(`SELECT * FROM permit_deep_state`), /permission denied/);
  await assert.rejects(asUser(`SELECT public.record_permit_deep_pass('${PROJECT}', '{}'::jsonb)`), /permission denied/);

  const hash = "f".repeat(64);
  await s.h.db.query(`INSERT INTO project_pipeline_runs (project_id, idempotency_key, status) VALUES ($1, $2, 'running')`, [PROJECT, `hash:${hash}`]);
  const out = await s.pipeline.trigger({ projectId: PROJECT, ownerUserId: OWNER, portalDataHash: hash });
  assert.equal(out.outcome, "skipped_duplicate");
  assert.equal(s.fetchCalls.length, 0);
});

test("one-permit scope (D-074): discovery lists all 28, only the scoped permit gets a JSON and deep pass", async () => {
  const s = await setup();
  const { h } = s;
  const dcDeep = fakeDcDeep(h);
  const open = opener({ dcDeep, ...s });
  await s.enqueue({ only_portal_record_ids: ["11105"] });
  const r = await runOnce({ rpc: s.rpc, openAdapter: open, workerId: "w1" });
  assert.equal(r.outcome, "completed", JSON.stringify(r.metrics));
  assert.equal(r.metrics.discovered, 28);
  assert.equal(r.metrics.permits_ok, 1);
  assert.equal(r.metrics.permits_out_of_scope, 27);
  assert.deepEqual(r.metrics.scope, ["11105"]);
  assert.deepEqual(dcDeep.calls.scrapes.map((c) => c.permit), ["B2407514"], "one deep pass");
  assert.deepEqual(dcDeep.calls.downloads, ["700101", "700102"]);
  assert.equal(await h.count("permit_deep_state"), 1);
  assert.equal(await h.count("permit_reports", "content_status = 'captured'"), 5, "reports of the scoped permit only");

  await s.enqueue({ only_portal_record_ids: ["99999"] });
  const nf = await runOnce({ rpc: s.rpc, openAdapter: open, workerId: "w1" });
  assert.equal(nf.outcome, "failed_unrecoverable");
  assert.equal(nf.code, "scope_not_found");
  assert.equal(dcDeep.calls.scrapes.length, 1, "no deep pass when the scoped permit is missing");

  await s.enqueue({ only_portal_record_ids: ["11105"] });
  let opened = 0;
  const empty = await runOnce({ rpc: s.rpc, openAdapter: async (j) => { opened += 1; return open(j); }, workerId: "w1", scope: ["9187"] });
  assert.equal(empty.code, "scope_empty", "job scope and worker filter do not overlap");
  assert.equal(opened, 0, "the portal is not opened");
});

test("download caps (D-074): env cap stops downloads, capped files stay pending for a later job, job options only lower it", async () => {
  const s = await setup();
  const { h } = s;
  const dcDeep = fakeDcDeep(h);
  await s.enqueue({ only_portal_record_ids: ["11105"], max_files: 5 });
  const r1 = await runOnce({ rpc: s.rpc, openAdapter: opener({ dcDeep, ...s, env: { PERMIT_SYNC_DEEP_MAX_FILES: "1" } }), workerId: "w1" });
  assert.equal(r1.outcome, "completed", JSON.stringify(r1.metrics));
  assert.deepEqual(dcDeep.calls.downloads, ["700101"], "the job option (5) cannot raise the env cap (1)");
  assert.equal(r1.metrics.deep.files_capped, 1);
  assert.ok(r1.metrics.deep.bytes_downloaded > 0);
  assert.deepEqual((await h.db.query(`SELECT portal_file_id, download_status FROM permit_documents ORDER BY 1`)).rows,
    [{ portal_file_id: "700101", download_status: "stored" }, { portal_file_id: "700102", download_status: "not_requested" }]);

  await s.enqueue({ only_portal_record_ids: ["11105"] });
  const r2 = await runOnce({ rpc: s.rpc, openAdapter: opener({ dcDeep, ...s, env: { PERMIT_SYNC_DEEP_MAX_FILES: "0" } }), workerId: "w1" });
  assert.equal(r2.outcome, "completed", JSON.stringify(r2.metrics));
  assert.deepEqual(dcDeep.calls.downloads, ["700101"], "a zero cap downloads nothing");
  assert.equal(r2.metrics.deep.files_capped, 1);

  await s.enqueue({ only_portal_record_ids: ["11105"] });
  const r3 = await runOnce({ rpc: s.rpc, openAdapter: opener({ dcDeep, ...s }), workerId: "w1" });
  assert.equal(r3.outcome, "completed");
  assert.deepEqual(dcDeep.calls.downloads, ["700101", "700102"], "the capped file is picked up by a later job, the stored one is not fetched again");
  assert.equal(await h.count("permit_documents", "download_status = 'stored'"), 2);
});

test("reports tab unavailable (D-074): reports marked failed, job completes, no retry while report inputs are unchanged", async () => {
  const s = await setup();
  const { h } = s;
  const failing = fakeDcDeep(h, { reportsError: "SSRS export needs a postback (POST dropped by the read guard)" });
  await s.enqueue({ only_portal_record_ids: ["11105"] });
  const r1 = await runOnce({ rpc: s.rpc, openAdapter: opener({ dcDeep: failing, ...s }), workerId: "w1" });
  assert.equal(r1.outcome, "completed", JSON.stringify(r1.metrics));
  assert.equal(r1.metrics.deep.reports_failed, 5);
  assert.equal(r1.metrics.deep.deep_passes, 1);
  assert.deepEqual(failing.calls.downloads, ["700101", "700102"], "files are still captured");
  assert.equal(await h.count("permit_reports", "content_status = 'failed'"), 5);
  assert.equal(await h.count("permit_report_contents"), 0);
  assert.equal(await h.count("permit_sync_events", "code = 'reports_unavailable'"), 1);
  assert.equal(await h.count("permit_deep_state"), 1, "the pass is recorded, so it is not repeated");

  await s.enqueue({ only_portal_record_ids: ["11105"] });
  const r2 = await runOnce({ rpc: s.rpc, openAdapter: opener({ dcDeep: failing, ...s }), workerId: "w1" });
  assert.equal(r2.outcome, "completed");
  assert.equal(r2.metrics.deep.deep_passes, 0, "failed reports are not retried every job");
  assert.equal(failing.calls.scrapes.length, 1);
});
