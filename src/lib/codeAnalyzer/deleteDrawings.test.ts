import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { deleteAnalyzerSheet, deleteAnalyzerSourceDrawing } from "./deleteDrawings.ts";
import type { CodeAnalyzerSheet } from "./model.ts";
import type { ProjectDocument } from "../../types/document.ts";

function doc(id: string, extras: Partial<ProjectDocument> = {}): ProjectDocument {
  return {
    id,
    project_id: "p",
    user_id: "u",
    file_name: `${id}.png`,
    file_path: `u/p/${id}`,
    file_size: 1,
    file_type: "image/png",
    document_type: "permit_drawing",
    version: 1,
    parent_document_id: null,
    description: null,
    created_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-08-01T00:00:00Z",
    ...extras,
  };
}

function sheet(partial: Partial<CodeAnalyzerSheet> & Pick<CodeAnalyzerSheet, "id">): CodeAnalyzerSheet {
  return {
    project_id: "p",
    source_document_id: "src",
    image_document_id: "img",
    page_number: 1,
    file_name: "plans.pdf",
    excluded: false,
    created_at: "2026-08-01T00:00:00Z",
    ...partial,
  };
}

describe("deleteAnalyzerSourceDrawing", () => {
  it("deletes page images then the source document", async () => {
    const deleted: string[] = [];
    const source = doc("src", { file_name: "plans.pdf", file_type: "application/pdf" });
    const page1 = doc("img-1", { parent_document_id: "src" });
    const page2 = doc("img-2", { parent_document_id: "src" });
    const ok = await deleteAnalyzerSourceDrawing({
      sourceDocument: source,
      sheets: [
        sheet({ id: "s1", image_document_id: "img-1", page_number: 1 }),
        sheet({ id: "s2", image_document_id: "img-2", page_number: 2 }),
      ],
      imageDocuments: [page1, page2],
      deleteDocument: async (d) => {
        deleted.push(d.id);
        return true;
      },
    });
    assert.equal(ok, true);
    assert.deepEqual(deleted, ["img-1", "img-2", "src"]);
  });

  it("does not delete the source twice when source is also the image (single image drawing)", async () => {
    const deleted: string[] = [];
    const source = doc("src");
    const ok = await deleteAnalyzerSourceDrawing({
      sourceDocument: source,
      sheets: [sheet({ id: "s1", source_document_id: "src", image_document_id: "src" })],
      imageDocuments: [source],
      deleteDocument: async (d) => {
        deleted.push(d.id);
        return true;
      },
    });
    assert.equal(ok, true);
    assert.deepEqual(deleted, ["src"]);
  });
});

describe("deleteAnalyzerSheet", () => {
  it("deletes a distinct page image and the sheet row, keeping the source PDF", async () => {
    const deleted: string[] = [];
    let sheetDeleted = "";
    const ok = await deleteAnalyzerSheet({
      sheet: sheet({ id: "s2", page_number: 2, image_document_id: "img-2" }),
      sourceDocument: doc("src", { file_type: "application/pdf" }),
      imageDocument: doc("img-2"),
      deleteDocument: async (d) => {
        deleted.push(d.id);
        return true;
      },
      deleteSheetRow: async (id) => {
        sheetDeleted = id;
      },
    });
    assert.equal(ok, true);
    assert.deepEqual(deleted, ["img-2"]);
    assert.equal(sheetDeleted, "s2");
  });

  it("does not delete the source image when removing the only page of an image drawing; only the sheet row goes", async () => {
    const deleted: string[] = [];
    const source = doc("src");
    const ok = await deleteAnalyzerSheet({
      sheet: sheet({ id: "s1", source_document_id: "src", image_document_id: "src" }),
      sourceDocument: source,
      imageDocument: source,
      deleteDocument: async (d) => {
        deleted.push(d.id);
        return true;
      },
      deleteSheetRow: async () => {},
    });
    assert.equal(ok, true);
    assert.deepEqual(deleted, []);
  });
});
