"use strict";

const { getProjectForUciAccess, getProjectTenantId } = require("./uci-access.service.js");
const { listActiveProvidersForTenant } = require("./uci-providers-tenant.service.js");
const { listCoordinationRecordsByProject } = require("./uci-records.service.js");
const {
  UCI_SUPPORTED_UTILITY_TYPES,
  requireSupportedUtilityType,
} = require("./uci-utility-types.js");
const {
  trimStr,
  normalizeComparableAddress,
  normalizePortalDataObject,
  extractPortalDataLocation,
  buildStructuredAddressParts,
  formatAddressParts,
  resolveAndNormalizeProjectAddress,
  toLegacyUciAddressSource,
} = require("../project-address.service.js");

const PROVIDER_SETUP_METHOD = "human_assisted";

const TERRITORY_MATCHING_UNAVAILABLE_MESSAGE =
  "Verified automatic territory matching is not available. Select utility providers manually based on your project knowledge.";

const ADDRESS_MISMATCH_WARNING =
  "Structured project address differs from the latest scraped portal location. Select which address you are confirming before initializing.";

const UTILITY_ADDRESS_MISMATCH_WARNING =
  "Canonical project address differs from the selected utility application property address. Review the address before submission.";

/**
 * @param {Record<string, unknown>} project
 * @returns {boolean}
 */
function hasStructuredStreetAddress(project) {
  return Boolean(trimStr(project.address));
}

/**
 * @param {Record<string, unknown>} project
 * @returns {boolean}
 */
function hasStructuredAddressParts(project) {
  const parts = buildStructuredAddressParts(project);
  return Boolean(
    parts.address || parts.city || parts.state || parts.zip_code || parts.jurisdiction,
  );
}

/**
 * @param {Record<string, unknown>} project
 */
function buildStructuredAddress(project) {
  const parts = buildStructuredAddressParts(project);
  const formatted = formatAddressParts(parts);
  return {
    source: "structured",
    parts,
    formatted,
    complete: Boolean(parts.address && (parts.city || parts.state)),
    fallback_used: false,
  };
}

/**
 * @param {string} location
 */
function buildPortalDataLocationAddress(location) {
  return {
    source: "portal_data_location",
    parts: { location },
    formatted: location,
    complete: false,
    fallback_used: true,
    fallback_note:
      "Structured project street address is empty; using portal_data.location (read-only scraped value).",
  };
}

/**
 * Deterministic address context for provider setup (no parsing heuristics).
 * @param {Record<string, unknown> | null | undefined} project
 * @param {object} [options]
 * @param {Record<string, unknown> | null | undefined} [options.coordinationRecord]
 * @param {string | null | undefined} [options.externalApplicationId]
 * @param {string | null | undefined} [options.utilityApplicationAddress]
 */
