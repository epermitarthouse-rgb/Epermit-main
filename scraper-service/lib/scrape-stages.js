"use strict";

/** Canonical scrape stages shared by every jurisdiction. */
const SCRAPE_STAGES = Object.freeze({
  QUEUED: "queued",
  LAUNCHING: "launching",
  LOGGING_IN: "logging_in",
  PORTAL_READY: "portal_ready",
  LOCATING_PROJECT: "locating_project",
  OPENING_PROJECT: "opening_project",
  LOADING_SECTION: "loading_section",
  DISCOVERING_RECORDS: "discovering_records",
  PROCESSING_RECORDS: "processing_records",
  DOWNLOADING: "downloading",
  UPLOADING: "uploading",
  SAVING: "saving",
  COMPLETED: "completed",
  COMPLETED_WITH_WARNINGS: "completed_with_warnings",
  FAILED: "failed",
  CANCELLED: "cancelled",
});

module.exports = { SCRAPE_STAGES };
