"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { enterStage9 } = require("../app/services/uci/uci-stage9-entry.service.js");
const { createTrackBMockSupabase } = require("./helpers/uci-track-b-mock.js");

describe("Stage 9 entry", () => {
  it("transitions Stage 8 COMPLETED into Stage 9 via lifecycle service", async () => {
    const tables = {
      coordination_records: [
        {
          id: "coord-1",
          project_id: "proj-1",
          current_stage: 8,
          current_stage_state: "COMPLETED",
        },
      ],
      coordination_equipment: [
        {
          id: "eq-1",
          coordination_record_id: "coord-1",
          project_id: "proj-1",
          equipment_type: "transformer",
          status: "on_order",
          current_eta: "2026-09-01",
        },
      ],
      coordination_stage_transitions: [],
    };
    const supabase = createTrackBMockSupabase(tables);
    const result = await enterStage9(supabase, {
      coordinationRecordId: "coord-1",
      userId: "user-1",
    });
    assert.equal(result.entered, true);
    assert.equal(result.record.current_stage, 9);
    assert.equal(result.record.current_stage_state, "BLOCKED");
    assert.equal(tables.coordination_stage_transitions.length, 1);
  });

  it("is idempotent when already in Stage 9", async () => {
    const tables = {
      coordination_records: [
        {
          id: "coord-1",
          project_id: "proj-1",
          current_stage: 9,
          current_stage_state: "IN_PROGRESS",
        },
      ],
      coordination_equipment: [],
      coordination_stage_transitions: [],
    };
    const supabase = createTrackBMockSupabase(tables);
    const result = await enterStage9(supabase, {
      coordinationRecordId: "coord-1",
      userId: "user-1",
    });
    assert.equal(result.entered, false);
    assert.equal(result.already_in_stage_9, true);
    assert.equal(tables.coordination_stage_transitions.length, 0);
  });

  it("rejects entry from Stage 8 IN_PROGRESS", async () => {
    const tables = {
      coordination_records: [
        {
          id: "coord-1",
          project_id: "proj-1",
          current_stage: 8,
          current_stage_state: "IN_PROGRESS",
        },
      ],
      coordination_equipment: [],
      coordination_stage_transitions: [],
    };
    const supabase = createTrackBMockSupabase(tables);
    await assert.rejects(
      () =>
        enterStage9(supabase, {
          coordinationRecordId: "coord-1",
          userId: "user-1",
        }),
      /Stage 9 requires Stage 8 COMPLETED/,
    );
  });
});
