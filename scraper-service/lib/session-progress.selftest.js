"use strict";

const assert = require("node:assert/strict");
const { resolveMirrorStatus } = require("./session-progress.js");

assert.equal(resolveMirrorStatus({ event_type: "scrape_completed" }), "completed");
assert.equal(resolveMirrorStatus({ event_type: "scrape_failed" }), "failed");
assert.equal(resolveMirrorStatus({ event_type: "scrape_cancelled" }), "cancelled");
assert.equal(resolveMirrorStatus({ event_type: "section_progress" }), "running");
assert.equal(
  resolveMirrorStatus({ event_type: "scrape_completed", status: "completed_with_warnings" }),
  "completed_with_warnings",
);

console.log("session-progress.selftest: ok");
