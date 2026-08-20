"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const http = require("http");
const { enterStage9 } = require("../app/services/uci/uci-stage9-entry.service.js");
const { createUciRouter } = require("../app/routes/uci.routes.js");
const { createTrackBMockSupabase } = require("./helpers/uci-track-b-mock.js");

const COORDINATION_ID = "coord-1";
const PROJECT_ID = "proj-1";
const USER_ID = "user-1";

function stage8CompletedTables(overrides = {}) {
  return {
    coordination_records: [
      {
        id: COORDINATION_ID,
        project_id: PROJECT_ID,
        user_id: USER_ID,
        current_stage: 8,
        current_stage_state: "COMPLETED",
        ...overrides.record,
      },
    ],
    coordination_equipment: overrides.equipment ?? [
      {
        id: "eq-1",
        coordination_record_id: COORDINATION_ID,
        project_id: PROJECT_ID,
        equipment_type: "transformer",
        status: "on_order",
        current_eta: "2026-09-01",
      },
    ],
    coordination_stage_transitions: [],
    coordination_costs: [],
    coordination_milestones: [],
    projects: [{ id: PROJECT_ID, user_id: USER_ID, name: "Highland Springs UAT" }],
  };
}

function makeAuthedSupabase(tables) {
  const supabase = createTrackBMockSupabase(tables);
  return {
    ...supabase,
    auth: {
      getUser: async () => ({
        data: { user: { id: USER_ID, email: "operator@example.com" } },
        error: null,
      }),
    },
    rpc: async (name, args) => {
      if (name === "has_project_access" && args._project_id === PROJECT_ID) {
        return { data: args._user_id === USER_ID, error: null };
      }
      if (name === "has_project_editor_access" && args._project_id === PROJECT_ID) {
        return { data: args._user_id === USER_ID, error: null };
      }
      return { data: null, error: new Error(`unknown rpc ${name}`) };
    },
  };
}

describe("Stage 9 entry", () => {
  it("transitions Stage 8 COMPLETED into Stage 9 IN_PROGRESS via lifecycle service", async () => {
    const tables = stage8CompletedTables();
    const supabase = createTrackBMockSupabase(tables);
    const result = await enterStage9(supabase, {
      coordinationRecordId: COORDINATION_ID,
      userId: USER_ID,
    });
    assert.equal(result.entered, true);
    assert.equal(result.record.current_stage, 9);
    assert.equal(result.record.current_stage_state, "IN_PROGRESS");
    assert.equal(tables.coordination_records[0].current_stage, 9);
    assert.equal(tables.coordination_records[0].current_stage_state, "IN_PROGRESS");
    assert.equal(tables.coordination_stage_transitions.length, 1);
    assert.equal(tables.coordination_stage_transitions[0].to_stage, 9);
    assert.equal(tables.coordination_stage_transitions[0].to_state, "IN_PROGRESS");
  });

  it("POST /coordination/:id/enter-stage-9 persists 8/COMPLETED -> 9/IN_PROGRESS", async () => {
    const tables = stage8CompletedTables();
    const supabase = makeAuthedSupabase(tables);
    const app = express();
    app.use(express.json());
    app.use("/api/uci", createUciRouter({ supabase }));
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    const { port } = server.address();

    try {
      const res = await fetch(
        `http://127.0.0.1:${port}/api/uci/coordination/${COORDINATION_ID}/enter-stage-9`,
        {
          method: "POST",
          headers: {
            Authorization: "Bearer test-token",
            "Content-Type": "application/json",
          },
          body: "{}",
        },
      );
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.entered, true);
      assert.equal(body.record.current_stage, 9);
      assert.equal(body.record.current_stage_state, "IN_PROGRESS");
      assert.equal(tables.coordination_records[0].current_stage, 9);
      assert.equal(tables.coordination_records[0].current_stage_state, "IN_PROGRESS");
    } finally {
      await new Promise((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
    }
  });

  it("is idempotent when already in Stage 9", async () => {
    const tables = {
      coordination_records: [
        {
          id: COORDINATION_ID,
          project_id: PROJECT_ID,
          current_stage: 9,
          current_stage_state: "IN_PROGRESS",
        },
      ],
      coordination_equipment: [],
      coordination_stage_transitions: [],
    };
    const supabase = createTrackBMockSupabase(tables);
    const result = await enterStage9(supabase, {
      coordinationRecordId: COORDINATION_ID,
      userId: USER_ID,
    });
    assert.equal(result.entered, false);
    assert.equal(result.already_in_stage_9, true);
    assert.equal(tables.coordination_stage_transitions.length, 0);
  });

  it("rejects entry from Stage 8 IN_PROGRESS", async () => {
    const tables = stage8CompletedTables({
      record: { current_stage: 8, current_stage_state: "IN_PROGRESS" },
      equipment: [],
    });
    const supabase = createTrackBMockSupabase(tables);
    await assert.rejects(
      () =>
        enterStage9(supabase, {
          coordinationRecordId: COORDINATION_ID,
          userId: USER_ID,
        }),
      /Stage 9 requires Stage 8 COMPLETED/,
    );
  });
});
