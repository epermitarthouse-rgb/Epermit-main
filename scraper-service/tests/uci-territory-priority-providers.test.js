"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { reconcileEiaUtilityName } = require("../app/services/uci/territory/territory-eia-name-resolver.service.js");
const { resolveProviderAlias } = require("../app/services/uci/uci-provider-directory.service.js");
const { reconcileTerritoryProviderNames } = require("../app/services/uci/territory/territory-provider-reconciliation.service.js");
const {
  classifyTerritoryUtilityName,
  isCooperativeOrMunicipalPattern,
} = require("../app/services/uci/territory/territory-unresolved-classifier.service.js");

describe("UCI territory priority provider legal-name aliases", () => {
  it("resolves Con Edison EIA legal name", () => {
    const result = reconcileEiaUtilityName("CONSOLIDATED EDISON CO-NY INC");
    assert.equal(result.status, "resolved");
    assert.equal(result.provider_slug, "con-edison");
  });

  it("resolves PSE&G EIA legal name without mapping to Long Island", () => {
    const result = reconcileEiaUtilityName("PUBLIC SERVICE ELEC & GAS CO");
    assert.equal(result.status, "resolved");
    assert.equal(result.provider_slug, "pseg");
    assert.notEqual(result.provider_slug, "pseg-long-island");
  });

  it("resolves Duke Energy Progress NC legal name", () => {
    const result = reconcileEiaUtilityName("DUKE ENERGY PROGRESS - (NC)");
    assert.equal(result.status, "resolved");
    assert.equal(result.provider_slug, "duke-energy-progress");
  });

  it("maps NSTAR Electric Company to Eversource not National Grid MA", () => {
    const nstar = reconcileEiaUtilityName("NSTAR ELECTRIC COMPANY");
    const massElectric = reconcileEiaUtilityName("MASSACHUSETTS ELECTRIC CO");
    assert.equal(nstar.provider_slug, "eversource");
    assert.equal(massElectric.provider_slug, "national-grid-ma");
    assert.notEqual(nstar.provider_slug, massElectric.provider_slug);
  });

  it("maps Narragansett Electric to Rhode Island Energy canonical", () => {
    const result = reconcileEiaUtilityName("THE NARRAGANSETT ELECTRIC CO");
    assert.equal(result.status, "resolved");
    assert.equal(result.provider_slug, "rhode-island-energy");
  });

  it("keeps broad Duke and National Grid aliases ambiguous", () => {
    assert.equal(resolveProviderAlias("Duke Energy").status, "ambiguous");
    assert.equal(resolveProviderAlias("National Grid").status, "ambiguous");
  });
});

describe("UCI territory unresolved classifier", () => {
  it("classifies cooperatives and municipals as manual_only", () => {
    assert.equal(
      classifyTerritoryUtilityName("CENTRAL VIRGINIA ELECTRIC COOP").classification,
      "manual_only",
    );
    assert.equal(
      classifyTerritoryUtilityName("CITY OF HARRISONBURG - (VA)").classification,
      "manual_only",
    );
  });

  it("classifies Black Diamond Power as reviewed manual_only", () => {
    assert.equal(classifyTerritoryUtilityName("BLACK DIAMOND POWER CO").classification, "manual_only");
  });

  it("buckets manual cooperatives into unsupported_manual during reconciliation", () => {
    const report = reconcileTerritoryProviderNames([
      "BLACK DIAMOND POWER CO",
      "CONSOLIDATED EDISON CO-NY INC",
    ]);
    assert.equal(report.unsupported_manual.length, 1);
    assert.equal(report.resolved.length, 1);
    assert.equal(report.totals.unresolved, 0);
  });

  it("detects cooperative name patterns deterministically", () => {
    assert.equal(isCooperativeOrMunicipalPattern("WAKE ELECTRIC MEMBERSHIP CORP"), true);
    assert.equal(isCooperativeOrMunicipalPattern("PUBLIC SERVICE ELEC & GAS CO"), false);
  });
});
