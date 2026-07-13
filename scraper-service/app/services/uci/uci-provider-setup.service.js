"use strict";

const { getProjectForUciAccess } = require("./uci-access.service.js");
const { listActiveProvidersForApi } = require("./uci-providers.service.js");
const { listCoordinationRecordsByProject } = require("./uci-records.service.js");

const PROVIDER_SETUP_METHOD = "human_assisted";

const TERRITORY_MATCHING_UNAVAILABLE_MESSAGE =
  "Verified automatic territory matching is not available. Select utility providers manually based on your project knowledge.";

/**
 * @param {unknown} value
 * @returns {string}
 */
function trimStr(value) {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * @param {Record<string, unknown>} project
 * @returns {boolean}
 */
function hasStructuredAddressParts(project) {
  return Boolean(
    trimStr(project.address) ||
      trimStr(project.city) ||
      trimStr(project.state) ||
      trimStr(project.zip_code) ||
      trimStr(project.jurisdiction),
  );
}

/**
 * @param {Record<string, unknown>} project
 */
function buildStructuredAddress(project) {
  const parts = {
    address: trimStr(project.address) || null,
    city: trimStr(project.city) || null,
    state: trimStr(project.state) || null,
    zip_code: trimStr(project.zip_code) || null,
    jurisdiction: trimStr(project.jurisdiction) || null,
  };
  const lineParts = [parts.address, parts.city, parts.state, parts.zip_code].filter(Boolean);
  return {
    source: "structured",
    parts,
    formatted: lineParts.length ? lineParts.join(", ") : null,
    complete: Boolean(parts.address && (parts.city || parts.state)),
    fallback_used: false,
  };
}

/**
 * Non-destructive read of portal_data.location only.
 * @param {Record<string, unknown>} project
 * @returns {string | null}
 */
function extractPortalDataLocation(project) {
  const portalData = project.portal_data;
  if (!portalData || typeof portalData !== "object" || Array.isArray(portalData)) {
    return null;
  }
  const location = trimStr(/** @type {{ location?: unknown }} */ (portalData).location);
  return location || null;
}

/**
 * Structured project fields first; portal_data.location only when structured fields are empty.
 * @param {Record<string, unknown> | null | undefined} project
 */
function resolveProjectAddressForProviderSetup(project) {
  if (!project) {
    return {
      source: "none",
      parts: null,
      formatted: null,
      complete: false,
      fallback_used: false,
    };
  }

  if (hasStructuredAddressParts(project)) {
    return buildStructuredAddress(project);
  }

  const portalLocation = extractPortalDataLocation(project);
  if (portalLocation) {
    return {
      source: "portal_data_location",
      parts: { location: portalLocation },
      formatted: portalLocation,
      complete: false,
      fallback_used: true,
      fallback_note:
        "Structured project address fields are empty; showing portal_data.location only (read-only fallback).",
    };
  }

  return {
    source: "none",
    parts: null,
    formatted: null,
    complete: false,
    fallback_used: false,
  };
}

/**
 * @param {unknown} input
 * @returns {string[]}
 */
function normalizeUnresolvedUtilityTypes(input) {
  if (!Array.isArray(input)) return [];
  return [
    ...new Set(
      input
        .map((entry) => String(entry ?? "").trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
}

/**
 * @param {object} params
 * @param {string} params.userId
 * @param {string} params.confirmedAt
 * @param {ReturnType<typeof resolveProjectAddressForProviderSetup>} params.address
 * @param {string[]} params.selectedProviderSlugs
 * @param {string[]} params.unresolvedUtilityTypes
 */
function buildHumanAssistedMappingMetadata(params) {
  const { userId, confirmedAt, address, selectedProviderSlugs, unresolvedUtilityTypes } = params;

  return {
    method: PROVIDER_SETUP_METHOD,
    confirmed_by_user_id: userId,
    confirmed_at: confirmedAt,
    address_source: address?.source ?? "none",
    address_snapshot: address
      ? {
          formatted: address.formatted,
          complete: address.complete,
          fallback_used: Boolean(address.fallback_used),
          parts: address.parts,
        }
      : null,
    selected_provider_slugs: selectedProviderSlugs,
    unresolved_utility_types: unresolvedUtilityTypes,
    territory_matching_available: false,
  };
}

/**
 * @param {unknown} body
 * @param {ReturnType<typeof resolveProjectAddressForProviderSetup>} address
 */
function parseProviderSetupConfirmation(body, address) {
  if (!body || typeof body !== "object") {
    const err = new Error("provider_setup must be an object when supplied");
    err.statusCode = 400;
    err.code = "INVALID_BODY";
    throw err;
  }

  const rec = /** @type {{ confirmed?: unknown, address_source_acknowledged?: unknown, unresolved_utility_types?: unknown }} */ (
    body
  );

  if (rec.confirmed !== true) {
    const err = new Error("provider_setup.confirmed must be true");
    err.statusCode = 400;
    err.code = "INVALID_BODY";
    throw err;
  }

  if (rec.address_source_acknowledged != null) {
    const acknowledged = String(rec.address_source_acknowledged).trim();
    const expected = address?.source ?? "none";
    if (acknowledged !== expected) {
      const err = new Error(
        `provider_setup.address_source_acknowledged must match resolved address source "${expected}"`,
      );
      err.statusCode = 400;
      err.code = "INVALID_BODY";
      throw err;
    }
  }

  return {
    unresolvedUtilityTypes: normalizeUnresolvedUtilityTypes(rec.unresolved_utility_types),
  };
}

/**
 * @param {object} params
 * @param {Record<string, unknown>} params.project
 * @param {Array<Record<string, unknown>>} params.providers
 * @param {Array<Record<string, unknown>>} params.existingRecords
 */
function buildProviderSetupContext(params) {
  const { project, providers, existingRecords } = params;
  const address = resolveProjectAddressForProviderSetup(project);

  const initializedSlugSet = new Set();
  for (const record of existingRecords) {
    const embedded = record.utility_providers;
    const slug = Array.isArray(embedded)
      ? embedded[0] && typeof embedded[0] === "object"
        ? String(/** @type {{ slug?: unknown }} */ (embedded[0]).slug ?? "").toLowerCase()
        : ""
      : embedded && typeof embedded === "object"
        ? String(/** @type {{ slug?: unknown }} */ (embedded).slug ?? "").toLowerCase()
        : "";
    if (slug) initializedSlugSet.add(slug);
  }

  const utilityTypes = [
    ...new Set(
      providers
        .map((provider) => String(provider.utility_type ?? "").trim().toLowerCase())
        .filter(Boolean),
    ),
  ];

  return {
    mapping_method: PROVIDER_SETUP_METHOD,
    territory_matching_available: false,
    territory_matching_message: TERRITORY_MATCHING_UNAVAILABLE_MESSAGE,
    address,
    guidance_steps: [
      "Review the project address shown below.",
      "Select utility providers manually — automatic territory matching is not verified.",
      "Note any utility types without a matching provider in the catalog.",
      "Confirm your selections before initializing coordination records.",
    ],
    providers: providers.map((provider) => ({
      id: provider.id,
      slug: provider.slug,
      name: provider.name,
      utility_type: provider.utility_type,
      automation_status: provider.automation_status,
      already_initialized: initializedSlugSet.has(String(provider.slug).toLowerCase()),
      suggested: false,
    })),
    utility_types_in_catalog: utilityTypes,
    auto_selection_enabled: false,
  };
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} params
 * @param {string} params.projectId
 * @param {string} params.userId
 */
async function getProviderSetupForProject(supabase, params) {
  const { projectId, userId } = params;
  const project = await getProjectForUciAccess({ supabase, userId, projectId });
  if (!project) {
    const err = new Error("Project not found");
    err.statusCode = 404;
    err.code = "PROJECT_NOT_FOUND";
    throw err;
  }

  const providers = await listActiveProvidersForApi(supabase);
  const existingRecords = await listCoordinationRecordsByProject(supabase, projectId);
  const setup = buildProviderSetupContext({
    project,
    providers,
    existingRecords,
  });

  return {
    project_id: projectId,
    ...setup,
  };
}

module.exports = {
  PROVIDER_SETUP_METHOD,
  TERRITORY_MATCHING_UNAVAILABLE_MESSAGE,
  resolveProjectAddressForProviderSetup,
  buildHumanAssistedMappingMetadata,
  parseProviderSetupConfirmation,
  buildProviderSetupContext,
  getProviderSetupForProject,
  normalizeUnresolvedUtilityTypes,
};
