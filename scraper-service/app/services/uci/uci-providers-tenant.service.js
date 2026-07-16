"use strict";

const {
  ACTIVE_PROVIDER_COLUMNS,
  formatProvidersForApiResponse,
} = require("./uci-providers.service.js");

/**
 * List global templates plus tenant-owned providers for a tenant.
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string | null | undefined} tenantId
 * @param {object} [opts]
 * @param {string | null} [opts.utilityType]
 * @returns {Promise<Array<Record<string, unknown>>>}
 */
async function listActiveProvidersForTenant(supabase, tenantId, opts = {}) {
  let query = supabase
    .from("utility_providers")
    .select(ACTIVE_PROVIDER_COLUMNS)
    .eq("is_active", true)
    .order("slug", { ascending: true });

  if (tenantId) {
    query = query.or(
      `and(is_global_template.eq.true,tenant_id.is.null),tenant_id.eq.${tenantId}`,
    );
  } else {
    query = query.eq("is_global_template", true).is("tenant_id", null);
  }

  const { data, error } = await query;

  if (error) {
    throw Object.assign(new Error(error.message || "Failed to load tenant providers"), {
      cause: error,
      statusCode: 500,
      code: "PROVIDERS_FETCH_FAILED",
    });
  }

  return formatProvidersForApiResponse(Array.isArray(data) ? data : [], opts.utilityType ?? null);
}

/**
 * Resolve provider slugs visible to a tenant (global templates + tenant-owned).
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string | null | undefined} tenantId
 * @param {string[]} slugs
 * @returns {Promise<{ providers: Array<Record<string, unknown>>, missingSlugs: string[] }>}
 */
async function getActiveProvidersBySlugsForTenant(supabase, tenantId, slugs) {
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

  const visible = await listActiveProvidersForTenant(supabase, tenantId);
  const bySlug = new Map(
    visible.map((row) => [String(row.slug).toLowerCase(), row]),
  );
  const providers = normalized
    .map((slug) => bySlug.get(slug))
    .filter(Boolean);
  const missingSlugs = normalized.filter((slug) => !bySlug.has(slug));

  return { providers, missingSlugs };
}

module.exports = {
  listActiveProvidersForTenant,
  getActiveProvidersBySlugsForTenant,
};
