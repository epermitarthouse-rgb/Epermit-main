"use strict";

const MANUAL_DOCUMENT_SCOPE_KEY = "__manual__";

/**
 * @param {string} coordinationRecordId
 * @returns {string}
 */
function buildCoordinationScopeKey(coordinationRecordId) {
  return `coordination:${String(coordinationRecordId ?? "").trim()}`;
}

/**
 * Resolve metadata scope for load extraction / document processing.
 *
 * @param {{ externalApplicationId?: string | null, coordinationRecordId?: string | null }} params
 * @returns {{ scopeKey: string, externalApplicationId: string | null, portalScoped: boolean }}
 */
function resolveLoadExtractionScope(params) {
  const extAppId = String(params.externalApplicationId ?? "").trim();
  const coordinationRecordId = String(params.coordinationRecordId ?? "").trim();
  if (extAppId) {
    return {
      scopeKey: extAppId,
      externalApplicationId: extAppId,
      portalScoped: true,
    };
  }
  if (coordinationRecordId) {
    return {
      scopeKey: buildCoordinationScopeKey(coordinationRecordId),
      externalApplicationId: null,
      portalScoped: false,
    };
  }
  return {
    scopeKey: MANUAL_DOCUMENT_SCOPE_KEY,
    externalApplicationId: null,
    portalScoped: false,
  };
}

/**
 * @param {{ externalApplicationId?: string | null, coordinationRecordId?: string | null }} params
 * @returns {string}
 */
function resolveDocumentProcessingScopeKey(params) {
  return resolveLoadExtractionScope(params).scopeKey;
}

/**
 * @param {unknown} providerSlug
 */
function isPortalSyncedProvider(providerSlug) {
  return String(providerSlug ?? "").trim().toLowerCase() === "pepco";
}

/**
 * Portal application is optional for project/manual document extraction.
 *
 * @param {{ providerSlug?: string | null, externalApplicationId?: string | null, hasAnalyzedLoadProfile?: boolean }} params
 * @returns {{ eligible: boolean, disabledReason: string | null }}
 */
function getLoadExtractionEligibility(params) {
  if (!params.hasAnalyzedLoadProfile) {
    return {
      eligible: false,
      disabledReason: "Run load profile analysis before extracting candidates",
    };
  }
  if (
    isPortalSyncedProvider(params.providerSlug) &&
    !String(params.externalApplicationId ?? "").trim()
  ) {
    return {
      eligible: true,
      disabledReason:
        "No portal application selected — extraction uses project and manual-upload documents only",
    };
  }
  return { eligible: true, disabledReason: null };
}

module.exports = {
  MANUAL_DOCUMENT_SCOPE_KEY,
  buildCoordinationScopeKey,
  resolveLoadExtractionScope,
  resolveDocumentProcessingScopeKey,
  isPortalSyncedProvider,
  getLoadExtractionEligibility,
};
