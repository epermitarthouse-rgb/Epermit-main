import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { shouldShowAnalyzerUploadWorkspace } from "./analyzerUploadWorkspace.ts";
import {
  buildOptimisticWorkflowDocumentsFromEnqueues,
  countVerifiedIngestionEnqueues,
  isWorkflowOrganizing,
  pruneUploadHandoffsForWorkflow,
} from "./v2UploadHandoff.ts";

describe("v2UploadHandoff", () => {
  it("keeps workspace visible via latch after session upload clears pending files", () => {
    assert.equal(
      shouldShowAnalyzerUploadWorkspace({
        persistedSheetCount: 0,
        sessionFileCount: 0,
        analyzedDocCount: 0,
        uploadHandoffCount: 0,
        trackedWorkflowDocumentCount: 0,
        workflowDocumentsLatch: true,
      }),
      true,
    );
  });

  it("counts verified ingestion enqueues only when job id exists", () => {
    assert.equal(
      countVerifiedIngestionEnqueues([
        {
          pendingId: "p1",
          documentId: "d1",
          job: { id: "j1", status: "pending" } as never,
        },
      ]),
      1,
    );
    assert.equal(
      countVerifiedIngestionEnqueues([
        { pendingId: "p2", documentId: "d2", job: null as never },
      ]),
      0,
    );
  });

  it("prunes handoffs only when workflow-eligible doc is in UI hydrate set", () => {
    const handoffs = [{ pendingId: "p1", documentId: "d1", fileName: "A.pdf" }];
    const pruned = pruneUploadHandoffsForWorkflow(
      handoffs,
      [
        {
          id: "d1",
          file_name: "A.pdf",
          analyzer_class: "specification",
          analyzer_processing_status: "queued",
          document_type: "specification",
        },
      ],
      [{ document_id: "d1", status: "pending" }],
    );
    assert.equal(pruned.length, 0);
  });

  it("does not prune handoffs when fetch exists but UI hydrate is still empty", () => {
    const handoffs = [{ pendingId: "p1", documentId: "d1", fileName: "A.pdf" }];
    const pruned = pruneUploadHandoffsForWorkflow(handoffs, [], [{ document_id: "d1", status: "pending" }]);
    assert.equal(pruned.length, 1);
  });

  it("builds optimistic workflow rows for immediate card render", () => {
    const docs = buildOptimisticWorkflowDocumentsFromEnqueues(
      [{ pendingId: "p1", documentId: "d1", job: { id: "j1", status: "pending", analyzer_class: null } as never }],
      new Map([["p1", "Plan.pdf"]]),
    );
    assert.equal(docs.length, 1);
    assert.equal(docs[0]?.analyzer_processing_status, "queued");
  });

  it("detects organizing while handoffs or jobs are active", () => {
    assert.equal(isWorkflowOrganizing([], [], 1), true);
    assert.equal(
      isWorkflowOrganizing([{ status: "pending" }], [{ analyzer_processing_status: "not_started" }], 0),
      true,
    );
    assert.equal(
      isWorkflowOrganizing([{ status: "completed" }], [{ analyzer_processing_status: "completed" }], 0),
      false,
    );
  });
});
