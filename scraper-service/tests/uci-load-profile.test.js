"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  validateProviderContext,
  requiredInputsForUtilityType,
  buildInputInventory,
  buildLoadSummary,
  resolveAnalysisStatus,
  getStage2MissingInputs,
  reconcileLoadProfileReadiness,
  assertNoInferredEngineeringValues,
  runLoadProfileAnalysis,
  LOAD_PROFILE_IDEMPOTENCY_KEY,
  FORBIDDEN_INFERRED_KEYS,
} = require("../app/services/uci/uci-load-profile.service.js");

const BASE_PROJECT = {
  id: "proj-1",
  user_id: "user-1",
  project_type: "tenant_improvement",
  square_footage: 2500,
  description: "QSR tenant fit-out",
  address: "100 Main St",
  city: "Washington",
  state: "DC",
  zip_code: "20001",
  deadline: "2026-12-01T00:00:00.000Z",
};

const HUMAN_ASSISTED_RECORD = {
  id: "coord-1",
  project_id: "proj-1",
  utility_provider_id: "prov-1",
  utility_type: "electric",
  current_stage: 1,
  current_stage_state: "NOT_STARTED",
  metadata: {
    uci_provider_mapping: {
      method: "human_assisted",
      confirmed_by_user_id: "user-1",
      confirmed_at: "2026-07-14T12:00:00.000Z",
      address_source: "structured",
      selected_provider_slugs: ["pepco"],
      unresolved_utility_types: ["gas"],
      territory_matching_available: false,
      provider_slug: "pepco",
    },
  },
  utility_providers: { slug: "pepco", name: "PEPCO" },
};

/**
 * @param {Record<string, unknown>} overrides
 */
function buildLoadSummaryFixture(overrides = {}) {
  return buildLoadSummary({
    utilityType: "electric",
    generatedAt: "2026-07-14T12:00:00.000Z",
    inputsUsed: [{ key: "square_footage", source: "projects.square_footage", value: 2500 }],
    missingInputs: ["connected_equipment_or_load_data"],
    needsVerification: ["territory_not_auto_verified"],
    sourceDocuments: [],
    userId: "user-1",
    ...overrides,
  });
}

