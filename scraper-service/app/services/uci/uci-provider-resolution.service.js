"use strict";

const { getProjectForUciAccess, getProjectTenantId } = require("./uci-access.service.js");
const { listActiveProvidersForTenant } = require("./uci-providers-tenant.service.js");
const {
  buildProviderSetupAddressContext,
  resolveAddressFromAcknowledgedSource,
} = require("./uci-provider-setup.service.js");
const {
  readProviderResolutionStore,
  readProviderResolutionForServiceType,
  buildNextPortalDataWithResolution,
  extractProviderResolutionFromCoordinationMetadata,
  mergeProviderResolutionIntoCoordinationMetadata,
} = require("./uci-provider-resolution-persistence.js");

const {
  PROVIDER_RESOLUTION_VERSION,
  TERRITORY_DATA_UNAVAILABLE_MESSAGE,
  normalizeServiceType,
  validateProviderResolutionResult,
} = require("./uci-provider-resolution-contract.js");
const {
  isElectricTerritoryDataAvailable,
  validateTerritoryDatasetHealth,
  configureTerritoryDatasetLoader,
} = require("./territory/territory-dataset-loader.service.js");
const { resolveElectricTerritory } = require("./territory/electric-territory-resolver.service.js");

/** Electric-only EIA territory tiers; gas/water/sewer/telecom stay manual until dedicated datasets exist. */
const ELECTRIC_TERRITORY_SERVICE_TYPES = new Set(["electric"]);

/**
 * @param {unknown} acknowledgedSource
 * @returns {"project"|"portal"|"manual"}
 */
function mapAddressSourceToResolutionSource(acknowledgedSource) {
  const normalized = String(acknowledgedSource ?? "").trim().toLowerCase();
  if (normalized === "portal_data_location" || normalized === "utility_portal") return "portal";
  if (normalized === "structured" || normalized === "manual" || normalized === "confirmed") {
    return "project";
  }
  if (normalized === "none") return "manual";
  return "manual";
}

/**
 * @param {ReturnType<typeof buildProviderSetupAddressContext>} addressContext
 * @param {string | null | undefined} acknowledgedSource
 */
function buildResolutionAddressBlock(addressContext, acknowledgedSource) {
  let address = addressContext.address;
  if (acknowledgedSource) {
    try {
      address = resolveAddressFromAcknowledgedSource(
        addressContext,
        /** @type {"structured" | "portal_data_location" | "utility_portal" | "none"} */ (acknowledgedSource),
      );
    } catch {
      address = addressContext.address;
    }
  }

  return {
    formatted: address?.formatted ?? null,
    source: mapAddressSourceToResolutionSource(address?.source ?? acknowledgedSource),
    latitude: null,
    longitude: null,
    geocode_provider: null,
    geocoded_at: null,
  };
}

/**
 * Whether authoritative EIA territory datasets are loaded for the service type.
 * Deferred until polygon/county ingestion — never fake availability.
 *
 * @param {string} serviceType
 * @param {Array<Record<string, unknown>>} [_providers]
 */
async function isTerritoryDataAvailableForServiceType(serviceType, stateCode = null) {
  if (!ELECTRIC_TERRITORY_SERVICE_TYPES.has(normalizeServiceType(serviceType))) {
    return false;
  }
  return isElectricTerritoryDataAvailable("electric", stateCode);
}

/**
 * @param {object} params
 * @param {string} params.serviceType
 * @param {ReturnType<typeof buildProviderSetupAddressContext>} params.addressContext
 * @param {string | null | undefined} [params.addressSourceAcknowledged]
 */
function buildTerritoryUnavailableResolution(params) {
  const serviceType = normalizeServiceType(params.serviceType);
  const now = new Date().toISOString();

  return {
    service_type: serviceType,
    status: "territory_data_unavailable",
    resolution_tier: null,
    resolution_method: "manual_selection",
    confidence: "none",
    address: buildResolutionAddressBlock(params.addressContext, params.addressSourceAcknowledged),
    source: {
      name: "EIA Energy Atlas",
      dataset_vintage: null,
      layer_id: null,
      source_url: null,
      generated_at: null,
      available: false,
    },
    candidates: [],
    suggested_provider_id: null,
    boundary_risk: false,
    boundary_distance_miles: null,
    requires_human_confirmation: true,
    confirmed_provider_id: null,
    confirmed_by: null,
    confirmed_at: null,
    override_reason: null,
    notes: TERRITORY_DATA_UNAVAILABLE_MESSAGE,
    resolver_version: PROVIDER_RESOLUTION_VERSION,
    resolved_at: now,
    user_message: TERRITORY_DATA_UNAVAILABLE_MESSAGE,
  };
}

