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

function cacheKey(realmId, environment) {
  return `${environment}::${realmId}`;
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
 * Load stored connection (optional realm), refresh tokens if near expiry.
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

  const expiresMs = new Date(row.access_token_expires_at).getTime();
  if (Number.isNaN(expiresMs)) {
    const err = new Error(
      "QuickBooks connection has invalid access_token_expires_at.",
    );
    err.code = "QB_TOKEN_INVALID";
    throw err;
  }

  const needsRefresh = Date.now() >= expiresMs - TOKEN_REFRESH_BUFFER_MS;

  if (needsRefresh) {
    let refreshed;
    try {
      getOAuthConfig();
      refreshed = await refreshAccessToken({
        refreshToken: row.refresh_token,
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

    await tokenStore.updateTokens(supabase, {
      realmId: row.realm_id,
      environment: row.environment,
      accessToken: refreshed.accessToken,
      refreshToken: refreshed.refreshToken,
      accessTokenExpiresAt: refreshed.accessTokenExpiresAt,
      refreshTokenExpiresAt: refreshed.refreshTokenExpiresAt,
      scopes: refreshed.scopes,
      tokenType: refreshed.tokenType,
    });

    row = {
      ...row,
      access_token: refreshed.accessToken,
      refresh_token: refreshed.refreshToken,
      access_token_expires_at:
        refreshed.accessTokenExpiresAt instanceof Date
          ? refreshed.accessTokenExpiresAt.toISOString()
          : refreshed.accessTokenExpiresAt,
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

  return row;
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
  if (customerMemo != null && String(customerMemo).trim()) {
    invoice.CustomerMemo = String(customerMemo).trim();
  }

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
  quickBooksRequest,
  findCustomerByEmailOrName,
  createCustomer,
  getOrCreateCustomer,
  fetchQuickBooksItems,
  getItemIdByName,
  createDraftInvoice,
};
