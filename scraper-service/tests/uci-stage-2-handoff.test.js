"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  completeStage2EngineeringReview,
} = require("../app/services/uci/uci-transitions.service.js");

function createMockSupabase(tables) {
  return {
    from(table) {
      const rows = tables[table] || (tables[table] = []);
      const filters = [];
      let mode = "select";
      let value = null;
      const api = {
        select() {
          return api;
        },
        eq(column, expected) {
          filters.push({ column, expected });
          return api;
        },
        maybeSingle() {
          const data =
            rows.find((row) =>
              filters.every(({ column, expected }) => String(row[column]) === String(expected)),
            ) ?? null;
          return Promise.resolve({ data, error: null });
        },
        insert(row) {
          mode = "insert";
          value = row;
          return api;
        },
        update(patch) {
          mode = "update";
          value = patch;
          return api;
        },
        single() {
          if (mode === "insert") {
            const inserted = { id: `${table}-${rows.length + 1}`, ...value };
            rows.push(inserted);
            return Promise.resolve({ data: inserted, error: null });
          }
          const row = rows.find((candidate) =>
            filters.every(
              ({ column, expected }) => String(candidate[column]) === String(expected),
            ),
          );
          if (row && mode === "update") Object.assign(row, value);
          return Promise.resolve({ data: row ?? null, error: null });
        },
      };
      return api;
    },
  };
}

describe("UCI Stage 2 human handoff", () => {
  it("completes Stage 3 when the human gate finds a reviewed ready package", async () => {
    const tables = {
      coordination_records: [
        {
          id: "coord-1",
          project_id: "project-1",
          current_stage: 2,
          current_stage_state: "IN_PROGRESS",
        },
      ],
      coordination_applications: [
        {
          id: "package-1",
          coordination_record_id: "coord-1",
          project_id: "project-1",
          record_source: "agent_draft",
          idempotency_key: "agent_3_application_package:d3-v1",
          draft_status: "reviewed",
          agent_draft_metadata: {
            application_package: {
              package_status: "ready_for_review",
              field_results: [
                {
                  key: "project_name",
                  label: "Project name",
                  status: "present",
                  value: "Highland Springs",
                  source: "project.name",
                },
              ],
              package_review: {
                reviewed_snapshot: { captured_at: "2026-08-17T00:00:00.000Z" },
                items: {
                  "field:project_name": {
                    status: "confirmed",
                    mapping_snapshot: {
                      key: "project_name",
                      label: "Project name",
                      status: "present",
                      value: "Highland Springs",
                      source: "project.name",
                      address_source: null,
                    },
                  },
                },
              },
            },
          },
          package_documents: [],
        },
      ],
      coordination_stage_transitions: [],
    };

    const result = await completeStage2EngineeringReview(createMockSupabase(tables), {
      coordinationRecordId: "coord-1",
      userId: "user-1",
      reason: "Engineering review completed by test operator",
    });

    assert.equal(result.record.current_stage, 3);
    assert.equal(result.record.current_stage_state, "COMPLETED");
    assert.equal(result.stage3Completed, true);
    assert.equal(result.transition.triggered_by_type, "user");
    assert.equal(result.transition.metadata.human_gated, true);
    assert.equal(result.transition.metadata.synthetic_data_auto_advanced, false);
  });

  it("starts Stage 3 in progress when no reviewed package exists", async () => {
    const tables = {
      coordination_records: [
        {
          id: "coord-1",
          project_id: "project-1",
          current_stage: 2,
          current_stage_state: "IN_PROGRESS",
        },
      ],
      coordination_applications: [],
      coordination_stage_transitions: [],
    };

    const result = await completeStage2EngineeringReview(createMockSupabase(tables), {
      coordinationRecordId: "coord-1",
      userId: "user-1",
      reason: "Engineering review completed by test operator",
    });

    assert.equal(result.record.current_stage, 3);
    assert.equal(result.record.current_stage_state, "IN_PROGRESS");
    assert.equal(result.stage3Completed, false);
  });

  it("does not complete Stage 3 from stale reviewed/package labels", async () => {
    const tables = {
      coordination_records: [
        {
          id: "coord-1",
          project_id: "project-1",
          current_stage: 2,
          current_stage_state: "IN_PROGRESS",
        },
      ],
      coordination_applications: [
        {
          id: "package-1",
          coordination_record_id: "coord-1",
          project_id: "project-1",
          record_source: "agent_draft",
          idempotency_key: "agent_3_application_package:d3-v1",
          draft_status: "reviewed",
          package_documents: [],
          agent_draft_metadata: {
            application_package: {
              package_status: "ready_for_review",
              field_results: [
                {
                  key: "project_name",
                  label: "Project name",
                  status: "present",
                  value: "Changed value",
                  source: "project.name",
                },
              ],
              package_review: {
                reviewed_snapshot: { captured_at: "2026-08-17T00:00:00.000Z" },
                items: {},
              },
            },
          },
        },
      ],
      coordination_stage_transitions: [],
    };

    const result = await completeStage2EngineeringReview(createMockSupabase(tables), {
      coordinationRecordId: "coord-1",
      userId: "user-1",
      reason: "Engineering review completed by test operator",
    });

    assert.equal(result.record.current_stage, 3);
    assert.equal(result.record.current_stage_state, "IN_PROGRESS");
    assert.equal(result.stage3Completed, false);
  });

  it("rejects completion outside active Stage 2", async () => {
    const tables = {
      coordination_records: [
        {
          id: "coord-1",
          project_id: "project-1",
          current_stage: 3,
          current_stage_state: "IN_PROGRESS",
        },
      ],
    };

    await assert.rejects(
      () =>
        completeStage2EngineeringReview(createMockSupabase(tables), {
          coordinationRecordId: "coord-1",
          userId: "user-1",
          reason: "invalid retry",
        }),
      (error) => error.code === "STAGE_2_NOT_ACTIVE",
    );
  });

  it("accepts Stage 2 handoff when engineering review is already completed", async () => {
    const tables = {
      coordination_records: [
        {
          id: "coord-1",
          project_id: "project-1",
          current_stage: 2,
          current_stage_state: "COMPLETED",
        },
      ],
      coordination_applications: [],
      coordination_stage_transitions: [],
    };

    const result = await completeStage2EngineeringReview(createMockSupabase(tables), {
      coordinationRecordId: "coord-1",
      userId: "user-1",
      reason: "System-completed Stage 2 handoff after package review",
    });

    assert.equal(result.record.current_stage, 3);
    assert.equal(result.record.current_stage_state, "IN_PROGRESS");
    assert.equal(result.stage3Completed, false);
  });
});
