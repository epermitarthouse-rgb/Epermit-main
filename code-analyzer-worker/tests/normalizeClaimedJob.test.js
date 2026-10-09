"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { normalizeClaimedJob } = require("../lib/normalizeClaimedJob");

describe("normalizeClaimedJob", () => {
  it("returns null for undefined and SQL-null RPC payloads", () => {
    assert.equal(normalizeClaimedJob(undefined), null);
    assert.equal(normalizeClaimedJob(null), null);
    assert.equal(
      normalizeClaimedJob({ id: null, project_id: null, status: null }),
      null,
    );
  });

  it("returns the row when id is present", () => {
    const row = { id: "job-1", status: "pending" };
    assert.equal(normalizeClaimedJob(row), row);
  });
});
