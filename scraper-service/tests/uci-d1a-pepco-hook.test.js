"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const ORIGINAL_ENABLED = process.env.UCI_NORMALIZED_SYNC_ENABLED;

describe("UCI D1A PEPCO orchestrator hook", () => {
  it("returns failed normalized_sync without throwing when sync persistence fails", async () => {
    process.env.UCI_NORMALIZED_SYNC_ENABLED = "true";

    const { maybeRunNormalizedPortalSyncAfterPersist } = require(
      "../app/services/uci/uci-pepco-application-detail-discovery.service.js",
    );

    const supabase = {
      from() {
        throw new Error("simulated sync persistence failure");
      },
    };

    const result = await maybeRunNormalizedPortalSyncAfterPersist(supabase, "coord-1", "proj-1", [
      {
        applicationUuid: "uuid-1",
        currentStatus: "Submitted",
        statusChanges: [],
        messages: [],
      },
    ]);

    assert.equal(result.status, "failed");
    assert.match(result.errors[0], /simulated sync persistence failure/);

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

    const result = await maybeRunNormalizedPortalSyncAfterPersist(supabase, "coord-1", "proj-1", []);
    assert.equal(called, false);
    assert.equal(result.status, "not_run");
    assert.equal(result.reason, "disabled");

    process.env.UCI_NORMALIZED_SYNC_ENABLED = ORIGINAL_ENABLED;
  });
});
