"use strict";

/**
 * search_permits (Phase 3 UI migration) run as real `authenticated` / `anon` roles with RLS enforced:
 * it must return only permits the caller can read, and match comment text only through readable comments.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const { createPermitRepoDb } = require("./helpers/permit-repo-db");
const fx = require("./helpers/permit-repo-fixtures");

const U = {
  owner: "00000000-0000-4000-8000-000000000101",
  admin: "00000000-0000-4000-8000-000000000102",
  grantee: "00000000-0000-4000-8000-000000000103",
  unrelated: "00000000-0000-4000-8000-000000000104",
};
const CRED = "00000000-0000-4000-8000-0000000001c1";

let h;
let P;

test.before(async () => {
  h = await createPermitRepoDb();
  for (const id of Object.values(U)) await h.createUser(id);
  await h.db.query(`INSERT INTO user_roles (user_id, role) VALUES ($1, 'admin')`, [U.admin]);
  await h.createCredential(CRED, U.owner);
  await h.rpc("apply_permit_discovery", fx.discovery({ credentialId: CRED }));
  await h.rpc("apply_permit_sync_batch", fx.resubmitBatch({ credentialId: CRED }));
  P = Object.fromEntries((await h.db.query(`SELECT portal_record_id, id FROM permits`)).rows.map((r) => [r.portal_record_id, r.id]));
  await h.asUser(U.admin, (tx) => tx.query(`SELECT public.admin_grant_permit_access('permit', $1, $2, NULL, 'test')`, [P["11854"], U.grantee]));
});

async function search(uid, args = {}) {
  const a = { q: null, status: null, jurisdiction: null, removed: false, limit: 50, offset: 0, ...args };
  return h.asUser(uid, async (tx) =>
    (await tx.query(`SELECT * FROM public.search_permits($1, $2, $3, $4, $5, $6)`, [a.q, a.status, a.jurisdiction, a.removed, a.limit, a.offset])).rows);
}

test("lists only permits the caller can read", async () => {
  const all = await search(U.admin);
  assert.equal(all.length, 28);
  assert.equal(Number(all[0].total_count), 28);
  assert.deepEqual((await search(U.grantee)).map((r) => r.permit_number), ["D2500488"]);
  assert.equal((await search(U.unrelated)).length, 0);
  assert.equal((await search(U.owner)).length, 0);
});

test("matches permit numbers by prefix, permit text, and readable comment text", async () => {
  const byNumber = await search(U.admin, { q: "d25004" });
  assert.deepEqual(byNumber.map((r) => [r.permit_number, r.matched_in]), [["D2500488", "permit_number"]]);
  const prefix = await search(U.admin, { q: "B2508" });
  assert.ok(prefix.length >= 2 && prefix.every((r) => r.permit_number.startsWith("B2508") && r.matched_in === "permit_number"));
  const byComment = await search(U.admin, { q: "asbestos contractor" });
  assert.deepEqual(byComment.map((r) => [r.permit_number, r.matched_in]), [["D2500488", "comments"]]);
  assert.deepEqual((await search(U.grantee, { q: "asbest" })).map((r) => r.permit_number), ["D2500488"]);
  assert.equal((await search(U.unrelated, { q: "asbestos" })).length, 0);
  assert.equal((await search(U.admin, { q: "nothingmatchesthis" })).length, 0);
});

test("filters, paging bounds and removed permits", async () => {
  assert.equal((await search(U.admin, { status: "resubmit" })).length, 3);
  assert.equal((await search(U.admin, { jurisdiction: "Nowhere" })).length, 0);
  const page1 = await search(U.admin, { limit: 10, offset: 0 });
  const page3 = await search(U.admin, { limit: 10, offset: 20 });
  assert.equal(page1.length, 10);
  assert.equal(page3.length, 8);
  assert.equal(new Set([...page1, ...page3].map((r) => r.id)).size, 18);
  assert.equal((await search(U.admin, { limit: 100000 })).length, 28);
  assert.equal((await search(U.admin, { limit: -5 })).length, 1);

  await h.db.query(`UPDATE permits SET removed_from_portal_at = now() WHERE id = $1`, [P["9187"]]);
  try {
    assert.equal((await search(U.admin)).length, 27);
    assert.equal((await search(U.admin, { removed: true })).length, 28);
  } finally {
    await h.db.query(`UPDATE permits SET removed_from_portal_at = NULL WHERE id = $1`, [P["9187"]]);
  }
});

test("query text cannot inject tsquery syntax, and anon cannot call search", async () => {
  for (const q of ["asbestos' | !x:* & (", "&&&", ":*", "'; DROP TABLE permits; --", "a".repeat(5000)]) {
    await search(U.admin, { q });
  }
  assert.equal((await search(U.admin, { q: "!!!" })).length, 28);
  await assert.rejects(
    h.asAnon((tx) => tx.query(`SELECT * FROM public.search_permits(NULL, NULL, NULL, false, 50, 0)`)),
    /permission denied/,
  );
});

test("the central_permits flag is seeded off", async () => {
  const r = await h.db.query(`SELECT enabled FROM public.feature_flags WHERE key = 'module.central_permits'`);
  assert.equal(r.rows[0].enabled, false);
});
