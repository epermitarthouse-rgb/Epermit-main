"use strict";

const path = require("node:path");

const DEFAULT_TERRITORY_DATA_DIR = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "data",
  "territory",
  "electric",
);

/**
 * @param {string | undefined | null} value
 * @param {boolean} defaultValue
 */
function parseBoolEnv(value, defaultValue) {
  if (value == null || String(value).trim() === "") return defaultValue;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return defaultValue;
}

/**
 * @returns {boolean}
 */
function isRailwayOrProductionRuntime() {
  return Boolean(
    process.env.RAILWAY_ENVIRONMENT ||
      String(process.env.NODE_ENV ?? "").trim().toLowerCase() === "production",
  );
}

/**
 * Territory dataset storage/runtime configuration from environment.
 */
function getTerritoryStorageConfig() {
  const storageEnabled = parseBoolEnv(process.env.UCI_TERRITORY_STORAGE_ENABLED, false);
  const bucket = String(process.env.UCI_TERRITORY_STORAGE_BUCKET ?? "").trim();
  const prefix = String(process.env.UCI_TERRITORY_STORAGE_PREFIX ?? "uci-territory")
    .trim()
    .replace(/^\/+|\/+$/g, "");
  const datasetVersion = String(process.env.UCI_TERRITORY_DATASET_VERSION ?? "current").trim();
  const localCacheDir = String(
    process.env.UCI_TERRITORY_LOCAL_CACHE_DIR ?? "/tmp/uci-territory-cache",
  ).trim();
  const localDataDir = String(process.env.UCI_TERRITORY_DATA_DIR ?? "").trim() || DEFAULT_TERRITORY_DATA_DIR;
  const allowLocalFallback = parseBoolEnv(
    process.env.UCI_TERRITORY_ALLOW_LOCAL_FALLBACK,
    !isRailwayOrProductionRuntime(),
  );

  return {
    storageEnabled,
    bucket,
    prefix,
    datasetVersion,
    localCacheDir,
    localDataDir,
    allowLocalFallback,
    runtime: isRailwayOrProductionRuntime() ? "production" : "development",
  };
}

/**
 * Whether remote Supabase Storage should be attempted.
 * @param {import("@supabase/supabase-js").SupabaseClient | null | undefined} supabase
 */
function shouldUseTerritoryStorage(supabase) {
  const config = getTerritoryStorageConfig();
  return Boolean(config.storageEnabled && config.bucket && supabase);
}

module.exports = {
  DEFAULT_TERRITORY_DATA_DIR,
  parseBoolEnv,
  isRailwayOrProductionRuntime,
  getTerritoryStorageConfig,
  shouldUseTerritoryStorage,
};
