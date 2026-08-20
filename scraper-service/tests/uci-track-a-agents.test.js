"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { computeLoadEngine, nextStandardAmps } = require("../app/services/uci/uci-load-engine.service.js");
const { requiredUtilityTypes } = require("../app/services/uci/uci-provider-intake.service.js");
const { reconcileSentItemsMessage } = require("../app/services/uci/uci-graph-sent-items.service.js");
const { isBounceMessage } = require("../app/services/uci/uci-email-bounce.service.js");
const { computePredictedDates, recomputePredictedDates } = require("../app/services/uci/uci-prediction.service.js");
const { loadTemplateManifest } = require("../app/services/uci/uci-application-builder.service.js");
const { COS_COMPARE_FIELDS } = require("../app/services/uci/uci-cos-constants.js");
const { applyStage6StateFromAnalysis } = require("../app/services/uci/uci-cos-analyst.service.js");
const { createTrackBMockSupabase, stage6CompletedRecord } = require("./helpers/uci-track-b-mock.js");

describe("UCI Track A load engine", () => {
  it("sizes electric service from equipment kW using NEC 220 demand factor", () => {
    const result = computeLoadEngine({
      utilityType: "electric",
      project: { name: "QSR" },
      equipment: [{ connected_kw: 100 }],
      verifiedValues: {},
    });
    assert.equal(result.method, "nec_220");
    assert.ok(result.calculated_values.service_amperage.value);
    assert.ok(String(result.calculated_values.service_size.value).includes("A"));
    assert.equal(result.calculated_values.service_amperage.source, "nec_220_service_size");
    assert.ok(result.needs_verification.includes("generic_qsr_fallback"));
  });

  it("flags oversized electric service above 800A", () => {
    const result = computeLoadEngine({
      utilityType: "electric",
      project: {},
      equipment: [{ connected_kw: 1000 }],
      verifiedValues: { requested_voltage: "208/120", phase: 3 },
    });
    assert.equal(result.oversized, true);
    assert.ok(result.calculated_values.service_amperage.value > 800);
  });

  it("does not treat square footage as an ampere source", () => {
    const result = computeLoadEngine({
      utilityType: "electric",
      project: { square_footage: 4200 },
      equipment: [],
      verifiedValues: {},
    });
    assert.equal(result.template_source, "generic_qsr_fallback");
    assert.notEqual(result.calculated_values.service_amperage?.provenance, "square_footage");
  });

  it("aggregates gas BTU/h to a line size", () => {
    const result = computeLoadEngine({
      utilityType: "gas",
      project: {},
      equipment: [{ btu_h: 200000 }, { btu_h: 150000 }],
      verifiedValues: {},
    });
    assert.ok(result.calculated_values.connected_btu_h.value >= 350000);
    assert.ok(result.calculated_values.gas_line_size.value);
  });

  it("maps water DFU to a meter size", () => {
    const result = computeLoadEngine({
      utilityType: "water",
      project: {},
      equipment: [{ dfu: 12 }, { dfu: 10 }],
      verifiedValues: {},
    });
    assert.equal(result.calculated_values.fixture_dfu.value, 22);
    assert.equal(result.calculated_values.water_meter_size.value, "3/4\"");
  });

  it("rounds amps up to the next standard size", () => {
    assert.equal(nextStandardAmps(201), 400);
    assert.equal(nextStandardAmps(400), 400);
  });
});

describe("UCI Agent 1 required types", () => {
  it("defaults to electric gas water sewer", () => {
    assert.deepEqual(requiredUtilityTypes({}), ["electric", "gas", "water", "sewer"]);
  });
});

describe("UCI Graph sent-items reconcile", () => {
  it("returns the real Graph id and never invents one", async () => {
    const fetchFn = async () => ({
      ok: true,
      json: async () => ({
        value: [
          {
            id: "AAMk-real-id",
            internetMessageId: "<real@contoso.com>",
            subject: "Utility Coordination Application Package — Site",
            toRecipients: [{ emailAddress: { address: "utility@example.com" } }],
            sentDateTime: new Date().toISOString(),
          },
        ],
      }),
    });
    const result = await reconcileSentItemsMessage("token", {
      subject: "Utility Coordination Application Package — Site",
      to: ["utility@example.com"],
      sentAfter: new Date(Date.now() - 60_000),
      fetchFn,
      attempts: 1,
    });
    assert.equal(result.reconciled, true);
    assert.equal(result.message_id, "AAMk-real-id");
    assert.equal(result.internet_message_id, "<real@contoso.com>");
  });

  it("leaves message_id null when Sent Items has no match", async () => {
    const fetchFn = async () => ({
      ok: true,
      json: async () => ({ value: [] }),
    });
    const result = await reconcileSentItemsMessage("token", {
      subject: "missing",
      fetchFn,
      attempts: 1,
    });
    assert.equal(result.reconciled, false);
    assert.equal(result.message_id, null);
  });
});

describe("UCI email bounce", () => {
  it("detects Graph NDR senders", () => {
    assert.equal(
      isBounceMessage({ sender: "postmaster@outlook.com", raw_subject: "Undeliverable: package" }),
      true,
    );
    assert.equal(isBounceMessage({ sender: "pm@pepco.com", raw_subject: "Application received" }), false);
  });
});

