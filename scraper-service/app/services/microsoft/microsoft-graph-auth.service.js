"use strict";

const crypto = require("crypto");
const {
  encryptTokenPlainJson,
  decryptTokenPlainJson,
  loadKeyBytes,
  getEncryptionKeyDiagnostics,
} = require("./microsoft-token-crypto.js");

const GRAPH_SCOPES =
  "openid profile offline_access User.Read Mail.Read email";

/** @type {readonly string[]} */
const MS_GRAPH_EXPECTED_MAILBOX_LOWER = ["permitting@commun-et.com"];

/**
 * Returns signing material derived from encryption key bytes (never exposed).
 */
function stateSigningSecret() {
  const k = loadKeyBytes();
  return crypto.createHash("sha256").update(k).digest(); // 32 bytes
}

/**
 * @param {{ userId: string, mailboxEmail: string }} p
 */
function createSignedOAuthState(p) {
  const payloadBuf = Buffer.from(
    JSON.stringify({
      u: String(p.userId),
      m: String(p.mailboxEmail).trim().toLowerCase(),
      exp: Math.floor(Date.now() / 1000) + 900,
      i: crypto.randomBytes(16).toString("hex"),
    }),
    "utf8",
  );
  const payload = payloadBuf.toString("base64url");
  const sig = crypto.createHmac("sha256", stateSigningSecret()).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

/**
 * @param {string | undefined | null} state
 * @returns {{ userId: string, mailboxEmail: string } | null}
 */
function verifySignedOAuthState(state) {
  if (!state || typeof state !== "string") return null;
  const sep = ".";
  const idx = state.indexOf(sep);
  if (idx <= 0) return null;
  const payload = state.slice(0, idx);
  const sig = state.slice(idx + 1);
  if (!payload || !sig) return null;
  const expected = crypto
    .createHmac("sha256", stateSigningSecret())
    .update(payload)
    .digest();
  try {
    const sigBuf = Buffer.from(sig, "base64url");
    if (sigBuf.length !== expected.length) return null;
    if (!crypto.timingSafeEqual(sigBuf, expected)) return null;
  } catch {
    return null;
  }

  let obj;
  try {
    obj = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  const now = Math.floor(Date.now() / 1000);
  if (
    !obj ||
    typeof obj !== "object" ||
    typeof obj.u !== "string" ||
    typeof obj.m !== "string" ||
    typeof obj.exp !== "number" ||
    obj.exp < now
  ) {
    return null;
  }
  return { userId: obj.u.trim(), mailboxEmail: obj.m.trim().toLowerCase() };
}

function getMsOAuthConfigOrThrow() {
  const tenantId =
    process.env.MS_GRAPH_TENANT_ID && String(process.env.MS_GRAPH_TENANT_ID).trim();
  const clientId =
    process.env.MS_GRAPH_CLIENT_ID && String(process.env.MS_GRAPH_CLIENT_ID).trim();
  const clientSecret =
    process.env.MS_GRAPH_CLIENT_SECRET && String(process.env.MS_GRAPH_CLIENT_SECRET).trim();
  const redirectUri =
    process.env.MS_GRAPH_REDIRECT_URI && String(process.env.MS_GRAPH_REDIRECT_URI).trim();

  if (!tenantId || !clientId || !clientSecret || !redirectUri) {
    const err = new Error(
      "Microsoft Graph OAuth is not fully configured (MS_GRAPH_TENANT_ID, MS_GRAPH_CLIENT_ID, MS_GRAPH_CLIENT_SECRET, MS_GRAPH_REDIRECT_URI).",
    );
    err.code = "MS_GRAPH_CONFIG_MISSING";
    throw err;
  }

  return { tenantId, clientId, clientSecret, redirectUri };
}

function buildAuthorizeUrl(state) {
  const { tenantId, clientId, redirectUri } = getMsOAuthConfigOrThrow();
  const base = `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/authorize`;
  const u = new URL(base);
  u.searchParams.set("client_id", clientId);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("response_mode", "query");
  u.searchParams.set("scope", GRAPH_SCOPES);
  u.searchParams.set("state", state);
  return u.toString();
}

/**
 * @param {string} body
 * @returns {Promise<Record<string, unknown>>}
 */
async function fetchFormPost(urlStr, body) {
  const r = await fetch(urlStr, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const text = await r.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: "(non-json response)" };
  }
  if (!r.ok) {
    const msg =
      typeof json.error_description === "string"
        ? json.error_description.slice(0, 300)
        : typeof json.error === "string"
          ? json.error
          : `token_http_${r.status}`;
    const err = new Error(`Microsoft token endpoint error: ${msg}`);
    /** @type {Error & { code?: string }} */ (err).code = "MS_GRAPH_TOKEN_FAILED";
    throw err;
  }
  return typeof json === "object" && json ? /** @type {Record<string, unknown>} */ (json) : {};
}

/**
 * @param {string} code
 */
async function exchangeAuthCodeForTokens(code) {
  const { tenantId, clientId, clientSecret, redirectUri } = getMsOAuthConfigOrThrow();
  const tokenUrl = `https://login.microsoftonline.com/${encodeURIComponent(
    tenantId,
  )}/oauth2/v2.0/token`;
  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    scope: GRAPH_SCOPES,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
    code: String(code),
  });
  return fetchFormPost(tokenUrl, params.toString());
}

