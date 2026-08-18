"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const AdmZip = require("adm-zip");
const {
  buildStructuredPackageExport,
  renderPackageSummaryPdf,
  buildCompletePackageZip,
  friendlyFieldProvenance,
} = require("../app/services/uci/uci-package-export.service.js");

const ORIGINAL_BYTES = Buffer.from("%PDF-1.7\nunchanged signed source bytes\n");

function exportContext() {
  const reviewedSnapshot = {
    snapshot_version: "agent-3-reviewed-package-snapshot-v1",
    package_review_version: "agent-3-package-review-v2",
    checklist_version: "dominion-commercial-service-synthetic-v1",
    captured_at: "2026-08-17T10:25:38.015Z",
    reviewer: { user_id: "user-1", display: "Reviewer One" },
  };
  return {
    application: {
      id: "app-1",
      project_id: "project-1",
      coordination_record_id: "coord-1",
      provider_slug: "dominion",
      draft_status: "reviewed",
      metadata: { template_version: "synthetic-v1" },
      agent_draft_metadata: {},
      package_documents: [
        {
          key: "authorization",
          label: "Letter of authorization",
          status: "attached",
          source: "project_documents",
          project_document_id: "doc-1",
          file_name: "06 Synthetic LOA SIGNED.pdf",
          signature_required: true,
          signature_status: "signed_manual_verified",
          signature_verified_at: "2026-08-17T10:16:06.263Z",
        },
      ],
    },
    metadata: {},
    pkg: {
      template_id: "dominion-commercial-service-synthetic-v1",
      checklist_mode: "synthetic_test",
      checklist_label: "SYNTHETIC TEST CHECKLIST — NOT DOMINION PROVIDED",
      authoritative_requirements: false,
      package_status: "ready_for_review",
      built_at: "2026-08-17T09:00:00.000Z",
      field_results: [
        {
          key: "connected_load",
          label: "Connected load",
          status: "present",
          source: "load_summary.verified_values.connected_load",
          value: {
            value: 415,
            unit: "kW",
            evidence_sources: [{ source_document_name: "Load Schedule.pdf", page_number: 3 }],
          },
        },
      ],
      signature_requirements: [],
      package_review: { review_notes: "Checked against the synthetic exercise." },
    },
    project: {
      id: "project-1",
      name: "Highland Springs",
      project_type: "tenant_improvement",
    },
    record: {
      id: "coord-1",
      project_id: "project-1",
      utility_type: "electric",
      current_stage: 3,
      current_stage_state: "COMPLETED",
      utility_providers: { name: "Dominion Energy Virginia" },
    },
    review: {
      status: "reviewed",
      reviewer_display: "Reviewer One",
      reviewed_by_user_id: "user-1",
      reviewed_at: "2026-08-17T10:25:38.015Z",
      confirmed_count: 2,
      total_count: 2,
      items: [],
      reviewed_snapshot: reviewedSnapshot,
      review_history: [reviewedSnapshot],
    },
  };
}

function fakeSupabase() {
  return {
    from(table) {
      assert.equal(table, "project_documents");
      const chain = {
        select() {
          return chain;
        },
        eq() {
          return chain;
        },
        async maybeSingle() {
          return {
            data: {
              id: "doc-1",
              project_id: "project-1",
              file_name: "06 Synthetic LOA SIGNED.pdf",
              file_path: "project-1/original-loa.pdf",
              file_type: "application/pdf",
              file_size: ORIGINAL_BYTES.length,
              created_at: "2026-08-16T12:00:00.000Z",
            },
            error: null,
          };
        },
      };
      return chain;
    },
    storage: {
      from(bucket) {
        assert.equal(bucket, "project-documents");
        return {
          async download(storagePath) {
            assert.equal(storagePath, "project-1/original-loa.pdf");
            return {
              data: new Blob([ORIGINAL_BYTES], { type: "application/pdf" }),
              error: null,
            };
          },
        };
      },
    },
  };
}

describe("UCI Agent 3 package exports", () => {
  it("labels generalized structured JSON as non-submittable and synthetic", () => {
    const result = buildStructuredPackageExport(exportContext(), "2026-08-18T00:00:00.000Z");
    assert.equal(result.suitable_for_utility_submission, false);
    assert.equal(result.synthetic_test, true);
    assert.match(result.submission_warning, /not a provider application/i);
    assert.equal(result.package.reviewed_snapshot.snapshot_version, "agent-3-reviewed-package-snapshot-v1");
  });

  it("renders friendly Agent 2 provenance into a valid summary PDF", async () => {
    assert.equal(
      friendlyFieldProvenance(exportContext().pkg.field_results[0]),
      "Load Profile Analyzer — Verified Input · Load Schedule.pdf · page 3",
    );
    const pdf = await renderPackageSummaryPdf(exportContext(), "2026-08-18T00:00:00.000Z");
    assert.equal(pdf.subarray(0, 5).toString("utf8"), "%PDF-");
    assert.ok(pdf.length > 1_000);
  });

  it("builds a complete ZIP with manifest, summary, snapshot, and unchanged original bytes", async () => {
    const result = await buildCompletePackageZip(
      fakeSupabase(),
      exportContext(),
      "2026-08-18T00:00:00.000Z",
    );
    const zip = new AdmZip(result.buffer);
    const names = zip.getEntries().map((entry) => entry.entryName);
    assert.ok(names.includes("package_summary.pdf"));
    assert.ok(names.includes("package_manifest.json"));
    assert.ok(names.includes("structured/package_record.json"));
    assert.ok(names.includes("metadata/reviewed_snapshot.json"));
    const originalPath =
      "source-documents/authorization/06 Synthetic LOA SIGNED.pdf";
    assert.ok(names.includes(originalPath));
    assert.deepEqual(zip.readFile(originalPath), ORIGINAL_BYTES);
    const manifest = JSON.parse(zip.readAsText("package_manifest.json"));
    assert.equal(manifest.originals_preserved, true);
    assert.equal(manifest.signed_sources_modified, false);
    assert.equal(manifest.source_documents[0].original_file_name, "06 Synthetic LOA SIGNED.pdf");
  });
});
