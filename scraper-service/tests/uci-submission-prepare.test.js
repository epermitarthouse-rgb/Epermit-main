"use strict";

const { describe, it, after } = require("node:test");
const assert = require("node:assert/strict");
const {
  prepareSubmission,
  updateSubmissionPreparation,
  confirmSubmissionPreparation,
  CONFIRMATION_MESSAGE,
} = require("../app/services/uci/uci-submission-prepare.service.js");

const DOC_ID = "550e8400-e29b-41d4-a716-446655440000";

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
      project_document_id: DOC_ID,
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

function buildApp(overrides = {}) {
  const fieldSnap = REVIEWED_SNAPSHOT.fields[0];
  const docSnap = REVIEWED_SNAPSHOT.documents[0];
  return {
    id: "app-prep-1",
    coordination_record_id: "coord-1",
    project_id: "proj-1",
    record_source: "agent_draft",
    idempotency_key: "agent_3_application_package:d3-v1",
    draft_status: "reviewed",
    provider_slug: "dominion",
    application_type: "new_service",
    submitted_at: null,
    submission_method: null,
    utility_ticket_number: null,
    package_documents: [
      {
        key: "site_plan",
        label: "Site plan",
        status: "attached",
        file_name: "site.pdf",
        project_document_id: DOC_ID,
      },
    ],
    agent_draft_metadata: {
      application_package: {
        package_status: "ready_for_review",
        checklist_mode: "synthetic_test",
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
        package_review: {
          reviewed_snapshot: REVIEWED_SNAPSHOT,
          reviewed_at: "2026-08-18T12:00:00.000Z",
          items: {
            "field:project_address": { status: "confirmed", mapping_snapshot: fieldSnap },
            "document:site_plan": { status: "confirmed", mapping_snapshot: docSnap },
          },
        },
      },
    },
    ...overrides,
  };
}

function createTables(overrides = {}) {
  return {
    coordination_records: [
      { id: "coord-1", project_id: "proj-1", current_stage: 3, current_stage_state: "COMPLETED" },
    ],
    coordination_applications: overrides.coordination_applications ?? [buildApp()],
    projects: [{ id: "proj-1", name: "Highland Springs" }],
    submission_preparations: overrides.submission_preparations ?? [],
    coordination_stage_transitions: [],
  };
}

