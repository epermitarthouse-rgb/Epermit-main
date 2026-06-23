"use strict";

const assert = require("node:assert/strict");
const {
  sanitizeTechnicalMessage,
  mapTechnicalErrorToUserMessage,
  mapSessionStatusToJobStatus,
  applySessionStatusFromScrapeEvent,
} = require("./scrape-events.js");

assert.equal(
  sanitizeTechnicalMessage("password=secret"),
  "Technical details redacted for security.",
);

assert.equal(
  mapTechnicalErrorToUserMessage("permit not found in portal"),
  "The permit was not found in the selected portal.",
);

assert.equal(mapSessionStatusToJobStatus("partial_success_attachments_pending"), "completed_with_warnings");
assert.equal(mapSessionStatusToJobStatus("done"), "completed");

const sessionDone = { status: "done" };
applySessionStatusFromScrapeEvent(sessionDone, "running");
assert.equal(sessionDone.status, "done");

const sessionScraping = { status: "scraping" };
applySessionStatusFromScrapeEvent(sessionScraping, "completed");
assert.equal(sessionScraping.status, "done");

console.log("scrape-events.selftest: ok");
