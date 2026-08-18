"use strict";

const { describe, it, after } = require("node:test");
const assert = require("node:assert/strict");
const {
  validateSubmissionValidationEligibility,
  validateSubmissionPackage,
  INTENDED_SUBMISSION_MODE,
  NO_SIDE_EFFECTS,
} = require("../app/services/uci/uci-submission-validation.service.js");
const { submitApplicationPackage } = require("../app/services/uci/uci-application-submit.service.js");

const REVIEWED_SNAPSHOT = {
  snapshot_version: "agent-3-reviewed-package-snapshot-v1",
  captured_at: "2026-08-18T12:00:00.000Z",
  documents: [
    {
      key: "site_plan",
      label: "Site plan",
      status: "attached",
      file_name: "site.pdf",
      source: null,
      project_document_id: null,
      external_application_id: null,
      storage_path: null,
      content_hash: null,
      signature_required: false,
      signature_status: null,
      signature_verified_at: null,
    },
  ],
  fields: [
    {
      key: "project_address",
      label: "project_address",
      status: "present",
      value: "1 Main St",
      source: "",
      address_source: null,
    },
  ],
};

function buildReviewedSynthetic(overrides = {}) {
  const fieldSnap = REVIEWED_SNAPSHOT.fields[0];
  const docSnap = REVIEWED_SNAPSHOT.documents[0];
  return {
    id: "app-pkg-dominion-synthetic",
    coordination_record_id: "coord-1",
    project_id: "proj-1",
    record_source: "agent_draft",
    idempotency_key: "agent_3_application_package:d3-v1",
    draft_status: "reviewed",
    provider_slug: "dominion",
    application_type: "new_service",
    submitted_at: null,
    submitted_by: null,
    submission_method: null,
    utility_ticket_number: null,
    package_documents: [
      {
        key: "site_plan",
        label: "Site plan",
        status: "attached",
        file_name: "site.pdf",
      },
    ],
    agent_draft_metadata: {
      application_package: {
        package_status: "ready_for_review",
        checklist_mode: "synthetic_test",
        checklist_label: "SYNTHETIC TEST CHECKLIST — NOT DOMINION PROVIDED",
        authoritative_requirements: false,
        missing_fields: [],
        missing_documents: [],
        field_results: [
          {
            key: "project_address",
            label: "project_address",
            status: "present",
            value: "1 Main St",
            source: "",
          },
        ],
        signature_requirements: [],
        package_review: {
          reviewed_snapshot: REVIEWED_SNAPSHOT,
          reviewed_at: "2026-08-18T12:00:00.000Z",
          reviewer_display: "uat-operator",
          items: {
            "field:project_address": {
              status: "confirmed",
              mapping_snapshot: fieldSnap,
            },
            "document:site_plan": {
              status: "confirmed",
              mapping_snapshot: docSnap,
            },
          },
        },
      },
    },
    ...overrides,
  };
}

function createTables(overrides = {}) {
  return {
    coordination_records: overrides.coordination_records ?? [
      {
        id: "coord-1",
        project_id: "proj-1",
        current_stage: 3,
        current_stage_state: "COMPLETED",
      },
    ],
    coordination_applications: overrides.coordination_applications ?? [
      buildReviewedSynthetic(),
    ],
    projects: overrides.projects ?? [{ id: "proj-1", name: "Highland Springs" }],
    coordination_stage_transitions: overrides.coordination_stage_transitions ?? [],
    submission_validation_attempts: overrides.submission_validation_attempts ?? [],
  };
}

function createMockSupabase(tables) {
  const originalGetApplicationById = require("../app/services/uci/uci-application-builder.service.js")
    .getApplicationById;
  const originalGetRecord = require("../app/services/uci/uci-records.service.js")
    .getCoordinationRecordById;

  require("../app/services/uci/uci-application-builder.service.js").getApplicationById = async (
    _supabase,
    applicationId,
  ) => {
    const apps = tables.coordination_applications || [];
    return apps.find((a) => String(a.id) === String(applicationId)) ?? null;
  };

  require("../app/services/uci/uci-records.service.js").getCoordinationRecordById = async () =>
    tables.coordination_records[0];

  const client = {
    from(table) {
      const store = tables[table] || (tables[table] = []);
      const filters = [];
      const state = { mode: "select", updatePatch: null, insertRow: null };
      let orderSpec = null;

      const matching = () =>
        store.filter((r) => filters.every((f) => String(r[f.column]) === String(f.value)));

      const api = {
        select() {
          return api;
        },
        eq(column, value) {
          filters.push({ column, value });
          return api;
        },
        order(column, opts = {}) {
          orderSpec = { column, ascending: opts.ascending !== false };
          return api;
        },
        maybeSingle() {
          const row = matching()[0] ?? null;
          return Promise.resolve({ data: row, error: null });
        },
        single() {
          if (state.mode === "insert" && state.insertRow) {
            const copy = {
              id: `${table}-${store.length + 1}`,
              created_at: new Date().toISOString(),
              ...state.insertRow,
            };
            store.push(copy);
            return Promise.resolve({ data: copy, error: null });
          }
          const rows = matching();
          const row = rows[0] ?? null;
          if (row && state.mode === "update" && state.updatePatch) {
            Object.assign(row, state.updatePatch);
          }
          return Promise.resolve({ data: row, error: null });
        },
        then(resolve, reject) {
          try {
            let rows = matching();
            if (orderSpec) {
              rows = [...rows].sort((a, b) => {
                const av = a[orderSpec.column];
                const bv = b[orderSpec.column];
                if (av === bv) return 0;
                if (av == null) return 1;
                if (bv == null) return -1;
                return orderSpec.ascending
                  ? String(av).localeCompare(String(bv))
                  : String(bv).localeCompare(String(av));
              });
            }
            resolve({ data: rows, error: null });
          } catch (err) {
            reject(err);
          }
        },
        insert(row) {
          state.mode = "insert";
          state.insertRow = row;
          return api;
        },
        update(patch) {
          state.mode = "update";
          state.updatePatch = patch;
          return api;
        },
      };

      return api;
    },
    restore() {
      require("../app/services/uci/uci-application-builder.service.js").getApplicationById =
        originalGetApplicationById;
      require("../app/services/uci/uci-records.service.js").getCoordinationRecordById =
        originalGetRecord;
    },
  };

  return client;
}

