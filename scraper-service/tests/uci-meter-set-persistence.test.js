"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  resolveMeterSetScheduledAt,
  resolveSiteReadinessConfirmedAt,
  rejectMeterSetSoftFailure,
} = require("../app/services/uci/uci-meter-set-persistence.service.js");
const {
  confirmMeterSetDate,
  confirmSiteReadiness,
} = require("../app/services/uci/uci-meter-set-choreographer.service.js");
const { createTrackBMockSupabase, stage6CompletedRecord } = require("./helpers/uci-track-b-mock.js");

describe("uci-meter-set-persistence", () => {
  it("resolves scheduled/readiness from columns, metadata, and milestones", () => {
    assert.equal(
      resolveMeterSetScheduledAt(
        { meter_set_scheduled_at: "2026-09-01T00:00:00.000Z" },
        [],
      ),
      "2026-09-01T00:00:00.000Z",
    );
    assert.equal(
      resolveMeterSetScheduledAt(
        {
          metadata: {
            uci_meter_set: { scheduled_date: "2026-09-15" },
          },
        },
        [],
      ),
      new Date("2026-09-15").toISOString(),
    );
    assert.equal(
      resolveMeterSetScheduledAt(
        {},
        [{ milestone_type: "meter_set", status: "scheduled", target_date: "2026-10-01" }],
      ),
      new Date("2026-10-01").toISOString(),
    );
    assert.equal(
      resolveSiteReadinessConfirmedAt({
        site_readiness_confirmed_at: "2026-09-02T08:00:00.000Z",
      }),
      "2026-09-02T08:00:00.000Z",
    );
    assert.equal(
      resolveSiteReadinessConfirmedAt({
        metadata: { site_readiness: { confirmed_at: "2026-09-03T08:00:00.000Z" } },
      }),
      "2026-09-03T08:00:00.000Z",
    );
  });

  it("throws on soft meter-set failures", () => {
    assert.throws(
      () => rejectMeterSetSoftFailure({ scheduled: false, reason: "not_stage_9" }, "Confirm date"),
      (err) => err.statusCode === 409 && /not stage 9/i.test(err.message),
    );
  });

  it("persists meter_set_scheduled_at and site_readiness_confirmed_at columns", async () => {
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
    const scheduled = await confirmMeterSetDate(supabase, {
      coordinationRecordId: "coord-1",
      scheduledDate: "2026-09-01",
    });
    assert.equal(scheduled.scheduled, true);
    assert.ok(tables.coordination_records[0].meter_set_scheduled_at);
    assert.equal(
      tables.coordination_records[0].metadata.uci_meter_set.scheduled_date,
      "2026-09-01",
    );

    const readiness = await confirmSiteReadiness(supabase, {
      coordinationRecordId: "coord-1",
      userId: "user-1",
    });
    assert.equal(readiness.confirmed, true);
    assert.ok(tables.coordination_records[0].site_readiness_confirmed_at);
    assert.ok(tables.coordination_records[0].metadata.site_readiness.confirmed_at);
  });
});
