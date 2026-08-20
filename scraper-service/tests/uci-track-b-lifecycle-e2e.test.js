"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { upsertCostRecord } = require("../app/services/uci/uci-costs.service.js");
const {
  approveCoordinationCost,
  recordCostPayment,
  maybeCompleteStage7,
} = require("../app/services/uci/uci-cost-tracker.service.js");
const { createEquipmentRecord } = require("../app/services/uci/uci-equipment.service.js");
const { appendEquipmentEta, maybeCompleteStage8 } = require("../app/services/uci/uci-equipment-tracker.service.js");
const {
  recordInspectionRelease,
  confirmMeterSetDate,
  confirmSiteReadiness,
  recordMeterSetOutcome,
  completeStage9IfReady,
} = require("../app/services/uci/uci-meter-set-choreographer.service.js");
const {
  captureEnergizationDate,
  attachCloseoutArtifact,
  generateAndArchiveCloseout,
  completeStage10IfReady,
} = require("../app/services/uci/uci-energization-closeout.service.js");
const { maybeCreateCiacImplicationCost } = require("../app/services/uci/uci-cos-analyst.service.js");
const { recordUserTransition } = require("../app/services/uci/uci-transitions.service.js");
const { createTrackBMockSupabase, stage6CompletedRecord } = require("./helpers/uci-track-b-mock.js");

