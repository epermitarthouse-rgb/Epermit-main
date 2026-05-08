"use strict";

const tokenStore = require("./qb-token-store.js");
const { refreshAccessToken } = require("./qb-oauth.service.js");
const {
  getEnvironment,
  getMinorVersion,
  getApiBaseUrl,
  getOAuthConfig,
} = require("./qb-config.js");

const TOKEN_REFRESH_BUFFER_MS = 2 * 60 * 1000;

/** @type {Map<string, { items: Array<{ id: string, name: string, type: string | null, active: boolean }>, cachedAt: number }>} */
const itemsCache = new Map();

/**
 * Volatile access tokens only (lost on process restart; refreshed via encrypted refresh_token).
 * @type {Map<string, { accessToken: string, accessTokenExpiresAt: Date }>}
 */
const accessTokenCache = new Map();

function cacheKey(realmId, environment) {
  return `${environment}::${realmId}`;
}

/**
 * After OAuth code exchange: prime cache so the next API call avoids an immediate refresh.
 *
 * @param {string} realmId
 * @param {string | null | undefined} environment
 * @param {string} accessToken
 * @param {Date | string} accessTokenExpiresAt
 */
function primeAccessTokenCache(
  realmId,
  environment,
  accessToken,
  accessTokenExpiresAt,
) {
  const rid = String(realmId).trim();
  const env = normalizeEnv(environment);
  const exp =
    accessTokenExpiresAt instanceof Date
      ? accessTokenExpiresAt
      : new Date(accessTokenExpiresAt);
  accessTokenCache.set(cacheKey(rid, env), {
    accessToken,
    accessTokenExpiresAt: exp,
  });
}

/**
 * For GET /status — expiry metadata only, never token values.
 *
 * @param {string} realmId
 * @param {string | null | undefined} environment
 * @returns {{ accessTokenExpiresAt: string } | null}
 */
function getCachedAccessTokenExpiryMeta(realmId, environment) {
  const rid = String(realmId).trim();
  const env = normalizeEnv(environment);
  const cached = accessTokenCache.get(cacheKey(rid, env));
  if (!cached) return null;
  return {
    accessTokenExpiresAt: cached.accessTokenExpiresAt.toISOString(),
  };
}

function normalizeEnv(environment) {
  const e =
    environment != null && String(environment).trim()
      ? String(environment).trim().toLowerCase()
      : getEnvironment();
  return e;
}

/**
 * Escape single quotes for QuickBooks SQL literals (double each ').
 */
