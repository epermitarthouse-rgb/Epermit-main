import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  formatLoadProfileAnalysisStatus,
  getLoadProfileDraftApplication,
  getVerifiedCalculatedValues,
  hasInventedEngineeringValues,
  loadProfileStatusTone,
  parseLoadProfileSummary,
} from "./uciLoadProfile";

describe("uciLoadProfile helpers", () => {
  it("returns null state when no draft application exists", () => {
    assert.equal(getLoadProfileDraftApplication([]), null);
    assert.equal(parseLoadProfileSummary(null), null);
    assert.equal(loadProfileStatusTone(undefined), "neutral");
    assert.equal(formatLoadProfileAnalysisStatus(undefined), "Not analyzed");
  });

  it("parses blocked and missing-input summaries", () => {
    const summary = {
      version: "d2.1-v1",
      utility_type: "electric",
      analysis_status: "missing_inputs",
      inputs_used: [],
      missing_inputs: ["requested_voltage"],
      needs_verification: ["territory_not_auto_verified"],
      assumptions: { template_id: null, template_version: null, notes: [] },
      calculated_values: {},
      source_documents: [],
      generated_at: "2026-07-14T12:00:00.000Z",
      generated_by: "agent_2_load_profile",
      requires_human_review: true,
    };

    const app = {
      record_source: "agent_draft",
      idempotency_key: "agent_2_load_profile:d2.1-v1",
      load_summary: summary,
    };

    assert.equal(getLoadProfileDraftApplication([app])?.idempotency_key, app.idempotency_key);
    const parsed = parseLoadProfileSummary(app.load_summary);
    assert.equal(parsed?.analysis_status, "missing_inputs");
    assert.equal(loadProfileStatusTone("missing_inputs"), "warning");
    assert.match(formatLoadProfileAnalysisStatus("missing_inputs"), /Missing inputs/i);
  });

  it("parses preliminary summary and reports no verified numerics", () => {
    const summary = {
      version: "d2.1-v1",
      utility_type: "gas",
      analysis_status: "preliminary",
      inputs_used: [{ key: "project_type", source: "projects.project_type", value: "tenant_improvement" }],
      missing_inputs: [],
      needs_verification: ["provider_mapping_not_human_confirmed"],
      assumptions: { template_id: null, template_version: null, notes: ["review"] },
      calculated_values: {},
      source_documents: [],
      generated_at: "2026-07-14T12:00:00.000Z",
      generated_by: "agent_2_load_profile",
      requires_human_review: true,
    };

    const parsed = parseLoadProfileSummary(summary);
    assert.equal(parsed?.analysis_status, "preliminary");
    assert.equal(loadProfileStatusTone("preliminary"), "info");
    assert.deepEqual(getVerifiedCalculatedValues(parsed), []);
    assert.equal(hasInventedEngineeringValues(parsed), false);
  });

  it("detects invented engineering values in calculated_values", () => {
    const summary = parseLoadProfileSummary({
      version: "d2.1-v1",
      utility_type: "electric",
      analysis_status: "preliminary",
      inputs_used: [],
      missing_inputs: [],
      needs_verification: [],
      assumptions: { template_id: null, template_version: null, notes: [] },
      calculated_values: { kw: 500 },
      source_documents: [],
      generated_at: "2026-07-14T12:00:00.000Z",
      generated_by: "agent_2_load_profile",
      requires_human_review: true,
    });
    assert.equal(hasInventedEngineeringValues(summary), true);
  });
});