/**
 * @param {string} refreshToken
 */
async function refreshDelegatedTokens(refreshToken) {
  const { tenantId, clientId, clientSecret } = getMsOAuthConfigOrThrow();
  const tokenUrl = `https://login.microsoftonline.com/${encodeURIComponent(
    tenantId,
  )}/oauth2/v2.0/token`;
  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "refresh_token",
    refresh_token: String(refreshToken),
  });
  return fetchFormPost(tokenUrl, params.toString());
}

/**
 * @param {string} accessToken
 */
async function fetchGraphMe(accessToken) {
  const r = await fetch("https://graph.microsoft.com/v1.0/me?$select=id,mail,userPrincipalName", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const text = await r.text();
  /** @type {Record<string, unknown>} */
  let json = {};
  try {
    json = JSON.parse(text);
  } catch {
    json = {};
  }
  if (!r.ok) {
    const msg = typeof json.error === "object" && json.error && typeof json.error.message === "string"
      ? json.error.message
      : `graph_me_http_${r.status}`;
    const err = new Error(`Microsoft Graph /me failed: ${String(msg).slice(0, 200)}`);
    /** @type {Error & { code?: string }} */ (err).code = "MS_GRAPH_ME_FAILED";
    throw err;
  }
  return json;
}

/**
 * @param {Record<string, unknown>} tokenResp
 */
function normalizeDelegatedTokenEnvelope(tokenResp) {
  const accessToken =
    typeof tokenResp.access_token === "string" ? tokenResp.access_token : "";
  const refreshToken =
    typeof tokenResp.refresh_token === "string" ? tokenResp.refresh_token : "";

  /** @type {number | undefined} */
  let expiresIn;
  const rawIn = tokenResp.expires_in;
  if (typeof rawIn === "number" && Number.isFinite(rawIn)) expiresIn = rawIn;
  else if (typeof rawIn === "string" && /^[0-9]+$/.test(rawIn)) expiresIn = Number(rawIn);

  const scopeRaw = typeof tokenResp.scope === "string" ? tokenResp.scope : "";
  const scopes = scopeRaw.split(/\s+/).filter(Boolean);
  const tokenType =
    typeof tokenResp.token_type === "string" ? tokenResp.token_type : "Bearer";

  const expiresAt =
    expiresIn != null
      ? new Date(Date.now() + Math.max(0, expiresIn) * 1000).toISOString()
      : null;

  return { accessToken, refreshToken, scopes, tokenType, expiresAt };
}

function assertMailboxEmailMatchesExpected(mail) {
  const m = String(mail || "").trim().toLowerCase();
  if (!m) return;
  if (
    MS_GRAPH_EXPECTED_MAILBOX_LOWER.length > 0 &&
    !MS_GRAPH_EXPECTED_MAILBOX_LOWER.includes(m)
  ) {
    console.warn("[MicrosoftGraph] Mailbox principal does not match expected configured mailbox:", {
      expectedOneOf: [...MS_GRAPH_EXPECTED_MAILBOX_LOWER],
      mailboxLowerLength: m.length,
    });
  }
}

function primaryMailboxFromMe(me) {
  const mail =
    typeof me.mail === "string" && me.mail.trim() ? me.mail.trim() : null;
  const upn =
    typeof me.userPrincipalName === "string" && me.userPrincipalName.trim()
      ? me.userPrincipalName.trim()
      : null;
  return mail || upn || null;
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {{
 *   userId: string;
 *   mailboxEmailHint: string;
 *   tenantIdUsed: string;
 *   clientIdUsed: string;
 *   delegateTokenEnvelope: Record<string, unknown>;
 * }} p
 */
async function upsertEncryptedMailboxConnectionRow(supabase, p) {
  const normalized = normalizeDelegatedTokenEnvelope(p.delegateTokenEnvelope);
  if (!normalized.accessToken) {
    const err = new Error("Missing access token from Microsoft OAuth response.");
    /** @type {Error & { code?: string }} */ (err).code = "MS_GRAPH_TOKEN_INCOMPLETE";
    throw err;
  }

  let priorRefreshToken = "";

  try {
    const { data } = await supabase
      .from("microsoft_mailbox_connections")
      .select("encrypted_token_json")
      .eq("user_id", p.userId)
      .maybeSingle();

    const enc = data && typeof data.encrypted_token_json === "string" ? data.encrypted_token_json : "";
    if (enc) {
      const prev = decryptTokenPlainJson(enc);
      priorRefreshToken = typeof prev.refresh_token === "string" ? prev.refresh_token : "";
    }
  } catch {
    /** ignore decryption errors reading prior row — new tokens still apply */
    priorRefreshToken = "";
  }

  const mergedRefresh =
    normalized.refreshToken && normalized.refreshToken.length > 0
      ? normalized.refreshToken
      : priorRefreshToken;

  /** @type {Record<string, unknown>} */
  const tokenJsonToEncrypt = {
    access_token: normalized.accessToken,
    refresh_token: mergedRefresh,
    token_type: normalized.tokenType,
    expires_at_iso: normalized.expiresAt,
    scopes: normalized.scopes,
    updated_via: "oauth",
  };

  const encryptedPayload = encryptTokenPlainJson(tokenJsonToEncrypt);

  const nowIso = new Date().toISOString();

  const { error } = await supabase.from("microsoft_mailbox_connections").upsert(
    {
      user_id: p.userId,
      mailbox_email:
        typeof p.mailboxEmailHint === "string" && p.mailboxEmailHint.trim()
          ? p.mailboxEmailHint.trim()
          : "unknown",
      tenant_id: String(p.tenantIdUsed || "").trim(),
      client_id: String(p.clientIdUsed || "").trim(),
      encrypted_token_json: encryptedPayload,
      token_expires_at: normalized.expiresAt ? normalized.expiresAt : null,
      scopes: normalized.scopes,
      status: "connected",
      last_connected_at: nowIso,
      last_checked_at: null,
      last_error: null,
    },
    { onConflict: "user_id" },
  );

  if (error) {
    const err = new Error(error.message || "Could not persist Microsoft mailbox connection.");
    /** @type {Error & { cause?: unknown, code?: string }} */ (err).cause = error;
    err.code = "MS_GRAPH_DB_UPSERT_FAILED";
    throw err;
  }

  console.log("[MicrosoftGraph] Stored encrypted delegated tokens for user mailbox connection:", {
    userIdPrefix:
      typeof p.userId === "string" && p.userId.length > 12
        ? `${p.userId.slice(0, 12)}…`
        : "(short)",
    hasRefreshTokenStored: mergedRefresh.length > 0,
  });
}

function logOAuthUpsertDiagnostics(err) {
  const keyDiag = getEncryptionKeyDiagnostics();
  console.error("[MicrosoftGraph][OAuthCallback] storage failure", {
    msGraphTokenEncryptionKeyPresent: keyDiag.keyPresent,
    msGraphTokenEncryptionKeyDecodedByteLength: keyDiag.decodedByteLength,
    message: err instanceof Error ? err.message : String(err),
    code:
      typeof err === "object" && err !== null && "code" in err
        ? String(/** @type {{ code?: string }} */ (err).code)
        : null,
  });
}

/**
 * @param {Record<string, unknown>} tokenJsonDecrypted
 * @returns {string|null}
 */
function accessExpiryIso(tokenJsonDecrypted) {
  const v = tokenJsonDecrypted.expires_at_iso;
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

const REFRESH_SLOP_MS = 90_000;

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} userId
 * @returns {Promise<string>}
 */
async function getValidAccessTokenForUser(supabase, userId) {
  const { decrypted } = await loadDecryptedDelegatedTokensOrThrow(supabase, userId);
  const iso = accessExpiryIso(decrypted);
  const expMs = iso ? Date.parse(iso) : NaN;

  /** @type {string} */
  const access = typeof decrypted.access_token === "string" ? decrypted.access_token : "";
  /** @type {string} */
  const refresh = typeof decrypted.refresh_token === "string" ? decrypted.refresh_token : "";

  if (!access) {
    const err = new Error("Microsoft token bundle missing access_token.");
    /** @type {Error & { code?: string }} */ (err).code = "MS_GRAPH_TOKEN_INCOMPLETE";
    throw err;
  }

  if (Number.isFinite(expMs) && Date.now() < expMs - REFRESH_SLOP_MS) {
    return access;
  }

  if (!refresh) {
    const err = new Error("Microsoft access token expired and no refresh token is available.");
    /** @type {Error & { code?: string }} */ (err).code = "MS_GRAPH_REAUTH_REQUIRED";
    throw err;
  }

  const refreshed = await refreshDelegatedTokens(refresh);
  const normalized = normalizeDelegatedTokenEnvelope(refreshed);
  const nextRefresh =
    normalized.refreshToken && normalized.refreshToken.length > 0
      ? normalized.refreshToken
      : refresh;

  const nextEnc = encryptTokenPlainJson({
    access_token: normalized.accessToken,
    refresh_token: nextRefresh,
    token_type: normalized.tokenType,
    expires_at_iso: normalized.expiresAt,
    scopes: normalized.scopes,
    updated_via: "refresh",
  });

  const { error } = await supabase
    .from("microsoft_mailbox_connections")
    .update({
      encrypted_token_json: nextEnc,
      token_expires_at: normalized.expiresAt,
      scopes: normalized.scopes,
      last_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId);

  if (error) {
    const err = new Error(error.message || "Could not refresh Microsoft tokens.");
    /** @type {Error & { cause?: unknown, code?: string }} */ (err).cause = error;
    err.code = "MS_GRAPH_DB_REFRESH_FAILED";
    throw err;
  }

  if (!normalized.accessToken) {
    const err = new Error("Refresh response missing access token.");
    /** @type {Error & { code?: string }} */ (err).code = "MS_GRAPH_TOKEN_INCOMPLETE";
    throw err;
  }

  return normalized.accessToken;
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} userId
 * @returns {Promise<{ tenantIdUsed: string, decrypted: Record<string, unknown> }>}
 */
async function loadDecryptedDelegatedTokensOrThrow(supabase, userId) {
  const { data, error } = await supabase
    .from("microsoft_mailbox_connections")
    .select("tenant_id, encrypted_token_json, status")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    const err = new Error(error.message || "Could not load Microsoft mailbox connection.");
    /** @type {Error & { cause?: unknown, code?: string }} */ (err).cause = error;
    err.code = "MS_GRAPH_DB_LOAD_FAILED";
    throw err;
  }
  if (!data || String(data.status || "") !== "connected") {
    const err = new Error("Microsoft mailbox is not connected for this user.");
    /** @type {Error & { code?: string }} */ (err).code = "MS_GRAPH_NOT_CONNECTED";
    throw err;
  }

  const tid = typeof data.tenant_id === "string" ? data.tenant_id : "";
  const enc = typeof data.encrypted_token_json === "string" ? data.encrypted_token_json : "";
  if (!enc) {
    const err = new Error("Microsoft mailbox token row is empty.");
    /** @type {Error & { code?: string }} */ (err).code = "MS_GRAPH_TOKEN_INCOMPLETE";
    throw err;
  }

  const decrypted = decryptTokenPlainJson(enc);
  return { tenantIdUsed: tid, decrypted };
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} userId
 * @param {string} lastError
 */
async function markMailboxConnectionError(supabase, userId, lastError) {
  await supabase
    .from("microsoft_mailbox_connections")
    .update({
      last_error: String(lastError || "").slice(0, 2000),
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId);
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} userId
 */
async function touchMailboxLastCheckedAt(supabase, userId) {
  await supabase
    .from("microsoft_mailbox_connections")
    .update({
      last_checked_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId);
}

module.exports = {
  GRAPH_SCOPES,
  createSignedOAuthState,
  verifySignedOAuthState,
  getMsOAuthConfigOrThrow,
  buildAuthorizeUrl,
  exchangeAuthCodeForTokens,
  refreshDelegatedTokens,
  fetchGraphMe,
  upsertEncryptedMailboxConnectionRow,
  primaryMailboxFromMe,
  assertMailboxEmailMatchesExpected,
  getValidAccessTokenForUser,
  logOAuthUpsertDiagnostics,
  markMailboxConnectionError,
  touchMailboxLastCheckedAt,
};