describe("Stage 4 P0 submission validation tracker", () => {
  const clients = [];

  after(() => {
    for (const client of clients) client.restore();
  });

  it("blocks draft / needs_changes packages without validating as ready", () => {
    const draft = buildReviewedSynthetic({ draft_status: "draft" });
    draft.agent_draft_metadata.application_package.package_review.reviewed_snapshot = null;
    const draftGate = validateSubmissionValidationEligibility(draft);
    assert.equal(draftGate.ok, false);
    assert.ok(draftGate.blockers.some((b) => b.code === "DRAFT_NOT_REVIEWED" || b.code === "REVIEW_REQUIRED"));

    const needsChanges = buildReviewedSynthetic({ draft_status: "needs_changes" });
    needsChanges.agent_draft_metadata.application_package.package_review.items[
      "field:project_address"
    ].status = "needs_correction";
    const needsGate = validateSubmissionValidationEligibility(needsChanges);
    assert.equal(needsGate.ok, false);
    assert.ok(needsGate.blockers.some((b) => b.code === "NEEDS_CHANGES" || b.code === "ACTIVE_CORRECTIONS"));
  });

  it("records append-only validation_only with zero external side effects", async () => {
    const tables = createTables();
    const supabase = createMockSupabase(tables);
    clients.push(supabase);

    const first = await validateSubmissionPackage(supabase, {
      applicationId: "app-pkg-dominion-synthetic",
      userId: "user-1",
    });

    assert.equal(first.validation_only, true);
    assert.equal(first.mode, "validation_only");
    assert.equal(first.intended_submission_mode, INTENDED_SUBMISSION_MODE);
    assert.equal(first.primary_state, "not_submitted");
    assert.equal(first.secondary_state, "validation_passed");
    assert.equal(first.lifecycle_advanced, false);
    assert.equal(first.portal_adapter_used, false);
    assert.deepEqual(first.external_side_effects, { ...NO_SIDE_EFFECTS });
    assert.equal(first.synthetic_banner, "SYNTHETIC TEST — NO EXTERNAL SUBMISSION");
    assert.ok(Array.isArray(first.attachments));
    assert.ok(first.attachments.length >= 1);
    assert.equal(tables.coordination_applications[0].submitted_at, null);
    assert.equal(tables.coordination_applications[0].submission_method, null);
    assert.equal(tables.coordination_applications[0].utility_ticket_number, null);
    assert.equal(tables.coordination_records[0].current_stage, 3);
    assert.equal(tables.coordination_stage_transitions.length, 0);
    assert.equal(tables.submission_validation_attempts.length, 1);

    const history =
      tables.coordination_applications[0].agent_draft_metadata.submission_validation_attempts;
    assert.equal(history.length, 1);

    const second = await validateSubmissionPackage(supabase, {
      applicationId: "app-pkg-dominion-synthetic",
      userId: "user-1",
    });
    assert.equal(second.validation_only, true);
    assert.equal(tables.submission_validation_attempts.length, 2);
    assert.equal(
      tables.coordination_applications[0].agent_draft_metadata.submission_validation_attempts.length,
      2,
    );
    assert.equal(tables.coordination_applications[0].submitted_at, null);
    assert.equal(tables.coordination_records[0].current_stage, 3);
  });

  it("legacy submit intercept for Dominion synthetic never emails or advances lifecycle", async () => {
    const tables = createTables();
    const supabase = createMockSupabase(tables);
    clients.push(supabase);
    let emailCalled = false;

    const result = await submitApplicationPackage(supabase, {
      applicationId: "app-pkg-dominion-synthetic",
      userId: "user-1",
      deps: {
        sendMailFn: async () => {
          emailCalled = true;
          throw new Error("must not call email");
        },
      },
    });

    assert.equal(result.validation_only, true);
    assert.equal(result.lifecycle_advanced, false);
    assert.equal(emailCalled, false);
    assert.equal(tables.coordination_applications[0].submitted_at, null);
    assert.equal(tables.coordination_records[0].current_stage, 3);
    assert.ok(
      !tables.coordination_applications[0].agent_draft_metadata.submission ||
        tables.coordination_applications[0].agent_draft_metadata.submission.validation_only === true,
    );
  });
});
