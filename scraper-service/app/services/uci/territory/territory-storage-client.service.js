"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const {
  downloadFromSupabaseStorage,
  uploadBufferToSupabaseStorage,
  sanitizeStorageErrorForLog,
} = require("../../../../shared/supabase-storage-upload.js");
const { TERRITORY_SCHEMA_VERSION } = require("./territory-sources.js");
const { getTerritoryStorageConfig } = require("./territory-storage-config.service.js");
const {
  buildCurrentJsonPath,
  buildManifestPath,
  buildCountyUtilityPath,
  buildStateGeoJsonPath,
  validateDatasetVersion,
} = require("./territory-storage-paths.service.js");

/** @type {{ supabase: import("@supabase/supabase-js").SupabaseClient | null }} */
let loaderContext = { supabase: null };

/** @type {Map<string, Promise<Buffer>>} */
const inFlightDownloads = new Map();

/** @type {{ activeVersion: string | null, manifest: Record<string, unknown> | null, countyStore: Record<string, unknown> | null, lastSuccessfulFetchAt: string | null, lastError: string | null }} */
const runtimeState = {
  activeVersion: null,
  manifest: null,
  countyStore: null,
  lastSuccessfulFetchAt: null,
  lastError: null,
};

/**
 * @param {{ supabase?: import("@supabase/supabase-js").SupabaseClient | null }} ctx
 */
function configureTerritoryStorageClient(ctx = {}) {
  if (Object.prototype.hasOwnProperty.call(ctx, "supabase")) {
    loaderContext.supabase = ctx.supabase ?? null;
  }
}

/**
 * @param {string} event
 * @param {Record<string, unknown>} [fields]
 */
function logTerritoryStorage(event, fields = {}) {
  const payload = {
    component: "uci-territory-storage",
    event,
    ...fields,
  };
  console.log(JSON.stringify(payload));
}

/**
 * @param {Buffer} buffer
 */
function sha256Buffer(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

/**
 * @param {Record<string, unknown>} manifest
 */
function validateManifestSchema(manifest) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    return { ok: false, code: "INVALID_MANIFEST", reason: "manifest_not_object" };
  }
  if (manifest.schema_version !== TERRITORY_SCHEMA_VERSION) {
    return {
      ok: false,
      code: "INVALID_MANIFEST",
      reason: `schema_version_mismatch:${manifest.schema_version}`,
    };
  }
  if (!manifest.dataset_version || typeof manifest.dataset_version !== "string") {
    return { ok: false, code: "INVALID_MANIFEST", reason: "missing_dataset_version" };
  }
  const states = manifest.states;
  if (!states || typeof states !== "object" || Array.isArray(states)) {
    return { ok: false, code: "INVALID_MANIFEST", reason: "missing_states" };
  }
  return { ok: true, code: "OK" };
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} bucket
 * @param {string} storagePath
 */
async function downloadStorageObject(supabase, bucket, storagePath) {
  const dedupeKey = `${bucket}:${storagePath}`;
  if (inFlightDownloads.has(dedupeKey)) {
    logTerritoryStorage("fetch_dedup_wait", { bucket, storage_path: storagePath });
    return inFlightDownloads.get(dedupeKey);
  }

  const task = (async () => {
    logTerritoryStorage("fetch_start", { bucket, storage_path: storagePath });
    const result = await downloadFromSupabaseStorage({ supabase, bucket, storagePath });
    if (!result.ok || !result.data) {
      const message = sanitizeStorageErrorForLog(result.errorMessage);
      runtimeState.lastError = message;
      logTerritoryStorage("fetch_failed", {
        bucket,
        storage_path: storagePath,
        error_code: result.errorCode,
        error_message: message,
      });
      return {
        ok: false,
        buffer: null,
        errorCode: result.errorCode || "STORAGE_DOWNLOAD_FAILED",
        errorMessage: message || "storage_download_failed",
      };
    }
    const buffer = Buffer.from(await result.data.arrayBuffer());
    runtimeState.lastSuccessfulFetchAt = new Date().toISOString();
    runtimeState.lastError = null;
    logTerritoryStorage("fetch_success", {
      bucket,
      storage_path: storagePath,
      bytes: buffer.length,
    });
    return { ok: true, buffer, errorCode: null, errorMessage: null };
  })().finally(() => {
    inFlightDownloads.delete(dedupeKey);
  });

  inFlightDownloads.set(dedupeKey, task);
  return task;
}

