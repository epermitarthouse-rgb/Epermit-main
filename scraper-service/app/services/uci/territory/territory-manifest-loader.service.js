"use strict";

const { logTerritoryStorage } = require("./territory-storage-client.service.js");

/**
 * @typedef {"OK"|"CACHE_HIT"|"LOADED"|"MANIFEST_MISSING"|"MANIFEST_FETCH_FAILED"|"MANIFEST_PARSE_FAILED"|"MANIFEST_INVALID"|"VERSION_MISMATCH"|"CURRENT_JSON_MISSING"|"STORAGE_DISABLED"|"SUPABASE_CLIENT_MISSING"} TerritoryManifestLoadCode
 */

/**
 * @param {string | null | undefined} code
 * @returns {TerritoryManifestLoadCode}
 */
function normalizeManifestLoadFailureCode(code) {
  const normalized = String(code ?? "").trim().toUpperCase();
  switch (normalized) {
    case "INVALID_MANIFEST":
    case "VERSION_MISMATCH":
      return "MANIFEST_INVALID";
    case "MANIFEST_PARSE_FAILED":
      return "MANIFEST_PARSE_FAILED";
    case "CURRENT_JSON_MISSING":
    case "CURRENT_JSON_INVALID":
      return "CURRENT_JSON_MISSING";
    case "STORAGE_DOWNLOAD_FAILED":
    case "MANIFEST_MISSING":
      return "MANIFEST_FETCH_FAILED";
    default:
      return /** @type {TerritoryManifestLoadCode} */ (normalized || "MANIFEST_FETCH_FAILED");
  }
}

/**
 * @param {object} fields
 */
function logTerritoryManifestLoad(fields) {
  logTerritoryStorage("manifest_loader", fields);
}

/**
 * @param {boolean} ok
 * @param {TerritoryManifestLoadCode} code
 * @param {Record<string, unknown> | null} [manifest]
 * @param {string | null | undefined} [datasetVersion]
 * @param {Record<string, unknown>} [extra]
 */
function buildManifestLoadResult(ok, code, manifest = null, datasetVersion = null, extra = {}) {
  return {
    ok,
    code,
    manifest,
    datasetVersion: datasetVersion ?? null,
    ...extra,
  };
}

module.exports = {
  normalizeManifestLoadFailureCode,
  logTerritoryManifestLoad,
  buildManifestLoadResult,
};
