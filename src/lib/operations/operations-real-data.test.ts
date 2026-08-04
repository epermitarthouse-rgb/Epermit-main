import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  allMockReimbursables,
  mockCriticalPathTaskCount,
  mockReimbursableTotals,
  mockScopeLines,
  mockScopeTotals,
  mockWorkflowGroups,
} from "./operations-demo-data.ts";
import {
  buildOperationsRealBundle,
  buildProjectSummaryRows,
  countRealInvoiceRefs,
  filterRealRows,
  mapProjectHeader,
  sumRealAmounts,
} from "./operations-real-data.ts";
import type { CoordinationCost } from "../../types/uci.ts";

describe("operations calculation boundaries", () => {
  const header = mapProjectHeader({
    id: "proj-1",
    name: "Real Selected Project",
    permit_number: "P-100",
    address: "1 Main St",
    city: "Arlington",
    state: "VA",
    zip_code: "22201",
    jurisdiction: "Arlington County",
    client_name: "Acme",
    client_email: "pm@acme.test",
    service_type: "Expediting",
    contract_value: 50000,
    reimbursement_amount: 1200,
    reimbursement_description: "Agency fees",
    permit_fee: 400,
    expeditor_cost: 200,
    total_cost: 1600,
    qb_invoice_id_m1: "INV-1",
    qb_invoice_id_m2: null,
    qb_invoice_id_m3: null,
    m1_triggered: true,
    m2_triggered: false,
    m3_triggered: false,
    m1_triggered_at: "2026-01-01T00:00:00Z",
    m2_triggered_at: null,
    m3_triggered_at: null,
  });

  const costs: CoordinationCost[] = [
    {
      id: "cost-1",
      coordination_record_id: "cr-1",
      project_id: "proj-1",
      cost_type: "Application Fee",
      estimated_amount: "100",
      estimated_at: null,
      actual_amount: "150",
      actual_received_at: null,
      variance_pct: null,
      invoice_received_doc_ref: null,
      paid_at: null,
      payment_method: null,
      client_billed_at: null,
      quickbooks_invoice_id: "UCI-QB-9",
      notes: "PEPCO",
      created_at: "2026-01-02T00:00:00Z",
      updated_at: "2026-01-02T00:00:00Z",
    },
  ];

  it("builds real/partial totals only from project + UCI rows", () => {
    const bundle = buildOperationsRealBundle(header, costs);
    assert.equal(bundle.realTrackedCount, 4); // reimbursement, permit fee, expeditor, 1 UCI
    assert.equal(bundle.realTrackedAmount, 1200 + 400 + 200 + 150);
    assert.equal(bundle.realInvoiceRefCount, 2); // M1 + UCI QB id
    assert.equal(bundle.header.name, "Real Selected Project");
  });

  it("never merges mock Langston/Rockville amounts into real totals", () => {
    const bundle = buildOperationsRealBundle(header, costs);
    const mock = mockReimbursableTotals(allMockReimbursables);
    assert.ok(mock.sum > 0);
    assert.notEqual(bundle.realTrackedAmount, mock.sum);
    assert.notEqual(bundle.realTrackedCount, mock.count);
    assert.ok(
      !allMockReimbursables.some((r) => r.project === bundle.header.name),
      "fixture projects must not inherit selected project name",
    );
  });

  it("keeps scope hours and CP KPIs as mock-only definitions", () => {
    const scope = mockScopeTotals(mockScopeLines);
    const cp = mockCriticalPathTaskCount(mockWorkflowGroups);
    assert.ok(scope.hours > 0);
    assert.ok(cp > 0);
    // Real bundle has no scope/CP fields by design
    const bundle = buildOperationsRealBundle(header, []);
    assert.equal(
      "scopeHours" in bundle,
      false,
    );
  });

  it("filters real rows without touching mock fixtures", () => {
    const rows = buildProjectSummaryRows(header);
    const filtered = filterRealRows(rows, "permit");
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0].kind, "permit_fee");
    assert.equal(allMockReimbursables.length > filtered.length, true);
  });

  it("counts invoice refs honestly (milestones + UCI only)", () => {
    const summary = buildProjectSummaryRows(header);
    const utility = [
      {
        id: "u1",
        kind: "utility_coordination" as const,
        label: "Fee",
        description: null,
        amount: 10,
        permitNumber: "P-100",
        invoiceRef: "X",
        paidAt: null,
        billedAt: null,
        sourceTable: "coordination_costs" as const,
      },
      {
        id: "u2",
        kind: "utility_coordination" as const,
        label: "Fee2",
        description: null,
        amount: 10,
        permitNumber: "P-100",
        invoiceRef: null,
        paidAt: null,
        billedAt: null,
        sourceTable: "coordination_costs" as const,
      },
    ];
    assert.equal(countRealInvoiceRefs(header, utility), 2);
    assert.equal(sumRealAmounts([...summary, ...utility]), 1200 + 400 + 200 + 20);
  });
});
