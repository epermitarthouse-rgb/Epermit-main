"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { stableStringify, sha256, keyedItem } = require("../permit-sync/core/canonical");
const { redactPayload, redactText } = require("../permit-sync/core/redact");
const { buildBatch, buildDiscovery } = require("../permit-sync/core/ingest");
const dc = require("../permit-sync/adapters/dc-projectdox/normalize");

const FIX = path.join(__dirname, "fixtures", "permit-sync", "dc");
const inventory = require(path.join(FIX, "inventory.json"));
const status = require(path.join(FIX, "workflow-status-resubmit.json"));
const folders = require(path.join(FIX, "project-folders-approved.json"));
const corrections = require(path.join(FIX, "corrections-resubmit.json"));

test("canonical hashing ignores key order and undefined values", () => {
  assert.equal(stableStringify({ b: 1, a: { d: 2, c: undefined } }), '{"a":{"d":2},"b":1}');
  assert.equal(sha256({ x: 1, y: [1, 2] }), sha256({ y: [1, 2], x: 1 }));
  assert.notEqual(sha256({ x: 1 }), sha256({ x: 2 }));
  assert.throws(() => keyedItem("", {}), /non-empty key/);
});

test("redaction strips emails, phones, JWTs, signed URLs and contact keys", () => {
  const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.c2lnbmF0dXJlc2lnbmF0dXJl";
  assert.equal(redactText(`mail a.b@example.com or call (202) 555-0142 ${jwt}`), "mail [email] or call [phone] [token]");
  const out = redactPayload({
    ContactEmail: "x@y.com",
    Phone: "2025550142",
    Thumbnail: "https://blob/x?sig=abc",
    Url: "https://blob/x?sv=1&sig=secret",
    Nested: [{ SessionID: jwt, Name: "Drawings", FilesCount: 44 }],
  });
  assert.deepEqual(out, { Url: "https://blob/x?sv=[redacted]&sig=[redacted]", Nested: [{ Name: "Drawings", FilesCount: 44 }] });
});

test("discovery: dashboard rows map to records keyed by ProjectID; rows without an id are rejected", () => {
  const withId = inventory.records.filter((r) => r.projectId !== null);
  const recs = withId.map(dc.discoveryRecord);
  assert.equal(new Set(recs.map((r) => r.portal_record_id)).size, withId.length);
  const d = recs.find((r) => r.fields.permit_number === "D2500488");
  assert.equal(d.portal_record_id, "11854");
  assert.equal(d.fields.status, "resubmit");
  assert.equal(d.fields.permit_number_normalized, "D2500488");
  assert.equal(d.fields.jurisdiction, "Washington DC");
  assert.throws(() => dc.discoveryRecord({ permit: "B2605178", projectId: null, status: "Upload" }), /no ProjectID/);
  assert.equal(dc.mapStatus("In Review"), "in_review");
  assert.equal(dc.mapStatus("Something New"), "other");
});

test("status JSON → permit fields and unresolved parity source", () => {
  const f = dc.statusFields(status);
  assert.equal(f.status, "resubmit");
  assert.equal(f.review_type, "BIC Building");
  assert.equal(f.total_files, 40);
  assert.equal(f.unresolved_comments, 1);
  assert.equal(f.uncompleted_tasks, 1);
  assert.deepEqual(f.summary.open_task_groups, ["Applicant"]);
  assert.equal(f.summary.unresolved_by_group.find((g) => g.group === "DOEE EV").unresolved, 1);
  assert.equal(dc.statusUnresolvedTotal(status), 1);
});

test("reviews: comments keyed by REF #, responses threaded, role labels only", () => {
  const { comments, responses } = dc.reviewItems(corrections.rows);
  assert.deepEqual(comments.map((c) => c.key).sort(), ["ref:3", "ref:4", "ref:5"]);
  const unresolved = comments.filter((c) => c.fields.status === "Unresolved");
  assert.equal(unresolved.length, dc.statusUnresolvedTotal(status), "Reviews rows agree with status JSON");
  assert.equal(comments.find((c) => c.key === "ref:5").fields.response_required, false);
  assert.equal(comments.find((c) => c.key === "ref:3").fields.response_required, true);
  for (const c of comments) {
    assert.equal(c.fields.reviewer_name, null);
    assert.equal(c.fields.reviewer_role, "reviewer");
  }
  assert.equal(responses.length, 3, "ref 4: one applicant entry; ref 3: applicant then reviewer");
  assert.equal(responses[0].key, "ref:4:r1");
  assert.equal(responses[0].fields.comment_key, "ref:4");
  assert.equal(responses[0].fields.responder_name, null);
  assert.deepEqual(responses.filter((r) => r.fields.comment_key === "ref:3").map((r) => r.fields.responder_role), ["applicant", "reviewer"]);
});

