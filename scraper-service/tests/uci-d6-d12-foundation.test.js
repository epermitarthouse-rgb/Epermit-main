"use strict";

const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { runCosDiscrepancyAnalysis } = require("../app/services/uci/uci-cos-analyst.service.js");
const { upsertCostRecord } = require("../app/services/uci/uci-costs.service.js");
const { createEquipmentRecord, recordEquipmentCheckIn } = require("../app/services/uci/uci-equipment.service.js");
const { prepareMeterSetChecklist } = require("../app/services/uci/uci-meter-set.service.js");
const { prepareCloseoutPackage } = require("../app/services/uci/uci-closeout.service.js");
const { getProjectPortfolioView } = require("../app/services/uci/uci-portfolio.service.js");
const {
  emitUciEvent,
  listRecentUciEvents,
  clearRecentUciEventsForTests,
} = require("../app/services/uci/uci-events.service.js");
const { LOAD_PROFILE_IDEMPOTENCY_KEY } = require("../app/services/uci/uci-load-profile.service.js");

beforeEach(() => clearRecentUciEventsForTests());

describe("UCI D6 COS analyst", () => {
  it("stores structural discrepancy report without inventing values", async () => {
    const tables = {
      coordination_records: [
        {
          id: "coord-1",
          project_id: "proj-1",
          metadata: {},
          current_stage: 6,
          current_stage_state: "IN_PROGRESS",
        },
      ],
      coordination_applications: [
        {
          record_source: "agent_draft",
          idempotency_key: LOAD_PROFILE_IDEMPOTENCY_KEY,
          load_summary: { missing_inputs: ["connected_equipment_or_load_data"], calculated_values: {} },
        },
      ],
      coordination_communications: [
        { classification: "design_review_response", raw_subject: "In Design" },
      ],
    };

    const supabase = createMockSupabase(tables);

    const result = await runCosDiscrepancyAnalysis(supabase, {
      coordinationRecordId: "coord-1",
      userId: "user-1",
    });
    assert.equal(result.analysis.analysis_status, "needs_attention");
    assert.ok(result.analysis.discrepancies.length >= 1);
    assert.ok(tables.coordination_records[0].metadata.uci_cos_analysis);
  });
});

describe("UCI D7 costs", () => {
  it("upserts cost and computes variance", async () => {
    const tables = { coordination_costs: [] };
    const supabase = createMockSupabase(tables);

    const result = await upsertCostRecord(supabase, {
      coordinationRecordId: "coord-1",
      projectId: "proj-1",
      cost: { cost_type: "ciac", estimated_amount: 1000, actual_amount: 1200 },
    });

    assert.equal(result.created, true);
    assert.equal(result.cost.variance_pct, 20);
  });
});

describe("UCI D8 equipment", () => {
  it("creates equipment record", async () => {
    const tables = { coordination_equipment: [] };
    const supabase = createMockSupabase(tables);

    const result = await createEquipmentRecord(supabase, {
      coordinationRecordId: "coord-1",
      projectId: "proj-1",
      equipment: { equipment_type: "transformer", initial_eta: "2026-08-01" },
    });

    assert.equal(result.equipment.equipment_type, "transformer");
  });

  it("flags slip alert when weeks_of_slip > 2", async () => {
    const tables = {
      coordination_equipment: [
        {
          id: "eq-1",
          project_id: "proj-1",
          initial_eta: "2026-01-01",
          current_eta: "2026-01-01",
          status: "on_order",
          eta_history: [],
        },
      ],
    };
    const supabase = createMockSupabase(tables);

    const result = await recordEquipmentCheckIn(supabase, {
      equipmentId: "eq-1",
      projectId: "proj-1",
      currentEta: "2026-02-01",
    });

    assert.equal(result.slip_alert, true);
  });
});

