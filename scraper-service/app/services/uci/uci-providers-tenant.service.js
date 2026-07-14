"use strict";

const { ACTIVE_PROVIDER_COLUMNS } = require("./uci-providers.service.js");

/**
 * List global templates plus tenant-owned providers for a tenant.
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string | null | undefined} tenantId
 * @returns {Promise<Array<Record<string, unknown>>>}
 */
async function listActiveProvidersForTenant(supabase, tenantId) {
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

  return Array.isArray(data) ? data : [];
}

module.exports = {
  listActiveProvidersForTenant,
};
