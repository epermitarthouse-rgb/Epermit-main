"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  buildCoordinationScopeKey,
  resolveLoadExtractionScope,
  getLoadExtractionEligibility,
} = require("../app/services/uci/uci-load-extraction-scope.service.js");
const { discoverLoadSourceDocuments } = require("../app/services/uci/uci-load-candidate.service.js");

describe("uci-load-extraction-scope", () => {
  it("builds coordination scope keys when no portal application is selected", () => {
    const scope = resolveLoadExtractionScope({
      coordinationRecordId: "coord-123",
      externalApplicationId: "",
    });
    assert.equal(scope.scopeKey, "coordination:coord-123");
    assert.equal(scope.externalApplicationId, null);
    assert.equal(scope.portalScoped, false);
    assert.equal(buildCoordinationScopeKey("coord-123"), "coordination:coord-123");
  });

  it("allows document discovery without external_application_id", () => {
    const discovery = discoverLoadSourceDocuments(
      {
        id: "coord-123",
        project_id: "proj-1",
        metadata: {},
      },
      { externalApplicationId: "" },
    );
    assert.equal(discovery.extraction_scope_key, "coordination:coord-123");
    assert.deepEqual(discovery.documents, []);
  });

  it("marks gas/manual extraction eligible without a portal application", () => {
    const eligibility = getLoadExtractionEligibility({
      providerSlug: "washington-gas",
      hasAnalyzedLoadProfile: true,
    });
    assert.equal(eligibility.eligible, true);
    assert.equal(eligibility.disabledReason, null);
  });
});
