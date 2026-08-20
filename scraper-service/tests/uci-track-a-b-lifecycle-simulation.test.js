"use strict";

/**
 * Integrated Track A + B lifecycle simulation against CET-2026-UCI-BACKEND-001 safeguards.
 * Uses in-memory fixtures (no live Graph / portal / QB).
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { computeLoadEngine } = require("../app/services/uci/uci-load-engine.service.js");
const { loadTemplateManifest } = require("../app/services/uci/uci-application-builder.service.js");
const { reconcileSentItemsMessage } = require("../app/services/uci/uci-graph-sent-items.service.js");
const { isBounceMessage } = require("../app/services/uci/uci-email-bounce.service.js");
const { COS_COMPARE_FIELDS } = require("../app/services/uci/uci-cos-constants.js");
const {
  canCompleteStage8,
  stage9BlockReasons,
  evaluateLifecycleGuards,
} = require("../app/services/uci/uci-lifecycle-guards.service.js");
const { dispatchClassifiedCommunication } = require("../app/services/uci/uci-communication-dispatch.service.js");
const { recomputePredictedDates } = require("../app/services/uci/uci-prediction.service.js");
const { UCI_COMMUNICATION_CATEGORIES } = require("../app/services/uci/uci-communication-categories.js");
const { createTrackBMockSupabase, stage6CompletedRecord } = require("./helpers/uci-track-b-mock.js");

describe("UCI Track A+B integrated lifecycle simulation", () => {
  it("holds Graph reconcile, Stage 8/9, dispatcher, and fallback provenance invariants", async () => {
    const load = computeLoadEngine({
      utilityType: "electric",
      project: { name: "QSR" },
      equipment: [{ connected_kw: 80 }],
      verifiedValues: { requested_voltage: "208/120", phase: 3 },
    });
    assert.ok(load.calculated_values.service_size);
    assert.ok(load.calculated_values.service_amperage.source);

    const generic = loadTemplateManifest("unknown-mco", "electric");
    assert.equal(generic.template_gap, true);

    const unreconciliation = await reconcileSentItemsMessage("token", {
      subject: "no-match",
      fetchFn: async () => ({ ok: true, json: async () => ({ value: [] }) }),
      attempts: 1,
    });
    assert.equal(unreconciliation.message_id, null);
    assert.equal(unreconciliation.reconciled, false);

    assert.equal(
      isBounceMessage({ sender: "postmaster@outlook.com", raw_subject: "Undeliverable: pkg" }),
      true,
    );
    assert.ok(COS_COMPARE_FIELDS.some((f) => f.key === "gas_regulator"));

    assert.equal(
      canCompleteStage8({}, [{ status: "on_order", current_eta: "2026-09-01" }]),
      true,
    );
    assert.equal(
      canCompleteStage8({}, [{ status: "installed" }]),
      true,
    );
    assert.equal(
      canCompleteStage8({}, [{ status: "pending" }]),
      false,
    );

    const once = stage9BlockReasons({
      metadata: { uci_meter_set: { reschedule_count: 1 } },
    });
    const twice = stage9BlockReasons({
      metadata: { uci_meter_set: { reschedule_count: 2 } },
    });
    assert.equal(once.includes("METER_SET_MULTI_RESCHEDULE"), false);
    assert.equal(twice.includes("METER_SET_MULTI_RESCHEDULE"), true);

    const tables = {
      coordination_records: [
        stage6CompletedRecord({
          current_stage: 9,
          current_stage_state: "IN_PROGRESS",
          inspection_release_received_at: "2026-08-20T00:00:00.000Z",
        }),
      ],
      coordination_costs: [],
      coordination_equipment: [
        {
          id: "eq-1",
          project_id: "proj-1",
          coordination_record_id: "coord-1",
          status: "on_order",
          current_eta: "2026-09-15",
          eta_history: [],
        },
      ],
      coordination_communications: [],
      coordination_milestones: [],
      coordination_applications: [],
      coordination_cos_design_records: [],
      coordination_stage_transitions: [],
      projects: [{ id: "proj-1", name: "Site A" }],
      utility_providers: [{ id: "prov-1", ownership_type: "iou" }],
      utility_stage_duration_baselines: [
        {
          utility_type: "electric",
          ownership_type: "iou",
          from_stage: 9,
          p50_business_days: 18,
          source: "seed_fallback",
        },
      ],
    };
    const supabase = createTrackBMockSupabase(tables);
    const consumers = [];
    for (const classification of UCI_COMMUNICATION_CATEGORIES) {
      const result = await dispatchClassifiedCommunication(supabase, {
        communication: {
          id: `comm-${classification}`,
          coordination_record_id: "coord-1",
          project_id: "proj-1",
          classification,
          classification_confidence: 0.9,
          agent_processed_metadata: {
            extracted_fields: {
              amount: 1800,
              eta: "2026-09-15",
              scheduled_date: "2026-09-01",
              actual_date: "2026-09-10",
            },
          },
        },
      });
      consumers.push({ classification, dispatched: result.dispatched, consumer: result.consumer, reason: result.reason });
    }
    assert.equal(consumers.find((c) => c.classification === "unclassified")?.dispatched, false);
    assert.equal(consumers.filter((c) => c.classification !== "unclassified" && c.dispatched).length, 10);

    const prediction = await recomputePredictedDates(supabase, {
      record: tables.coordination_records[0],
      now: new Date("2026-08-20T12:00:00.000Z"),
    });
    assert.equal(prediction.baseline_source, "seed_fallback");
    assert.equal(prediction.prediction_reason.masquerades_as_historical, false);

    const guards = evaluateLifecycleGuards(tables.coordination_records[0], {
      equipment: tables.coordination_equipment,
    });
    assert.equal(guards.can_complete_stage_8, true);
  });
});
