"use strict";

const crypto = require("crypto");
const { Router } = require("express");
const { getEnvironment, getOAuthConfig, getRedirectUrls } = require("../services/quickbooks/qb-config.js");
const {
  buildAuthorizationUrl,
  exchangeCodeForTokens,
} = require("../services/quickbooks/qb-oauth.service.js");
const tokenStore = require("../services/quickbooks/qb-token-store.js");
const {
  getEncryptionKeyDiagnostics,
} = require("../services/quickbooks/qb-token-crypto.js");
const {
  generateInvoicePayload,
} = require("../services/quickbooks/qb-invoice-payload.js");
const qbApi = require("../services/quickbooks/qb-api.service.js");
const {
  InvoiceTriggerError,
  executeInvoiceTrigger,
} = require("../services/quickbooks/qb-invoice-trigger.service.js");

/** Offline payload preview only (no Intuit calls). */
function isDevPayloadPreviewEnabled() {
  if (process.env.NODE_ENV === "production") {
    return process.env.QB_DEV_PAYLOAD_PREVIEW === "1";
  }
  return true;
}

/** Live QuickBooks API dev routes (customer-test, items). */
function isDevApiTestEnabled() {
  if (process.env.NODE_ENV === "production") {
    return process.env.QB_DEV_API_TEST === "1";
  }
  return true;
}

/**
 * @param {object} p
 * @param {string} p.environment
 * @param {string} p.realmId
 * @param {{ accessToken?: string, refreshToken?: string }} p.tokens
 * @param {Error & { cause?: unknown, qbEncryptedRefreshTokenGenerated?: boolean }} p.err
 */
function logQuickBooksOAuthCallbackStorageFailure(p) {
  const { environment, realmId, tokens, err } = p;
  const keyDiag = getEncryptionKeyDiagnostics();
  const cause =
    err.cause && typeof err.cause === "object"
      ? /** @type {{ message?: string, details?: string, hint?: string, code?: string }} */ (
          err.cause
        )
      : null;
  const stackLines =
    typeof err.stack === "string" ? err.stack.split("\n") : [];
  const stackFirstTwoLines = stackLines
    .slice(0, 2)
    .map((line) => line.trim())
    .join("\n");

  console.error("[QuickBooks][OAuthCallback] reached callback", {
    environment,
    realmId,
    tokenResponseHasAccessToken: Boolean(tokens?.accessToken),
    tokenResponseHasRefreshToken: Boolean(tokens?.refreshToken),
    encryptedRefreshTokenGenerated: Boolean(err.qbEncryptedRefreshTokenGenerated),
    qbTokenEncryptionKeyPresent: keyDiag.keyPresent,
    qbTokenEncryptionKeyDecodedByteLength: keyDiag.decodedByteLength,
    supabaseErrorMessage: cause?.message ?? null,
    supabaseErrorDetails: cause?.details ?? null,
    supabaseErrorHint: cause?.hint ?? null,
    supabaseErrorCode: cause?.code ?? null,
    caughtErrorMessage: err.message || String(err),
    stackFirstTwoLines,
  });
}

function appendQuery(url, params) {
  try {
    const u = new URL(url);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) u.searchParams.set(k, String(v));
    }
    return u.toString();
  } catch {
    const sep = url.includes("?") ? "&" : "?";
    const q = new URLSearchParams(params).toString();
    return `${url}${sep}${q}`;
  }
}

/**
 * @param {{ supabase: import("@supabase/supabase-js").SupabaseClient }} opts
 */
