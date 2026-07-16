"use strict";

const { TERRITORY_UNSUPPORTED_EIA_NAMES } = require("../../../data/utility-provider-directory.catalog.js");
const { reconcileEiaUtilityName } = require("./territory-eia-name-resolver.service.js");

/**
 * @param {string} eiaLegalName
 */
function isTerritoryUnsupportedManualName(eiaLegalName) {
  const raw = String(eiaLegalName ?? "").trim();
  if (!raw) return false;
  const blocked = new Set(
    (Array.isArray(TERRITORY_UNSUPPORTED_EIA_NAMES) ? TERRITORY_UNSUPPORTED_EIA_NAMES : []).map((name) =>
      String(name).trim().toUpperCase(),
    ),
  );
  return blocked.has(raw.toUpperCase());
}

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
      unresolved.push({
        ...result,
        status: "unresolved",
        manual_confirmation_required: true,
        reason: result.reason ?? "no_matching_alias",
      });
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
  reconcileTerritoryProviderNames,
};
