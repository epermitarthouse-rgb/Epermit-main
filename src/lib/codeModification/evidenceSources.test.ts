import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildFormExclusionDocumentIds,
  filterDrawingEvidenceSheets,
  normalizeEvidenceFileName,
  registeredDrawingSourceIdsFromSheets,
  resolveCodeModDrawingEvidence,
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

    const excluded = buildFormExclusionDocumentIds(documents, [documents[0]!], new Set());
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

  it("excludes every active form document in a multi-document review", () => {
    const documents = [
      {
        id: "form-a",
        document_type: "code_modification_application" as const,
        parent_document_id: null,
        file_name: "form-a.pdf",
      },
      {
        id: "form-b",
        document_type: "code_modification_application" as const,
        parent_document_id: null,
        file_name: "supporting-narrative.pdf",
      },
      {
        id: "real-a101",
        document_type: "permit_drawing" as const,
        parent_document_id: null,
        file_name: "A-101.pdf",
      },
    ];

    const excluded = buildFormExclusionDocumentIds(documents, documents.slice(0, 2), new Set());
    assert.equal(excluded.has("form-a"), true);
    assert.equal(excluded.has("form-b"), true);
    assert.equal(excluded.has("real-a101"), false);
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

describe("resolveCodeModDrawingEvidence", () => {
  const formDoc = {
    id: "602354ae",
    document_type: "code_modification_application" as const,
    parent_document_id: null,
    file_name: "1513 P St NW_Code-Modification-Form_10.01.24.pdf",
  };

  const baseDrawingRoot = {
    id: "9db91d66",
    document_type: "permit_drawing" as const,
    parent_document_id: null,
    file_name: "1513_P_St_MOCK_Permit_Drawings_Base.pdf",
  };

  const baseDrawingMisuploadForm = {
    id: "839b089d",
    document_type: "code_modification_application" as const,
    parent_document_id: null,
    file_name: "1513_P_St_MOCK_Permit_Drawings_Base.pdf",
  };

  const pageDocs = [1, 2, 3, 4, 5].map((page) => ({
    id: `page-${page}`,
    document_type: "permit_drawing" as const,
    parent_document_id: "9db91d66",
    file_name: `1513_P_St_MOCK_Permit_Drawings_Base-page${page}.png`,
  }));

  const baseSheets = [1, 2, 3, 4, 5].map((page) => ({
    id: `sheet-${page}`,
    source_document_id: "9db91d66",
    image_document_id: `page-${page}`,
    page_number: page,
    excluded: false,
  }));

  it("A: form only yields zero evidence sheets", () => {
    const kept = resolveCodeModDrawingEvidence({
      sheets: [],
      documents: [formDoc],
      formDocuments: [formDoc],
    });
    assert.equal(kept.length, 0);
  });

  it("B: form plus registered base drawing keeps drawing evidence sheets", () => {
    const kept = resolveCodeModDrawingEvidence({
      sheets: baseSheets,
      documents: [formDoc, baseDrawingMisuploadForm, baseDrawingRoot, ...pageDocs],
      formDocuments: [formDoc, baseDrawingMisuploadForm],
    });
    assert.equal(kept.length, 5);
    assert.ok(kept.every((sheet) => sheet.source_document_id === "9db91d66"));
  });

  it("C: stored permit_drawing without sheet linkage stays excluded from evidence", () => {
    const orphanDrawing = {
      id: "orphan-drawing",
      document_type: "permit_drawing" as const,
      parent_document_id: null,
      file_name: "1513 P St NW_Code-Modification-Form_10.01.24.pdf",
    };
    const excluded = buildFormExclusionDocumentIds(
      [formDoc, orphanDrawing],
      [formDoc],
      registeredDrawingSourceIdsFromSheets([]),
    );
    assert.equal(excluded.has("orphan-drawing"), true);
    assert.equal(
      resolveCodeModDrawingEvidence({
        sheets: [],
        documents: [formDoc, orphanDrawing],
        formDocuments: [formDoc],
      }).length,
      0,
    );
  });

  it("D: sheets tied to another form document id remain excluded", () => {
    const otherFormSheet = {
      id: "other-form-sheet",
      source_document_id: "other-form",
      image_document_id: "other-form-page",
      page_number: 1,
      excluded: false,
    };
    const kept = resolveCodeModDrawingEvidence({
      sheets: [otherFormSheet, ...baseSheets],
      documents: [
        formDoc,
        {
          id: "other-form",
          document_type: "code_modification_application" as const,
          parent_document_id: null,
          file_name: "other-form.pdf",
        },
        {
          id: "other-form-page",
          document_type: "permit_drawing" as const,
          parent_document_id: "other-form",
          file_name: "other-form-page1.png",
        },
        baseDrawingRoot,
        ...pageDocs,
      ],
      formDocuments: [formDoc],
    });
    assert.deepEqual(
      kept.map((sheet) => sheet.id),
      baseSheets.map((sheet) => sheet.id),
    );
  });

  it("E: multi-page base PDF registers all pages as evidence sheets", () => {
    const kept = resolveCodeModDrawingEvidence({
      sheets: baseSheets,
      documents: [formDoc, baseDrawingRoot, ...pageDocs],
      formDocuments: [formDoc],
    });
    assert.deepEqual(
      kept.map((sheet) => sheet.page_number),
      [1, 2, 3, 4, 5],
    );
  });

  it("protects registered drawing sources from form-slot filename collisions", () => {
    const registered = registeredDrawingSourceIdsFromSheets(baseSheets);
    const excluded = buildFormExclusionDocumentIds(
      [formDoc, baseDrawingMisuploadForm, baseDrawingRoot],
      [formDoc, baseDrawingMisuploadForm],
      registered,
    );
    assert.equal(excluded.has("839b089d"), true);
    assert.equal(excluded.has("9db91d66"), false);
  });
});

describe("registeredDrawingSourceIdsFromSheets", () => {
  it("F: evidence sheet resolution retains source document references", () => {
    const sheets = [
      {
        id: "sheet-1",
        source_document_id: "9db91d66",
        image_document_id: "page-1",
        page_number: 1,
        excluded: false,
      },
    ];
    const kept = resolveCodeModDrawingEvidence({
      sheets,
      documents: [
        {
          id: "602354ae",
          document_type: "code_modification_application",
          parent_document_id: null,
          file_name: "1513 P St NW_Code-Modification-Form_10.01.24.pdf",
        },
        {
          id: "9db91d66",
          document_type: "permit_drawing",
          parent_document_id: null,
          file_name: "1513_P_St_MOCK_Permit_Drawings_Base.pdf",
        },
        {
          id: "page-1",
          document_type: "permit_drawing",
          parent_document_id: "9db91d66",
          file_name: "1513_P_St_MOCK_Permit_Drawings_Base-page1.png",
        },
      ],
      formDocuments: [
        {
          id: "602354ae",
          file_name: "1513 P St NW_Code-Modification-Form_10.01.24.pdf",
        },
      ],
    });
    assert.equal(kept.length, 1);
    assert.equal(kept[0]?.source_document_id, "9db91d66");
    assert.equal(kept[0]?.image_document_id, "page-1");
  });
});