function createQuickBooksRouter(opts) {
  const { supabase } = opts;
  const router = Router();

  router.get("/oauth/start", (req, res) => {
    try {
      getOAuthConfig();
    } catch (e) {
      return res.status(503).json({
        error: "quickbooks_oauth_unconfigured",
        message: e.message || String(e),
      });
    }

    // TODO: Bind state to server-side session (or signed cookie) and validate on callback (CSRF).
    const state = crypto.randomBytes(24).toString("hex");

    let authUrl;
    try {
      authUrl = buildAuthorizationUrl({ state });
    } catch (e) {
      return res.status(503).json({
        error: "quickbooks_oauth_unconfigured",
        message: e.message || String(e),
      });
    }

    return res.redirect(302, authUrl);
  });

  router.get("/oauth/callback", async (req, res) => {
    const { success: okUrl, failure: failUrl } = getRedirectUrls();

    const intuitError = req.query.error;
    if (intuitError) {
      const safe =
        typeof intuitError === "string"
          ? intuitError.slice(0, 120)
          : "access_denied";
      return res.redirect(
        302,
        appendQuery(failUrl, { qb_error: safe }),
      );
    }

    const code = req.query.code;
    const realmId = req.query.realmId;

    // TODO: Validate req.query.state against stored value from /oauth/start.
    if (!code || typeof code !== "string") {
      return res.redirect(
        302,
        appendQuery(failUrl, { qb_error: "missing_code" }),
      );
    }
    if (!realmId || typeof realmId !== "string") {
      return res.redirect(
        302,
        appendQuery(failUrl, { qb_error: "missing_realm" }),
      );
    }

    let tokens;
    try {
      getOAuthConfig();
      tokens = await exchangeCodeForTokens({ code });
    } catch (e) {
      const codeHint =
        e.code === "QB_CONFIG_MISSING"
          ? "oauth_not_configured"
          : "token_exchange_failed";
      return res.redirect(
        302,
        appendQuery(failUrl, { qb_error: codeHint }),
      );
    }

    const environment = getEnvironment();

    try {
      await tokenStore.upsertConnection(supabase, {
        realmId,
        refreshToken: tokens.refreshToken,
        refreshTokenExpiresAt: tokens.refreshTokenExpiresAt,
        accessTokenExpiresAt: tokens.accessTokenExpiresAt,
        expiresInSeconds: tokens.expiresInSeconds,
        scopes: tokens.scopes,
        tokenType: tokens.tokenType,
        environment,
      });
      qbApi.primeAccessTokenCache(
        realmId,
        environment,
        tokens.accessToken,
        tokens.accessTokenExpiresAt,
      );
    } catch (e) {
      if (
        e.code === "quickbooks_token_encryption_unconfigured" ||
        e.code === "QB_TOKEN_ENCRYPTION_KEY_INVALID"
      ) {
        return res.redirect(
          302,
          appendQuery(failUrl, { qb_error: "token_encryption_unconfigured" }),
        );
      }
      logQuickBooksOAuthCallbackStorageFailure({
        environment,
        realmId,
        tokens,
        err: e,
      });
      return res.redirect(
        302,
        appendQuery(failUrl, { qb_error: "storage_failed" }),
      );
    }

    return res.redirect(302, okUrl);
  });

  router.post("/invoice/trigger", async (req, res) => {
    try {
      const result = await executeInvoiceTrigger(supabase, req.body || {});
      return res.status(200).json(result);
    } catch (err) {
      if (err instanceof InvoiceTriggerError) {
        return res.status(err.httpStatus).json({
          error: err.code,
          message: err.message,
        });
      }
      console.error("[invoice/trigger]", err.message || err);
      return res.status(500).json({
        error: "invoice_trigger_failed",
        message: err.message || String(err),
      });
    }
  });

  router.get("/status", async (_req, res) => {
    const environment = getEnvironment();
    try {
      const row = await tokenStore.getLatestConnection(supabase, {
        environment,
      });

      if (!row) {
        return res.json({
          connected: false,
          environment,
        });
      }

      const expiryMeta = qbApi.getCachedAccessTokenExpiryMeta(
        row.realm_id,
        row.environment || environment,
      );

      return res.json({
        connected: true,
        realmId: row.realm_id,
        environment: row.environment || environment,
        accessTokenExpiresAt: expiryMeta?.accessTokenExpiresAt ?? null,
      });
    } catch (e) {
      return res.status(500).json({
        error: "quickbooks_status_failed",
        message: e.message || String(e),
      });
    }
  });

  router.post("/dev/payload-preview", (req, res) => {
    if (!isDevPayloadPreviewEnabled()) {
      return res.status(404).json({ error: "not_found" });
    }

    const body = req.body;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return res.status(400).json({
        error: "invalid_body",
        message: "JSON object body required.",
      });
    }

    try {
      const { payload, totals } = generateInvoicePayload(body);
      return res.json({ payload, totals });
    } catch (e) {
      return res.status(400).json({
        error: "payload_preview_failed",
        message: e.message || String(e),
      });
    }
  });

  function quickBooksDevError(res, err) {
    if (err.code === "QB_NOT_CONNECTED") {
      return res.status(503).json({
        error: "quickbooks_not_connected",
        message: err.message,
      });
    }
    if (err.code === "QB_CONFIG_MISSING") {
      return res.status(503).json({
        error: "quickbooks_oauth_unconfigured",
        message: err.message,
      });
    }
    if (err.code === "QB_TOKEN_REFRESH_FAILED") {
      return res.status(503).json({
        error: "quickbooks_token_refresh_failed",
        message: err.message,
      });
    }
    if (
      err.code === "QB_TOKEN_DECRYPT_FAILED" ||
      err.code === "quickbooks_token_encryption_unconfigured" ||
      err.code === "QB_TOKEN_ENCRYPTION_KEY_INVALID" ||
      err.code === "QB_REFRESH_MISSING"
    ) {
      return res.status(503).json({
        error: err.code,
        message: err.message,
      });
    }
    if (err instanceof qbApi.QuickBooksApiError) {
      const status =
        typeof err.httpStatus === "number" &&
        err.httpStatus >= 400 &&
        err.httpStatus < 600
          ? err.httpStatus
          : 502;
      return res.status(status).json({
        error: "quickbooks_api_error",
        message: err.message,
        intuitCode: err.intuitCode,
      });
    }
    return res.status(500).json({
      error: "quickbooks_internal_error",
      message: err.message || String(err),
    });
  }

  router.post("/dev/customer-test", async (req, res) => {
    if (!isDevApiTestEnabled()) {
      return res.status(404).json({ error: "not_found" });
    }

    const body = req.body;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return res.status(400).json({
        error: "invalid_body",
        message: "JSON object body required.",
      });
    }

    const name =
      body.name != null && String(body.name).trim()
        ? String(body.name).trim()
        : "";
    const email =
      body.email != null && String(body.email).trim()
        ? String(body.email).trim()
        : "";

    if (!name) {
      return res.status(400).json({
        error: "invalid_body",
        message: 'Field "name" is required.',
      });
    }

    try {
      const result = await qbApi.getOrCreateCustomer(supabase, {
        name,
        email: email || undefined,
      });
      return res.json({
        customer: {
          id: result.id,
          displayName: result.displayName,
          email: result.email,
        },
        created: result.created,
      });
    } catch (err) {
      return quickBooksDevError(res, err);
    }
  });

  router.get("/dev/items", async (_req, res) => {
    if (!isDevApiTestEnabled()) {
      return res.status(404).json({ error: "not_found" });
    }

    try {
      const items = await qbApi.fetchQuickBooksItems(supabase, {
        forceRefresh: false,
      });
      return res.json({ items, count: items.length });
    } catch (err) {
      return quickBooksDevError(res, err);
    }
  });

  return router;
}

module.exports = {
  createQuickBooksRouter,
};