function createMockSupabase(tables) {
  const originalGetApplicationById = require("../app/services/uci/uci-application-builder.service.js")
    .getApplicationById;
  require("../app/services/uci/uci-application-builder.service.js").getApplicationById = async (
    _s,
    applicationId,
  ) =>
    (tables.coordination_applications || []).find((a) => String(a.id) === String(applicationId)) ??
    null;

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
          return Promise.resolve({ data: matching()[0] ?? null, error: null });
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
          return Promise.resolve({ data: row ?? null, error: null });
        },
        then(resolve, reject) {
          try {
            let rows = matching();
            if (orderSpec) {
              rows = [...rows].sort((a, b) => {
                const av = a[orderSpec.column];
                const bv = b[orderSpec.column];
                return orderSpec.ascending
                  ? String(av ?? "").localeCompare(String(bv ?? ""))
                  : String(bv ?? "").localeCompare(String(av ?? ""));
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
    },
  };
  return client;
}

const mailboxDeps = {
  getMailboxStatusForUser: async () => ({
    connected: true,
    mailbox_email: "operator@commun-et.com",
    last_connected_at: "2026-08-18T10:00:00.000Z",
    last_checked_at: null,
    last_error: null,
  }),
  getValidAccessTokenForUser: async () => "test-token",
  fetchGraphMe: async () => ({
    mail: "operator@commun-et.com",
    userPrincipalName: "operator@commun-et.com",
  }),
};

describe("Stage 4 P1 submission prepare → confirm", () => {
  const clients = [];
  after(() => {
    for (const c of clients) c.restore();
  });

  it("blocks prepare when Outlook is not connected", async () => {
    const tables = createTables();
    const supabase = createMockSupabase(tables);
    clients.push(supabase);
    await assert.rejects(
      () =>
        prepareSubmission(supabase, {
          applicationId: "app-prep-1",
          userId: "user-1",
          deps: {
            getMailboxStatusForUser: async () => ({
              connected: false,
              mailbox_email: null,
              last_connected_at: null,
              last_checked_at: null,
              last_error: null,
            }),
          },
        }),
      (err) => err.code === "CONNECT_OUTLOOK",
    );
    assert.equal(tables.submission_preparations.length, 0);
  });

  it("prepares preview with From = connected mailbox and snapshot attachments", async () => {
    const tables = createTables();
    const supabase = createMockSupabase(tables);
    clients.push(supabase);
    const prepared = await prepareSubmission(supabase, {
      applicationId: "app-prep-1",
      userId: "user-1",
      deps: mailboxDeps,
    });
    assert.equal(prepared.from, "operator@commun-et.com");
    assert.equal(prepared.sender_mailbox_verified, true);
    assert.equal(prepared.sending_enabled, false);
    assert.equal(prepared.package_version, "agent-3-reviewed-package-snapshot-v1");
    assert.ok(Array.isArray(prepared.attachments));
    assert.equal(prepared.attachments[0].file_name, "site.pdf");
    assert.match(prepared.subject, /^\[TEST\] Utility Coordination Application Package/);
    assert.match(prepared.body, /Attachments: 1/);
    assert.match(prepared.body, /synthetic test documents/i);
    assert.doesNotMatch(prepared.body, /agent-3-reviewed-package-snapshot-v1/);
    assert.doesNotMatch(prepared.body, /Sending is not enabled/);
    assert.doesNotMatch(prepared.body, /prepared by the UCI/);
    assert.doesNotMatch(prepared.body, /Exact attachments|site\.pdf/);
    assert.equal(prepared.external_side_effects.graph_send_mail_called, false);
    assert.equal(prepared.external_side_effects.email_sent, false);
    assert.equal(tables.coordination_applications[0].submitted_at, null);
  });

  it("confirms without sendMail and without submitted_at / Stage 5", async () => {
    const tables = createTables();
    const supabase = createMockSupabase(tables);
    clients.push(supabase);
    let sendMailCalled = false;
    const prepared = await prepareSubmission(supabase, {
      applicationId: "app-prep-1",
      userId: "user-1",
      deps: {
        ...mailboxDeps,
        // Ensure no accidental send path — service must not accept sendMailFn.
      },
    });

    await assert.rejects(
      () =>
        confirmSubmissionPreparation(supabase, {
          applicationId: "app-prep-1",
          preparationId: prepared.preparation_id,
          userId: "user-1",
          deps: mailboxDeps,
          options: {},
        }),
      (err) => err.code === "RECIPIENT_REQUIRED",
    );

    const updated = await updateSubmissionPreparation(supabase, {
      applicationId: "app-prep-1",
      preparationId: prepared.preparation_id,
      userId: "user-1",
      deps: mailboxDeps,
      patch: { to: "utility-test@example.com" },
    });
    assert.equal(updated.to[0].email, "utility-test@example.com");

    const confirmed = await confirmSubmissionPreparation(supabase, {
      applicationId: "app-prep-1",
      preparationId: prepared.preparation_id,
      userId: "user-1",
      deps: mailboxDeps,
      options: { idempotency_key: "highland-confirm-1" },
    });

    assert.equal(confirmed.status, "confirmed_for_transmission");
    assert.equal(confirmed.message, CONFIRMATION_MESSAGE);
    assert.equal(confirmed.sending_enabled, false);
    assert.equal(confirmed.ready_to_send, false);
    assert.equal(confirmed.mail_send_permission_configured, false);
    assert.equal(confirmed.graph_send_attempted, false);
    assert.match(
      String(confirmed.production_readiness_blocker || ""),
      /Email sending unavailable — Microsoft Mail\.Send permission required/,
    );
    assert.equal(confirmed.external_side_effects.graph_send_mail_called, false);
    assert.equal(confirmed.submitted_at, null);
    assert.equal(tables.coordination_applications[0].submitted_at, null);
    assert.equal(tables.coordination_records[0].current_stage, 3);
    assert.equal(tables.coordination_stage_transitions.length, 0);
    assert.equal(sendMailCalled, false);

    const replay = await confirmSubmissionPreparation(supabase, {
      applicationId: "app-prep-1",
      preparationId: prepared.preparation_id,
      userId: "user-1",
      deps: mailboxDeps,
      options: { idempotency_key: "highland-confirm-1" },
    });
    assert.equal(replay.idempotent_replay, true);
    assert.equal(
      tables.submission_preparations.filter((r) => r.status === "confirmed_for_transmission")
        .length,
      1,
    );
  });

  it("clears Mail.Send blocker when connection scopes include Mail.Send and live flag is on", async () => {
    const previous = process.env.UCI_EMAIL_LIVE_SUBMISSION_ENABLED;
    process.env.UCI_EMAIL_LIVE_SUBMISSION_ENABLED = "true";
    try {
      const tables = createTables();
      const supabase = createMockSupabase(tables);
      clients.push(supabase);
      const deps = {
        ...mailboxDeps,
        mailSendPermissionConfigured: true,
        getMailboxStatusForUser: async () => ({
          connected: true,
          mailbox_email: "operator@commun-et.com",
          last_connected_at: "2026-08-18T10:00:00.000Z",
          last_checked_at: null,
          last_error: null,
          scopes: ["Mail.Read", "Mail.Send", "User.Read"],
          mail_send_permission_configured: true,
        }),
      };
      const prepared = await prepareSubmission(supabase, {
        applicationId: "app-prep-1",
        userId: "user-1",
        deps,
      });
      assert.equal(prepared.mail_send_permission_configured, true);
      assert.equal(prepared.ready_to_send, true);
      assert.equal(prepared.sending_enabled, true);
      assert.equal(prepared.production_readiness_blocker, null);

      await updateSubmissionPreparation(supabase, {
        applicationId: "app-prep-1",
        preparationId: prepared.preparation_id,
        userId: "user-1",
        deps,
        patch: { to: "dzahid@commun-et.com" },
      });
      const confirmed = await confirmSubmissionPreparation(supabase, {
        applicationId: "app-prep-1",
        preparationId: prepared.preparation_id,
        userId: "user-1",
        deps,
        options: { idempotency_key: "ready-confirm-1" },
      });
      assert.equal(confirmed.ready_to_send, true);
      assert.match(String(confirmed.message || ""), /ready to send/i);
      assert.equal(confirmed.external_side_effects.graph_send_mail_called, false);
      assert.equal(tables.coordination_applications[0].submitted_at, null);
    } finally {
      if (previous === undefined) delete process.env.UCI_EMAIL_LIVE_SUBMISSION_ENABLED;
      else process.env.UCI_EMAIL_LIVE_SUBMISSION_ENABLED = previous;
    }
  });

  it("rejects mailbox identity mismatch", async () => {
    const tables = createTables();
    const supabase = createMockSupabase(tables);
    clients.push(supabase);
    await assert.rejects(
      () =>
        prepareSubmission(supabase, {
          applicationId: "app-prep-1",
          userId: "user-1",
          deps: {
            getMailboxStatusForUser: async () => ({
              connected: true,
              mailbox_email: "operator@commun-et.com",
              last_connected_at: null,
              last_checked_at: null,
              last_error: null,
            }),
            getValidAccessTokenForUser: async () => "tok",
            fetchGraphMe: async () => ({ mail: "other@commun-et.com" }),
          },
        }),
      (err) => err.code === "MAILBOX_IDENTITY_MISMATCH",
    );
  });
});
