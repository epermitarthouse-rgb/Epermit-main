import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ENRICHMENT_BATCH_SIZE,
  computeEnrichmentBatchProgress,
  requiredEnrichmentBatches,
  simulateEnrichmentContinuation,
} from "./enrichmentBatching.ts";

describe("enrichmentBatching", () => {
  it("uses a 20-row batch size (historical ceiling)", () => {
    assert.equal(ENRICHMENT_BATCH_SIZE, 20);
  });

  it("requires 4 controlled batches for a 62-comment eligible set", () => {
    assert.equal(requiredEnrichmentBatches(62), 4);
    assert.equal(requiredEnrichmentBatches(20), 1);
    assert.equal(requiredEnrichmentBatches(21), 2);
    assert.equal(requiredEnrichmentBatches(0), 0);
  });

  it("marks hasMore until eligible rows are drained", () => {
    const first = computeEnrichmentBatchProgress({
      eligibleBefore: 62,
      fetched: 20,
      enriched: 20,
    });
    assert.equal(first.remainingAfter, 42);
    assert.equal(first.hasMore, true);

    const last = computeEnrichmentBatchProgress({
      eligibleBefore: 2,
      fetched: 2,
      enriched: 2,
    });
    assert.equal(last.remainingAfter, 0);
    assert.equal(last.hasMore, false);
  });

  it("stops without claiming hasMore when a batch makes no progress", () => {
    const stuck = computeEnrichmentBatchProgress({
      eligibleBefore: 42,
      fetched: 20,
      enriched: 0,
    });
    assert.equal(stuck.hasMore, false);
    assert.equal(stuck.remainingAfter, 42);
  });

  it("pipeline continuation enriches all 62 eligible rows across batches", () => {
    const result = simulateEnrichmentContinuation({ eligibleCount: 62 });
    assert.equal(result.rounds, 4);
    assert.equal(result.totalEnriched, 62);
    assert.equal(result.remaining, 0);
    assert.equal(result.stoppedReason, "drained");
  });

  it("does not treat a single 20-row batch as complete for 62 rows", () => {
    const oneShot = simulateEnrichmentContinuation({
      eligibleCount: 62,
      maxRounds: 1,
    });
    assert.equal(oneShot.totalEnriched, 20);
    assert.equal(oneShot.remaining, 42);
    assert.equal(oneShot.stoppedReason, "max_rounds");
  });
});
