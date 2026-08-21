import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { persistPendingAnalyzerSources } from "./persistPending.ts";
import type { CodeAnalyzerSheet } from "./model.ts";

describe("persistPendingAnalyzerSources", () => {
  it("stores the original PDF and a sheet per page, not page 1 only", async () => {
    const uploads: string[] = [];
    const { sheets, warnings } = await persistPendingAnalyzerSources({
      projectId: "proj",
      existingSheets: [],
      pendingFiles: [
        {
          id: "p1",
          file: { name: "set.pdf", type: "application/pdf", size: 10 } as File,
          discipline: "architectural",
        },
      ],
      uploadDocument: async ({ file, parent_document_id }) => {
        uploads.push(`${file.name}|parent=${parent_document_id ?? "none"}`);
        if (file.name === "set.pdf") return { id: "pdf-1", file_name: file.name };
        if (file.name.includes("page1")) return { id: "img-1", file_name: file.name };
        if (file.name.includes("page2")) return { id: "img-2", file_name: file.name };
        if (file.name.includes("page3")) return { id: "img-3", file_name: file.name };
        return { id: `img-${file.name}`, file_name: file.name };
      },
      renderPdfPages: async () => ({
        totalPages: 3,
        truncated: false,
        pages: [
          { pageNumber: 1, file: { name: "set-page1.png", type: "image/png" } as File },
          { pageNumber: 2, file: { name: "set-page2.png", type: "image/png" } as File },
          { pageNumber: 3, file: { name: "set-page3.png", type: "image/png" } as File },
        ],
      }),
      insertSheet: async (row) =>
        ({
          id: `sheet-${row.page_number}`,
          created_at: "2026-08-21T00:00:00Z",
          ...row,
        }) as CodeAnalyzerSheet,
    });

    assert.equal(uploads[0], "set.pdf|parent=none");
    assert.ok(uploads.includes("set-page1.png|parent=pdf-1"));
    assert.ok(uploads.includes("set-page2.png|parent=pdf-1"));
    assert.ok(uploads.includes("set-page3.png|parent=pdf-1"));
    assert.equal(sheets.length, 3);
    assert.deepEqual(sheets.map((s) => s.page_number), [1, 2, 3]);
    assert.ok(sheets.every((s) => s.source_document_id === "pdf-1"));
    assert.deepEqual(sheets.map((s) => s.image_document_id), ["img-1", "img-2", "img-3"]);
    assert.equal(warnings.length, 0);
  });

  it("treats a raster image as a single sheet using the source document as the image", async () => {
    const { sheets } = await persistPendingAnalyzerSources({
      projectId: "proj",
      existingSheets: [],
      pendingFiles: [
        {
          id: "p1",
          file: { name: "plan.png", type: "image/png", size: 10 } as File,
          discipline: "general",
        },
      ],
      uploadDocument: async ({ file }) => ({ id: "img-src", file_name: file.name }),
      renderPdfPages: async () => {
        throw new Error("should not rasterize a PNG");
      },
      insertSheet: async (row) =>
        ({
          id: "sheet-1",
          created_at: "2026-08-21T00:00:00Z",
          ...row,
        }) as CodeAnalyzerSheet,
    });
    assert.equal(sheets.length, 1);
    assert.equal(sheets[0].page_number, 1);
    assert.equal(sheets[0].source_document_id, "img-src");
    assert.equal(sheets[0].image_document_id, "img-src");
  });
});
