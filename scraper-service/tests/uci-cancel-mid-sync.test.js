"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  isUciPortalSyncJobCancelled,
  pollUciPortalSyncJobCancelled,
} = require("../app/services/uci/uci-portal-sync-job-store.js");

describe("UCI durable cancel regression", () => {
  it("treats cancelling status as cancelled for workers", () => {
    assert.equal(
      isUciPortalSyncJobCancelled({ status: "cancelling", metadata: {} }),
      true,
    );
    assert.equal(
      isUciPortalSyncJobCancelled({
        status: "running",
        metadata: { uci: { terminal_reason: "user_cancelled" } },
      }),
      true,
    );
    assert.equal(
      isUciPortalSyncJobCancelled({ status: "running", metadata: {} }),
      false,
    );
  });

  it("pollUciPortalSyncJobCancelled reads durable cancelling", async () => {
    const row = { id: "uci-job-1", status: "cancelling", metadata: {} };
    const supabase = {
      from(table) {
        assert.equal(table, "scrape_jobs");
        return {
          select() {
            return {
              eq() {
                return {
                  maybeSingle: async () => ({ data: row, error: null }),
                };
              },
            };
          },
        };
      },
    };
    assert.equal(await pollUciPortalSyncJobCancelled(supabase, row.id), true);
  });

  it("runPortalSync accepts mid-sync cancel checker", async () => {
    const src = require("fs").readFileSync(
      require("path").join(
        __dirname,
        "../app/services/uci/uci-portal-sync.service.js",
      ),
      "utf8",
    );
    assert.match(src, /isCancelRequested/);
    assert.match(src, /CANCELLED/);

    const executor = require("fs").readFileSync(
      require("path").join(
        __dirname,
        "../app/services/uci/uci-durable-worker-executor.js",
      ),
      "utf8",
    );
    assert.match(executor, /isCancelRequested:\s*\(\)\s*=>\s*pollUciPortalSyncJobCancelled/);
    assert.match(executor, /code === "CANCELLED"/);
  });
});
