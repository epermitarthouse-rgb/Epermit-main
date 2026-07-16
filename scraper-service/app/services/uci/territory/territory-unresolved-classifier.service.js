"use strict";

const { TERRITORY_UNSUPPORTED_EIA_NAMES } = require("../../../data/utility-provider-directory.catalog.js");
const { reconcileEiaUtilityName } = require("./territory-eia-name-resolver.service.js");
const { resolveProviderAlias } = require("../uci-provider-directory.service.js");

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

/** Exact EIA names reviewed for manual-only handling in this release. */
const TERRITORY_MANUAL_ONLY_EIA_NAMES = new Set([
  "BLACK DIAMOND POWER CO",
  "MASSACHUSETTS BAY TRANS AUTHORITY",
]);

/**
 * @param {string} eiaLegalName
 */
function isCooperativeOrMunicipalPattern(eiaLegalName) {
  const upper = String(eiaLegalName ?? "").trim().toUpperCase();
  if (!upper) return false;
  if (/^CITY OF |^TOWN OF |^VILLAGE OF |^BOROUGH OF /.test(upper)) return true;
  if (/MUNICIPAL/.test(upper)) return true;
  if (/COOP|COOPERATIVE| CO-OP| ELECTRIC MEMBERSHIP| E M C| E P A|MEMBER CORP|MEMBERSHIP CORP/.test(upper)) {
    return true;
  }
  if (/PUBLIC POWER AUTH|UTIL DIST|UTILITY DIST/.test(upper)) return true;
  return false;
}

/**
 * Deterministic classification for unresolved EIA/HIFLD utility names.
 *
 * @param {string} eiaLegalName
 * @param {object} [ctx]
 * @param {string[]} [ctx.states]
 * @param {number} [ctx.feature_count]
 * @param {number} [ctx.county_count]
 * @param {string | null} [ctx.eia_utility_id]
 */
function classifyTerritoryUtilityName(eiaLegalName, ctx = {}) {
  const name = String(eiaLegalName ?? "").trim();
  if (!name) {
    return {
      classification: "invalid_or_duplicate_source_record",
      reason: "empty_name",
      manual_confirmation_required: true,
      evidence_source: null,
    };
  }

  if (isTerritoryUnsupportedManualName(name) || TERRITORY_MANUAL_ONLY_EIA_NAMES.has(name.toUpperCase())) {
    return {
      classification: "manual_only",
      reason: "reviewed_manual_only_list",
      manual_confirmation_required: true,
      evidence_source: "territory_manual_only_registry",
    };
  }

  const reconciled = reconcileEiaUtilityName(name);
  if (reconciled.status === "resolved") {
    return {
      classification: "existing_canonical_alias",
      reason: reconciled.reason ?? "alias_match",
      provider_slug: reconciled.provider_slug,
      manual_confirmation_required: false,
      evidence_source: "row3_alias_resolver",
    };
  }

  if (reconciled.status === "ambiguous") {
    return {
      classification: "ambiguous",
      reason: reconciled.reason ?? "ambiguous_alias",
      candidate_slugs: reconciled.candidate_slugs ?? [],
      manual_confirmation_required: true,
      evidence_source: "row3_ambiguous_alias_registry",
    };
  }

  const broad = resolveProviderAlias(name);
  if (broad.status === "ambiguous") {
    return {
      classification: "ambiguous",
      reason: broad.reason ?? "broad_alias_collision",
      candidate_slugs: broad.candidate_slugs ?? [],
      manual_confirmation_required: true,
      evidence_source: "row3_ambiguous_alias_registry",
    };
  }

  if (isCooperativeOrMunicipalPattern(name)) {
    return {
      classification: "manual_only",
      reason: "cooperative_or_municipal_release_scope",
      manual_confirmation_required: true,
      evidence_source: "deterministic_name_pattern",
    };
  }

  return {
    classification: "new_canonical_required",
    reason: "distinct_unresolved_regulated_utility",
    manual_confirmation_required: true,
    evidence_source: "territory_reconciliation_gap",
  };
}

module.exports = {
  TERRITORY_MANUAL_ONLY_EIA_NAMES,
  isTerritoryUnsupportedManualName,
  isCooperativeOrMunicipalPattern,
  classifyTerritoryUtilityName,
};
