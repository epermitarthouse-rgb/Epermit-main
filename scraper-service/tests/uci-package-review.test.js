"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  updatePackageReviewItem,
  confirmAllVerifiedFields,
  reviewApplicationPackage,
  summarizePackageReview,
} = require("../app/services/uci/uci-package-review.service.js");

function mockSupabase(application) {
  return {
    from(table) {
      assert.equal(table, "coordination_applications");
      let patch = null;
      return {
        select() {
          return this;
        },
        eq(column, value) {
          assert.equal(column, "id");
          assert.equal(value, application.id);
          return this;
        },
        maybeSingle() {
          return Promise.resolve({ data: application, error: null });
        },
        update(value) {
          patch = value;
          return this;
        },
        single() {
          if (patch) Object.assign(application, patch);
          return Promise.resolve({ data: application, error: null });
        },
      };
    },
  };
}

function readyApplication() {
  return {
    id: "package-1",
    project_id: "project-1",
    record_source: "agent_draft",
    idempotency_key: "agent_3_application_package:d3-v1",
    draft_status: "draft",
    reviewed_by: null,
    reviewed_at: null,
    load_summary: {
      verified_values: {
        connected_load_kva: { value: 410, unit: "kVA", verified_by: "agent-2-reviewer" },
      },
    },
    package_documents: [
      {
        key: "load_letter",
        label: "Load letter",
        status: "attached",
        file_name: "load-letter.pdf",
        source: "project_documents",
        project_document_id: "550e8400-e29b-41d4-a716-446655440002",
      },
    ],
    agent_draft_metadata: {
      application_package: {
        package_status: "ready_for_review",
        field_results: [
          {
            key: "connected_load_kva",
            label: "Connected load",
            status: "present",
            value: { value: 410, unit: "kVA", verified_by: "agent-2-reviewer" },
            source: "load_summary.verified_values.connected_load_kva",
          },
        ],
        verified_load_snapshot: {
          connected_load_kva: { value: 410, unit: "kVA", verified_by: "agent-2-reviewer" },
        },
      },
    },
  };
}

