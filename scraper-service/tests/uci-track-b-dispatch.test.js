"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  mayWrite,
  dispatchClassifiedCommunication,
} = require("../app/services/uci/uci-communication-dispatch.service.js");
const { createTrackBMockSupabase, stage6CompletedRecord } = require("./helpers/uci-track-b-mock.js");

function comm(overrides) {
  return {
    id: "comm-1",
    coordination_record_id: "coord-1",
    project_id: "proj-1",
    classification: "ciac_invoice",
    classification_confidence: 0.9,
    agent_processed_metadata: { extracted_fields: { amount: 1800 } },
    ...overrides,
  };
}

describe("Track B communication dispatch", () => {
  it("low confidence / flagged / unmatched do not write", () => {
    assert.equal(mayWrite(comm({ classification_confidence: 0.4 })).ok, false);
    assert.equal(
      mayWrite(comm({ agent_processed_metadata: { flagged_for_review: true } })).ok,
      false,
    );
    assert.equal(
      mayWrite(comm({ agent_processed_metadata: { match: { matched: false } } })).ok,
      false,
    );
  });

  it("routes five consumers from classifier output", async () => {
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
        { id: "eq-1", project_id: "proj-1", coordination_record_id: "coord-1", status: "on_order", eta_history: [] },
      ],
      coordination_communications: [],
      coordination_milestones: [],
      projects: [{ id: "proj-1", name: "Site A" }],
      utility_stage_duration_baselines: [{ from_stage: 9, p50_business_days: 18 }],
    };
    const supabase = createTrackBMockSupabase(tables);

    const invoice = await dispatchClassifiedCommunication(supabase, {
      communication: comm({ classification: "ciac_invoice" }),
    });
    assert.equal(invoice.consumer, "ciac_invoice");

    const eta = await dispatchClassifiedCommunication(supabase, {
      communication: comm({
        classification: "equipment_eta_update",
        agent_processed_metadata: { extracted_fields: { eta: "2026-09-15" } },
      }),
    });
    assert.equal(eta.consumer, "equipment_eta_update");

    const release = await dispatchClassifiedCommunication(supabase, {
      communication: comm({ classification: "inspection_release_request" }),
    });
    assert.equal(release.wrote_received_at, false);
    assert.equal(tables.coordination_records[0].inspection_release_received_at, "2026-08-20T00:00:00.000Z");

    const meter = await dispatchClassifiedCommunication(supabase, {
      communication: comm({
        classification: "meter_set_scheduling",
        agent_processed_metadata: { extracted_fields: { scheduled_date: "2026-09-01" } },
      }),
    });
    assert.equal(meter.applied, true);

    const energize = await dispatchClassifiedCommunication(supabase, {
      communication: comm({
        classification: "energization_confirmation",
        agent_processed_metadata: { extracted_fields: { actual_date: "2026-09-10" } },
      }),
    });
    assert.equal(energize.captured, true);
  });

  it("routes remaining Agent 5 categories including unclassified no-write", async () => {
    const tables = {
      coordination_records: [
        stage6CompletedRecord({
          current_stage: 5,
          current_stage_state: "COMPLETED",
          acknowledgment_received_at: "2026-08-01T00:00:00.000Z",
        }),
      ],
      coordination_applications: [{ id: "app-1", coordination_record_id: "coord-1", utility_ticket_number: "T-1" }],
      coordination_communications: [],
      coordination_cos_design_records: [],
      coordination_stage_transitions: [],
      utility_stage_duration_baselines: [],
    };
    const supabase = createTrackBMockSupabase(tables);

    const ack = await dispatchClassifiedCommunication(supabase, {
      communication: comm({ classification: "acknowledgment" }),
    });
    assert.equal(ack.dispatched, true);
    assert.equal(ack.consumer, "acknowledgment");

    const cos = await dispatchClassifiedCommunication(supabase, {
      communication: comm({ classification: "class_of_service" }),
    });
    assert.equal(cos.dispatched, true);
    assert.equal(cos.consumer, "class_of_service");

    const design = await dispatchClassifiedCommunication(supabase, {
      communication: comm({ classification: "design_review_response" }),
    });
    assert.equal(design.dispatched, true);
    assert.equal(design.consumer, "design_review_response");

    const rfi = await dispatchClassifiedCommunication(supabase, {
      communication: comm({ classification: "request_for_information" }),
    });
    assert.equal(rfi.needs_attention, true);

    const esc = await dispatchClassifiedCommunication(supabase, {
      communication: comm({ classification: "escalation_or_problem" }),
    });
    assert.equal(esc.needs_attention, true);

    const unclassified = await dispatchClassifiedCommunication(supabase, {
      communication: comm({ classification: "unclassified" }),
    });
    assert.equal(unclassified.dispatched, false);
    assert.equal(unclassified.reason, "unclassified");
  });
});
