"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  resolveCoverageForRequiredType,
  shouldRewriteCoverageLifecycle,
  providerNeedsConfirmationReason,
} = require("../app/services/uci/uci-provider-intake.service.js");
const { listRecordNeedsAttention } = require("../app/services/uci/uci-needs-attention.util.js");

describe("Agent 1 null-provider coverage", () => {
  it("keeps multiple gas providers BLOCKED without auto-binding", () => {
    const result = resolveCoverageForRequiredType({
      utilityType: "gas",
      typeProviders: [
        { id: "g1", slug: "gas-a" },
        { id: "g2", slug: "gas-b" },
        { id: "g3", slug: "gas-c" },
      ],
    });
    assert.equal(result.providerId, null);
    assert.equal(result.stageState, "BLOCKED");
    assert.equal(result.reason, "Gas provider needs confirmation");
    assert.equal(result.mapping.ambiguous_provider_ids.length, 3);
  });

  it("suggests a single water provider but does not bind it", () => {
    const result = resolveCoverageForRequiredType({
      utilityType: "water",
      typeProviders: [{ id: "w1", slug: "county-water" }],
    });
    assert.equal(result.providerId, null);
    assert.equal(result.stageState, "BLOCKED");
    assert.equal(result.mapping.suggested_provider_id, "w1");
    assert.equal(result.reason, "Water provider needs confirmation");
  });

  it("auto-binds only unique electric EIA matches", () => {
    const bound = resolveCoverageForRequiredType({
      utilityType: "electric",
      typeProviders: [{ id: "dom" }],
      electricResolution: {
        status: "resolved",
        suggested_provider_id: "dom",
        candidates: [{ id: "dom" }],
        boundary_risk: false,
      },
    });
    assert.equal(bound.providerId, "dom");
    assert.equal(bound.stageState, "COMPLETED");

    const ambiguous = resolveCoverageForRequiredType({
      utilityType: "electric",
      typeProviders: [{ id: "a" }, { id: "b" }],
      electricResolution: {
        status: "resolved",
        suggested_provider_id: "a",
        candidates: [{ id: "a" }, { id: "b" }],
        requires_human_confirmation: true,
      },
    });
    assert.equal(ambiguous.providerId, null);
    assert.equal(ambiguous.stageState, "BLOCKED");
  });

  it("does not rewind Stage 6 records or already-bound Stage 1 rows", () => {
    assert.equal(
      shouldRewriteCoverageLifecycle({ current_stage: 6, utility_provider_id: "dom" }),
      false,
    );
    assert.equal(
      shouldRewriteCoverageLifecycle({ current_stage: 1, utility_provider_id: "water-1" }),
      false,
    );
    assert.equal(
      shouldRewriteCoverageLifecycle({ current_stage: 1, utility_provider_id: null }),
      true,
    );
  });

  it("surfaces unassigned providers on Needs Attention", () => {
    const items = listRecordNeedsAttention({
      id: "gas-1",
      project_id: "hs",
      utility_type: "gas",
      utility_provider_id: null,
      current_stage: 1,
      current_stage_state: "IN_PROGRESS",
      metadata: {},
    });
    assert.ok(items.some((item) => item.label === "Gas provider needs confirmation"));
    assert.equal(providerNeedsConfirmationReason("telecom"), "Telecom provider needs confirmation");
  });
});