function buildProviderSetupAddressContext(project, options = {}) {
  if (!project) {
    const none = {
      source: "none",
      parts: null,
      formatted: null,
      complete: false,
      fallback_used: false,
    };
    return {
      structured: none,
      scraped_location: null,
      utility_portal_location: null,
      address_mismatch: false,
      mismatch_warning: null,
      available_address_sources: ["none"],
      recommended_address_source: "none",
      address: none,
      canonical_source: "none",
    };
  }

  const resolution = resolveAndNormalizeProjectAddress({
    project,
    coordinationRecord: options.coordinationRecord,
    externalApplicationId: options.externalApplicationId,
    utilityApplicationAddress: options.utilityApplicationAddress,
  });

  const structured = hasStructuredAddressParts(project)
    ? buildStructuredAddress(project)
    : {
        source: "structured",
        parts: null,
        formatted: null,
        complete: false,
        fallback_used: false,
      };

  const portalLocation = extractPortalDataLocation(project);
  const scraped_location = portalLocation
    ? {
        formatted: portalLocation,
        source: "portal_data_location",
      }
    : null;

  const utility_portal_location = resolution.utility_portal_location
    ? {
        formatted: resolution.utility_portal_location,
        source: "utility_portal",
      }
    : null;

  const available_address_sources = [
    ...new Set(
      resolution.available_sources
        .map((source) => toLegacyUciAddressSource(source))
        .filter((source) => source !== "none" || resolution.available_sources.includes("none")),
    ),
  ];
  if (available_address_sources.length === 0) {
    available_address_sources.push("none");
  }

  let recommended_address_source = toLegacyUciAddressSource(resolution.address_source);
  if (!available_address_sources.includes(recommended_address_source)) {
    recommended_address_source = available_address_sources[0] ?? "none";
  }

  const hasStreet = hasStructuredStreetAddress(project);
  const mismatch = Boolean(
    hasStreet &&
      portalLocation &&
      normalizeComparableAddress(structured.formatted) !==
        normalizeComparableAddress(portalLocation),
  );
  const utilityMismatch = Boolean(
    resolution.address_mismatch &&
      resolution.mismatch_reasons.includes("canonical_vs_utility_portal"),
  );

  return {
    structured,
    scraped_location,
    utility_portal_location,
    address_mismatch: mismatch || utilityMismatch || resolution.address_mismatch,
    mismatch_warning: utilityMismatch
      ? UTILITY_ADDRESS_MISMATCH_WARNING
      : mismatch
        ? ADDRESS_MISMATCH_WARNING
        : resolution.mismatch_warning,
    available_address_sources,
    recommended_address_source,
    address: {
      ...resolution.address,
      source: toLegacyUciAddressSource(resolution.address.source),
    },
    canonical_source: resolution.address_source,
    address_selection_reason: resolution.address.selection_reason,
  };
}

/**
 * @param {{ structured: Record<string, unknown>, scraped_location: { formatted: string } | null, utility_portal_location?: { formatted: string } | null }} addressContext
 * @param {"structured" | "portal_data_location" | "utility_portal" | "none"} acknowledgedSource
 */
