"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  buildNormalizedSyncApiResult,
  buildNormalizedSyncApiResultFromSummary,
  deriveNormalizedSyncStatusFromSummary,
  maybeRunNormalizedPortalSyncAfterPersist,
} = require("../app/services/uci/uci-pepco-application-detail-discovery.service.js");

const ORIGINAL_ENABLED = process.env.UCI_NORMALIZED_SYNC_ENABLED;

describe("UCI normalized sync API result", () => {
  it("derives success when no errors or failed counts", () => {
    const status = deriveNormalizedSyncStatusFromSummary({
      applications: { discovered: 1, inserted: 1, updated: 0, skipped: 0, failed: 0 },
      communications: { discovered: 2, inserted: 2, updated: 0, skipped: 0, failed: 0 },
      milestones: { discovered: 3, inserted: 3, updated: 0, skipped: 0, failed: 0 },
      errors: [],
      syncedAt: "2026-07-14T00:00:00.000Z",
    });
    assert.equal(status, "success");
  });

  it("derives partial when some rows changed and some failed", () => {
    const status = deriveNormalizedSyncStatusFromSummary({
      applications: { discovered: 1, inserted: 1, updated: 0, skipped: 0, failed: 0 },
      communications: { discovered: 1, inserted: 0, updated: 0, skipped: 0, failed: 1 },
      milestones: { discovered: 0, inserted: 0, updated: 0, skipped: 0, failed: 0 },
      errors: ["communication_insert_failed"],
      syncedAt: "2026-07-14T00:00:00.000Z",
    });
    assert.equal(status, "partial");
  });

  it("builds failed result when sync throws without failing scrape", async () => {
    process.env.UCI_NORMALIZED_SYNC_ENABLED = "true";

    const result = await maybeRunNormalizedPortalSyncAfterPersist(
      {
        from() {
          throw new Error("simulated sync persistence failure");
        },
      },
      "coord-1",
      "proj-1",
      [
        {
          applicationUuid: "uuid-1",
          currentStatus: "Submitted",
          statusChanges: [],
          messages: [],
        },
      ],
    );

    assert.equal(result.status, "failed");
    assert.match(result.errors[0], /simulated sync persistence failure/);

    process.env.UCI_NORMALIZED_SYNC_ENABLED = ORIGINAL_ENABLED;
  });

  it("returns not_run when sync is disabled", async () => {
    process.env.UCI_NORMALIZED_SYNC_ENABLED = "false";

    const result = await maybeRunNormalizedPortalSyncAfterPersist(
      {
        from() {
          throw new Error("should not be called");
        },
      },
      "coord-1",
      "proj-1",
      [{ applicationUuid: "uuid-1" }],
    );

    assert.equal(result.status, "not_run");
    assert.equal(result.reason, "disabled");

    process.env.UCI_NORMALIZED_SYNC_ENABLED = ORIGINAL_ENABLED;
  });

  it("maps summary into API payload with safe errors", () => {
    const payload = buildNormalizedSyncApiResultFromSummary({
      applications: { discovered: 1, inserted: 1, updated: 0, skipped: 0, failed: 0 },
      communications: { discovered: 0, inserted: 0, updated: 0, skipped: 0, failed: 0 },
      milestones: { discovered: 0, inserted: 0, updated: 0, skipped: 0, failed: 0 },
      errors: [],
      syncedAt: "2026-07-14T00:00:00.000Z",
    });

    assert.equal(payload.status, "success");
    assert.equal(payload.synced_at, "2026-07-14T00:00:00.000Z");
    assert.deepEqual(payload.applications, {
      discovered: 1,
      inserted: 1,
      updated: 0,
      skipped: 0,
      failed: 0,
    });
  });

  it("builds explicit not_run payload", () => {
    const payload = buildNormalizedSyncApiResult({
      status: "not_run",
      reason: "no_applications",
    });
    assert.equal(payload.status, "not_run");
    assert.equal(payload.reason, "no_applications");
    assert.equal(payload.errors.length, 0);
  });
});
