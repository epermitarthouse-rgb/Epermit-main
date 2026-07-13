import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  normalizedSyncDrawerMessage,
  portalSyncResponseToNormalizedResult,
} from "./uciNormalizedSync.ts";

describe("uciNormalizedSync helpers", () => {
  it("maps manual portal sync summary to normalized result statuses", () => {
    const success = portalSyncResponseToNormalizedResult({
      providerSlug: "pepco",
      applications: { discovered: 1, inserted: 1, updated: 0, skipped: 0, failed: 0 },
      communications: { discovered: 1, inserted: 1, updated: 0, skipped: 0, failed: 0 },
      milestones: { discovered: 1, inserted: 1, updated: 0, skipped: 0, failed: 0 },
      warnings: [],
      errors: [],
      syncedAt: "2026-07-14T00:00:00.000Z",
    });
    assert.equal(success.status, "success");

    const partial = portalSyncResponseToNormalizedResult({
      providerSlug: "pepco",
      applications: { discovered: 1, inserted: 1, updated: 0, skipped: 0, failed: 0 },
      communications: { discovered: 1, inserted: 0, updated: 0, skipped: 0, failed: 1 },
      milestones: { discovered: 0, inserted: 0, updated: 0, skipped: 0, failed: 0 },
      warnings: [],
      errors: ["communication_insert_failed"],
      syncedAt: "2026-07-14T00:00:00.000Z",
    });
    assert.equal(partial.status, "partial");
  });

  it("formats drawer messages for partial and failed sync", () => {
    const partialMsg = normalizedSyncDrawerMessage({
      status: "partial",
      applications: { discovered: 1, inserted: 1, updated: 0, skipped: 0, failed: 0 },
      communications: { discovered: 1, inserted: 0, updated: 0, skipped: 0, failed: 1 },
      milestones: { discovered: 0, inserted: 0, updated: 0, skipped: 0, failed: 0 },
      errors: ["communication_insert_failed"],
    });
    assert.match(String(partialMsg), /partial/i);
    assert.match(String(partialMsg), /Re-sync normalized data/i);

    const failedMsg = normalizedSyncDrawerMessage({
      status: "failed",
      applications: { discovered: 0, inserted: 0, updated: 0, skipped: 0, failed: 0 },
      communications: { discovered: 0, inserted: 0, updated: 0, skipped: 0, failed: 0 },
      milestones: { discovered: 0, inserted: 0, updated: 0, skipped: 0, failed: 0 },
      errors: ["sync exploded"],
    });
    assert.match(String(failedMsg), /system data sync failed/i);
  });
});
