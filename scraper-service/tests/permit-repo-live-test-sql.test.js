"use strict";

/**
 * The prepared production SQL for the one-permit live test (scripts/permit-repo/one-permit-live-test), run on
 * the replayed migration chain with the production ids: link, deep request, cancel, unlink, watch, inspect.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { createDeepDb } = require("./helpers/permit-sync-deep");
const { pgliteWorkerRpc } = require("./helpers/permit-sync-rpc");

const DIR = path.join(__dirname, "..", "..", "scripts", "permit-repo", "one-permit-live-test");
const sql = (f) => fs.readFileSync(path.join(DIR, f), "utf8");
const ADMIN = "3d2b4632-e3a3-4417-8a84-549cedbb6739";
const OWNER = "f1f84c83-36f6-4664-b34b-614b2881f09d";
const CRED = "de8592f9-69fc-4c71-8544-cb22bbbd5813";
const PERMIT = "06fa082e-b942-4b54-b448-a1527f58df41";
const PROJECT = "ff193644-3e94-46d4-a1c0-4755fc65d0dd";

async function setup() {
  const h = await createDeepDb();
  for (const id of [ADMIN, OWNER]) await h.db.query(`INSERT INTO auth.users (id, email) VALUES ($1, $2)`, [id, `${id.slice(0, 4)}@test.invalid`]);
  await h.db.query(`INSERT INTO public.profiles (user_id) VALUES ($1), ($2) ON CONFLICT (user_id) DO NOTHING`, [ADMIN, OWNER]);
  await h.db.query(`INSERT INTO public.user_roles (user_id, role) VALUES ($1, 'admin')`, [ADMIN]);
  await h.db.query(`INSERT INTO public.portal_credentials (id, user_id, jurisdiction, portal_username, portal_password, permit_number) VALUES ($1, $2, 'Washington DC - ProjectDox', 'acct', '{"pc_v":"1","iv":"aXY=","at":"YXQ=","ct":"Y3Q="}', 'BCIV2500152')`, [CRED, OWNER]);
  await h.db.query(`INSERT INTO public.permit_sync_sources (credential_id, adapter_key, settings) VALUES ($1, 'dc-projectdox', '{"account_download": false}')`, [CRED]);
  await h.db.query(`INSERT INTO public.permits (id, adapter_key, portal_record_id, permit_number) VALUES ($1, 'dc-projectdox', '6364', 'BCIV2500152')`, [PERMIT]);
  await h.db.query(`INSERT INTO public.permit_source_links (permit_id, credential_id) VALUES ($1, $2)`, [PERMIT, CRED]);
  await h.db.query(`INSERT INTO public.projects (id, user_id, name, permit_number) VALUES ($1, $2, 'BCIV2500152', 'BCIV2500152')`, [PROJECT, OWNER]);
  return h;
}

test("live-test SQL: link, deep request (scoped, capped), cancel and unlink work as the admin; inspect/watch read", async () => {
  const h = await setup();
  const projects = await h.count("projects");

  await h.db.exec(sql("01-link-project.sql"));
  assert.equal(await h.count("project_permits", "project_id = $1 AND permit_id = $2 AND linked_by = $3", [PROJECT, PERMIT, ADMIN]), 1);
  await h.db.exec(sql("01-link-project.sql"));
  assert.equal(await h.count("project_permits"), 1, "re-running the link is a no-op");
  assert.equal(await h.count("projects"), projects, "linking never creates a project");
  assert.equal(await h.count("platform_audit_events", "action = 'permit.link_project'"), 2);

  await h.db.exec(sql("02-request-deep-job.sql"));
  const job = (await h.db.query(`SELECT * FROM permit_sync_jobs WHERE credential_id = $1`, [CRED])).rows[0];
  assert.equal(job.worker_mode, "deep");
  assert.deepEqual(job.options, { only_portal_record_ids: ["6364"], max_files: 3, max_bytes: 20971520 });
  assert.equal(job.requested_by, ADMIN);
  assert.equal(await h.svc(`SELECT (claim_permit_sync_job('railway-old', 300)).id`), null, "the deployed JSON worker cannot take it");
  await assert.rejects(h.db.exec(sql("02-request-deep-job.sql")), /already has an active job/);
  await h.db.exec("ROLLBACK");

  const watch = (await h.db.query(sql("03-watch.sql"))).rows[0].watch;
  assert.equal(watch.job.id, job.id);
  assert.deepEqual(watch.events.map((e) => e.code), ["enqueued"]);
  const inspect = (await h.db.query(sql("04-inspect.sql"))).rows[0].inspect;
  assert.equal(inspect.projects_with_permit_number, 1);
  assert.equal(inspect.guard_events, null);
  assert.deepEqual(inspect.deep_jobs.map((j) => [j.job, j.status]), [[job.id, "queued"]]);

  // D-079: guard refusals show in 04-inspect: pre-check denials as events, job-ending violations as last_error.
  await h.db.query(
    `INSERT INTO permit_sync_events (job_id, level, code, message, data) VALUES ($1, 'warn', 'guard_denied', 'GET session.planreview.dob.dc.gov/WebForms/ReportViewer.aspx', $2::jsonb)`,
    [job.id, JSON.stringify({ method: "GET", host: "session.planreview.dob.dc.gov", path: "/WebForms/ReportViewer.aspx", rule: "deny_pattern", report_key: "4" })],
  );
  await h.db.query(`UPDATE permit_sync_jobs SET error_code = 'safety_violation', last_error = 'portal request refused (deny_pattern: GET https://x.invalid/a)' WHERE id = $1`, [job.id]);
  const inspect2 = (await h.db.query(sql("04-inspect.sql"))).rows[0].inspect;
  assert.deepEqual(inspect2.guard_events.map((e) => [e.code, e.method, e.host, e.path, e.report_key]),
    [["guard_denied", "GET", "session.planreview.dob.dc.gov", "/WebForms/ReportViewer.aspx", "4"]]);
  assert.equal(inspect2.deep_jobs[0].error_code, "safety_violation");
  assert.match(inspect2.deep_jobs[0].last_error, /^portal request refused/);

  // 5c: the capture section shows stored originals / renditions, viewer-eligible files and every open item with attempts.
  const doc = (id, permitted, status, extra = "") => h.db.query(
    `INSERT INTO permit_documents (permit_id, portal_file_id, file_name, download_permitted, download_status, size_bytes${extra ? ", " + extra.split("=")[0] : ""})
     VALUES ($1, $2, $2 || '.pdf', $3, $4, 1000${extra ? ", " + extra.split("=")[1] : ""})`, [PERMIT, id, permitted, status]);
  await doc("f1", true, "not_requested");
  await doc("f2", false, "not_permitted");
  await doc("f3", false, "deferred_oversize");
  await doc("f4", true, "failed", "capture_attempts=2");
  await h.db.query(`UPDATE permit_documents SET download_status = 'stored', storage_path = $1 || '/files/f5.pdf', sha256 = 'abc', stored_size_bytes = 1000,
                      capture_access_path = 'download', capture_is_rendition = false, size_matches_portal = true, capture_source_endpoint = 'retrieve_file_original'
                    WHERE portal_file_id = 'f1'`, [PERMIT]);
  const cap = (await h.db.query(sql("04-inspect.sql"))).rows[0].inspect.capture;
  assert.deepEqual(cap.by_status_and_path, { "stored/download": 1, "not_permitted/viewer": 1, "deferred_oversize/viewer": 1, "failed/download": 1 });
  assert.equal(cap.viewer_eligible, 2);
  assert.equal(cap.stored_original, 1);
  assert.equal(cap.stored_rendition, 0);
  assert.deepEqual(cap.size_matches_portal, { true: 1 });
  assert.deepEqual(cap.open.map((o) => [o.file_id, o.status, o.attempts]).sort(), [["f2", "not_permitted", 0], ["f3", "deferred_oversize", 0], ["f4", "failed", 2]]);

  await h.db.exec(sql("02-cancel-deep-job.sql"));
  assert.equal((await h.db.query(`SELECT status FROM permit_sync_jobs WHERE id = $1`, [job.id])).rows[0].status, "cancelled");
  assert.equal(await pgliteWorkerRpc(h, { mode: "deep" }).claim("local", 300), null, "a cancelled job is not claimed");

  await h.db.exec(sql("01-unlink-project-rollback.sql"));
  assert.equal(await h.count("project_permits"), 0);
  assert.equal(await h.count("platform_audit_events", "action = 'permit.unlink_project'"), 1);
});

test("full-capture live-test SQL: pre-check reads the capture schema; the full job request uses real caps", async () => {
  const h = await setup();
  // Stand-ins where the replay has no production schema (migration history; cron/storage come from the replay helper).
  const exists = async (rel) => (await h.db.query(`SELECT to_regclass($1) IS NOT NULL AS ok`, [rel])).rows[0].ok;
  if (!(await exists("supabase_migrations.schema_migrations"))) {
    await h.db.exec(`CREATE SCHEMA IF NOT EXISTS supabase_migrations; CREATE TABLE supabase_migrations.schema_migrations (version text PRIMARY KEY);`);
  }
  await h.db.exec(`INSERT INTO supabase_migrations.schema_migrations (version) VALUES ('20261111120000'), ('20261112100000') ON CONFLICT DO NOTHING;`);
  assert.ok(await exists("cron.job"));
  assert.ok(await exists("storage.objects"));
  await h.db.exec(sql("01-link-project.sql"));
  const rows = (await h.db.query(sql("10-precheck-capture-retry.sql"))).rows;
  const by = Object.fromEntries(rows.map((r) => [r.check_name, r]));
  for (const n of [
    "capture retry migration recorded", "permit_documents capture columns present", "record_permit_document_capture_v2 present, service_role only",
    "download_status accepts deferred_oversize", "two-argument claim returns json jobs only (old Railway worker cannot take a deep job)",
    "no active permit sync job", "no source automated anywhere", "project ff193644 linked to permit 06fa082e",
    "permit-documents bucket: private, file_size_limit (null = global limit)",
  ]) assert.equal(by[n] && by[n].ok, true, n);
  assert.equal(rows.length, 16);

  await h.db.exec(sql("12-request-full-deep-job.sql"));
  const job = (await h.db.query(`SELECT * FROM permit_sync_jobs WHERE credential_id = $1`, [CRED])).rows[0];
  assert.equal(job.worker_mode, "deep");
  assert.deepEqual(job.options, { only_portal_record_ids: ["6364"], max_files: 72, max_bytes: 629145600 });
  assert.equal(await h.svc(`SELECT (claim_permit_sync_job('railway-old', 300)).id`), null, "the deployed JSON worker cannot take it");
  await h.db.exec(sql("02-cancel-deep-job.sql"));
  // The 50 MB fallback variant is accepted by the option validation.
  await h.db.exec(sql("12-request-full-deep-job.sql").replace('"max_bytes": 629145600}', '"max_bytes": 629145600, "max_file_bytes": 52428800}'));
  assert.equal((await h.db.query(`SELECT options ->> 'max_file_bytes' AS m FROM permit_sync_jobs WHERE status = 'queued'`)).rows[0].m, "52428800");
});
