"use strict";

/** Public fields only — no credential / secret columns */
const ACTIVE_PROVIDER_COLUMNS =
  "id, slug, name, utility_type, primary_portal_type, portal_url, automation_status, is_active";

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @returns {Promise<Array<Record<string, unknown>>>}
 */
async function listActiveProvidersForApi(supabase) {
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

  return Array.isArray(data) ? data : [];
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

module.exports = {
  listActiveProvidersForApi,
  getActiveProvidersBySlugs,
  ACTIVE_PROVIDER_COLUMNS,
};
