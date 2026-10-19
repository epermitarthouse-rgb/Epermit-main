"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const {
  createMemoryBackend,
  createMemoryDrawingStore,
  createGuardedDrawingStore,
  recordToRow,
} = require("../lib/drawingRagStore.js");
const { rehydrateDrawingIndex, evidenceIndexForRun, clearRunEvidenceIndex } = require("../lib/prepareSheetEvidence.js");
const { createDrawingIndex, hybridRetrieveDrawings } = require("../../scraper-service/app/services/compliance/rag/drawingIndex.js");

describe("drawing evidence store", () => {
  it("rehydrates after a restart and keeps projects apart", async () => {
    const backend = createMemoryBackend();
    const first = createMemoryDrawingStore(backend);
    const record = {
      projectId: "proj-a",
      documentId: "doc-a",
      sheetId: "sheet-a",
      fileName: "A-1.00-00.pdf",
      sheetNumber: "A-1.00",
      text: "— 1H — ONE HOUR FIRE RATED WALLS",
      revision: "5",
      pageNumber: 1,
      identifiers: ["A-1.00"],
      references: ["A-6.01"],
      regions: [{ x: 10, y: 20, width: 30, height: 8, imageBase64: "do-not-store" }],
    };
    await first.upsertRecords([record]);
    await first.upsertRecords([record]);
    const active = [...backend.rows.values()].filter((row) => row.project_id === "proj-a" && !row.superseded);
    assert.equal(active.length, 1);
    assert.equal(active[0].id, [...backend.rows.values()][0].id);
    assert.equal(active[0].region.imageBase64, undefined);
    assert.equal(active[0].embedding, null);

    await first.upsertRecords([{ ...record, text: "revision 6 — 1H — ONE HOUR FIRE RATED WALLS", revision: "6" }]);
    const current = await first.listActive("proj-a");
    assert.equal(current.length, 1);
    assert.equal(current[0].revision, "6");
    assert.match(current[0].chunk_text, /ONE HOUR/);

    const restarted = createMemoryDrawingStore(backend);
    const index = createDrawingIndex();
    for (const row of await restarted.listActive("proj-a")) index.upsert(restarted.rowToRecord(row));
    const hits = hybridRetrieveDrawings(index, { topics: ["one hour"], currentSheetId: "other-sheet" });
    assert.equal(hits.length, 1);
    assert.match(hits[0].quote, /ONE HOUR/);
    assert.equal(hits[0].provesRequirementSatisfied, false);

    await restarted.upsertRecords([
      { projectId: "proj-b", fileName: "A-1.00-00.pdf", text: "other project secret", revision: "1", pageNumber: 1 },
    ]);
    const isolated = await restarted.listActive("proj-a");
    assert.ok(isolated.every((row) => row.project_id === "proj-a"));
    assert.equal(isolated.some((row) => String(row.chunk_text).includes("secret")), false);
  });

  it("does not call Supabase when persistence is disabled", async () => {
    let calls = 0;
    const supabase = {
      from() {
        calls += 1;
        throw new Error("production client should not be used");
      },
    };
    const store = createGuardedDrawingStore(supabase);
    const result = await store.upsertRecords([{ projectId: "proj-a", text: "A-1.00", fileName: "A-1.00.pdf" }]);
    assert.equal(result.persisted, false);
    assert.equal(result.liveSupabase, false);
    assert.equal(calls, 0);
    assert.deepEqual(await store.listActive("proj-a"), []);
  });

  it("does not write when the table is missing", async () => {
    const previous = process.env.CODE_ANALYZER_DRAWING_RAG_PERSIST;
    process.env.CODE_ANALYZER_DRAWING_RAG_PERSIST = "1";
    let writes = 0;
    const supabase = {
      from() {
        return {
          select() {
            return this;
          },
          limit() {
            return { error: { code: "PGRST205", message: "Could not find the table code_analyzer_drawing_chunks" } };
          },
          upsert() {
            writes += 1;
            return { error: null };
          },
        };
      },
    };
    try {
      const store = createGuardedDrawingStore(supabase);
      const result = await store.upsertRecords([
        { projectId: "proj-a", fileName: "A-1.00.pdf", text: "1 HR", pageNumber: 1 },
      ]);
      assert.equal(result.persisted, false);
      assert.equal(result.reason, "table_unavailable");
      assert.equal(writes, 0);
      assert.deepEqual(await store.listActive("proj-a"), []);
    } finally {
      if (previous === undefined) delete process.env.CODE_ANALYZER_DRAWING_RAG_PERSIST;
      else process.env.CODE_ANALYZER_DRAWING_RAG_PERSIST = previous;
    }
  });

  it("writes, retrieves, and recovers through a fake supabase client", async () => {
    const previous = process.env.CODE_ANALYZER_DRAWING_RAG_PERSIST;
    process.env.CODE_ANALYZER_DRAWING_RAG_PERSIST = "1";
    const rows = new Map();
    function builder() {
      const state = { filters: [], patch: null, op: "select" };
      const api = {
        select() {
          state.op = "select";
          return api;
        },
        limit() {
          return { data: [], error: null };
        },
        upsert(payload) {
          for (const row of payload) rows.set(`${row.project_id}:${row.chunk_key}`, { ...row, id: "row-1" });
          return { error: null };
        },
        update(patch) {
          state.patch = patch;
          state.op = "update";
          return api;
        },
        eq(column, value) {
          state.filters.push([column, value]);
          return api;
        },
        neq() {
          return api;
        },
        is() {
          return api;
        },
        then(resolve, reject) {
          try {
            if (state.op === "update") {
              resolve({ error: null });
              return;
            }
            const project = state.filters.find((filter) => filter[0] === "project_id");
            const data = [...rows.values()].filter((row) => !project || row.project_id === project[1]);
            resolve({ data, error: null });
          } catch (err) {
            reject(err);
          }
        },
      };
      return api;
    }
    const supabase = { from: builder };
    try {
      const first = createGuardedDrawingStore(supabase);
      const written = await first.upsertRecords([
        {
          projectId: "11111111-1111-4111-8111-111111111111",
          fileName: "life-safety-plan.pdf",
          sheetNumber: "LS-1",
          text: "EXIT ACCESS CORRIDOR 44 IN CLEAR",
          pageNumber: 1,
          revision: "2",
        },
      ]);
      assert.equal(written.persisted, true);
      assert.equal(written.liveSupabase, true);
      assert.equal(rows.size, 1);
      await first.upsertRecords([
        {
          projectId: "11111111-1111-4111-8111-111111111111",
          fileName: "life-safety-plan.pdf",
          sheetNumber: "LS-1",
          text: "EXIT ACCESS CORRIDOR 44 IN CLEAR",
          pageNumber: 1,
          revision: "2",
        },
      ]);
      assert.equal(rows.size, 1);

      const restarted = createGuardedDrawingStore(supabase);
      clearRunEvidenceIndex("restart-run");
      const hydrated = await rehydrateDrawingIndex(
        "restart-run",
        "11111111-1111-4111-8111-111111111111",
        restarted,
      );
      assert.equal(hydrated.error, undefined);
      assert.equal(hydrated.rehydrated, 1);
      const hits = hybridRetrieveDrawings(evidenceIndexForRun("restart-run"), {
        topics: ["corridor"],
        currentSheetId: "other-sheet",
      });
      assert.equal(hits.length, 1);
      assert.match(hits[0].quote, /44 IN CLEAR/);
      const otherProject = await restarted.listActive("22222222-2222-4222-8222-222222222222");
      assert.equal(otherProject.length, 0);
    } finally {
      clearRunEvidenceIndex("restart-run");
      if (previous === undefined) delete process.env.CODE_ANALYZER_DRAWING_RAG_PERSIST;
      else process.env.CODE_ANALYZER_DRAWING_RAG_PERSIST = previous;
    }
  });

  it("reports a failed write when persistence is enabled", async () => {
    const previous = process.env.CODE_ANALYZER_DRAWING_RAG_PERSIST;
    process.env.CODE_ANALYZER_DRAWING_RAG_PERSIST = " 1 ";
    const logs = [];
    const supabase = {
      from() {
        return {
          select() {
            return this;
          },
          limit() {
            return { error: null };
          },
          upsert() {
            return { error: { code: "23514", message: "drawing chunk check failed" } };
          },
        };
      },
    };
    try {
      const store = createGuardedDrawingStore(supabase, {
        logger: (message, extra) => logs.push({ message, extra }),
      });
      const result = await store.upsertRecords([
        { projectId: "proj-a", fileName: "plan.pdf", text: "corridor", pageNumber: 1 },
      ]);
      assert.equal(result.persisted, false);
      assert.equal(result.reason, "write_failed");
      assert.equal(result.reported, true);
      assert.equal(result.code, "23514");
      assert.equal(logs.length, 1);
      assert.equal(logs[0].extra.reason, "write_failed");
    } finally {
      if (previous === undefined) delete process.env.CODE_ANALYZER_DRAWING_RAG_PERSIST;
      else process.env.CODE_ANALYZER_DRAWING_RAG_PERSIST = previous;
    }
  });

  it("reuses stored embeddings for unchanged chunks and re-embeds changed text", async () => {
    const backend = createMemoryBackend();
    let embedded = 0;
    const embedTexts = async (texts) => {
      embedded += texts.length;
      return texts.map(() => Array.from({ length: 1536 }, () => 0.01));
    };
    const store = createMemoryDrawingStore(backend, { embedTexts });
    const record = {
      projectId: "proj-a",
      documentId: "doc-a",
      sheetId: "sheet-a",
      fileName: "M-1.1.pdf",
      pageNumber: 1,
      text: "DUCTWORK SHALL BE GALVANIZED STEEL. FIRE DAMPER AT RATED WALL.",
    };
    const first = await store.upsertRecords([record]);
    const afterFirst = embedded;
    assert.ok(afterFirst > 0);
    assert.equal(first.reusedEmbeddings, 0);
    const second = await store.upsertRecords([record]);
    assert.equal(embedded, afterFirst);
    assert.equal(second.reusedEmbeddings, second.count);
    assert.equal(second.embeddingStatus, "present");
    await store.upsertRecords([{ ...record, text: "DUCTWORK SHALL BE ALUMINUM. FIRE DAMPER AT RATED WALL." }]);
    assert.ok(embedded > afterFirst);
  });

  it("keeps exact rows when no embedding is present", () => {
    const row = recordToRow({
      projectId: "proj-a",
      fileName: "A-3.02-00.pdf",
      sheetNumber: "A-3.02",
      text: "WALL SECTION",
      pageNumber: 1,
    });
    assert.equal(row.embedding, null);
    assert.equal(row.superseded, false);
    assert.ok(row.chunk_key.includes("A-3.02"));
    assert.ok(row.chunk_text.length < 24000);
    assert.equal(row.metadata.embeddingStatus, "missing");
  });

  it("stores bounded chunks, injected embeddings, and keeps projects apart", async () => {
    const backend = createMemoryBackend();
    const embedTexts = async (texts) => texts.map(() => Array.from({ length: 1536 }, () => 0.02));
    const store = createMemoryDrawingStore(backend, { embedTexts });
    const filler = "GENERAL NOTE WIDTH SYMBOL LEGEND ".repeat(40);
    const text = `${filler} PIPE INSULATION SHALL BE 1 INCH. SEE SHEET S-3.01 FOR THE SCHEDULE. ${filler} WATER HAMMER ARRESTER AT THE FIXTURE.`;
    const projectA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const projectB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const record = {
      projectId: projectA,
      documentId: "doc-a",
      sheetId: "sheet-p",
      fileName: "P-2.0-00.pdf",
      discipline: "general",
      pageNumber: 1,
      revision: "1",
      text,
    };
    const first = await store.upsertRecords([record]);
    const second = await store.upsertRecords([record]);
    const active = backend.listActive(projectA);
    assert.ok(active.length > 1);
    assert.ok(active.length <= 16);
    assert.equal(first.count, second.count);
    assert.equal(active.length, first.count);
    assert.equal(new Set(active.map((row) => row.chunk_key)).size, active.length);
    assert.ok(active.every((row) => row.embedding && String(row.embedding).startsWith("[")));
    assert.ok(active.every((row) => row.metadata.embeddingStatus === "present"));
    assert.equal(active[0].discipline, "plumbing");
    assert.ok(active.some((row) => (row.identifiers || []).includes("P-2.0")));
    assert.ok(active.some((row) => (row.cross_sheet_refs || []).includes("S-3.01")));
    assert.ok(active.some((row) => String(row.chunk_text).includes("WATER HAMMER")));
    assert.ok(active.every((row) => row.chunk_text.length <= 12000));
    await store.upsertRecords([
      { projectId: projectB, fileName: "S-1.pdf", text: "other project secret beam", pageNumber: 1 },
    ]);
    const isolated = backend.listActive(projectA);
    assert.ok(isolated.every((row) => row.project_id === projectA));
    assert.equal(isolated.some((row) => String(row.chunk_text).includes("secret")), false);

    const index = createDrawingIndex();
    for (const row of isolated) index.upsert(store.rowToRecord(row));
    const hits = hybridRetrieveDrawings(index, {
      topics: ["water hammer"],
      disciplines: ["plumbing"],
      currentSheetId: "other",
    });
    assert.equal(hits.length, 1);
    assert.match(hits[0].quote, /WATER HAMMER/);
    assert.equal(hits[0].diagnostics.embeddingStatus, "present");
    assert.equal(hits[0].provenance.legs.vector, false);
  });
});

