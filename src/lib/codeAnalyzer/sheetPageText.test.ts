import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { pageTextBySheetFromChunks } from "./sheetPageText.ts";

describe("pageTextBySheetFromChunks", () => {
  it("joins each sheet's chunks in chunk order and skips rows without a sheet", () => {
    const text = pageTextBySheetFromChunks([
      { sheet_id: "cv", chunk_text: "A-1.00 FLOOR PLAN", metadata: { chunkIndex: 1 } },
      { sheet_id: "cv", chunk_text: "INDEX OF SHEETS", metadata: { chunkIndex: 0 } },
      { sheet_id: "a1", chunk_text: "FLOOR PLAN", metadata: null },
      { sheet_id: null, chunk_text: "orphan" },
      { sheet_id: "a2", chunk_text: null },
    ]);
    assert.deepEqual(text, { cv: "INDEX OF SHEETS A-1.00 FLOOR PLAN", a1: "FLOOR PLAN" });
  });
});
