"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { TERRITORY_SCHEMA_VERSION } = require("./territory-sources.js");
const { normalizeUsStateCode, normalizeCountyLookupName } = require("./territory-geo.utils.js");
const {
  manifestHasState,
  listManifestStateCodes,
  getManifestStateEntry,
  normalizeTerritoryManifest,
} = require("./territory-manifest.service.js");
const { checkTerritoryAvailability } = require("./territory-availability.service.js");
const { DEFAULT_TERRITORY_DATA_DIR, getTerritoryStorageConfig, shouldUseTerritoryStorage } = require("./territory-storage-config.service.js");
const {
  configureTerritoryStorageClient,
  fetchRemoteManifest,
  fetchRemoteStateGeoJson,
  fetchRemoteCountyUtilityStore,
  probeTerritoryStorageHealth,
  clearTerritoryStorageRuntimeState,
  logTerritoryStorage,
} = require("./territory-storage-client.service.js");
const {
  buildManifestLoadResult,
  logTerritoryManifestLoad,
  normalizeManifestLoadFailureCode,
} = require("./territory-manifest-loader.service.js");

const DEFAULT_DATA_DIR = DEFAULT_TERRITORY_DATA_DIR;

/** @type {{ supabase: import("@supabase/supabase-js").SupabaseClient | null }} */
let loaderContext = { supabase: null };

/** @type {Map<string, { loadedAt: number, geojson: Record<string, unknown>, manifest: Record<string, unknown>, checksum?: string | null }>} */
const stateCache = new Map();

/**
 * @param {{ supabase?: import("@supabase/supabase-js").SupabaseClient | null }} ctx
 */
function configureTerritoryDatasetLoader(ctx = {}) {
  if (Object.prototype.hasOwnProperty.call(ctx, "supabase")) {
    loaderContext.supabase = ctx.supabase ?? null;
    configureTerritoryStorageClient({ supabase: ctx.supabase ?? null });
  }
}

/**
 * @returns {string}
 */
function resolveTerritoryDataDir() {
  return getTerritoryStorageConfig().localDataDir;
}

/**
 * @param {string} filePath
 */
function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

/**
 * @param {string} dataDir
 */
function readLocalManifest(dataDir = resolveTerritoryDataDir()) {
  const manifestPath = path.join(dataDir, "manifest.json");
  if (!fs.existsSync(manifestPath)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    if (!raw || typeof raw !== "object") return null;
    return /** @type {Record<string, unknown>} */ (raw);
  } catch {
    return null;
  }
}

/**
 * @param {Record<string, unknown> | null} manifest
 * @param {string} stateCode
 */
function manifestHasStateEntry(manifest, stateCode) {
  return manifestHasState(manifest, stateCode);
}

/**
 * @param {string} stateCode
 */
function localStateGeoJsonExists(stateCode) {
  const normalized = normalizeUsStateCode(stateCode);
  const filePath = path.join(resolveTerritoryDataDir(), `territories_${normalized}.geojson`);
  return fs.existsSync(filePath);
}

/**
 * @param {string} stateCode
 * @param {object} [options]
 * @param {boolean} [options.forceReload]
 */