function resolveAddressFromAcknowledgedSource(addressContext, acknowledgedSource) {
  if (acknowledgedSource === "structured") {
    return addressContext.structured;
  }
  if (acknowledgedSource === "portal_data_location") {
    const scraped = addressContext.scraped_location;
    if (!scraped?.formatted) {
      const err = new Error("portal_data.location is not available for this project");
      err.statusCode = 400;
      err.code = "INVALID_BODY";
      throw err;
    }
    return buildPortalDataLocationAddress(scraped.formatted);
  }
  if (acknowledgedSource === "utility_portal") {
    const utility = addressContext.utility_portal_location;
    if (!utility?.formatted) {
      const err = new Error("Selected utility application address is not available");
      err.statusCode = 400;
      err.code = "INVALID_BODY";
      throw err;
    }
    return {
      source: "utility_portal",
      parts: { address: utility.formatted },
      formatted: utility.formatted,
      complete: false,
      fallback_used: true,
      selection_reason: "Acknowledged utility portal property address",
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
 * Legacy helper for load profile / application builder — uses recommended source only.
 * @param {Record<string, unknown> | null | undefined} project
 * @param {object} [options]
 */
function resolveProjectAddressForProviderSetup(project, options = {}) {
  return buildProviderSetupAddressContext(project, options).address;
}

/**
 * @param {Record<string, unknown> | null | undefined} record
 * @returns {Record<string, unknown> | null}
 */
function extractProviderMappingFromCoordinationRecord(record) {
  if (!record?.metadata || typeof record.metadata !== "object" || Array.isArray(record.metadata)) {
    return null;
  }
  const mapping = /** @type {{ uci_provider_mapping?: unknown }} */ (record.metadata).uci_provider_mapping;
  if (!mapping || typeof mapping !== "object" || Array.isArray(mapping)) {
    return null;
  }
  return /** @type {Record<string, unknown>} */ (mapping);
}

/**
 * Canonical address resolution for D3 application packages and D4 submission.
 *
 * @param {Record<string, unknown> | null | undefined} project
 * @param {Record<string, unknown> | null | undefined} coordinationRecord
 * @param {object} [options]
 * @param {string | null | undefined} [options.externalApplicationId]
 * @param {string | null | undefined} [options.utilityApplicationAddress]
 */
function resolveApplicationPackageAddress(project, coordinationRecord, options = {}) {
  const resolution = resolveAndNormalizeProjectAddress({
    project,
    coordinationRecord,
    externalApplicationId: options.externalApplicationId,
    utilityApplicationAddress: options.utilityApplicationAddress,
  });
  const addressContext = buildProviderSetupAddressContext(project, {
    coordinationRecord,
    externalApplicationId: options.externalApplicationId,
    utilityApplicationAddress: options.utilityApplicationAddress,
  });
  const mapping = extractProviderMappingFromCoordinationRecord(coordinationRecord);
  const acknowledgedRaw = mapping ? trimStr(mapping.address_source_acknowledged) : "";
  const acknowledged =
    acknowledgedRaw && addressContext.available_address_sources.includes(acknowledgedRaw)
      ? acknowledgedRaw
      : null;

  const canonicalAddress = resolution.address;
  let address;
  if (acknowledged) {
    try {
      address = resolveAddressFromAcknowledgedSource(
        {
          structured: addressContext.structured,
          scraped_location: addressContext.scraped_location,
          utility_portal_location: addressContext.utility_portal_location,
        },
        /** @type {"structured" | "portal_data_location" | "utility_portal" | "none"} */ (acknowledged),
      );
    } catch {
      address = canonicalAddress;
    }
  } else {
    address = canonicalAddress;
  }

  return {
    address: {
      ...address,
      source: toLegacyUciAddressSource(address.source),
    },
    addressContext,
    address_source: toLegacyUciAddressSource(address.source),
    canonical_address_source: canonicalAddress.source,
    address_source_acknowledged: acknowledged,
    address_mismatch: addressContext.address_mismatch,
    mismatch_warning: addressContext.mismatch_warning,
    address_review_required: Boolean(addressContext.address_mismatch && !acknowledged),
    address_selection_reason: canonicalAddress.selection_reason,
    utility_portal_location: addressContext.utility_portal_location,
  };
}

/**
 * Prefer the address snapshot stored on the application package at build time.
 *
 * @param {Record<string, unknown> | null | undefined} application
 * @param {Record<string, unknown> | null | undefined} project
 * @param {Record<string, unknown> | null | undefined} [coordinationRecord]
 */
function resolveAddressFromApplicationPackageSnapshot(application, project, coordinationRecord) {
  const metadata =
    application?.agent_draft_metadata &&
    typeof application.agent_draft_metadata === "object" &&
    !Array.isArray(application.agent_draft_metadata)
      ? /** @type {Record<string, unknown>} */ (application.agent_draft_metadata)
      : null;
  const pkg =
    metadata?.application_package &&
    typeof metadata.application_package === "object" &&
    !Array.isArray(metadata.application_package)
      ? /** @type {Record<string, unknown>} */ (metadata.application_package)
      : null;
  const snapshot =
    pkg?.project_address &&
    typeof pkg.project_address === "object" &&
    !Array.isArray(pkg.project_address)
      ? /** @type {Record<string, unknown>} */ (pkg.project_address)
      : null;
  const formatted = snapshot ? trimStr(snapshot.formatted) : "";
  if (formatted) {
    return {
      source:
        snapshot.source != null
          ? String(snapshot.source)
          : /** @type {"structured" | "portal_data_location" | "none"} */ ("structured"),
      parts:
        snapshot.parts && typeof snapshot.parts === "object" && !Array.isArray(snapshot.parts)
          ? snapshot.parts
          : null,
      formatted,
      complete: Boolean(snapshot.complete),
      fallback_used: Boolean(snapshot.fallback_used),
    };
  }

  return resolveApplicationPackageAddress(project, coordinationRecord).address;
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
        .filter((entry) => String(entry ?? "").trim())
        .map((entry) => requireSupportedUtilityType(entry, "unresolved_utility_types entry")),
    ),
  ];
}

/**
 * @param {object} params
 * @param {string} params.userId
 * @param {string} params.confirmedAt
 * @param {ReturnType<typeof resolveAddressFromAcknowledgedSource>} params.address
 * @param {string[]} params.selectedProviderSlugs
 * @param {string[]} params.unresolvedUtilityTypes
 * @param {string} params.addressSourceAcknowledged
 * @param {boolean} [params.addressMismatch]
 */
function buildHumanAssistedMappingMetadata(params) {
  const {
    userId,
    confirmedAt,
    address,
    selectedProviderSlugs,
    unresolvedUtilityTypes,
    addressSourceAcknowledged,
    addressMismatch = false,
  } = params;

  return {
    method: PROVIDER_SETUP_METHOD,
    confirmed: true,
    confirmed_by_user_id: userId,
    confirmed_at: confirmedAt,
    address_source: address?.source ?? "none",
    address_source_acknowledged: addressSourceAcknowledged,
    address_mismatch: addressMismatch,
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
 * @param {ReturnType<typeof buildProviderSetupAddressContext>} addressContext
 */
function parseProviderSetupConfirmation(body, addressContext) {
  if (!body || typeof body !== "object") {
    const err = new Error("provider_setup is required");
    err.statusCode = 400;
    err.code = "PROVIDER_SETUP_REQUIRED";
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

  const acknowledged = trimStr(rec.address_source_acknowledged);
  if (!acknowledged) {
    const err = new Error("provider_setup.address_source_acknowledged is required");
    err.statusCode = 400;
    err.code = "INVALID_BODY";
    throw err;
  }

  if (!addressContext.available_address_sources.includes(acknowledged)) {
    const err = new Error(
      `provider_setup.address_source_acknowledged must be one of: ${addressContext.available_address_sources.join(", ")}`,
    );
    err.statusCode = 400;
    err.code = "INVALID_BODY";
    throw err;
  }

  const address = resolveAddressFromAcknowledgedSource(
    addressContext,
    /** @type {"structured" | "portal_data_location" | "utility_portal" | "none"} */ (acknowledged),
  );

  return {
    address,
    addressSourceAcknowledged: acknowledged,
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
  const addressContext = buildProviderSetupAddressContext(project);

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

  const utilityTypes = [...UCI_SUPPORTED_UTILITY_TYPES];

  return {
    mapping_method: PROVIDER_SETUP_METHOD,
    territory_matching_available: false,
    territory_matching_message: TERRITORY_MATCHING_UNAVAILABLE_MESSAGE,
    ...addressContext,
    guidance_steps: [
      "Review the project address shown below.",
      "If structured and scraped addresses differ, select which address you are confirming.",
      "Select utility providers manually — automatic territory matching is not verified.",
      "Note any utility types without a matching provider in the catalog.",
      "Confirm your selections before initializing coordination records.",
    ],
    providers: providers.map((provider) => ({
      id: provider.id,
      slug: provider.slug,
      name: provider.display_name ?? provider.name,
      display_name: provider.display_name ?? provider.name,
      canonical_name: provider.canonical_name ?? null,
      utility_type: provider.utility_type,
      ownership_type: provider.ownership_type ?? null,
      cet_relationship: Boolean(provider.cet_relationship),
      portal_key: provider.portal_key ?? provider.slug,
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

  const tenantRow = await getProjectTenantId(supabase, projectId);
  const providers = await listActiveProvidersForTenant(
    supabase,
    tenantRow?.tenant_id ? String(tenantRow.tenant_id) : null,
  );
  const existingRecords = await listCoordinationRecordsByProject(supabase, projectId);
  const setup = buildProviderSetupContext({
    project,
    providers,
    existingRecords,
  });

  return {
    project_id: projectId,
    tenant_id: tenantRow?.tenant_id ?? null,
    ...setup,
  };
}

module.exports = {
  PROVIDER_SETUP_METHOD,
  TERRITORY_MATCHING_UNAVAILABLE_MESSAGE,
  ADDRESS_MISMATCH_WARNING,
  UTILITY_ADDRESS_MISMATCH_WARNING,
  hasStructuredStreetAddress,
  hasStructuredAddressParts,
  normalizePortalDataObject,
  buildProviderSetupAddressContext,
  resolveAddressFromAcknowledgedSource,
  resolveProjectAddressForProviderSetup,
  extractProviderMappingFromCoordinationRecord,
  resolveApplicationPackageAddress,
  resolveAddressFromApplicationPackageSnapshot,
  buildHumanAssistedMappingMetadata,
  parseProviderSetupConfirmation,
  buildProviderSetupContext,
  getProviderSetupForProject,
  normalizeUnresolvedUtilityTypes,
};
