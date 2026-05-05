"use strict";

/**
 * Persist QuickBooks tokens via Supabase service-role client (backend only).
 */

function mapUpsertRow(params) {
  const {
    realmId,
    accessToken,
    refreshToken,
    accessTokenExpiresAt,
    refreshTokenExpiresAt,
    scopes,
    tokenType,
    environment,
    userId,
    companyName,
  } = params;

  const row = {
    realm_id: realmId,
    access_token: accessToken,
    refresh_token: refreshToken,
    access_token_expires_at:
      accessTokenExpiresAt instanceof Date
        ? accessTokenExpiresAt.toISOString()
        : accessTokenExpiresAt,
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

  return row;
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 */
async function upsertConnection(supabase, params) {
  const row = mapUpsertRow(params);
  const { error } = await supabase.from("quickbooks_connections").upsert(row, {
    onConflict: "environment,realm_id",
  });
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
 * Latest row by updated_at for an environment (includes secrets — HTTP handlers must strip).
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

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 */
async function updateTokens(supabase, params) {
  const {
    realmId,
    environment,
    accessToken,
    refreshToken,
    accessTokenExpiresAt,
    refreshTokenExpiresAt,
    scopes,
    tokenType,
  } = params;

  const patch = {
    access_token: accessToken,
    refresh_token: refreshToken,
    access_token_expires_at:
      accessTokenExpiresAt instanceof Date
        ? accessTokenExpiresAt.toISOString()
        : accessTokenExpiresAt,
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

module.exports = {
  upsertConnection,
  getConnectionByRealm,
  getLatestConnection,
  updateTokens,
};
