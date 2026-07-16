"use strict";

const { PROVIDER_RESOLUTION_VERSION } = require("../uci-provider-resolution-contract.js");
const {
  isElectricTerritoryDataAvailable,
  loadStateTerritoryGeoJson,
  readManifest,
} = require("./territory-dataset-loader.service.js");
const { geocodeUsAddressWithCensus } = require("./territory-geocode.service.js");
const { resolvePointInPolygonMatches } = require("./territory-polygon-resolver.service.js");
const { resolveCountyFallback } = require("./territory-county-resolver.service.js");
const { normalizeUsStateCode } = require("./territory-geo.utils.js");

/**
 * @param {Record<string, unknown>} manifest
 */
function buildSourceBlock(manifest) {
  return {
    name: String(manifest?.source_name ?? "EIA Energy Atlas"),
    dataset_vintage: manifest?.source_vintage != null ? String(manifest.source_vintage) : null,
    layer_id: manifest?.layer_id != null ? String(manifest.layer_id) : null,
    source_url: manifest?.source_url != null ? String(manifest.source_url) : null,
    generated_at: manifest?.generated_at != null ? String(manifest.generated_at) : null,
    available: true,
    fallback_used: Boolean(manifest?.fallback_used),
    fallback_reason: manifest?.fallback_reason != null ? String(manifest.fallback_reason) : null,
  };
}

/**
 * @param {Array<Record<string, unknown>>} matches
 * @param {Array<Record<string, unknown>>} tenantProviders
 */
function buildCandidatesFromMatches(matches, tenantProviders) {
  const providersBySlug = new Map(
    tenantProviders.map((p) => [String(p.slug ?? "").toLowerCase(), p]),
  );

  return matches
    .map((match) => {
      const reconciled = /** @type {{ provider_slug?: string, display_name?: string | null, provider_id?: string | null }} */ (
        match.reconciled
      );
      const slug = reconciled.provider_slug ? String(reconciled.provider_slug).toLowerCase() : "";
      const tenant = slug ? providersBySlug.get(slug) : null;
      return {
        provider_id: tenant ? String(tenant.id) : reconciled.provider_id ?? null,
        provider_slug: slug,
        display_name: String(
          tenant?.display_name ?? tenant?.name ?? reconciled.display_name ?? match.eia_legal_name ?? slug,
        ),
        match_reason: String(match.match_reason ?? "territory_polygon"),
        coverage_or_distance: match.boundary_distance_miles ?? null,
        eia_legal_name: match.eia_legal_name ?? null,
      };
    })
    .filter((c) => c.provider_slug);
}

/**
 * @param {object} params
 * @param {string} params.serviceType
 * @param {ReturnType<import('../uci-provider-setup.service.js').buildProviderSetupAddressContext>} params.addressContext
 * @param {string | null | undefined} [params.addressSourceAcknowledged]
 * @param {Array<Record<string, unknown>>} params.tenantProviders
 * @param {Record<string, unknown> | null | undefined} [params.existingResolution]
 */