/**
 * @param {Record<string, unknown>} provider
 */
function providerToCandidate(provider, matchReason) {
  return {
    provider_id: String(provider.id),
    provider_slug: String(provider.slug ?? "").toLowerCase(),
    display_name: String(provider.display_name ?? provider.name ?? provider.slug ?? ""),
    match_reason: matchReason,
    coverage_or_distance: null,
  };
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} params
 * @param {string} params.projectId
 * @param {string} params.userId
 * @param {string} params.serviceType
 * @param {string | null | undefined} [params.addressSourceAcknowledged]
 */
async function resolveProviderResolutionForProject(supabase, params) {
  const serviceType = normalizeServiceType(params.serviceType);
  if (!serviceType) {
    const err = new Error("service_type is required");
    err.statusCode = 400;
    err.code = "INVALID_BODY";
    throw err;
  }

  const project = await getProjectForUciAccess({
    supabase,
    userId: params.userId,
    projectId: params.projectId,
  });
  if (!project) {
    const err = new Error("Project not found");
    err.statusCode = 404;
    err.code = "PROJECT_NOT_FOUND";
    throw err;
  }

  const tenantRow = await getProjectTenantId(supabase, params.projectId);
  const providers = await listActiveProvidersForTenant(
    supabase,
    tenantRow?.tenant_id ? String(tenantRow.tenant_id) : null,
  );

  const addressContext = buildProviderSetupAddressContext(project);
  const existing = readProviderResolutionForServiceType(project, serviceType);

  /** @type {Record<string, unknown>} */
  let result;

  if (normalizeServiceType(serviceType) === "electric" && (await isTerritoryDataAvailableForServiceType(serviceType))) {
    result = await resolveElectricTerritory({
      serviceType,
      addressContext,
      addressSourceAcknowledged: params.addressSourceAcknowledged,
      tenantProviders: providers,
      existingResolution: existing,
    });
  } else if (normalizeServiceType(serviceType) === "electric") {
    result = buildTerritoryUnavailableResolution({
      serviceType,
      addressContext,
      addressSourceAcknowledged: params.addressSourceAcknowledged,
    });
  } else {
    result = {
      ...buildTerritoryUnavailableResolution({
        serviceType,
        addressContext,
        addressSourceAcknowledged: params.addressSourceAcknowledged,
      }),
      status: "manual_confirmation_required",
      notes: `${normalizeServiceType(serviceType)} territory resolution is not available. Select and confirm manually.`,
      user_message: "Automatic territory matching is not available for this utility type. Select and confirm manually.",
    };
  }

  if (existing?.status === "confirmed" || existing?.status === "overridden") {
    result = {
      ...result,
      confirmed_provider_id: existing.confirmed_provider_id ?? null,
      confirmed_by: existing.confirmed_by ?? null,
      confirmed_at: existing.confirmed_at ?? null,
      override_reason: existing.override_reason ?? null,
      status: existing.status,
      requires_human_confirmation: false,
    };
  }

  const validation = validateProviderResolutionResult(result);
  if (!validation.ok) {
    const err = new Error(`Invalid resolver output: ${validation.errors.join("; ")}`);
    err.statusCode = 500;
    err.code = "RESOLVER_CONTRACT_VIOLATION";
    throw err;
  }

  const nextPortalData = buildNextPortalDataWithResolution(project, serviceType, result);
  const { error: updateErr } = await supabase
    .from("projects")
    .update({ portal_data: nextPortalData })
    .eq("id", params.projectId);

  if (updateErr) {
    throw Object.assign(new Error(updateErr.message || "Failed to persist provider resolution"), {
      cause: updateErr,
      statusCode: 500,
      code: "RESOLUTION_PERSIST_FAILED",
    });
  }

  return {
    project_id: params.projectId,
    service_type: serviceType,
    resolution: result,
  };
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} params
 * @param {string} params.projectId
 * @param {string} params.userId
 * @param {string} params.serviceType
 * @param {string} params.providerId
 * @param {string | null | undefined} [params.notes]
 */
