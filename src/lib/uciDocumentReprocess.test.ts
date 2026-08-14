import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  executeSequentialDocumentReprocess,
  summarizeDocumentReprocessBatch,
} from "./uciDocumentReprocess";
import type {
  UciDocumentReprocessOutcome,
  UciDocumentReprocessResponse,
} from "./uciDocumentProcessing";

function result(
  documentId: string,
  outcome: UciDocumentReprocessOutcome,
): UciDocumentReprocessResponse {
  const summary = {
    document_id: documentId,
    document_name: `${documentId}.pdf`,
    processing_status: outcome === "parsed" ? "complete" : "partial",
    findings_extraction_status: null,
    findings_count: 1,
    pages_total: 1,
    pages_requiring_fallback: outcome === "still_needs_fallback" ? 1 : 0,
    pages_fallback_failed: outcome === "fallback_failed" ? 1 : 0,
    pages_manual_review: 0,
    required_fallback_methods: [],
    unavailable_fallback_methods: [],
    fallback_provider_status: {
      vision_available: true,
      ocr_available: true,
      warnings: [],
    },
    failure_reason: null,
    signature: outcome,
  };
  return {
    status:
      outcome === "failed" || outcome === "fallback_failed"
        ? "failed"
        : outcome === "parsed" || outcome === "unchanged"
          ? "complete"
          : "partial",
    outcome,
    changed: outcome !== "unchanged",
    document_id: documentId,
    document_name: summary.document_name,
    before: summary,
    after: summary,
    fallback_attempted: false,
    fallback: null,
    candidates: { created: 0, reused: 0, superseded: 0, failed_findings: [] },
  };
}

describe("Agent 2 document reprocess batching", () => {
  it("runs documents sequentially and reports progress", async () => {
    const active: string[] = [];
    const order: string[] = [];
    const progress: number[] = [];
    const batch = await executeSequentialDocumentReprocess(
      ["one", "two", "three"],
      async (documentId) => {
        assert.equal(active.length, 0);
        active.push(documentId);
        order.push(documentId);
        await Promise.resolve();
        active.pop();
        return result(documentId, "parsed");
      },
      String,
      (completed) => progress.push(completed),
    );
    assert.deepEqual(order, ["one", "two", "three"]);
    assert.deepEqual(progress, [1, 2, 3]);
    assert.equal(batch.results.length, 3);
  });

  it("continues after a per-document failure and summarizes partial results", async () => {
    const batch = await executeSequentialDocumentReprocess(
      ["parsed", "broken", "pending", "unchanged"],
      async (documentId) => {
        if (documentId === "broken") throw new Error("storage unavailable");
        if (documentId === "pending") return result(documentId, "still_needs_fallback");
        return result(documentId, documentId === "unchanged" ? "unchanged" : "parsed");
      },
      (error) => (error instanceof Error ? error.message : String(error)),
    );
    const summary = summarizeDocumentReprocessBatch(4, batch);
    assert.deepEqual(
      {
        processed: summary.processed,
        parsed: summary.parsed,
        pending: summary.stillNeedsFallback,
        failed: summary.failed,
        unchanged: summary.unchanged,
      },
      { processed: 4, parsed: 1, pending: 1, failed: 1, unchanged: 1 },
    );
    assert.match(summary.message, /processed 4\/4/);
  });
});
