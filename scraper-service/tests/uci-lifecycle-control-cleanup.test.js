"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  completeStage5Acknowledgment,
} = require("../app/services/uci/uci-ack-acceptance.service.js");
const {
  maybeCompleteStage7,
  maybeTryAutoCompleteStage7,
  approveCoordinationCost,
  recordCostPayment,
} = require("../app/services/uci/uci-cost-tracker.service.js");
const {
  appendEquipmentEta,
  maybeTryAutoCompleteStage8,
} = require("../app/services/uci/uci-equipment-tracker.service.js");
const { completeStage3PackageReviewHandoff } = require("../app/services/uci/uci-transitions.service.js");
const { enterStage9 } = require("../app/services/uci/uci-stage9-entry.service.js");
const { createTrackBMockSupabase, stage6CompletedRecord } = require("./helpers/uci-track-b-mock.js");

function stage5CompletedRecord(overrides = {}) {
  return {
    id: "coord-1",
    project_id: "proj-1",
    user_id: "user-1",
    current_stage: 5,
    current_stage_state: "COMPLETED",
    acknowledgment_received_at: "2026-08-19T12:00:00.000Z",
    utility_project_manager: "Alex",
    metadata: {},
    ...overrides,
  };
}

function reviewedPackageApplication(overrides = {}) {
  return {
    id: "package-1",
    coordination_record_id: "coord-1",
    project_id: "proj-1",
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

describe("UCI lifecycle-control cleanup", () => {
  it("Stage 5 complete → Stage 6 entry on direct acknowledgment path", async () => {
    const tables = {
      coordination_records: [
        {
          id: "coord-1",
          project_id: "proj-1",
          current_stage: 5,
          current_stage_state: "AWAITING_UTILITY",
          acknowledgment_received_at: null,
          metadata: {},
          ack_sla_started_at: new Date().toISOString(),
          ack_sla_stopped_at: null,
        },
      ],
      coordination_stage_transitions: [],
      coordination_applications: [{ id: "app-1", coordination_record_id: "coord-1", utility_ticket_number: null }],
    };
    const supabase = createTrackBMockSupabase(tables);
    const result = await completeStage5Acknowledgment(supabase, {
      coordinationRecordId: "coord-1",
      source: "system",
      communicationId: "comm-1",
      fields: {
        ticket: "T-1",
        account: null,
        pm: "Alex",
        nextAction: "Monitor COS",
        ackDate: "2026-08-19T12:00:00.000Z",
      },
    });
    assert.equal(result.completed, true);
    assert.equal(result.stage_6_started, true);
    assert.equal(tables.coordination_records[0].current_stage, 6);
    assert.equal(tables.coordination_records[0].current_stage_state, "IN_PROGRESS");
  });

  it("Stage 7 complete → Stage 8 auto-entry", async () => {
    const settledCost = {
      id: "cost-1",
      coordination_record_id: "coord-1",
      project_id: "proj-1",
      cost_type: "CIAC",
      estimated_amount: 1000,
      actual_amount: 1000,
      client_approval_status: "approved",
      paid_at: "2026-08-10T00:00:00.000Z",
      client_billed_at: "2026-08-11T00:00:00.000Z",
      quickbooks_invoice_id: "QB-1",
    };
    const tables = {
      coordination_records: [
        stage6CompletedRecord({
          current_stage: 7,
          current_stage_state: "IN_PROGRESS",
          class_of_service_issued_at: "2026-08-01T00:00:00.000Z",
        }),
      ],
      coordination_costs: [settledCost],
      coordination_equipment: [],
      coordination_stage_transitions: [],
      projects: [{ id: "proj-1" }],
      utility_stage_duration_baselines: [{ from_stage: 8, p50_business_days: 40 }],
    };
    const supabase = createTrackBMockSupabase(tables);
    const result = await maybeCompleteStage7(supabase, { coordinationRecordId: "coord-1" });
    assert.equal(result.record.current_stage, 8);
    assert.equal(result.record.current_stage_state, "IN_PROGRESS");
    assert.equal(result.stage_8?.entered, true);
    assert.equal(tables.coordination_records[0].current_stage, 8);
  });

  it("Stage 7 auto-completes when cost evidence satisfies guards", async () => {
    const tables = {
      coordination_records: [
        stage6CompletedRecord({
          current_stage: 7,
          current_stage_state: "IN_PROGRESS",
        }),
      ],
      coordination_costs: [
        {
          id: "cost-1",
          coordination_record_id: "coord-1",
          project_id: "proj-1",
          cost_type: "CIAC",
          estimated_amount: 500,
          actual_amount: null,
          client_approval_status: "pending",
        },
      ],
      coordination_stage_transitions: [],
      projects: [{ id: "proj-1" }],
      utility_stage_duration_baselines: [{ from_stage: 8, p50_business_days: 40 }],
    };
    const supabase = createTrackBMockSupabase(tables);
    await approveCoordinationCost(supabase, { costId: "cost-1", userId: "user-1" });
    await recordCostPayment(supabase, {
      costId: "cost-1",
      paymentMethod: "ach",
      deps: { createInvoiceFn: async () => ({ id: "QB-1" }), queryFn: async () => ({}) },
    });
    tables.coordination_costs[0].client_billed_at = "2026-08-11T00:00:00.000Z";
    tables.coordination_costs[0].quickbooks_invoice_id = "QB-1";
    assert.equal(tables.coordination_records[0].current_stage, 8);
    assert.equal(tables.coordination_records[0].current_stage_state, "IN_PROGRESS");
  });

  it("Stage 8 auto-completes when equipment ETAs satisfy guards", async () => {
    const tables = {
      coordination_records: [
        {
          id: "coord-1",
          project_id: "proj-1",
          current_stage: 8,
          current_stage_state: "IN_PROGRESS",
        },
      ],
      coordination_equipment: [
        {
          id: "eq-1",
          coordination_record_id: "coord-1",
          project_id: "proj-1",
          equipment_type: "transformer",
          status: "pending",
          current_eta: null,
          initial_eta: "2026-09-01",
          eta_history: [],
          last_check_in_at: null,
        },
      ],
      coordination_stage_transitions: [],
      projects: [{ id: "proj-1", name: "Site A" }],
      utility_providers: [{ id: "prov-1" }],
    };
    const supabase = createTrackBMockSupabase(tables);
    await appendEquipmentEta(supabase, {
      equipmentId: "eq-1",
      projectId: "proj-1",
      eta: "2026-09-08",
      source: "utility_email",
      status: "on_order",
    });
    assert.equal(tables.coordination_records[0].current_stage, 8);
    assert.equal(tables.coordination_records[0].current_stage_state, "COMPLETED");
  });

  it("Stage 9 requires explicit entry after Stage 8 complete", async () => {
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
          status: "on_order",
          current_eta: "2026-09-01",
        },
      ],
      coordination_stage_transitions: [],
      projects: [{ id: "proj-1" }],
    };
    const supabase = createTrackBMockSupabase(tables);
    assert.equal(tables.coordination_records[0].current_stage, 8);
    const entered = await enterStage9(supabase, { coordinationRecordId: "coord-1", userId: "user-1" });
    assert.equal(entered.entered, true);
    assert.equal(tables.coordination_records[0].current_stage, 9);
    assert.equal(tables.coordination_records[0].current_stage_state, "IN_PROGRESS");
  });

  it("Stage 3 package review uses single handoff into Stage 4", async () => {
    const application = reviewedPackageApplication();
    const tables = {
      coordination_records: [
        {
          id: "coord-1",
          project_id: "proj-1",
          current_stage: 3,
          current_stage_state: "IN_PROGRESS",
        },
      ],
      coordination_applications: [application],
      coordination_stage_transitions: [],
    };
    const supabase = createTrackBMockSupabase(tables);
    const result = await completeStage3PackageReviewHandoff(supabase, {
      coordinationRecordId: "coord-1",
      userId: "user-1",
      reason: "Package reviewed",
      application,
      requireActiveStage3: true,
    });
    assert.equal(result.stage4Entered, true);
    assert.equal(result.record.current_stage, 4);
    assert.equal(result.record.current_stage_state, "IN_PROGRESS");
    assert.equal(tables.coordination_stage_transitions.length, 1);
    assert.equal(tables.coordination_stage_transitions[0].to_stage, 4);
  });

  it("reload preserves Stage 7→8 transition state", async () => {
    const tables = {
      coordination_records: [
        stage6CompletedRecord({
          current_stage: 7,
          current_stage_state: "IN_PROGRESS",
        }),
      ],
      coordination_costs: [
        {
          id: "cost-1",
          coordination_record_id: "coord-1",
          project_id: "proj-1",
          cost_type: "CIAC",
          estimated_amount: 1000,
          actual_amount: 1000,
          client_approval_status: "approved",
          paid_at: "2026-08-10T00:00:00.000Z",
          client_billed_at: "2026-08-11T00:00:00.000Z",
          quickbooks_invoice_id: "QB-1",
        },
      ],
      coordination_stage_transitions: [],
      projects: [{ id: "proj-1" }],
      utility_stage_duration_baselines: [{ from_stage: 8, p50_business_days: 40 }],
    };
    const supabase = createTrackBMockSupabase(tables);
    await maybeCompleteStage7(supabase, { coordinationRecordId: "coord-1" });
    const reloaded = tables.coordination_records[0];
    assert.equal(reloaded.current_stage, 8);
    assert.equal(reloaded.current_stage_state, "IN_PROGRESS");
    assert.ok(tables.coordination_stage_transitions.some((t) => t.to_stage === 8));
  });
});
