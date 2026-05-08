"use strict";

const { encryptToken, decryptToken } = require("./qb-token-crypto.js");

const FALLBACK_ACCESS_TOKEN_TTL_MS = 55 * 60 * 1000;

/**
 * DB column `access_token_expires_at`: last-known access token TTL (access token is not persisted).
 * Intuit uses `expires_in` (seconds); `./qb-oauth.service.js` maps that to `accessTokenExpiresAt` (Date).
 *
 * @param {{ accessTokenExpiresAt?: Date | string | null, expiresInSeconds?: number | null }} input
 * @returns {string} ISO 8601
 */
function resolveAccessTokenExpiresAtIso(input) {
  const { accessTokenExpiresAt, expiresInSeconds } = input;
  if (accessTokenExpiresAt != null) {
    const d =
      accessTokenExpiresAt instanceof Date
        ? accessTokenExpiresAt
        : new Date(accessTokenExpiresAt);
    if (Number.isFinite(d.getTime())) {
      return d.toISOString();
    }
  }
  const sec = expiresInSeconds == null ? NaN : Number(expiresInSeconds);
  if (Number.isFinite(sec) && sec > 0) {
    return new Date(Date.now() + sec * 1000).toISOString();
  }
  console.warn(
    "[QuickBooks][token-store] Token response missing usable expires_in/accessTokenExpiresAt; using 55m TTL fallback for access_token_expires_at.",
  );
  return new Date(Date.now() + FALLBACK_ACCESS_TOKEN_TTL_MS).toISOString();
}

/**
 * Persist QuickBooks connection metadata + encrypted refresh token (service role only).
 * Access tokens are never written to the database.
 */

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {Record<string, unknown>} row
 * @returns {Promise<Record<string, unknown>>}
 */
async function prepareConnectionRow(supabase, row) {
  if (!row) return row;

  const encPresent =
    row.encrypted_refresh_token != null &&
    String(row.encrypted_refresh_token).trim() !== "";
  const plainRt =
    row.refresh_token != null && String(row.refresh_token).trim() !== ""
      ? String(row.refresh_token).trim()
      : "";
  const plainAt =
    row.access_token != null && String(row.access_token).trim() !== "";

  if (!encPresent && plainRt) {
    const encryptedPayload = encryptToken(plainRt);
    const { error } = await supabase
      .from("quickbooks_connections")
      .update({
        encrypted_refresh_token: encryptedPayload,
        refresh_token_encrypted_at: new Date().toISOString(),
        encrypted_token_version: "v1",
        refresh_token: null,
        access_token: null,
      })
      .eq("realm_id", row.realm_id)
      .eq("environment", row.environment);

    if (error) {
      throw Object.assign(new Error(error.message), { cause: error });
    }

    return {
      ...row,
      encrypted_refresh_token: encryptedPayload,
      refresh_token_encrypted_at: new Date().toISOString(),
      encrypted_token_version: "v1",
      refresh_token: null,
      access_token: null,
      access_token_expires_at: row.access_token_expires_at,
    };
  }

  if (encPresent && (plainRt || plainAt)) {
    const { error } = await supabase
      .from("quickbooks_connections")
      .update({
        refresh_token: null,
        access_token: null,
      })
      .eq("realm_id", row.realm_id)
      .eq("environment", row.environment);

    if (error) {
      throw Object.assign(new Error(error.message), { cause: error });
    }

    return {
      ...row,
      refresh_token: null,
      access_token: null,
      access_token_expires_at: row.access_token_expires_at,
    };
  }

  return row;
}

/**
 * Decrypt stored refresh token after prepareConnectionRow.
 *
 * @param {Record<string, unknown>} row
 */
function getDecryptedRefreshToken(row) {
  const enc =
    row.encrypted_refresh_token != null
      ? String(row.encrypted_refresh_token).trim()
      : "";
  if (!enc) {
    const err = new Error(
      "QuickBooks connection has no encrypted refresh token.",
    );
    err.code = "QB_REFRESH_MISSING";
    throw err;
  }
  return decryptToken(enc);
}

/**
 * OAuth callback: store encrypted refresh + metadata; never persist access_token.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 */
