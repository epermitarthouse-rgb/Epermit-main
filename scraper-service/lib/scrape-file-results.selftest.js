"use strict";

const assert = require("node:assert/strict");
const {
  buildFilesTabFromRows,
  portalFileEntryFromRow,
  downloadStatusFromRow,
  sanitizeFailureMessage,
} = require("./scrape-file-results.js");

const uploadedRow = {
  status: "uploaded",
  file_name: "E0.02 ELECT DETAILS.pdf",
  portal_file_id: "4152380",
  file_version: "1",
  folder_name: "Drawings",
  public_url: "https://example.com/storage/file.pdf",
  size_bytes: 204800,
};

const failedRow = {
  status: "failed",
  file_name: "bad.pdf",
  portal_file_id: "4152381",
  file_version: "",
  folder_name: "Drawings",
  failure_message: "timeout after 30000ms",
};

assert.equal(downloadStatusFromRow(uploadedRow), "success");
assert.equal(downloadStatusFromRow(failedRow), "failed");

const entry = portalFileEntryFromRow(uploadedRow);
assert.equal(entry.viewUrl, uploadedRow.public_url);
assert.equal(entry.downloadStatus, "success");
assert.equal(entry.fileId, "4152380");

const failedEntry = portalFileEntryFromRow(failedRow);
assert.equal(failedEntry.viewUrl, "");
assert.equal(failedEntry.downloadStatus, "failed");
assert.ok(failedEntry.downloadError);

const tab = buildFilesTabFromRows([uploadedRow, failedRow]);
assert.equal(tab.folders.length, 1);
assert.equal(tab.folders[0].files.length, 2);

assert.equal(
  sanitizeFailureMessage("password=secret"),
  "Technical details redacted for security.",
);

console.log("scrape-file-results.selftest: ok");