async function confirmProviderResolutionForProject(supabase, params) {
  const serviceType = normalizeServiceType(params.serviceType);
  const providerId = String(params.providerId ?? "").trim();
  if (!serviceType || !providerId) {
    const err = new Error("service_type and provider_id are required");
    err.statusCode = 400;
    err.code = "INVALID_BODY";
    throw err;
  }

  const project = await getProjectForUciAccess({
    supabase,
    userId: params.userId,
    projectId: params.projectId,
  });
  if (!project) {
    const err = new Error("Project not found");
    err.statusCode = 404;
    err.code = "PROJECT_NOT_FOUND";
    throw err;
  }

  const tenantRow = await getProjectTenantId(supabase, params.projectId);
  const providers = await listActiveProvidersForTenant(
    supabase,
    tenantRow?.tenant_id ? String(tenantRow.tenant_id) : null,
  );
  const provider = providers.find((row) => String(row.id) === providerId);
  if (!provider) {
    const err = new Error("Provider not found for this project tenant");
    err.statusCode = 400;
    err.code = "INVALID_PROVIDER";
    throw err;
  }

  const providerUtilityType = normalizeServiceType(provider.utility_type);
  if (providerUtilityType !== serviceType) {
    const err = new Error(
      `Provider utility type (${providerUtilityType}) does not match service_type (${serviceType})`,
    );
    err.statusCode = 400;
    err.code = "SERVICE_TYPE_MISMATCH";
    throw err;
  }

  const existing =
    readProviderResolutionForServiceType(project, serviceType) ??
    buildTerritoryUnavailableResolution({
      serviceType,
      addressContext: buildProviderSetupAddressContext(project),
    });

  const confirmedAt = new Date().toISOString();
  const candidate = providerToCandidate(provider, "manual_selection");

  const result = {
    ...existing,
    service_type: serviceType,
    status: "confirmed",
    resolution_method: "manual_selection",
    confidence: "none",
    candidates: existing.candidates?.length ? existing.candidates : [candidate],
    suggested_provider_id: existing.suggested_provider_id ?? null,
    requires_human_confirmation: false,
    confirmed_provider_id: providerId,
    confirmed_by: params.userId,
    confirmed_at: confirmedAt,
    notes: params.notes != null ? String(params.notes).trim() || null : existing.notes ?? null,
    resolver_version: PROVIDER_RESOLUTION_VERSION,
    confirmed_provider_slug: String(provider.slug ?? "").toLowerCase(),
  };

  const validation = validateProviderResolutionResult(result);
  if (!validation.ok) {
    const err = new Error(`Invalid confirmation output: ${validation.errors.join("; ")}`);
    err.statusCode = 500;
    err.code = "RESOLVER_CONTRACT_VIOLATION";
    throw err;
  }

  const nextPortalData = buildNextPortalDataWithResolution(project, serviceType, result);
  const { error: updateErr } = await supabase
    .from("projects")
    .update({ portal_data: nextPortalData })
    .eq("id", params.projectId);

  if (updateErr) {
    throw Object.assign(new Error(updateErr.message || "Failed to persist provider confirmation"), {
      cause: updateErr,
      statusCode: 500,
      code: "RESOLUTION_PERSIST_FAILED",
    });
  }

  return {
    project_id: params.projectId,
    service_type: serviceType,
    resolution: result,
  };
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} params
 * @param {string} params.projectId
 * @param {string} params.userId
 * @param {string} params.serviceType
 * @param {string} params.providerId
 * @param {string} params.overrideReason
 * @param {string | null | undefined} [params.notes]
 */
