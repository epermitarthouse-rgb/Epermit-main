"use strict";

/**
 * Backward-compatibility test: replays the real supabase/migrations chain on PGlite, then
 *  1. fingerprints every pre-existing table, column, policy, trigger, function and privilege before
 *     and after 20261111100000_central_permit_repository.sql and requires them to be identical;
 *  2. runs the core access checks against the real credential_has_grant / portal_credentials /
 *     profiles definitions and Supabase default privileges (not the hand-written stubs).
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const { replay, MIGRATIONS_DIR } = require("./helpers/replay-migrations");
const fx = require("./helpers/permit-repo-fixtures");

const NEW_MIGRATION = "20261111100000_central_permit_repository.sql";
const NEW_MIGRATIONS = [NEW_MIGRATION, "20261111100100_permit_sync_queue.sql", "20261111100200_central_permits_ui.sql", "20261111120000_permit_deep_capture.sql", "20261112100000_permit_capture_retry.sql"];
const NEW_TABLE = /^(permits$|permit_(?!filings)|project_permits$)/;
const NEW_FUNC = new RegExp([
  "^_?permit_", "^user_can_read_permit$", "^can_read_permit$", "^apply_permit_", "^record_permit_document_(download|capture|capture_v2)$", "^record_permit_report_(content|failure)$", "^record_permit_deep_pass$",
  "^admin_(grant|revoke)_permit_access$", "^admin_(link|unlink)_project_permit$", "^admin_set_permit_sync_source$",
  "^enqueue_permit_sync_runs$", "^admin_request_permit_(deep_)?sync$", "^claim_permit_sync_job_v2$", "^admin_cancel_permit_sync_job$", "^admin_resume_permit_sync_source$",
  "^(claim|heartbeat|finish)_permit_sync_job$", "^log_permit_sync_event$", "^search_permits$",
].join("|"));

const FINGERPRINT = `
SELECT 'col' AS kind, table_schema || '.' || table_name AS obj,
       column_name || ':' || data_type || ':' || is_nullable || ':' || coalesce(column_default, '') AS detail
FROM information_schema.columns WHERE table_schema IN ('public', 'storage', 'auth')
UNION ALL
SELECT 'policy', schemaname || '.' || tablename, policyname || ':' || cmd || ':' || array_to_string(roles, ',') || ':' || coalesce(qual, '') || ':' || coalesce(with_check, '')
FROM pg_policies
UNION ALL
SELECT 'trigger', c.relname, t.tgname || ':' || pg_get_triggerdef(t.oid)
FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid WHERE NOT t.tgisinternal
UNION ALL
SELECT 'func', n.nspname || '.' || p.proname, pg_get_function_identity_arguments(p.oid) || ':' || md5(p.prosrc) || ':' || p.prosecdef || ':' || coalesce(p.proacl::text, '')
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname IN ('public', 'storage', 'auth')
UNION ALL
SELECT 'acl', n.nspname || '.' || c.relname, coalesce(c.relacl::text, '') || ':' || c.relrowsecurity
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname IN ('public', 'storage') AND c.relkind IN ('r', 'v', 'm')
UNION ALL
SELECT 'bucket', id, coalesce(public::text, '') FROM storage.buckets
`;

function isNew(row) {
  const name = row.obj.split(".").pop();
  if (row.kind === "func") return NEW_FUNC.test(name);
  if (row.kind === "bucket") return row.obj === "permit-documents";
  if (row.kind === "policy" && row.obj === "storage.objects") return row.detail.startsWith("Permit documents");
  return NEW_TABLE.test(name);
}

const key = (r) => `${r.kind}|${r.obj}|${r.detail}`;

let full;

test.before(async () => {
  full = await replay();
});

test("new migration leaves every pre-existing object unchanged", async () => {
  // Unrelated migrations may sort between the permit migrations, so compare the same chain with and without them.
  const before = await replay({ exclude: NEW_MIGRATIONS });
  const a = (await before.db.query(FINGERPRINT)).rows;
  const b = (await full.db.query(FINGERPRINT)).rows;
  assert.deepEqual(NEW_MIGRATIONS.filter((f) => !full.applied.includes(f)), [], "every permit migration is applied in the full chain");

  const afterKeys = new Set(b.map(key));
  const missingOrChanged = a.filter((r) => !afterKeys.has(key(r)));
  assert.deepEqual(missingOrChanged, [], "pre-existing objects removed or modified");

  const beforeKeys = new Set(a.map(key));
  const added = b.filter((r) => !beforeKeys.has(key(r)));
  const unexpected = added.filter((r) => !isNew(r));
  assert.deepEqual(unexpected, [], "only permit repository objects are added");
  assert.ok(added.length > 100);

  const permitFilings = a.filter((r) => r.obj === "public.permit_filings");
  assert.ok(permitFilings.length > 0, "existing permit_filings table is present and untouched");

  const flags = async (db) => (await db.query(`SELECT key, enabled, label FROM public.feature_flags ORDER BY key`)).rows;
  const flagsBefore = await flags(before.db);
  const flagsAfter = await flags(full.db);
  assert.deepEqual(flagsAfter.filter((f) => f.key !== "module.central_permits"), flagsBefore, "existing feature flags unchanged");
  assert.deepEqual(flagsAfter.find((f) => f.key === "module.central_permits"), { key: "module.central_permits", enabled: false, label: "Permit Repository" });
});

test("re-applying the new migrations on the real chain is a no-op for the schema", async () => {
  const a = (await full.db.query(FINGERPRINT)).rows.map(key).sort();
  for (const f of NEW_MIGRATIONS) await full.db.exec(fs.readFileSync(`${MIGRATIONS_DIR}/${f}`, "utf8"));
  const b = (await full.db.query(FINGERPRINT)).rows.map(key).sort();
  assert.deepEqual(b, a);
});

test("capture retry apply (BEGIN/COMMIT-wrapped, as in production) and its rollback script restore the schema exactly", async () => {
  const RETRY = "20261112100000_permit_capture_retry.sql";
  const base = await replay({ exclude: [RETRY] });
  const before = (await base.db.query(FINGERPRINT)).rows.map(key).sort();
  const expected = (await full.db.query(FINGERPRINT)).rows.map(key).sort();

  await base.db.exec(`BEGIN;\n${fs.readFileSync(`${MIGRATIONS_DIR}/${RETRY}`, "utf8")}\nCOMMIT;`);
  assert.deepEqual((await base.db.query(FINGERPRINT)).rows.map(key).sort(), expected, "wrapped apply equals the chain replay");

  const rollback = fs.readFileSync(`${MIGRATIONS_DIR}/../../scripts/permit-repo/rollback-20261112100000_permit_capture_retry.sql`, "utf8");
  const cred = "10000000-0000-4000-8000-0000000000e1";
  await base.db.query(`INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES ('10000000-0000-4000-8000-0000000000e2', 'e@test.invalid', '{}'::jsonb)`);
  await base.db.query(`INSERT INTO public.portal_credentials (id, user_id, jurisdiction, portal_username, portal_password, permit_number) VALUES ($1, '10000000-0000-4000-8000-0000000000e2', 'Washington DC', 'acct', '{"pc_v":"1","iv":"aXY=","at":"YXQ=","ct":"Y3Q="}', 'E1')`, [cred]);
  await base.db.query(`INSERT INTO public.permit_sync_sources (credential_id, adapter_key) VALUES ($1, 'dc-projectdox')`, [cred]);
  await base.db.query(`INSERT INTO public.permit_sync_jobs (credential_id, adapter_key, trigger, worker_mode) VALUES ($1, 'dc-projectdox', 'manual', 'deep')`, [cred]);
  await assert.rejects(base.db.exec(rollback), /cancel the active deep job first/);
  await base.db.exec("ROLLBACK");
  await base.db.query(`UPDATE public.permit_sync_jobs SET status = 'cancelled', completed_at = now()`);
  await base.db.exec(rollback);
  assert.deepEqual((await base.db.query(FINGERPRINT)).rows.map(key).sort(), before, "rollback restores the pre-migration schema");
});

test("deep capture apply (BEGIN/COMMIT-wrapped, as in production) and its rollback script restore the schema exactly", async () => {
  const DEEP = "20261111120000_permit_deep_capture.sql";
  // The capture-retry migration builds on deep capture, so this checks deep capture on the chain before it.
  const base = await replay({ exclude: [DEEP, "20261112100000_permit_capture_retry.sql"] });
  const before = (await base.db.query(FINGERPRINT)).rows.map(key).sort();
  const expected = (await (await replay({ exclude: ["20261112100000_permit_capture_retry.sql"] })).db.query(FINGERPRINT)).rows.map(key).sort();

  await base.db.exec(`BEGIN;\n${fs.readFileSync(`${MIGRATIONS_DIR}/${DEEP}`, "utf8")}\nCOMMIT;`);
  assert.deepEqual((await base.db.query(FINGERPRINT)).rows.map(key).sort(), expected, "wrapped apply equals the chain replay");

  const rollback = fs.readFileSync(`${MIGRATIONS_DIR}/../../scripts/permit-repo/rollback-20261111120000_permit_deep_capture.sql`, "utf8");
  const cred = "10000000-0000-4000-8000-0000000000d1";
  await base.db.query(`INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES ('10000000-0000-4000-8000-0000000000d2', 'd@test.invalid', '{}'::jsonb)`);
  await base.db.query(`INSERT INTO public.portal_credentials (id, user_id, jurisdiction, portal_username, portal_password, permit_number) VALUES ($1, '10000000-0000-4000-8000-0000000000d2', 'Washington DC', 'acct', '{"pc_v":"1","iv":"aXY=","at":"YXQ=","ct":"Y3Q="}', 'D1')`, [cred]);
  await base.db.query(`INSERT INTO public.permit_sync_sources (credential_id, adapter_key) VALUES ($1, 'dc-projectdox')`, [cred]);
  await base.db.query(`INSERT INTO public.permit_sync_jobs (credential_id, adapter_key, trigger, worker_mode) VALUES ($1, 'dc-projectdox', 'manual', 'deep')`, [cred]);
  await assert.rejects(base.db.exec(rollback), /cancel the active deep job first/);
  await base.db.exec("ROLLBACK");
  await base.db.query(`UPDATE public.permit_sync_jobs SET status = 'cancelled', completed_at = now()`);
  await base.db.exec(rollback);
  assert.deepEqual((await base.db.query(FINGERPRINT)).rows.map(key).sort(), before, "rollback restores the pre-migration schema");
});

test("access rules hold against the real credential, profile and default-privilege definitions", async () => {
  const db = full.db;
  const ids = {
    owner: "10000000-0000-4000-8000-000000000001",
    credUse: "10000000-0000-4000-8000-000000000002",
    unrelated: "10000000-0000-4000-8000-000000000003",
    admin: "10000000-0000-4000-8000-000000000004",
  };
  const cred = "10000000-0000-4000-8000-0000000000c1";
  for (const [label, id] of Object.entries(ids)) {
    await db.query(`INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES ($1, $2, '{}'::jsonb)`, [id, `${label}@test.invalid`]);
  }
  await db.query(`INSERT INTO public.profiles (user_id) VALUES ($1), ($2), ($3), ($4) ON CONFLICT (user_id) DO NOTHING`, Object.values(ids));
  const active = (await db.query(`SELECT count(*)::int AS n FROM public.profiles WHERE access_status = 'active'`)).rows[0].n;
  assert.equal(active, 4, "real profiles default to active");
  await db.query(`INSERT INTO public.user_roles (user_id, role) VALUES ($1, 'admin')`, [ids.admin]);
  await db.query(`INSERT INTO public.portal_credentials (id, user_id, jurisdiction, portal_username, portal_password, permit_number) VALUES ($1, $2, 'Washington DC', 'acct', '{"pc_v":"1","iv":"aXY=","at":"YXQ=","ct":"Y3Q="}', 'D2500488')`, [cred, ids.owner]);
  await db.query(`INSERT INTO public.user_portal_credential_grants (user_id, credential_id, grant_level) VALUES ($1, $2, 'use')`, [ids.credUse, cred]);

  const rpc = (name, arg) => db.transaction(async (tx) => {
    await tx.exec(`SET LOCAL ROLE service_role`);
    return (await tx.query(`SELECT public.${name}($1::jsonb) AS out`, [JSON.stringify(arg)])).rows[0].out;
  });
  const d = await rpc("apply_permit_discovery", fx.discovery({ credentialId: cred }));
  assert.equal(d.created, 28);
  await rpc("apply_permit_sync_batch", fx.resubmitBatch({ credentialId: cred }));
  const again = await rpc("apply_permit_sync_batch", fx.resubmitBatch({ credentialId: cred }));
  assert.equal(again.changes, 0);

  const asRole = (role, sub, sql) => db.transaction(async (tx) => {
    await tx.query(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [sub || ""]);
    await tx.exec(`SET LOCAL ROLE ${role}`);
    return (await tx.query(sql)).rows;
  });
  const n = async (sub, table) => (await asRole("authenticated", sub, `SELECT count(*)::int AS n FROM public.${table}`))[0].n;

  assert.equal(await n(ids.credUse, "permits"), 28);
  assert.equal(await n(ids.credUse, "permit_review_comments"), 3);
  assert.equal(await n(ids.admin, "permits"), 28);
  assert.equal(await n(ids.unrelated, "permits"), 0);
  assert.equal(await n(ids.unrelated, "permit_snapshots"), 0);
  assert.equal(await n(ids.owner, "permits"), 0, "credential owner without a grant row has no implicit access");

  await assert.rejects(asRole("anon", null, `SELECT 1 FROM public.permits`), /permission denied/, "Supabase default anon privileges are revoked");
  await assert.rejects(asRole("authenticated", ids.credUse, `UPDATE public.permits SET status = 'x'`), /permission denied/);
  await assert.rejects(asRole("authenticated", ids.credUse, `SELECT public.apply_permit_sync_batch('{}'::jsonb)`), /permission denied/);
  await assert.rejects(asRole("authenticated", ids.credUse, `SELECT public.admin_grant_permit_access('adapter', 'dc-projectdox', '${ids.unrelated}', NULL, NULL)`), /Not authorized/);
});
