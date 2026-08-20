"use strict";

const { describe, it, after } = require("node:test");
const assert = require("node:assert/strict");
const {
  transmitSubmissionPreparation,
  ensureSyntheticSubject,
} = require("../app/services/uci/uci-submission-transmission.service.js");

const APP_ID = "app-tx-1";
const PREP_ID = "prep-tx-1";
const USER_ID = "user-tx-1";

function buildApp() {
  return {
    id: APP_ID,
    coordination_record_id: "coord-1",
    project_id: "proj-1",
    record_source: "agent_draft",
    idempotency_key: "agent_3_application_package:d3-v1",
    draft_status: "reviewed",
    provider_slug: "dominion",
    application_type: "new_service",
    submitted_at: null,
    package_documents: [
      {
        key: "load_letter",
        label: "Synthetic load letter",
        status: "attached",
        file_name: "01_Synthetic_Load_Letter.pdf",
        source: "project_documents",
        project_document_id: "doc-1",
      },
    ],
    agent_draft_metadata: {
      application_package: {
        checklist_mode: "synthetic_test",
        authoritative_requirements: false,
        package_review: {
          reviewed_snapshot: {
            snapshot_version: "agent-3-reviewed-package-snapshot-v1",
            documents: [
              {
                key: "load_letter",
                file_name: "01_Synthetic_Load_Letter.pdf",
                project_document_id: "doc-1",
                status: "attached",
              },
            ],
          },
        },
      },
      submission_transmission_attempts: [],
    },
  };
}

function createTables() {
  return {
    coordination_applications: [buildApp()],
    projects: [{ id: "proj-1", name: "Highland" }],
    project_documents: [
      {
        id: "doc-1",
        project_id: "proj-1",
        file_name: "01_Synthetic_Load_Letter.pdf",
        file_path: "path/load.pdf",
        file_type: "application/pdf",
      },
    ],
    submission_preparations: [
      {
        id: PREP_ID,
        application_id: APP_ID,
        status: "confirmed_for_transmission",
        sender_mailbox: "dzahid@commun-et.com",
        sender_mailbox_verified: true,
        to_recipients: [{ email: "dzahid@commun-et.com" }],
        cc_recipients: [],
        subject: "[UCI] DOMINION new_service application — Highland",
        body: "body",
        attachments: [
          {
            key: "load_letter",
            file_name: "01_Synthetic_Load_Letter.pdf",
            project_document_id: "doc-1",
            status: "attached",
          },
        ],
        package_snapshot_id: "snap-1",
        package_snapshot_version: "agent-3-reviewed-package-snapshot-v1",
        graph_send_attempted: false,
        external_side_effects: {},
      },
    ],
    submission_transmission_attempts: [],
  };
}

function createMockSupabase(tables) {
  require("../app/services/uci/uci-application-builder.service.js").getApplicationById = async (
    _s,
    applicationId,
  ) =>
    (tables.coordination_applications || []).find((a) => String(a.id) === String(applicationId)) ??
    null;

  return {
    from(table) {
      const store = tables[table] || (tables[table] = []);
      const filters = [];
      const state = { mode: "select", updatePatch: null, insertRow: null };
      const matching = () =>
        store.filter((row) =>
          filters.every((f) => {
            if (f.op === "eq") return String(row[f.col]) === String(f.val);
            return true;
          }),
        );
      const api = {
        select() {
          if (state.mode !== "insert" && state.mode !== "update") {
            state.mode = "select";
          }
          return api;
        },
        insert(row) {
          state.mode = "insert";
          state.insertRow = Array.isArray(row) ? row[0] : row;
          return api;
        },
        update(patch) {
          state.mode = "update";
          state.updatePatch = patch;
          return api;
        },
        eq(col, val) {
          filters.push({ op: "eq", col, val });
          return api;
        },
        order() {
          return api;
        },
        limit() {
          return api;
        },
        maybeSingle: async () => {
          const rows = matching();
          return { data: rows[0] || null, error: null };
        },
        single: async () => {
          if (state.mode === "insert") {
            if (
              table === "submission_transmission_attempts" &&
              store.some(
                (r) =>
                  String(r.application_id) === String(state.insertRow.application_id) &&
                  String(r.idempotency_key) === String(state.insertRow.idempotency_key),
              )
            ) {
              return { data: null, error: { code: "23505", message: "duplicate key" } };
            }
            const row = { ...state.insertRow };
            store.push(row);
            return { data: row, error: null };
          }
          if (state.mode === "update") {
            const rows = matching();
            if (!rows[0]) return { data: null, error: { message: "not found" } };
            Object.assign(rows[0], state.updatePatch);
            return { data: rows[0], error: null };
          }
          const rows = matching();
          return { data: rows[0] || null, error: rows[0] ? null : { message: "not found" } };
        },
        then(resolve) {
          return Promise.resolve({ data: matching(), error: null }).then(resolve);
        },
      };
      return api;
    },
    storage: {
      from() {
        return {
          download: async () => ({
            data: new Blob([Buffer.from("%PDF-1.4 mock")]),
            error: null,
          }),
        };
      },
    },
  };
}

