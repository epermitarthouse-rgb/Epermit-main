"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  attachLoadWorksheetToPackage,
} = require("../app/services/uci/uci-load-worksheet.service.js");
const {
  updatePackageReviewItem,
  isPersistedProjectDocumentId,
  documentMappingReady,
} = require("../app/services/uci/uci-package-review.service.js");
const {
  validateAttachmentDocumentReferences,
  assertAttachmentDocumentReferences,
} = require("../app/services/uci/uci-submission-validation.service.js");
const { createTrackBMockSupabase } = require("./helpers/uci-track-b-mock.js");

const TEST_USER_ID = "550e8400-e29b-41d4-a716-446655440001";

describe("UCI attachment document reference gates", () => {
  it("isPersistedProjectDocumentId rejects synthetic and accepts UUIDs", () => {
    assert.equal(isPersistedProjectDocumentId("generated-worksheet-coord-1"), false);
    assert.equal(isPersistedProjectDocumentId(null), false);
    assert.equal(
      isPersistedProjectDocumentId("550e8400-e29b-41d4-a716-446655440000"),
      true,
    );
  });

  it("documentMappingReady requires persisted project_document_id", () => {
    assert.equal(
      documentMappingReady({
        status: "attached",
        project_document_id: null,
        signature_required: false,
      }),
      false,
    );
    assert.equal(
      documentMappingReady({
        status: "attached",
        project_document_id: "550e8400-e29b-41d4-a716-446655440000",
        signature_required: false,
      }),
      true,
    );
  });

  it("persisted load worksheet returns real project_document_id (idempotent)", async () => {
    const tables = {
      project_documents: [],
      projects: [{ id: "proj-1", user_id: TEST_USER_ID }],
    };
    const supabase = createTrackBMockSupabase(tables);
    const params = {
      record: { id: "coord-1", project_id: "proj-1", utility_type: "electric", user_id: TEST_USER_ID },
      project: { id: "proj-1", name: "Portsmouth", user_id: TEST_USER_ID },
      loadSummary: { calculated_values: { service_size: { value: "400A" } } },
      userId: TEST_USER_ID,
    };
    const first = await attachLoadWorksheetToPackage(supabase, params);
    assert.equal(first.status, "attached");
    assert.ok(isPersistedProjectDocumentId(first.project_document_id));
    assert.equal(tables.project_documents.length, 1);

    const second = await attachLoadWorksheetToPackage(supabase, params);
    assert.equal(second.project_document_id, first.project_document_id);
    assert.equal(tables.project_documents.length, 1);
  });

  it("persistWorksheetFromPackageSlot reuses existing storage path without regenerating PDF", async () => {
    const tables = {
      project_documents: [],
      projects: [{ id: "proj-1", user_id: TEST_USER_ID }],
    };
    const supabase = createTrackBMockSupabase(tables);
    const { persistWorksheetFromPackageSlot } = require("../app/services/uci/uci-load-worksheet.service.js");
    const slot = {
      file_name: "uci-load-worksheet-f656209f.pdf",
      storage_path: "uci/project/coord/worksheet.pdf",
      source: "generated_worksheet",
      generated: true,
    };
    const first = await persistWorksheetFromPackageSlot(supabase, {
      record: { id: "coord-1", project_id: "proj-1", utility_type: "electric", user_id: TEST_USER_ID },
      project: { id: "proj-1", name: "Portsmouth", user_id: TEST_USER_ID },
      loadSummary: {},
      worksheetSlot: slot,
      userId: TEST_USER_ID,
    });
    assert.ok(isPersistedProjectDocumentId(first.project_document_id));
    assert.equal(first.file_name, slot.file_name);
    assert.equal(first.storage_path, slot.storage_path);
    assert.equal(tables.project_documents.length, 1);

    const second = await persistWorksheetFromPackageSlot(supabase, {
      record: { id: "coord-1", project_id: "proj-1", utility_type: "electric", user_id: TEST_USER_ID },
      project: { id: "proj-1", name: "Portsmouth", user_id: TEST_USER_ID },
      loadSummary: {},
      worksheetSlot: slot,
      userId: TEST_USER_ID,
    });
    assert.equal(second.project_document_id, first.project_document_id);
    assert.equal(tables.project_documents.length, 1);
  });

  it("blocks package review confirm when document lacks project_document_id", async () => {
    const application = {
      id: "package-1",
      project_id: "project-1",
      record_source: "agent_draft",
      idempotency_key: "agent_3_application_package:d3-v1",
      draft_status: "draft",
      package_documents: [
        {
          key: "load_calculation_worksheet",
          label: "Load calculation worksheet",
          status: "attached",
          file_name: "worksheet.pdf",
          source: "generated_worksheet",
          project_document_id: null,
        },
      ],
      agent_draft_metadata: {
        application_package: {
          package_status: "ready_for_review",
          field_results: [],
        },
      },
    };
    const supabase = {
      from(table) {
        assert.equal(table, "coordination_applications");
        let patch = null;
        return {
          select() {
            return this;
          },
          eq() {
            return this;
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

    await assert.rejects(
      () =>
        updatePackageReviewItem(supabase, {
          application,
          userId: "operator-1",
          kind: "document",
          key: "load_calculation_worksheet",
          status: "confirmed",
        }),
      (error) => error.code === "PACKAGE_REVIEW_ITEM_NOT_READY",
    );
  });

  it("validateAttachmentDocumentReferences catches all missing IDs before transmit", () => {
    const result = validateAttachmentDocumentReferences([
      {
        key: "load_calculation_worksheet",
        status: "attached",
        project_document_id: null,
      },
      {
        key: "site_plan",
        status: "attached",
        project_document_id: "550e8400-e29b-41d4-a716-446655440000",
      },
    ]);
    assert.equal(result.ok, false);
    assert.equal(result.errors.length, 1);
    assert.equal(result.errors[0].key, "load_calculation_worksheet");
    assert.equal(result.errors[0].code, "ATTACHMENT_DOCUMENT_ID_MISSING");
  });

  it("assertAttachmentDocumentReferences throws ATTACHMENT_RESOLVE_FAILED", () => {
    assert.throws(
      () =>
        assertAttachmentDocumentReferences([
          {
            key: "load_calculation_worksheet",
            status: "attached",
            project_document_id: "generated-worksheet-coord-1",
          },
        ]),
      (error) => error.code === "ATTACHMENT_RESOLVE_FAILED",
    );
  });
});
