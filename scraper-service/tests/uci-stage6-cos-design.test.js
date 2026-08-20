"use strict";

const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const {
  extractCosDesignFields,
} = require("../app/services/uci/uci-cos-extract.service.js");
const {
  buildCosDiscrepancyReport,
} = require("../app/services/uci/uci-cos-discrepancy.service.js");
const {
  stripHtmlToText,
  applyOcrFallback,
  parseCosDesignDocuments,
} = require("../app/services/uci/uci-cos-document-parser.service.js");
const {
  canEnterStage6,
  canEnterStage7,
  enterStage6,
  maybeEnterStage6FromCommunication,
} = require("../app/services/uci/uci-stage6-entry.service.js");
const {
  startCosSla,
  evaluateCosSla,
} = require("../app/services/uci/uci-cos-sla.service.js");
const {
  runCosDesignAnalysis,
} = require("../app/services/uci/uci-cos-analyst.service.js");
const {
  approveCosDesign,
  requestCosRevision,
  rejectCosDocument,
} = require("../app/services/uci/uci-cos-review.service.js");
const {
  isActionableCosDesignAttention,
} = require("../app/services/uci/uci-needs-attention.util.js");
const { LOAD_PROFILE_IDEMPOTENCY_KEY } = require("../app/services/uci/uci-load-profile.service.js");
const {
  APPLICATION_PACKAGE_IDEMPOTENCY_KEY,
} = require("../app/services/uci/uci-application-builder.service.js");
const {
  clearRecentUciEventsForTests,
} = require("../app/services/uci/uci-events.service.js");

beforeEach(() => clearRecentUciEventsForTests());

const MATCHING_COS_BODY = `
Class of Service issued for LC-1001
Assigned voltage: 208Y/120V
Service capacity: 800A
3-phase 4-wire
Meter location: Rear of building
Transformer: 500 kVA pad-mount
Design basis: 180 kW
Dated: 2026-08-01
`;

const DISCREPANCY_COS_BODY = `
Class of Service determination
Assigned voltage: 208Y/120V
Assigned service: 400A
3-phase
Meter location: Front vault
Transformer: 300 kVA pad-mount
CIAC estimate: $12,500
`;

const REVISION_COS_BODY = `
Design review response — More Information Required
Please provide revised plans and additional documents for easement.
Meter location: TBD
`;

/**
 * @param {Record<string, Array<Record<string, unknown>>>} tables
 */