function loadLocalStateTerritoryGeoJson(stateCode, options = {}) {
  const normalized = normalizeUsStateCode(stateCode);
  if (!normalized) {
    return { ok: false, code: "INVALID_STATE", geojson: null, manifest: null, source: "local" };
  }

  const dataDir = resolveTerritoryDataDir();
  const manifest = readLocalManifest(dataDir);
  if (!manifest) {
    return { ok: false, code: "MANIFEST_MISSING", geojson: null, manifest: null, source: "local" };
  }

  if (!manifestHasStateEntry(manifest, normalized)) {
    return { ok: false, code: "STATE_NOT_INGESTED", geojson: null, manifest, source: "local" };
  }

  const cacheKey = `local:${manifest.dataset_version ?? "unknown"}:${normalized}`;
  if (!options.forceReload && stateCache.has(cacheKey)) {
    const cached = stateCache.get(cacheKey);
    return {
      ok: true,
      code: "CACHE_HIT",
      geojson: cached.geojson,
      manifest,
      fromCache: true,
      source: "local",
    };
  }

  const filePath = path.join(dataDir, `territories_${normalized}.geojson`);
  if (!fs.existsSync(filePath)) {
    return { ok: false, code: "GEOJSON_MISSING", geojson: null, manifest, source: "local" };
  }

  let geojson;
  try {
    geojson = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (err) {
    return {
      ok: false,
      code: "GEOJSON_PARSE_FAILED",
      geojson: null,
      manifest,
      source: "local",
      error: err instanceof Error ? err.message : String(err),
    };
  }

  const expectedChecksum =
    manifest.states &&
    typeof manifest.states === "object" &&
    !Array.isArray(manifest.states) &&
    /** @type {Record<string, { checksum_sha256?: string }>} */ (manifest.states)[normalized]
      ?.checksum_sha256;

  if (expectedChecksum) {
    const actual = sha256File(filePath);
    if (actual !== expectedChecksum) {
      return {
        ok: false,
        code: "CHECKSUM_MISMATCH",
        geojson: null,
        manifest,
        expectedChecksum,
        actualChecksum: actual,
        source: "local",
      };
    }
  }

  stateCache.set(cacheKey, { loadedAt: Date.now(), geojson, manifest, checksum: expectedChecksum ?? null });
  return { ok: true, code: "LOADED", geojson, manifest, fromCache: false, source: "local" };
}

/**
 * @param {string | null | undefined} [dataDir]
 */
async function loadTerritoryManifest(dataDir = null) {
  if (shouldUseTerritoryStorage(loaderContext.supabase)) {
    const result = await fetchRemoteManifest(loaderContext.supabase);
    logTerritoryManifestLoad({
      phase: "remote_result",
      ok: result.ok,
      code: result.code,
      dataset_version: result.datasetVersion ?? null,
      manifest_truthy: Boolean(result.manifest),
      manifest_state_count: result.manifest ? listManifestStateCodes(result.manifest).length : 0,
      reason: result.reason ?? null,
      error: result.error ?? null,
    });

    if (result.ok && result.manifest) {
      return buildManifestLoadResult(true, result.code === "CACHE_HIT" ? "CACHE_HIT" : "LOADED", result.manifest, result.datasetVersion);
    }

    const config = getTerritoryStorageConfig();
    if (config.allowLocalFallback) {
      logTerritoryStorage("fallback_local_manifest", { reason: result.code });
      const localManifest = normalizeTerritoryManifest(readLocalManifest(dataDir ?? resolveTerritoryDataDir()));
      if (localManifest) {
        return buildManifestLoadResult(true, "LOADED", localManifest, localManifest.dataset_version ?? null, {
          source: "local",
        });
      }
      return buildManifestLoadResult(false, "MANIFEST_MISSING", null, null, { source: "local" });
    }

    return buildManifestLoadResult(
      false,
      normalizeManifestLoadFailureCode(result.code),
      null,
      result.datasetVersion ?? null,
      { reason: result.reason ?? null, error: result.error ?? null, source: "storage" },
    );
  }

  const localManifest = normalizeTerritoryManifest(readLocalManifest(dataDir ?? resolveTerritoryDataDir()));
  if (!localManifest) {
    return buildManifestLoadResult(false, "MANIFEST_MISSING", null, null, { source: "local" });
  }
  return buildManifestLoadResult(true, "LOADED", localManifest, localManifest.dataset_version ?? null, {
    source: "local",
  });
}

/**
 * @param {string | null | undefined} [dataDir]
 */
async function readManifest(dataDir = null) {
  const result = await loadTerritoryManifest(dataDir);
  return result.ok && result.manifest ? result.manifest : null;
}

/**
 * @param {string} serviceType
 * @param {string | null | undefined} [stateCode]
 */
async function checkElectricTerritoryAvailability(serviceType, stateCode = null) {
  if (String(serviceType ?? "").trim().toLowerCase() !== "electric") {
    return {
      available: false,
      code: "INVALID_SERVICE_TYPE",
      manifest: null,
      stateCode: null,
      artifactFile: null,
    };
  }

  const manifestResult = await loadTerritoryManifest();
  logTerritoryManifestLoad({
    phase: "availability_input",
    ok: manifestResult.ok,
    code: manifestResult.code,
    manifest_truthy: Boolean(manifestResult.manifest),
    manifest_state_count: manifestResult.manifest ? listManifestStateCodes(manifestResult.manifest).length : 0,
    requested_state: stateCode ?? null,
  });

  if (!manifestResult.ok || !manifestResult.manifest) {
    return {
      available: false,
      code: manifestResult.code ?? "MANIFEST_MISSING",
      manifest: null,
      stateCode: null,
      artifactFile: null,
      datasetVersion: manifestResult.datasetVersion ?? null,
      reason: manifestResult.reason ?? manifestResult.error ?? null,
    };
  }

  return checkTerritoryAvailability(manifestResult.manifest, stateCode, {
    supabase: loaderContext.supabase,
    localStateExists: localStateGeoJsonExists,
  });
}

/**
 * @param {string} serviceType
 * @param {string | null | undefined} [stateCode]
 */
async function isElectricTerritoryDataAvailable(serviceType, stateCode = null) {
  const result = await checkElectricTerritoryAvailability(serviceType, stateCode);
  return Boolean(result.available);
}

/**
 * @param {string} stateCode
 * @param {object} [options]
 * @param {boolean} [options.forceReload]
 */
async function loadStateTerritoryGeoJson(stateCode, options = {}) {
  const normalized = normalizeUsStateCode(stateCode);
  if (!normalized) {
    return { ok: false, code: "INVALID_STATE", geojson: null, manifest: null };
  }

  if (shouldUseTerritoryStorage(loaderContext.supabase)) {
    const remote = await fetchRemoteStateGeoJson(loaderContext.supabase, normalized, options);
    if (remote.ok && remote.geojson && remote.manifest) {
      const cacheKey = `remote:${remote.datasetVersion ?? "unknown"}:${normalized}:${remote.checksum ?? "none"}`;
      if (!options.forceReload && stateCache.has(cacheKey)) {
        const cached = stateCache.get(cacheKey);
        return {
          ok: true,
          code: "CACHE_HIT",
          geojson: cached.geojson,
          manifest: remote.manifest,
          fromCache: true,
          source: "storage",
          datasetVersion: remote.datasetVersion ?? null,
        };
      }
      stateCache.set(cacheKey, {
        loadedAt: Date.now(),
        geojson: remote.geojson,
        manifest: remote.manifest,
        checksum: remote.checksum ?? null,
      });
      return { ...remote, fromCache: false, source: "storage" };
    }

    const config = getTerritoryStorageConfig();
    if (config.allowLocalFallback) {
      logTerritoryStorage("fallback_local_state_geojson", {
        state: normalized,
        reason: remote.code,
      });
      const local = loadLocalStateTerritoryGeoJson(normalized, options);
      return local;
    }

    return { ...remote, source: "storage" };
  }

  return loadLocalStateTerritoryGeoJson(normalized, options);
}

/**
 * @param {string} stateCode
 * @param {string | null | undefined} countyName
 */
async function loadCountyUtilityEntry(stateCode, countyName) {
  const normalizedState = normalizeUsStateCode(stateCode);
  const county = normalizeCountyLookupName(countyName);
  if (!normalizedState || !county) return null;

  if (shouldUseTerritoryStorage(loaderContext.supabase)) {
    const remote = await fetchRemoteCountyUtilityStore(loaderContext.supabase);
    if (remote.ok && remote.store) {
      const key = `${normalizedState}:${county}`;
      const entry = remote.store[key];
      return entry && typeof entry === "object" ? /** @type {Record<string, unknown>} */ (entry) : null;
    }

    const config = getTerritoryStorageConfig();
    if (!config.allowLocalFallback) return null;
    logTerritoryStorage("fallback_local_county", { state: normalizedState, reason: remote.code });
  }

  const dataDir = resolveTerritoryDataDir();
  const countyPath = path.join(dataDir, "county_utility.json");
  if (!fs.existsSync(countyPath)) return null;

  try {
    const store = JSON.parse(fs.readFileSync(countyPath, "utf8"));
    const key = `${normalizedState}:${county}`;
    const entry = store?.[key];
    if (!entry || typeof entry !== "object") return null;
    return /** @type {Record<string, unknown>} */ (entry);
  } catch {
    return null;
  }
}

function clearTerritoryDatasetCache() {
  stateCache.clear();
  clearTerritoryStorageRuntimeState();
}

/**
 * Lightweight validation — never throws.
 */
async function validateTerritoryDatasetHealth() {
  const config = getTerritoryStorageConfig();

  if (shouldUseTerritoryStorage(loaderContext.supabase)) {
    const remote = await probeTerritoryStorageHealth(loaderContext.supabase);
    if (remote.healthy || !config.allowLocalFallback) {
      return remote;
    }
    logTerritoryStorage("health_fallback_local", { reason: remote.code });
  }

  const dataDir = resolveTerritoryDataDir();
  const manifest = readLocalManifest(dataDir);
  if (!manifest) {
    return {
      healthy: false,
      code: "MANIFEST_MISSING",
      source: config.allowLocalFallback ? "local" : "none",
      dataDir,
      storage_enabled: config.storageEnabled,
      bucket: config.bucket || null,
      prefix: config.prefix,
      allow_local_fallback: config.allowLocalFallback,
    };
  }

  const states = listManifestStateCodes(manifest);

  return {
    healthy: states.length > 0,
    code: states.length > 0 ? "OK" : "NO_STATES",
    source: "local",
    dataDir,
    dataset_version: manifest.dataset_version ?? null,
    source_vintage: manifest.source_vintage ?? null,
    states,
    county_fallback_available: Boolean(manifest.county_fallback),
    checksum_status: "local_manifest_present",
    cache_status: { parsed_state_cache_entries: stateCache.size },
    fallback_used: Boolean(manifest.fallback_used),
    storage_enabled: config.storageEnabled,
    bucket: config.bucket || null,
    prefix: config.prefix,
    allow_local_fallback: config.allowLocalFallback,
  };
}

module.exports = {
  DEFAULT_DATA_DIR,
  resolveTerritoryDataDir,
  configureTerritoryDatasetLoader,
  loadTerritoryManifest,
  readManifest,
  manifestHasState: manifestHasStateEntry,
  checkElectricTerritoryAvailability,
  isElectricTerritoryDataAvailable,
  loadStateTerritoryGeoJson,
  loadCountyUtilityEntry,
  clearTerritoryDatasetCache,
  validateTerritoryDatasetHealth,
  sha256File,
  readLocalManifest,
};
