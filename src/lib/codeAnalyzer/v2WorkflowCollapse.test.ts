/**
 * Reproduces the 14-card → 0 collapse when handoffs prune against fetch
 * but the card UI only reads child-local document state.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  normalizeWorkflowDocuments,
  type UploadHandoffEntry,
} from "./analyzerUploadWorkspace";
import {
  buildConsolidatedDocumentCards,
  type ProjectDocumentMeta,
} from "./documentWorkflowModel";
import {
  buildOptimisticWorkflowDocumentsFromEnqueues,
  pruneUploadHandoffsForWorkflow,
} from "./v2UploadHandoff";

describe("v2WorkflowCollapse", () => {
  const handoffs: UploadHandoffEntry[] = Array.from({ length: 14 }, (_, i) => ({
    pendingId: `p${i}`,
    documentId: `d${i}`,
    fileName: `Doc-${i}.pdf`,
  }));

  const fetchedFromDb: ProjectDocumentMeta[] = handoffs.map((h) => ({
    id: h.documentId,
    file_name: h.fileName,
    document_type: "specification",
    analyzer_class: "specification",
    analyzer_processing_status: "completed",
  }));

  const completedJobs = handoffs.map((h) => ({
    document_id: h.documentId,
    status: "completed" as const,
  }));

  it("collapse: child docs empty + pruned handoffs yields zero cards (old behavior)", () => {
    const childLocalDocs: ProjectDocumentMeta[] = [];
    const pruned = pruneUploadHandoffsForWorkflow(handoffs, fetchedFromDb, completedJobs);
    const normalized = normalizeWorkflowDocuments(childLocalDocs, pruned);
    const cards = buildConsolidatedDocumentCards({
      documents: normalized.all,
      jobs: completedJobs as never,
      sheets: [],
      pendingUploads: [],
      handoffPendingIds: new Set(),
      placeholderDocumentIds: normalized.placeholderDocumentIds,
      completedSheetIds: new Set(),
      failedSheetIds: new Set(),
      analyzing: false,
      analysisStale: false,
    });
    assert.equal(pruned.length, 0);
    assert.equal(cards.length, 0);
  });

  it("fixed: parent hydrate + child empty keeps 14 cards after handoff prune", () => {
    const childLocalDocs: ProjectDocumentMeta[] = [];
    const optimistic = buildOptimisticWorkflowDocumentsFromEnqueues(
      handoffs.map((h, i) => ({
        pendingId: h.pendingId,
        documentId: h.documentId,
        job: { id: `j${i}`, status: "completed", analyzer_class: "specification" } as never,
      })),
      new Map(handoffs.map((h) => [h.pendingId, h.fileName])),
    );
    const parentHydrated = optimistic;
    const pruned = pruneUploadHandoffsForWorkflow(handoffs, parentHydrated, completedJobs);

    const mergedUi = parentHydrated.length > 0 ? parentHydrated : childLocalDocs;
    const normalized = normalizeWorkflowDocuments(mergedUi, pruned);
    const cards = buildConsolidatedDocumentCards({
      documents: normalized.all,
      jobs: completedJobs as never,
      sheets: [],
      pendingUploads: [],
      handoffPendingIds: new Set(),
      placeholderDocumentIds: normalized.placeholderDocumentIds,
      completedSheetIds: new Set(),
      failedSheetIds: new Set(),
      analyzing: false,
      analysisStale: false,
    });
    assert.equal(pruned.length, 0);
    assert.equal(cards.length, 14);
  });
});
