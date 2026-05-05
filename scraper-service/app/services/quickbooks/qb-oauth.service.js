"use strict";

const querystring = require("querystring");
const {
  INTUIT_TOKEN_URL,
  getOAuthConfig,
} = require("./qb-config.js");

const ACCOUNTING_SCOPE = "com.intuit.quickbooks.accounting";

/**
 * @param {Record<string, unknown>} payload
 * @param {string | { fallbackScopes?: string, fallbackRefreshToken?: string | null, allowReuseRefreshToken?: boolean }} [scopesOrOpts]
 */
function normalizeTokenResponse(payload, scopesOrOpts = ACCOUNTING_SCOPE) {
  if (!payload || typeof payload !== "object") {
    const err = new Error("Invalid token response from Intuit.");
    err.code = "QB_TOKEN_PARSE";
    throw err;
  }

  const opts =
    typeof scopesOrOpts === "string"
      ? {
          fallbackScopes: scopesOrOpts,
          fallbackRefreshToken: null,
          allowReuseRefreshToken: false,
        }
      : {
          fallbackScopes: scopesOrOpts.fallbackScopes ?? ACCOUNTING_SCOPE,
          fallbackRefreshToken: scopesOrOpts.fallbackRefreshToken ?? null,
          allowReuseRefreshToken:
            scopesOrOpts.allowReuseRefreshToken ?? false,
        };

  const accessToken = payload.access_token;
  const refreshToken =
    payload.refresh_token ||
    (opts.allowReuseRefreshToken ? opts.fallbackRefreshToken : null);

  if (!accessToken || !refreshToken) {
    const err = new Error(
      payload.error_description ||
        payload.error ||
        "Token response missing access_token or refresh_token.",
    );
    err.code = "QB_TOKEN_INCOMPLETE";
    err.intuitError = payload.error;
    throw err;
  }

  const expiresInSec = Number(payload.expires_in);
  if (!Number.isFinite(expiresInSec) || expiresInSec <= 0) {
    const err = new Error("Token response missing valid expires_in.");
    err.code = "QB_TOKEN_EXPIRES_IN";
    throw err;
  }

  const accessTokenExpiresAt = new Date(Date.now() + expiresInSec * 1000);

  let refreshTokenExpiresAt = null;
  if (
    payload.x_refresh_token_expires_in != null &&
    payload.x_refresh_token_expires_in !== ""
  ) {
    const rx = Number(payload.x_refresh_token_expires_in);
    if (Number.isFinite(rx) && rx > 0) {
      refreshTokenExpiresAt = new Date(Date.now() + rx * 1000);
    }
  }

  return {
    accessToken,
    refreshToken,
    accessTokenExpiresAt,
    refreshTokenExpiresAt,
    tokenType: payload.token_type || "bearer",
    scopes:
      typeof payload.scope === "string" && payload.scope.trim()
        ? payload.scope.trim()
        : opts.fallbackScopes,
  };
}

async function postTokenForm(bodyObj) {
  const cfg = getOAuthConfig();
  const basic = Buffer.from(
    `${cfg.clientId}:${cfg.clientSecret}`,
    "utf8",
  ).toString("base64");

  const res = await fetch(INTUIT_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: querystring.stringify(bodyObj),
  });

  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    const err = new Error(
      `Intuit token endpoint returned non-JSON (${res.status}).`,
    );
    err.code = "QB_TOKEN_NON_JSON";
    err.httpStatus = res.status;
    err.rawBody = text.slice(0, 500);
    throw err;
  }

  if (!res.ok) {
    const msg =
      json.error_description ||
      json.error ||
      `Intuit token request failed (${res.status}).`;
    const err = new Error(msg);
    err.code = "QB_TOKEN_HTTP_ERROR";
    err.httpStatus = res.status;
    err.intuitError = json.error;
    throw err;
  }

  return json;
}

/**
 * Build Intuit OAuth 2.0 authorization URL (browser redirect).
 */
function buildAuthorizationUrl({ state }) {
  const cfg = getOAuthConfig();
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    response_type: "code",
    scope: ACCOUNTING_SCOPE,
    state,
  });
  return `${cfg.authorizationUrl}?${params.toString()}`;
}

/**
 * Exchange authorization code for tokens.
 */
async function exchangeCodeForTokens({ code }) {
  const cfg = getOAuthConfig();
  const payload = await postTokenForm({
    grant_type: "authorization_code",
    code,
    redirect_uri: cfg.redirectUri,
  });
  return normalizeTokenResponse(payload, ACCOUNTING_SCOPE);
}

/**
 * Refresh access token using refresh_token grant.
 */
async function refreshAccessToken({ refreshToken }) {
  const payload = await postTokenForm({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
  return normalizeTokenResponse(payload, {
    fallbackRefreshToken: refreshToken,
    allowReuseRefreshToken: true,
    fallbackScopes: ACCOUNTING_SCOPE,
  });
}

module.exports = {
  ACCOUNTING_SCOPE,
  buildAuthorizationUrl,
  exchangeCodeForTokens,
  refreshAccessToken,
};
