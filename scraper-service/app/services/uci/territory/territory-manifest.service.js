"use strict";

const { normalizeUsStateCode } = require("./territory-geo.utils.js");

/**
 * @param {unknown} value
 * @returns {Record<string, unknown> | null}
 */
function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? /** @type {Record<string, unknown>} */ (value)
    : null;
}

/**
 * Normalize supported manifest shapes into `states: Record<stateCode, metadata>`.
 *
 * Supported inputs:
 * - v2 object map: manifest.states.VA = { file, checksum_sha256, ... }
 * - legacy array: manifest.states = ["MD", "VA"]
 * - legacy single state: manifest.state = "MD"
 * - legacy files map: manifest.files["territories_MD.geojson"] = { checksum_sha256 }
 *
 * @param {Record<string, unknown> | null | undefined} raw
 */
function normalizeTerritoryManifest(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const manifest = { ...raw };
  const normalizedStates = /** @type {Record<string, Record<string, unknown>>} */ ({});

  const existingStates = manifest.states;
  if (Array.isArray(existingStates)) {
    for (const entry of existingStates) {
      const code = normalizeUsStateCode(entry);
      if (!code) continue;
      normalizedStates[code] = {
        file: `territories_${code}.geojson`,
      };
    }
  } else {
    const stateMap = asObject(existingStates);
    if (stateMap) {
      for (const [key, value] of Object.entries(stateMap)) {
        const code = normalizeUsStateCode(key);
        if (!code) continue;
        const entry = asObject(value);
        normalizedStates[code] = entry
          ? {
              ...entry,
              file: String(entry.file ?? `territories_${code}.geojson`),
            }
          : { file: `territories_${code}.geojson` };
      }
    }
  }

  const legacyState = normalizeUsStateCode(manifest.state);
  if (legacyState && !normalizedStates[legacyState]) {
    normalizedStates[legacyState] = {
      file: `territories_${legacyState}.geojson`,
    };
  }

  const files = asObject(manifest.files);
  if (files) {
    for (const [fileName, metadata] of Object.entries(files)) {
      const match = String(fileName).match(/^territories_([A-Z]{2})\.geojson$/i);
      if (!match) continue;
      const code = normalizeUsStateCode(match[1]);
      if (!code) continue;
      const entry = asObject(metadata) ?? {};
      normalizedStates[code] = {
        ...normalizedStates[code],
        ...entry,
        file: String(entry.file ?? fileName),
      };
    }
  }

  manifest.states = normalizedStates;
  return manifest;
}

/**
 * @param {Record<string, unknown> | null | undefined} manifest
 */
function listManifestStateCodes(manifest) {
  const normalized = normalizeTerritoryManifest(manifest);
  if (!normalized) return [];
  const states = asObject(normalized.states);
  return states ? Object.keys(states).sort() : [];
}

/**
 * @param {Record<string, unknown> | null | undefined} manifest
 * @param {string | null | undefined} stateCode
 */
function getManifestStateEntry(manifest, stateCode) {
  const normalized = normalizeTerritoryManifest(manifest);
  if (!normalized) return null;
  const code = normalizeUsStateCode(stateCode);
  if (!code) return null;
  const states = asObject(normalized.states);
  if (!states) return null;
  const entry = asObject(states[code]);
  return entry ?? null;
}

/**
 * @param {Record<string, unknown> | null | undefined} manifest
 * @param {string | null | undefined} stateCode
 */
function manifestHasState(manifest, stateCode) {
  return Boolean(getManifestStateEntry(manifest, stateCode));
}

module.exports = {
  normalizeTerritoryManifest,
  listManifestStateCodes,
  getManifestStateEntry,
  manifestHasState,
};
