"use strict";

const DATASET_VERSION_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
const STATE_CODE_RE = /^[A-Z]{2}$/;

/**
 * @param {string} value
 * @param {string} label
 */
function assertSafeSegment(value, label) {
  const raw = String(value ?? "").trim();
  if (!raw || raw.includes("..") || raw.includes("/") || raw.includes("\\")) {
    throw new Error(`Invalid ${label}: path traversal or empty segment`);
  }
  return raw;
}

/**
 * @param {string} version
 */
function validateDatasetVersion(version) {
  const raw = assertSafeSegment(version, "dataset_version");
  if (!DATASET_VERSION_RE.test(raw)) {
    throw new Error(`Invalid dataset_version format: ${raw}`);
  }
  return raw;
}

/**
 * @param {string} stateCode
 */
function validateStateCode(stateCode) {
  const normalized = String(stateCode ?? "")
    .trim()
    .toUpperCase();
  if (!STATE_CODE_RE.test(normalized)) {
    throw new Error(`Invalid state code: ${stateCode}`);
  }
  return normalized;
}

/**
 * @param {string} prefix
 */
function normalizePrefix(prefix) {
  return String(prefix ?? "uci-territory")
    .trim()
    .replace(/^\/+|\/+$/g, "");
}

/**
 * @param {string} prefix
 */
function buildCurrentJsonPath(prefix) {
  const p = normalizePrefix(prefix);
  return `${p}/electric/current.json`;
}

/**
 * @param {string} prefix
 * @param {string} version
 */
function buildVersionRootPath(prefix, version) {
  const p = normalizePrefix(prefix);
  const v = validateDatasetVersion(version);
  return `${p}/electric/versions/${v}`;
}

/**
 * @param {string} prefix
 * @param {string} version
 */
function buildManifestPath(prefix, version) {
  return `${buildVersionRootPath(prefix, version)}/manifest.json`;
}

/**
 * @param {string} prefix
 * @param {string} version
 */
function buildUtilitiesByStatePath(prefix, version) {
  return `${buildVersionRootPath(prefix, version)}/utilities_by_state.json`;
}

/**
 * @param {string} prefix
 * @param {string} version
 */
function buildCountyUtilityPath(prefix, version) {
  return `${buildVersionRootPath(prefix, version)}/county_utility.json`;
}

/**
 * @param {string} prefix
 * @param {string} version
 * @param {string} stateCode
 */
function buildStateGeoJsonPath(prefix, version, stateCode) {
  const state = validateStateCode(stateCode);
  return `${buildVersionRootPath(prefix, version)}/territories_${state}.geojson`;
}

/**
 * @param {string} prefix
 * @param {string} version
 * @param {string} fileName
 */
function buildVersionArtifactPath(prefix, version, fileName) {
  const safeName = assertSafeSegment(fileName, "artifact_file");
  return `${buildVersionRootPath(prefix, version)}/${safeName}`;
}

module.exports = {
  DATASET_VERSION_RE,
  STATE_CODE_RE,
  validateDatasetVersion,
  validateStateCode,
  normalizePrefix,
  buildCurrentJsonPath,
  buildVersionRootPath,
  buildManifestPath,
  buildUtilitiesByStatePath,
  buildCountyUtilityPath,
  buildStateGeoJsonPath,
  buildVersionArtifactPath,
};
