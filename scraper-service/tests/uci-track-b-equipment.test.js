"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  slipIncreasedBeyondThreshold,
  isDueForCheckIn,
  appendEquipmentEta,
  runDueEquipmentCheckIns,
} = require("../app/services/uci/uci-equipment-tracker.service.js");
const { createTrackBMockSupabase, stage6CompletedRecord } = require("./helpers/uci-track-b-mock.js");

describe("Track B Agent 9 equipment", () => {
  it("escalates slip increase >2 weeks, not merely total >2", () => {
    assert.equal(slipIncreasedBeyondThreshold(0.5, 3.0), true);
    assert.equal(slipIncreasedBeyondThreshold(3.0, 4.0), false);
    assert.equal(slipIncreasedBeyondThreshold(null, 8), false);
  });

  it("daily filter is pending|on_order|shipped and next_check_in_at <= now", () => {
    const now = new Date("2026-08-20T06:00:00.000Z");
    assert.equal(
      isDueForCheckIn({ status: "on_order", next_check_in_at: "2026-08-19T00:00:00.000Z" }, now),
      true,
    );
    assert.equal(
      isDueForCheckIn({ status: "delivered", next_check_in_at: "2026-08-19T00:00:00.000Z" }, now),
      false,
    );
    assert.equal(
      isDueForCheckIn({ status: "pending", next_check_in_at: "2026-08-21T00:00:00.000Z" }, now),
      false,
    );
  });

  it("advances next_check_in_at by 7 days and records source", async () => {
    const tables = {
      coordination_equipment: [
        {
          id: "eq-1",
          project_id: "proj-1",
          coordination_record_id: "coord-1",
          initial_eta: "2026-08-01",
          current_eta: "2026-08-01",
          status: "on_order",
          eta_history: [],
          weeks_of_slip: 0,
        },
      ],
      coordination_records: [stage6CompletedRecord({ current_stage: 8, current_stage_state: "IN_PROGRESS" })],
    };
    const supabase = createTrackBMockSupabase(tables);
    const result = await appendEquipmentEta(supabase, {
      equipmentId: "eq-1",
      projectId: "proj-1",
      eta: "2026-08-08",
      source: "utility_email",
      observedAt: "2026-08-20T00:00:00.000Z",
    });
    assert.equal(result.equipment.current_eta, "2026-08-08");
    assert.equal(result.equipment.eta_history[0].source, "utility_email");
    assert.ok(String(result.equipment.next_check_in_at).startsWith("2026-08-27"));
  });

  it("catch-up job sends due rows with mocked mail", async () => {
    const now = new Date("2026-08-20T06:15:00.000Z");
    const tables = {
      coordination_equipment: [
        {
          id: "eq-due",
          project_id: "proj-1",
          coordination_record_id: "coord-1",
          status: "pending",
          next_check_in_at: "2026-08-19T00:00:00.000Z",
          equipment_type: "transformer",
        },
      ],
      coordination_records: [
        stage6CompletedRecord({
          current_stage: 8,
          utility_contact_email: "pm@utility.test",
        }),
      ],
      projects: [{ id: "proj-1", name: "Site A" }],
      coordination_communications: [],
    };
    const supabase = createTrackBMockSupabase(tables);
    let mailed = 0;
    const result = await runDueEquipmentCheckIns(supabase, {
      now,
      deps: {
        sendMailFn: async () => {
          mailed += 1;
          return { ok: true, message_id: "m1" };
        },
      },
    });
    assert.equal(result.evaluated, 1);
    assert.equal(mailed, 1);
  });
});