describe("UCI D2.1 load profile service", () => {
  it("accepts human-assisted coordination with provider and utility type", () => {
    const result = validateProviderContext(HUMAN_ASSISTED_RECORD);
    assert.equal(result.ok, true);
    assert.equal(result.mapping?.method, "human_assisted");
  });

  it("rejects missing provider context", () => {
    const result = validateProviderContext({
      utility_type: "electric",
      metadata: {},
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, "PROVIDER_CONTEXT_REQUIRED");
  });

  it("rejects missing utility type", () => {
    const result = validateProviderContext({
      utility_provider_id: "prov-1",
      utility_type: "",
      metadata: {},
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, "UTILITY_TYPE_REQUIRED");
  });

  it("handles legacy coordination without D2.0 metadata safely", () => {
    const legacy = {
      utility_provider_id: "prov-1",
      utility_type: "electric",
      metadata: {},
    };
    const result = validateProviderContext(legacy);
    assert.equal(result.ok, true);
    const summary = buildLoadSummary({
      utilityType: "electric",
      generatedAt: "2026-07-14T12:00:00.000Z",
      inputsUsed: [],
      missingInputs: ["equipment_schedule"],
      needsVerification: ["provider_mapping_not_human_confirmed"],
      sourceDocuments: [],
      userId: "user-1",
    });
    assert.ok(summary.needs_verification.includes("provider_mapping_not_human_confirmed"));
  });

  it("flags electric missing-input requirements", () => {
    const required = requiredInputsForUtilityType("electric");
    assert.ok(required.includes("requested_voltage"));
    const inventory = buildInputInventory({
      project: BASE_PROJECT,
      documents: [],
      equipment: [],
      mapping: HUMAN_ASSISTED_RECORD.metadata.uci_provider_mapping,
      utilityType: "electric",
    });
    assert.ok(inventory.missingInputs.includes("connected_equipment_or_load_data"));
    assert.ok(inventory.missingInputs.includes("requested_voltage"));
  });

  it("flags gas missing-input requirements", () => {
    const required = requiredInputsForUtilityType("gas");
    assert.ok(required.includes("btu_demand"));
    const inventory = buildInputInventory({
      project: BASE_PROJECT,
      documents: [],
      equipment: [],
      mapping: null,
      utilityType: "gas",
    });
    assert.ok(inventory.missingInputs.includes("btu_demand"));
  });

  it("flags water missing-input requirements", () => {
    const inventory = buildInputInventory({
      project: BASE_PROJECT,
      documents: [],
      equipment: [],
      mapping: null,
      utilityType: "water",
    });
    assert.ok(inventory.missingInputs.includes("gpm_or_dfu"));
  });

  it("flags sewer missing-input requirements", () => {
    const inventory = buildInputInventory({
      project: BASE_PROJECT,
      documents: [],
      equipment: [],
      mapping: null,
      utilityType: "sewer",
    });
    assert.ok(inventory.missingInputs.includes("fixture_units_or_flow"));
  });

  it("flags telecom missing-input requirements", () => {
    const inventory = buildInputInventory({
      project: BASE_PROJECT,
      documents: [],
      equipment: [],
      mapping: null,
      utilityType: "telecom",
    });
    assert.ok(inventory.missingInputs.includes("demarcation_location"));
  });

  it("does not invent numeric engineering values", () => {
    const summary = buildLoadSummaryFixture();
    assert.deepEqual(summary.calculated_values, {});
    assert.equal(summary.analysis_status, "missing_inputs");
    for (const key of FORBIDDEN_INFERRED_KEYS) {
      assert.equal(summary.calculated_values[key], undefined);
    }
  });

  it("does not derive load numbers from square footage alone", () => {
    const inventory = buildInputInventory({
      project: { ...BASE_PROJECT, square_footage: 99999 },
      documents: [{ id: "doc-1", document_type: "floor_plan", file_name: "plan.pdf" }],
      equipment: [],
      mapping: HUMAN_ASSISTED_RECORD.metadata.uci_provider_mapping,
      utilityType: "electric",
    });
    const summary = buildLoadSummary({
      utilityType: "electric",
      generatedAt: "2026-07-14T12:00:00.000Z",
      inputsUsed: inventory.inputsUsed,
      missingInputs: inventory.missingInputs,
      needsVerification: ["territory_not_auto_verified"],
      sourceDocuments: inventory.sourceDocuments,
      userId: "user-1",
    });
    assert.deepEqual(summary.calculated_values, {});
    const sqft = summary.inputs_used.find((x) => x.key === "square_footage");
    assert.ok(sqft);
    assert.equal(Object.keys(summary.calculated_values).length, 0);
  });

  it("includes project document types as evidence only", () => {
    const inventory = buildInputInventory({
      project: BASE_PROJECT,
      documents: [
        { id: "doc-1", document_type: "specification", file_name: "mep-spec.pdf" },
        { id: "doc-2", document_type: "site_plan", file_name: "site.pdf" },
      ],
      equipment: [],
      mapping: HUMAN_ASSISTED_RECORD.metadata.uci_provider_mapping,
      utilityType: "electric",
    });
    assert.equal(inventory.sourceDocuments.length, 2);
    assert.ok(inventory.inputsUsed.some((x) => x.source === "project_documents"));
    const summary = buildLoadSummaryFixture({
      inputsUsed: inventory.inputsUsed,
      missingInputs: inventory.missingInputs,
      sourceDocuments: inventory.sourceDocuments,
    });
    assert.deepEqual(summary.calculated_values, {});
    assert.equal(summary.source_documents.length, 2);
  });

  it("includes equipment records when present without inferring loads", () => {
    const inventory = buildInputInventory({
      project: BASE_PROJECT,
      documents: [],
      equipment: [{ equipment_type: "transformer", equipment_size: "400A" }],
      mapping: HUMAN_ASSISTED_RECORD.metadata.uci_provider_mapping,
      utilityType: "electric",
    });
    assert.ok(inventory.inputsUsed.some((x) => x.key === "equipment_record"));
    const summary = buildLoadSummaryFixture({
      inputsUsed: inventory.inputsUsed,
      missingInputs: inventory.missingInputs,
    });
    assert.deepEqual(summary.calculated_values, {});
  });

  it("resolveAnalysisStatus does not return preliminary when missing inputs exist", () => {
    assert.equal(
      resolveAnalysisStatus({ missingInputs: ["voltage"], needsVerification: [] }),
      "missing_inputs",
    );
  });

  it("recomputes stale analysis status from current verified Stage 2 inputs", () => {
    const summary = reconcileLoadProfileReadiness({
      utility_type: "electric",
      analysis_status: "missing_inputs",
      missing_inputs: [
        "connected_equipment_or_load_data",
        "requested_voltage",
        "phase",
        "meter_count",
        "service_configuration",
        "construction_schedule",
      ],
      needs_verification: ["territory_not_auto_verified"],
      verified_values: {
        connected_load_kva: { value: 410, unit: "kVA" },
        demand_load_kva: { value: 315, unit: "kVA" },
        requested_voltage: { value: "120/208", unit: "V" },
        phase: { value: "3", unit: "phase" },
        wire_configuration: { value: "4", unit: "wire" },
      },
    });

    assert.equal(summary.analysis_status, "preliminary");
    assert.deepEqual(summary.missing_inputs, []);
  });

  it("does not make Stage 3/supporting inventory a Stage 2 blocker", () => {
    const missing = getStage2MissingInputs({
      utility_type: "electric",
      missing_inputs: [
        "meter_count",
        "construction_schedule",
        "uploaded_specifications_or_plans",
        "equipment_schedule",
      ],
      verified_values: {
        demand_load_kva: { value: 315, unit: "kVA" },
        service_voltage: { value: "120/208", unit: "V" },
        phase: { value: "3", unit: "phase" },
        service_configuration: { value: "secondary", unit: null },
      },
    });
    assert.deepEqual(missing, []);
  });

  it("assertNoInferredEngineeringValues rejects forbidden keys", () => {
    assert.throws(() => assertNoInferredEngineeringValues({ kw: 100 }), /invariant/i);
  });
});

/**
 * @param {Record<string, Array<Record<string, unknown>>>} tables
 */
function createLoadProfileMockSupabase(tables) {
  const access = { lastProjectUserId: null };

  return {
    access,
    client: {
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
          order() {
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
              const copy = { ...state.insertRow, id: `${table}-${store.length + 1}` };
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
              filters.every((f) => String(r[f.column]) === String(f.value)),
            );
            return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
          },
        };

        return api;
      },
    },
  };
}

