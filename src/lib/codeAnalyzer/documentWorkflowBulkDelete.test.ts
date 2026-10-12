import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  bulkDeletableDocumentIds,
  isBulkSelectableDocumentCard,
  type ConsolidatedDocumentCardModel,
} from "./documentWorkflowModel.ts";

function card(
  partial: Partial<ConsolidatedDocumentCardModel> &
    Pick<ConsolidatedDocumentCardModel, "key" | "fileName" | "purpose">,
): ConsolidatedDocumentCardModel {
  return {
    documentId: "doc-1",
    isPersistedDocument: true,
    purposeDetail: null,
    status: "Ready for analysis",
    statusDetail: null,
    countLabel: null,
    showRemove: true,
    showCancelProcessing: false,
    showRetryAnalysis: false,
    ingestionJobId: null,
    borderClass: "",
    eligibleForBulkDelete: true,
    ...partial,
  };
}

describe("document workflow bulk delete", () => {
  it("allows bulk select for any persisted deletable workflow card", () => {
    assert.equal(
      isBulkSelectableDocumentCard(
        card({ key: "d1", fileName: "Plan.pdf", purpose: "Drawing", documentId: "d1" }),
      ),
      true,
    );
    assert.equal(
      isBulkSelectableDocumentCard(
        card({
          key: "d2",
          fileName: "Spec.pdf",
          purpose: "Supporting document",
          documentId: "d2",
        }),
      ),
      true,
    );
    assert.equal(
      isBulkSelectableDocumentCard(
        card({
          key: "f1",
          fileName: "Form.pdf",
          purpose: "Code modification form",
          documentId: "f1",
        }),
      ),
      true,
    );
  });

  it("excludes placeholders and session-only cards", () => {
    assert.equal(
      isBulkSelectableDocumentCard(
        card({
          key: "d3",
          fileName: "Ghost.pdf",
          purpose: "Drawing",
          documentId: "d3",
          isPersistedDocument: false,
          eligibleForBulkDelete: false,
          showRemove: false,
        }),
      ),
      false,
    );
    assert.equal(
      isBulkSelectableDocumentCard(
        card({
          key: "pending:1",
          fileName: "Uploading.pdf",
          purpose: "Drawing",
          documentId: null,
          isPersistedDocument: false,
          eligibleForBulkDelete: false,
          showRemove: true,
        }),
      ),
      false,
    );
  });

  it("collects unique persisted document ids for delete all", () => {
    const ids = bulkDeletableDocumentIds([
      card({ key: "a", fileName: "A.pdf", purpose: "Drawing", documentId: "a" }),
      card({ key: "b", fileName: "B.pdf", purpose: "Drawing", documentId: "b" }),
      card({ key: "c", fileName: "C.pdf", purpose: "Supporting document", documentId: "c" }),
      card({ key: "a2", fileName: "A2.pdf", purpose: "Drawing", documentId: "a" }),
      card({
        key: "pending:1",
        fileName: "Q.pdf",
        purpose: "Drawing",
        documentId: null,
        isPersistedDocument: false,
        eligibleForBulkDelete: false,
        showRemove: true,
      }),
    ]);
    assert.deepEqual(ids.sort(), ["a", "b", "c"]);
  });
});