describe("UCI generic application templates", () => {
  it("falls back to generic electric when the slug has no template", () => {
    const template = loadTemplateManifest("unknown-utility", "electric");
    assert.ok(template);
    assert.equal(template.template_gap, true);
  });

  it("still loads PEPCO electric", () => {
    const template = loadTemplateManifest("pepco", "electric");
    assert.equal(template.provider_slug, "pepco");
    assert.notEqual(template.template_gap, true);
  });
});

describe("UCI COS compare + Stage 6 discrepancy state", () => {
  it("includes gas_regulator in compare fields", () => {
    assert.ok(COS_COMPARE_FIELDS.some((f) => f.key === "gas_regulator"));
  });

  it("keeps revision_required in IN_PROGRESS rather than BLOCKED", async () => {
    const record = stage6CompletedRecord({
      current_stage: 6,
      current_stage_state: "AWAITING_UTILITY",
    });
    const tables = { coordination_records: [record], coordination_stage_transitions: [] };
    const supabase = createTrackBMockSupabase(tables);
    const result = await applyStage6StateFromAnalysis(supabase, {
      record,
      report: {
        revision_required: true,
        has_material_discrepancy: true,
        requires_human_review: true,
        clean_match: false,
        analysis_status: "revision_required",
      },
      reason: "test",
    });
    assert.equal(result.record.current_stage_state, "IN_PROGRESS");
    assert.notEqual(result.record.current_stage_state, "BLOCKED");
  });
});

describe("UCI §4.13 fallback provenance", () => {
  it("labels seed baselines as seed_fallback, never historical", async () => {
    const tables = {
      coordination_records: [
        stage6CompletedRecord({
          current_stage: 7,
          current_stage_state: "IN_PROGRESS",
          predicted_p50_date: null,
        }),
      ],
      utility_providers: [{ id: "prov-1", ownership_type: "iou" }],
      utility_stage_duration_baselines: [
        {
          utility_type: "electric",
          ownership_type: "iou",
          from_stage: 7,
          p50_business_days: 40,
          source: "seed_fallback",
        },
      ],
    };
    const supabase = createTrackBMockSupabase(tables);
    const result = await recomputePredictedDates(supabase, {
      record: tables.coordination_records[0],
      now: new Date("2026-08-20T12:00:00.000Z"),
    });
    assert.equal(result.computed, true);
    assert.equal(result.baseline_source, "seed_fallback");
    assert.equal(result.prediction_reason.masquerades_as_historical, false);
    assert.notEqual(result.baseline_source, "historical");
  });

  it("labels operator_override baselines as operator_override, never historical", async () => {
    const tables = {
      coordination_records: [
        stage6CompletedRecord({
          current_stage: 8,
          current_stage_state: "IN_PROGRESS",
          predicted_p50_date: null,
        }),
      ],
      utility_providers: [{ id: "prov-1", ownership_type: "iou" }],
      utility_stage_duration_baselines: [
        {
          utility_type: "electric",
          ownership_type: "iou",
          from_stage: 8,
          p50_business_days: 22,
          source: "operator_override",
        },
      ],
    };
    const supabase = createTrackBMockSupabase(tables);
    const result = await recomputePredictedDates(supabase, {
      record: tables.coordination_records[0],
      now: new Date("2026-08-20T12:00:00.000Z"),
    });
    assert.equal(result.baseline_source, "operator_override");
    assert.equal(result.prediction_reason.masquerades_as_historical, false);
    assert.notEqual(result.baseline_source, "historical");
  });

  it("keeps P90 = ceil(remaining * 1.4)", () => {
    const computed = computePredictedDates({
      today: new Date("2026-08-20T12:00:00.000Z"),
      baselineBusinessDays: 10,
      stageElapsedBusinessDays: 0,
    });
    assert.equal(computed.p90_days, Math.ceil(10 * 1.4));
  });
});

describe("UCI load calculation worksheet", () => {
  it("generates a PDF and attaches a generated_worksheet slot", async () => {
    const { buildLoadWorksheetPdf, attachLoadWorksheetToPackage } = require("../app/services/uci/uci-load-worksheet.service.js");
    const pdf = await buildLoadWorksheetPdf({
      record: { utility_type: "electric" },
      project: { name: "Site A" },
      application: {
        load_summary: {
          calculated_values: { service_size: { value: "400A", unit: "A" } },
          needs_verification: ["generic_qsr_fallback"],
        },
      },
    });
    assert.equal(pdf.slice(0, 4).toString(), "%PDF");

    const tables = {
      project_documents: [],
      projects: [{ id: "proj-1", user_id: "user-1" }],
    };
    const supabase = createTrackBMockSupabase(tables);
    const slot = await attachLoadWorksheetToPackage(supabase, {
      record: { id: "coord-1", project_id: "proj-1", utility_type: "electric" },
      project: { id: "proj-1", name: "Site A", user_id: "user-1" },
      loadSummary: { calculated_values: { service_size: { value: "400A" } } },
      userId: "user-1",
    });
    assert.equal(slot.key, "load_calculation_worksheet");
    assert.equal(slot.status, "attached");
    assert.equal(slot.source, "generated_worksheet");
  });
});
