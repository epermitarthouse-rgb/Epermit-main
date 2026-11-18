// Run: node --import tsx --test supabase/functions/_shared/commentProcessingStatus.test.ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CLASSIFIER_ELIGIBLE_OR_FILTERS,
  DEFAULT_ASSIGNEE,
  classifierRowUpdates,
  planRouting,
  reconcileRows,
  runClassifierLoop,
  type RouterRow,
} from "./commentProcessingStatus.ts";
import { MAX_COMMENT_ATTEMPTS, parseClassifications, type Classification } from "./commentPrompts.ts";

type Row = {
  id: string;
  original_text: string;
  discipline: string | null;
  ingest_source: string | null;
  status: string | null;
  discipline_source: string | null;
  processing_status: string | null;
  processing_attempts: number;
  assigned_to: string | null;
  assigned_to_source: string | null;
};

// Minimal evaluator of the PostgREST `or=(...)` syntax the agent sends, so the tests exercise the real filter
// strings rather than a re-implementation.
function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}
function term(row: Record<string, unknown>, t: string): boolean {
  const and = t.match(/^and\((.*)\)$/);
  if (and) return splitTop(and[1]).every((x) => term(row, x));
  const [col, op, ...rest] = t.split(".");
  const val = rest.join(".");
  const v = row[col];
  if (op === "is" && val === "null") return v == null;
  // SQL three-valued logic: comparisons with NULL are not true.
  if (op === "eq") return v != null && String(v) === val;
  if (op === "neq") return v != null && String(v) !== val;
  throw new Error(`unsupported filter ${t}`);
}
const matchesOr = (row: Record<string, unknown>, filter: string) => splitTop(filter).some((t) => term(row, t));
const eligible = (row: Row) => CLASSIFIER_ELIGIBLE_OR_FILTERS.every((f) => matchesOr(row, f));

function dataset(n: number): Row[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `c${String(i).padStart(4, "0")}`,
    original_text: `Comment ${i}: provide details per IBC 1605.${i % 9}.`,
    discipline: null,
    ingest_source: "raw_ref",
    status: i % 3 === 0 ? "Approved" : "Open",
    discipline_source: null,
    processing_status: null,
    processing_attempts: 0,
    assigned_to: null,
    assigned_to_source: null,
  }));
}

/** Fake model: classifies every row except those listed in `skip` (never answers for them). */
function fakeModel(skip: Set<string> = new Set()) {
  let calls = 0;
  const classify = async (chunk: Row[]) => {
    calls++;
    const list = chunk
      .map((r, index) => ({ r, index }))
      .filter(({ r }) => !skip.has(r.id))
      .map(({ index }) => ({ index, discipline: index % 2 ? "Structural" : "Civil", confidence_score: 0.9 }));
    return parseClassifications(JSON.stringify({ classifications: list }), chunk.length);
  };
  return { classify, calls: () => calls };
}

function store(rows: Row[]) {
  const byId = new Map(rows.map((r) => [r.id, r]));
  return {
    fetchEligible: async (limit: number) => rows.filter(eligible).slice(0, limit).map((r) => ({ ...r })),
    write: async (u: { id: string; patch: Record<string, unknown> }) => {
      Object.assign(byId.get(u.id)!, u.patch);
      return true;
    },
  };
}

const loop = (rows: Row[], classify: (c: Row[]) => Promise<Map<number, Classification> | null>, extra: Record<string, unknown> = {}) => {
  const s = store(rows);
  return runClassifierLoop({ ...s, classify, chunkSize: 45, deadline: Number.POSITIVE_INFINITY, reserveMs: 0, ...extra });
};