test("offset-less portal times are converted from America/New_York to UTC (DST-aware)", () => {
  assert.equal(dc.zonedToUtcIso("2025-09-15T08:37:00"), "2025-09-15T12:37:00.000Z");
  assert.equal(dc.zonedToUtcIso("2026-01-07T16:43:00"), "2026-01-07T21:43:00.000Z");
  const { comments } = dc.reviewItems(corrections.rows);
  assert.equal(comments.find((c) => c.key === "ref:4").fields.reviewed_at, "2025-09-15T12:37:00.000Z");
  assert.equal(dc.zonedToUtcIso("2026-01-07T16:43:00Z"), "2026-01-07T16:43:00Z");
});

test("files: folder metadata kept, download_permitted follows the account flag, placeholder dates dropped", () => {
  const files = {
    15: [{ FileID: 900001, Version: 2, FileName: "A-101.pdf", FileStatus: "New V2", FileSize: 1024, PageCount: 1, LastModDate: "0001-01-01T00:00:00", Thumbnail: "https://signed" }],
  };
  const { folders: fo, documents } = dc.fileItems(folders.folders, files, { accountDownload: false });
  assert.equal(fo.length, 4);
  assert.equal(fo.reduce((n, f) => n + f.fields.files_count, 0), 92);
  assert.ok(fo.every((f) => f.fields.download_permitted === false));
  assert.equal(fo[1].key, "name:Supporting Documents");
  assert.equal(documents.length, 1);
  assert.equal(documents[0].key, "900001");
  assert.equal(documents[0].fields.download_permitted, false);
  assert.equal(documents[0].fields.portal_modified_at, null);
  assert.ok(!("thumbnail" in documents[0].fields));
});

test("buildBatch: count mismatch downgrades ok → partial; failed sections contribute no fields", () => {
  const { comments, responses } = dc.reviewItems(corrections.rows);
  const { batch, warnings } = buildBatch({
    adapterKey: dc.ADAPTER_KEY,
    credentialId: null,
    runId: null,
    portalRecordId: "11854",
    sections: {
      status: { status: "failed", sourceKind: "json", fields: { status: null, total_files: 0 }, error: "timeout" },
      reviews: {
        status: "ok",
        sourceKind: "html",
        tables: { permit_review_comments: comments.slice(0, 2), permit_review_responses: responses },
        expectedCounts: { permit_review_comments: 3 },
        raw: { rows: corrections.rows },
      },
    },
  });
  assert.equal(batch.sections.reviews.status, "partial");
  assert.match(batch.sections.reviews.error, /count_mismatch/);
  assert.equal(warnings.length, 1);
  assert.equal(batch.sections.status.status, "failed");
  assert.deepEqual(batch.sections.status.tables, {});
  assert.ok(!("total_files" in batch.permit.fields), "failed status must not write fields");
  assert.ok(!("available_sections" in batch.permit.fields), "availability unknown while a section failed");
  assert.equal(batch.snapshots.length, 1);
});

test("buildBatch is deterministic for identical input", () => {
  const input = {
    adapterKey: dc.ADAPTER_KEY, portalRecordId: "11854", capturedAt: "2026-11-05T12:00:00Z",
    sections: { status: { status: "ok", sourceKind: "json", fields: dc.statusFields(status), raw: status } },
  };
  assert.deepEqual(buildBatch(input).batch, buildBatch(input).batch);
});

test("buildDiscovery rejects duplicates and only marks complete when counts match", () => {
  const recs = [dc.discoveryRecord({ permit: "A1", projectId: 1, status: "Upload" })];
  assert.equal(buildDiscovery({ adapterKey: "x", records: recs, expectedTotal: 1, complete: true }).complete, true);
  assert.equal(buildDiscovery({ adapterKey: "x", records: recs, expectedTotal: 2, complete: true }).complete, false);
  assert.throws(() => buildDiscovery({ adapterKey: "x", records: [recs[0], recs[0]], expectedTotal: 2 }), /duplicate/);
});