async function resolveElectricTerritory(params) {
  const serviceType = "electric";
  const now = new Date().toISOString();

  let address = params.addressContext.address;
  if (params.addressSourceAcknowledged) {
    try {
      const { resolveAddressFromAcknowledgedSource } = require("../uci-provider-setup.service.js");
      address = resolveAddressFromAcknowledgedSource(
        params.addressContext,
        /** @type {"structured" | "portal_data_location" | "utility_portal" | "none"} */ (
          params.addressSourceAcknowledged
        ),
      );
    } catch {
      address = params.addressContext.address;
    }
  }

  const formattedAddress = address?.formatted ?? null;
  const addressParts =
    address?.parts && typeof address.parts === "object" && !Array.isArray(address.parts)
      ? address.parts
      : {};

  if (!formattedAddress) {
    return {
      service_type: serviceType,
      status: "manual_confirmation_required",
      resolution_tier: null,
      resolution_method: "manual_selection",
      confidence: "none",
      address: {
        formatted: null,
        source: "manual",
        latitude: null,
        longitude: null,
        geocode_provider: null,
        geocoded_at: null,
      },
      source: { name: "EIA Energy Atlas", dataset_vintage: null, layer_id: null, source_url: null, generated_at: null, available: false },
      candidates: [],
      suggested_provider_id: null,
      boundary_risk: false,
      boundary_distance_miles: null,
      requires_human_confirmation: true,
      confirmed_provider_id: null,
      confirmed_by: null,
      confirmed_at: null,
      override_reason: null,
      notes: "Project address is missing. Select and confirm the utility serving this project.",
      resolver_version: PROVIDER_RESOLUTION_VERSION,
      resolved_at: now,
      user_message: "Project address is missing. Select and confirm the utility serving this project.",
    };
  }

  const geocode = await geocodeUsAddressWithCensus(formattedAddress);
  const stateCode =
    normalizeUsStateCode(geocode.state_code) ||
    normalizeUsStateCode(addressParts.state) ||
    normalizeUsStateCode(params.addressContext.structured?.parts?.state);

  if (!geocode.ok || geocode.latitude == null || geocode.longitude == null) {
    return {
      service_type: serviceType,
      status: geocode.code === "LOW_CONFIDENCE" ? "manual_confirmation_required" : "geocoding_failed",
      resolution_tier: null,
      resolution_method: "manual_selection",
      confidence: "none",
      address: {
        formatted: formattedAddress,
        source: "project",
        latitude: geocode.latitude,
        longitude: geocode.longitude,
        geocode_provider: geocode.geocode_provider,
        geocoded_at: geocode.geocoded_at,
        geocode_match_type: geocode.match_type,
        geocode_confidence: geocode.confidence,
      },
      source: { name: "EIA Energy Atlas", dataset_vintage: null, layer_id: null, source_url: null, generated_at: null, available: false },
      candidates: [],
      suggested_provider_id: null,
      boundary_risk: false,
      boundary_distance_miles: null,
      requires_human_confirmation: true,
      confirmed_provider_id: null,
      confirmed_by: null,
      confirmed_at: null,
      override_reason: null,
      notes: "Address geocoding did not meet the confidence threshold for automatic territory matching.",
      resolver_version: PROVIDER_RESOLUTION_VERSION,
      resolved_at: now,
      user_message: "Address geocoding did not meet the confidence threshold. Select and confirm the utility serving this project.",
      geocode_error: geocode.code,
    };
  }

  if (!await isElectricTerritoryDataAvailable(serviceType, stateCode)) {
    return {
      service_type: serviceType,
      status: "territory_data_unavailable",
      resolution_tier: null,
      resolution_method: "manual_selection",
      confidence: "none",
      address: {
        formatted: geocode.formatted ?? formattedAddress,
        source: "project",
        latitude: geocode.latitude,
        longitude: geocode.longitude,
        geocode_provider: geocode.geocode_provider,
        geocoded_at: geocode.geocoded_at,
        geocode_match_type: geocode.match_type,
        geocode_confidence: geocode.confidence,
        state_code: stateCode || null,
      },
      source: { name: "EIA Energy Atlas", dataset_vintage: null, layer_id: null, source_url: null, generated_at: null, available: false },
      candidates: [],
      suggested_provider_id: null,
      boundary_risk: false,
      boundary_distance_miles: null,
      requires_human_confirmation: true,
      confirmed_provider_id: null,
      confirmed_by: null,
      confirmed_at: null,
      override_reason: null,
      notes: stateCode
        ? `Territory dataset is not available for state ${stateCode}.`
        : "Territory dataset is not available for this project state.",
      resolver_version: PROVIDER_RESOLUTION_VERSION,
      resolved_at: now,
      user_message:
        "Automatic territory matching is not available yet. Select and confirm the utility serving this project.",
    };
  }

  const loaded = await loadStateTerritoryGeoJson(stateCode);
  if (!loaded.ok || !loaded.geojson) {
    return {
      service_type: serviceType,
      status: "territory_data_unavailable",
      resolution_tier: null,
      resolution_method: "manual_selection",
      confidence: "none",
      address: {
        formatted: geocode.formatted ?? formattedAddress,
        source: "project",
        latitude: geocode.latitude,
        longitude: geocode.longitude,
        geocode_provider: geocode.geocode_provider,
        geocoded_at: geocode.geocoded_at,
        state_code: stateCode,
      },
      source: buildSourceBlock(loaded.manifest ?? {}),
      candidates: [],
      suggested_provider_id: null,
      boundary_risk: false,
      boundary_distance_miles: null,
      requires_human_confirmation: true,
      confirmed_provider_id: null,
      confirmed_by: null,
      confirmed_at: null,
      override_reason: null,
      notes: `Territory dataset could not be loaded (${loaded.code}).`,
      resolver_version: PROVIDER_RESOLUTION_VERSION,
      resolved_at: now,
      dataset_error: loaded.code,
      user_message:
        "Automatic territory matching is not available yet. Select and confirm the utility serving this project.",
    };
  }

  const manifest = loaded.manifest ?? (await readManifest()) ?? {};
  const source = buildSourceBlock(manifest);

  const polygon = resolvePointInPolygonMatches(loaded.geojson, {
    longitude: geocode.longitude,
    latitude: geocode.latitude,
  });

  const addressBlock = {
    formatted: geocode.formatted ?? formattedAddress,
    source: "project",
    latitude: geocode.latitude,
    longitude: geocode.longitude,
    geocode_provider: geocode.geocode_provider,
    geocoded_at: geocode.geocoded_at,
    geocode_match_type: geocode.match_type,
    geocode_confidence: geocode.confidence,
    state_code: stateCode,
    county: geocode.county_name ?? null,
  };

  if (polygon.canonical_matches.length > 1 || polygon.ambiguous_eia_names.length > 0) {
    const candidates = buildCandidatesFromMatches(polygon.canonical_matches, params.tenantProviders);
    return {
      service_type: serviceType,
      status: "ambiguous",
      resolution_tier: 1,
      resolution_method: polygon.boundary_risk ? "boundary_buffer" : "point_in_polygon",
      confidence: "low",
      address: addressBlock,
      source,
      candidates,
      suggested_provider_id: null,
      boundary_risk: Boolean(polygon.boundary_risk),
      boundary_distance_miles: polygon.boundary_distance_miles,
      boundary_buffer_miles: polygon.boundary_buffer_miles,
      requires_human_confirmation: true,
      confirmed_provider_id: null,
      confirmed_by: null,
      confirmed_at: null,
      override_reason: null,
      notes: "Multiple possible providers were found. Review the candidates before continuing.",
      resolver_version: PROVIDER_RESOLUTION_VERSION,
      resolved_at: now,
      unresolved_eia_names: polygon.unresolved_eia_names,
      user_message: "Multiple possible providers were found. Review the candidates before continuing.",
    };
  }

  if (polygon.canonical_matches.length === 1) {
    const match = polygon.canonical_matches[0];
    const candidates = buildCandidatesFromMatches([match], params.tenantProviders);
    const suggested = candidates[0] ?? null;
    const boundaryRisk = Boolean(polygon.boundary_risk);
    const confidence = boundaryRisk ? "medium" : "high";

    return {
      service_type: serviceType,
      status: "resolved",
      resolution_tier: boundaryRisk ? 2 : 1,
      resolution_method: boundaryRisk ? "boundary_buffer" : "point_in_polygon",
      confidence,
      address: addressBlock,
      source,
      candidates,
      suggested_provider_id: suggested?.provider_id ?? null,
      suggested_provider_slug: suggested?.provider_slug ?? null,
      boundary_risk: boundaryRisk,
      boundary_distance_miles: polygon.boundary_distance_miles,
      boundary_buffer_miles: polygon.boundary_buffer_miles,
      nearest_competing_provider: polygon.nearest_competing_provider,
      requires_human_confirmation: true,
      confirmed_provider_id: null,
      confirmed_by: null,
      confirmed_at: null,
      override_reason: null,
      notes: boundaryRisk
        ? "This project is near a utility territory boundary. Human confirmation is required."
        : suggested
          ? `Suggested electric provider: ${suggested.display_name}. Matched using the EIA electric service-territory map.`
          : null,
      resolver_version: PROVIDER_RESOLUTION_VERSION,
      resolved_at: now,
      unresolved_eia_names: polygon.unresolved_eia_names,
      user_message: boundaryRisk
        ? "This address is near a utility territory boundary. Review and confirm before continuing."
        : suggested
          ? `Suggested electric provider: ${suggested.display_name}. Matched using the EIA electric service-territory map. Review and confirm before continuing.`
          : "Review and confirm the utility serving this project.",
    };
  }

  // Tier 3 county fallback
  const countyName = geocode.county_name ?? null;
  const county = await resolveCountyFallback(stateCode, countyName);
  if (county.ok && county.matches.length === 1) {
    const candidates = buildCandidatesFromMatches(county.matches, params.tenantProviders);
    const suggested = candidates[0] ?? null;
    return {
      service_type: serviceType,
      status: "resolved",
      resolution_tier: 3,
      resolution_method: "county_fallback",
      confidence: "medium",
      address: addressBlock,
      source: {
        ...source,
        county_source_year: county.source_year ?? null,
      },
      candidates,
      suggested_provider_id: suggested?.provider_id ?? null,
      suggested_provider_slug: suggested?.provider_slug ?? null,
      boundary_risk: false,
      boundary_distance_miles: null,
      requires_human_confirmation: true,
      confirmed_provider_id: null,
      confirmed_by: null,
      confirmed_at: null,
      override_reason: null,
      notes: suggested
        ? `County fallback suggests ${suggested.display_name}. Review and confirm before continuing.`
        : "County fallback produced a utility match.",
      resolver_version: PROVIDER_RESOLUTION_VERSION,
      resolved_at: now,
      user_message: suggested
        ? `Suggested electric provider: ${suggested.display_name}. Matched using EIA-861 county data. Review and confirm before continuing.`
        : "Review and confirm the utility serving this project.",
    };
  }

  if (county.code === "COUNTY_AMBIGUOUS" || (county.matches && county.matches.length > 1)) {
    const candidates = buildCandidatesFromMatches(county.matches ?? [], params.tenantProviders);
    return {
      service_type: serviceType,
      status: "ambiguous",
      resolution_tier: 3,
      resolution_method: "county_fallback",
      confidence: "low",
      address: addressBlock,
      source,
      candidates,
      suggested_provider_id: null,
      boundary_risk: false,
      boundary_distance_miles: null,
      requires_human_confirmation: true,
      confirmed_provider_id: null,
      confirmed_by: null,
      confirmed_at: null,
      override_reason: null,
      notes: "The county contains multiple electric utilities. Automatic selection is not safe.",
      resolver_version: PROVIDER_RESOLUTION_VERSION,
      resolved_at: now,
      unresolved_eia_names: county.unresolved_eia_names ?? [],
      user_message: "The county contains multiple electric utilities. Review the possible providers before continuing.",
    };
  }

  return {
    service_type: serviceType,
    status: "not_found",
    resolution_tier: null,
    resolution_method: "manual_selection",
    confidence: "none",
    address: addressBlock,
    source,
    candidates: [],
    suggested_provider_id: null,
    boundary_risk: false,
    boundary_distance_miles: null,
    requires_human_confirmation: true,
    confirmed_provider_id: null,
    confirmed_by: null,
    confirmed_at: null,
    override_reason: null,
    notes: "No electric utility territory match was found. Select and confirm the utility manually.",
    resolver_version: PROVIDER_RESOLUTION_VERSION,
    resolved_at: now,
    unresolved_eia_names: polygon.unresolved_eia_names,
    user_message: "No automatic electric provider match was found. Select and confirm the utility serving this project.",
  };
}

module.exports = {
  resolveElectricTerritory,
  buildCandidatesFromMatches,
  buildSourceBlock,
};
