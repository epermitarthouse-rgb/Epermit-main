"use strict";

const { loadCountyUtilityEntry } = require("./territory-dataset-loader.service.js");
const { reconcileEiaUtilityName } = require("./territory-eia-name-resolver.service.js");
const { normalizeUsStateCode, normalizeCountyLookupName } = require("./territory-geo.utils.js");

/**
 * @param {string} stateCode
 * @param {string | null | undefined} countyName
 */
async function resolveCountyFallback(stateCode, countyName) {
  const normalizedState = normalizeUsStateCode(stateCode);
  const county = normalizeCountyLookupName(countyName);
  if (!normalizedState || !county) {
    return {
      ok: false,
      code: "MISSING_COUNTY_INPUT",
      matches: [],
      multi_utility: false,
    };
  }

  const entry = await loadCountyUtilityEntry(normalizedState, county);
  if (!entry) {
    return {
      ok: false,
      code: "COUNTY_NOT_MAPPED",
      matches: [],
      multi_utility: false,
    };
  }

  const utilities = Array.isArray(entry.utilities) ? entry.utilities.map((u) => String(u)) : [];
  const multiUtility = Boolean(entry.multi_utility) || utilities.length > 1;

  /** @type {Array<Record<string, unknown>>} */
  const canonicalMatches = [];
  const unresolved = [];
  const ambiguous = [];

  for (const legalName of utilities) {
    const reconciled = reconcileEiaUtilityName(legalName);
    if (reconciled.status === "resolved" && reconciled.provider_slug) {
      canonicalMatches.push({
        eia_legal_name: legalName,
        reconciled,
        match_reason: "county_fallback",
      });
    } else if (reconciled.status === "ambiguous") {
      ambiguous.push(legalName);
    } else {
      unresolved.push(legalName);
    }
  }

  const uniqueBySlug = new Map();
  for (const match of canonicalMatches) {
    const slug = String(/** @type {{ provider_slug?: string }} */ (match.reconciled).provider_slug).toLowerCase();
    if (!uniqueBySlug.has(slug)) uniqueBySlug.set(slug, match);
  }
  const deduped = [...uniqueBySlug.values()];

  return {
    ok: deduped.length > 0,
    code:
      deduped.length === 0
        ? "COUNTY_UNRESOLVED"
        : deduped.length > 1 || multiUtility
          ? "COUNTY_AMBIGUOUS"
          : "COUNTY_RESOLVED",
    matches: deduped,
    multi_utility: multiUtility || deduped.length > 1,
    unresolved_eia_names: unresolved,
    ambiguous_eia_names: ambiguous,
    source_year: entry.source_year ?? null,
  };
}

module.exports = {
  resolveCountyFallback,
};