async function overrideProviderResolutionForProject(supabase, params) {
  const overrideReason = String(params.overrideReason ?? "").trim();
  if (!overrideReason) {
    const err = new Error("override_reason is required");
    err.statusCode = 400;
    err.code = "INVALID_BODY";
    throw err;
  }

  const serviceType = normalizeServiceType(params.serviceType);
  const providerId = String(params.providerId ?? "").trim();
  if (!serviceType || !providerId) {
    const err = new Error("service_type and provider_id are required");
    err.statusCode = 400;
    err.code = "INVALID_BODY";
    throw err;
  }

  const project = await getProjectForUciAccess({
    supabase,
    userId: params.userId,
    projectId: params.projectId,
  });
  if (!project) {
    const err = new Error("Project not found");
    err.statusCode = 404;
    err.code = "PROJECT_NOT_FOUND";
    throw err;
  }

  const tenantRow = await getProjectTenantId(supabase, params.projectId);
  const providers = await listActiveProvidersForTenant(
    supabase,
    tenantRow?.tenant_id ? String(tenantRow.tenant_id) : null,
  );
  const provider = providers.find((row) => String(row.id) === providerId);
  if (!provider) {
    const err = new Error("Provider not found for this project tenant");
    err.statusCode = 400;
    err.code = "INVALID_PROVIDER";
    throw err;
  }

  const providerUtilityType = normalizeServiceType(provider.utility_type);
  if (providerUtilityType !== serviceType) {
    const err = new Error(
      `Provider utility type (${providerUtilityType}) does not match service_type (${serviceType})`,
    );
    err.statusCode = 400;
    err.code = "SERVICE_TYPE_MISMATCH";
    throw err;
  }

  const existing =
    readProviderResolutionForServiceType(project, serviceType) ??
    buildTerritoryUnavailableResolution({
      serviceType,
      addressContext: buildProviderSetupAddressContext(project),
    });

  const originalSuggestion = existing.suggested_provider_id ?? null;
  const originalCandidates = Array.isArray(existing.candidates) ? [...existing.candidates] : [];
  const confirmedAt = new Date().toISOString();

  const result = {
    ...existing,
    service_type: serviceType,
    status: "overridden",
    resolution_method: "manual_selection",
    confidence: existing.confidence ?? "none",
    candidates: originalCandidates,
    suggested_provider_id: originalSuggestion,
    original_suggestion: {
      suggested_provider_id: originalSuggestion,
      candidates: originalCandidates,
      resolution_method: existing.resolution_method ?? null,
      resolution_tier: existing.resolution_tier ?? null,
      source: existing.source ?? null,
    },
    requires_human_confirmation: false,
    confirmed_provider_id: providerId,
    confirmed_by: params.userId,
    confirmed_at: confirmedAt,
    override_reason: overrideReason,
    notes: params.notes != null ? String(params.notes).trim() || null : existing.notes ?? null,
    resolver_version: PROVIDER_RESOLUTION_VERSION,
    confirmed_provider_slug: String(provider.slug ?? "").toLowerCase(),
  };

  const validation = validateProviderResolutionResult(result);
  if (!validation.ok) {
    const err = new Error(`Invalid override output: ${validation.errors.join("; ")}`);
    err.statusCode = 500;
    err.code = "RESOLVER_CONTRACT_VIOLATION";
    throw err;
  }

  const nextPortalData = buildNextPortalDataWithResolution(project, serviceType, result);
  const { error: updateErr } = await supabase
    .from("projects")
    .update({ portal_data: nextPortalData })
    .eq("id", params.projectId);

  if (updateErr) {
    throw Object.assign(new Error(updateErr.message || "Failed to persist provider override"), {
      cause: updateErr,
      statusCode: 500,
      code: "RESOLUTION_PERSIST_FAILED",
    });
  }

  return {
    project_id: params.projectId,
    service_type: serviceType,
    resolution: result,
  };
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} params
 * @param {string} params.projectId
 * @param {string} params.userId
 * @param {string | null | undefined} [params.serviceType]
 */
async function getProviderResolutionForProject(supabase, params) {
  const project = await getProjectForUciAccess({
    supabase,
    userId: params.userId,
    projectId: params.projectId,
  });
  if (!project) {
    const err = new Error("Project not found");
    err.statusCode = 404;
    err.code = "PROJECT_NOT_FOUND";
    throw err;
  }

  const store = readProviderResolutionStore(project);
  const addressContext = buildProviderSetupAddressContext(project);
  const filterType = params.serviceType ? normalizeServiceType(params.serviceType) : null;

  /** @type {Record<string, unknown>} */
  const byServiceType = {};
  const rawByType =
    store?.by_service_type &&
    typeof store.by_service_type === "object" &&
    !Array.isArray(store.by_service_type)
      ? /** @type {Record<string, unknown>} */ (store.by_service_type)
      : {};

  if (filterType) {
    const entry = rawByType[filterType];
    if (entry && typeof entry === "object" && !Array.isArray(entry)) {
      byServiceType[filterType] = entry;
    }
  } else {
    Object.assign(byServiceType, rawByType);
  }

  return {
    project_id: params.projectId,
    resolver_version: store?.resolver_version ?? PROVIDER_RESOLUTION_VERSION,
    territory_data_available: {
      electric: await isTerritoryDataAvailableForServiceType("electric"),
      gas: false,
    },
    territory_dataset_health: await validateTerritoryDatasetHealth(),
    address_context: {
      formatted: addressContext.address?.formatted ?? null,
      source: addressContext.address?.source ?? "none",
      address_mismatch: addressContext.address_mismatch,
    },
    resolutions: byServiceType,
    user_messages: {
      territory_unavailable: TERRITORY_DATA_UNAVAILABLE_MESSAGE,
    },
  };
}

module.exports = {
  PROVIDER_RESOLUTION_VERSION,
  ELECTRIC_TERRITORY_SERVICE_TYPES,
  isTerritoryDataAvailableForServiceType,
  buildTerritoryUnavailableResolution,
  resolveProviderResolutionForProject,
  confirmProviderResolutionForProject,
  overrideProviderResolutionForProject,
  getProviderResolutionForProject,
  providerToCandidate,
  configureTerritoryDatasetLoader,
};