describe("Agent 3 package mapping review", () => {
  it("requires item confirmations before final review and preserves Agent 2 values", async () => {
    const application = readyApplication();
    const supabase = mockSupabase(application);
    const agent2Before = JSON.stringify(application.load_summary);

    await assert.rejects(
      () =>
        reviewApplicationPackage(supabase, {
          applicationId: application.id,
          userId: "operator-1",
          review: { status: "reviewed" },
        }),
      (error) => error.code === "PACKAGE_REVIEW_ITEMS_INCOMPLETE",
    );

    const bulk = await confirmAllVerifiedFields(supabase, {
      applicationId: application.id,
      userId: "operator-1",
    });
    assert.equal(bulk.confirmed_count, 1);
    assert.equal(JSON.stringify(application.load_summary), agent2Before);

    const documentConfirmation = await updatePackageReviewItem(supabase, {
      applicationId: application.id,
      userId: "operator-1",
      kind: "document",
      key: "load_letter",
      status: "confirmed",
    });
    assert.equal(
      documentConfirmation.application.package_review_summary.ready_for_final_review,
      true,
    );
    const storedItems =
      application.agent_draft_metadata.application_package.package_review.items;
    for (const item of Object.values(storedItems)) {
      item.mapping_snapshot = Object.fromEntries(
        Object.entries(item.mapping_snapshot).sort(([left], [right]) =>
          left.localeCompare(right),
        ),
      );
    }
    const readySummary = summarizePackageReview(application);
    assert.equal(readySummary.status, "ready_for_review");
    assert.equal(readySummary.ready_for_final_review, true);

    const result = await reviewApplicationPackage(supabase, {
      applicationId: application.id,
      userId: "operator-1",
      reviewerDisplay: "operator@example.com",
      review: { status: "reviewed", notes: "Package mappings checked" },
    });
    assert.equal(result.review_status, "reviewed");
    assert.equal(application.draft_status, "reviewed");
    assert.equal(JSON.stringify(application.load_summary), agent2Before);
    const snapshot =
      application.agent_draft_metadata.application_package.package_review.reviewed_snapshot;
    assert.equal(snapshot.field_results[0].value.value, 410);
    assert.equal(snapshot.package_documents[0].file_name, "load-letter.pdf");
    await assert.rejects(
      () =>
        updatePackageReviewItem(supabase, {
          applicationId: application.id,
          userId: "operator-1",
          kind: "document",
          key: "load_letter",
          status: "needs_correction",
          note: "Must reopen first",
        }),
      (error) => error.code === "PACKAGE_REVIEW_LOCKED",
    );
  });

  it("blocks document confirm without persisted project_document_id", async () => {
    const application = readyApplication();
    application.package_documents.push({
      key: "load_calculation_worksheet",
      label: "Load calculation worksheet",
      status: "attached",
      file_name: "worksheet.pdf",
      source: "generated_worksheet",
      project_document_id: null,
    });
    const supabase = mockSupabase(application);
    await assert.rejects(
      () =>
        updatePackageReviewItem(supabase, {
          applicationId: application.id,
          userId: "operator-1",
          kind: "document",
          key: "load_calculation_worksheet",
          status: "confirmed",
        }),
      (error) => error.code === "PACKAGE_REVIEW_ITEM_NOT_READY",
    );
  });

  it("invalidates a confirmation when its mapping changes", async () => {
    const application = readyApplication();
    const supabase = mockSupabase(application);
    await updatePackageReviewItem(supabase, {
      applicationId: application.id,
      userId: "operator-1",
      kind: "document",
      key: "load_letter",
      status: "confirmed",
    });
    application.package_documents[0].file_name = "replacement.pdf";
    assert.equal(
      summarizePackageReview(application).items.find((item) => item.id === "document:load_letter")
        .status,
      "ready_for_re_review",
    );
  });

  it("keeps signature verification separate from document confirmation", async () => {
    const application = readyApplication();
    const supabase = mockSupabase(application);
    Object.assign(application.package_documents[0], {
      key: "authorization_letter",
      label: "Letter of authorization",
      signature_required: true,
      signature_status: "unsigned",
      signature_review_note: "Awaiting signed LOA",
    });

    await assert.rejects(
      () =>
        updatePackageReviewItem(supabase, {
          applicationId: application.id,
          userId: "operator-1",
          kind: "document",
          key: "authorization_letter",
          status: "confirmed",
        }),
      (error) => error.code === "PACKAGE_REVIEW_ITEM_NOT_READY",
    );
    assert.equal(summarizePackageReview(application).ready_for_final_review, false);

    Object.assign(application.package_documents[0], {
      signature_status: "signed_manual_verified",
      signature_review_note: "Compared with signed source PDF",
      signature_verified_by: "operator-1",
      signature_verified_at: new Date().toISOString(),
    });
    await updatePackageReviewItem(supabase, {
      applicationId: application.id,
      userId: "operator-1",
      kind: "document",
      key: "authorization_letter",
      status: "confirmed",
    });
    assert.equal(
      summarizePackageReview(application).items.find(
        (item) => item.id === "document:authorization_letter",
      ).status,
      "confirmed",
    );
    application.package_documents[0].signature_status = "unsigned";
    const changedSignature = summarizePackageReview(application);
    const signatureItem = changedSignature.items.find(
      (item) => item.id === "document:authorization_letter",
    );
    assert.equal(signatureItem.status, "needs_correction");
    assert.equal(signatureItem.issue_area, "signature");
    assert.equal(changedSignature.status, "needs_changes");
  });

  it("preserves review history through reopen, correction, fix, reconfirm, and new review", async () => {
    const application = readyApplication();
    const supabase = mockSupabase(application);
    await confirmAllVerifiedFields(supabase, {
      applicationId: application.id,
      userId: "operator-1",
    });
    await updatePackageReviewItem(supabase, {
      applicationId: application.id,
      userId: "operator-1",
      kind: "document",
      key: "load_letter",
      status: "confirmed",
    });
    await reviewApplicationPackage(supabase, {
      applicationId: application.id,
      userId: "operator-1",
      review: { status: "reviewed" },
    });
    const firstSnapshot =
      application.agent_draft_metadata.application_package.package_review.reviewed_snapshot;

    await reviewApplicationPackage(supabase, {
      applicationId: application.id,
      userId: "operator-2",
      review: { status: "needs_changes", notes: "Wrong load letter" },
    });
    assert.equal(summarizePackageReview(application).status, "ready_for_review");
    assert.equal(summarizePackageReview(application).active_correction_count, 0);
    assert.equal(summarizePackageReview(application).ready_for_final_review, true);
    assert.equal(application.draft_status, "draft");
    assert.deepEqual(
      application.agent_draft_metadata.application_package.package_review.reviewed_snapshot,
      firstSnapshot,
    );

    await updatePackageReviewItem(supabase, {
      applicationId: application.id,
      userId: "operator-2",
      kind: "document",
      key: "load_letter",
      status: "needs_correction",
      note: "Use the revised engineer-issued letter",
    });
    assert.equal(summarizePackageReview(application).status, "needs_changes");
    assert.equal(summarizePackageReview(application).active_correction_count, 1);
    application.package_documents[0].file_name = "revised-load-letter.pdf";
    const fixed = summarizePackageReview(application);
    assert.equal(
      fixed.items.find((item) => item.id === "document:load_letter").status,
      "ready_for_re_review",
    );
    assert.equal(fixed.ready_for_final_review, false);

    await updatePackageReviewItem(supabase, {
      applicationId: application.id,
      userId: "operator-2",
      kind: "document",
      key: "load_letter",
      status: "confirmed",
    });
    assert.equal(summarizePackageReview(application).ready_for_final_review, true);
    await reviewApplicationPackage(supabase, {
      applicationId: application.id,
      userId: "operator-2",
      review: { status: "reviewed" },
    });

    const review = application.agent_draft_metadata.application_package.package_review;
    assert.equal(review.review_history.length, 2);
    assert.deepEqual(review.review_history[0], firstSnapshot);
    assert.equal(review.review_history[1].package_documents[0].file_name, "revised-load-letter.pdf");
  });

  it("ignores stale package-level and draft correction flags when no current item is actionable", async () => {
    const application = readyApplication();
    const supabase = mockSupabase(application);
    await confirmAllVerifiedFields(supabase, {
      applicationId: application.id,
      userId: "operator-1",
    });
    await updatePackageReviewItem(supabase, {
      applicationId: application.id,
      userId: "operator-1",
      kind: "document",
      key: "load_letter",
      status: "confirmed",
    });
    application.draft_status = "needs_changes";
    application.agent_draft_metadata.application_package.package_review.package_correction = {
      active: true,
      note: "Historical reopen reason",
      requested_by_user_id: "operator-old",
      requested_at: "2026-08-17T00:00:00.000Z",
    };

    const summary = summarizePackageReview(application);
    assert.equal(summary.confirmed_count, 2);
    assert.equal(summary.total_count, 2);
    assert.equal(summary.active_correction_count, 0);
    assert.deepEqual(summary.active_corrections, []);
    assert.equal(summary.status, "ready_for_review");
    assert.equal(summary.ready_for_final_review, true);
  });
});
