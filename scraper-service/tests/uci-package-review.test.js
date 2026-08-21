"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  updatePackageReviewItem,
  confirmAllVerifiedFields,
  reviewApplicationPackage,
  repairReviewedPackageDocuments,
  summarizePackageReview,
  isPersistedProjectDocumentId,
  packageDocumentsNeedRepair,
  packageHasReviewedRecoverySnapshot,
} = require("../app/services/uci/uci-package-review.service.js");
const { createTrackBMockSupabase } = require("./helpers/uci-track-b-mock.js");

const TEST_USER_ID = "550e8400-e29b-41d4-a716-446655440001";

function mockSupabase(application, options = {}) {
  const submissionPreparations = Array.isArray(options.submissionPreparations)
    ? options.submissionPreparations
    : [];
  return {
    from(table) {
      if (table === "submission_preparations") {
        const filters = [];
        const state = { mode: "select", updatePatch: null };
        const matching = () =>
          submissionPreparations.filter((row) =>
            filters.every((f) => String(row[f.column]) === String(f.value)),
          );
        const api = {
          select() {
            return api;
          },
          eq(column, value) {
            filters.push({ column, value });
            return api;
          },
          update(patch) {
            state.mode = "update";
            state.updatePatch = patch;
            return api;
          },
          single() {
            const row = matching()[0] ?? null;
            if (row && state.updatePatch) Object.assign(row, state.updatePatch);
            return Promise.resolve({ data: row, error: null });
          },
          then(resolve, reject) {
            try {
              if (state.mode === "update" && state.updatePatch) {
                for (const row of matching()) Object.assign(row, state.updatePatch);
              }
              resolve({ data: matching(), error: null });
            } catch (err) {
              reject(err);
            }
          },
        };
        return api;
      }
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

  it("recomputes ready_for_final_review when persisted package_status is stale incomplete", async () => {
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
    application.agent_draft_metadata.application_package.package_status = "incomplete";
    application.agent_draft_metadata.application_package.missing_fields = [];
    application.agent_draft_metadata.application_package.missing_documents = [];

    const summary = summarizePackageReview(application);
    assert.equal(summary.package_status, "ready_for_review");
    assert.equal(summary.confirmed_count, 2);
    assert.equal(summary.ready_for_final_review, true);
    assert.deepEqual(
      summary.items.filter((item) => item.status !== "confirmed").map((item) => item.id),
      [],
    );
  });

  it("repairs a reviewed package with null worksheet ID and requires re-confirm/re-review", async () => {
    const application = readyApplication();
    application.draft_status = "reviewed";
    application.reviewed_by = "operator-1";
    application.reviewed_at = "2026-08-20T12:00:00.000Z";
    application.coordination_record_id = "coord-portsmouth";
    application.package_documents.push({
      key: "load_calculation_worksheet",
      label: "Load calculation worksheet",
      status: "attached",
      file_name: "worksheet.pdf",
      source: "generated_worksheet",
      project_document_id: null,
    });
    application.agent_draft_metadata.application_package.package_review = {
      version: "agent-3-package-review-v2",
      status: "reviewed",
      reviewed_by_user_id: "operator-1",
      reviewed_at: "2026-08-20T12:00:00.000Z",
      items: {
        "field:connected_load_kva": {
          kind: "field",
          key: "connected_load_kva",
          status: "confirmed",
          mapping_snapshot: {
            key: "connected_load_kva",
            label: "Connected load",
            status: "present",
            value: { value: 410, unit: "kVA", verified_by: "agent-2-reviewer" },
            source: "load_summary.verified_values.connected_load_kva",
            address_source: null,
          },
        },
        "document:load_letter": {
          kind: "document",
          key: "load_letter",
          status: "confirmed",
          mapping_snapshot: {
            key: "load_letter",
            label: "Load letter",
            status: "attached",
            file_name: "load-letter.pdf",
            source: "project_documents",
            project_document_id: "550e8400-e29b-41d4-a716-446655440002",
            external_application_id: null,
            storage_path: null,
            content_hash: null,
            signature_required: false,
            signature_status: null,
            signature_verified_at: null,
          },
        },
        "document:load_calculation_worksheet": {
          kind: "document",
          key: "load_calculation_worksheet",
          status: "confirmed",
          mapping_snapshot: {
            key: "load_calculation_worksheet",
            label: "Load calculation worksheet",
            status: "attached",
            file_name: "worksheet.pdf",
            project_document_id: null,
          },
        },
      },
      reviewed_snapshot: {
        snapshot_version: "agent-3-reviewed-package-snapshot-v1",
        captured_at: "2026-08-20T12:00:00.000Z",
        package_documents: application.package_documents,
      },
      review_history: [],
    };

    const tables = {
      coordination_records: [
        {
          id: "coord-portsmouth",
          project_id: "project-1",
          utility_type: "electric",
          user_id: TEST_USER_ID,
          provider_slug: "dominion",
        },
      ],
      projects: [{ id: "project-1", name: "Portsmouth", user_id: TEST_USER_ID }],
      coordination_applications: [
        application,
        {
          id: "load-profile-1",
          coordination_record_id: "coord-portsmouth",
          project_id: "project-1",
          record_source: "agent_draft",
          idempotency_key: "agent_2_load_profile:d2-v1",
          load_summary: {
            calculated_values: { service_size: { value: "400A" } },
          },
        },
      ],
      project_documents: [],
    };

    const supabase = createTrackBMockSupabase(tables);
    const result = await repairReviewedPackageDocuments(supabase, {
      applicationId: application.id,
      application,
      userId: "operator-2",
    });

    assert.equal(result.repaired_keys.join(","), "load_calculation_worksheet");
    assert.ok(isPersistedProjectDocumentId(result.worksheet_project_document_id));
    assert.equal(application.draft_status, "draft");
    assert.equal(application.reviewed_by, null);
    assert.equal(
      application.agent_draft_metadata.application_package.package_review.reviewed_snapshot,
      null,
    );
    assert.equal(
      application.agent_draft_metadata.application_package.package_review.review_history.length,
      1,
    );

    const summary = summarizePackageReview(application);
    assert.equal(summary.status, "ready_for_review");
    assert.equal(
      summary.items.find((item) => item.id === "document:load_letter").status,
      "confirmed",
    );
    assert.equal(
      summary.items.find((item) => item.id === "document:load_calculation_worksheet").status,
      "not_reviewed",
    );
    assert.equal(summary.ready_for_final_review, false);

    await updatePackageReviewItem(supabase, {
      application,
      userId: "operator-2",
      kind: "document",
      key: "load_calculation_worksheet",
      status: "confirmed",
    });
    assert.equal(summarizePackageReview(application).ready_for_final_review, true);

    await reviewApplicationPackage(supabase, {
      application,
      userId: "operator-2",
      review: { status: "reviewed" },
    });
    assert.equal(application.draft_status, "reviewed");
    assert.ok(
      isPersistedProjectDocumentId(
        application.package_documents.find((doc) => doc.key === "load_calculation_worksheet")
          .project_document_id,
      ),
    );
  });

  it("detects repair eligibility from reviewed snapshot when draft_status is draft", () => {
    const application = readyApplication();
    application.draft_status = "draft";
    application.package_documents.push({
      key: "load_calculation_worksheet",
      label: "Load calculation worksheet",
      status: "attached",
      file_name: "worksheet.pdf",
      source: "generated_worksheet",
      project_document_id: null,
    });
    application.agent_draft_metadata.application_package.package_review = {
      version: "agent-3-package-review-v2",
      status: "needs_changes",
      reviewed_snapshot: {
        snapshot_version: "agent-3-reviewed-package-snapshot-v1",
        captured_at: "2026-08-20T12:00:00.000Z",
        package_documents: application.package_documents,
      },
      items: {},
      review_history: [],
    };

    assert.equal(packageHasReviewedRecoverySnapshot(application), true);
    assert.deepEqual(packageDocumentsNeedRepair(application).map((entry) => entry.key), [
      "load_calculation_worksheet",
    ]);
  });

  it("repairs draft package with reviewed snapshot by reusing existing worksheet storage", async () => {
    const application = readyApplication();
    application.draft_status = "draft";
    application.reviewed_by = null;
    application.reviewed_at = null;
    application.coordination_record_id = "coord-portsmouth";
    application.package_documents.push({
      key: "load_calculation_worksheet",
      label: "Load calculation worksheet",
      status: "attached",
      file_name: "uci-load-worksheet-f656209f.pdf",
      source: "generated_worksheet",
      storage_path: "uci/project/coord/worksheet.pdf",
      project_document_id: null,
    });
    application.agent_draft_metadata.application_package.package_review = {
      version: "agent-3-package-review-v2",
      status: "needs_changes",
      reviewed_snapshot: {
        snapshot_version: "agent-3-reviewed-package-snapshot-v1",
        captured_at: "2026-08-20T12:00:00.000Z",
        package_documents: application.package_documents,
      },
      items: {
        "document:load_calculation_worksheet": {
          kind: "document",
          key: "load_calculation_worksheet",
          status: "confirmed",
          mapping_snapshot: {
            key: "load_calculation_worksheet",
            status: "attached",
            project_document_id: null,
            file_name: "uci-load-worksheet-f656209f.pdf",
          },
        },
      },
      review_history: [],
    };

    const tables = {
      coordination_records: [
        {
          id: "coord-portsmouth",
          project_id: "project-1",
          utility_type: "electric",
          user_id: TEST_USER_ID,
          provider_slug: "dominion",
        },
      ],
      projects: [{ id: "project-1", name: "Portsmouth", user_id: TEST_USER_ID }],
      coordination_applications: [
        application,
        {
          id: "load-profile-1",
          coordination_record_id: "coord-portsmouth",
          project_id: "project-1",
          record_source: "agent_draft",
          idempotency_key: "agent_2_load_profile:d2-v1",
          load_summary: {
            calculated_values: { service_size: { value: "400A" } },
          },
        },
      ],
      project_documents: [],
    };

    const supabase = createTrackBMockSupabase(tables);
    const result = await repairReviewedPackageDocuments(supabase, {
      applicationId: application.id,
      application,
      userId: "operator-2",
    });

    assert.equal(result.repaired_keys.join(","), "load_calculation_worksheet");
    assert.ok(isPersistedProjectDocumentId(result.worksheet_project_document_id));
    assert.equal(tables.project_documents.length, 1);
    assert.equal(tables.project_documents[0].file_path, "uci/project/coord/worksheet.pdf");
    assert.equal(
      application.package_documents.find((doc) => doc.key === "load_calculation_worksheet")
        .project_document_id,
      result.worksheet_project_document_id,
    );
    assert.equal(
      application.agent_draft_metadata.application_package.package_review.reviewed_snapshot,
      null,
    );
  });

  it("persists draft_status reviewed and reviewed_snapshot on mark reviewed after repair", async () => {
    const application = readyApplication();
    application.coordination_record_id = "coord-portsmouth";
    application.package_documents.push({
      key: "load_calculation_worksheet",
      label: "Load calculation worksheet",
      status: "attached",
      file_name: "worksheet.pdf",
      source: "generated_worksheet",
      project_document_id: "caa48b1b-3179-4463-9ace-5b5fe6814d70",
    });
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
    await updatePackageReviewItem(supabase, {
      applicationId: application.id,
      userId: "operator-1",
      kind: "document",
      key: "load_calculation_worksheet",
      status: "confirmed",
    });

    const result = await reviewApplicationPackage(supabase, {
      applicationId: application.id,
      userId: "operator-1",
      review: { status: "reviewed" },
    });

    assert.equal(result.review_status, "reviewed");
    assert.equal(application.draft_status, "reviewed");
    assert.ok(application.agent_draft_metadata.application_package.package_review.reviewed_snapshot);
    assert.equal(
      application.package_documents.find((doc) => doc.key === "load_calculation_worksheet")
        .project_document_id,
      "caa48b1b-3179-4463-9ace-5b5fe6814d70",
    );
    assert.equal(
      application.agent_draft_metadata.application_package.package_review.reviewed_snapshot
        .package_documents.find((doc) => doc.key === "load_calculation_worksheet")
        .project_document_id,
      "caa48b1b-3179-4463-9ace-5b5fe6814d70",
    );
  });

  it("blocks stale confirmed preparations when reviewed snapshot changes after re-review", async () => {
    const worksheetOld = null;
    const worksheetNew = "caa48b1b-3179-4463-9ace-5b5fe6814d70";
    const application = readyApplication();
    application.package_documents.push({
      key: "load_calculation_worksheet",
      label: "Load calculation worksheet",
      status: "attached",
      file_name: "worksheet.pdf",
      source: "generated_worksheet",
      project_document_id: worksheetNew,
    });
    const tables = {
      coordination_applications: [application],
      submission_preparations: [
        {
          id: "015b5b94-1621-4c53-b823-ec5e5839cc23",
          application_id: application.id,
          coordination_record_id: application.coordination_record_id,
          project_id: application.project_id,
          status: "confirmed_for_transmission",
          package_snapshot_captured_at: "2026-08-20T10:00:00.000Z",
          attachments: [
            {
              key: "load_calculation_worksheet",
              project_document_id: worksheetOld,
              file_name: "worksheet.pdf",
            },
            {
              key: "load_letter",
              project_document_id: application.package_documents[0].project_document_id,
              file_name: "load-letter.pdf",
            },
          ],
          to_recipients: [],
          cc_recipients: [],
          blockers: [],
        },
      ],
    };
    const supabase = createTrackBMockSupabase(tables);
    const { blockStaleConfirmedPreparations } = require("../app/services/uci/uci-submission-prepare.service.js");

    await confirmAllVerifiedFields(supabase, {
      applicationId: application.id,
      userId: "operator-1",
    });
    await updatePackageReviewItem(supabase, {
      application,
      userId: "operator-1",
      kind: "document",
      key: "load_letter",
      status: "confirmed",
    });
    await updatePackageReviewItem(supabase, {
      application,
      userId: "operator-1",
      kind: "document",
      key: "load_calculation_worksheet",
      status: "confirmed",
    });
    await reviewApplicationPackage(supabase, {
      application,
      userId: "operator-1",
      review: { status: "reviewed" },
    });

    const stalePrep = tables.submission_preparations[0];
    assert.equal(stalePrep.status, "blocked");
    assert.equal(stalePrep.blockers[0].code, "STALE_REVIEWED_SNAPSHOT");

    const reviewSummary = summarizePackageReview(application);
    const blocked = await blockStaleConfirmedPreparations(supabase, {
      applicationId: application.id,
      application,
      reviewSummary,
      userId: "operator-1",
      reason: "reviewed_snapshot_changed",
    });
    assert.equal(blocked.blocked_count, 0);
  });
});