async function upsertConnection(supabase, params) {
  const {
    realmId,
    refreshToken,
    refreshTokenExpiresAt,
    accessTokenExpiresAt,
    expiresInSeconds,
    scopes,
    tokenType,
    environment,
    userId,
    companyName,
  } = params;

  const encryptedPayload = encryptToken(refreshToken);

  const accessTokenExpiresAtIso = resolveAccessTokenExpiresAtIso({
    accessTokenExpiresAt,
    expiresInSeconds,
  });
  if (!accessTokenExpiresAtIso) {
    throw new Error(
      "QuickBooks access_token_expires_at missing before token storage",
    );
  }

  /** @type {Record<string, unknown>} */
  const row = {
    realm_id: realmId,
    encrypted_refresh_token: encryptedPayload,
    refresh_token_encrypted_at: new Date().toISOString(),
    encrypted_token_version: "v1",
    refresh_token: null,
    access_token: null,
    access_token_expires_at: accessTokenExpiresAtIso,
    refresh_token_expires_at:
      refreshTokenExpiresAt == null
        ? null
        : refreshTokenExpiresAt instanceof Date
          ? refreshTokenExpiresAt.toISOString()
          : refreshTokenExpiresAt,
    scopes: scopes ?? null,
    token_type: tokenType ?? null,
    environment,
  };

  if (userId !== undefined) row.user_id = userId;
  if (companyName !== undefined) row.company_name = companyName;

  const { error } = await supabase.from("quickbooks_connections").upsert(row, {
    onConflict: "environment",
  });
  if (error) {
    const err = new Error(error.message);
    err.cause = error;
    err.qbEncryptedRefreshTokenGenerated = true;
    throw err;
  }
}

/**
 * After Intuit token refresh: persist rotated encrypted refresh + meta only.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 */
async function persistEncryptedRefreshOnly(supabase, params) {
  const {
    realmId,
    environment,
    refreshTokenPlaintext,
    refreshTokenExpiresAt,
    accessTokenExpiresAt,
    expiresInSeconds,
    scopes,
    tokenType,
  } = params;

  const encryptedPayload = encryptToken(refreshTokenPlaintext);

  const accessTokenExpiresAtIso = resolveAccessTokenExpiresAtIso({
    accessTokenExpiresAt,
    expiresInSeconds,
  });
  if (!accessTokenExpiresAtIso) {
    throw new Error(
      "QuickBooks access_token_expires_at missing before token storage",
    );
  }

  /** @type {Record<string, unknown>} */
  const patch = {
    encrypted_refresh_token: encryptedPayload,
    refresh_token_encrypted_at: new Date().toISOString(),
    encrypted_token_version: "v1",
    refresh_token: null,
    access_token: null,
    access_token_expires_at: accessTokenExpiresAtIso,
    refresh_token_expires_at:
      refreshTokenExpiresAt == null
        ? null
        : refreshTokenExpiresAt instanceof Date
          ? refreshTokenExpiresAt.toISOString()
          : refreshTokenExpiresAt,
    scopes: scopes ?? null,
    token_type: tokenType ?? null,
  };

  const { error } = await supabase
    .from("quickbooks_connections")
    .update(patch)
    .eq("realm_id", realmId)
    .eq("environment", environment);

  if (error) throw Object.assign(new Error(error.message), { cause: error });
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 */
async function getConnectionByRealm(supabase, { realmId, environment }) {
  const { data, error } = await supabase
    .from("quickbooks_connections")
    .select("*")
    .eq("realm_id", realmId)
    .eq("environment", environment)
    .maybeSingle();

  if (error) throw Object.assign(new Error(error.message), { cause: error });
  return data;
}

/**
 * Latest row by updated_at for an environment (never exposes tokens via HTTP — handlers strip).
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 */
async function getLatestConnection(supabase, { environment }) {
  const { data, error } = await supabase
    .from("quickbooks_connections")
    .select("*")
    .eq("environment", environment)
    .order("updated_at", { ascending: false })
    .limit(1);

  if (error) throw Object.assign(new Error(error.message), { cause: error });
  return data?.[0] ?? null;
}

module.exports = {
  upsertConnection,
  getConnectionByRealm,
  getLatestConnection,
  prepareConnectionRow,
  getDecryptedRefreshToken,
  persistEncryptedRefreshOnly,
};