/**
 * @param {string} datasetVersion
 * @param {string} fileName
 * @param {Buffer} bytes
 */
function writeLocalCacheFile(datasetVersion, fileName, bytes) {
  const config = getTerritoryStorageConfig();
  const version = validateDatasetVersion(datasetVersion);
  const cacheDir = path.join(config.localCacheDir, version);
  fs.mkdirSync(cacheDir, { recursive: true });
  const cachePath = path.join(cacheDir, fileName);
  fs.writeFileSync(cachePath, bytes);
  return cachePath;
}

/**
 * @param {string} datasetVersion
 * @param {string} fileName
 */
function readLocalCacheFile(datasetVersion, fileName) {
  const config = getTerritoryStorageConfig();
  const cachePath = path.join(config.localCacheDir, validateDatasetVersion(datasetVersion), fileName);
  if (!fs.existsSync(cachePath)) return null;
  return fs.readFileSync(cachePath);
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} bucket
 * @param {string} prefix
 * @param {string | null | undefined} [configuredVersion]
 */
async function resolveActiveDatasetVersion(supabase, bucket, prefix, configuredVersion) {
  const pinned = String(configuredVersion ?? "").trim();
  if (pinned && pinned !== "current") {
    return validateDatasetVersion(pinned);
  }

  const currentPath = buildCurrentJsonPath(prefix);
  const currentResult = await downloadStorageObject(supabase, bucket, currentPath);
  if (!currentResult.ok || !currentResult.buffer) {
    throw Object.assign(new Error(currentResult.errorMessage || "current_json_unavailable"), {
      code: currentResult.errorCode || "CURRENT_JSON_MISSING",
    });
  }
  let current;
  try {
    current = JSON.parse(currentResult.buffer.toString("utf8"));
  } catch {
    throw Object.assign(new Error("current_json_parse_failed"), { code: "CURRENT_JSON_INVALID" });
  }
  if (!current?.dataset_version) {
    throw Object.assign(new Error("current_json_missing_dataset_version"), {
      code: "CURRENT_JSON_INVALID",
    });
  }
  return validateDatasetVersion(String(current.dataset_version));
}

/**
 * Non-throwing variant for availability checks.
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} bucket
 * @param {string} prefix
 * @param {string | null | undefined} [configuredVersion]
 */
