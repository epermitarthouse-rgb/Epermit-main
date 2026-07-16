"use strict";

const {
  normalizePortalDataObject,
  mergePermitPilotMetaIntoPortalData,
  PERMITPILOT_META_KEY,
} = require("../project-address.service.js");
const {
  PROVIDER_RESOLUTION_VERSION,
  PERMITPILOT_RESOLUTION_KEY,
  normalizeServiceType,
} = require("./uci-provider-resolution-contract.js");

/**
 * @param {Record<string, unknown> | null | undefined} project
 * @returns {Record<string, unknown> | null}
 */
function readProviderResolutionStore(project) {
  const portalData = normalizePortalDataObject(project?.portal_data);
  const meta = portalData?.[PERMITPILOT_META_KEY];
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return null;
  const store = /** @type {Record<string, unknown>} */ (meta)[PERMITPILOT_RESOLUTION_KEY];
  if (!store || typeof store !== "object" || Array.isArray(store)) return null;
  return /** @type {Record<string, unknown>} */ (store);
}

/**
 * @param {Record<string, unknown> | null | undefined} project
 * @param {string} serviceType
 * @returns {Record<string, unknown> | null}
 */
function readProviderResolutionForServiceType(project, serviceType) {
  const store = readProviderResolutionStore(project);
  if (!store) return null;
  const byServiceType = store.by_service_type;
  if (!byServiceType || typeof byServiceType !== "object" || Array.isArray(byServiceType)) {
    return null;
  }
  const entry = /** @type {Record<string, unknown>} */ (byServiceType)[normalizeServiceType(serviceType)];
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
  return /** @type {Record<string, unknown>} */ (entry);
}

/**
 * @param {Record<string, unknown> | null | undefined} project
 * @param {string} serviceType
 * @param {Record<string, unknown>} resolutionEntry
 * @returns {Record<string, unknown>}
 */
function buildNextPortalDataWithResolution(project, serviceType, resolutionEntry) {
  const portalData = normalizePortalDataObject(project?.portal_data) ?? {};
  const existingStore = readProviderResolutionStore(project) ?? {
    resolver_version: PROVIDER_RESOLUTION_VERSION,
    by_service_type: {},
  };
  const byServiceType =
    existingStore.by_service_type &&
    typeof existingStore.by_service_type === "object" &&
    !Array.isArray(existingStore.by_service_type)
      ? { .../** @type {Record<string, unknown>} */ (existingStore.by_service_type) }
      : {};

  byServiceType[normalizeServiceType(serviceType)] = resolutionEntry;

  const nextStore = {
    ...existingStore,
    resolver_version: PROVIDER_RESOLUTION_VERSION,
    updated_at: new Date().toISOString(),
    by_service_type: byServiceType,
  };

  return mergePermitPilotMetaIntoPortalData(portalData, {
    [PERMITPILOT_RESOLUTION_KEY]: nextStore,
  });
}

/**
 * @param {Record<string, unknown> | null | undefined} metadata
 * @returns {Record<string, unknown> | null}
 */
function extractProviderResolutionFromCoordinationMetadata(metadata) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const resolution = /** @type {Record<string, unknown>} */ (metadata).uci_provider_resolution;
  if (!resolution || typeof resolution !== "object" || Array.isArray(resolution)) return null;
  return /** @type {Record<string, unknown>} */ (resolution);
}

/**
 * @param {Record<string, unknown>} existingMetadata
 * @param {Record<string, unknown>} resolutionSnapshot
 * @returns {Record<string, unknown>}
 */
function mergeProviderResolutionIntoCoordinationMetadata(existingMetadata, resolutionSnapshot) {
  const base =
    existingMetadata && typeof existingMetadata === "object" && !Array.isArray(existingMetadata)
      ? { ...existingMetadata }
      : {};
  return {
    ...base,
    uci_provider_resolution: {
      ...(extractProviderResolutionFromCoordinationMetadata(base) ?? {}),
      ...resolutionSnapshot,
    },
  };
}

module.exports = {
  readProviderResolutionStore,
  readProviderResolutionForServiceType,
  buildNextPortalDataWithResolution,
  extractProviderResolutionFromCoordinationMetadata,
  mergeProviderResolutionIntoCoordinationMetadata,
};
