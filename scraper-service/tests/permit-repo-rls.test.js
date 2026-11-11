"use strict";

/**
 * Access-control matrix for the central permit repository, run as the real `authenticated` / `anon`
 * roles with RLS enforced (PGlite / Postgres 16). Covers every read path in user_can_read_permit,
 * storage objects, write denial, service-only RPCs and Management Admin RPCs.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const { createPermitRepoDb } = require("./helpers/permit-repo-db");
const fx = require("./helpers/permit-repo-fixtures");

const U = {
  owner: "00000000-0000-4000-8000-000000000001",
  admin: "00000000-0000-4000-8000-000000000002",
  superAdmin: "00000000-0000-4000-8000-000000000003",
  credUse: "00000000-0000-4000-8000-000000000004",
  credNone: "00000000-0000-4000-8000-000000000005",
  inactive: "00000000-0000-4000-8000-000000000006",
  permitGrantee: "00000000-0000-4000-8000-000000000007",
  adapterGrantee: "00000000-0000-4000-8000-000000000008",
  tenantMember: "00000000-0000-4000-8000-000000000009",
  projectMember: "00000000-0000-4000-8000-00000000000a",
  revoked: "00000000-0000-4000-8000-00000000000b",
  unrelated: "00000000-0000-4000-8000-00000000000c",
};
const CRED = "00000000-0000-4000-8000-0000000000c1";
const CRED2 = "00000000-0000-4000-8000-0000000000c2";
const PLAIN_CRED = "00000000-0000-4000-8000-0000000000c3";
const TENANT = "00000000-0000-4000-8000-0000000000e1";
const PROJECT = "00000000-0000-4000-8000-0000000000f1";

const TABLES = [
  "permits", "permit_source_links", "permit_section_state", "permit_review_comments", "permit_review_responses",
  "permit_tasks", "permit_document_folders", "permit_documents", "permit_snapshots", "permit_changes", "project_permits",
];

let h;
let P; // permit ids by portal id
let storedObject;

async function adminCall(sql, params) {
  return h.asUser(U.admin, (tx) => tx.query(sql, params));
}

test.before(async () => {
  h = await createPermitRepoDb();
  for (const id of Object.values(U)) await h.createUser(id);
  await h.db.query(`UPDATE profiles SET access_status = 'suspended' WHERE user_id = $1`, [U.inactive]);
  await h.db.query(`INSERT INTO user_roles (user_id, role) VALUES ($1, 'admin'), ($2, 'super_admin')`, [U.admin, U.superAdmin]);
  await h.createCredential(CRED, U.owner);
  await h.createCredential(CRED2, U.owner);
  await h.createCredential(PLAIN_CRED, U.owner, "plaintext-password");
  await h.grantCredential(U.credUse, CRED, "use");
  await h.grantCredential(U.credNone, CRED, "none");
  await h.grantCredential(U.inactive, CRED, "use");
  await h.db.query(`INSERT INTO tenants (id, name, slug) VALUES ($1, 'Tenant', 'tenant')`, [TENANT]);
  await h.db.query(`INSERT INTO tenant_memberships (tenant_id, user_id) VALUES ($1, $2)`, [TENANT, U.tenantMember]);
  await h.db.query(`INSERT INTO projects (id, user_id, name) VALUES ($1, $2, 'Project')`, [PROJECT, U.projectMember]);

  await h.rpc("apply_permit_discovery", fx.discovery({ credentialId: CRED }));
  await h.rpc("apply_permit_sync_batch", fx.resubmitBatch({ credentialId: CRED }));
  await h.rpc("apply_permit_sync_batch", fx.approvedFilesBatch({ credentialId: CRED, accountDownload: true }));
  await h.rpc("apply_permit_sync_batch", {
    adapter_key: "other-portal", credential_id: CRED2, permit: { portal_record_id: "X-1", fields: { permit_number: "X-1" } }, sections: {},
  });
  P = Object.fromEntries((await h.db.query(`SELECT portal_record_id, id FROM permits`)).rows.map((r) => [r.portal_record_id, r.id]));

  const doc = (await h.db.query(`SELECT id FROM permit_documents WHERE portal_file_id = '700101'`)).rows[0].id;
  storedObject = `${P["11105"]}/700101.pdf`;
  await h.asService((tx) => tx.query(`SELECT public.record_permit_document_download($1, 'stored', $2, 'abc')`, [doc, storedObject]));
  await h.db.query(`INSERT INTO storage.objects (bucket_id, name) VALUES ('permit-documents', $1), ('permit-documents', $2), ('permit-documents', $3)`,
    [storedObject, `${P["11105"]}/orphan.pdf`, `${P["X-1"]}/x.pdf`]);

  const grant = (scope, ref, user, tenant) =>
    adminCall(`SELECT public.admin_grant_permit_access($1, $2, $3, $4, 'test') AS id`, [scope, ref, user, tenant]);
  await grant("permit", P["11854"], U.permitGrantee, null);
  await grant("adapter", "dc-projectdox", U.adapterGrantee, null);
  await grant("source_credential", CRED2, null, TENANT);
  const r = await grant("permit", P["11854"], U.revoked, null);
  await adminCall(`SELECT public.admin_revoke_permit_access($1)`, [r.rows[0].id]);
  await adminCall(`SELECT public.admin_link_project_permit($1, $2)`, [PROJECT, P["11854"]]);
});

async function visible(uid, table, where = "TRUE") {
  return h.asUser(uid, async (tx) => (await tx.query(`SELECT count(*)::int AS n FROM public.${table} WHERE ${where}`)).rows[0].n);
}

test("read matrix: each access path sees exactly its permits", async () => {
  const expected = {
    admin: 29, superAdmin: 29, credUse: 28, credNone: 0, inactive: 0, permitGrantee: 1,
    adapterGrantee: 28, tenantMember: 1, projectMember: 0, revoked: 0, unrelated: 0, owner: 0,
  };
  for (const [who, n] of Object.entries(expected)) {
    assert.equal(await visible(U[who], "permits"), n, `${who} permits`);
  }
  assert.equal(await h.asUser(U.tenantMember, async (tx) => (await tx.query(`SELECT portal_record_id FROM permits`)).rows[0].portal_record_id), "X-1");
  assert.equal(await h.asUser(U.permitGrantee, async (tx) => (await tx.query(`SELECT portal_record_id FROM permits`)).rows[0].portal_record_id), "11854");
});

test("child tables, snapshots and history follow permit access", async () => {
  const total = {};
  for (const t of TABLES) total[t] = await h.count(t);
  for (const t of TABLES) {
    assert.equal(await visible(U.admin, t), total[t], `admin ${t}`);
    for (const who of ["credNone", "inactive", "projectMember", "revoked", "unrelated"]) {
      assert.equal(await visible(U[who], t), 0, `${who} must not see ${t}`);
    }
  }
  assert.equal(await visible(U.permitGrantee, "permit_review_comments"), 3);
  assert.equal(await visible(U.permitGrantee, "permit_documents"), 0, "permit grant does not leak other permits' documents");
  assert.ok((await visible(U.permitGrantee, "permit_snapshots")) > 0);
  assert.equal(await visible(U.permitGrantee, "permit_snapshots", `permit_id <> '${P["11854"]}'`), 0);
  assert.equal(await visible(U.credUse, "permit_documents"), 2);
  assert.equal(await visible(U.tenantMember, "permit_review_comments"), 0);
});

test("storage objects require permit access and a stored document row", async () => {
  const objects = (uid) => h.asUser(uid, async (tx) => (await tx.query(`SELECT name FROM storage.objects ORDER BY name`)).rows.map((r) => r.name));
  assert.deepEqual(await objects(U.credUse), [storedObject], "orphan objects stay hidden");
  assert.deepEqual(await objects(U.admin), [storedObject]);
  assert.deepEqual(await objects(U.unrelated), []);
  assert.deepEqual(await objects(U.permitGrantee), []);
  assert.deepEqual(await objects(U.tenantMember), [], "tenant sees permit X-1 but has no stored document for it");

  const doc2 = (await h.db.query(`SELECT id FROM permit_documents WHERE portal_file_id = '700102'`)).rows[0].id;
  const path2 = `${P["11105"]}/700102.pdf`;
  await h.db.query(`INSERT INTO storage.objects (bucket_id, name) VALUES ('permit-documents', $1)`, [path2]);
  await h.asService((tx) => tx.query(`SELECT public.record_permit_document_download($1, 'stored', $2, 'def')`, [doc2, path2]));
  assert.deepEqual(await objects(U.credUse), [storedObject, path2].sort());
  await h.asService((tx) => tx.query(`SELECT public.record_permit_document_download($1, 'failed')`, [doc2]));
  assert.deepEqual(await objects(U.credUse), [storedObject], "objects of documents no longer 'stored' are hidden");
});

test("sync sources and grants: admin-only and own-grants-only", async () => {
  await adminCall(`SELECT public.admin_set_permit_sync_source($1, 'dc-projectdox', false, '{}'::jsonb)`, [CRED]);
  assert.equal(await visible(U.admin, "permit_sync_sources"), 1);
  assert.equal(await visible(U.credUse, "permit_sync_sources"), 0);
  assert.equal(await visible(U.admin, "permit_access_grants"), 4);
  assert.equal(await visible(U.permitGrantee, "permit_access_grants"), 1);
  assert.equal(await visible(U.unrelated, "permit_access_grants"), 0);
});

test("anon has no access to any repository table or storage object", async () => {
  for (const t of [...TABLES, "permit_sync_sources", "permit_access_grants"]) {
    await assert.rejects(h.asAnon((tx) => tx.query(`SELECT 1 FROM public.${t} LIMIT 1`)), /permission denied/, t);
  }
  const anonObjects = await h.asAnon(async (tx) => (await tx.query(`SELECT count(*)::int AS n FROM storage.objects`)).rows[0].n);
  assert.equal(anonObjects, 0);
  await assert.rejects(h.asAnon((tx) => tx.query(`SELECT public.can_read_permit($1)`, [P["11854"]])), /permission denied/);
});

test("authenticated users cannot write tables or call service RPCs, even with access", async () => {
  const writes = [
    `INSERT INTO public.permits (adapter_key, portal_record_id) VALUES ('dc-projectdox', 'evil')`,
    `UPDATE public.permits SET status = 'approved'`,
    `DELETE FROM public.permit_review_comments`,
    `UPDATE public.permit_documents SET download_status = 'stored', storage_path = 'x'`,
    `INSERT INTO public.permit_access_grants (grantee_user_id, scope_type, adapter_key) VALUES ('${U.credUse}', 'adapter', 'other-portal')`,
    `INSERT INTO public.project_permits (project_id, permit_id) VALUES ('${PROJECT}', '${P["11105"]}')`,
    `SELECT public.apply_permit_sync_batch('{}'::jsonb)`,
    `SELECT public.apply_permit_discovery('{}'::jsonb)`,
    `SELECT public.record_permit_document_download('${P["11105"]}', 'stored', 'x', 'y')`,
    `SELECT public.user_can_read_permit('${U.credUse}', '${P["11854"]}')`,
    `SELECT public._permit_upsert_row('permits', 'id', NULL, 'k', '{}'::jsonb, 'h', 's', NULL, now())`,
  ];
  for (const who of ["credUse", "admin"]) {
    for (const sql of writes) {
      await assert.rejects(h.asUser(U[who], (tx) => tx.query(sql)), /permission denied/, `${who}: ${sql}`);
    }
  }
});

test("Management Admin RPCs refuse non-admins and are audited for admins", async () => {
  const calls = [
    [`SELECT public.admin_grant_permit_access('adapter', 'dc-projectdox', $1, NULL, NULL)`, [U.unrelated]],
    [`SELECT public.admin_link_project_permit($1, $2)`, [PROJECT, P["11105"]]],
    [`SELECT public.admin_unlink_project_permit($1, $2)`, [PROJECT, P["11854"]]],
    [`SELECT public.admin_set_permit_sync_source($1, 'dc-projectdox', true, '{}'::jsonb)`, [CRED]],
  ];
  for (const who of ["credUse", "projectMember", "inactive", "unrelated"]) {
    for (const [sql, params] of calls) {
      await assert.rejects(h.asUser(U[who], (tx) => tx.query(sql, params)), /Not authorized/, `${who}: ${sql}`);
    }
  }
  assert.equal(await visible(U.unrelated, "permits"), 0);

  const audits = await h.count("platform_audit_events", "action LIKE 'permit%'");
  assert.ok(audits >= 6, "grant, revoke, link and source changes are audited");
  const actor = (await h.db.query(`SELECT DISTINCT actor_id FROM platform_audit_events WHERE action LIKE 'permit%'`)).rows;
  assert.deepEqual(actor.map((r) => r.actor_id), [U.admin]);

  await assert.rejects(
    adminCall(`SELECT public.admin_set_permit_sync_source($1, 'dc-projectdox', true, '{}'::jsonb)`, [PLAIN_CRED]),
    /must be encrypted/,
  );
  await adminCall(`SELECT public.admin_set_permit_sync_source($1, 'dc-projectdox', false, '{}'::jsonb)`, [PLAIN_CRED]);
  const st = (await h.db.query(`SELECT status, automation_enabled FROM permit_sync_sources WHERE credential_id = $1`, [PLAIN_CRED])).rows[0];
  assert.deepEqual(st, { status: "needs_encryption", automation_enabled: false });

  await adminCall(`SELECT public.admin_set_permit_sync_source($1, 'dc-projectdox', true, '{}'::jsonb)`, [CRED]);
  await assert.rejects(
    adminCall(`SELECT public.admin_set_permit_sync_source($1, 'dc-projectdox', true, '{}'::jsonb)`, [CRED2]),
    /same portal login/,
    "CRED and CRED2 share one DC login; only one may drive automation",
  );
  await adminCall(`SELECT public.admin_set_permit_sync_source($1, 'dc-projectdox', false, '{}'::jsonb)`, [CRED]);
});

test("encrypted-credential check in SQL agrees with the app's AES-GCM envelope format", async () => {
  const crypto = require("node:crypto");
  const prev = process.env.PORTAL_CREDENTIALS_ENCRYPTION_KEY;
  process.env.PORTAL_CREDENTIALS_ENCRYPTION_KEY = crypto.randomBytes(32).toString("base64");
  const mod = require("../app/services/portal-credentials/portal-credentials-crypto.js");
  try {
    const real = mod.encryptPortalPassword("test-only-password");
    const cases = [
      real,
      ` ${real} `,
      "plaintext",
      "{not json",
      '{"pc_v":1,"iv":"a","at":"b","ct":"c"}',
      '{"pc_v":"1","iv":"a","at":"b"}',
      '{"pc_v":"2","iv":"a","at":"b","ct":"c"}',
      "pc_v:1:abc",
      "",
    ];
    for (const value of cases) {
      const sql = (await h.db.query(`SELECT public._permit_credential_is_encrypted($1) AS e`, [value])).rows[0].e;
      const js = value.trim().startsWith("{") && (() => {
        try {
          const o = JSON.parse(value.trim());
          return o.pc_v === "1" && typeof o.iv === "string" && typeof o.at === "string" && typeof o.ct === "string";
        } catch { return false; }
      })();
      assert.equal(sql, js, `value ${JSON.stringify(value).slice(0, 40)}`);
    }
    assert.equal(mod.resolveStoredPortalPassword(real), "test-only-password");
  } finally {
    if (prev === undefined) delete process.env.PORTAL_CREDENTIALS_ENCRYPTION_KEY;
    else process.env.PORTAL_CREDENTIALS_ENCRYPTION_KEY = prev;
  }
});

test("revoking access and suspending a user take effect immediately", async () => {
  assert.equal(await visible(U.adapterGrantee, "permits"), 28);
  const g = (await h.db.query(`SELECT id FROM permit_access_grants WHERE grantee_user_id = $1 AND revoked_at IS NULL`, [U.adapterGrantee])).rows[0].id;
  await adminCall(`SELECT public.admin_revoke_permit_access($1)`, [g]);
  assert.equal(await visible(U.adapterGrantee, "permits"), 0);

  assert.equal(await visible(U.credUse, "permits"), 28);
  await h.db.query(`UPDATE profiles SET access_status = 'suspended' WHERE user_id = $1`, [U.credUse]);
  assert.equal(await visible(U.credUse, "permits"), 0);
  await h.db.query(`UPDATE profiles SET access_status = 'active' WHERE user_id = $1`, [U.credUse]);
});
