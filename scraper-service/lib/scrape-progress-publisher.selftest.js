"use strict";

const assert = require("node:assert/strict");
const {
  shouldInsertFeedEvent,
  defaultDedupeKey,
  buildNormalizedEvent,
} = require("./scrape-progress-publisher.js");

const session = { progress: 3, total: 10, _scrapeJurisdiction: "Test" };

const normalized = buildNormalizedEvent(session, {
  stage: "downloading",
  user_message: "Downloading file 3 of 10.",
  entityType: "file",
  progress_current: 3,
  progress_total: 10,
});

assert.equal(normalized.stage, "downloading");
assert.equal(normalized.current, 3);

const key = defaultDedupeKey(normalized);
assert.ok(key.includes("downloading"));

const stageChange = buildNormalizedEvent(session, {
  stage: "saving",
  user_message: "Saving results.",
});
assert.equal(shouldInsertFeedEvent("job-2", stageChange), true);

const file11 = buildNormalizedEvent(session, {
  stage: "downloading",
  user_message: "Downloading file 11 of 100.",
  entityType: "file",
  progress_current: 11,
});
const file10 = buildNormalizedEvent(session, {
  stage: "downloading",
  user_message: "Downloading file 10 of 100.",
  entityType: "file",
  progress_current: 10,
});
assert.equal(shouldInsertFeedEvent("job-3", file11), false);
assert.equal(shouldInsertFeedEvent("job-4", file10), true);

console.log("scrape-progress-publisher.selftest: ok");
