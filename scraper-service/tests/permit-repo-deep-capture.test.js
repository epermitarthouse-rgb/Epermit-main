"use strict";

/**
 * Deep capture migration (D-056, D-058, D-067) on the real migration chain: document capture RPC,
 * append-only report versions, protected columns, and the private-bucket read policy for report objects.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const { replay } = require("./helpers/replay-migrations");
const fx = require("./helpers/permit-repo-fixtures");

const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);
const ids = {
  reader: "20000000-0000-4000-8000-000000000001",
  unrelated: "20000000-0000-4000-8000-000000000002",
};
const cred = "20000000-0000-4000-8000-0000000000c1";

let db;
let permitId;
let docs;

const asService = (sql, params) => db.transaction(async (tx) => {
  await tx.exec(`SET LOCAL ROLE service_role`);
  return (await tx.query(sql, params)).rows;
});
const asUser = (sub, sql, params) => db.transaction(async (tx) => {
  await tx.query(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [sub]);
  await tx.exec(`SET LOCAL ROLE authenticated`);
  return (await tx.query(sql, params)).rows;
});

test.before(async () => {
  ({ db } = await replay());
  for (const [label, id] of Object.entries(ids)) {
    await db.query(`INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES ($1, $2, '{}'::jsonb)`, [id, `${label}@test.invalid`]);
  }
  await db.query(`INSERT INTO public.profiles (user_id) VALUES ($1), ($2) ON CONFLICT (user_id) DO NOTHING`, Object.values(ids));
  await db.query(`INSERT INTO public.portal_credentials (id, user_id, jurisdiction, portal_username, portal_password, permit_number) VALUES ($1, $2, 'Washington DC', 'acct', '{"pc_v":"1","iv":"aXY=","at":"YXQ=","ct":"Y3Q="}', 'B2407514')`, [cred, ids.unrelated]);
  await db.query(`INSERT INTO public.user_portal_credential_grants (user_id, credential_id, grant_level) VALUES ($1, $2, 'use')`, [ids.reader, cred]);
  const rpc = (name, arg) => asService(`SELECT public.${name}($1::jsonb) AS out`, [JSON.stringify(arg)]);
  await rpc("apply_permit_discovery", fx.discovery({ credentialId: cred }));
  await rpc("apply_permit_sync_batch", fx.approvedFilesBatch({ credentialId: cred, accountDownload: true }));
  permitId = (await db.query(`SELECT id FROM public.permits WHERE portal_record_id = '11105'`)).rows[0].id;
  docs = (await db.query(`SELECT id, download_permitted, download_status FROM public.permit_documents WHERE permit_id = $1 ORDER BY portal_file_id`, [permitId])).rows;
  await db.query(`INSERT INTO public.permit_reports (permit_id, report_key, name, content_hash) VALUES ($1, 'review_comments', 'Review Comments', 'x')`, [permitId]);
});

test("document capture records stored bodies only for permitted documents and is idempotent", async () => {
  assert.ok(docs.length >= 2 && docs.every((d) => d.download_permitted === true));
  const path = `${permitId}/files/700101_A-101.pdf`;
  const call = (status, p, sha, err = null) =>
    asService(`SELECT public.record_permit_document_capture($1, $2, $3, $4, 2048, 'application/pdf', $5) AS r`, [docs[0].id, status, p, sha, err]);
  assert.equal((await call("stored", path, SHA_A))[0].r, "stored");
  assert.equal((await call("stored", path, SHA_A))[0].r, "unchanged");
  assert.equal((await call("failed", null, null, "timeout"))[0].r, "kept_stored", "a later failure never clears a stored body");
  await assert.rejects(call("stored", `00000000-0000-4000-8000-000000000000/files/x.pdf`, SHA_A), /permit id/);
  await assert.rejects(call("stored", path, "nothex"), /sha256/);

  await db.query(`UPDATE public.permit_documents SET download_permitted = false WHERE id = $1`, [docs[1].id]);
  await assert.rejects(
    asService(`SELECT public.record_permit_document_capture($1, 'stored', $2, $3)`, [docs[1].id, `${permitId}/files/b.pdf`, SHA_A]),
    /not permitted/,
  );
  await db.query(`UPDATE public.permit_documents SET download_permitted = true WHERE id = $1`, [docs[1].id]);
  const changes = (await db.query(`SELECT count(*)::int AS n FROM public.permit_changes WHERE permit_id = $1 AND entity_table = 'permit_documents' AND field_changes ? 'sha256'`, [permitId])).rows[0].n;
  assert.equal(changes, 1, "one change row for the one real capture");
});

test("batch apply refuses capture columns and a normal re-sync keeps the stored body", async () => {
  for (const col of ["stored_size_bytes", "stored_content_type", "download_error", "download_run_id"]) {
    const batch = fx.approvedFilesBatch({ credentialId: cred, accountDownload: true });
    for (const row of batch.sections.files.tables.permit_documents) {
      row.fields[col] = null;
      row.hash = "f".repeat(64);
    }
    await assert.rejects(asService(`SELECT public.apply_permit_sync_batch($1::jsonb)`, [JSON.stringify(batch)]), new RegExp(`${col}.*not writable`));
  }
  const batch = fx.approvedFilesBatch({ credentialId: cred, accountDownload: true });
  const out = (await asService(`SELECT public.apply_permit_sync_batch($1::jsonb) AS out`, [JSON.stringify(batch)]))[0].out;
  assert.equal(out.changes, 0, JSON.stringify(out));
  const row = (await db.query(`SELECT download_status, storage_path, stored_size_bytes FROM public.permit_documents WHERE id = $1`, [docs[0].id])).rows[0];
  assert.deepEqual(row, { download_status: "stored", storage_path: `${permitId}/files/700101_A-101.pdf`, stored_size_bytes: 2048 });
});

test("report content is versioned by content hash and append-only", async () => {
  const rec = (sha, extra = {}) => asService(`SELECT public.record_permit_report_content($1, 'review_comments', $2::jsonb) AS r`,
    [permitId, JSON.stringify({ sha256: sha, text: `text ${sha[0]}`, structured_rows: [{ n: 1 }], pdf_path: `${permitId}/reports/review_comments/${sha}.pdf`, ...extra })]);
  assert.equal((await rec(SHA_A))[0].r.result, "inserted");
  assert.equal((await rec(SHA_A))[0].r.result, "unchanged");
  const v2 = (await rec(SHA_B))[0].r;
  assert.equal(v2.version, 2);
  await assert.rejects(rec("c".repeat(64), { pdf_path: "00000000-0000-4000-8000-000000000000/reports/x.pdf" }), /permit id/);

  const rep = (await db.query(`SELECT content_status, latest_content_id FROM public.permit_reports WHERE permit_id = $1`, [permitId])).rows[0];
  assert.equal(rep.content_status, "captured");
  assert.equal(rep.latest_content_id, v2.content_id);

  await asService(`SELECT public.record_permit_report_failure($1, 'review_comments', 'export failed')`, [permitId]);
  assert.equal((await db.query(`SELECT content_status FROM public.permit_reports WHERE permit_id = $1`, [permitId])).rows[0].content_status, "captured");

  await assert.rejects(db.query(`UPDATE public.permit_report_contents SET text_content = 'x'`), /append-only/);
  await assert.rejects(db.query(`DELETE FROM public.permit_report_contents`), /append-only/);
  await assert.rejects(asService(`UPDATE public.permit_report_contents SET text_content = 'x'`), /permission denied/);
});

test("only readers of the permit see report contents and their storage objects", async () => {
  assert.equal((await asUser(ids.reader, `SELECT count(*)::int AS n FROM public.permit_report_contents`))[0].n, 2);
  assert.equal((await asUser(ids.unrelated, `SELECT count(*)::int AS n FROM public.permit_report_contents`))[0].n, 0);
  await assert.rejects(asUser(ids.reader, `SELECT public.record_permit_report_content($1, 'review_comments', '{}'::jsonb)`, [permitId]), /permission denied/);
  await assert.rejects(asUser(ids.reader, `SELECT public.record_permit_document_capture($1, 'failed')`, [docs[0].id]), /permission denied/);

  const reportObj = `${permitId}/reports/review_comments/${SHA_A}.pdf`;
  const strayObj = `${permitId}/reports/review_comments/unrecorded.pdf`;
  const fileObj = `${permitId}/files/700101_A-101.pdf`;
  for (const name of [reportObj, strayObj, fileObj]) {
    await db.query(`INSERT INTO storage.objects (bucket_id, name) VALUES ('permit-documents', $1)`, [name]);
  }
  const visible = async (sub) => (await asUser(sub, `SELECT name FROM storage.objects WHERE bucket_id = 'permit-documents' ORDER BY name`)).map((r) => r.name);
  assert.deepEqual(await visible(ids.reader), [fileObj, reportObj].sort());
  assert.deepEqual(await visible(ids.unrelated), []);
});