describe("uci-submission-transmission", () => {
  const originalFlag = process.env.UCI_EMAIL_LIVE_SUBMISSION_ENABLED;
  const originalSenders = process.env.UCI_EMAIL_ALLOWED_SENDERS;
  const originalRecipients = process.env.UCI_EMAIL_ALLOWED_RECIPIENTS;
  const originalGetApp = require("../app/services/uci/uci-application-builder.service.js")
    .getApplicationById;

  after(() => {
    if (originalFlag === undefined) delete process.env.UCI_EMAIL_LIVE_SUBMISSION_ENABLED;
    else process.env.UCI_EMAIL_LIVE_SUBMISSION_ENABLED = originalFlag;
    if (originalSenders === undefined) delete process.env.UCI_EMAIL_ALLOWED_SENDERS;
    else process.env.UCI_EMAIL_ALLOWED_SENDERS = originalSenders;
    if (originalRecipients === undefined) delete process.env.UCI_EMAIL_ALLOWED_RECIPIENTS;
    else process.env.UCI_EMAIL_ALLOWED_RECIPIENTS = originalRecipients;
    require("../app/services/uci/uci-application-builder.service.js").getApplicationById =
      originalGetApp;
  });

  it("prefixes synthetic subjects", () => {
    const subject = ensureSyntheticSubject("Utility Coordination Application Package — Highland", {
      provider_slug: "dominion",
      agent_draft_metadata: {
        application_package: {
          checklist_mode: "synthetic_test",
          authoritative_requirements: false,
        },
      },
    });
    assert.match(subject, /^\[TEST\]/);
  });

  it("blocks when live flag is off", async () => {
    delete process.env.UCI_EMAIL_LIVE_SUBMISSION_ENABLED;
    const tables = createTables();
    const supabase = createMockSupabase(tables);
    await assert.rejects(
      () =>
        transmitSubmissionPreparation(supabase, {
          applicationId: APP_ID,
          preparationId: PREP_ID,
          userId: USER_ID,
        }),
      (err) => err && err.code === "LIVE_EMAIL_DISABLED",
    );
  });

  it("claims before send and refuses duplicate", async () => {
    process.env.UCI_EMAIL_LIVE_SUBMISSION_ENABLED = "true";
    process.env.UCI_EMAIL_ALLOWED_SENDERS = "dzahid@commun-et.com";
    process.env.UCI_EMAIL_ALLOWED_RECIPIENTS = "dzahid@commun-et.com";
    const tables = createTables();
    const supabase = createMockSupabase(tables);
    let sendCalls = 0;
    const deps = {
      mailSendPermissionConfigured: true,
      getMailboxStatusForUser: async () => ({
        connected: true,
        mailbox_email: "dzahid@commun-et.com",
        scopes: ["Mail.Read", "Mail.Send"],
        mail_send_permission_configured: true,
      }),
      getValidAccessTokenForUser: async () => "token",
      fetchGraphMe: async () => ({ mail: "dzahid@commun-et.com", userPrincipalName: "dzahid@commun-et.com" }),
      sendMailFn: async (_token, message) => {
        sendCalls += 1;
        assert.equal(message.toRecipients[0].email, "dzahid@commun-et.com");
        assert.equal(message.attachments.length, 1);
        return { ok: true, status: 202, message_id: "graph-send-1" };
      },
    };

    const first = await transmitSubmissionPreparation(supabase, {
      applicationId: APP_ID,
      preparationId: PREP_ID,
      userId: USER_ID,
      options: { idempotency_key: "uat-once-1" },
      deps,
    });
    assert.equal(first.ok, true);
    assert.equal(first.status, "sent");
    assert.equal(first.stage_5_advanced, false);
    assert.equal(first.submitted_at, null);
    assert.equal(sendCalls, 1);
    assert.equal(tables.submission_transmission_attempts.length, 1);
    assert.equal(tables.submission_transmission_attempts[0].status, "sent");

    const second = await transmitSubmissionPreparation(supabase, {
      applicationId: APP_ID,
      preparationId: PREP_ID,
      userId: USER_ID,
      options: { idempotency_key: "uat-once-1" },
      deps,
    });
    assert.equal(second.idempotent_replay, true);
    assert.equal(sendCalls, 1);
  });

  it("rejects a real utility recipient even when live send is on", async () => {
    process.env.UCI_EMAIL_LIVE_SUBMISSION_ENABLED = "true";
    process.env.UCI_EMAIL_ALLOWED_SENDERS = "dzahid@commun-et.com";
    process.env.UCI_EMAIL_ALLOWED_RECIPIENTS = "dzahid@commun-et.com";
    const tables = createTables();
    tables.submission_preparations[0].to_recipients = [{ email: "newservice@dominionenergy.com" }];
    const supabase = createMockSupabase(tables);
    await assert.rejects(
      () =>
        transmitSubmissionPreparation(supabase, {
          applicationId: APP_ID,
          preparationId: PREP_ID,
          userId: USER_ID,
          deps: {
            mailSendPermissionConfigured: true,
            getMailboxStatusForUser: async () => ({
              connected: true,
              mailbox_email: "dzahid@commun-et.com",
              scopes: ["Mail.Send"],
              mail_send_permission_configured: true,
            }),
            getValidAccessTokenForUser: async () => "token",
            fetchGraphMe: async () => ({ mail: "dzahid@commun-et.com" }),
            sendMailFn: async () => {
              throw new Error("Graph must not be called");
            },
          },
        }),
      (err) => err && err.code === "RECIPIENT_NOT_ALLOWED",
    );
  });
});
