"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  validateSubmitEligibility,
  resolveSubmissionMethod,
  submitApplicationPackage,
} = require("../app/services/uci/uci-application-submit.service.js");

const REVIEWED_PACKAGE = {
  id: "app-pkg-1",
  coordination_record_id: "coord-1",
  project_id: "proj-1",
  record_source: "agent_draft",
  idempotency_key: "agent_3_application_package:d3-v1",
  draft_status: "reviewed",
  provider_slug: "bge",
  submitted_at: null,
  agent_draft_metadata: {
    application_package: { package_status: "incomplete" },
  },
};

describe("UCI D4 application submit service", () => {
  it("requires reviewed agent draft package", () => {
    assert.equal(validateSubmitEligibility({ ...REVIEWED_PACKAGE, draft_status: "draft" }).ok, false);
    assert.equal(validateSubmitEligibility({ ...REVIEWED_PACKAGE, record_source: "portal_sync" }).ok, false);
    assert.equal(validateSubmitEligibility(REVIEWED_PACKAGE).ok, true);
  });

  it("rejects already submitted applications", () => {
    const result = validateSubmitEligibility({
      ...REVIEWED_PACKAGE,
      submitted_at: "2026-07-14T12:00:00.000Z",
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, "ALREADY_SUBMITTED");
  });

  it("resolves PEPCO as portal and others as email_intent", () => {
    assert.equal(resolveSubmissionMethod("pepco"), "portal");
    assert.equal(resolveSubmissionMethod("bge"), "email_intent");
  });

  it("blocks PEPCO portal submit when adapter not implemented", async () => {
    const tables = {
      coordination_records: [
        {
          id: "coord-1",
          project_id: "proj-1",
          current_stage: 3,
          current_stage_state: "IN_PROGRESS",
        },
      ],
      coordination_applications: [{ ...REVIEWED_PACKAGE, provider_slug: "pepco" }],
      coordination_stage_transitions: [],
    };

    const supabase = createSubmitMockSupabase(tables);

    await assert.rejects(
      () => submitApplicationPackage(supabase, { applicationId: "app-pkg-1", userId: "user-1" }),
      (err) => {
        assert.equal(
          /** @type {{ code?: string, statusCode?: number }} */ (err).code,
          "SUBMIT_ADAPTER_NOT_IMPLEMENTED",
        );
        assert.equal(/** @type {{ statusCode?: number }} */ (err).statusCode, 501);
        return true;
      },
    );
  });

  it("records email_intent submission and advances stages for non-PEPCO", async () => {
    const tables = {
      coordination_records: [
        {
          id: "coord-1",
          project_id: "proj-1",
          current_stage: 3,
          current_stage_state: "IN_PROGRESS",
        },
      ],
      coordination_applications: [{ ...REVIEWED_PACKAGE }],
      coordination_stage_transitions: [],
    };

    const supabase = createSubmitMockSupabase(tables);

    const result = await submitApplicationPackage(supabase, {
      applicationId: "app-pkg-1",
      userId: "user-1",
    });

    assert.equal(result.submission_method, "email_intent");
    assert.equal(result.application.draft_status, "submitted");
    assert.equal(tables.coordination_records[0].current_stage, 5);
    assert.equal(tables.coordination_records[0].current_stage_state, "AWAITING_UTILITY");
    assert.equal(tables.coordination_stage_transitions.length, 2);
  });
});

/**
 * @param {Record<string, Array<Record<string, unknown>>>} tables
 */
function createSubmitMockSupabase(tables) {
  return {
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
  };
}
