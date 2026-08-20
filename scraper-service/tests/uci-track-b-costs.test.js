"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { upsertCostRecord } = require("../app/services/uci/uci-costs.service.js");
const { variancePct, varianceGates, recordCostPayment } = require("../app/services/uci/uci-cost-tracker.service.js");
const {
  requestIdForCost,
  createUciPassthroughInvoice,
  retryUciPassthroughInvoice,
  classifyQbInvoiceError,
} = require("../app/services/uci/uci-qb-passthrough.service.js");
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
      projects: [{ id: "proj-1", name: "Site A", client_name: "Client A" }],
      coordination_records: [stage6CompletedRecord()],
    };
    const supabase = createTrackBMockSupabase(tables);
    let createCalls = 0;
    const result = await createUciPassthroughInvoice(supabase, {
      cost,
      getValidConnectionFn: async () => ({}),
      getOrCreateCustomerFn: async () => ({ id: "CUST-1" }),
      queryFn: async () => ({ QueryResponse: { Invoice: [{ Id: "QB-EXISTING" }] } }),
      createInvoiceFn: async () => {
        createCalls += 1;
        return { id: "QB-NEW" };
      },
    });
    assert.equal(createCalls, 0);
    assert.equal(result.invoice_id, "QB-EXISTING");
    assert.equal(result.created, false);
    assert.equal(tables.coordination_costs[0].quickbooks_invoice_id, "QB-EXISTING");
    assert.equal(tables.coordination_costs[0].qb_sync_status, "succeeded");
  });

  it("approved + paid triggers invoice attempt and resolves customer before create", async () => {
    const cost = {
      id: "cost-paid",
      project_id: "proj-1",
      coordination_record_id: "coord-1",
      paid_at: "2026-08-10T00:00:00.000Z",
      actual_amount: 1150,
      cost_type: "CIAC",
      client_approval_status: "approved",
      qb_attempt_count: 0,
    };
    const tables = {
      coordination_costs: [{ ...cost }],
      projects: [{ id: "proj-1", name: "Highland Springs", client_name: "Client", client_email: "pm@test.com" }],
      coordination_records: [stage6CompletedRecord({ current_stage: 7, current_stage_state: "IN_PROGRESS" })],
    };
    const supabase = createTrackBMockSupabase(tables);
    let customerResolved = false;
    let createCalls = 0;
    const result = await createUciPassthroughInvoice(supabase, {
      cost,
      getValidConnectionFn: async () => ({}),
      getOrCreateCustomerFn: async () => {
        customerResolved = true;
        return { id: "CUST-HS" };
      },
      queryFn: async () => ({}),
      createInvoiceFn: async () => {
        createCalls += 1;
        return { id: "QB-1150" };
      },
      qbItemId: "ITEM-1",
    });
    assert.equal(customerResolved, true);
    assert.equal(createCalls, 1);
    assert.equal(result.created, true);
    assert.equal(result.invoice_id, "QB-1150");
    assert.equal(tables.coordination_costs[0].quickbooks_invoice_id, "QB-1150");
    assert.equal(tables.coordination_costs[0].qb_sync_status, "succeeded");
    assert.equal(tables.projects[0].qb_customer_id, "CUST-HS");
  });

  it("fails closed when project has no qb_customer_id and no client contact", async () => {
    const cost = {
      id: "cost-no-client",
      project_id: "proj-1",
      coordination_record_id: "coord-1",
      paid_at: "2026-08-10T00:00:00.000Z",
      actual_amount: 1150,
      cost_type: "CIAC",
      qb_attempt_count: 0,
    };
    const tables = {
      coordination_costs: [{ ...cost }],
      projects: [{ id: "proj-1", name: "Highland Springs" }],
      coordination_records: [stage6CompletedRecord()],
    };
    const supabase = createTrackBMockSupabase(tables);
    let createCalls = 0;
    const result = await createUciPassthroughInvoice(supabase, {
      cost,
      getValidConnectionFn: async () => ({}),
      queryFn: async () => ({}),
      createInvoiceFn: async () => {
        createCalls += 1;
        return { id: "QB-SHOULD-NOT-RUN" };
      },
      qbItemId: "ITEM-1",
    });
    assert.equal(createCalls, 0);
    assert.equal(result.reason, "failed");
    assert.equal(result.retryable, false);
    assert.equal(result.error_code, "quickbooks_customer_missing");
    assert.equal(tables.coordination_costs[0].qb_sync_status, "failed");
    assert.match(String(tables.coordination_costs[0].qb_last_error), /client_name and\/or client_email/);
  });

  it("stores actionable failed state when QuickBooks is not connected", async () => {
    const cost = {
      id: "cost-qb-down",
      project_id: "proj-1",
      coordination_record_id: "coord-1",
      paid_at: "2026-08-10T00:00:00.000Z",
      actual_amount: 1150,
      cost_type: "CIAC",
      qb_attempt_count: 0,
    };
    const tables = {
      coordination_costs: [{ ...cost }],
      projects: [{ id: "proj-1", name: "Site A" }],
      coordination_records: [stage6CompletedRecord()],
    };
    const supabase = createTrackBMockSupabase(tables);
    const result = await createUciPassthroughInvoice(supabase, {
      cost,
      getValidConnectionFn: async () => {
        const err = new Error("QuickBooks is not connected for environment: production");
        err.code = "QB_NOT_CONNECTED";
        throw err;
      },
      queryFn: async () => ({}),
    });
    assert.equal(result.reason, "failed");
    assert.equal(result.retryable, false);
    assert.equal(tables.coordination_costs[0].qb_sync_status, "failed");
    assert.match(String(tables.coordination_costs[0].qb_last_error), /QB_NOT_CONNECTED/);
    assert.equal(tables.coordination_costs[0].quickbooks_invoice_id, undefined);
  });

  it("manual retry is idempotent and stores external invoice id on success", async () => {
    const cost = {
      id: "cost-retry",
      project_id: "proj-1",
      coordination_record_id: "coord-1",
      paid_at: "2026-08-10T00:00:00.000Z",
      actual_amount: 1150,
      cost_type: "CIAC",
      qb_sync_status: "failed",
      qb_attempt_count: 1,
      qb_last_error: "[QB_NOT_CONNECTED] QuickBooks is not connected",
    };
    const tables = {
      coordination_costs: [{ ...cost }],
      projects: [{ id: "proj-1", name: "Site A", client_name: "Client" }],
      coordination_records: [stage6CompletedRecord()],
    };
    const supabase = createTrackBMockSupabase(tables);
    let createCalls = 0;
    const result = await retryUciPassthroughInvoice(supabase, {
      costId: "cost-retry",
      deps: {
        getValidConnectionFn: async () => ({}),
        getOrCreateCustomerFn: async () => ({ id: "CUST-1" }),
        queryFn: async () => ({}),
        createInvoiceFn: async () => {
          createCalls += 1;
          return { id: "QB-RETRY-1" };
        },
        qbItemId: "ITEM-1",
      },
    });
    assert.equal(createCalls, 1);
    assert.equal(result.invoice_id, "QB-RETRY-1");
    assert.equal(tables.coordination_costs[0].quickbooks_invoice_id, "QB-RETRY-1");
    assert.equal(tables.coordination_costs[0].qb_sync_status, "succeeded");

    const again = await retryUciPassthroughInvoice(supabase, { costId: "cost-retry" });
    assert.equal(again.reason, "already_invoiced");
    assert.equal(createCalls, 1);
  });

  it("classifies missing customerId errors as non-retryable failed", () => {
    const classified = classifyQbInvoiceError(new Error("createDraftInvoice: customerId is required."));
    assert.equal(classified.status, "failed");
    assert.equal(classified.retryable, false);
  });

  it("recordCostPayment triggers invoice attempt after utility paid", async () => {
    const tables = {
      coordination_costs: [
        {
          id: "cost-pay",
          coordination_record_id: "coord-1",
          project_id: "proj-1",
          cost_type: "CIAC",
          actual_amount: 1150,
          client_approval_status: "approved",
        },
      ],
      coordination_records: [stage6CompletedRecord({ current_stage: 7, current_stage_state: "IN_PROGRESS" })],
      projects: [{ id: "proj-1", name: "Site A", client_name: "Client" }],
    };
    const supabase = createTrackBMockSupabase(tables);
    let createCalls = 0;
    await recordCostPayment(supabase, {
      costId: "cost-pay",
      paymentMethod: "utility",
      deps: {
        createInvoiceFn: async () => {
          createCalls += 1;
          return { id: "QB-PAY-1" };
        },
        queryFn: async () => ({}),
        getValidConnectionFn: async () => ({}),
        getOrCreateCustomerFn: async () => ({ id: "CUST-1" }),
        qbItemId: "ITEM-1",
      },
    });
    assert.equal(createCalls, 1);
    assert.equal(tables.coordination_costs[0].quickbooks_invoice_id, "QB-PAY-1");
  });
});
