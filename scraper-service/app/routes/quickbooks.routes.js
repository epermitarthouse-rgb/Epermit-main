"use strict";

const crypto = require("crypto");
const { Router } = require("express");
const {
  getEnvironment,
  getOAuthConfig,
  getRedirectUrls,
} = require("../services/quickbooks/qb-config.js");
const {
  buildAuthorizationUrl,
  exchangeCodeForTokens,
} = require("../services/quickbooks/qb-oauth.service.js");
const tokenStore = require("../services/quickbooks/qb-token-store.js");
const {
  getEncryptionKeyDiagnostics,
} = require("../services/quickbooks/qb-token-crypto.js");
const {
  createSignedQuickBooksOAuthState,
  verifySignedQuickBooksOAuthState,
  consumeQuickBooksOAuthNonce,
  maskRealmId,
} = require("../services/quickbooks/qb-oauth-state.service.js");
const {
  generateInvoicePayload,
} = require("../services/quickbooks/qb-invoice-payload.js");
const qbApi = require("../services/quickbooks/qb-api.service.js");
const {
  InvoiceTriggerError,
  executeInvoiceTrigger,
} = require("../services/quickbooks/qb-invoice-trigger.service.js");
const {
  getAuthenticatedUser,
  requireAuthenticatedUser,
  sanitizeUciError,
} = require("../services/uci/uci-access.service.js");

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
    realmIdMasked: maskRealmId(realmId),
    tokenResponseHasAccessToken: Boolean(tokens?.accessToken),
    tokenResponseHasRefreshToken: Boolean(tokens?.refreshToken),
    encryptedRefreshTokenGenerated: Boolean(err.qbEncryptedRefreshTokenGenerated),
    qbTokenEncryptionKeyPresent: keyDiag.keyPresent,
    qbTokenEncryptionKeyDecodedByteLength: keyDiag.decodedByteLength,
    supabaseErrorMessage: cause?.message ?? null,
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
 * Redirect targets are fixed env vars only — never from request input.
 * @param {'success'|'failure'} kind
 */
function safeRedirectBase(kind) {
  const { success: okUrl, failure: failUrl } = getRedirectUrls();
  const base = kind === "success" ? okUrl : failUrl;
  try {
    const parsed = new URL(base);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw new Error("invalid protocol");
    }
    return parsed.toString();
  } catch {
    return kind === "success" ? "http://localhost:5001" : "http://localhost:5001";
  }
}

/**
 * @param {import("express").Request} req
 */
function wantsJsonStartResponse(req) {
  const f = String(req.query.format || "").trim().toLowerCase();
  if (f === "json") return true;
  const accept = String(req.headers.accept || "");
  return accept.includes("application/json");
}

/**
 * @param {{ supabase: import("@supabase/supabase-js").SupabaseClient }} opts
 */
function createQuickBooksRouter(opts) {
  const { supabase } = opts;
  const router = Router();

  router.get("/oauth/start", async (req, res) => {
    const json = wantsJsonStartResponse(req);
    try {
      getOAuthConfig();
      getEncryptionKeyDiagnostics();
    } catch (e) {
      const body = {
        error: "quickbooks_oauth_unconfigured",
        message: e.message || String(e),
      };
      if (json) return res.status(503).json(body);
      return res.status(503).send("QuickBooks OAuth is not configured.");
    }

    let user;
    try {
      user = await requireAuthenticatedUser(req, supabase);
    } catch (err) {
      if (json) {
        const s = sanitizeUciError(err);
        return res.status(s.httpStatus).json(s.body);
      }
      return res.status(401).send("Authentication required.");
    }

    let state;
    try {
      state = createSignedQuickBooksOAuthState({ userId: String(user.id) });
    } catch (e) {
      if (json) {
        return res.status(503).json({
          error: "oauth_state_failure",
          message: "Could not prepare QuickBooks OAuth state.",
        });
      }
      return res.status(503).send("Could not prepare QuickBooks OAuth.");
    }

    let authUrl;
    try {
      authUrl = buildAuthorizationUrl({ state });
    } catch (e) {
      if (json) {
        return res.status(503).json({
          error: "quickbooks_oauth_unconfigured",
          message: e.message || String(e),
        });
      }
      return res.status(503).send("QuickBooks OAuth is not configured.");
    }

    if (json) return res.status(200).json({ authorizeUrl: authUrl, environment: getEnvironment() });
    return res.redirect(302, authUrl);
  });

  router.get("/oauth/callback", async (req, res) => {
    const failUrl = safeRedirectBase("failure");
    const okUrl = safeRedirectBase("success");

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
    const stateRaw =
      typeof req.query.state === "string" ? req.query.state.trim() : "";

    if (!stateRaw) {
      return res.redirect(
        302,
        appendQuery(failUrl, { qb_error: "missing_state" }),
      );
    }

    const decoded = verifySignedQuickBooksOAuthState(stateRaw);
    if (!decoded) {
      return res.redirect(
        302,
        appendQuery(failUrl, { qb_error: "invalid_state" }),
      );
    }

    consumeQuickBooksOAuthNonce(decoded.nonce);

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
        userId: decoded.userId,
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
    const auth = await getAuthenticatedUser(req, supabase);
    if (!auth.user) {
      return res.status(auth.error?.status ?? 401).json({
        error: auth.error?.code ?? "UNAUTHENTICATED",
        message: auth.error?.message ?? "Authentication required.",
      });
    }

    try {
      const result = await executeInvoiceTrigger(supabase, req.body || {}, {
        userId: String(auth.user.id),
      });
      return res.status(200).json(result);
    } catch (err) {
      if (err instanceof InvoiceTriggerError) {
        const body = {
          error: err.code,
          message: err.message,
        };
        if (err.details) body.details = err.details;
        return res.status(err.httpStatus).json(body);
      }
      console.error("[invoice/trigger]", err.message || err);
      return res.status(500).json({
        error: "invoice_trigger_failed",
        message: "An unexpected server error occurred.",
      });
    }
  });

  router.get("/status", async (req, res) => {
    const environment = getEnvironment();
    const auth = await getAuthenticatedUser(req, supabase);

    try {
      const row = await tokenStore.getLatestConnection(supabase, {
        environment,
      });

      if (!row) {
        if (!auth.user) {
          return res.json({ connected: false });
        }
        return res.json({
          connected: false,
          environment,
        });
      }

      if (!auth.user) {
        return res.json({ connected: true });
      }

      const expiryMeta = qbApi.getCachedAccessTokenExpiryMeta(
        row.realm_id,
        row.environment || environment,
      );

      return res.json({
        connected: true,
        environment: row.environment || environment,
        realmIdMasked: maskRealmId(row.realm_id),
        accessTokenExpiresAt: expiryMeta?.accessTokenExpiresAt ?? null,
      });
    } catch (e) {
      return res.status(500).json({
        error: "quickbooks_status_failed",
        message: "Could not read QuickBooks connection status.",
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
