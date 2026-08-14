"use strict";

const crypto = require("crypto");
const {
  ACTIVE_PROVIDER_COLUMNS,
  formatProvidersForApiResponse,
} = require("./uci-providers.service.js");
const { requireSupportedUtilityType } = require("./uci-utility-types.js");

function providerSlugPart(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/**
 * Create (or return) a tenant-owned manual provider for one supported utility type.
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {{ tenantId: string, name: unknown, utilityType: unknown }} params
 */
async function createTenantUtilityProvider(supabase, params) {
  const tenantId = String(params.tenantId ?? "").trim();
  const name = String(params.name ?? "").trim().replace(/\s+/g, " ");
  const utilityType = requireSupportedUtilityType(params.utilityType);
  if (!tenantId) {
    const err = new Error("Project tenant is required to create a utility provider");
    err.statusCode = 400;
    err.code = "TENANT_REQUIRED";
    throw err;
  }
  if (name.length < 2 || name.length > 160) {
    const err = new Error("name must be between 2 and 160 characters");
    err.statusCode = 400;
    err.code = "INVALID_BODY";
    throw err;
  }

  const visible = await listActiveProvidersForTenant(supabase, tenantId);
  const existing = visible.find(
    (provider) =>
      String(provider.tenant_id ?? tenantId) === tenantId &&
      String(provider.utility_type ?? "").toLowerCase() === utilityType &&
      String(provider.display_name ?? provider.name ?? "").trim().toLowerCase() ===
        name.toLowerCase(),
  );
  if (existing) return { provider: existing, created: false };

  const base = providerSlugPart(name) || "utility-provider";
  const digest = crypto
    .createHash("sha256")
    .update(`${tenantId}:${name.toLowerCase()}:${utilityType}`)
    .digest("hex")
    .slice(0, 8);
  const slug = `${base}-${utilityType}-${digest}`;
  const row = {
    tenant_id: tenantId,
    is_global_template: false,
    source_template_id: null,
    slug,
    name,
    display_name: name,
    canonical_name: name,
    utility_type: utilityType,
    portal_key: slug,
    primary_portal_type: null,
    portal_url: null,
    automation_status: "manual",
    is_active: true,
    directory_source: { source: "tenant_manual" },
  };
  const { data, error } = await supabase
    .from("utility_providers")
    .insert(row)
    .select(ACTIVE_PROVIDER_COLUMNS)
    .single();
  if (error) {
    throw Object.assign(new Error(error.message || "Failed to create utility provider"), {
      cause: error,
      statusCode: error.code === "23505" ? 409 : 500,
      code: error.code === "23505" ? "PROVIDER_ALREADY_EXISTS" : "PROVIDER_CREATE_FAILED",
    });
  }
  return {
    provider: formatProvidersForApiResponse([data])[0],
    created: true,
  };
}

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
  createTenantUtilityProvider,
};
