"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  computePredictedDates,
  recomputePredictedDates,
} = require("../app/services/uci/uci-prediction.service.js");
const { addBusinessDays } = require("../app/services/uci/uci-ack-sla.service.js");
const { createTrackBMockSupabase, stage6CompletedRecord } = require("./helpers/uci-track-b-mock.js");

describe("Track B §4.13 prediction", () => {
  it("P50 = today + remaining, P90 = remaining * 1.4", () => {
    const today = new Date("2026-08-20T12:00:00.000Z");
    const computed = computePredictedDates({
      today,
      baselineBusinessDays: 10,
      stageElapsedBusinessDays: 2,
    });
    assert.equal(computed.remaining_days, 12);
    assert.equal(computed.p90_days, Math.ceil(12 * 1.4));
    assert.equal(computed.predicted_p50_date, addBusinessDays(today, 12).toISOString().slice(0, 10));
    assert.equal(computed.predicted_p90_date, addBusinessDays(today, computed.p90_days).toISOString().slice(0, 10));
  });

  it("flags P50 slip >7 calendar days vs previous", async () => {
    const tables = {
      coordination_records: [
        stage6CompletedRecord({
          current_stage: 7,
          current_stage_state: "IN_PROGRESS",
          predicted_p50_date: "2026-08-21",
          updated_at: "2026-08-20T00:00:00.000Z",
        }),
      ],
      utility_providers: [{ id: "prov-1", ownership_type: "iou" }],
      utility_stage_duration_baselines: [
        { utility_type: "electric", ownership_type: "iou", from_stage: 7, p50_business_days: 40 },
      ],
    };
    const supabase = createTrackBMockSupabase(tables);
    const result = await recomputePredictedDates(supabase, {
      record: tables.coordination_records[0],
      now: new Date("2026-08-20T12:00:00.000Z"),
    });
    assert.equal(result.computed, true);
    assert.ok(result.p50_slip_days > 7);
    assert.equal(result.p50_slipped, true);
  });
});
