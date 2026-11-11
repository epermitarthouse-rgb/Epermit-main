"use strict";

/**
 * Real-SQL tests (PGlite / Postgres 16) for supabase/migrations/20261111100000_central_permit_repository.sql:
 * migration re-runnability, discovery, idempotent ingestion, change history, partial-extraction
 * protection, document metadata without downloads, and append-only evidence.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const { createPermitRepoDb } = require("./helpers/permit-repo-db");
const fx = require("./helpers/permit-repo-fixtures");

const OWNER = "00000000-0000-4000-8000-000000000001";
const CRED = "00000000-0000-4000-8000-0000000000c1";
const RUN1 = "00000000-0000-4000-8000-0000000000a1";
const RUN2 = "00000000-0000-4000-8000-0000000000a2";

async function setup() {
  const h = await createPermitRepoDb();
  await h.createUser(OWNER);
  await h.createCredential(CRED, OWNER);
  return h;
}

async function rows(h, sql, params = []) {
  return (await h.db.query(sql, params)).rows;
}

async function permitId(h, portalId) {
  return (await rows(h, `SELECT id FROM permits WHERE portal_record_id = $1`, [portalId]))[0].id;
}

test("migration is additive and re-runnable", async () => {
  const h = await setup();
  await h.db.exec(h.migrationSql);
  await h.db.exec(h.queueMigrationSql);
  await h.db.exec(h.migrationSql);
  await h.db.exec(h.queueMigrationSql);
  const t = await rows(h, `SELECT count(*)::int AS n FROM pg_tables WHERE schemaname = 'public' AND (tablename LIKE 'permit%' OR tablename = 'project_permits')`);
  assert.equal(t[0].n, 17);
  const rls = await rows(h, `SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND (c.relname LIKE 'permit%' OR c.relname = 'project_permits') AND NOT c.relrowsecurity`);
  assert.equal(rls[0].n, 0, "every new table has RLS enabled");
  const bucket = await rows(h, `SELECT public FROM storage.buckets WHERE id = 'permit-documents'`);
  assert.deepEqual(bucket, [{ public: false }]);
  const pre = await rows(h, `SELECT count(*)::int AS n FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'portal_credentials'`);
  assert.equal(pre[0].n, 5, "existing tables are not altered");
});

test("discovery: all 28 DC permits represented once; re-discovery is a no-op; duplicates rejected", async () => {
  const h = await setup();
  const first = await h.rpc("apply_permit_discovery", fx.discovery({ credentialId: CRED, runId: RUN1 }));
  assert.equal(first.seen, 28);
  assert.equal(first.created, 28);
  assert.equal(first.complete, true);
  assert.equal(await h.count("permits"), 28);
  assert.equal(await h.count("permit_source_links", "credential_id = $1", [CRED]), 28);
  const byStatus = await rows(h, `SELECT status, count(*)::int AS n FROM permits GROUP BY 1 ORDER BY 1`);
  assert.deepEqual(byStatus, [
    { status: "approved", n: 15 }, { status: "in_review", n: 4 }, { status: "resubmit", n: 3 }, { status: "upload", n: 6 },
  ]);
  const dupNumbers = await rows(h, `SELECT permit_number FROM permits GROUP BY 1 HAVING count(*) > 1`);
  assert.deepEqual(dupNumbers, []);

  const changesBefore = await h.count("permit_changes");
  const again = await h.rpc("apply_permit_discovery", fx.discovery({ credentialId: CRED, runId: RUN2 }));
  assert.equal(again.created, 0);
  assert.equal(again.changed, 0);
  assert.equal(await h.count("permits"), 28);
  assert.equal(await h.count("permit_changes"), changesBefore, "identical discovery writes no history");

  const recs = fx.inventoryRecords();
  await assert.rejects(
    h.rpc("apply_permit_discovery", { adapter_key: "dc-projectdox", credential_id: CRED, records: [recs[0], recs[0]] }),
    /duplicate portal_record_id/,
  );
  assert.equal(await h.count("permits"), 28, "rejected discovery rolled back");
});

test("discovery: incomplete or short listings never mark permits removed", async () => {
  const h = await setup();
  await h.rpc("apply_permit_discovery", fx.discovery({ credentialId: CRED }));
  const short = fx.inventoryRecords().slice(0, 20);

  const incomplete = await h.rpc("apply_permit_discovery", fx.discovery({ credentialId: CRED, records: short, complete: false }));
  assert.equal(incomplete.marked_removed, 0);
  const mismatch = await h.rpc("apply_permit_discovery", fx.discovery({ credentialId: CRED, records: short, expectedTotal: 28 }));
  assert.equal(mismatch.complete, false);
  assert.equal(mismatch.marked_removed, 0);
  assert.equal(await h.count("permits", "removed_from_portal_at IS NOT NULL"), 0);

  const shrunk = await h.rpc("apply_permit_discovery", fx.discovery({ credentialId: CRED, records: short, expectedTotal: 20 }));
  assert.equal(shrunk.complete, true);
  assert.equal(shrunk.marked_removed, 8);
  assert.equal(await h.count("permits"), 28, "removed permits are kept, only flagged");

  const back = await h.rpc("apply_permit_discovery", fx.discovery({ credentialId: CRED }));
  assert.equal(back.marked_removed, 0);
  assert.equal(await h.count("permits", "removed_from_portal_at IS NOT NULL"), 0, "reappearing permits are restored");
});

test("full batch: structured reviews, responses, tasks; identical re-import produces no changes or snapshots", async () => {
  const h = await setup();
  const r1 = await h.rpc("apply_permit_sync_batch", fx.resubmitBatch({ credentialId: CRED, runId: RUN1 }));
  assert.equal(r1.permit_created, true);
  assert.equal(r1.snapshots_inserted, 2);
  assert.equal(r1.sections.reviews.inserted, 6, "3 comments + 3 responses (ref 3 has two discussion entries)");
  const pid = r1.permit_id;

  const p = (await rows(h, `SELECT status, review_type, total_files, unresolved_comments, uncompleted_tasks, available_sections FROM permits WHERE id = $1`, [pid]))[0];
  assert.deepEqual(p, { status: "resubmit", review_type: "BIC Building", total_files: 40, unresolved_comments: 1, uncompleted_tasks: 1, available_sections: ["reviews", "status", "tasks"] });

  const comments = await rows(h, `SELECT portal_comment_key, status, reviewer_name, reviewer_role, to_char(reviewed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') AS at FROM permit_review_comments WHERE permit_id = $1 ORDER BY ref_number`, [pid]);
  assert.deepEqual(comments.map((c) => [c.portal_comment_key, c.status]), [["ref:3", "Unresolved"], ["ref:4", "Resolved"], ["ref:5", "Info Only"]]);
  assert.ok(comments.every((c) => c.reviewer_name === null && c.reviewer_role === "reviewer"));
  assert.equal(comments[1].at, "2025-09-15 12:37");
  const unresolved = await h.count("permit_review_comments", "permit_id = $1 AND status = 'Unresolved' AND removed_at IS NULL", [pid]);
  assert.equal(unresolved, p.unresolved_comments, "Reviews rows agree with status JSON");

  const resp = await rows(h, `SELECT r.portal_response_key, c.portal_comment_key FROM permit_review_responses r JOIN permit_review_comments c ON c.id = r.comment_id WHERE r.permit_id = $1`, [pid]);
  assert.deepEqual(resp.sort((a, b) => a.portal_response_key.localeCompare(b.portal_response_key)), [
    { portal_response_key: "ref:3:r1", portal_comment_key: "ref:3" },
    { portal_response_key: "ref:3:r2", portal_comment_key: "ref:3" },
    { portal_response_key: "ref:4:r1", portal_comment_key: "ref:4" },
  ]);
  const tasks = await rows(h, `SELECT portal_task_id, group_name, workflow_portal_id FROM permit_tasks WHERE permit_id = $1`, [pid]);
  assert.deepEqual(tasks, [{ portal_task_id: "423503", group_name: "Applicant", workflow_portal_id: "11975" }]);

  const changes = await h.count("permit_changes", "permit_id = $1", [pid]);
  const snaps = await h.count("permit_snapshots", "permit_id = $1", [pid]);
  const updatedAt = (await rows(h, `SELECT max(updated_at)::text AS u FROM permit_review_comments WHERE permit_id = $1`, [pid]))[0].u;

  const r2 = await h.rpc("apply_permit_sync_batch", fx.resubmitBatch({ credentialId: CRED, runId: RUN2, capturedAt: "2026-11-06T15:00:00Z" }));
  assert.equal(r2.permit_created, false);
  assert.equal(r2.changes, 0);
  assert.equal(r2.snapshots_inserted, 0);
  for (const s of Object.values(r2.sections)) {
    assert.equal(s.inserted + s.updated + s.removed + s.restored, 0);
  }
  assert.equal(await h.count("permit_changes", "permit_id = $1", [pid]), changes);
  assert.equal(await h.count("permit_snapshots", "permit_id = $1", [pid]), snaps);
  const after = await rows(h, `SELECT max(updated_at)::text AS u, max(last_seen_at)::text AS s FROM permit_review_comments WHERE permit_id = $1`, [pid]);
  assert.equal(after[0].u, updatedAt, "unchanged rows keep updated_at");
  assert.match(after[0].s, /^2026-11-06/, "last_seen_at advances");
  const link = await rows(h, `SELECT last_seen_run_id FROM permit_source_links WHERE permit_id = $1`, [pid]);
  assert.equal(link[0].last_seen_run_id, RUN2);
});

test("a real change is recorded once with before/after values", async () => {
  const h = await setup();
  await h.rpc("apply_permit_sync_batch", fx.resubmitBatch({ credentialId: CRED, runId: RUN1 }));
  const rowsChanged = fx.corrections.rows.map((r) => (r.ref === 3 ? { ...r, status: "Resolved", responses: [...r.responses, { by: "applicant", at: "2026-11-05T09:00:00", text: "Notification filed." }] } : r));
  const r = await h.rpc("apply_permit_sync_batch", fx.resubmitBatch({ credentialId: CRED, runId: RUN2, rows: rowsChanged }));
  assert.equal(r.sections.reviews.updated, 1);
  assert.equal(r.sections.reviews.inserted, 1);
  assert.equal(r.snapshots_inserted, 1, "only the changed section gets a new snapshot");
  const ch = await rows(h, `SELECT entity_table, entity_key, change_type, field_changes FROM permit_changes WHERE run_id = $1 ORDER BY entity_table`, [RUN2]);
  assert.equal(ch.length, 2);
  assert.equal(ch[0].entity_key, "ref:3");
  assert.equal(ch[0].change_type, "updated");
  assert.deepEqual(Object.keys(ch[0].field_changes).sort(), ["response_required", "status"]);
  assert.deepEqual(ch[0].field_changes.status, { before: "Unresolved", after: "Resolved" });
  assert.equal(ch[1].entity_key, "ref:3:r3");
  assert.equal(ch[1].change_type, "created");
});

test("failed, absent, partial and suspicious-empty extractions preserve existing rows", async () => {
  const h = await setup();
  await h.rpc("apply_permit_sync_batch", fx.resubmitBatch({ credentialId: CRED }));
  const pid = await permitId(h, "11854");
  const active = () => h.count("permit_review_comments", "permit_id = $1 AND removed_at IS NULL", [pid]);
  const perm = async () => (await rows(h, `SELECT status, total_files, unresolved_comments FROM permits WHERE id = $1`, [pid]))[0];
  const before = await perm();

  const failed = await h.rpc("apply_permit_sync_batch", fx.resubmitBatch({
    credentialId: CRED,
    overrides: {
      reviews: { status: "failed", sourceKind: "html", error: "selector not found" },
      status: { status: "failed", sourceKind: "json", fields: { status: null, total_files: 0, unresolved_comments: 0 }, error: "timeout" },
    },
  }));
  assert.equal(failed.sections.reviews.status, "failed");
  assert.equal(await active(), 3);
  assert.deepEqual(await perm(), before, "failed status section does not touch permit fields");
  let st = (await rows(h, `SELECT status, consecutive_failures, content_hash IS NOT NULL AS has_hash, last_error FROM permit_section_state WHERE permit_id = $1 AND section = 'reviews'`, [pid]))[0];
  assert.deepEqual(st, { status: "failed", consecutive_failures: 1, has_hash: true, last_error: "selector not found" });

  await h.rpc("apply_permit_sync_batch", fx.resubmitBatch({ credentialId: CRED, overrides: { reviews: { status: "absent", sourceKind: "html" } } }));
  assert.equal(await active(), 3);

  const empty = await h.rpc("apply_permit_sync_batch", fx.resubmitBatch({
    credentialId: CRED, overrides: { reviews: { status: "ok", sourceKind: "html", tables: { permit_review_comments: [], permit_review_responses: [] } } },
  }));
  assert.equal(empty.sections.reviews.status, "suspect_empty");
  assert.equal(await active(), 3);
  st = (await rows(h, `SELECT status, consecutive_failures FROM permit_section_state WHERE permit_id = $1 AND section = 'reviews'`, [pid]))[0];
  assert.deepEqual(st, { status: "suspect_empty", consecutive_failures: 1 });

  const oneRow = fx.resubmitBatch({ credentialId: CRED, rows: fx.corrections.rows.slice(0, 1) });
  const partial = await h.rpc("apply_permit_sync_batch", { ...oneRow, sections: { reviews: { ...oneRow.sections.reviews, status: "partial" } } });
  assert.equal(partial.sections.reviews.status, "partial");
  assert.equal(partial.sections.reviews.removed, 0);
  assert.equal(await active(), 3);

  const nullFields = await h.rpc("apply_permit_sync_batch", {
    adapter_key: "dc-projectdox", credential_id: CRED, permit: { portal_record_id: "11854", fields: { status: null, total_files: null } }, sections: {},
  });
  assert.equal(nullFields.changes, 0);
  assert.deepEqual(await perm(), before, "null fields never overwrite stored values");
});

test("an ok listing removes missing rows; reappearing rows are restored; confirmed empty clears", async () => {
  const h = await setup();
  await h.rpc("apply_permit_sync_batch", fx.resubmitBatch({ credentialId: CRED }));
  const pid = await permitId(h, "11854");

  const subset = await h.rpc("apply_permit_sync_batch", fx.resubmitBatch({ credentialId: CRED, rows: fx.corrections.rows.filter((r) => r.ref !== 5) }));
  assert.equal(subset.sections.reviews.removed, 1);
  assert.equal(await h.count("permit_review_comments", "permit_id = $1 AND removed_at IS NOT NULL", [pid]), 1);
  assert.equal(await h.count("permit_review_comments", "permit_id = $1", [pid]), 3, "removed rows are soft-deleted");

  const back = await h.rpc("apply_permit_sync_batch", fx.resubmitBatch({ credentialId: CRED }));
  assert.equal(back.sections.reviews.restored, 1);
  const types = await rows(h, `SELECT change_type FROM permit_changes WHERE permit_id = $1 AND entity_key = 'ref:5' ORDER BY detected_at, change_type`, [pid]);
  assert.deepEqual(types.map((t) => t.change_type).sort(), ["created", "removed", "restored"]);

  const cleared = await h.rpc("apply_permit_sync_batch", fx.resubmitBatch({
    credentialId: CRED,
    overrides: { reviews: { status: "ok", sourceKind: "html", confirmedEmpty: true, tables: { permit_review_comments: [], permit_review_responses: [] } } },
  }));
  assert.equal(cleared.sections.reviews.status, "ok");
  assert.equal(cleared.sections.reviews.removed, 6);
});

test("document metadata is stored when downloads are not permitted; download recording is refused", async () => {
  const h = await setup();
  const r = await h.rpc("apply_permit_sync_batch", fx.approvedFilesBatch({ credentialId: CRED }));
  assert.equal(r.sections.files.inserted, 6);
  const docs = await rows(h, `SELECT portal_file_id, version, download_permitted, download_status, storage_path FROM permit_documents WHERE permit_id = $1 ORDER BY portal_file_id`, [r.permit_id]);
  assert.deepEqual(docs, [
    { portal_file_id: "700101", version: 1, download_permitted: false, download_status: "not_permitted", storage_path: null },
    { portal_file_id: "700102", version: 2, download_permitted: false, download_status: "not_permitted", storage_path: null },
  ]);
  const folders = await rows(h, `SELECT sum(files_count)::int AS n FROM permit_document_folders WHERE permit_id = $1`, [r.permit_id]);
  assert.equal(folders[0].n, 92);

  const docId = (await rows(h, `SELECT id FROM permit_documents WHERE portal_file_id = '700101'`))[0].id;
  await assert.rejects(
    h.asService((tx) => tx.query(`SELECT public.record_permit_document_download($1, 'stored', $2, 'abc')`, [docId, `${r.permit_id}/700101.pdf`])),
    /download not permitted/,
  );

  const again = await h.rpc("apply_permit_sync_batch", fx.approvedFilesBatch({ credentialId: CRED, accountDownload: true }));
  assert.equal(again.sections.files.updated, 6);
  const st = await rows(h, `SELECT download_status FROM permit_documents WHERE permit_id = $1`, [r.permit_id]);
  assert.ok(st.every((d) => d.download_status === "not_requested"), "permission change re-opens download lifecycle");
  await assert.rejects(
    h.asService((tx) => tx.query(`SELECT public.record_permit_document_download($1, 'stored', 'other/700101.pdf', 'abc')`, [docId])),
    /storage path must start with the permit id/,
  );
  await h.asService((tx) => tx.query(`SELECT public.record_permit_document_download($1, 'stored', $2, 'abc')`, [docId, `${r.permit_id}/700101.pdf`]));
  const stored = await rows(h, `SELECT download_status FROM permit_documents WHERE id = $1`, [docId]);
  assert.equal(stored[0].download_status, "stored");
});

test("batches are validated and rejected atomically", async () => {
  const h = await setup();
  const good = fx.resubmitBatch({ credentialId: CRED });
  const cases = [
    [{ ...good, sections: { ...good.sections, bogus: { status: "ok" } } }, /unknown section/],
    [{ ...good, sections: { reviews: { status: "ok", tables: { permit_tasks: [] } } } }, /not part of section/],
    [{ ...good, sections: { reviews: { status: "weird" } } }, /invalid status/],
    [{ ...good, sections: { files: { status: "ok", tables: { permit_documents: [{ key: "1", hash: "h", fields: { storage_path: "x" } }] } } } }, /not writable/],
    [{ ...good, sections: { files: { status: "ok", tables: { permit_documents: [{ key: "1", hash: "h", fields: { download_status: "stored" } }] } } } }, /not writable/],
    [{ ...good, sections: { reviews: { status: "ok", tables: { permit_review_comments: [{ key: "a", fields: {} }, { key: "a", fields: {} }] } } } }, /duplicate key/],
    [{ ...good, permit: { portal_record_id: "11854", fields: { adapter_key: "other" } } }, /not writable/],
  ];
  for (const [batch, re] of cases) {
    await assert.rejects(h.rpc("apply_permit_sync_batch", batch), re);
  }
  assert.equal(await h.count("permits"), 0, "nothing written by rejected batches");
  assert.equal(await h.count("permit_changes"), 0);
});

test("snapshots and change history are append-only; permits with evidence cannot be deleted", async () => {
  const h = await setup();
  const r = await h.rpc("apply_permit_sync_batch", fx.resubmitBatch({ credentialId: CRED }));
  const snap = (await rows(h, `SELECT payload::text AS p FROM permit_snapshots WHERE permit_id = $1 AND section = 'reviews'`, [r.permit_id]))[0].p;
  assert.ok(!/@|eyJ/.test(snap), "snapshots are redacted");

  await assert.rejects(h.db.query(`UPDATE permit_changes SET change_type = 'updated'`), /append-only/);
  await assert.rejects(h.db.query(`DELETE FROM permit_snapshots`), /append-only/);
  await assert.rejects(h.asService((tx) => tx.query(`DELETE FROM permit_changes`)), /append-only|permission denied/);
  await assert.rejects(h.asService((tx) => tx.query(`TRUNCATE permit_changes`)), /permission denied/);
  await assert.rejects(h.db.query(`TRUNCATE permit_snapshots CASCADE`), /append-only/, "owner TRUNCATE is blocked too");
  await assert.rejects(h.db.query(`TRUNCATE permit_changes`), /append-only/);
  await assert.rejects(h.db.query(`DELETE FROM permits WHERE id = $1`, [r.permit_id]), /append-only|violates foreign key/);
  assert.equal(await h.count("permits"), 1);
});

test("deleting the source credential keeps permits and their evidence; evidence stays append-only", async () => {
  const h = await setup();
  const r = await h.rpc("apply_permit_sync_batch", fx.resubmitBatch({ credentialId: CRED }));
  const snapshots = await h.count("permit_snapshots");
  const changes = await h.count("permit_changes");
  assert.ok(snapshots > 0 && changes > 0);

  await h.db.query(`GRANT ALL ON public.portal_credentials TO service_role`);
  await h.asService((tx) => tx.query(`DELETE FROM portal_credentials WHERE id = $1`, [CRED]));
  assert.equal(await h.count("permit_source_links", "credential_id = $1", [CRED]), 0);
  assert.equal(await h.count("permits"), 1);
  assert.equal(await h.count("permit_snapshots"), snapshots);
  assert.equal(await h.count("permit_changes"), changes);

  await assert.rejects(h.db.query(`DELETE FROM permit_snapshots`), /append-only/);
  await assert.rejects(h.db.query(`UPDATE permit_changes SET change_type = 'updated'`), /append-only/);
  await assert.rejects(h.db.query(`TRUNCATE permit_changes`), /append-only/);
  await h.db.exec(`
    CREATE TABLE nested_probe (id int);
    CREATE FUNCTION nested_probe_fn() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN DELETE FROM permit_snapshots; RETURN NEW; END $$;
    CREATE TRIGGER nested_probe_t AFTER INSERT ON nested_probe FOR EACH ROW EXECUTE FUNCTION nested_probe_fn();
  `);
  await assert.rejects(h.db.query(`INSERT INTO nested_probe VALUES (1)`), /append-only/, "nested deletes do not open evidence");
  await assert.rejects(h.db.query(`DELETE FROM permits WHERE id = $1`, [r.permit_id]), /append-only|violates foreign key/);
});
