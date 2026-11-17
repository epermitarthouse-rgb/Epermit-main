"use strict";

/**
 * 20261117130000_permit_default_access.sql on the real migration chain (PGlite), run as the real
 * `authenticated` / `anon` roles with RLS enforced (D-120): every active user reads the permits of a source marked
 * visible to all, an admin can hide a source from one user, read access never implies refresh, and project linking
 * still needs both permit access and project edit access.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const { replay, MIGRATIONS_DIR } = require("./helpers/replay-migrations");
const fx = require("./helpers/permit-repo-fixtures");

const U = {
  owner: "30000000-0000-4000-8000-000000000001",
  plain: "30000000-0000-4000-8000-000000000002",
  hidden: "30000000-0000-4000-8000-000000000003",
  admin: "30000000-0000-4000-8000-000000000004",
  suspended: "30000000-0000-4000-8000-000000000005",
  manager: "30000000-0000-4000-8000-000000000006",
  reader: "30000000-0000-4000-8000-000000000007",
  useGrant: "30000000-0000-4000-8000-000000000008",
  isolated: "30000000-0000-4000-8000-00000000000a",
};
const FUTURE = "30000000-0000-4000-8000-000000000009";
const CRED = "30000000-0000-4000-8000-0000000000c1";
const OTHER_CRED = "30000000-0000-4000-8000-0000000000c2";
const PROJECT = "30000000-0000-4000-8000-0000000000f1";
const OWN_PROJECT = "30000000-0000-4000-8000-0000000000f2";

let db;
let PERMIT;

const asUser = (sub, fn) =>
  db.transaction(async (tx) => {
    await tx.query(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [sub || ""]);
    await tx.exec(`SET LOCAL ROLE authenticated`);
    return fn(tx);
  });
const asAnon = (fn) =>
  db.transaction(async (tx) => {
    await tx.query(`SELECT set_config('request.jwt.claim.sub', '', true)`);
    await tx.exec(`SET LOCAL ROLE anon`);
    return fn(tx);
  });
const asService = (fn) =>
  db.transaction(async (tx) => {
    await tx.query(`SELECT set_config('request.jwt.claim.sub', '', true)`);
    await tx.exec(`SET LOCAL ROLE service_role`);
    return fn(tx);
  });
const one = async (tx, sql, params) => (await tx.query(sql, params)).rows[0];
const n = (sub, table, where = "TRUE") =>
  asUser(sub, async (tx) => (await one(tx, `SELECT count(*)::int AS n FROM public.${table} WHERE ${where}`)).n);
const objects = (sub) => asUser(sub, async (tx) => (await tx.query(`SELECT name FROM storage.objects ORDER BY name`)).rows.map((r) => r.name));
const admin = (sql, params) => asUser(U.admin, async (tx) => (await tx.query(sql, params)).rows);
const hide = (user, hidden, cred = CRED) => admin(`SELECT public.admin_set_permit_user_hidden($1, $2, $3, 'test') AS changed`, [user, cred, hidden]);
const setDefault = (visible, cred = CRED) => admin(`SELECT public.admin_set_permit_source_default($1, $2)`, [cred, visible]);
const overview = (sub) => asUser(sub, async (tx) => (await one(tx, `SELECT public.get_permit_sync_overview() AS o`)).o);
const link = (sub, project, permit = PERMIT) => asUser(sub, (tx) => tx.query(`SELECT public.link_project_permits($1, $2::uuid[])`, [project, [permit]]));

test.before(async () => {
  ({ db } = await replay());
  for (const [label, id] of Object.entries(U)) {
    await db.query(`INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES ($1, $2, '{}'::jsonb)`, [id, `${label}@test.invalid`]);
  }
  await db.query(`INSERT INTO public.profiles (user_id) SELECT id FROM auth.users ON CONFLICT (user_id) DO NOTHING`);
  await db.query(`UPDATE public.profiles SET access_status = 'deactivated' WHERE user_id = $1`, [U.suspended]);
  await db.query(`INSERT INTO public.user_roles (user_id, role) VALUES ($1, 'admin')`, [U.admin]);
  for (const id of [CRED, OTHER_CRED]) {
    await db.query(
      `INSERT INTO public.portal_credentials (id, user_id, jurisdiction, portal_username, portal_password, permit_number) VALUES ($1, $2, 'Washington DC', 'acct', '{"pc_v":"1","iv":"aXY=","at":"YXQ=","ct":"Y3Q="}', 'D2500488')`,
      [id, U.admin],
    );
  }
  await db.query(`INSERT INTO public.user_portal_credential_grants (user_id, credential_id, grant_level) VALUES ($1, $3, 'manage'), ($2, $3, 'use'), ($4, $3, 'use')`, [U.manager, U.useGrant, CRED, U.hidden]);
  await asService((tx) => tx.query(`SELECT public.apply_permit_discovery($1::jsonb)`, [JSON.stringify(fx.discovery({ credentialId: CRED }))]));
  await asService((tx) => tx.query(`SELECT public.apply_permit_sync_batch($1::jsonb)`, [JSON.stringify(fx.resubmitBatch({ credentialId: CRED }))]));
  await asService((tx) => tx.query(`SELECT public.apply_permit_sync_batch($1::jsonb)`, [JSON.stringify(fx.approvedFilesBatch({ credentialId: CRED, accountDownload: true }))]));
  await db.query(`INSERT INTO public.permit_sync_sources (credential_id, adapter_key, visible_to_all) VALUES ($1, 'dc-projectdox', true)`, [CRED]);
  PERMIT = (await db.query(`SELECT id FROM public.permits WHERE portal_record_id = '11854'`)).rows[0].id;
  await db.query(`INSERT INTO public.projects (id, name, user_id) VALUES ($1, 'Owner project', $3), ($2, 'Plain project', $4)`, [PROJECT, OWN_PROJECT, U.owner, U.plain]);
  // The app's project model is default-write for active users; explicit overrides are the isolation mechanism.
  await db.query(`INSERT INTO public.user_project_access_overrides (user_id, project_id, access_level) VALUES ($1, $3, 'read'), ($2, $3, 'none')`, [U.reader, U.isolated, PROJECT]);
});

test("a migrated source marked visible to all lets any active user read the permits, current and future", async () => {
  for (const who of ["owner", "plain", "hidden", "reader", "useGrant", "manager"]) {
    assert.equal(await n(U[who], "permits"), 28, `${who} sees the DC permits`);
  }
  assert.equal(await n(U.plain, "permit_review_comments"), 3);
  assert.ok((await n(U.plain, "permit_snapshots")) > 0);
  assert.equal(await n(U.admin, "permits"), 28);
  assert.equal(await n(U.suspended, "permits"), 0, "suspended accounts see nothing");

  await db.query(`INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES ($1, 'future@test.invalid', '{}'::jsonb)`, [FUTURE]);
  assert.equal(await n(FUTURE, "permits"), 28, "a user created later gets access with no setup");
});

test("anon sees nothing and a signed-out call is refused", async () => {
  for (const t of ["permits", "permit_review_comments", "permit_sync_sources", "permit_access_grants", "project_permits"]) {
    await assert.rejects(asAnon((tx) => tx.query(`SELECT 1 FROM public.${t} LIMIT 1`)), /permission denied/, t);
  }
  assert.equal(await asAnon(async (tx) => (await one(tx, `SELECT count(*)::int AS n FROM storage.objects`)).n), 0);
  await assert.rejects(asAnon((tx) => tx.query(`SELECT public.get_permit_sync_overview()`)), /permission denied/);
  await assert.rejects(asAnon((tx) => tx.query(`SELECT public.admin_list_permit_access($1)`, [CRED])), /permission denied/);
  await assert.rejects(asUser(null, (tx) => tx.query(`SELECT public.get_permit_sync_overview()`)), /Not authorized/);
  assert.equal(await asUser(null, async (tx) => (await one(tx, `SELECT count(*)::int AS n FROM public.permits`)).n), 0);
});

test("the per-source switch turns the default off and on, audited; a source that is not visible by default needs a grant", async () => {
  await setDefault(false);
  assert.equal(await n(U.plain, "permits"), 0);
  assert.equal(await n(U.useGrant, "permits"), 28, "a 'use' credential grant still reads");
  assert.equal(await n(U.admin, "permits"), 28);
  assert.deepEqual((await overview(U.plain)), []);
  await setDefault(true);
  assert.equal(await n(U.plain, "permits"), 28);
  await setDefault(true);
  const audit = await db.query(`SELECT actor_id, action, before_json, after_json FROM public.platform_audit_events WHERE action = 'permit_source.default_visibility' ORDER BY created_at, id`);
  assert.equal(audit.rows.length, 2, "only changes are audited");
  assert.deepEqual(audit.rows.map((r) => r.after_json.visible_to_all), [false, true]);
  assert.ok(audit.rows.every((r) => r.actor_id === U.admin));
  await assert.rejects(asUser(U.plain, (tx) => tx.query(`SELECT public.admin_set_permit_source_default($1, false)`, [CRED])), /Not authorized/);
  await assert.rejects(setDefault(true, "30000000-0000-4000-8000-0000000000ff"), /source not found/);
  assert.equal(await n(U.plain, "permits"), 28);
});

test("hiding a source from one user removes its permits, files and sync state; unhiding restores them", async () => {
  const d = (await db.query(`SELECT id, permit_id FROM public.permit_documents ORDER BY portal_file_id LIMIT 1`)).rows[0];
  const doc = d.id;
  const path = `${d.permit_id}/700101.pdf`;
  await db.query(`INSERT INTO storage.objects (bucket_id, name) VALUES ('permit-documents', $1)`, [path]);
  await asService((tx) => tx.query(`SELECT public.record_permit_document_download($1, 'stored', $2, 'abc')`, [doc, path]));
  assert.deepEqual(await objects(U.hidden), [path]);
  assert.equal((await overview(U.hidden)).length, 1);

  assert.equal((await hide(U.hidden, true))[0].changed, true);
  assert.equal((await hide(U.hidden, true))[0].changed, false, "hiding twice is a no-op");
  for (const t of ["permits", "permit_source_links", "permit_review_comments", "permit_snapshots", "permit_documents", "permit_section_state"]) {
    assert.equal(await n(U.hidden, t), 0, `hidden user must not see ${t}`);
  }
  assert.deepEqual(await objects(U.hidden), []);
  assert.deepEqual(await overview(U.hidden), []);
  await assert.rejects(asUser(U.hidden, (tx) => tx.query(`SELECT public.get_permit_sync_job_progress($1)`, ["30000000-0000-4000-8000-0000000000aa"])), /Not authorized/);
  assert.equal(await asUser(U.hidden, async (tx) => (await one(tx, `SELECT public.can_read_permit($1) AS ok`, [PERMIT])).ok), false);
  assert.equal(await asUser(U.hidden, async (tx) => (await one(tx, `SELECT count(*)::int AS n FROM public.get_permit_sync_progress(ARRAY[$1::uuid])`, [PERMIT])).n), 0);

  for (const who of ["plain", "owner", "reader", "useGrant", "manager", "admin"]) {
    assert.equal(await n(U[who], "permits"), 28, `${who} is unaffected`);
  }
  assert.deepEqual(await objects(U.plain), [path]);

  assert.equal((await hide(U.hidden, false))[0].changed, true);
  assert.equal((await hide(U.hidden, false))[0].changed, false, "unhiding twice is a no-op");
  assert.equal(await n(U.hidden, "permits"), 28, "unhide restores access");
  assert.deepEqual(await objects(U.hidden), [path]);
  assert.equal((await overview(U.hidden)).length, 1);

  const audit = await db.query(`SELECT actor_id, action, target_id, before_json, after_json FROM public.platform_audit_events WHERE action IN ('permit_access.hide', 'permit_access.unhide') ORDER BY created_at, id`);
  assert.deepEqual(audit.rows.map((r) => r.action), ["permit_access.hide", "permit_access.unhide"]);
  assert.ok(audit.rows.every((r) => r.actor_id === U.admin && r.target_id === CRED));
  assert.equal(audit.rows[0].after_json.user_id, U.hidden);
  assert.equal(audit.rows[1].before_json.user_id, U.hidden);
  const history = await db.query(`SELECT effect, revoked_at IS NOT NULL AS revoked FROM public.permit_access_grants WHERE grantee_user_id = $1`, [U.hidden]);
  assert.deepEqual(history.rows, [{ effect: "deny", revoked: true }], "the hide row is kept as history");
});

test("hidden wins over a 'use' grant and a tenant grant, but never over a platform admin", async () => {
  await hide(U.useGrant, true);
  assert.equal(await n(U.useGrant, "permits"), 0, "a 'use' credential grant does not override a hide");
  await hide(U.useGrant, false);
  assert.equal(await n(U.useGrant, "permits"), 28);

  await db.query(`INSERT INTO public.tenants (id, name, slug) VALUES ('30000000-0000-4000-8000-0000000000e1', 'T', 't')`);
  await db.query(`INSERT INTO public.tenant_memberships (tenant_id, user_id) VALUES ('30000000-0000-4000-8000-0000000000e1', $1)`, [U.plain]);
  await admin(`SELECT public.admin_grant_permit_access('permit', $1, NULL, '30000000-0000-4000-8000-0000000000e1', 'tenant')`, [PERMIT]);
  await hide(U.plain, true);
  assert.equal(await n(U.plain, "permits"), 0, "a permit-level allow grant does not override a hide");
  await hide(U.plain, false);
  const g = (await db.query(`SELECT id FROM public.permit_access_grants WHERE grantee_tenant_id IS NOT NULL`)).rows[0].id;
  await admin(`SELECT public.admin_revoke_permit_access($1)`, [g]);
  assert.equal(await n(U.plain, "permits"), 28);

  await assert.rejects(hide(U.admin, true), /platform admins always see permits/);
  await assert.rejects(hide("30000000-0000-4000-8000-0000000000ee", true), /user not found/);
  await assert.rejects(hide(U.plain, true, "30000000-0000-4000-8000-0000000000ff"), /source not found/);
  for (const who of ["plain", "hidden", "reader", "manager", "suspended"]) {
    await assert.rejects(asUser(U[who], (tx) => tx.query(`SELECT public.admin_set_permit_user_hidden($1, $2, true, NULL)`, [U.reader, CRED])), /Not authorized/, who);
    await assert.rejects(asUser(U[who], (tx) => tx.query(`SELECT public.admin_list_permit_access($1)`, [CRED])), /Not authorized/, who);
  }
  assert.equal(await n(U.reader, "permits"), 28);
});

test("hiding a source does not hide permits that are linked to another visible source only", async () => {
  await db.query(`INSERT INTO public.permit_sync_sources (credential_id, adapter_key, visible_to_all) VALUES ($1, 'dc-projectdox', true)`, [OTHER_CRED]);
  await hide(U.plain, true, OTHER_CRED);
  assert.equal(await n(U.plain, "permits"), 28, "OTHER_CRED has no permits; the hide is scoped to that source");
  await hide(U.plain, false, OTHER_CRED);
  await db.query(`DELETE FROM public.permit_sync_sources WHERE credential_id = $1`, [OTHER_CRED]);
});

test("the access list shows each user's state without e-mail addresses", async () => {
  await hide(U.hidden, true);
  const list = (await admin(`SELECT public.admin_list_permit_access($1) AS l`, [CRED]))[0].l;
  const byId = Object.fromEntries(list.map((r) => [r.user_id, r]));
  assert.equal(byId[U.admin].state, "admin");
  assert.equal(byId[U.hidden].state, "hidden");
  assert.equal(byId[U.hidden].hidden, true);
  assert.ok(byId[U.hidden].hidden_at);
  assert.equal(byId[U.hidden].can_read, false);
  assert.equal(byId[U.suspended].state, "inactive");
  assert.equal(byId[U.plain].state, "default");
  assert.equal(byId[U.plain].can_read, true);
  assert.equal(list.length, Object.keys(U).length + 1, "every profile is listed, including the later user");
  assert.ok(list.every((r) => !("email" in r)), "no e-mail addresses");

  await setDefault(false);
  const off = Object.fromEntries((await admin(`SELECT public.admin_list_permit_access($1) AS l`, [CRED]))[0].l.map((r) => [r.user_id, r]));
  assert.equal(off[U.plain].state, "none");
  assert.equal(off[U.useGrant].state, "grant");
  assert.equal(off[U.hidden].state, "hidden");
  await setDefault(true);
  await hide(U.hidden, false);
});

test("read access does not imply refresh", async () => {
  const cases = [
    [`SELECT public.request_permit_sync_refresh($1, NULL)`, [CRED]],
    [`SELECT public.request_permit_refresh($1)`, [PERMIT]],
    [`SELECT public.admin_request_permit_sync($1)`, [CRED]],
  ];
  for (const who of ["plain", "reader", "useGrant", "owner"]) {
    assert.equal(await n(U[who], "permits"), 28);
    for (const [sql, params] of cases) {
      await assert.rejects(asUser(U[who], (tx) => tx.query(sql, params)), /Not authorized/, `${who}: ${sql}`);
    }
    const [src] = await overview(U[who]);
    assert.equal(src.can_refresh, false, `${who} sees the source but cannot refresh it`);
  }
  assert.equal(await db.query(`SELECT 1 FROM public.permit_sync_jobs`).then((r) => r.rows.length), 0, "no job was queued");

  const [mgr] = await overview(U.manager);
  assert.equal(mgr.can_refresh, true, "a 'manage' grant still refreshes");
  const [adm] = await overview(U.admin);
  assert.equal(adm.can_refresh, true);
  assert.equal(adm.permit_count, 28);
});

test("linking still needs permit access and project edit access", async () => {
  // Default access + project edit access: allowed.
  assert.equal(await asUser(U.owner, async (tx) => (await one(tx, `SELECT public.link_project_permits($1, $2::uuid[]) AS n`, [PROJECT, [PERMIT]])).n), 1);
  // Permit access without project edit access: refused.
  await assert.rejects(link(U.reader, PROJECT), /not allowed to change this project/);
  await assert.rejects(link(U.isolated, PROJECT), /not allowed to change this project/, "reading permits does not give edit access to a project the user is blocked from");
  // Project edit access without permit access: refused.
  await hide(U.plain, true);
  await assert.rejects(link(U.plain, OWN_PROJECT), /permit not available/);
  assert.equal(await n(U.plain, "project_permits", `project_id = '${OWN_PROJECT}'`), 0);
  // Unhide restores both.
  await hide(U.plain, false);
  assert.equal(await asUser(U.plain, async (tx) => (await one(tx, `SELECT public.link_project_permits($1, $2::uuid[]) AS n`, [OWN_PROJECT, [PERMIT]])).n), 1);
  await assert.rejects(asUser(U.plain, (tx) => tx.query(`INSERT INTO public.project_permits (project_id, permit_id) VALUES ($1, $2)`, [PROJECT, PERMIT])), /permission denied/, "direct writes stay closed");
});

test("project and comment isolation is unchanged: permit access does not open projects", async () => {
  await db.query(`INSERT INTO public.parsed_comments (project_id, original_text, discipline) VALUES ($1, 'private comment', 'Building')`, [PROJECT]);
  assert.equal(await n(U.isolated, "permits"), 28, "can read permits");
  assert.equal(await n(U.isolated, "projects", `id = '${PROJECT}'`), 0, "but not a project it is blocked from");
  assert.equal(await n(U.isolated, "parsed_comments", `project_id = '${PROJECT}'`), 0, "nor its comments");
  assert.equal(await n(U.owner, "projects", `id = '${PROJECT}'`), 1);
  assert.equal(await n(U.owner, "parsed_comments", `project_id = '${PROJECT}'`), 1);
  assert.equal(await n(U.reader, "parsed_comments", `project_id = '${PROJECT}'`), 1, "a read override still reads");
  assert.equal(await n(U.isolated, "project_permits", `project_id = '${PROJECT}'`), 0, "nor its permit links");
});

test("link rows are isolated by organization: read access to a permit does not reveal other organizations' projects", async () => {
  const T = { a: "30000000-0000-4000-8000-0000000000a1", b: "30000000-0000-4000-8000-0000000000b1" };
  const O = {
    aOwner: "30000000-0000-4000-8000-0000000000a2", aMember: "30000000-0000-4000-8000-0000000000a3",
    bOwner: "30000000-0000-4000-8000-0000000000b2", teamOnly: "30000000-0000-4000-8000-0000000000b3",
  };
  const PA = "30000000-0000-4000-8000-0000000000a4";
  const PB = "30000000-0000-4000-8000-0000000000b4";
  for (const [label, id] of Object.entries(O)) {
    await db.query(`INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES ($1, $2, '{}'::jsonb)`, [id, `${label}@test.invalid`]);
  }
  await db.query(`INSERT INTO public.profiles (user_id) SELECT id FROM auth.users ON CONFLICT (user_id) DO NOTHING`);
  await db.query(`INSERT INTO public.tenants (id, name, slug) VALUES ($1, 'Org A', 'org-a'), ($2, 'Org B', 'org-b')`, [T.a, T.b]);
  await db.query(`INSERT INTO public.tenant_memberships (tenant_id, user_id) VALUES ($1, $2), ($1, $3), ($4, $5)`, [T.a, O.aOwner, O.aMember, T.b, O.bOwner]);
  await db.query(`INSERT INTO public.projects (id, name, user_id, tenant_id) VALUES ($1, 'A project', $2, $3), ($4, 'B project', $5, $6)`, [PA, O.aOwner, T.a, PB, O.bOwner, T.b]);
  await db.query(`INSERT INTO public.project_team_members (project_id, user_id, role, added_by) VALUES ($1, $2, 'viewer', $3)`, [PB, O.teamOnly, O.bOwner]);
  // Linking still works for each organization's own project (default read + project edit access).
  await link(O.aOwner, PA);
  await link(O.bOwner, PB);

  const links = (sub) => asUser(sub, async (tx) => (await tx.query(`SELECT project_id FROM public.project_permits WHERE permit_id = $1 ORDER BY project_id`, [PERMIT])).rows.map((r) => r.project_id));
  const overviewLinks = (sub) => asUser(sub, async (tx) => (await tx.query(`SELECT project_id, project_name FROM public.get_comment_pipeline_overview(NULL, ARRAY[$1::uuid]) ORDER BY project_id`, [PERMIT])).rows);
  const expectOnly = async (sub, ids, who) => {
    const mine = (await links(sub)).filter((id) => id === PA || id === PB);
    assert.deepEqual(mine, ids, `${who}: link rows`);
    assert.deepEqual((await overviewLinks(sub)).map((r) => r.project_id).filter((id) => id === PA || id === PB), ids, `${who}: comment pipeline read model`);
  };

  assert.equal(await n(O.aMember, "permits", `id = '${PERMIT}'`), 1, "both organizations can read the permit");
  assert.equal(await n(O.bOwner, "permits", `id = '${PERMIT}'`), 1);
  const defaultWrite = await asUser(O.aMember, async (tx) => (await one(tx, `SELECT public.has_project_access($1, $2) AS ok`, [O.aMember, PB])).ok);
  assert.equal(defaultWrite, true, "precondition: the project model gives default access across organizations, so it cannot be the link filter");

  await expectOnly(O.aMember, [PA], "org A member sees org A links only");
  await expectOnly(O.aOwner, [PA], "org A owner");
  await expectOnly(O.bOwner, [PB], "org B owner");
  await expectOnly(O.teamOnly, [PB], "a project team member sees that project's links");
  await expectOnly(U.plain, [], "a user in no organization sees neither");
  await expectOnly(U.admin, [PA, PB], "platform admin sees all");
  assert.equal((await overviewLinks(U.admin)).find((r) => r.project_id === PB).project_name, "B project");

  await db.query(`INSERT INTO public.user_project_access_overrides (user_id, project_id, access_level) VALUES ($1, $2, 'read'), ($1, $3, 'none')`, [O.aMember, PB, PA]);
  await expectOnly(O.aMember, [PB], "an explicit share shows that project; a 'none' override hides even an own-organization project");
  await db.query(`DELETE FROM public.user_project_access_overrides WHERE user_id = $1`, [O.aMember]);

  await hide(O.aMember, true);
  await expectOnly(O.aMember, [], "a hidden user sees no links of the permit");
  await hide(O.aMember, false);
  await expectOnly(O.aMember, [PA], "unhide restores own links");

  // The comment pipeline runs as the project owner over all of the project's links (service role, no RLS).
  const fp = (project) => asService(async (tx) => (await one(tx, `SELECT public._project_permit_comment_fingerprint($1) AS f`, [project])).f);
  assert.ok(await fp(PA));
  assert.ok(await fp(PB));
});

test("the one-time backfill switches on dc-projectdox sources only, and re-applying the migration keeps an admin's choice", async () => {
  const file = fs.readFileSync(`${MIGRATIONS_DIR}/20261117130000_permit_default_access.sql`, "utf8");
  const base = (await replay({ exclude: ["20261117130000_permit_default_access.sql"] })).db;
  const owner = "30000000-0000-4000-8000-0000000000b1";
  const c1 = "30000000-0000-4000-8000-0000000000b2";
  const c2 = "30000000-0000-4000-8000-0000000000b3";
  await base.query(`INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES ($1, 'b@test.invalid', '{}'::jsonb)`, [owner]);
  for (const id of [c1, c2]) {
    await base.query(`INSERT INTO public.portal_credentials (id, user_id, jurisdiction, portal_username, portal_password, permit_number) VALUES ($1, $2, 'X', 'acct', '{"pc_v":"1","iv":"aXY=","at":"YXQ=","ct":"Y3Q="}', 'B1')`, [id, owner]);
  }
  await base.query(`INSERT INTO public.permit_sync_sources (credential_id, adapter_key) VALUES ($1, 'dc-projectdox'), ($2, 'other-portal')`, [c1, c2]);
  await base.exec(`BEGIN;\n${file}\nCOMMIT;`);
  const rows = async () => Object.fromEntries((await base.query(`SELECT credential_id, visible_to_all FROM public.permit_sync_sources`)).rows.map((r) => [r.credential_id, r.visible_to_all]));
  assert.deepEqual(await rows(), { [c1]: true, [c2]: false });
  await base.query(`UPDATE public.permit_sync_sources SET visible_to_all = false WHERE credential_id = $1`, [c1]);
  await base.exec(file);
  assert.deepEqual(await rows(), { [c1]: false, [c2]: false }, "re-applying does not undo an admin's switch");
});
