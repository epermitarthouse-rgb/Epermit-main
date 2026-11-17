"use strict";

/**
 * D-118 repair script on the real migration chain (PGlite), with synthetic text: it clears only false
 * "Updated on portal" marks (stored thread starts with the marked portal comment), refuses on an unexpected
 * count, writes one audit row per cleared row, and the documented rollback restores the marks.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { replay } = require("./helpers/replay-migrations");

const SCRIPT = fs.readFileSync(path.join(__dirname, "../../scripts/permit-repo/repairs/d118-false-portal-change-marks.sql"), "utf8");
const ROLLBACK = SCRIPT.split("\n")
  .filter((l) => l.startsWith("--   "))
  .map((l) => l.slice(5))
  .join("\n")
  .split("UPDATE public.parsed_comments pc")
  .slice(1)
  .map((s) => `UPDATE public.parsed_comments pc${s}`)[0];

const OWNER = "30000000-0000-4000-8000-000000000001";
const PROJECT = "ff193644-3e94-46d4-a1c0-4755fc65d0dd";
const PERMIT = "06fa082e-b942-4b54-b448-a1527f58df41";

const persisted = (ref, discussion) =>
  [`ref: ${ref}`, "cycle: 1", "reviewed_by: DOEE", "type: Comment", "filename: ", "full_discussion_text:", discussion, "status: Resolved", "source_report: Permit BCIV2500152", "date_time: "].join("\n");

async function seed(db, { realChanges = 0 } = {}) {
  await db.query(`INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES ($1, 'owner@test.invalid', '{}'::jsonb)`, [OWNER]);
  await db.query(`INSERT INTO public.projects (id, name, user_id) VALUES ($1, 'Test project', $2)`, [PROJECT, OWNER]);
  await db.query(`INSERT INTO public.permits (id, adapter_key, portal_record_id, permit_number) VALUES ($1, 'dc', '11105', 'BCIV2500152')`, [PERMIT]);
  for (let ref = 1; ref <= 6; ref++) {
    // Rows 1-3 carry an e-mail in the stored report text and a redaction in the repository text, as in production.
    const body = `Provide sheet ${ref} with the erosion control details.${ref <= 3 ? " Questions: [email]" : ""}`;
    const storedBody = ref <= 3 ? body.replace("[email]", "reviewer@example.invalid") : body;
    const thread = ref === 6 ? storedBody : `${storedBody}\nResponded by: Applicant 03/02/2026\nAdded in the resubmission.`;
    const real = ref <= realChanges;
    const latest = ref === 6 ? null : persisted(ref, real ? `Provide sheet ${ref} with revised stormwater details.` : body);
    await db.query(
      `INSERT INTO public.parsed_comments (project_id, original_text, status, ingest_source, response_text, comment_number,
         portal_permit_id, portal_comment_key, portal_latest_text, portal_changed_at)
       VALUES ($1, $2, 'Approved', 'raw_ref', 'Draft response', $3, $4, $5, $6, CASE WHEN $6::text IS NULL THEN NULL ELSE now() END)`,
      [PROJECT, persisted(ref, thread), String(ref), PERMIT, `ref:${ref}`, latest],
    );
  }
}

const counts = async (db) =>
  (await db.query(`SELECT count(*) FILTER (WHERE portal_changed_at IS NOT NULL)::int AS marked,
                          count(*) FILTER (WHERE portal_latest_text IS NOT NULL)::int AS latest,
                          md5(string_agg(original_text || coalesce(response_text, '') || status, '|' ORDER BY comment_number)) AS untouched
                   FROM public.parsed_comments WHERE project_id = $1`, [PROJECT])).rows[0];

test("clears the 5 false marks, audits them, leaves everything else, and rolls back", async () => {
  const { db } = await replay();
  await seed(db);
  const before = await counts(db);
  assert.equal(before.marked, 5);

  await db.exec(SCRIPT);
  const after = await counts(db);
  assert.equal(after.marked, 0);
  assert.equal(after.latest, 0);
  assert.equal(after.untouched, before.untouched, "text, responses and status unchanged");
  const audit = await db.query(`SELECT target_type, before_json ? 'portal_latest_text' AS has_prev FROM public.platform_audit_events WHERE action = 'pipeline.portal_mark_cleared'`);
  assert.equal(audit.rows.length, 5);
  assert.ok(audit.rows.every((r) => r.target_type === "parsed_comment" && r.has_prev));

  await db.exec(ROLLBACK);
  const restored = await counts(db);
  assert.equal(restored.marked, 5);
  assert.equal(restored.latest, 5);
});

test("refuses when a mark is a real change (count differs from the reviewed 5) and changes nothing", async () => {
  const { db } = await replay();
  await seed(db, { realChanges: 1 });
  await assert.rejects(db.exec(SCRIPT), /D-118 repair refused: 4 rows match, expected 5/);
  await db.exec("ROLLBACK");
  assert.equal((await db.query(`SELECT count(*)::int AS n FROM pg_proc WHERE proname = '_d118_loose'`)).rows[0].n, 0, "helper rolled back too");
  assert.equal((await counts(db)).marked, 5);
  assert.equal((await db.query(`SELECT count(*)::int AS n FROM public.platform_audit_events WHERE action = 'pipeline.portal_mark_cleared'`)).rows[0].n, 0);
});