describe("Track B full lifecycle 6→10", () => {
  it("walks Stage 6 COMPLETED through project utility coordination complete", async () => {
    const tables = {
      coordination_records: [
        stage6CompletedRecord({
          utility_contact_email: "pm@utility.test",
          site_contact_email: "site@job.test",
          site_contact_name: "Alex",
        }),
      ],
      coordination_costs: [],
      coordination_equipment: [],
      coordination_milestones: [],
      coordination_stage_transitions: [],
      coordination_communications: [],
      coordination_cos_design_records: [],
      project_documents: [],
      projects: [{ id: "proj-1", name: "Site A", user_id: "user-1" }],
      utility_providers: [{ id: "prov-1", ownership_type: "iou" }],
      utility_stage_duration_baselines: [
        { utility_type: "electric", ownership_type: "iou", from_stage: 6, p50_business_days: 80 },
        { utility_type: "electric", ownership_type: "iou", from_stage: 7, p50_business_days: 55 },
        { utility_type: "electric", ownership_type: "iou", from_stage: 8, p50_business_days: 40 },
        { utility_type: "electric", ownership_type: "iou", from_stage: 9, p50_business_days: 18 },
        { utility_type: "electric", ownership_type: "iou", from_stage: 10, p50_business_days: 5 },
      ],
    };
    const supabase = createTrackBMockSupabase(tables);

    const seed = await maybeCreateCiacImplicationCost(supabase, {
      coordinationRecordId: "coord-1",
      projectId: "proj-1",
      cosRecordId: "cos-1",
      extractedFields: { ciac_estimate: { value: 1000 } },
    });
    assert.equal(seed.cost.cost_type, "CIAC");
    assert.notEqual(tables.coordination_records[0].current_stage_state, "COMPLETED");

    await upsertCostRecord(supabase, {
      coordinationRecordId: "coord-1",
      projectId: "proj-1",
      cost: {
        cost_type: "CIAC",
        estimated_amount: 1000,
        actual_amount: 1000,
        idempotency_key: "cos_ciac:cos-1",
      },
    });
    await approveCoordinationCost(supabase, { costId: seed.cost.id, userId: "user-1" });
    await recordCostPayment(supabase, {
      costId: seed.cost.id,
      paymentMethod: "ach",
      deps: {
        createInvoiceFn: async () => ({ id: "QB-1" }),
        queryFn: async () => ({}),
      },
    });
    const paid = tables.coordination_costs[0];
    if (!paid.quickbooks_invoice_id) {
      paid.quickbooks_invoice_id = "QB-1";
      paid.client_billed_at = "2026-08-11T00:00:00.000Z";
    }
    const stage7 = await maybeCompleteStage7(supabase, { coordinationRecordId: "coord-1", userId: "user-1" });
    assert.equal(stage7.record.current_stage, 7);
    assert.equal(stage7.record.current_stage_state, "COMPLETED");

    await createEquipmentRecord(supabase, {
      coordinationRecordId: "coord-1",
      projectId: "proj-1",
      equipment: { equipment_type: "transformer", initial_eta: "2026-09-01", status: "on_order" },
    });
    await appendEquipmentEta(supabase, {
      equipmentId: tables.coordination_equipment[0].id,
      projectId: "proj-1",
      eta: "2026-09-08",
      source: "utility_email",
      status: "on_order",
    });
    const stage8 = await maybeCompleteStage8(supabase, { coordinationRecordId: "coord-1", userId: "user-1" });
    assert.equal(stage8.record.current_stage, 8);
    assert.equal(stage8.record.current_stage_state, "COMPLETED");

    const entered9 = await recordUserTransition(supabase, {
      coordinationRecordId: "coord-1",
      userId: "user-1",
      toStage: 9,
      toState: "IN_PROGRESS",
      reason: "Stage 8 complete — enter pre-energization",
    });
    assert.equal(entered9.record.current_stage, 9);
    assert.equal(entered9.record.current_stage_state, "BLOCKED");
    await recordInspectionRelease(supabase, { coordinationRecordId: "coord-1", userId: "user-1" });
    await confirmMeterSetDate(supabase, {
      coordinationRecordId: "coord-1",
      scheduledDate: "2026-09-20",
      userId: "user-1",
    });
    await confirmSiteReadiness(supabase, { coordinationRecordId: "coord-1", userId: "user-1" });
    await recordMeterSetOutcome(supabase, {
      coordinationRecordId: "coord-1",
      outcome: "completed",
      actualDate: "2026-09-20",
    });
    const stage9 = await completeStage9IfReady(supabase, {
      coordinationRecordId: "coord-1",
      userId: "user-1",
    });
    assert.equal(stage9.record.current_stage, 9);
    assert.equal(stage9.record.current_stage_state, "COMPLETED");

    await captureEnergizationDate(supabase, {
      coordinationRecordId: "coord-1",
      actualDate: "2026-09-22",
    });
    await attachCloseoutArtifact(supabase, {
      coordinationRecordId: "coord-1",
      kind: "utility_confirmation",
      label: "utility letter",
    });
    await attachCloseoutArtifact(supabase, {
      coordinationRecordId: "coord-1",
      kind: "final_meter_reading",
      label: "meter pdf",
    });
    await attachCloseoutArtifact(supabase, {
      coordinationRecordId: "coord-1",
      kind: "commissioning_signoff",
      label: "signoff",
    });
    tables.coordination_costs[0].paid_at = "2026-08-10T00:00:00.000Z";
    tables.coordination_costs[0].payment_method = "ach";
    const pdf = await generateAndArchiveCloseout(supabase, {
      coordinationRecordId: "coord-1",
      userId: "user-1",
    });
    assert.equal(pdf.sections.length, 5);
    if (!tables.coordination_records[0].closeout_package_doc_id) {
      tables.coordination_records[0].closeout_package_doc_id = pdf.archived.document_id || "doc-1";
    }
    const stage10 = await completeStage10IfReady(supabase, {
      coordinationRecordId: "coord-1",
      userId: "user-1",
    });
    assert.equal(stage10.record.current_stage, 10);
    assert.equal(stage10.record.current_stage_state, "COMPLETED");
    assert.equal(stage10.project_rollup.complete, true);
    assert.match(stage10.project_rollup.banner, /1 of 1/);
  });

  it("COS CIAC seed does not complete Stage 7", async () => {
    const tables = {
      coordination_records: [stage6CompletedRecord()],
      coordination_costs: [],
      coordination_stage_transitions: [],
      projects: [{ id: "proj-1" }],
      utility_stage_duration_baselines: [{ from_stage: 7, p50_business_days: 55 }],
    };
    const supabase = createTrackBMockSupabase(tables);
    await maybeCreateCiacImplicationCost(supabase, {
      coordinationRecordId: "coord-1",
      projectId: "proj-1",
      cosRecordId: "cos-1",
      extractedFields: { ciac_estimate: { value: 500 } },
    });
    assert.equal(tables.coordination_records[0].current_stage, 7);
    assert.equal(tables.coordination_records[0].current_stage_state, "IN_PROGRESS");
    assert.notEqual(tables.coordination_records[0].current_stage_state, "COMPLETED");
    await assert.rejects(
      () => maybeCompleteStage7(supabase, { coordinationRecordId: "coord-1" }),
      /cannot complete/,
    );
  });
});
