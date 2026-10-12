import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  augmentWorkflowDocumentsFromSheets,
  mergeProjectDocumentMetaFetch,
  normalizeWorkflowDocuments,
  pruneUploadHandoffs,
  reconcileTrackedWorkflowDocumentIds,
  shouldShowAnalyzerUploadWorkspace,
  workflowDatasetCounts,
} from "./analyzerUploadWorkspace.ts";
import { buildConsolidatedDocumentCards } from "./documentWorkflowModel.ts";

describe("analyzerUploadWorkspace", () => {
  it("keeps upload workspace visible during V2 handoff with no sheets yet", () => {
    assert.equal(
      shouldShowAnalyzerUploadWorkspace({
        persistedSheetCount: 0,
        sessionFileCount: 0,
        analyzedDocCount: 0,
        uploadHandoffCount: 2,
        trackedWorkflowDocumentCount: 2,
      }),
      true,
    );
  });

  it("removes orphan handoffs when fetch has no row and no active job", () => {
    const pruned = pruneUploadHandoffs(
      [{ pendingId: "p1", documentId: "ghost-doc", fileName: "A.pdf" }],
      [],
      [{ document_id: "ghost-doc", status: "completed" }],
    );
    assert.equal(pruned.length, 0);
  });

  it("keeps handoff only while ingestion job is active", () => {
    const pruned = pruneUploadHandoffs(
      [{ pendingId: "p1", documentId: "doc-1", fileName: "A.pdf" }],
      [],
      [{ document_id: "doc-1", status: "processing" }],
    );
    assert.equal(pruned.length, 1);
  });

  it("drops handoff once persisted row is fetched", () => {
    const pruned = pruneUploadHandoffs(
      [{ pendingId: "p1", documentId: "doc-1", fileName: "A.pdf" }],
      [
        {
          id: "doc-1",
          file_name: "A.pdf",
          analyzer_class: "specification",
          analyzer_processing_status: "completed",
          document_type: "specification",
        },
      ],
      [],
    );
    assert.equal(pruned.length, 0);
  });

  it("dataset counts match normalized card documents", () => {
    const normalized = normalizeWorkflowDocuments(
      [
        {
          id: "doc-1",
          file_name: "Cover.pdf",
          analyzer_class: "specification",
          analyzer_processing_status: "completed",
          document_type: "specification",
        },
        {
          id: "doc-2",
          file_name: "Plan.pdf",
          analyzer_class: "mixed",
          analyzer_processing_status: "completed",
          document_type: "specification",
        },
      ],
      [],
    );
    const counts = workflowDatasetCounts({ normalized, includedSheetCount: 0 });
    assert.equal(counts.sourceDocumentCount, 2);
    assert.equal(counts.includedSheetCount, 0);
  });

  it("preserves tracked workflow document ids on empty fetch", () => {
    const prev = ["doc-a", "doc-b"];
    assert.deepEqual(reconcileTrackedWorkflowDocumentIds(prev, []), prev);
    assert.deepEqual(
      reconcileTrackedWorkflowDocumentIds(prev, [
        {
          id: "doc-a",
          file_name: "A.pdf",
          analyzer_class: "mixed",
          analyzer_processing_status: "completed",
          document_type: "specification",
        },
      ]),
      ["doc-a"],
    );
  });

  it("keeps prior document meta when fetch returns empty", () => {
    const prev = [
      {
        id: "doc-1",
        file_name: "Plan.pdf",
        analyzer_class: "drawing_set",
        analyzer_processing_status: "completed",
        document_type: "permit_drawing",
      },
    ];
    assert.deepEqual(mergeProjectDocumentMetaFetch(prev, []), prev);
  });

  it("augments workflow documents from persisted sheets", () => {
    const augmented = augmentWorkflowDocumentsFromSheets([], [
      {
        id: "s1",
        project_id: "p",
        source_document_id: "doc-x",
        image_document_id: "img",
        page_number: 1,
        file_name: "Cover.pdf",
        excluded: false,
        created_at: "2026-01-01",
      },
    ]);
    assert.equal(augmented.length, 1);
    assert.equal(augmented[0]?.id, "doc-x");
  });

  it("dataset count uses sheet source floor when docs list is empty", () => {
    const normalized = normalizeWorkflowDocuments([], []);
    const counts = workflowDatasetCounts({
      normalized,
      includedSheetCount: 3,
      sheetSourceDocumentCount: 2,
    });
    assert.equal(counts.sourceDocumentCount, 2);
    assert.equal(counts.includedSheetCount, 3);
  });

  it("placeholders are not deletable persisted cards", () => {
    const normalized = normalizeWorkflowDocuments(
      [],
      [{ pendingId: "p1", documentId: "doc-1", fileName: "A.pdf" }],
    );
    const cards = buildConsolidatedDocumentCards({
      documents: normalized.all,
      jobs: [{ document_id: "doc-1", status: "processing" } as never],
      sheets: [],
      pendingUploads: [],
      placeholderDocumentIds: normalized.placeholderDocumentIds,
      completedSheetIds: new Set(),
      failedSheetIds: new Set(),
      analyzing: false,
    });
    assert.equal(cards.length, 1);
    assert.equal(cards[0]?.isPersistedDocument, false);
    assert.equal(cards[0]?.showRemove, false);
  });
});
