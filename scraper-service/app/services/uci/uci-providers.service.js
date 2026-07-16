"use strict";

const {
  sortProvidersForDirectory,
  resolveProviderAlias,
  buildAliasIndex,
} = require("./uci-provider-directory.service.js");
const { normalizeProviderAlias } = require("./uci-provider-directory-normalize.service.js");

/** Public fields only — no credential / secret columns */
const ACTIVE_PROVIDER_COLUMNS =
  "id, slug, name, display_name, canonical_name, utility_type, ownership_type, cet_relationship, portal_key, primary_portal_type, portal_url, automation_status, is_active";

/**
 * @param {Array<Record<string, unknown>>} rows
 * @param {string | null} [utilityTypeFilter]
 */
function formatProvidersForApiResponse(rows, utilityTypeFilter = null) {
  const sorted = sortProvidersForDirectory(rows, utilityTypeFilter);
  return sorted.map((row) => ({
    ...row,
    label: String(row.display_name ?? row.name ?? row.slug ?? ""),
  }));
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} [opts]
 * @param {string | null} [opts.utilityType]
 * @returns {Promise<Array<Record<string, unknown>>>}
 */
async function listActiveProvidersForApi(supabase, opts = {}) {
  const { data, error } = await supabase
    .from("utility_providers")
    .select(ACTIVE_PROVIDER_COLUMNS)
    .eq("is_active", true)
    .order("slug", { ascending: true });

  if (error) {
    throw Object.assign(new Error(error.message || "Failed to load providers"), {
      cause: error,
      statusCode: 500,
      code: "PROVIDERS_FETCH_FAILED",
    });
  }

  return formatProvidersForApiResponse(Array.isArray(data) ? data : [], opts.utilityType ?? null);
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string[]} slugs
 * @returns {Promise<{ providers: Array<Record<string, unknown>>, missingSlugs: string[] }>}
 */
async function getActiveProvidersBySlugs(supabase, slugs) {
  const normalized = [
    ...new Set(
      slugs
        .map((s) => String(s ?? "").trim().toLowerCase())
        .filter(Boolean),
    ),
  ];

  if (normalized.length === 0) {
    return { providers: [], missingSlugs: [] };
  }

  const { data, error } = await supabase
    .from("utility_providers")
    .select(`${ACTIVE_PROVIDER_COLUMNS}, slug`)
    .eq("is_active", true)
    .in("slug", normalized);

  if (error) {
    throw Object.assign(new Error(error.message || "Failed to resolve providers"), {
      cause: error,
      statusCode: 500,
      code: "PROVIDERS_RESOLVE_FAILED",
    });
  }

  const rows = Array.isArray(data) ? data : [];
  const bySlug = new Map(rows.map((r) => [String(r.slug).toLowerCase(), r]));
  const missingSlugs = normalized.filter((s) => !bySlug.has(s));

  return { providers: rows, missingSlugs };
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} aliasInput
 * @param {object} [opts]
 * @param {string | null} [opts.utilityType]
 */
async function resolveProviderAliasForApi(supabase, aliasInput, opts = {}) {
  const { data: providers, error: providerErr } = await supabase
    .from("utility_providers")
    .select(`${ACTIVE_PROVIDER_COLUMNS}, tenant_id, is_global_template`)
    .eq("is_active", true);

  if (providerErr) {
    throw Object.assign(new Error(providerErr.message || "Failed to load providers for resolve"), {
      cause: providerErr,
      statusCode: 500,
      code: "PROVIDERS_RESOLVE_FETCH_FAILED",
    });
  }

  const rows = Array.isArray(providers) ? providers : [];
  const utilityFilter = opts.utilityType != null ? String(opts.utilityType).trim().toLowerCase() : null;
  const filtered = utilityFilter
    ? rows.filter((row) => String(row.utility_type ?? "").toLowerCase() === utilityFilter)
    : rows;

  const { data: aliasRows, error: aliasErr } = await supabase
    .from("utility_provider_aliases")
    .select("alias_normalized, provider_id, alias_display, alias_source, utility_providers(slug)");

  if (aliasErr && aliasErr.code !== "42P01") {
    throw Object.assign(new Error(aliasErr.message || "Failed to load provider aliases"), {
      cause: aliasErr,
      statusCode: 500,
      code: "PROVIDER_ALIAS_FETCH_FAILED",
    });
  }

  const providersBySlug = new Map(
    filtered.map((row) => [String(row.slug).toLowerCase(), row]),
  );

  const dbAliases = (Array.isArray(aliasRows) ? aliasRows : [])
    .filter((row) => {
      const embedded = row.utility_providers;
      const slug =
        embedded && typeof embedded === "object" && !Array.isArray(embedded)
          ? String(/** @type {{ slug?: unknown }} */ (embedded).slug ?? "").toLowerCase()
          : "";
      return slug && providersBySlug.has(slug);
    })
    .map((row) => ({
      alias_normalized: String(row.alias_normalized),
      provider_id: String(row.provider_id),
      provider_slug:
        row.utility_providers && typeof row.utility_providers === "object"
          ? String(/** @type {{ slug?: unknown }} */ (row.utility_providers).slug ?? "")
          : "",
    }));

  const index = buildAliasIndex(filtered, dbAliases);
  const result = resolveProviderAlias(aliasInput, { index, providersBySlug });

  if (result.status === "found" && result.slug) {
    const provider = providersBySlug.get(result.slug) ?? null;
    return {
      ...result,
      provider,
      normalized_input: normalizeProviderAlias(aliasInput),
    };
  }

  return {
    ...result,
    normalized_input: normalizeProviderAlias(aliasInput),
  };
}

module.exports = {
  listActiveProvidersForApi,
  getActiveProvidersBySlugs,
  resolveProviderAliasForApi,
  formatProvidersForApiResponse,
  ACTIVE_PROVIDER_COLUMNS,
};