describe("UCI D2.1 runLoadProfileAnalysis integration", () => {
  it("creates then updates the same agent_draft row idempotently", async () => {
    const tables = {
      coordination_records: [{ ...HUMAN_ASSISTED_RECORD }],
      projects: [{ ...BASE_PROJECT, id: "proj-1" }],
      project_documents: [],
      coordination_equipment: [],
      coordination_applications: [],
    };

    const mock = createLoadProfileMockSupabase(tables);

    const originalGetRecord = require("../app/services/uci/uci-records.service.js")
      .getCoordinationRecordById;

    require("../app/services/uci/uci-records.service.js").getCoordinationRecordById = async () =>
      tables.coordination_records[0];

    try {
      const first = await runLoadProfileAnalysis(mock.client, {
        coordinationRecordId: "coord-1",
        userId: "user-1",
      });
      assert.equal(
        tables.coordination_applications.filter(
          (a) => a.idempotency_key === LOAD_PROFILE_IDEMPOTENCY_KEY,
        ).length,
        1,
      );
      assert.equal(first.application.idempotency_key, LOAD_PROFILE_IDEMPOTENCY_KEY);
      assert.equal(first.application.record_source, "agent_draft");

      const second = await runLoadProfileAnalysis(mock.client, {
        coordinationRecordId: "coord-1",
        userId: "user-1",
      });
      assert.equal(
        tables.coordination_applications.filter(
          (a) => a.idempotency_key === LOAD_PROFILE_IDEMPOTENCY_KEY,
        ).length,
        1,
      );
      assert.equal(second.application.id, first.application.id);
      assert.ok(second.load_summary.generated_at);
    } finally {
      require("../app/services/uci/uci-records.service.js").getCoordinationRecordById =
        originalGetRecord;
    }
  });

  it("does not modify portal_sync application rows", async () => {
    const tables = {
      coordination_records: [{ ...HUMAN_ASSISTED_RECORD }],
      projects: [{ ...BASE_PROJECT, id: "proj-1" }],
      project_documents: [],
      coordination_equipment: [],
      coordination_applications: [
        {
          id: "portal-app-1",
          coordination_record_id: "coord-1",
          project_id: "proj-1",
          record_source: "portal_sync",
          provider_slug: "pepco",
          external_application_id: "ext-1",
          portal_status: "Submitted",
          load_summary: {},
        },
      ],
    };

    const mock = createLoadProfileMockSupabase(tables);
    const originalGetRecord = require("../app/services/uci/uci-records.service.js")
      .getCoordinationRecordById;

    require("../app/services/uci/uci-records.service.js").getCoordinationRecordById = async () =>
      tables.coordination_records[0];

    try {
      await runLoadProfileAnalysis(mock.client, {
        coordinationRecordId: "coord-1",
        userId: "user-1",
      });
      const loadDrafts = tables.coordination_applications.filter(
        (a) => a.idempotency_key === LOAD_PROFILE_IDEMPOTENCY_KEY,
      );
      assert.equal(loadDrafts.length, 1);
      const portal = tables.coordination_applications.find((a) => a.id === "portal-app-1");
      assert.equal(portal.record_source, "portal_sync");
      assert.equal(portal.portal_status, "Submitted");
      assert.deepEqual(portal.load_summary, {});
    } finally {
      require("../app/services/uci/uci-records.service.js").getCoordinationRecordById =
        originalGetRecord;
    }
  });

  it("starts Stage 2 when Agent 2 analysis begins even if inputs remain missing", async () => {
    const tables = {
      coordination_records: [{ ...HUMAN_ASSISTED_RECORD }],
      projects: [{ ...BASE_PROJECT, id: "proj-1" }],
      project_documents: [],
      coordination_equipment: [],
      coordination_applications: [],
      coordination_stage_transitions: [],
    };

    const mock = createLoadProfileMockSupabase(tables);
    const originalGetRecord = require("../app/services/uci/uci-records.service.js")
      .getCoordinationRecordById;

    require("../app/services/uci/uci-records.service.js").getCoordinationRecordById = async () =>
      tables.coordination_records[0];

    try {
      const result = await runLoadProfileAnalysis(mock.client, {
        coordinationRecordId: "coord-1",
        userId: "user-1",
      });
      assert.equal(result.stage_unchanged, false);
      assert.equal(result.current_stage, 2);
      assert.equal(result.current_stage_state, "COMPLETED");
      assert.equal(tables.coordination_records[0].current_stage, 2);
      assert.equal(tables.coordination_records[0].current_stage_state, "COMPLETED");
      assert.equal(tables.coordination_stage_transitions.length, 1);
      assert.equal(tables.coordination_stage_transitions[0].from_stage, 1);
      assert.equal(tables.coordination_stage_transitions[0].to_stage, 2);
      assert.ok(result.load_summary.missing_inputs.length > 0);
    } finally {
      require("../app/services/uci/uci-records.service.js").getCoordinationRecordById =
        originalGetRecord;
    }
  });
});