describe("project classifier loop: no 50-comment cap (D-130)", () => {
  for (const n of [6, 53, 59, 81, 200]) {
    it(`classifies all ${n} comments in one invocation, in ceil(n/45) model calls`, async () => {
      const rows = dataset(n);
      const m = fakeModel();
      const r = await loop(rows, m.classify);
      assert.equal(r.classified, n);
      assert.equal(r.stopped, "done");
      assert.equal(m.calls(), Math.ceil(n / 45));
      assert.ok(rows.every((x) => x.discipline && x.discipline_source === "project_ai" && x.processing_status === "pending"));
      assert.equal(rows.filter(eligible).length, 0);
    });
  }

  it("resumes across invocations when the time budget runs out, never re-sending finished rows", async () => {
    const rows = dataset(81);
    const m = fakeModel();
    let t = 0;
    const now = () => t;
    const classify = async (c: Row[]) => {
      t += 30;
      return m.classify(c);
    };
    const first = await loop(rows, classify, { now, deadline: 50, reserveMs: 25 });
    assert.equal(first.stopped, "time");
    assert.equal(first.classified, 45);
    const second = await loop(rows, classify, { now, deadline: t + 50, reserveMs: 25 });
    assert.equal(second.classified, 36);
    assert.equal(m.calls(), 2, "81 rows, two calls in total: nothing is sent twice");
    assert.equal(rows.filter((x) => x.discipline).length, 81);
  });

  it("a row the model keeps skipping is retried, then set aside as needs_attention (the loop ends)", async () => {
    const rows = dataset(59);
    const m = fakeModel(new Set(["c0007", "c0050"]));
    const r = await loop(rows, m.classify);
    assert.equal(r.classified, 57);
    assert.equal(r.needs_attention, 2);
    assert.equal(r.failed, 2 * (MAX_COMMENT_ATTEMPTS - 1));
    for (const id of ["c0007", "c0050"]) {
      const row = rows.find((x) => x.id === id)!;
      assert.equal(row.discipline, null, "never finalised without a classification");
      assert.equal(row.processing_status, "needs_attention");
      assert.equal(row.processing_attempts, MAX_COMMENT_ATTEMPTS);
    }
  });

  it("invalid model output counts an attempt for every row of the chunk instead of finalising any", async () => {
    const rows = dataset(6);
    const r = await loop(rows, async () => null, { rowCap: 6 });
    assert.equal(r.classified, 0);
    assert.equal(r.failed, 6);
    assert.ok(rows.every((x) => x.processing_status === "failed" && x.processing_error === "invalid model output"));
  });

  it("eligibility skips rows a person classified, set-aside rows, and Approved non-portal rows", () => {
    const base = dataset(1)[0];
    assert.equal(eligible(base), true);
    assert.equal(eligible({ ...base, discipline_source: "human" }), false);
    assert.equal(eligible({ ...base, processing_status: "needs_attention" }), false);
    assert.equal(eligible({ ...base, processing_status: "failed" }), true);
    assert.equal(eligible({ ...base, discipline: "General" }), true);
    assert.equal(eligible({ ...base, discipline: "Civil" }), false);
    assert.equal(eligible({ ...base, ingest_source: "upload", status: "Approved" }), false);
    assert.equal(eligible({ ...base, ingest_source: "upload", status: "Open" }), true);
  });

  it("a write failure stops the loop instead of paying for the same chunk again", async () => {
    const rows = dataset(53);
    const m = fakeModel();
    const r = await runClassifierLoop({
      fetchEligible: async (limit) => rows.slice(0, limit),
      classify: m.classify,
      write: async () => false,
      chunkSize: 45,
      deadline: Number.POSITIVE_INFINITY,
      reserveMs: 0,
    });
    assert.equal(r.stopped, "write_failed");
    assert.equal(m.calls(), 1);
  });
});

describe("router: never finalises an unclassified row (D-130)", () => {
  const row = (over: Partial<RouterRow>): RouterRow => ({ id: "r", discipline: null, assigned_to: null, assigned_to_source: null, processing_status: null, ...over });

  it("routes classified rows, leaves unclassified ones pending and unassigned", () => {
    const plan = planRouting([
      row({ id: "a", discipline: "Structural" }),
      row({ id: "b", discipline: null }),
      row({ id: "c", discipline: "General" }),
      row({ id: "d", discipline: "Administrative" }),
    ]);
    const byId = Object.fromEntries(plan.updates.map((u) => [u.id, u.patch]));
    assert.equal(byId.a.assigned_to, "Structural Engineer");
    assert.equal(byId.a.assigned_to_source, "project_ai");
    assert.equal(byId.a.processing_status, "processed");
    assert.deepEqual(byId.b, { processing_status: "pending" });
    assert.deepEqual(byId.c, { processing_status: "pending" });
    assert.equal(byId.d.assigned_to, DEFAULT_ASSIGNEE);
    assert.equal(plan.routed, 2);
    assert.equal(plan.unclassified, 2);
  });

  it("re-routes its own label when the discipline changed; never touches a person's or a legacy assignment", () => {
    const plan = planRouting([
      row({ id: "own", discipline: "Civil", assigned_to: "Project Manager", assigned_to_source: "project_ai", processing_status: "processed" }),
      row({ id: "same", discipline: "Civil", assigned_to: "Civil Engineer", assigned_to_source: "project_ai", processing_status: "processed" }),
      row({ id: "human", discipline: "Civil", assigned_to: "Jane", assigned_to_source: "human" }),
      row({ id: "cleared", discipline: "Civil", assigned_to: null, assigned_to_source: "human" }),
      row({ id: "legacy", discipline: "Civil", assigned_to: "Project Manager", assigned_to_source: null }),
      row({ id: "aside", discipline: null, processing_status: "needs_attention" }),
    ]);
    assert.deepEqual(plan.updates.map((u) => u.id), ["own"]);
    assert.equal(plan.updates[0].patch.assigned_to, "Civil Engineer");
    assert.equal(plan.needs_attention, 1);
  });

  it("reconciliation puts every row in exactly one bucket", () => {
    const rows = [
      { processing_status: "processed" },
      { processing_status: "pending" },
      { processing_status: "failed" },
      { processing_status: "needs_attention" },
      { processing_status: null },
    ];
    const r = reconcileRows(rows);
    assert.equal(r.total, r.processed + r.pending + r.failed + r.needs_attention + r.untracked);
    assert.deepEqual(r, { total: 5, processed: 1, pending: 1, failed: 1, needs_attention: 1, untracked: 1 });
  });
});

describe("classifierRowUpdates", () => {
  it("marks classified rows project_ai and counts attempts for skipped ones", () => {
    const parsed = parseClassifications(JSON.stringify({ classifications: [{ index: 0, discipline: "Fire", confidence_score: 0.8 }] }), 2);
    const u = classifierRowUpdates([{ id: "x" }, { id: "y", processing_attempts: 2 }], parsed);
    assert.deepEqual(u[0].patch, { discipline: "Fire", discipline_source: "project_ai", processing_status: "pending", processing_error: null });
    assert.deepEqual(u[1].patch, { processing_attempts: 3, processing_status: "needs_attention", processing_error: "not classified by the model" });
  });
});