async function tryResolveActiveDatasetVersion(supabase, bucket, prefix, configuredVersion) {
  try {
    const version = await resolveActiveDatasetVersion(supabase, bucket, prefix, configuredVersion);
    return { ok: true, version };
  } catch (err) {
    return {
      ok: false,
      version: null,
      code: err && typeof err === "object" && "code" in err ? String(err.code) : "CURRENT_JSON_MISSING",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} [options]
 * @param {boolean} [options.forceReload]
 */
async function fetchRemoteManifest(supabase, options = {}) {
  const config = getTerritoryStorageConfig();
  const resolvedVersion = await tryResolveActiveDatasetVersion(
    supabase,
    config.bucket,
    config.prefix,
    config.datasetVersion,
  );
  if (!resolvedVersion.ok || !resolvedVersion.version) {
    return {
      ok: false,
      code: resolvedVersion.code || "CURRENT_JSON_MISSING",
      manifest: null,
      datasetVersion: null,
      error: resolvedVersion.error,
    };
  }
  const version = resolvedVersion.version;

  if (!options.forceReload && runtimeState.manifest && runtimeState.activeVersion === version) {
    return { ok: true, code: "CACHE_HIT", manifest: runtimeState.manifest, datasetVersion: version };
  }

  const manifestPath = buildManifestPath(config.prefix, version);
  const manifestResult = await downloadStorageObject(supabase, config.bucket, manifestPath);
  if (!manifestResult.ok || !manifestResult.buffer) {
    return {
      ok: false,
      code: manifestResult.errorCode || "MANIFEST_MISSING",
      manifest: null,
      datasetVersion: version,
      error: manifestResult.errorMessage,
    };
  }
  writeLocalCacheFile(version, "manifest.json", manifestResult.buffer);

  let manifest;
  try {
    manifest = JSON.parse(manifestResult.buffer.toString("utf8"));
  } catch (err) {
    return {
      ok: false,
      code: "MANIFEST_PARSE_FAILED",
      manifest: null,
      datasetVersion: version,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  const schema = validateManifestSchema(manifest);
  if (!schema.ok) {
    return {
      ok: false,
      code: schema.code,
      manifest: null,
      datasetVersion: version,
      reason: schema.reason,
    };
  }

  const expectedVersion = String(manifest.dataset_version ?? version);
  if (expectedVersion !== version) {
    return {
      ok: false,
      code: "VERSION_MISMATCH",
      manifest: null,
      datasetVersion: version,
      reason: `manifest_version_${expectedVersion}_active_${version}`,
    };
  }

  runtimeState.activeVersion = version;
  runtimeState.manifest = manifest;
  logTerritoryStorage("manifest_loaded", {
    dataset_version: version,
    states: Object.keys(manifest.states ?? {}).length,
  });

  return { ok: true, code: "LOADED", manifest, datasetVersion: version };
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} stateCode
 * @param {object} [options]
 * @param {boolean} [options.forceReload]
 */
async function fetchRemoteStateGeoJson(supabase, stateCode, options = {}) {
  const manifestResult = await fetchRemoteManifest(supabase, options);
  if (!manifestResult.ok || !manifestResult.manifest) {
    return {
      ok: false,
      code: manifestResult.code,
      geojson: null,
      manifest: manifestResult.manifest,
      datasetVersion: manifestResult.datasetVersion ?? null,
    };
  }

  const manifest = manifestResult.manifest;
  const version = manifestResult.datasetVersion;
  const normalizedState = String(stateCode ?? "")
    .trim()
    .toUpperCase();
  const states = /** @type {Record<string, { checksum_sha256?: string, file?: string }>} */ (
    manifest.states ?? {}
  );
  const stateEntry = states[normalizedState];
  if (!stateEntry) {
    return {
      ok: false,
      code: "STATE_NOT_INGESTED",
      geojson: null,
      manifest,
      datasetVersion: version,
    };
  }

  const fileName = stateEntry.file || `territories_${normalizedState}.geojson`;
  const config = getTerritoryStorageConfig();
  const storagePath = buildStateGeoJsonPath(config.prefix, String(version), normalizedState);

  let bytes = readLocalCacheFile(String(version), fileName);
  if (!bytes || options.forceReload) {
    const download = await downloadStorageObject(supabase, config.bucket, storagePath);
    if (!download.ok || !download.buffer) {
      return {
        ok: false,
        code: download.errorCode || "GEOJSON_MISSING",
        geojson: null,
        manifest,
        datasetVersion: version,
        error: download.errorMessage,
      };
    }
    bytes = download.buffer;
    writeLocalCacheFile(String(version), fileName, bytes);
  } else {
    logTerritoryStorage("cache_hit", { dataset_version: version, artifact: fileName, layer: "tmp" });
  }

  const expectedChecksum = stateEntry.checksum_sha256;
  if (expectedChecksum) {
    const actual = sha256Buffer(bytes);
    if (actual !== expectedChecksum) {
      logTerritoryStorage("checksum_failed", {
        dataset_version: version,
        artifact: fileName,
        expected_checksum: expectedChecksum,
        actual_checksum: actual,
      });
      return {
        ok: false,
        code: "CHECKSUM_MISMATCH",
        geojson: null,
        manifest,
        datasetVersion: version,
        expectedChecksum,
        actualChecksum: actual,
      };
    }
  }

  let geojson;
  try {
    geojson = JSON.parse(bytes.toString("utf8"));
  } catch (err) {
    return {
      ok: false,
      code: "GEOJSON_PARSE_FAILED",
      geojson: null,
      manifest,
      datasetVersion: version,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  return {
    ok: true,
    code: bytes ? "LOADED" : "LOADED",
    geojson,
    manifest,
    datasetVersion: version,
    checksum: expectedChecksum ?? sha256Buffer(bytes),
  };
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} [options]
 * @param {boolean} [options.forceReload]
 */
async function fetchRemoteCountyUtilityStore(supabase, options = {}) {
  const manifestResult = await fetchRemoteManifest(supabase, options);
  if (!manifestResult.ok || !manifestResult.manifest) {
    return { ok: false, code: manifestResult.code, store: null, manifest: null };
  }

  const version = manifestResult.datasetVersion;
  if (!options.forceReload && runtimeState.countyStore && runtimeState.activeVersion === version) {
    return {
      ok: true,
      code: "CACHE_HIT",
      store: runtimeState.countyStore,
      manifest: manifestResult.manifest,
      datasetVersion: version,
    };
  }

  const config = getTerritoryStorageConfig();
  const storagePath = buildCountyUtilityPath(config.prefix, String(version));
  let bytes = readLocalCacheFile(String(version), "county_utility.json");
  if (!bytes || options.forceReload) {
    const download = await downloadStorageObject(supabase, config.bucket, storagePath);
    if (!download.ok || !download.buffer) {
      return {
        ok: false,
        code: download.errorCode || "COUNTY_FILE_MISSING",
        store: null,
        manifest: manifestResult.manifest,
        datasetVersion: version,
        error: download.errorMessage,
      };
    }
    bytes = download.buffer;
    writeLocalCacheFile(String(version), "county_utility.json", bytes);
  } else {
    logTerritoryStorage("cache_hit", {
      dataset_version: version,
      artifact: "county_utility.json",
      layer: "tmp",
    });
  }

  const countyMeta = manifestResult.manifest.county_fallback;
  const expectedChecksum =
    countyMeta && typeof countyMeta === "object" && !Array.isArray(countyMeta)
      ? /** @type {{ checksum_sha256?: string }} */ (countyMeta).checksum_sha256
      : null;
  if (expectedChecksum) {
    const actual = sha256Buffer(bytes);
    if (actual !== expectedChecksum) {
      return {
        ok: false,
        code: "CHECKSUM_MISMATCH",
        store: null,
        manifest: manifestResult.manifest,
        datasetVersion: version,
        expectedChecksum,
        actualChecksum: actual,
      };
    }
  }

  let store;
  try {
    store = JSON.parse(bytes.toString("utf8"));
  } catch (err) {
    return {
      ok: false,
      code: "COUNTY_PARSE_FAILED",
      store: null,
      manifest: manifestResult.manifest,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  runtimeState.countyStore = store;
  writeLocalCacheFile(String(version), "county_utility.json", bytes);
  return {
    ok: true,
    code: "LOADED",
    store,
    manifest: manifestResult.manifest,
    datasetVersion: version,
  };
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 */
async function probeTerritoryStorageHealth(supabase) {
  const config = getTerritoryStorageConfig();
  const base = {
    storage_enabled: config.storageEnabled,
    bucket: config.bucket || null,
    prefix: config.prefix,
    configured_dataset_version: config.datasetVersion,
    allow_local_fallback: config.allowLocalFallback,
    runtime: config.runtime,
    cache_dir: config.localCacheDir,
    last_successful_remote_fetch_at: runtimeState.lastSuccessfulFetchAt,
    last_error: runtimeState.lastError,
  };

  if (!config.storageEnabled) {
    return { ...base, healthy: false, code: "STORAGE_DISABLED", source: "none" };
  }
  if (!config.bucket) {
    return { ...base, healthy: false, code: "BUCKET_NOT_CONFIGURED", source: "storage" };
  }
  if (!supabase) {
    return { ...base, healthy: false, code: "SUPABASE_CLIENT_MISSING", source: "storage" };
  }

  try {
    const manifestResult = await fetchRemoteManifest(supabase);
    if (!manifestResult.ok || !manifestResult.manifest) {
      return {
        ...base,
        healthy: false,
        code: manifestResult.code,
        source: "storage",
        active_dataset_version: manifestResult.datasetVersion ?? null,
        error_reason: manifestResult.reason ?? manifestResult.error ?? null,
      };
    }

    const manifest = manifestResult.manifest;
    const states =
      manifest.states && typeof manifest.states === "object" && !Array.isArray(manifest.states)
        ? Object.keys(/** @type {Record<string, unknown>} */ (manifest.states))
        : [];

    const countyAvailable = Boolean(
      manifest.county_fallback &&
        typeof manifest.county_fallback === "object" &&
        !Array.isArray(manifest.county_fallback),
    );

    return {
      ...base,
      healthy: states.length > 0,
      code: states.length > 0 ? "OK" : "NO_STATES",
      source: "storage",
      active_dataset_version: manifestResult.datasetVersion ?? null,
      dataset_version: manifest.dataset_version ?? null,
      source_vintage: manifest.source_vintage ?? null,
      states,
      county_fallback_available: countyAvailable,
      checksum_status: "manifest_validated",
      cache_status: {
        active_version_cached: runtimeState.activeVersion,
        manifest_cached: Boolean(runtimeState.manifest),
        county_cached: Boolean(runtimeState.countyStore),
        in_flight_downloads: inFlightDownloads.size,
      },
      fallback_used: Boolean(manifest.fallback_used),
    };
  } catch (err) {
    const message = sanitizeStorageErrorForLog(err instanceof Error ? err.message : String(err));
    return {
      ...base,
      healthy: false,
      code: "STORAGE_PROBE_FAILED",
      source: "storage",
      error_reason: message,
    };
  }
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} storagePath
 * @param {Buffer} body
 * @param {boolean} [allowOverwrite]
 */
async function uploadTerritoryArtifact(supabase, storagePath, body, allowOverwrite = false) {
  return uploadBufferToSupabaseStorage({
    supabase,
    bucket: getTerritoryStorageConfig().bucket,
    storagePath,
    body,
    contentType: storagePath.endsWith(".geojson")
      ? "application/geo+json"
      : "application/json",
    upsert: allowOverwrite,
    cacheControl: "31536000",
  });
}

function clearTerritoryStorageRuntimeState() {
  runtimeState.activeVersion = null;
  runtimeState.manifest = null;
  runtimeState.countyStore = null;
  runtimeState.lastSuccessfulFetchAt = null;
  runtimeState.lastError = null;
  inFlightDownloads.clear();
}

function getTerritoryStorageRuntimeState() {
  return { ...runtimeState, in_flight_downloads: inFlightDownloads.size };
}

module.exports = {
  configureTerritoryStorageClient,
  logTerritoryStorage,
  sha256Buffer,
  validateManifestSchema,
  resolveActiveDatasetVersion,
  fetchRemoteManifest,
  fetchRemoteStateGeoJson,
  fetchRemoteCountyUtilityStore,
  probeTerritoryStorageHealth,
  uploadTerritoryArtifact,
  clearTerritoryStorageRuntimeState,
  getTerritoryStorageRuntimeState,
};
