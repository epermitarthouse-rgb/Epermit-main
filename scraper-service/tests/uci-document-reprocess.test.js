"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  MAX_FALLBACK_PAGES_PER_REPROCESS,
  activeReprocesses,
  reprocessDocument,
  requiredFallbackMethods,
  resolveOutcome,
} = require("../app/services/uci/uci-document-reprocess.service.js");
const {
  classifyDocumentFallbackStatus,
} = require("../app/services/uci/uci-document-processing.service.js");

function summary(overrides = {}) {
  return {
    processing_status: "complete",
    pages_requiring_fallback: 0,
    pages_fallback_failed: 0,
    pages_manual_review: 0,
    unavailable_fallback_methods: [],
    signature: "after",
    ...overrides,
  };
}

describe("uci-document-reprocess orchestration semantics", () => {
  it("distinguishes parsed, unchanged, pending, unavailable, failed, and manual review", () => {
    const before = summary({ signature: "before" });
    assert.equal(resolveOutcome(before, summary(), false), "parsed");
    assert.equal(
      resolveOutcome(before, summary({ signature: "before" }), false),
      "unchanged",
    );
    assert.equal(
      resolveOutcome(before, summary({ processing_status: "partial", pages_requiring_fallback: 1 }), false),
      "still_needs_fallback",
    );
    assert.equal(
      resolveOutcome(before, summary({ unavailable_fallback_methods: ["vision"] }), false),
      "fallback_unavailable",
    );
    assert.equal(
      resolveOutcome(before, summary({ pages_fallback_failed: 1, findings_count: 0 }), true),
      "fallback_failed",
    );
    assert.equal(
      resolveOutcome(before, summary({ pages_fallback_failed: 1, findings_count: 2 }), true),
      "parsed_with_fallback_warning",
    );
    assert.equal(
      resolveOutcome(before, summary({ pages_manual_review: 1 }), true),
      "manual_review_required",
    );
    assert.equal(
      resolveOutcome(before, summary({ processing_status: "failed" }), false),
      "failed",
    );
  });

  it("detects required fallback methods and provider availability accurately", () => {
    const document = {
      page_records: [
        { page_number: 1, status: "vision_required" },
        { page_number: 2, status: "ocr_required" },
      ],
    };
    assert.deepEqual([...requiredFallbackMethods(document)].sort(), ["ocr", "vision"]);
    assert.equal(
      classifyDocumentFallbackStatus(document, {
        vision_available: true,
        ocr_available: false,
      }),
      "unavailable",
    );
    assert.equal(
      classifyDocumentFallbackStatus(document, {
        vision_available: true,
        ocr_available: true,
      }),
      "pending",
    );
  });

  it("bounds fallback work for each reprocess request", () => {
    assert.equal(MAX_FALLBACK_PAGES_PER_REPROCESS, 1);
  });

  it("rejects duplicate concurrent work for the same scoped document", async () => {
    const params = {
      coordinationRecordId: "coord-1",
      externalApplicationId: "",
      documentId: "doc-1",
    };
    const key = "coord-1||doc-1";
    activeReprocesses.set(key, new Promise(() => {}));
    await assert.rejects(
      () => reprocessDocument({}, params),
      (error) => {
        assert.equal(error.statusCode, 409);
        assert.equal(error.code, "DOCUMENT_REPROCESS_IN_PROGRESS");
        return true;
      },
    );
    activeReprocesses.delete(key);
  });
});
