"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  computeStage2Readiness,
  getStage2MissingInputs,
  STAGE2_READINESS_BUCKETS,
} = require("../app/services/uci/uci-stage2-readiness.service.js");
const { reconcileLoadProfileReadiness } = require("../app/services/uci/uci-load-profile.service.js");

describe("uci-stage2-readiness", () => {
  it("uses a stable six-bucket denominator for gas progress", () => {
    const summary = {
      utility_type: "gas",
      analysis_status: "missing_inputs",
      verified_values: {
        connected_load_btuh: { value: 600000, unit: "BTUH" },
      },
      candidate_values: [],
      source_documents: [{ id: "doc-1", file_name: "gas_load_profile.pdf" }],
      load_extraction: { last_extracted_at: "2026-08-20T12:00:00.000Z" },
    };

    const readiness = computeStage2Readiness(summary);
    assert.equal(readiness.version, "stage2-readiness-v1");
    assert.equal(readiness.buckets.length, STAGE2_READINESS_BUCKETS.length);
    assert.ok(readiness.progress_percent > 0);
    assert.ok(readiness.progress_percent < 100);
    assert.deepEqual(getStage2MissingInputs(summary), [
      "btu_demand",
      "pressure_requirements",
      "meter_count",
    ]);
  });

  it("does not decrease progress when missing list grows without new discoveries", () => {
    const previous = computeStage2Readiness({
      utility_type: "electric",
      verified_values: { connected_load_kw: { value: 100, unit: "kW" } },
      candidate_values: [],
      source_documents: [{ id: "doc-1" }],
      load_extraction: { last_extracted_at: "2026-08-20T12:00:00.000Z" },
      stage2_readiness: {
        progress_percent: 42,
        missing_required_inputs: ["phase"],
      },
    });
    const next = computeStage2Readiness({
      utility_type: "electric",
      verified_values: { connected_load_kw: { value: 100, unit: "kW" } },
      candidate_values: [],
      source_documents: [{ id: "doc-1" }],
      load_extraction: { last_extracted_at: "2026-08-20T12:00:00.000Z" },
      stage2_readiness: previous,
    });
    assert.ok(next.progress_percent >= previous.progress_percent);
  });

  it("reconcileLoadProfileReadiness attaches canonical stage2_readiness", () => {
    const reconciled = reconcileLoadProfileReadiness({
      utility_type: "gas",
      analysis_status: "missing_inputs",
      verified_values: {},
      candidate_values: [],
      source_documents: [{ id: "doc-1" }],
    });
    assert.ok(reconciled.stage2_readiness);
    assert.equal(reconciled.stage2_readiness.version, "stage2-readiness-v1");
    assert.equal(typeof reconciled.stage2_readiness.progress_percent, "number");
  });
});
