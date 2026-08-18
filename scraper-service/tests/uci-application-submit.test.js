"use strict";

const { describe, it, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const {
  validateSubmitEligibility,
  resolveSubmissionMethod,
  submitApplicationPackage,
  submitViaPepcoPortal,
  submitViaEmail,
} = require("../app/services/uci/uci-application-submit.service.js");

const FORM_FIXTURE = fs.readFileSync(
  path.join(__dirname, "fixtures/pepco/submission-form.html"),
  "utf8",
);
const CONFIRMATION_FIXTURE = fs.readFileSync(
  path.join(__dirname, "fixtures/pepco/submission-confirmation.html"),
  "utf8",
);

const REVIEWED_PACKAGE = {
  id: "app-pkg-1",
  coordination_record_id: "coord-1",
  project_id: "proj-1",
  record_source: "agent_draft",
  idempotency_key: "agent_3_application_package:d3-v1",
  draft_status: "reviewed",
  provider_slug: "bge",
  application_type: "new_service",
  submitted_at: null,
  package_documents: [
    { key: "site_plan", status: "attached", file_name: "site.pdf", label: "Site plan" },
  ],
  load_summary: { calculated_values: { connected_kw: 80 } },
  agent_draft_metadata: {
    application_package: { package_status: "ready_for_review" },
  },
};

const REVIEWED_PEPCO_PACKAGE = {
  ...REVIEWED_PACKAGE,
  id: "app-pkg-pepco",
  provider_slug: "pepco",
  package_documents: [
    {
      key: "site_plan",
      label: "Site plan",
      status: "attached",
      project_document_id: "doc-1",
      file_name: "site.pdf",
      document_type: "site_plan",
    },
    {
      key: "single_line_diagram",
      label: "Single-line diagram",
      status: "attached",
      project_document_id: "doc-2",
      file_name: "single-line.pdf",
      document_type: "single_line_diagram",
    },
    {
      key: "equipment_cut_sheets",
      label: "Equipment cut sheets",
      status: "attached",
      project_document_id: "doc-3",
      file_name: "cuts.pdf",
      document_type: "equipment_cut_sheet",
    },
    {
      key: "letter_of_authorization",
      label: "Letter of authorization",
      status: "attached",
      project_document_id: "doc-4",
      file_name: "loa.pdf",
      document_type: "letter_of_authorization",
    },
  ],
  load_summary: {
    calculated_values: {},
    verified_values: {
      connected_load_kw: {
        field_key: "connected_load_kw",
        value: 120,
        unit: "kW",
        method: "source_extracted_and_human_verified",
        approved_by: "user-1",
        approved_at: "2026-07-15T12:00:00.000Z",
        source_document_name: "panel.pdf",
        source_document_id: null,
        source_storage_path: "p",
        page_number: 1,
        evidence_text: "connected load 120 KW",
        extraction_method: "pdf_text",
        edited: false,
        review_note: null,
        original_candidate_id: "c1",
        source_content_hash: "hash",
      },
      service_voltage: {
        field_key: "service_voltage",
        value: 480,
        unit: "V",
        method: "source_extracted_and_human_verified",
        approved_by: "user-1",
        approved_at: "2026-07-15T12:00:00.000Z",
        source_document_name: "panel.pdf",
        source_document_id: null,
        source_storage_path: "p",
        page_number: 1,
        evidence_text: "480 V",
        extraction_method: "pdf_text",
        edited: false,
        review_note: null,
        original_candidate_id: "c2",
        source_content_hash: "hash",
      },
    },
  },
};

const BASE_PROJECT = {
  id: "proj-1",
  name: "QSR Fit-out",
  project_type: "tenant_improvement",
  description: "Restaurant tenant improvement",
  address: "100 Main St",
  city: "Washington",
  state: "DC",
  zip_code: "20001",
};

describe("UCI D4 application submit service", () => {
  const originalLiveFlag = process.env.UCI_PEPCO_LIVE_SUBMISSION_ENABLED;

  after(() => {
    if (originalLiveFlag === undefined) {
      delete process.env.UCI_PEPCO_LIVE_SUBMISSION_ENABLED;
    } else {
      process.env.UCI_PEPCO_LIVE_SUBMISSION_ENABLED = originalLiveFlag;
    }
  });

  it("requires reviewed agent draft package", () => {
    assert.equal(validateSubmitEligibility({ ...REVIEWED_PACKAGE, draft_status: "draft" }).ok, false);
    assert.equal(validateSubmitEligibility({ ...REVIEWED_PACKAGE, record_source: "portal_sync" }).ok, false);
    assert.equal(validateSubmitEligibility(REVIEWED_PACKAGE).ok, true);
    assert.equal(
      validateSubmitEligibility({
        ...REVIEWED_PACKAGE,
        draft_status: "submitted",
        submitted_at: "2026-07-14T12:00:00.000Z",
      }).code,
      "ALREADY_SUBMITTED",
    );
  });

  it("rejects already submitted applications", () => {
    const result = validateSubmitEligibility({
      ...REVIEWED_PACKAGE,
      submitted_at: "2026-07-14T12:00:00.000Z",
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, "ALREADY_SUBMITTED");
  });

  it("resolves PEPCO as portal and others as email", () => {
    assert.equal(resolveSubmissionMethod("pepco"), "portal");
    assert.equal(resolveSubmissionMethod("bge"), "email");
  });

  it("returns PEPCO validation dry-run without advancing lifecycle", async () => {
    delete process.env.UCI_PEPCO_LIVE_SUBMISSION_ENABLED;
    const tables = createSubmitTables();
    const supabase = createSubmitMockSupabase(tables);

    const result = await submitApplicationPackage(supabase, {
      applicationId: "app-pkg-pepco",
      userId: "user-1",
    });

    assert.equal(result.status, "human_required");
    assert.equal(result.dry_run, true);
    assert.equal(result.lifecycle_advanced, false);
    assert.equal(result.submission_method, "portal");
    assert.equal(tables.coordination_records[0].current_stage, 3);
    assert.equal(tables.coordination_applications[0].draft_status, "reviewed");
    assert.ok(result.fields_to_submit);
    assert.ok(result.attachments_to_submit);
  });

  it("stops PEPCO portal populate before final submit on mocked page", async () => {
    delete process.env.UCI_PEPCO_LIVE_SUBMISSION_ENABLED;
    const tables = createSubmitTables();
    const supabase = createSubmitMockSupabase(tables);
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.setContent(FORM_FIXTURE);

    try {
      const result = await submitApplicationPackage(supabase, {
        applicationId: "app-pkg-pepco",
        userId: "user-1",
        options: { portal_populate: true },
        deps: {
          page,
          uploadFn: async () => ({ ok: true }),
        },
      });
      assert.equal(result.dry_run, true);
      assert.equal(result.lifecycle_advanced, false);
      assert.equal(result.submission_metadata.confirmation_status, "dry_run");
      assert.ok(result.submission_metadata.portal_outcome?.evidence?.has_screenshot);
    } finally {
      await browser.close();
    }
  });

  it("rejects live PEPCO submission when live flag is off", async () => {
    delete process.env.UCI_PEPCO_LIVE_SUBMISSION_ENABLED;
    const tables = createSubmitTables();
    const supabase = createSubmitMockSupabase(tables);

    await assert.rejects(
      () =>
        submitApplicationPackage(supabase, {
          applicationId: "app-pkg-pepco",
          userId: "user-1",
          options: {
            portal_populate: true,
            live_submission_confirmed: true,
          },
        }),
      (err) => {
        assert.equal(/** @type {{ code?: string }} */ (err).code, "LIVE_SUBMISSION_DISABLED");
        return true;
      },
    );
  });

  it("captures PEPCO confirmation and advances lifecycle only after live submit", async () => {
    process.env.UCI_PEPCO_LIVE_SUBMISSION_ENABLED = "true";
    const tables = createSubmitTables();
    const supabase = createSubmitMockSupabase(tables);
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    try {
      await page.setContent(FORM_FIXTURE);
      await page.evaluate(() => {
        const btn = document.querySelector("#pepco-final-submit");
        if (btn) {
          btn.addEventListener("click", () => {
            document.body.innerHTML = `
              <span id="pepco-confirmation-ticket">PEPCO-TKT-LIVE-001</span>
              <span id="pepco-application-reference">APP-LIVE-001</span>
            `;
          });
        }
      });

      const result = await submitApplicationPackage(supabase, {
        applicationId: "app-pkg-pepco",
        userId: "user-1",
        options: {
          portal_populate: true,
          live_submission_confirmed: true,
        },
        deps: {
          page,
          uploadFn: async () => ({ ok: true }),
        },
      });

      assert.equal(result.status, "confirmed");
      assert.equal(result.lifecycle_advanced, true);
      assert.equal(result.utility_ticket_number, "PEPCO-TKT-LIVE-001");
      const pepcoApp = tables.coordination_applications.find((a) => a.id === "app-pkg-pepco");
      assert.equal(pepcoApp?.draft_status, "submitted");
      assert.equal(tables.coordination_records[0].current_stage, 5);
      assert.equal(tables.coordination_stage_transitions.length, 2);
    } finally {
      await browser.close();
    }
  });

  it("prevents duplicate PEPCO submission after confirmation", async () => {
    const tables = createSubmitTables({
      coordination_applications: [
        {
          ...REVIEWED_PEPCO_PACKAGE,
          submitted_at: "2026-07-15T12:00:00.000Z",
          draft_status: "submitted",
        },
      ],
    });
    const supabase = createSubmitMockSupabase(tables);

    await assert.rejects(
      () =>
        submitApplicationPackage(supabase, {
          applicationId: "app-pkg-pepco",
          userId: "user-1",
        }),
      (err) => {
        assert.equal(/** @type {{ code?: string }} */ (err).code, "ALREADY_SUBMITTED");
        return true;
      },
    );
  });

  it("sends email for non-PEPCO and advances lifecycle only on success", async () => {
    const tables = createSubmitTables();
    const supabase = createSubmitMockSupabase(tables);

    const result = await submitApplicationPackage(supabase, {
      applicationId: "app-pkg-1",
      userId: "user-1",
      deps: {
        getAccessTokenFn: async () => "test-token",
        sendMailFn: async () => ({ ok: true, message_id: "msg-123" }),
      },
    });

    assert.equal(result.status, "confirmed");
    assert.equal(result.submission_method, "email");
    assert.equal(result.lifecycle_advanced, true);
    assert.equal(result.application.draft_status, "submitted");
    assert.equal(
      /** @type {{ email?: { message_id?: string } }} */ (result.submission_metadata).email
        ?.message_id,
      "msg-123",
    );
  });

  it("does not advance lifecycle when email delivery fails", async () => {
    const tables = createSubmitTables();
    const supabase = createSubmitMockSupabase(tables);

    await assert.rejects(
      () =>
        submitApplicationPackage(supabase, {
          applicationId: "app-pkg-1",
          userId: "user-1",
          deps: {
            getAccessTokenFn: async () => "test-token",
            sendMailFn: async () => ({ ok: false, error: "SMTP rejected" }),
          },
        }),
      (err) => {
        assert.equal(/** @type {{ code?: string }} */ (err).code, "EMAIL_SEND_FAILED");
        return true;
      },
    );

    assert.equal(tables.coordination_records[0].current_stage, 3);
    assert.equal(tables.coordination_applications[0].draft_status, "reviewed");
    assert.equal(tables.coordination_applications[0].submitted_at, null);
  });

  it("returns human_required when mailbox is not connected", async () => {
    const tables = createSubmitTables();
    const supabase = createSubmitMockSupabase(tables);

    const result = await submitViaEmail(supabase, {
      application: REVIEWED_PACKAGE,
      project: BASE_PROJECT,
      record: tables.coordination_records[0],
      userId: "user-1",
      deps: {
        getAccessTokenFn: async () => {
          throw new Error("not connected");
        },
      },
    });

    assert.equal(result.status, "human_required");
    assert.equal(result.lifecycle_advanced, false);
  });

  it("allows email retry after failed delivery", async () => {
    const tables = createSubmitTables({
      coordination_applications: [
        {
          ...REVIEWED_PACKAGE,
          agent_draft_metadata: {
            application_package: { package_status: "ready_for_review" },
            submission: {
              confirmation_status: "failed",
              failure_code: "EMAIL_SEND_FAILED",
            },
          },
        },
      ],
    });
    const supabase = createSubmitMockSupabase(tables);

    const result = await submitApplicationPackage(supabase, {
      applicationId: "app-pkg-1",
      userId: "user-1",
      deps: {
        getAccessTokenFn: async () => "test-token",
        sendMailFn: async () => ({ ok: true, message_id: "msg-retry-1" }),
      },
    });

    assert.equal(result.status, "confirmed");
    assert.equal(result.lifecycle_advanced, true);
  });

  it("validates Dominion synthetic checklist without email, portal, or lifecycle advance", async () => {
    const fieldSnap = {
      key: "project_address",
      label: "project_address",
      status: "present",
      value: "1 Main",
      source: "",
      address_source: null,
    };
    const docSnap = {
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
    };
    const reviewedSnapshot = {
      snapshot_version: "agent-3-reviewed-package-snapshot-v1",
      captured_at: "2026-08-18T12:00:00.000Z",
      documents: [docSnap],
      fields: [fieldSnap],
    };
    const synthetic = {
      ...REVIEWED_PACKAGE,
      id: "app-pkg-dominion-synthetic",
      provider_slug: "dominion",
      submitted_at: null,
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
              value: "1 Main",
              source: "",
            },
          ],
          signature_requirements: [],
          package_review: {
            reviewed_snapshot: reviewedSnapshot,
            reviewed_at: "2026-08-18T12:00:00.000Z",
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
    };
    const tables = createSubmitTables({
      coordination_applications: [synthetic],
      coordination_records: [
        {
          id: "coord-1",
          project_id: "proj-1",
          current_stage: 3,
          current_stage_state: "COMPLETED",
        },
      ],
      submission_validation_attempts: [],
    });
    const supabase = createSubmitMockSupabase(tables);
    let emailCalled = false;
    const result = await submitApplicationPackage(supabase, {
      applicationId: synthetic.id,
      userId: "user-1",
      deps: {
        sendMailFn: async () => {
          emailCalled = true;
          throw new Error("Synthetic path must not call email");
        },
      },
    });

    assert.equal(result.status, "validation_passed");
    assert.equal(result.dry_run, true);
    assert.equal(result.validation_only, true);
    assert.equal(result.lifecycle_advanced, false);
    assert.equal(result.external_side_effects.email_sent, false);
    assert.equal(result.external_side_effects.portal_touched, false);
    assert.equal(result.external_side_effects.graph_called, false);
    assert.equal(emailCalled, false);
    assert.equal(tables.coordination_records[0].current_stage, 3);
    assert.equal(tables.coordination_applications[0].draft_status, "reviewed");
    assert.equal(tables.coordination_applications[0].submitted_at, null);
    assert.equal(tables.submission_validation_attempts.length, 1);
    assert.equal(
      tables.coordination_applications[0].agent_draft_metadata.submission_validation_attempts.length,
      1,
    );
  });
});

function createSubmitTables(overrides = {}) {
  return {
    coordination_records: overrides.coordination_records ?? [
      {
        id: "coord-1",
        project_id: "proj-1",
        current_stage: 3,
        current_stage_state: "IN_PROGRESS",
      },
    ],
    coordination_applications: overrides.coordination_applications ?? [
      { ...REVIEWED_PACKAGE },
      { ...REVIEWED_PEPCO_PACKAGE },
    ],
    projects: overrides.projects ?? [{ ...BASE_PROJECT }],
    coordination_stage_transitions: overrides.coordination_stage_transitions ?? [],
    submission_validation_attempts: overrides.submission_validation_attempts ?? [],
  };
}

/**
 * @param {Record<string, Array<Record<string, unknown>>>} tables
 */
function createSubmitMockSupabase(tables) {
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

      const api = {
        select() {
          return api;
        },
        eq(column, value) {
          filters.push({ column, value });
          return api;
        },
        maybeSingle() {
          const row = store.find((r) =>
            filters.every((f) => String(r[f.column]) === String(f.value)),
          );
          return Promise.resolve({ data: row ?? null, error: null });
        },
        single() {
          if (state.mode === "insert" && state.insertRow) {
            const copy = { id: `${table}-${store.length + 1}`, ...state.insertRow };
            store.push(copy);
            return Promise.resolve({ data: copy, error: null });
          }
          const row = store.find((r) =>
            filters.every((f) => String(r[f.column]) === String(f.value)),
          );
          if (row && state.mode === "update" && state.updatePatch) {
            Object.assign(row, state.updatePatch);
          }
          return Promise.resolve({ data: row ?? null, error: null });
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