function escapeQuickBooksLiteral(value) {
  return String(value).replace(/'/g, "''");
}

function extractFaultMessage(json) {
  if (!json || typeof json !== "object") return null;
  const fault = json.Fault;
  if (!fault || typeof fault !== "object") return null;
  const errs = fault.Error;
  if (!Array.isArray(errs) || errs.length === 0) return null;
  const first = errs[0];
  if (!first || typeof first !== "object") return null;
  const msg = first.Message || first.message;
  const detail = first.Detail || first.detail;
  const code = first.code || first.Code;
  const parts = [msg, detail].filter(Boolean);
  const text = parts.join(": ").trim();
  return text || code || null;
}

/**
 * Normalized API failure — never includes tokens or secrets.
 */
class QuickBooksApiError extends Error {
  /**
   * @param {string} message
   * @param {{ httpStatus?: number, intuitCode?: string | number | null, intuitDetail?: string | null }} [meta]
   */
  constructor(message, meta = {}) {
    super(message);
    this.name = "QuickBooksApiError";
    this.code = "QB_API_ERROR";
    this.httpStatus = meta.httpStatus;
    this.intuitCode = meta.intuitCode ?? null;
    this.intuitDetail = meta.intuitDetail ?? null;
  }
}

/**
 * QuickBooks Invoice.CustomerMemo must be `{ value: string }`, not a bare string.
 * @param {unknown} customerMemo
 * @returns {string | null} trimmed memo text, or null if empty / invalid
 */
function extractCustomerMemoText(customerMemo) {
  if (customerMemo === undefined || customerMemo === null) return null;
  if (
    typeof customerMemo === "object" &&
    customerMemo !== null &&
    "value" in customerMemo
  ) {
    const v = /** @type {{ value?: unknown }} */ (customerMemo).value;
    const t = v !== undefined && v !== null ? String(v).trim() : "";
    return t || null;
  }
  const t = String(customerMemo).trim();
  return t || null;
}

/**
 * Dev-only: log invoice JSON body (no Authorization header / tokens).
 * @param {Record<string, unknown>} invoice
 */
function logInvoiceCreatePayloadDev(invoice) {
  if (process.env.NODE_ENV === "production") return;
  try {
    console.info(
      "[QB dev] createDraftInvoice POST body:",
      JSON.stringify(invoice),
    );
  } catch {
    console.info("[QB dev] createDraftInvoice POST body: <stringify failed>");
  }
}

function throwNormalizedHttpError(httpStatus, json, fallbackMessage) {
  const faultMsg = extractFaultMessage(json);
  const msg =
    faultMsg ||
    (typeof json?.Message === "string" ? json.Message : null) ||
    fallbackMessage ||
    `QuickBooks API request failed (${httpStatus}).`;
  const intuitCode =
    json?.Fault?.Error?.[0]?.code ??
    json?.Fault?.Error?.[0]?.Code ??
    null;
  const intuitDetail =
    json?.Fault?.Error?.[0]?.Detail ??
    json?.Fault?.Error?.[0]?.detail ??
    null;
  throw new QuickBooksApiError(msg, {
    httpStatus,
    intuitCode,
    intuitDetail,
  });
}

/**
 * Load stored connection (optional realm); access token from volatile cache or Intuit refresh.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {{ realmId?: string | null, environment?: string | null }} opts
 * @returns {Promise<Record<string, unknown>>}
 */
async function getValidConnection(supabase, opts = {}) {
  const environment = normalizeEnv(opts.environment);
  let row = opts.realmId
    ? await tokenStore.getConnectionByRealm(supabase, {
        realmId: String(opts.realmId).trim(),
        environment,
      })
    : await tokenStore.getLatestConnection(supabase, { environment });

  if (!row) {
    const err = new Error(
      `QuickBooks is not connected for environment: ${environment}`,
    );
    err.code = "QB_NOT_CONNECTED";
    throw err;
  }

  row = await tokenStore.prepareConnectionRow(supabase, row);

  const rid = String(row.realm_id);
  const envRow = normalizeEnv(row.environment ?? environment);
  const key = cacheKey(rid, envRow);

  const cached = accessTokenCache.get(key);

  /** @type {string} */
  let accessToken;
  /** @type {Date} */
  let accessExpiresAt;

  if (
    cached &&
    Date.now() <
      cached.accessTokenExpiresAt.getTime() - TOKEN_REFRESH_BUFFER_MS
  ) {
    accessToken = cached.accessToken;
    accessExpiresAt = cached.accessTokenExpiresAt;
  } else {
    let refreshPlain;
    try {
      refreshPlain = tokenStore.getDecryptedRefreshToken(row);
    } catch (e) {
      if (e.code === "quickbooks_token_encryption_unconfigured") {
        throw e;
      }
      if (e.code === "quickbooks_token_decrypt_failed") {
        const wrapped = new Error(
          "QuickBooks refresh token could not be decrypted. Check QB_TOKEN_ENCRYPTION_KEY.",
        );
        wrapped.code = "QB_TOKEN_DECRYPT_FAILED";
        throw wrapped;
      }
      throw e;
    }

    let refreshed;
    try {
      getOAuthConfig();
      refreshed = await refreshAccessToken({
        refreshToken: refreshPlain,
      });
    } catch (e) {
      const wrapped = new Error(
        e.code === "QB_CONFIG_MISSING"
          ? "QuickBooks token refresh requires QB_CLIENT_ID and QB_CLIENT_SECRET."
          : `QuickBooks token refresh failed: ${e.message || String(e)}`,
      );
      wrapped.code =
        e.code === "QB_CONFIG_MISSING"
          ? "QB_CONFIG_MISSING"
          : "QB_TOKEN_REFRESH_FAILED";
      throw wrapped;
    }

    await tokenStore.persistEncryptedRefreshOnly(supabase, {
      realmId: rid,
      environment: row.environment,
      refreshTokenPlaintext: refreshed.refreshToken,
      refreshTokenExpiresAt: refreshed.refreshTokenExpiresAt,
      scopes: refreshed.scopes,
      tokenType: refreshed.tokenType,
    });

    accessExpiresAt =
      refreshed.accessTokenExpiresAt instanceof Date
        ? refreshed.accessTokenExpiresAt
        : new Date(refreshed.accessTokenExpiresAt);
    accessToken = refreshed.accessToken;

    accessTokenCache.set(key, {
      accessToken,
      accessTokenExpiresAt: accessExpiresAt,
    });

    row = {
      ...row,
      refresh_token_expires_at:
        refreshed.refreshTokenExpiresAt == null
          ? row.refresh_token_expires_at
          : refreshed.refreshTokenExpiresAt instanceof Date
            ? refreshed.refreshTokenExpiresAt.toISOString()
            : refreshed.refreshTokenExpiresAt,
      scopes: refreshed.scopes ?? row.scopes,
      token_type: refreshed.tokenType ?? row.token_type,
    };
  }

  return {
    ...row,
    access_token: accessToken,
    access_token_expires_at: accessExpiresAt.toISOString(),
  };
}

/**
 * Low-level authenticated request to QuickBooks REST API v3.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {{
 *   method: string,
 *   path: string,
 *   realmId?: string | null,
 *   environment?: string | null,
 *   query?: Record<string, string | number | boolean | undefined | null>,
 *   body?: unknown,
 * }} opts
 */
async function quickBooksRequest(supabase, opts) {
  const {
    method,
    path,
    realmId,
    environment,
    query = {},
    body,
  } = opts;

  if (!method || !path) {
    throw new Error("quickBooksRequest: method and path are required.");
  }

  const conn = await getValidConnection(supabase, { realmId, environment });
  const rid = String(conn.realm_id);
  const env = normalizeEnv(conn.environment ?? environment);

  const base = getApiBaseUrl(env);
  const pathTrim = path.startsWith("/") ? path.slice(1) : path;
  const url = new URL(`${base}/v3/company/${rid}/${pathTrim}`);

  url.searchParams.set("minorversion", getMinorVersion());

  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }

  const headers = {
    Authorization: `Bearer ${conn.access_token}`,
    Accept: "application/json",
  };

  /** @type {RequestInit} */
  const fetchOpts = {
    method: method.toUpperCase(),
    headers,
  };

  if (body !== undefined && body !== null) {
    headers["Content-Type"] = "application/json";
    fetchOpts.body = JSON.stringify(body);
  }

  const res = await fetch(url.toString(), fetchOpts);
  const text = await res.text();

  let json = {};
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      throw new QuickBooksApiError(
        `QuickBooks API returned non-JSON (${res.status}).`,
        { httpStatus: res.status },
      );
    }
  }

  if (!res.ok) {
    throwNormalizedHttpError(res.status, json, text?.slice(0, 200));
  }

  return json;
}

