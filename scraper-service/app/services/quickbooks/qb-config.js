"use strict";

/**
 * QuickBooks / Intuit OAuth and API configuration (env-driven).
 * Validation runs only when callers invoke getters — scraper startup stays unaffected.
 */

const INTUIT_AUTHORIZATION_URL = "https://appcenter.intuit.com/connect/oauth2";
const INTUIT_TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";

function getEnvironment() {
  return (process.env.QB_ENV || "sandbox").trim().toLowerCase();
}

function getMinorVersion() {
  return (process.env.QB_MINOR_VERSION || "75").trim();
}

function getApiBaseUrl(env = getEnvironment()) {
  return env === "production"
    ? "https://quickbooks.api.intuit.com"
    : "https://sandbox-quickbooks.api.intuit.com";
}

function assertOAuthEnv() {
  const missing = [];
  if (!process.env.QB_CLIENT_ID?.trim()) missing.push("QB_CLIENT_ID");
  if (!process.env.QB_CLIENT_SECRET?.trim()) missing.push("QB_CLIENT_SECRET");
  if (!process.env.QB_REDIRECT_URI?.trim()) missing.push("QB_REDIRECT_URI");
  if (missing.length) {
    const err = new Error(
      `QuickBooks OAuth is not configured (missing: ${missing.join(", ")}).`,
    );
    err.code = "QB_CONFIG_MISSING";
    throw err;
  }
}

/**
 * Full OAuth client settings — throws if required vars absent.
 */
function getOAuthConfig() {
  assertOAuthEnv();
  const env = getEnvironment();
  return {
    clientId: process.env.QB_CLIENT_ID.trim(),
    clientSecret: process.env.QB_CLIENT_SECRET.trim(),
    redirectUri: process.env.QB_REDIRECT_URI.trim(),
    environment: env,
    minorVersion: getMinorVersion(),
    authorizationUrl: INTUIT_AUTHORIZATION_URL,
    tokenUrl: INTUIT_TOKEN_URL,
    apiBaseUrl: getApiBaseUrl(env),
  };
}

function getRedirectUrls() {
  const fallback = "http://localhost:5001";
  return {
    success: (process.env.QB_SUCCESS_REDIRECT_URL || fallback).trim(),
    failure: (process.env.QB_FAILURE_REDIRECT_URL || fallback).trim(),
  };
}

/** Default Sales Item ID when service_type lookup fails (invoice trigger). */
function getDefaultItemId() {
  const v = process.env.QB_DEFAULT_ITEM_ID?.trim();
  return v || null;
}

/** Default item DisplayName for lookup when QB_DEFAULT_ITEM_ID is unset. */
function getDefaultItemName() {
  const v = process.env.QB_DEFAULT_ITEM_NAME?.trim();
  return v || null;
}

module.exports = {
  INTUIT_AUTHORIZATION_URL,
  INTUIT_TOKEN_URL,
  getEnvironment,
  getMinorVersion,
  getApiBaseUrl,
  assertOAuthEnv,
  getOAuthConfig,
  getRedirectUrls,
  getDefaultItemId,
  getDefaultItemName,
};