function createMockSupabase(tables) {
  return {
    from(table) {
      const store = tables[table] || (tables[table] = []);
      /** @type {Array<{ type: string, column: string, value?: unknown, values?: unknown[] }>} */
      const filters = [];
      const state = {
        mode: "select",
        updatePatch: null,
        insertRow: null,
        orderCol: null,
      };

      const matches = (row) =>
        filters.every((f) => {
          if (f.type === "eq") return String(row[f.column]) === String(f.value);
          if (f.type === "in") {
            return (f.values || []).map(String).includes(String(row[f.column]));
          }
          if (f.type === "is") {
            if (f.value === null) return row[f.column] == null;
            return row[f.column] === f.value;
          }
          if (f.type === "not") {
            if (f.value === null) return row[f.column] != null;
            return String(row[f.column]) !== String(f.value);
          }
          return true;
        });

      const api = {
        select() {
          return api;
        },
        eq(column, value) {
          filters.push({ type: "eq", column, value });
          return api;
        },
        in(column, values) {
          filters.push({ type: "in", column, values: [...values] });
          return api;
        },
        is(column, value) {
          filters.push({ type: "is", column, value });
          return api;
        },
        not(column, _op, value) {
          filters.push({ type: "not", column, value });
          return api;
        },
        or() {
          return api;
        },
        order(column) {
          state.orderCol = column;
          return api;
        },
        limit() {
          return api;
        },
        range() {
          return api;
        },
        maybeSingle() {
          const row = store.find(matches) ?? null;
          return Promise.resolve({ data: row, error: null });
        },
        single() {
          if (state.mode === "insert" && state.insertRow) {
            const copy = {
              id: state.insertRow.id || `${table}-${store.length + 1}`,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
              ...state.insertRow,
            };
            store.push(copy);
            return Promise.resolve({ data: copy, error: null });
          }
          const row = store.find(matches);
          if (row && state.mode === "update" && state.updatePatch) {
            Object.assign(row, state.updatePatch, { updated_at: new Date().toISOString() });
          }
          return Promise.resolve({ data: row ?? null, error: null });
        },
        insert(row) {
          state.mode = "insert";
          state.insertRow = Array.isArray(row) ? row[0] : row;
          return api;
        },
        update(patch) {
          state.mode = "update";
          state.updatePatch = patch;
          return api;
        },
        then(resolve, reject) {
          let rows = store.filter(matches);
          if (state.mode === "update" && state.updatePatch) {
            for (const row of rows) Object.assign(row, state.updatePatch);
          }
          if (state.orderCol) {
            rows = [...rows].sort((a, b) =>
              String(b[state.orderCol] ?? "").localeCompare(String(a[state.orderCol] ?? "")),
            );
          }
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

function baseStage5CompletedRecord(overrides = {}) {
  return {
    id: "coord-1",
    project_id: "proj-1",
    utility_provider_id: "prov-1",
    utility_type: "electric",
    current_stage: 5,
    current_stage_state: "COMPLETED",
    acknowledgment_received_at: "2026-08-18T12:00:00.000Z",
    class_of_service_issued_at: null,
    cos_sla_started_at: null,
    cos_sla_due_at: null,
    cos_sla_stopped_at: null,
    cos_sla_escalated_at: null,
    metadata: {},
    ...overrides,
  };
}

function matchingBaselineApps() {
  return [
    {
      id: "app-lp",
      project_id: "proj-1",
      coordination_record_id: "coord-1",
      record_source: "agent_draft",
      idempotency_key: LOAD_PROFILE_IDEMPOTENCY_KEY,
      load_summary: {
        missing_inputs: [],
        verified_values: {
          service_voltage: { value: "208Y/120V", unit: "V" },
          service_amperage: { value: 800, unit: "A" },
          phase: { value: "3" },
          wire_configuration: { value: "4-wire" },
          demand_load_kw: { value: 180 },
          meter_location: { value: "Rear of building" },
        },
        calculated_values: {},
      },
    },
    {
      id: "app-pkg",
      project_id: "proj-1",
      coordination_record_id: "coord-1",
      record_source: "agent_draft",
      idempotency_key: APPLICATION_PACKAGE_IDEMPOTENCY_KEY,
      load_summary: {},
      agent_draft_metadata: {
        application_package: {
          requested_service: { transformer_specs: "500 kVA pad-mount" },
        },
      },
    },
  ];
}

describe("Stage 6 extraction + discrepancy", () => {
  it("extracts electric COS fields from synthetic letter", () => {
    const result = extractCosDesignFields(MATCHING_COS_BODY, { utilityType: "electric" });
    assert.equal(result.fields.service_amperage.value, 800);
    assert.ok(String(result.fields.service_voltage.value).includes("208"));
    assert.equal(result.fields.phase.value, "3");
    assert.ok(result.fields.meter_location.value);
    assert.ok(result.fields.transformer_specs.value);
  });

  it("extracts gas and water fields when present", () => {
    const text = "Delivery pressure: 2 psig\nLine size: 2 inch\nWater meter size: 1 inch\n45 GPM\n12 DFU";
    const gas = extractCosDesignFields(text, { utilityType: "gas" });
    assert.ok(gas.fields.gas_pressure);
    assert.ok(gas.fields.gas_line_size);
    const water = extractCosDesignFields(text, { utilityType: "water" });
    assert.ok(water.fields.water_meter_size);
    assert.equal(water.fields.water_gpm.value, 45);
  });

  it("flags undersized amperage discrepancy and requires human review", () => {
    const report = buildCosDiscrepancyReport({
      baselineFields: {
        service_amperage: { value: 1000, provenance: "verified_project_input" },
        service_voltage: { value: "208Y/120V", provenance: "verified_project_input" },
      },
      extractedFields: {
        service_amperage: { value: 400, provenance: "utility_document" },
        service_voltage: { value: "208Y/120V", provenance: "utility_document" },
      },
    });
    assert.equal(report.has_material_discrepancy, true);
    assert.equal(report.evidence_status, "DISCREPANCY");
    assert.equal(report.clean_match, false);
    assert.equal(report.requires_human_review, true);
    assert.ok(report.comparison_rows.some((r) => r.result === "undersized"));
  });

  it("clean field match does not require human review (A6.10)", () => {
    const report = buildCosDiscrepancyReport({
      baselineFields: {
        service_amperage: { value: 800, provenance: "verified_project_input" },
        service_voltage: { value: "208Y/120V", provenance: "verified_project_input" },
      },
      extractedFields: {
        service_amperage: { value: 800, provenance: "utility_document" },
        service_voltage: { value: "208Y/120V", provenance: "utility_document" },
      },
    });
    assert.equal(report.clean_match, true);
    assert.equal(report.requires_human_review, false);
    assert.equal(report.review_status, "ready_for_approval");
    assert.equal(report.discrepancies.length, 0);
  });

  it("marks revision-required design responses", () => {
    const extracted = extractCosDesignFields(REVISION_COS_BODY);
    const report = buildCosDiscrepancyReport({
      baselineFields: { service_amperage: { value: 800 } },
      extractedFields: extracted.fields,
    });
    assert.equal(report.revision_required, true);
    assert.equal(report.review_status, "revision_required");
  });
});

describe("Stage 6 document parser + OCR", () => {
  it("strips HTML and parses communication body", async () => {
    assert.equal(stripHtmlToText("<p>Hello&nbsp;world</p>"), "Hello world");
    const parsed = await parseCosDesignDocuments({
      communication: {
        id: "c1",
        raw_subject: "COS issued",
        raw_body: "<p>Assigned voltage: 208Y/120V</p><p>Service capacity: 800A</p>",
        raw_attachments: [],
      },
    });
    assert.ok(parsed.text.includes("208Y/120V"));
    assert.ok(parsed.document_refs.length >= 1);
  });

  it("marks OCR required for low-text content", async () => {
    const ocr = await applyOcrFallback({ existingText: "short", deps: {} });
    assert.equal(ocr.required, true);
    assert.equal(ocr.low_confidence, true);
  });

  it("uses injected OCR extractor when provided", async () => {
    const ocr = await applyOcrFallback({
      existingText: "",
      buffer: Buffer.from("x"),
      deps: {
        ocrExtract: async () => ({ text: "Service capacity: 600A", confidence: 0.9, method: "test_ocr" }),
      },
    });
    assert.equal(ocr.used, true);
    assert.ok(ocr.text.includes("600A"));
  });
});

describe("Stage 6 lifecycle + SLA", () => {
  it("canEnterStage6 / canEnterStage7 guards", () => {
    assert.equal(
      canEnterStage6({
        current_stage: 5,
        current_stage_state: "COMPLETED",
        acknowledgment_received_at: "2026-08-01",
      }),
      true,
    );
    assert.equal(
      canEnterStage7({
        current_stage: 6,
        current_stage_state: "COMPLETED",
        class_of_service_issued_at: "2026-08-02",
      }),
      true,
    );
    assert.equal(
      canEnterStage7({
        current_stage: 6,
        current_stage_state: "COMPLETED",
        class_of_service_issued_at: null,
      }),
      false,
    );
  });

  it("enters Stage 6 and starts COS SLA", async () => {
    const tables = {
      coordination_records: [baseStage5CompletedRecord()],
      utility_providers: [{ id: "prov-1", sla_class_of_service_business_days: 30, slug: "pepco" }],
      coordination_stage_transitions: [],
    };
    const supabase = createMockSupabase(tables);
    const result = await enterStage6(supabase, {
      coordinationRecordId: "coord-1",
      reason: "test enter",
    });
    assert.equal(result.entered, true);
    assert.equal(tables.coordination_records[0].current_stage, 6);
    assert.ok(tables.coordination_records[0].cos_sla_started_at);
    assert.ok(tables.coordination_records[0].cos_sla_due_at);
    assert.equal(tables.coordination_records[0].cos_sla_stopped_at, null);
  });

  it("escalates at 2× COS SLA", async () => {
    const started = new Date(Date.now() - 20 * 24 * 3600 * 1000).toISOString();
    const due = new Date(Date.now() - 10 * 24 * 3600 * 1000).toISOString();
    const tables = {
      coordination_records: [
        baseStage5CompletedRecord({
          current_stage: 6,
          current_stage_state: "AWAITING_UTILITY",
          cos_sla_started_at: started,
          cos_sla_due_at: due,
          cos_sla_stopped_at: null,
          cos_sla_escalated_at: null,
        }),
      ],
    };
    const result = await evaluateCosSla(createMockSupabase(tables), "coord-1");
    assert.equal(result.double_sla, true);
    assert.equal(tables.coordination_records[0].current_stage_state, "ESCALATED");
    assert.ok(tables.coordination_records[0].cos_sla_escalated_at);
  });
});

describe("Stage 6 full analyze + approve flow", () => {
  it("matching COS auto-completes Stage 6 (no Approve COS) and enables Stage 7", async () => {
    const tables = {
      coordination_records: [
        baseStage5CompletedRecord({
          current_stage: 6,
          current_stage_state: "AWAITING_UTILITY",
          cos_sla_started_at: new Date().toISOString(),
          cos_sla_due_at: new Date(Date.now() + 86400000).toISOString(),
        }),
      ],
      utility_providers: [{ id: "prov-1", sla_class_of_service_business_days: 30 }],
      coordination_applications: matchingBaselineApps(),
      coordination_communications: [
        {
          id: "comm-cos",
          project_id: "proj-1",
          coordination_record_id: "coord-1",
          classification: "class_of_service",
          classification_confidence: 0.95,
          raw_subject: "COS issued",
          raw_body: MATCHING_COS_BODY,
          raw_attachments: [],
          message_timestamp: "2026-08-01T15:00:00.000Z",
          agent_processed_metadata: {},
          needs_human_attention: false,
        },
      ],
      coordination_cos_design_records: [],
      coordination_stage_transitions: [],
      coordination_costs: [],
    };

    const supabase = createMockSupabase(tables);
    const analysis = await runCosDesignAnalysis(supabase, {
      coordinationRecordId: "coord-1",
      userId: "user-1",
      communicationId: "comm-cos",
    });

    assert.ok(analysis.cos_design_record);
    assert.notEqual(analysis.cos_design_record.evidence_status, "ADVISORY");
    assert.ok(Array.isArray(analysis.comparison_rows));
    assert.ok(analysis.comparison_rows.some((r) => r.result === "match"));
    assert.equal(analysis.auto_completed, true);
    assert.equal(analysis.cos_design_record.review_status, "approved");
    assert.ok(analysis.class_of_service_issued_at || tables.coordination_records[0].class_of_service_issued_at);
    assert.equal(tables.coordination_records[0].current_stage_state, "COMPLETED");
    assert.equal(analysis.can_enter_stage_7, true);
    assert.ok(tables.coordination_records[0].cos_sla_stopped_at);
    // discrepancy_report linked to triggering communication
    assert.equal(
      analysis.cos_design_record.discrepancy_report?.source_communication_id,
      "comm-cos",
    );
    assert.equal(
      tables.coordination_communications[0].agent_processed_metadata?.stage_6_cos
        ?.discrepancy_report?.source_communication_id,
      "comm-cos",
    );
    assert.equal(
      tables.coordination_communications[0].agent_processed_metadata?.stage_6_auto_completed,
      true,
    );
    assert.equal(tables.coordination_communications[0].needs_human_attention, false);
  });

  it("discrepancy stays IN_PROGRESS, blocks silent approve, and creates CIAC cost implication", async () => {
    const tables = {
      coordination_records: [
        baseStage5CompletedRecord({
          current_stage: 6,
          current_stage_state: "AWAITING_UTILITY",
          cos_sla_started_at: new Date().toISOString(),
          cos_sla_due_at: new Date(Date.now() + 86400000).toISOString(),
        }),
      ],
      utility_providers: [{ id: "prov-1", sla_class_of_service_business_days: 30 }],
      coordination_applications: matchingBaselineApps(),
      coordination_communications: [
        {
          id: "comm-cos",
          project_id: "proj-1",
          coordination_record_id: "coord-1",
          classification: "class_of_service",
          classification_confidence: 0.92,
          raw_subject: "COS issued",
          raw_body: DISCREPANCY_COS_BODY,
          raw_attachments: [],
          message_timestamp: "2026-08-02T15:00:00.000Z",
          agent_processed_metadata: {},
          needs_human_attention: false,
        },
      ],
      coordination_cos_design_records: [],
      coordination_stage_transitions: [],
      coordination_costs: [],
    };

    const supabase = createMockSupabase(tables);
    const analysis = await runCosDesignAnalysis(supabase, {
      coordinationRecordId: "coord-1",
      userId: "user-1",
    });

    assert.equal(analysis.auto_completed, false);
    assert.equal(analysis.cos_design_record.evidence_status, "DISCREPANCY");
    assert.equal(analysis.cos_design_record.review_status, "needs_attention");
    assert.equal(tables.coordination_records[0].current_stage_state, "IN_PROGRESS");
    assert.equal(tables.coordination_records[0].class_of_service_issued_at, null);
    assert.equal(analysis.can_enter_stage_7, false);
    assert.equal(analysis.ciac_implication.created, true);
    assert.equal(
      analysis.cos_design_record.discrepancy_report?.source_communication_id,
      "comm-cos",
    );
    assert.equal(
      tables.coordination_communications[0].agent_processed_metadata?.stage_6_cos
        ?.discrepancy_report?.linked_to_communication,
      true,
    );
    assert.equal(tables.coordination_communications[0].needs_human_attention, true);

    await assert.rejects(
      () =>
        approveCosDesign(supabase, {
          coordinationRecordId: "coord-1",
          userId: "user-1",
        }),
      /Material discrepancies/,
    );

    const accepted = await approveCosDesign(supabase, {
      coordinationRecordId: "coord-1",
      userId: "user-1",
      acceptMaterialDeviation: true,
      notes: "Client accepted 400A vs 800A with redesign",
    });
    assert.equal(accepted.ok, true);
    assert.equal(accepted.can_enter_stage_7, true);
  });

  it("never writes issued_at for advisory-only analysis", async () => {
    const tables = {
      coordination_records: [
        baseStage5CompletedRecord({
          current_stage: 6,
          current_stage_state: "AWAITING_UTILITY",
        }),
      ],
      utility_providers: [{ id: "prov-1", sla_class_of_service_business_days: 30 }],
      coordination_applications: matchingBaselineApps(),
      coordination_communications: [],
      coordination_cos_design_records: [],
      coordination_stage_transitions: [],
      coordination_costs: [],
    };
    const result = await runCosDesignAnalysis(createMockSupabase(tables), {
      coordinationRecordId: "coord-1",
      userId: "user-1",
      advisoryOnly: true,
    });
    assert.equal(result.cos_design_record.evidence_status, "ADVISORY");
    assert.equal(result.cos_design_record.utility_evidence_issued_at, null);
    assert.equal(tables.coordination_records[0].class_of_service_issued_at, null);
  });

  it("auto-trigger from high-confidence COS communication enters Stage 6", async () => {
    const tables = {
      coordination_records: [baseStage5CompletedRecord()],
      utility_providers: [{ id: "prov-1", sla_class_of_service_business_days: 30 }],
      coordination_applications: matchingBaselineApps(),
      coordination_communications: [
        {
          id: "comm-cos",
          project_id: "proj-1",
          coordination_record_id: "coord-1",
          classification: "class_of_service",
          classification_confidence: 0.9,
          raw_subject: "COS issued",
          raw_body: MATCHING_COS_BODY,
          raw_attachments: [],
          agent_processed_metadata: {},
        },
      ],
      coordination_cos_design_records: [],
      coordination_stage_transitions: [],
      coordination_costs: [],
    };
    const result = await maybeEnterStage6FromCommunication(createMockSupabase(tables), {
      communication: tables.coordination_communications[0],
    });
    assert.equal(result.entered, true);
    assert.equal(tables.coordination_records[0].current_stage, 6);
  });

  it("revision request blocks Stage 6", async () => {
    const tables = {
      coordination_records: [
        baseStage5CompletedRecord({
          current_stage: 6,
          current_stage_state: "IN_PROGRESS",
        }),
      ],
      coordination_cos_design_records: [
        {
          id: "cos-1",
          coordination_record_id: "coord-1",
          project_id: "proj-1",
          is_current: true,
          version: 1,
          evidence_status: "UTILITY_ISSUED",
          review_status: "ready_for_approval",
          needs_human_attention: false,
          attention_reasons: [],
        },
      ],
      coordination_stage_transitions: [],
    };
    const result = await requestCosRevision(createMockSupabase(tables), {
      coordinationRecordId: "coord-1",
      userId: "user-1",
      notes: "Need revised one-line",
    });
    assert.equal(result.cos_design_record.review_status, "revision_required");
    assert.equal(tables.coordination_records[0].current_stage_state, "BLOCKED");
  });

  it("reject wrong document clears current without approving", async () => {
    const tables = {
      coordination_records: [
        baseStage5CompletedRecord({
          current_stage: 6,
          current_stage_state: "IN_PROGRESS",
        }),
      ],
      coordination_cos_design_records: [
        {
          id: "cos-1",
          coordination_record_id: "coord-1",
          project_id: "proj-1",
          is_current: true,
          version: 1,
          evidence_status: "UTILITY_ISSUED",
          review_status: "ready_for_approval",
          needs_human_attention: true,
          attention_reasons: [],
        },
      ],
      coordination_stage_transitions: [],
    };
    const result = await rejectCosDocument(createMockSupabase(tables), {
      coordinationRecordId: "coord-1",
      userId: "user-1",
      reason: "Wrong project letter",
    });
    assert.equal(result.cos_design_record.review_status, "rejected");
    assert.equal(result.cos_design_record.is_current, false);
    assert.equal(tables.coordination_records[0].class_of_service_issued_at, null);
  });

  it("Needs Attention recognizes COS design attention rows", () => {
    assert.equal(
      isActionableCosDesignAttention({
        is_current: true,
        needs_human_attention: true,
        review_status: "needs_attention",
      }),
      true,
    );
    assert.equal(
      isActionableCosDesignAttention({
        is_current: true,
        needs_human_attention: true,
        review_status: "approved",
      }),
      false,
    );
  });
});

describe("Stage 6 accepted values + multi-doc + snapshot", () => {
  const {
    seedAcceptedFields,
    buildAcceptedFieldUpdate,
    buildApprovedSnapshot,
    sameAccepted,
  } = require("../app/services/uci/uci-cos-accepted-values.service.js");
  const {
    extractPerDocumentFields,
    mergeDocumentExtractions,
    buildCosReviewSummary,
    annotateComparisonRowsWithConflicts,
  } = require("../app/services/uci/uci-cos-multi-doc.service.js");
  const { updateCosAcceptedFields } = require("../app/services/uci/uci-cos-review.service.js");

  it("comparison rows default accepted to utility-issued without override", () => {
    const report = buildCosDiscrepancyReport({
      baselineFields: { service_amperage: { value: 1000 } },
      extractedFields: { service_amperage: { value: 800 } },
    });
    const row = report.comparison_rows.find((r) => r.field === "service_amperage");
    assert.equal(row.utility_issued, 800);
    assert.equal(row.accepted, 800);
    assert.equal(row.operator_override, false);
  });

  it("accepted edit requires reason when differing from utility; does not mutate source", () => {
    const cos = {
      id: "cos-1",
      version: 1,
      review_version: 1,
      document_refs: [{ name: "COS.pdf", project_document_id: "doc-1", page: 1 }],
      source_communication_id: "comm-1",
      extracted_fields: {
        service_amperage: { value: 800, provenance: "utility_document" },
      },
      comparison_rows: [
        {
          field: "service_amperage",
          label: "Service capacity / amperage",
          submitted: 1000,
          utility_issued: 800,
          accepted: 800,
          operator_override: false,
        },
      ],
      accepted_fields: seedAcceptedFields([
        {
          field: "service_amperage",
          utility_issued: 800,
        },
      ]),
      field_overrides: [],
    };

    assert.throws(
      () =>
        buildAcceptedFieldUpdate(
          cos,
          [{ field: "service_amperage", accepted_value: 1000, reason: "" }],
          { userId: "user-1" },
        ),
      /Reason\/note is required/,
    );

    const built = buildAcceptedFieldUpdate(
      cos,
      [{ field: "service_amperage", accepted_value: 1000, reason: "Client redesign to 1000A" }],
      { userId: "user-1" },
    );
    assert.equal(built.changed, true);
    assert.equal(built.accepted_fields.service_amperage.value, 1000);
    assert.equal(built.accepted_fields.service_amperage.overridden, true);
    const ampRow = built.comparison_rows.find((r) => r.field === "service_amperage");
    assert.equal(ampRow.utility_issued, 800);
    assert.equal(ampRow.accepted, 1000);
    assert.equal(ampRow.operator_override, true);
    assert.equal(built.new_overrides[0].utility_issued_value, 800);
    assert.equal(built.new_overrides[0].previous_accepted_value, 800);
    assert.equal(built.new_overrides[0].accepted_value, 1000);
    assert.ok(built.new_overrides[0].source_document);

    const reset = buildAcceptedFieldUpdate(
      { ...cos, accepted_fields: built.accepted_fields, comparison_rows: built.comparison_rows, field_overrides: built.field_overrides, review_version: built.review_version },
      [{ field: "service_amperage", accepted_value: null }],
      { userId: "user-1", reset: true },
    );
    assert.equal(reset.accepted_fields.service_amperage.value, 800);
    assert.equal(reset.accepted_fields.service_amperage.overridden, false);
    assert.equal(sameAccepted(800, 800), true);
  });

  it("approve freezes snapshot without changing extracted_fields", async () => {
    const extracted = {
      service_amperage: { value: 800, provenance: "utility_document" },
      service_voltage: { value: "208Y/120V", provenance: "utility_document" },
    };
    const comparisonRows = [
      {
        field: "service_amperage",
        label: "Service capacity / amperage",
        submitted: 1000,
        utility_issued: 800,
        accepted: 1000,
        operator_override: true,
        override_reason: "Client accepted redesign",
        result: "undersized",
        material: true,
      },
      {
        field: "service_voltage",
        label: "Voltage",
        submitted: "208Y/120V",
        utility_issued: "208Y/120V",
        accepted: "208Y/120V",
        operator_override: false,
        result: "match",
        material: true,
      },
    ];
    const tables = {
      coordination_records: [
        baseStage5CompletedRecord({
          current_stage: 6,
          current_stage_state: "IN_PROGRESS",
          cos_sla_started_at: new Date().toISOString(),
          cos_sla_due_at: new Date(Date.now() + 86400000).toISOString(),
        }),
      ],
      coordination_cos_design_records: [
        {
          id: "cos-1",
          coordination_record_id: "coord-1",
          project_id: "proj-1",
          is_current: true,
          version: 1,
          evidence_status: "DISCREPANCY",
          review_status: "needs_attention",
          extracted_fields: extracted,
          baseline_fields: {},
          comparison_rows: comparisonRows,
          accepted_fields: {
            service_amperage: {
              value: 1000,
              source: "operator_accepted",
              overridden: true,
              reason: "Client accepted redesign",
            },
            service_voltage: {
              value: "208Y/120V",
              source: "utility_default",
              overridden: false,
            },
          },
          field_overrides: [
            {
              field: "service_amperage",
              utility_issued_value: 800,
              accepted_value: 1000,
              reason: "Client accepted redesign",
            },
          ],
          discrepancy_report: {
            discrepancies: [{ severity: "high", material: true, field: "service_amperage" }],
          },
          utility_evidence_issued_at: "2026-08-01T00:00:00.000Z",
          review_version: 2,
          document_refs: [{ name: "COS.pdf" }],
          needs_human_attention: true,
          attention_reasons: [],
          accepted_deviations: [],
        },
      ],
      coordination_stage_transitions: [],
    };

    const approved = await approveCosDesign(createMockSupabase(tables), {
      coordinationRecordId: "coord-1",
      userId: "user-1",
      acceptMaterialDeviation: true,
      notes: "Client accepted redesign",
    });

    assert.equal(approved.ok, true);
    assert.ok(approved.approved_snapshot);
    assert.equal(approved.approved_snapshot.extracted_fields.service_amperage.value, 800);
    assert.equal(approved.cos_design_record.extracted_fields.service_amperage.value, 800);
    assert.equal(approved.approved_snapshot.accepted_fields.service_amperage.value, 1000);
    assert.equal(approved.cos_design_record.review_status, "approved");
    assert.ok(Array.isArray(approved.override_summary));
    assert.equal(approved.override_summary.length, 1);
  });

  it("updateCosAcceptedFields persists override audit and leaves extraction intact", async () => {
    const tables = {
      coordination_records: [
        baseStage5CompletedRecord({
          current_stage: 6,
          current_stage_state: "IN_PROGRESS",
        }),
      ],
      coordination_cos_design_records: [
        {
          id: "cos-1",
          coordination_record_id: "coord-1",
          project_id: "proj-1",
          is_current: true,
          version: 1,
          evidence_status: "UTILITY_ISSUED",
          review_status: "ready_for_approval",
          extracted_fields: {
            service_amperage: { value: 800, provenance: "utility_document" },
          },
          comparison_rows: [
            {
              field: "service_amperage",
              label: "Service capacity / amperage",
              submitted: 1000,
              utility_issued: 800,
              accepted: 800,
              operator_override: false,
              result: "undersized",
              material: true,
            },
          ],
          accepted_fields: {},
          field_overrides: [],
          review_version: 1,
          document_refs: [{ name: "COS.pdf", project_document_id: "doc-1" }],
          needs_human_attention: false,
          attention_reasons: [],
        },
      ],
    };

    const result = await updateCosAcceptedFields(createMockSupabase(tables), {
      coordinationRecordId: "coord-1",
      userId: "user-1",
      updates: [
        {
          field: "service_amperage",
          accepted_value: 1000,
          reason: "Operator override to submitted capacity",
        },
      ],
    });

    assert.equal(result.ok, true);
    assert.equal(result.extracted_fields_unchanged, true);
    assert.equal(tables.coordination_cos_design_records[0].extracted_fields.service_amperage.value, 800);
    assert.equal(tables.coordination_cos_design_records[0].accepted_fields.service_amperage.value, 1000);
    assert.equal(tables.coordination_cos_design_records[0].comparison_rows[0].utility_issued, 800);
    assert.equal(tables.coordination_cos_design_records[0].comparison_rows[0].accepted, 1000);
    assert.ok(tables.coordination_cos_design_records[0].field_overrides.length >= 1);
  });

  it("multi-doc merge surfaces conflicts instead of silently picking", () => {
    const docs = extractPerDocumentFields(
      [
        {
          name: "cos-a.pdf",
          project_document_id: "a",
          text: "Assigned voltage: 208Y/120V\nService capacity: 800A\n3-phase",
        },
        {
          name: "cos-b.pdf",
          project_document_id: "b",
          text: "Assigned voltage: 208Y/120V\nService capacity: 1000A\n3-phase",
        },
      ],
      { utilityType: "electric" },
    );
    const merged = mergeDocumentExtractions(docs);
    assert.equal(merged.document_count, 2);
    assert.ok(merged.conflicts.some((c) => c.field === "service_amperage"));
    assert.equal(merged.fields.service_amperage.conflict, true);
    assert.equal(merged.fields.service_amperage.value, null);
    assert.equal(merged.fields.service_voltage.conflict, undefined);
    assert.ok(merged.fields.service_voltage.value);

    const rows = annotateComparisonRowsWithConflicts(
      [
        {
          field: "service_amperage",
          label: "Service capacity / amperage",
          submitted: 1000,
          utility_issued: null,
          accepted: null,
          result: "utility_value_missing",
        },
      ],
      merged.fields,
      merged.conflicts,
    );
    assert.equal(rows[0].result, "document_conflict");
    assert.equal(rows[0].utility_conflict, true);
    assert.ok(String(rows[0].utility_issued_display).includes("800"));
  });

  it("review summary headline and next action", () => {
    const summary = buildCosReviewSummary({
      documentCount: 2,
      comparisonRows: [
        { result: "match", submitted: 1, utility_issued: 1 },
        { result: "match", submitted: 2, utility_issued: 2 },
        { result: "match", submitted: 3, utility_issued: 3 },
        { result: "match", submitted: 4, utility_issued: 4 },
        { result: "match", submitted: 5, utility_issued: 5 },
        { result: "baseline_missing", submitted: null, utility_issued: "Rear" },
        { result: "baseline_missing", submitted: null, utility_issued: "pad" },
        { result: "undersized", submitted: 1000, utility_issued: 800 },
      ],
      discrepancies: [{ severity: "high" }],
      conflicts: [],
      reviewStatus: "needs_attention",
      evidenceStatus: "DISCREPANCY",
    });
    assert.match(summary.headline, /2 documents analyzed/);
    assert.match(summary.headline, /5 matches/);
    assert.match(summary.headline, /2 new utility conditions/);
    assert.match(summary.headline, /1 discrepanc/);
    assert.match(summary.next_action, /Resolve discrepancies/i);
  });

  it("revised COS creates new version and preserves prior approved snapshot", async () => {
    const tables = {
      coordination_records: [
        baseStage5CompletedRecord({
          current_stage: 6,
          current_stage_state: "COMPLETED",
          class_of_service_issued_at: "2026-08-01T00:00:00.000Z",
          cos_sla_started_at: new Date().toISOString(),
          cos_sla_due_at: new Date(Date.now() + 86400000).toISOString(),
          cos_sla_stopped_at: new Date().toISOString(),
        }),
      ],
      utility_providers: [{ id: "prov-1", sla_class_of_service_business_days: 30 }],
      coordination_applications: matchingBaselineApps(),
      coordination_communications: [
        {
          id: "comm-cos-2",
          project_id: "proj-1",
          coordination_record_id: "coord-1",
          classification: "class_of_service",
          classification_confidence: 0.95,
          raw_subject: "Revised COS",
          raw_body: MATCHING_COS_BODY,
          raw_attachments: [],
          message_timestamp: "2026-08-10T15:00:00.000Z",
          agent_processed_metadata: {},
        },
      ],
      coordination_cos_design_records: [
        {
          id: "cos-v1",
          coordination_record_id: "coord-1",
          project_id: "proj-1",
          is_current: true,
          version: 1,
          evidence_status: "UTILITY_ISSUED",
          review_status: "approved",
          extracted_fields: { service_amperage: { value: 800 } },
          comparison_rows: [],
          accepted_fields: { service_amperage: { value: 800 } },
          field_overrides: [{ field: "service_amperage", reason: "prior" }],
          approved_snapshot: {
            snapshot_version: "stage6-approved-reviewed-snapshot-v1",
            accepted_fields: { service_amperage: { value: 800 } },
            extracted_fields: { service_amperage: { value: 800 } },
          },
          agent_metadata: { attachment_fingerprint: "old" },
          utility_evidence_issued_at: "2026-08-01T00:00:00.000Z",
          needs_human_attention: false,
          attention_reasons: [],
        },
      ],
      coordination_stage_transitions: [],
      coordination_costs: [],
    };

    const analysis = await runCosDesignAnalysis(createMockSupabase(tables), {
      coordinationRecordId: "coord-1",
      userId: "user-1",
      communicationId: "comm-cos-2",
      triggeredBy: "manual_upload",
      deps: { forceNewVersion: true },
    });

    assert.ok(analysis.cos_design_record);
    assert.equal(analysis.cos_design_record.version, 2);
    assert.equal(analysis.cos_design_record.is_current, true);
    const prior = tables.coordination_cos_design_records.find((r) => r.id === "cos-v1");
    assert.equal(prior.is_current, false);
    assert.equal(prior.review_status, "superseded");
    assert.ok(prior.approved_snapshot);
    assert.equal(prior.approved_snapshot.extracted_fields.service_amperage.value, 800);
    assert.equal(prior.field_overrides[0].reason, "prior");
    // New version starts fresh accepted defaults — does not copy prior overrides silently
    assert.deepEqual(analysis.cos_design_record.field_overrides, []);
  });

  it("buildApprovedSnapshot rejects override without reason", () => {
    assert.throws(
      () =>
        buildApprovedSnapshot(
          {
            id: "cos-1",
            version: 1,
            review_version: 2,
            evidence_status: "UTILITY_ISSUED",
            extracted_fields: { service_amperage: { value: 800 } },
            baseline_fields: {},
            document_refs: [],
            accepted_fields: {
              service_amperage: { value: 1000, overridden: true, reason: null },
            },
            comparison_rows: [
              {
                field: "service_amperage",
                label: "Amps",
                utility_issued: 800,
                accepted: 1000,
                operator_override: true,
                override_reason: null,
              },
            ],
            field_overrides: [],
          },
          { userId: "u1", approvedAt: new Date().toISOString() },
        ),
      /requires a reason/,
    );
  });
});