function normalizeCustomer(c) {
  if (!c || typeof c !== "object") return null;
  const email =
    c.PrimaryEmailAddr &&
    typeof c.PrimaryEmailAddr === "object" &&
    c.PrimaryEmailAddr.Address
      ? String(c.PrimaryEmailAddr.Address)
      : null;
  return {
    id: String(c.Id),
    displayName: c.DisplayName != null ? String(c.DisplayName) : "",
    email,
  };
}

function normalizeItem(i) {
  if (!i || typeof i !== "object") return null;
  return {
    id: String(i.Id),
    name: i.Name != null ? String(i.Name) : "",
    type: i.Type != null ? String(i.Type) : null,
    active: Boolean(i.Active),
  };
}

function queryResponseArray(json, entityKey) {
  const qr = json.QueryResponse;
  if (!qr || typeof qr !== "object") return [];
  const raw = qr[entityKey];
  if (!raw) return [];
  return Array.isArray(raw) ? raw : [raw];
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 */
async function findCustomerByEmailOrName(supabase, opts) {
  const { email, name, realmId, environment } = opts;

  const emailTrim =
    email != null && String(email).trim() ? String(email).trim() : "";
  const nameTrim =
    name != null && String(name).trim() ? String(name).trim() : "";

  let sql;
  if (emailTrim) {
    sql = `SELECT * FROM Customer WHERE PrimaryEmailAddr = '${escapeQuickBooksLiteral(emailTrim)}' MAXRESULTS 1`;
  } else if (nameTrim) {
    sql = `SELECT * FROM Customer WHERE DisplayName = '${escapeQuickBooksLiteral(nameTrim)}' MAXRESULTS 1`;
  } else {
    throw new Error(
      "findCustomerByEmailOrName: provide a non-empty email or name.",
    );
  }

  const json = await quickBooksRequest(supabase, {
    method: "GET",
    path: "/query",
    realmId,
    environment,
    query: { query: sql },
  });

  const rows = queryResponseArray(json, "Customer");
  const first = rows[0];
  return first ? normalizeCustomer(first) : null;
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 */
async function createCustomer(supabase, opts) {
  const { name, email, realmId, environment } = opts;

  const displayName =
    name != null && String(name).trim() ? String(name).trim() : "";
  if (!displayName) {
    throw new Error("createCustomer: DisplayName (name) is required.");
  }

  /** @type {Record<string, unknown>} */
  const payload = { DisplayName: displayName };

  const emailTrim =
    email != null && String(email).trim() ? String(email).trim() : "";
  if (emailTrim) {
    payload.PrimaryEmailAddr = { Address: emailTrim };
  }

  const json = await quickBooksRequest(supabase, {
    method: "POST",
    path: "/customer",
    realmId,
    environment,
    body: payload,
  });

  const c = json.Customer;
  const normalized = normalizeCustomer(c);
  if (!normalized) {
    throw new QuickBooksApiError(
      "QuickBooks created a customer but the response could not be parsed.",
      {},
    );
  }
  return normalized;
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 */
async function getOrCreateCustomer(supabase, opts) {
  const { name, email, realmId, environment } = opts;

  const existing = await findCustomerByEmailOrName(supabase, {
    email,
    name,
    realmId,
    environment,
  });

  if (existing) {
    return { ...existing, created: false };
  }

  const created = await createCustomer(supabase, {
    name,
    email,
    realmId,
    environment,
  });
  return { ...created, created: true };
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 */
async function fetchQuickBooksItems(supabase, opts) {
  const { realmId, environment, forceRefresh = false } = opts;
  const envNorm = normalizeEnv(environment);

  let rid =
    realmId != null && String(realmId).trim()
      ? String(realmId).trim()
      : null;
  if (!rid) {
    const row = await tokenStore.getLatestConnection(supabase, {
      environment: envNorm,
    });
    if (!row) {
      const err = new Error(
        `QuickBooks is not connected for environment: ${envNorm}`,
      );
      err.code = "QB_NOT_CONNECTED";
      throw err;
    }
    rid = String(row.realm_id);
  }

  const key = cacheKey(rid, envNorm);
  if (!forceRefresh && itemsCache.has(key)) {
    return itemsCache.get(key).items;
  }

  const sql =
    "SELECT * FROM Item WHERE Active IN (true,false) MAXRESULTS 1000";

  const json = await quickBooksRequest(supabase, {
    method: "GET",
    path: "/query",
    realmId: rid,
    environment: envNorm,
    query: { query: sql },
  });

  const rows = queryResponseArray(json, "Item");
  const items = rows.map(normalizeItem).filter(Boolean);

  itemsCache.set(key, { items, cachedAt: Date.now() });
  return items;
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 */
async function getItemIdByName(supabase, opts) {
  const { name, realmId, environment } = opts;

  const needle =
    name != null && String(name).trim() ? String(name).trim() : "";
  if (!needle) {
    throw new Error("getItemIdByName: name is required.");
  }

  let items = await fetchQuickBooksItems(supabase, {
    realmId,
    environment,
    forceRefresh: false,
  });

  let hit = items.find(
    (i) => i.name.toLowerCase() === needle.toLowerCase(),
  );

  if (!hit) {
    items = await fetchQuickBooksItems(supabase, {
      realmId,
      environment,
      forceRefresh: true,
    });
    hit = items.find(
      (i) => i.name.toLowerCase() === needle.toLowerCase(),
    );
  }

  return hit ? hit.id : null;
}

/**
 * Create an invoice (draft lifecycle — caller controls emailing / payment separately).
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 */
async function createDraftInvoice(supabase, opts) {
  const {
    realmId,
    environment,
    customerId,
    lines,
    dueDate,
    txnDate,
    privateNote,
    customerMemo,
  } = opts;

  if (!customerId || String(customerId).trim() === "") {
    throw new Error("createDraftInvoice: customerId is required.");
  }
  if (!Array.isArray(lines) || lines.length === 0) {
    throw new Error("createDraftInvoice: lines must be a non-empty array.");
  }

  /** @type {Record<string, unknown>} */
  const invoice = {
    CustomerRef: { value: String(customerId).trim() },
    Line: lines,
  };

  if (txnDate != null && String(txnDate).trim()) {
    invoice.TxnDate = String(txnDate).trim();
  }
  if (dueDate != null && String(dueDate).trim()) {
    invoice.DueDate = String(dueDate).trim();
  }
  if (privateNote != null && String(privateNote).trim()) {
    invoice.PrivateNote = String(privateNote).trim();
  }
  const memoText = extractCustomerMemoText(customerMemo);
  if (memoText) {
    invoice.CustomerMemo = { value: memoText };
  }

  logInvoiceCreatePayloadDev(invoice);

  const json = await quickBooksRequest(supabase, {
    method: "POST",
    path: "/invoice",
    realmId,
    environment,
    body: invoice,
  });

  const inv = json.Invoice;
  if (!inv || typeof inv !== "object") {
    throw new QuickBooksApiError(
      "QuickBooks created an invoice but the response could not be parsed.",
      {},
    );
  }

  return {
    id: String(inv.Id),
    docNumber:
      inv.DocNumber != null ? String(inv.DocNumber) : "",
    totalAmt:
      inv.TotalAmt != null ? Number(inv.TotalAmt) : NaN,
    balance:
      inv.Balance != null ? Number(inv.Balance) : NaN,
    dueDate:
      inv.DueDate != null ? String(inv.DueDate) : "",
  };
}

module.exports = {
  QuickBooksApiError,
  getValidConnection,
  primeAccessTokenCache,
  getCachedAccessTokenExpiryMeta,
  quickBooksRequest,
  findCustomerByEmailOrName,
  createCustomer,
  getOrCreateCustomer,
  fetchQuickBooksItems,
  getItemIdByName,
  createDraftInvoice,
};