describe("drawing rag migration", () => {
  it("scopes chunks to a project, allows exact match without an embedding, and stores no rasters", () => {
    const sql = fs.readFileSync(
      path.join(__dirname, "../../supabase/migrations/20261019130000_code_analyzer_drawing_rag.sql"),
      "utf8",
    );
    assert.match(sql, /superseded BOOLEAN NOT NULL DEFAULT false/);
    assert.match(sql, /UNIQUE \(project_id, chunk_key\)/);
    assert.match(sql, /embedding vector\(1536\)/);
    assert.match(sql, /NOT \(region \? 'imageBase64'\)/);
    assert.match(sql, /c\.project_id = p_project_id/);
    assert.match(sql, /c\.superseded = false/);
    assert.match(sql, /p_query_embedding IS NOT NULL/);
    assert.match(sql, /c\.embedding IS NOT NULL/);
    assert.match(sql, /has_project_access/);
    assert.match(sql, /REVOKE ALL ON FUNCTION/);
    assert.match(sql, /TO authenticated, service_role/);
    assert.match(sql, /SET search_path = public, extensions/);
    assert.match(sql, /code_analyzer_drawing_chunks_same_project/);
    assert.match(sql, /octet_length\(observations::text\) <= 48000/);
    assert.doesNotMatch(sql, /image bytea|raster bytea/i);
  });
});
