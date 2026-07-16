"use strict";

const { TERRITORY_UNSUPPORTED_EIA_NAMES } = require("../../../data/utility-provider-directory.catalog.js");
const { reconcileEiaUtilityName } = require("./territory-eia-name-resolver.service.js");
const {
  classifyTerritoryUtilityName,
  isCooperativeOrMunicipalPattern,
  isTerritoryUnsupportedManualName,
} = require("./territory-unresolved-classifier.service.js");

/**
 * Reconcile EIA legal names into reviewed territory reconciliation buckets.
 *
 * @param {string[]} eiaLegalNames
 * @param {object} [ctx]
 */
function reconcileTerritoryProviderNames(eiaLegalNames, ctx = {}) {
  const names = Array.isArray(eiaLegalNames) ? eiaLegalNames : [];
  /** @type {Array<Record<string, unknown>>} */
  const resolved = [];
  /** @type {Array<Record<string, unknown>>} */
  const ambiguous = [];
  /** @type {Array<Record<string, unknown>>} */
  const unresolved = [];
  /** @type {Array<Record<string, unknown>>} */
  const unsupported_manual = [];

  for (const rawName of names) {
    const eiaLegalName = String(rawName ?? "").trim();
    if (!eiaLegalName) continue;

    if (isTerritoryUnsupportedManualName(eiaLegalName)) {
      unsupported_manual.push({
        status: "unsupported_manual",
        eia_legal_name: eiaLegalName,
        reason: "explicitly_unsupported_for_automatic_mapping",
        provider_slug: null,
        provider_id: null,
        display_name: null,
        manual_confirmation_required: true,
      });
      continue;
    }

    const result = reconcileEiaUtilityName(eiaLegalName, ctx);
    if (result.status === "resolved") {
      resolved.push({
        ...result,
        manual_confirmation_required: false,
      });
    } else if (result.status === "ambiguous") {
      ambiguous.push({
        ...result,
        manual_confirmation_required: true,
      });
    } else {
      const classification = classifyTerritoryUtilityName(eiaLegalName, ctx);
      if (classification.classification === "manual_only") {
        unsupported_manual.push({
          status: "unsupported_manual",
          eia_legal_name: eiaLegalName,
          reason: classification.reason,
          classification: classification.classification,
          provider_slug: null,
          provider_id: null,
          display_name: null,
          manual_confirmation_required: true,
          evidence_source: classification.evidence_source,
        });
      } else {
        unresolved.push({
          ...result,
          status: "unresolved",
          classification: classification.classification,
          manual_confirmation_required: classification.manual_confirmation_required !== false,
          reason: classification.reason ?? result.reason ?? "no_matching_alias",
          evidence_source: classification.evidence_source ?? null,
        });
      }
    }
  }

  return {
    resolved,
    ambiguous,
    unresolved,
    unsupported_manual,
    totals: {
      input: names.filter((n) => String(n ?? "").trim()).length,
      resolved: resolved.length,
      ambiguous: ambiguous.length,
      unresolved: unresolved.length,
      unsupported_manual: unsupported_manual.length,
    },
  };
}

module.exports = {
  isTerritoryUnsupportedManualName,
  isCooperativeOrMunicipalPattern,
  reconcileTerritoryProviderNames,
};
