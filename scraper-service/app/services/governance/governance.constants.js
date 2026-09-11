"use strict";

/** @typedef {"none"|"read"|"write"} FeatureAccessLevel */
/** @typedef {"none"|"read"|"write"|"owner"} ProjectAccessLevel */
/** @typedef {"default"|"none"|"read"|"write"} ProjectAccessControl */
/** @typedef {"default"|"none"|"use"|"manage"} CredentialGrantControl */
/** @typedef {"owner"|"admin"|"editor"|"viewer"|"none"} ProjectRole */

const FEATURE_KEYS = Object.freeze([
  "project.core",
  "scraper.run",
  "scraper.results",
  "filing.submit",
  "documents.vault",
  "ingestion.rag",
  "billing.quickbooks",
  "code.analyzer",
  "uci.workspace",
  "credentials.self",
]);

const EDITOR_WRITE_FEATURES = Object.freeze([
  "scraper.run",
  "filing.submit",
  "documents.vault",
  "ingestion.rag",
  "code.analyzer",
  "credentials.self",
]);

/** @type {Record<FeatureAccessLevel, number>} */
const FEATURE_LEVEL_RANK = Object.freeze({
  none: 0,
  read: 1,
  write: 2,
});

/** @type {Record<"none"|"use"|"manage", number>} */
const CREDENTIAL_GRANT_RANK = Object.freeze({
  none: 0,
  use: 1,
  manage: 2,
});

/**
 * @param {FeatureAccessLevel} actual
 * @param {FeatureAccessLevel} required
 * @returns {boolean}
 */
function featureLevelSatisfies(actual, required) {
  const a = FEATURE_LEVEL_RANK[actual] ?? 0;
  const r = FEATURE_LEVEL_RANK[required] ?? 0;
  return a >= r;
}

/**
 * @param {"none"|"use"|"manage"} actual
 * @param {"none"|"use"|"manage"} required
 * @returns {boolean}
 */
function credentialGrantSatisfies(actual, required) {
  const a = CREDENTIAL_GRANT_RANK[actual] ?? 0;
  const r = CREDENTIAL_GRANT_RANK[required] ?? 0;
  return a >= r;
}

/**
 * Resolve default feature access from project role when no explicit row exists.
 * @param {ProjectRole} projectRole
 * @param {string} featureKey
 * @returns {FeatureAccessLevel}
 */
function resolveRoleDefaultFeatureAccess(projectRole, featureKey) {
  if (projectRole === "none") {
    return "none";
  }

  if (projectRole === "owner" || projectRole === "admin") {
    return "write";
  }

  if (projectRole === "viewer") {
    return "read";
  }

  if (projectRole === "editor") {
    if (EDITOR_WRITE_FEATURES.includes(featureKey)) {
      return "write";
    }
    return "read";
  }

  return "none";
}

/**
 * Standard product feature baseline for active users without an explicit global override.
 * Normal active users can use all standard PermitPilot product features.
 * Project role caps apply separately inside assigned projects.
 * @param {string} featureKey
 * @returns {FeatureAccessLevel}
 */
function resolveActiveUserDefaultFeatureAccess(featureKey) {
  if (FEATURE_KEYS.includes(featureKey)) {
    return "write";
  }
  return "write";
}

/**
 * @param {FeatureAccessLevel} a
 * @param {FeatureAccessLevel} b
 * @returns {FeatureAccessLevel}
 */
function combineFeatureAccessLevels(a, b) {
  const min = Math.min(FEATURE_LEVEL_RANK[a] ?? 0, FEATURE_LEVEL_RANK[b] ?? 0);
  if (min >= FEATURE_LEVEL_RANK.write) {
    return "write";
  }
  if (min >= FEATURE_LEVEL_RANK.read) {
    return "read";
  }
  return "none";
}

/** Default project access for active non-admin users. */
const DEFAULT_PROJECT_ACCESS_LEVEL = "write";

/**
 * @param {ProjectAccessLevel} level
 * @returns {ProjectRole}
 */
function projectAccessToSyntheticRole(level) {
  if (level === "owner" || level === "write") {
    return "admin";
  }
  if (level === "read") {
    return "viewer";
  }
  return "none";
}

/**
 * @param {boolean} platformAdmin
 * @returns {"use"|"manage"|"none"}
 */
function resolveDefaultCredentialGrantLevel(platformAdmin) {
  if (platformAdmin) {
    return "manage";
  }
  return "use";
}

module.exports = {
  FEATURE_KEYS,
  EDITOR_WRITE_FEATURES,
  FEATURE_LEVEL_RANK,
  CREDENTIAL_GRANT_RANK,
  featureLevelSatisfies,
  credentialGrantSatisfies,
  resolveRoleDefaultFeatureAccess,
  resolveActiveUserDefaultFeatureAccess,
  combineFeatureAccessLevels,
  DEFAULT_PROJECT_ACCESS_LEVEL,
  projectAccessToSyntheticRole,
  resolveDefaultCredentialGrantLevel,
};
