// Run: node --import tsx --test supabase/functions/_shared/permitRepositorySource.test.ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadRepositorySource, refreshFromRepository, type ServiceClient } from "./permitRepositorySource.ts";

type Row = Record<string, unknown>;

/** Minimal in-memory stand-in for the supabase-js query builder (select/update/insert with eq/in/is). */
function fakeClient(tables: Record<string, Row[]>, readable: Set<string>) {
  const writes: Array<{ op: string; table: string; payload: unknown }> = [];
  const client: ServiceClient = {
    rpc: (fn, args) => {
      assert.equal(fn, "user_can_read_permit");
      return Promise.resolve({ data: readable.has(`${args.p_user_id}:${args.p_permit_id}`), error: null });
    },
    from: (table: string) => {
      const filters: Array<(r: Row) => boolean> = [];
      let op: { kind: "select" } | { kind: "update"; patch: Row } = { kind: "select" };
      const builder = {
        select: () => builder,
        eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), builder),
        in: (c: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[c])), builder),
        is: (c: string, v: unknown) => (filters.push((r) => (r[c] ?? null) === v), builder),
        update: (patch: Row) => ((op = { kind: "update", patch }), builder),
        insert: (rows: Row[]) => {
          writes.push({ op: "insert", table, payload: rows });
          (tables[table] ??= []).push(...rows.map((r, i) => ({ id: `new-${i}`, ...r })));
          return Promise.resolve({ data: null, error: null });
        },
        then: (resolve: (v: unknown) => void) => {
          const rows = (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
          if (op.kind === "update") {
            const patch = op.patch;
            for (const r of rows) Object.assign(r, patch);
            writes.push({ op: "update", table, payload: { ids: rows.map((r) => r.id), patch } });
            return resolve({ data: null, error: null });
          }
          return resolve({ data: rows.map((r) => ({ ...r })), error: null });
        },
      };
      return builder;
    },
  };
  return { client, writes };
}

const USER = "owner-1";
const P1 = "permit-1";
const P2 = "permit-2";
const PROJECT = "project-1";

function baseTables(): Record<string, Row[]> {
  return {
    project_permits: [
      { project_id: PROJECT, permit_id: P1 },
      { project_id: PROJECT, permit_id: P2 },
    ],
    permits: [
      { id: P1, permit_number: "BCIV2500152" },
      { id: P2, permit_number: "B9999" },
    ],
    permit_section_state: [{ permit_id: P1, section: "reviews", status: "ok" }],
    permit_review_comments: [
      { permit_id: P1, portal_comment_key: "ref:1", ref_number: 1, cycle: 1, department: "DOEE", comment_type: "Comment", file_name: null, body: "One", status: "Resolved", reviewed_at: null, removed_at: null },
      { permit_id: P1, portal_comment_key: "ref:2", ref_number: 2, cycle: 1, department: "DOEE", comment_type: "Comment", file_name: null, body: "Gone", status: "Resolved", reviewed_at: null, removed_at: "2026-11-01T00:00:00Z" },
      { permit_id: P2, portal_comment_key: "ref:1", ref_number: 1, cycle: 1, department: "DOB", comment_type: "Comment", file_name: null, body: "Secret", status: "Unresolved", reviewed_at: null, removed_at: null },
    ],
    parsed_comments: [],
  };
}

describe("permit repository source", () => {
  it("only permits the acting user can read contribute; removed portal comments are skipped", async () => {
    const { client } = fakeClient(baseTables(), new Set([`${USER}:${P1}`]));
    const source = await loadRepositorySource(client, PROJECT, USER);
    assert.deepEqual(source.linkedPermitIds, [P1, P2]);
    assert.deepEqual(source.permits, [{ id: P1, permit_number: "BCIV2500152", reviews_complete: true }]);
    assert.deepEqual(source.comments.map((c) => c.portal_comment_key), ["ref:1"]);
  });

  it("no readable permit yields no comments", async () => {
    const { client } = fakeClient(baseTables(), new Set());
    const source = await loadRepositorySource(client, PROJECT, USER);
    assert.equal(source.permits.length, 0);
    assert.equal(source.comments.length, 0);
  });

  it("refresh inserts new comments and never issues a delete", async () => {
    const tables = baseTables();
    const { client, writes } = fakeClient(tables, new Set([`${USER}:${P1}`]));
    const result = await refreshFromRepository(client, PROJECT, USER, "2026-11-17T00:00:00Z");
    assert.equal(result.stats.inserted, 1);
    assert.equal(result.final_portal_count, 1);
    assert.equal(tables.parsed_comments.length, 1);
    assert.equal(tables.parsed_comments[0].portal_permit_id, P1);
    assert.ok(writes.every((w) => w.op !== "delete"));

    const again = await refreshFromRepository(client, PROJECT, USER, "2026-11-18T00:00:00Z");
    assert.equal(again.stats.inserted, 0);
    assert.equal(again.stats.updated, 0, "a second run over unchanged comments writes nothing");
  });

  it("loads each comment's response count and uses it end to end on a report-thread row", async () => {
    const tables = baseTables();
    const body = "Provide the plan sheet. Show the inlet protection.";
    tables.permit_review_comments[0].body = body;
    tables.permit_review_responses = [
      { permit_id: P1, comment_key: "ref:1", removed_at: null },
      { permit_id: P1, comment_key: "ref:1", removed_at: "2026-11-01T00:00:00Z" },
    ];
    tables.parsed_comments = [
      {
        id: "row-1",
        project_id: PROJECT,
        ingest_source: "raw_ref",
        status: "Approved",
        comment_number: null,
        response_text: "Draft",
        original_text: `ref: 1\nfull_discussion_text:\n${body}\nResponse by: Applicant - 3/2/2026 9:15 AM\nAdded.\nstatus: Resolved`,
      },
    ];
    const { client } = fakeClient(tables, new Set([`${USER}:${P1}`]));
    const source = await loadRepositorySource(client, PROJECT, USER);
    assert.equal(source.comments[0].response_count, 1, "removed responses are not counted");

    const first = await refreshFromRepository(client, PROJECT, USER, "2026-11-17T00:00:00Z");
    assert.equal(first.stats.text_change_flagged, 0);
    assert.equal(tables.parsed_comments[0].portal_changed_at ?? null, null);

    tables.permit_review_comments[0].body = "Provide the plan sheet.";
    const second = await refreshFromRepository(client, PROJECT, USER, "2026-11-18T00:00:00Z");
    assert.equal(second.stats.text_change_flagged, 1, "a shortened comment is a real edit");
    assert.equal(tables.parsed_comments[0].original_text, `ref: 1\nfull_discussion_text:\n${body}\nResponse by: Applicant - 3/2/2026 9:15 AM\nAdded.\nstatus: Resolved`);
    assert.ok(tables.parsed_comments[0].portal_latest_text);

    const third = await refreshFromRepository(client, PROJECT, USER, "2026-11-19T00:00:00Z");
    assert.equal(third.stats.updated, 0, "idempotent");
  });
});
