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
