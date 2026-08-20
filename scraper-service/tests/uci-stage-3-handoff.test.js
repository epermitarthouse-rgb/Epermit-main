"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  completeStage3PackageReviewHandoff,
} = require("../app/services/uci/uci-transitions.service.js");

function reviewedPackageApplication(overrides = {}) {
  return {
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
            value: "Portsmouth Solar",
            source: "project.name",
          },
        ],
        package_review: {
          status: "reviewed",
          reviewed_snapshot: {
            captured_at: "2026-08-20T00:00:00.000Z",
            snapshot_version: "agent-3-reviewed-package-snapshot-v1",
          },
          items: {
            "field:project_name": {
              status: "confirmed",
              mapping_snapshot: {
                key: "project_name",
                label: "Project name",
                status: "present",
                value: "Portsmouth Solar",
                source: "project.name",
                address_source: null,
              },
            },
          },
        },
      },
    },
    ...overrides,
  };
}

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

describe("UCI Stage 3 → Stage 4 package review handoff", () => {
  it("enters Stage 4 when the reviewed package closes Stage 3", async () => {
    const application = reviewedPackageApplication();
    const tables = {
      coordination_records: [
        {
          id: "coord-1",
          project_id: "project-1",
          current_stage: 3,
          current_stage_state: "IN_PROGRESS",
        },
      ],
      coordination_applications: [application],
      coordination_stage_transitions: [],
    };

    const result = await completeStage3PackageReviewHandoff(createMockSupabase(tables), {
      coordinationRecordId: "coord-1",
      userId: "user-1",
      reason: "Application package marked reviewed — entering Stage 4 submission",
      application,
      requireActiveStage3: true,
    });

    assert.equal(result.stage4Entered, true);
    assert.equal(result.record.current_stage, 4);
    assert.equal(result.record.current_stage_state, "IN_PROGRESS");
    assert.equal(result.transition.to_stage, 4);
    assert.equal(result.transition.to_state, "IN_PROGRESS");
    assert.equal(result.transition.metadata.action, "complete_stage_3_package_review");
    assert.equal(result.transition.metadata.stage_3_completed, true);
  });

  it("rejects Stage 4 entry when Stage 3 is not active", async () => {
    const tables = {
      coordination_records: [
        {
          id: "coord-1",
          project_id: "project-1",
          current_stage: 2,
          current_stage_state: "COMPLETED",
        },
      ],
    };

    await assert.rejects(
      () =>
        completeStage3PackageReviewHandoff(createMockSupabase(tables), {
          coordinationRecordId: "coord-1",
          userId: "user-1",
          reason: "invalid early entry",
          requireActiveStage3: true,
        }),
      (error) => error.code === "STAGE_3_NOT_ACTIVE",
    );
  });
});
