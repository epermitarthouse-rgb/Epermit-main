"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const ORIGINAL_ENABLED = process.env.UCI_NORMALIZED_SYNC_ENABLED;

describe("UCI D1A PEPCO orchestrator hook", () => {
  it("swallows orchestrator failures without throwing", async () => {
    process.env.UCI_NORMALIZED_SYNC_ENABLED = "true";

    const { maybeRunNormalizedPortalSyncAfterPersist } = require(
      "../app/services/uci/uci-pepco-application-detail-discovery.service.js",
    );

    const supabase = {
      from() {
        throw new Error("simulated sync persistence failure");
      },
    };

    await assert.doesNotReject(async () => {
      await maybeRunNormalizedPortalSyncAfterPersist(supabase, "coord-1", "proj-1", [
        {
          applicationUuid: "uuid-1",
          currentStatus: "Submitted",
          statusChanges: [],
          messages: [],
        },
      ]);
    });

    process.env.UCI_NORMALIZED_SYNC_ENABLED = ORIGINAL_ENABLED;
  });

  it("is disabled when UCI_NORMALIZED_SYNC_ENABLED=false", async () => {
    process.env.UCI_NORMALIZED_SYNC_ENABLED = "false";

    const { maybeRunNormalizedPortalSyncAfterPersist } = require(
      "../app/services/uci/uci-pepco-application-detail-discovery.service.js",
    );

    let called = false;
    const supabase = {
      from() {
        called = true;
        throw new Error("should not be called");
      },
    };

    await maybeRunNormalizedPortalSyncAfterPersist(supabase, "coord-1", "proj-1", []);
    assert.equal(called, false);

    process.env.UCI_NORMALIZED_SYNC_ENABLED = ORIGINAL_ENABLED;
  });
});
