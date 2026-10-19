import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { credibleIndexEntries, runDrawingIndexPrescreen } from "./runIndexPrescreen.ts";
import type { CodeAnalyzerSheet } from "./model.ts";

function sheet(id: string, file_name: string): CodeAnalyzerSheet {
  return {
    id, project_id: "p", source_document_id: `doc-${id}`, image_document_id: null,
    page_number: 1, file_name, excluded: false, created_at: "2026-01-01",
  };
}

const sheets = [sheet("cv", "CV-1.00-00.pdf"), sheet("a1", "A-1.00-00.pdf"), sheet("e1", "E-1.0-00.pdf")];
const pageTextBySheetId = { cv: "COVER SHEET INDEX OF SHEETS N.T.S." };
const pdfBlob = new Blob(["%PDF-1.7"], { type: "application/pdf" });

describe("image-based index of sheets", () => {
  it("renders the PDF page, reads rows with the multimodal reader, and reconciles them", async () => {
    let rasterized = 0;
    const result = await runDrawingIndexPrescreen({
      sheets,
      pageTextBySheetId,
      getDownloadUrl: async (id) => `https://files.example/${id}.pdf`,
      fetchBlob: async () => pdfBlob,
      rasterize: async (_pdf, page) => {
        rasterized += 1;
        assert.equal(page, 1);
        return { imageBase64: "iVBOR", imageType: "image/png" };
      },
      extract: async (opts) => {
        assert.equal(opts.imageType, "image/png");
        return [
          { sheetNumber: "CV100", rawLabel: "CV-1.00", title: "Cover" },
          { sheetNumber: "A100", rawLabel: "A-1.00", title: "Floor plan" },
          { sheetNumber: "E10", rawLabel: "E-1.0", title: "Electrical" },
          { sheetNumber: "P10", rawLabel: "P-1.0", title: "Plumbing" },
          { sheetNumber: "NTS", rawLabel: "N.T.S.", title: null },
        ];
      },
    });
    assert.equal(rasterized, 1);
    assert.equal(result.indexSource, "vision");
    assert.equal(result.status, "incomplete");
    assert.deepEqual(result.missing.map((row) => row.rawLabel), ["P-1.0"]);
    assert.equal(result.extra.length, 0);
    assert.equal(result.duplicates.length, 0);
  });

  it("reports an unreadable index (never no_index) when extraction fails", async () => {
    const result = await runDrawingIndexPrescreen({
      sheets,
      pageTextBySheetId,
      getDownloadUrl: async (id) => `https://files.example/${id}.pdf`,
      fetchBlob: async () => pdfBlob,
      rasterize: async () => ({ imageBase64: "iVBOR", imageType: "image/png" }),
      extract: async () => {
        throw new Error("Index extraction failed (HTTP 502)");
      },
    });
    assert.equal(result.status, "index_unreadable");
    assert.equal(result.hasIndex, true);
    assert.equal(result.indexSheetId, "cv");
    assert.match(result.indexReadError ?? "", /502/);
    assert.equal(result.missing.length, 0);
  });

  it("does not invent rows from non-sheet tokens", () => {
    const rows = credibleIndexEntries([
      { sheetNumber: "SCALE", rawLabel: "SCALE", title: null },
      { sheetNumber: "A100", rawLabel: "A-1.00", title: null },
      { sheetNumber: "A100", rawLabel: "A-1.00", title: "dup" },
    ]);
    assert.deepEqual(rows.map((row) => row.sheetNumber), ["A1"]);
  });
});
