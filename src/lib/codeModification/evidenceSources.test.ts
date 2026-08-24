import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildFormExclusionDocumentIds,
  filterDrawingEvidenceSheets,
  normalizeEvidenceFileName,
} from "./evidenceSources.ts";

describe("buildFormExclusionDocumentIds", () => {
  it("excludes application docs, their page children, and duplicate same-name uploads", () => {
    const documents = [
      {
        id: "form-app",
        document_type: "code_modification_application" as const,
        parent_document_id: null,
        file_name: "1513 P St NW_Code-Modification-Form_10.01.24.pdf",
      },
      {
        id: "form-page-1",
        document_type: "permit_drawing" as const,
        parent_document_id: "form-app",
        file_name: "1513 P St NW_Code-Modification-Form_10.01.24-page1.png",
      },
      {
        id: "form-drawing-dup",
        document_type: "permit_drawing" as const,
        parent_document_id: null,
        file_name: "1513 P St NW_Code-Modification-Form_10.01.24.pdf",
      },
      {
        id: "form-drawing-page-1",
        document_type: "permit_drawing" as const,
        parent_document_id: "form-drawing-dup",
        file_name: "1513 P St NW_Code-Modification-Form_10.01.24-page1.png",
      },
      {
        id: "real-a101",
        document_type: "permit_drawing" as const,
        parent_document_id: null,
        file_name: "A-101.pdf",
      },
    ];

    const excluded = buildFormExclusionDocumentIds(documents, documents[0]);
    assert.equal(excluded.has("form-app"), true);
    assert.equal(excluded.has("form-page-1"), true);
    assert.equal(excluded.has("form-drawing-dup"), true);
    assert.equal(excluded.has("form-drawing-page-1"), true);
    assert.equal(excluded.has("real-a101"), false);
  });

  it("normalizes file names for duplicate detection", () => {
    assert.equal(
      normalizeEvidenceFileName(" 1513  P St NW_Code-Modification-Form_10.01.24.pdf "),
      "1513 p st nw_code-modification-form_10.01.24.pdf",
    );
  });
});

describe("filterDrawingEvidenceSheets", () => {
  it("removes sheets whose source or image document is excluded", () => {
    const excluded = new Set(["form-drawing-dup", "form-drawing-page-1"]);
    const sheets = [
      {
        id: "s1",
        source_document_id: "form-drawing-dup",
        image_document_id: "form-drawing-page-1",
        page_number: 1,
      },
      {
        id: "s2",
        source_document_id: "real-a101",
        image_document_id: "real-a101",
        page_number: 1,
      },
    ];
    const kept = filterDrawingEvidenceSheets(sheets, excluded);
    assert.deepEqual(kept.map((s) => s.id), ["s2"]);
  });
});
