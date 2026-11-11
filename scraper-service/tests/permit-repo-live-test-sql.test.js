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

  await h.db.exec(sql("02-cancel-deep-job.sql"));
  assert.equal((await h.db.query(`SELECT status FROM permit_sync_jobs WHERE id = $1`, [job.id])).rows[0].status, "cancelled");
  assert.equal(await pgliteWorkerRpc(h, { mode: "deep" }).claim("local", 300), null, "a cancelled job is not claimed");

  await h.db.exec(sql("01-unlink-project-rollback.sql"));
  assert.equal(await h.count("project_permits"), 0);
  assert.equal(await h.count("platform_audit_events", "action = 'permit.unlink_project'"), 1);
});
