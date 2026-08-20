"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  computePredictedDates,
  recomputePredictedDates,
} = require("../app/services/uci/uci-prediction.service.js");
const {
  afterCoordinationRecordWrite,
  ensureCoordinationRecordPredictions,
} = require("../app/services/uci/uci-record-write.service.js");
const { persistPartialAcknowledgmentEvidence } = require("../app/services/uci/uci-ack-acceptance.service.js");
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

  it("persists P50/P90 with fallback provenance when no historical baseline", async () => {
    const tables = {
      coordination_records: [
        stage6CompletedRecord({
          current_stage: 6,
          current_stage_state: "IN_PROGRESS",
          predicted_p50_date: null,
          current_stage_entered_at: "2026-08-01T00:00:00.000Z",
        }),
      ],
      utility_providers: [{ id: "prov-1", ownership_type: "iou" }],
      utility_stage_duration_baselines: [],
    };
    const supabase = createTrackBMockSupabase(tables);
    const result = await recomputePredictedDates(supabase, {
      record: tables.coordination_records[0],
      now: new Date("2026-08-20T12:00:00.000Z"),
    });
    assert.equal(result.computed, true);
    assert.ok(result.predicted_p50_date);
    assert.ok(result.predicted_p90_date);
    assert.equal(result.baseline_source, "code_fallback");
    assert.equal(result.prediction_reason.masquerades_as_historical, false);
    assert.equal(
      result.predicted_p90_date,
      addBusinessDays(new Date("2026-08-20T12:00:00.000Z"), result.p90_days).toISOString().slice(0, 10),
    );
    assert.equal(tables.coordination_records[0].predicted_p50_date, result.predicted_p50_date);
    assert.equal(tables.coordination_records[0].prediction_baseline_source, "code_fallback");
    assert.ok(tables.coordination_records[0].predicted_p50_computed_at);
  });

  it("lazy backfill fills missing predictions on read hook", async () => {
    const tables = {
      coordination_records: [
        stage6CompletedRecord({
          current_stage: 6,
          predicted_p50_date: null,
        }),
      ],
      utility_providers: [{ id: "prov-1", ownership_type: "iou" }],
    };
    const supabase = createTrackBMockSupabase(tables);
    const backfilled = await ensureCoordinationRecordPredictions(supabase, tables.coordination_records[0]);
    assert.ok(backfilled?.predicted_p50_date);
    assert.ok(backfilled?.predicted_p90_date);
    assert.equal(backfilled?.prediction_baseline_source, "code_fallback");
  });

  it("repeated lifecycle recompute is idempotent for the same inputs", async () => {
    const tables = {
      coordination_records: [
        stage6CompletedRecord({
          current_stage: 7,
          current_stage_state: "IN_PROGRESS",
          predicted_p50_date: null,
          current_stage_entered_at: "2026-08-20T00:00:00.000Z",
        }),
      ],
      utility_providers: [{ id: "prov-1", ownership_type: "iou" }],
      utility_stage_duration_baselines: [
        { utility_type: "electric", ownership_type: "iou", from_stage: 7, p50_business_days: 40, source: "seed_fallback" },
      ],
    };
    const supabase = createTrackBMockSupabase(tables);
    const now = new Date("2026-08-20T12:00:00.000Z");
    const first = await afterCoordinationRecordWrite(supabase, tables.coordination_records[0]);
    const second = await afterCoordinationRecordWrite(supabase, first);
    assert.equal(first?.predicted_p50_date, second?.predicted_p50_date);
    assert.equal(first?.predicted_p90_date, second?.predicted_p90_date);
    assert.equal(first?.prediction_baseline_source, "seed_fallback");
  });

  it("Stage 5 evidence persist triggers P50/P90 recompute", async () => {
    const tables = {
      coordination_records: [
        {
          id: "coord-1",
          project_id: "proj-1",
          utility_provider_id: "prov-1",
          utility_type: "electric",
          current_stage: 5,
          current_stage_state: "AWAITING_UTILITY",
          predicted_p50_date: null,
          metadata: {},
        },
      ],
      utility_providers: [{ id: "prov-1", ownership_type: "iou" }],
      coordination_applications: [],
    };
    const supabase = createTrackBMockSupabase(tables);
    const result = await persistPartialAcknowledgmentEvidence(supabase, {
      coordinationRecordId: "coord-1",
      communicationId: "comm-1",
      fields: { ticket: "T-100", ackDate: "2026-08-10" },
      reason: "partial_acknowledgment_evidence",
    });
    assert.equal(result.persisted, true);
    assert.ok(result.coordination_record?.predicted_p50_date);
    assert.ok(result.coordination_record?.predicted_p90_date);
    assert.notEqual(result.coordination_record?.prediction_baseline_source, "historical");
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
