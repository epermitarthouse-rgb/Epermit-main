"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { upsertCostRecord } = require("../app/services/uci/uci-costs.service.js");
const { variancePct, varianceGates } = require("../app/services/uci/uci-cost-tracker.service.js");
const { requestIdForCost, createUciPassthroughInvoice } = require("../app/services/uci/uci-qb-passthrough.service.js");
const { createTrackBMockSupabase, stage6CompletedRecord } = require("./helpers/uci-track-b-mock.js");

describe("Track B Agent 8 costs", () => {
  it("computes variance gates 5 / 15 / 20", () => {
    assert.equal(variancePct(1000, 1040), 4);
    assert.deepEqual(varianceGates(4), { review: false, p2: false, escalate: false, billing_hold: false });
    assert.equal(varianceGates(8).review, true);
    assert.equal(varianceGates(18).p2, true);
    assert.equal(varianceGates(25).escalate, true);
    assert.equal(varianceGates(25).billing_hold, true);
  });

  it("does not overwrite an existing row by cost_type", async () => {
    const tables = {
      coordination_costs: [
        {
          id: "cost-1",
          coordination_record_id: "coord-1",
          project_id: "proj-1",
          cost_type: "CIAC",
          estimated_amount: 1000,
        },
      ],
      coordination_records: [stage6CompletedRecord()],
      projects: [{ id: "proj-1", name: "Site A" }],
    };
    const supabase = createTrackBMockSupabase(tables);
    const result = await upsertCostRecord(supabase, {
      coordinationRecordId: "coord-1",
      projectId: "proj-1",
      cost: { cost_type: "CIAC", estimated_amount: 2500 },
      skipLifecycle: true,
    });
    assert.equal(result.created, true);
    assert.equal(tables.coordination_costs.length, 2);
    assert.equal(tables.coordination_costs[0].estimated_amount, 1000);
    assert.equal(result.cost.cost_type, "CIAC");
  });

  it("normalizes ciac_estimate to CIAC and rejects free-text types", async () => {
    const tables = {
      coordination_costs: [],
      coordination_records: [stage6CompletedRecord()],
      projects: [{ id: "proj-1" }],
    };
    const supabase = createTrackBMockSupabase(tables);
    const result = await upsertCostRecord(supabase, {
      coordinationRecordId: "coord-1",
      projectId: "proj-1",
      cost: { cost_type: "ciac_estimate", estimated_amount: 1200 },
      skipLifecycle: true,
    });
    assert.equal(result.cost.cost_type, "CIAC");
    await assert.rejects(
      () =>
        upsertCostRecord(supabase, {
          coordinationRecordId: "coord-1",
          projectId: "proj-1",
          cost: { cost_type: "custom_fee", estimated_amount: 1 },
          skipLifecycle: true,
        }),
      /cost_type must be one of/,
    );
  });

  it("uses coordination_costs.id as RequestId and never duplicates when query finds an invoice", async () => {
    const cost = {
      id: "cost-abc",
      project_id: "proj-1",
      coordination_record_id: "coord-1",
      paid_at: "2026-08-10T00:00:00.000Z",
      actual_amount: 1500,
      cost_type: "CIAC",
      qb_attempt_count: 0,
    };
    assert.equal(requestIdForCost(cost), "cost-abc");
    const tables = {
      coordination_costs: [{ ...cost }],
      projects: [{ id: "proj-1", name: "Site A" }],
      coordination_records: [stage6CompletedRecord()],
    };
    const supabase = createTrackBMockSupabase(tables);
    let createCalls = 0;
    const result = await createUciPassthroughInvoice(supabase, {
      cost,
      queryFn: async () => ({ QueryResponse: { Invoice: [{ Id: "QB-EXISTING" }] } }),
      createInvoiceFn: async () => {
        createCalls += 1;
        return { id: "QB-NEW" };
      },
    });
    assert.equal(createCalls, 0);
    assert.equal(result.invoice_id, "QB-EXISTING");
    assert.equal(result.created, false);
  });
});
