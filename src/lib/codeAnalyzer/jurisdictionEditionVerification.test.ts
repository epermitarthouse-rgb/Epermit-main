import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  currentVerifiedRecord,
  resolveJurisdictionEditionVerification,
} from "./jurisdictionEditionVerification";

describe("jurisdiction edition verification", () => {
  it("warns before DC 2021 and never silently switches the selection", () => {
    const result = resolveJurisdictionEditionVerification({
      jurisdiction: "dc",
      selectedEdition: "2021",
      requestedReviewScope: "permit_compliance",
    });
    assert.equal(result.status, "conflict");
    assert.equal(result.selectedEdition, "2021");
    assert.equal(result.adoptedBaseCode, "IBC 2015");
    assert.equal(result.reviewScope, "reference_only");
    assert.equal(result.requiresReferenceConfirmation, true);
  });

  it("marks missing application facts unresolved", () => {
    const result = resolveJurisdictionEditionVerification({
      jurisdiction: "dc",
      selectedEdition: "2015",
      requestedReviewScope: "permit_compliance",
      permitFacts: { workScope: "alteration" },
    });
    assert.equal(result.status, "unresolved");
    assert.match(result.unresolvedReasons.join(" "), /date/i);
  });

  it("verifies current DC applicability with matching facts", () => {
    const result = resolveJurisdictionEditionVerification({
      jurisdiction: "dc",
      selectedEdition: "2015",
      requestedReviewScope: "permit_compliance",
      permitFacts: {
        applicationDate: "2026-10-20",
        workScope: "existing_building",
        occupancy: "commercial",
      },
    });
    assert.equal(result.status, "verified");
    assert.equal(result.reviewScope, "permit_compliance");
  });

  it("uses registry transition rules for pre-adoption applications", () => {
    const unresolved = resolveJurisdictionEditionVerification({
      jurisdiction: "dc",
      selectedEdition: "2012",
      requestedReviewScope: "permit_compliance",
      permitFacts: {
        applicationDate: "2020-05-01",
        workScope: "alteration",
      },
    });
    assert.equal(unresolved.status, "unresolved");
    assert.equal(unresolved.transitionSection, "12-A DCMR 123.1.2");
    assert.match(unresolved.unresolvedReasons.join(" "), /filing-deposit/i);

    const documented = resolveJurisdictionEditionVerification({
      jurisdiction: "dc",
      selectedEdition: "2012",
      requestedReviewScope: "permit_compliance",
      permitFacts: {
        applicationDate: "2020-05-01",
        applicationDepositPaidDate: "2020-05-01",
        applicationComplete: true,
        workScope: "alteration",
      },
    });
    assert.equal(documented.status, "verified");
    assert.equal(documented.adoptedBaseCode, "IBC 2012");
  });

  it("uses unavailable status for jurisdictions without official records", () => {
    const result = resolveJurisdictionEditionVerification({
      jurisdiction: "new-york-city",
      selectedEdition: "2022",
      requestedReviewScope: "permit_compliance",
      permitFacts: { applicationDate: "2026-10-20", workScope: "new_construction" },
    });
    assert.equal(result.status, "unavailable");
    assert.equal(result.sourceStatus, "unavailable");
  });

  it("exposes only actually verified bundled records", () => {
    assert.equal(currentVerifiedRecord("dc")?.jurisdictionCodeEdition, "2017");
    assert.equal(currentVerifiedRecord("seattle"), null);
  });
});
