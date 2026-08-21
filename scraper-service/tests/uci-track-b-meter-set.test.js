"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  choreographyBlocked,
  recordInspectionRelease,
  confirmMeterSetDate,
  requestMeterSet,
} = require("../app/services/uci/uci-meter-set-choreographer.service.js");
const { createTrackBMockSupabase, stage6CompletedRecord } = require("./helpers/uci-track-b-mock.js");

describe("Track B Agent 11 meter set", () => {
  it("blocks choreography without Stage 9 + inspection release", () => {
    assert.equal(
      choreographyBlocked({ current_stage: 8, inspection_release_received_at: "2026-08-01" }).blocked,
      true,
    );
    assert.equal(choreographyBlocked({ current_stage: 9 }).blocked, true);
    assert.equal(
      choreographyBlocked({ current_stage: 9, inspection_release_received_at: "2026-08-01" }).blocked,
      false,
    );
  });

  it("records inspection release in the database, not localStorage", async () => {
    const tables = {
      coordination_records: [
        stage6CompletedRecord({
          current_stage: 9,
          current_stage_state: "BLOCKED",
        }),
      ],
      coordination_costs: [],
      coordination_equipment: [],
      coordination_milestones: [],
      utility_stage_duration_baselines: [{ from_stage: 9, p50_business_days: 18 }],
    };
    const supabase = createTrackBMockSupabase(tables);
    const result = await recordInspectionRelease(supabase, {
      coordinationRecordId: "coord-1",
      userId: "user-1",
    });
    assert.ok(tables.coordination_records[0].inspection_release_received_at);
    assert.ok(result.record.inspection_release_received_at);
  });

  it("writes milestone type meter_set on confirmed date", async () => {
    const tables = {
      coordination_records: [
        stage6CompletedRecord({
          current_stage: 9,
          current_stage_state: "IN_PROGRESS",
          inspection_release_received_at: "2026-08-20T00:00:00.000Z",
        }),
      ],
      coordination_milestones: [],
      coordination_costs: [],
      coordination_equipment: [],
      utility_stage_duration_baselines: [{ from_stage: 9, p50_business_days: 18 }],
    };
    const supabase = createTrackBMockSupabase(tables);
    const result = await confirmMeterSetDate(supabase, {
      coordinationRecordId: "coord-1",
      scheduledDate: "2026-09-01",
    });
    assert.equal(result.scheduled, true);
    assert.equal(result.milestone.milestone_type, "meter_set");
    assert.equal(result.stage_completed, false);
  });

  it("does not auto-complete Stage 9 after request", async () => {
    const tables = {
      coordination_records: [
        stage6CompletedRecord({
          current_stage: 9,
          current_stage_state: "IN_PROGRESS",
          inspection_release_received_at: "2026-08-20T00:00:00.000Z",
          utility_project_manager: "Utility PM",
          utility_contact_name: "Utility PM",
          utility_contact_email: "pm@utility.test",
        }),
      ],
      coordination_communications: [],
      projects: [{ id: "proj-1", name: "Site A" }],
    };
    const supabase = createTrackBMockSupabase(tables);
    const result = await requestMeterSet(supabase, {
      coordinationRecordId: "coord-1",
      deps: { sendMailFn: async () => ({ ok: true, message_id: "m1" }) },
    });
    assert.equal(result.started, true);
    assert.equal(result.stage_completed, false);
    assert.equal(tables.coordination_records[0].current_stage_state, "IN_PROGRESS");
  });
});
