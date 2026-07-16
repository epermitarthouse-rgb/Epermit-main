"use strict";

const { resolveProviderAlias } = require("../uci-provider-directory.service.js");

/**
 * Map EIA/HIFLD legal utility name to canonical catalog provider using Row 3 alias resolver.
 *
 * @param {string} eiaLegalName
 * @param {object} [ctx]
 * @param {Array<Record<string, unknown>>} [ctx.tenantProviders]
 */
function reconcileEiaUtilityName(eiaLegalName, ctx = {}) {
  const raw = String(eiaLegalName ?? "").trim();
  if (!raw) {
    return {
      status: "unresolved",
      eia_legal_name: raw,
      reason: "empty_name",
      provider_slug: null,
      provider_id: null,
      display_name: null,
    };
  }

  const aliasResult = resolveProviderAlias(raw);
  if (aliasResult.status === "found" && aliasResult.slug) {
    return {
      status: "resolved",
      eia_legal_name: raw,
      reason: aliasResult.reason ?? "alias_match",
      provider_slug: aliasResult.slug,
      provider_id: aliasResult.provider_id ?? null,
      display_name:
        aliasResult.provider && typeof aliasResult.provider === "object"
          ? String(
              /** @type {{ display_name?: unknown, name?: unknown }} */ (aliasResult.provider)
                .display_name ??
                /** @type {{ name?: unknown }} */ (aliasResult.provider).name ??
                aliasResult.slug,
            )
          : aliasResult.slug,
      candidate_slugs: [aliasResult.slug],
    };
  }

  if (aliasResult.status === "ambiguous") {
    return {
      status: "ambiguous",
      eia_legal_name: raw,
      reason: aliasResult.reason ?? "ambiguous_alias",
      provider_slug: null,
      provider_id: null,
      display_name: null,
      candidate_slugs: aliasResult.candidate_slugs ?? [],
    };
  }

  return {
    status: "unresolved",
    eia_legal_name: raw,
    reason: aliasResult.reason ?? "not_found",
    provider_slug: null,
    provider_id: null,
    display_name: null,
    candidate_slugs: [],
  };
}

module.exports = {
  reconcileEiaUtilityName,
};
