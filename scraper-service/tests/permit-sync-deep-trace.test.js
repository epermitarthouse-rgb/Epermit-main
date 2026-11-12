"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { passTrace, filesTrace, reasonCode } = require("../permit-sync/deep/runner");

test("reason codes drop URLs and punctuation and stay short", () => {
  assert.equal(reasonCode(null), null);
  assert.equal(reasonCode(""), null);
  assert.equal(reasonCode("download_failed"), "download_failed");
  assert.equal(reasonCode("page.goto: net::ERR_BLOCKED_BY_CLIENT at https://x.example/a?token=abc"), "page.goto: net::ERR_BLOCKED_BY_CLIENT at <url>");
  assert.equal(reasonCode("x".repeat(200)).length, 80);
});

test("files trace counts gate reasons and lists attempted files by id, status and reason only", () => {
  const t = filesTrace({
    folders: [
      { name: "Drawings", files: [
        { name: "A-101 Secret Name.pdf", fileId: "700101", downloadStatus: "failed", downloadError: "download_failed" },
        { name: "A-102.pdf", fileId: "700102", downloadGate: "cap_files" },
        { name: "A-103.pdf", fileId: "700103", downloadGate: "cap_files" },
      ] },
      { name: "Approved Drawings", folderError: "session_expired", files: [{ fileId: "1", downloadGate: "already_stored" }] },
    ],
  });
  assert.deepEqual(t.gated, { cap_files: 2, already_stored: 1 });
  assert.deepEqual(t.attempted, [{ file_id: "700101", status: "failed", error: "download_failed" }]);
  assert.equal(t.attempted_total, 1);
  assert.deepEqual(t.folder_errors, ["session_expired"]);
  assert.ok(!JSON.stringify(t).includes("Secret Name"), "no file names");
});

test("pass trace carries the transport's session-end point and trail only when something went wrong", () => {
  const at = { method: "GET", host: "session.planreview.dob.dc.gov", path: "/WebForms/SessionEnded.aspx", match: "session_ended_page", phase: "read", type: "document", via: "browser" };
  const trail = [{ method: "POST", host: "washington-dc-us-projectdoxwebui.avolvecloud.com", path: "/File/FileViewer", type: "document", rule: "method_dropped", action: "abort" }];
  const ended = passTrace({ transport: { diagnostics: () => ({ sessionEndedAt: at, trail }) }, session: {}, data: { tabs: { files: { folders: [] } } } });
  assert.equal(ended.code, "deep_trace");
  assert.deepEqual(ended.session_ended_at, at);
  assert.deepEqual(ended.trail, trail);
  assert.deepEqual(ended.tabs, { files: "ok" });

  const quiet = passTrace({ transport: { diagnostics: () => ({ sessionEndedAt: null, trail }) }, session: {}, data: { tabs: { files: { folders: [{ files: [{ fileId: "9", downloadStatus: "success" }] }] } } } });
  assert.equal(quiet.session_ended_at, null);
  assert.deepEqual(quiet.trail, [], "a clean pass does not log the request trail");

  const lost = passTrace({ transport: {}, session: { dcDeepSessionLost: "reinitialize_refused" }, data: null });
  assert.equal(lost.session_lost, "reinitialize_refused");
  assert.equal(lost.files, null);
  assert.deepEqual(lost.trail, []);
});
