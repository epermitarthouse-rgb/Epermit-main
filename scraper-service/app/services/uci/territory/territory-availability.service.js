"use strict";

const { TERRITORY_SCHEMA_VERSION } = require("./territory-sources.js");
const { normalizeUsStateCode } = require("./territory-geo.utils.js");
const {
  listManifestStateCodes,
  getManifestStateEntry,
  manifestHasState,
  normalizeTerritoryManifest,
} = require("./territory-manifest.service.js");
const { getTerritoryStorageConfig, shouldUseTerritoryStorage } = require("./territory-storage-config.service.js");

/**
 * @typedef {"OK"|"MANIFEST_MISSING"|"MANIFEST_INVALID"|"MANIFEST_FETCH_FAILED"|"MANIFEST_PARSE_FAILED"|"INVALID_MANIFEST_SCHEMA"|"NO_STATES"|"STATE_CODE_MISSING"|"STATE_NOT_IN_MANIFEST"|"STATE_ARTIFACT_NOT_DECLARED"|"LOCAL_STATE_FILE_MISSING"} TerritoryAvailabilityCode
 */

/**
 * @param {Record<string, unknown> | null | undefined} manifest
 */
function validateTerritoryManifest(manifest) {
  const normalized = normalizeTerritoryManifest(manifest);
  if (!normalized) {
    return { ok: false, code: /** @type {TerritoryAvailabilityCode} */ ("MANIFEST_MISSING"), manifest: null };
  }
  if (normalized.schema_version !== TERRITORY_SCHEMA_VERSION) {
    return {
      ok: false,
      code: /** @type {TerritoryAvailabilityCode} */ ("INVALID_MANIFEST_SCHEMA"),
      manifest: normalized,
    };
  }
  const states = listManifestStateCodes(normalized);
  if (states.length === 0) {
    return {
      ok: false,
      code: /** @type {TerritoryAvailabilityCode} */ ("NO_STATES"),
      manifest: normalized,
    };
  }
  return { ok: true, code: /** @type {TerritoryAvailabilityCode} */ ("OK"), manifest: normalized };
}

/**
 * @param {string | null | undefined} stateCode
 * @param {Record<string, unknown> | null | undefined} manifest
 * @param {{ storageEnabled?: boolean, allowLocalFallback?: boolean, localStateExists?: (state: string) => boolean }} [options]
 */
function evaluateTerritoryStateAvailability(stateCode, manifest, options = {}) {
  const manifestValidation = validateTerritoryManifest(manifest);
  if (!manifestValidation.ok || !manifestValidation.manifest) {
    return {
      available: false,
      code: manifestValidation.code,
      manifest: manifestValidation.manifest,
      stateCode: null,
      artifactFile: null,
    };
  }

  const normalizedManifest = manifestValidation.manifest;
  const requestedState = normalizeUsStateCode(stateCode);
  if (!requestedState) {
    return {
      available: false,
      code: /** @type {TerritoryAvailabilityCode} */ ("STATE_CODE_MISSING"),
      manifest: normalizedManifest,
      stateCode: null,
      artifactFile: null,
    };
  }

  const stateEntry = getManifestStateEntry(normalizedManifest, requestedState);
  if (!stateEntry) {
    return {
      available: false,
      code: /** @type {TerritoryAvailabilityCode} */ ("STATE_NOT_IN_MANIFEST"),
      manifest: normalizedManifest,
      stateCode: requestedState,
      artifactFile: null,
    };
  }

  const artifactFile = String(stateEntry.file ?? `territories_${requestedState}.geojson`);
  if (!artifactFile.trim()) {
    return {
      available: false,
      code: /** @type {TerritoryAvailabilityCode} */ ("STATE_ARTIFACT_NOT_DECLARED"),
      manifest: normalizedManifest,
      stateCode: requestedState,
      artifactFile: null,
    };
  }

  const storageEnabled = options.storageEnabled ?? false;
  if (storageEnabled) {
    return {
      available: true,
      code: /** @type {TerritoryAvailabilityCode} */ ("OK"),
      manifest: normalizedManifest,
      stateCode: requestedState,
      artifactFile,
    };
  }

  const localExists = options.localStateExists?.(requestedState) ?? false;
  if (!localExists && !options.allowLocalFallback) {
    return {
      available: false,
      code: /** @type {TerritoryAvailabilityCode} */ ("LOCAL_STATE_FILE_MISSING"),
      manifest: normalizedManifest,
      stateCode: requestedState,
      artifactFile,
    };
  }
  if (!localExists) {
    return {
      available: false,
      code: /** @type {TerritoryAvailabilityCode} */ ("LOCAL_STATE_FILE_MISSING"),
      manifest: normalizedManifest,
      stateCode: requestedState,
      artifactFile,
    };
  }

  return {
    available: true,
    code: /** @type {TerritoryAvailabilityCode} */ ("OK"),
    manifest: normalizedManifest,
    stateCode: requestedState,
    artifactFile,
  };
}

/**
 * @param {Record<string, unknown> | null | undefined} manifest
 * @param {string | null | undefined} [stateCode]
 * @param {{ supabase?: import("@supabase/supabase-js").SupabaseClient | null, localStateExists?: (state: string) => boolean }} [ctx]
 */
function checkTerritoryAvailability(manifest, stateCode = null, ctx = {}) {
  const config = getTerritoryStorageConfig();
  const storageEnabled = shouldUseTerritoryStorage(ctx.supabase ?? null);

  if (stateCode == null) {
    const validation = validateTerritoryManifest(manifest);
    return {
      available: validation.ok,
      code: validation.code,
      manifest: validation.manifest,
      stateCode: null,
      artifactFile: null,
    };
  }

  return evaluateTerritoryStateAvailability(stateCode, manifest, {
    storageEnabled,
    allowLocalFallback: config.allowLocalFallback,
    localStateExists: ctx.localStateExists,
  });
}

module.exports = {
  validateTerritoryManifest,
  evaluateTerritoryStateAvailability,
  checkTerritoryAvailability,
  manifestHasState,
  listManifestStateCodes,
  getManifestStateEntry,
  normalizeTerritoryManifest,
};
