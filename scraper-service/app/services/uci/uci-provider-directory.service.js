"use strict";

const {
  UTILITY_PROVIDER_DIRECTORY,
  AMBIGUOUS_PROVIDER_ALIASES,
} = require("../../data/utility-provider-directory.catalog.js");
const {
  normalizeProviderAlias,
  normalizeProviderSlug,
} = require("./uci-provider-directory-normalize.service.js");

/**
 * @typedef {"found"|"not_found"|"ambiguous"} ProviderResolveStatus
 */

/**
 * @typedef {object} ProviderResolveResult
 * @property {ProviderResolveStatus} status
 * @property {string | null} slug
 * @property {string | null} provider_id
 * @property {string | null} reason
 * @property {string[]} [candidate_slugs]
 * @property {Record<string, unknown> | null} [provider]
 */

/**
 * Build in-memory alias index from catalog (used when DB aliases unavailable).
 * @param {Array<Record<string, unknown>>} [dbProviders]
 * @param {Array<{ alias_normalized: string, provider_id: string, provider_slug?: string }>} [dbAliases]
 */
function buildAliasIndex(dbProviders = [], dbAliases = []) {
  /** @type {Map<string, Array<{ slug: string, provider_id?: string }>>} */
  const index = new Map();

  const add = (rawAlias, slug, providerId = null) => {
    const normalized = normalizeProviderAlias(rawAlias);
    if (!normalized) return;
    const list = index.get(normalized) ?? [];
    if (!list.some((entry) => entry.slug === slug)) {
      list.push({ slug, provider_id: providerId ?? undefined });
    }
    index.set(normalized, list);
  };

  for (const entry of UTILITY_PROVIDER_DIRECTORY) {
    add(entry.slug, entry.slug);
    add(entry.display_name, entry.slug);
    add(entry.canonical_name, entry.slug);
    for (const alias of entry.aliases ?? []) {
      add(alias, entry.slug);
    }
  }

  for (const row of dbProviders) {
    const slug = String(row.slug ?? "").toLowerCase();
    if (!slug) continue;
    add(slug, slug, row.id != null ? String(row.id) : null);
    if (row.display_name) add(String(row.display_name), slug, row.id != null ? String(row.id) : null);
    if (row.canonical_name) add(String(row.canonical_name), slug, row.id != null ? String(row.id) : null);
    if (row.name) add(String(row.name), slug, row.id != null ? String(row.id) : null);
  }

  for (const aliasRow of dbAliases) {
    const slug =
      aliasRow.provider_slug != null
        ? String(aliasRow.provider_slug).toLowerCase()
        : null;
    if (!slug) continue;
    add(aliasRow.alias_normalized, slug, aliasRow.provider_id != null ? String(aliasRow.provider_id) : null);
  }

  return index;
}

/**
 * @param {string} input
 * @param {object} [ctx]
 * @param {Map<string, Array<{ slug: string, provider_id?: string }>>} [ctx.index]
 * @param {Map<string, Record<string, unknown>>} [ctx.providersBySlug]
 */
function resolveProviderAlias(input, ctx = {}) {
  const raw = String(input ?? "").trim();
  if (!raw) {
    return /** @type {ProviderResolveResult} */ ({
      status: "not_found",
      slug: null,
      provider_id: null,
      reason: "empty_input",
    });
  }

  const normalized = normalizeProviderAlias(raw);
  const slugCandidate = normalizeProviderSlug(raw);

  for (const ambiguous of AMBIGUOUS_PROVIDER_ALIASES) {
    if (normalizeProviderAlias(ambiguous.alias) === normalized) {
      return {
        status: "ambiguous",
        slug: null,
        provider_id: null,
        reason: ambiguous.reason,
        candidate_slugs: [...ambiguous.candidate_slugs],
      };
    }
  }

  const index = ctx.index ?? buildAliasIndex();
  const providersBySlug = ctx.providersBySlug ?? new Map();

  if (providersBySlug.has(slugCandidate)) {
    const provider = providersBySlug.get(slugCandidate);
    return {
      status: "found",
      slug: slugCandidate,
      provider_id: provider?.id != null ? String(provider.id) : null,
      reason: null,
      provider: provider ?? null,
    };
  }

  const matches = index.get(normalized) ?? [];
  if (matches.length === 0) {
    return {
      status: "not_found",
      slug: null,
      provider_id: null,
      reason: "no_matching_alias",
    };
  }

  const uniqueSlugs = [...new Set(matches.map((m) => m.slug))];
  if (uniqueSlugs.length > 1) {
    return {
      status: "ambiguous",
      slug: null,
      provider_id: null,
      reason: "multiple_providers_share_alias",
      candidate_slugs: uniqueSlugs,
    };
  }

  const slug = uniqueSlugs[0];
  const provider = providersBySlug.get(slug) ?? null;
  const providerId =
    provider?.id != null
      ? String(provider.id)
      : matches.find((m) => m.provider_id)?.provider_id ?? null;

  return {
    status: "found",
    slug,
    provider_id: providerId,
    reason: null,
    provider,
  };
}

/**
 * Sort providers for dropdown: CET relationship first, then display/name.
 * @param {Array<Record<string, unknown>>} providers
 * @param {string | null} [utilityTypeFilter]
 */
function sortProvidersForDirectory(providers, utilityTypeFilter = null) {
  const filter = utilityTypeFilter != null ? String(utilityTypeFilter).trim().toLowerCase() : null;
  const rows = (Array.isArray(providers) ? providers : []).filter((p) => {
    if (!filter) return true;
    return String(p.utility_type ?? "").trim().toLowerCase() === filter;
  });

  return [...rows].sort((a, b) => {
    const cetA = Boolean(a.cet_relationship);
    const cetB = Boolean(b.cet_relationship);
    if (cetA !== cetB) return cetA ? -1 : 1;
    const labelA = String(a.display_name ?? a.name ?? a.slug ?? "").toLowerCase();
    const labelB = String(b.display_name ?? b.name ?? b.slug ?? "").toLowerCase();
    return labelA.localeCompare(labelB);
  });
}

/**
 * Expand catalog entry into alias rows for seeding.
 * @param {import("../../data/utility-provider-directory.catalog.js").ProviderCatalogEntry} entry
 */
function expandCatalogAliases(entry) {
  /** @type {Array<{ alias_display: string, alias_normalized: string, alias_source: string }>} */
  const rows = [];
  const seen = new Set();

  const push = (alias, source) => {
    const display = String(alias ?? "").trim();
    if (!display) return;
    const normalized = normalizeProviderAlias(display);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    rows.push({
      alias_display: display,
      alias_normalized: normalized,
      alias_source: source,
    });
  };

  push(entry.slug, "provider_key");
  push(entry.display_name, "client_seed");
  push(entry.canonical_name, "eia_legal");
  for (const alias of entry.aliases ?? []) {
    push(alias, "manual_alias");
  }

  return rows;
}

module.exports = {
  buildAliasIndex,
  resolveProviderAlias,
  sortProvidersForDirectory,
  expandCatalogAliases,
};