describe("UCI D9 meter set", () => {
  it("creates idempotent meter set checklist milestone", async () => {
    const tables = {
      coordination_records: [{ id: "coord-1", project_id: "proj-1" }],
      coordination_milestones: [],
    };
    const supabase = createMockSupabase(tables);

    const result = await prepareMeterSetChecklist(supabase, {
      coordinationRecordId: "coord-1",
      userId: "user-1",
      scheduledDate: "2026-09-01",
    });
    assert.equal(result.milestone.milestone_type, "meter_set_scheduled");
    assert.equal(tables.coordination_milestones.length, 1);
  });
});

describe("UCI D10 closeout", () => {
  it("stores closeout checklist metadata", async () => {
    const tables = {
      coordination_records: [{ id: "coord-1", project_id: "proj-1", metadata: {} }],
    };
    const supabase = createMockSupabase(tables);

    const result = await prepareCloseoutPackage(supabase, {
      coordinationRecordId: "coord-1",
      userId: "user-1",
    });
    assert.ok(result.closeout.checklist.length >= 3);
    assert.ok(tables.coordination_records[0].metadata.uci_closeout_package);
  });
});

describe("UCI D11 portfolio", () => {
  it("aggregates stage summary for project", async () => {
    const tables = {
      coordination_records: [
        { id: "c1", project_id: "proj-1", current_stage: 3, current_stage_state: "IN_PROGRESS", metadata: {} },
        { id: "c2", project_id: "proj-1", current_stage: 5, current_stage_state: "AWAITING_UTILITY", metadata: {} },
      ],
      coordination_communications: [{ needs_human_attention: true }],
    };
    const supabase = createMockSupabase(tables);

    const view = await getProjectPortfolioView(supabase, "proj-1");
    assert.equal(view.coordination_record_count, 2);
    assert.equal(view.stage_summary[3], 1);
    assert.equal(view.stage_summary[5], 1);
  });
});

describe("UCI D12 events", () => {
  it("records recent uci events in memory", () => {
    emitUciEvent("uci.communication.classified", { communication_id: "c1" });
    const events = listRecentUciEvents(10);
    assert.equal(events[0].name, "uci.communication.classified");
  });
});

/**
 * @param {Record<string, Array<Record<string, unknown>>>} tables
 */
function createMockSupabase(tables) {
  return {
    from(table) {
      const store = tables[table] || (tables[table] = []);
      const filters = [];
      const state = { mode: "select", updatePatch: null, insertRow: null };

      const api = {
        select() {
          return api;
        },
        eq(column, value) {
          filters.push({ column, value });
          return api;
        },
        in() {
          return api;
        },
        or() {
          return api;
        },
        order() {
          return api;
        },
        range() {
          return api;
        },
        maybeSingle() {
          const row = store.find((r) =>
            filters.every((f) => String(r[f.column]) === String(f.value)),
          );
          return Promise.resolve({ data: row ?? null, error: null });
        },
        single() {
          if (state.mode === "insert" && state.insertRow) {
            const copy = { id: `${table}-${store.length + 1}`, ...state.insertRow };
            store.push(copy);
            return Promise.resolve({ data: copy, error: null });
          }
          const row = store.find((r) =>
            filters.every((f) => String(r[f.column]) === String(f.value)),
          );
          if (row && state.mode === "update" && state.updatePatch) {
            Object.assign(row, state.updatePatch);
          }
          return Promise.resolve({ data: row ?? null, error: null });
        },
        insert(row) {
          state.mode = "insert";
          state.insertRow = row;
          return api;
        },
        update(patch) {
          state.mode = "update";
          state.updatePatch = patch;
          return api;
        },
        then(resolve, reject) {
          const rows = store.filter((r) =>
            filters.length
              ? filters.every((f) => String(r[f.column]) === String(f.value))
              : true,
          );
          return Promise.resolve({ data: rows, error: null, count: rows.length }).then(
            resolve,
            reject,
          );
        },
      };

      return api;
    },
  };
}
