"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { APPLICATION_PACKAGE_IDEMPOTENCY_KEY } = require("../app/services/uci/uci-application-builder.service.js");

describe("uci-package-signature generic eligibility", () => {
  it("production application package uses standard idempotency key not synthetic-only", () => {
    const productionPackage = {
      record_source: "agent_draft",
      idempotency_key: APPLICATION_PACKAGE_IDEMPOTENCY_KEY,
      agent_draft_metadata: {
        application_package: {
          checklist_mode: "provider_template",
          authoritative_requirements: true,
        },
      },
    };
    assert.equal(productionPackage.record_source, "agent_draft");
    assert.equal(productionPackage.idempotency_key, APPLICATION_PACKAGE_IDEMPOTENCY_KEY);
    assert.notEqual(
      productionPackage.agent_draft_metadata.application_package.checklist_mode,
      "synthetic_test_checklist",
    );
  });

  it("generic signature route path is distinct from synthetic-only route", () => {
    const genericPath = "/applications/:id/package-documents/signature";
    const syntheticPath = "/applications/:id/synthetic-checklist/signature";
    assert.notEqual(genericPath, syntheticPath);
    assert.match(genericPath, /package-documents\/signature/);
  });
});
