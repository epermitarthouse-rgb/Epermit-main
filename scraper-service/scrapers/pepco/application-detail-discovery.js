/**
 * PEPCO SIUP — read-only application detail discovery via authenticated .euapi endpoints.
 * Uses Playwright page.request (shared session cookies). No portal submission or uploads.
 */

"use strict";

const path = require("path");
const fs = require("fs");

const SCRAPER_SERVICE_ROOT = path.join(__dirname, "..", "..");
const PEPCO_EUAPI_BASE = "https://secure.pepco.com/.euapi/nbp";
const PEPCO_GET_SESSION_URL =
  "https://secure.pepco.com/api/Services/MyAccountService.svc/GetSession";

const PEPCO_GET_SESSION_HEADERS = {
  accept: "application/json, text/plain, */*",
  "content-type": "application/json",
  "cache-control": "no-cache",
};

const PEPCO_TOKEN_KEY_HINTS = new Set([
  "access_token",
  "accessToken",
  "id_token",
  "idToken",
  "secret",
  "credential",
]);

/**
 * @param {unknown} value
 */
function isPlausiblePepcoBearerToken(value) {
  if (typeof value !== "string") return false;
  const s = value.trim();
  if (!s) return false;
  if (s.startsWith("eyJ") && s.split(".").length === 3) return true;
  return false;
}

/**
 * @param {unknown} value
 * @param {number} [depth]
 * @returns {string | null}
 */
function findPepcoBearerTokenInValue(value, depth = 0) {
  if (depth > 10) return null;
  if (typeof value === "string") {
    const s = value.trim();
    if (isPlausiblePepcoBearerToken(s)) return s;
    if (s.startsWith("{") || s.startsWith("[")) {
      try {
        return findPepcoBearerTokenInValue(JSON.parse(s), depth + 1);
      } catch {
        return null;
      }
    }
    return null;
  }
  if (!value || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findPepcoBearerTokenInValue(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  const obj = /** @type {Record<string, unknown>} */ (value);
  for (const [key, nested] of Object.entries(obj)) {
    if (PEPCO_TOKEN_KEY_HINTS.has(key) && typeof nested === "string") {
      const direct = nested.trim();
      if (isPlausiblePepcoBearerToken(direct)) return direct;
    }
    const found = findPepcoBearerTokenInValue(nested, depth + 1);
    if (found) return found;
  }
  return null;
}

/**
 * @param {{ bearerToken?: string | null }} [opts]
 */
function buildPepcoApiHeaders(opts = {}) {
  const bearerToken = opts.bearerToken != null ? String(opts.bearerToken).trim() : "";
  return {
    accept: "application/json, text/plain, */*",
    "content-type": "application/json",
    "cache-control": "no-cache",
    opco: "PEP",
    "x-opco": "PEP",
    ...(bearerToken ? { authorization: `Bearer ${bearerToken}` } : {}),
  };
}

/** Static headers without Authorization (legacy export). */
const PEPCO_API_HEADERS = buildPepcoApiHeaders();

/**
 * @param {(msg: string) => void} [logger]
 */
function logStep(logger, msg) {
  const line = `[PEPCO][application-detail] ${msg}`;
  if (typeof logger === "function") logger(msg);
  else console.log(line);
}

/**
 * @param {unknown} body
 */
function apiFailureMessage(body, httpStatus) {
  if (body && typeof body === "object" && body !== null) {
    const o = /** @type {{ message?: unknown, correlationId?: unknown }} */ (body);
    const msg =
      typeof o.message === "string" && o.message.trim()
        ? o.message.trim()
        : `PEPCO API request failed (HTTP ${httpStatus})`;
    const cid =
      typeof o.correlationId === "string" && o.correlationId.trim()
        ? o.correlationId.trim()
        : null;
    return cid ? `${msg} (correlationId=${cid})` : msg;
  }
  return `PEPCO API request failed (HTTP ${httpStatus})`;
}

/**
 * @param {import("playwright").Page | null | undefined} page
 */
async function collectPepcoPageDiagnostics(page) {
  if (!page) {
    return {
      pageUrl: "",
      mfaInputVisible: false,
      rejectionLanguageLikely: false,
      dashboardShell: false,
    };
  }

  const pageUrl = page.url();
  const dashboardShell = await page
    .evaluate(() => {
      return !!(
        document.querySelector("app-dashboard-application") ||
        document.querySelector(".app-dashboard-application") ||
        document.querySelector(".applications") ||
        document.querySelector(".application-card")
      );
    })
    .catch(() => false);
  const mfaInputVisible = await page
    .locator(
      'input[autocomplete="one-time-code"], input[name="verificationCode"], input[id*="verificationCode"], input[inputmode="numeric"]',
    )
    .first()
    .isVisible({ timeout: 250 })
    .catch(() => false);
  const rejectionLanguageLikely = await page
    .evaluate(() => {
      const t = (document.body && document.body.innerText) || "";
      return /\b(invalid|incorrect|wrong|expired)\b.*\b(code|verification|pin)\b|\bcould not verify\b|\btry again\b/i.test(
        t,
      );
    })
    .catch(() => false);

  return { pageUrl, mfaInputVisible, rejectionLanguageLikely, dashboardShell };
}

/**
 * @param {{
 *   endpoint: string;
 *   httpStatus: number;
 *   contentType?: string;
 *   responseText?: string;
 *   body?: unknown;
 *   diagnostics?: Awaited<ReturnType<typeof collectPepcoPageDiagnostics>>;
 *   authorizationAttached?: boolean;
 * }} opts
 */
function buildPepcoApiErrorMessage(opts) {
  const { endpoint, httpStatus, contentType, responseText, body, diagnostics } = opts;
  const snippet = String(responseText || "").slice(0, 300);
  const parts = [
    `endpoint=${endpoint}`,
    `httpStatus=${httpStatus}`,
    `contentType=${contentType || "(none)"}`,
  ];

  if (body && typeof body === "object" && body !== null) {
    const o = /** @type {{ isSuccess?: unknown, message?: unknown, correlationId?: unknown }} */ (body);
    if ("isSuccess" in o) parts.push(`isSuccess=${String(o.isSuccess)}`);
    if (typeof o.message === "string" && o.message.trim()) parts.push(`message=${o.message.trim()}`);
    if (typeof o.correlationId === "string" && o.correlationId.trim()) {
      parts.push(`correlationId=${o.correlationId.trim()}`);
    }
  }

  if (snippet && (!body || typeof body !== "object")) {
    parts.push(`responsePreview=${JSON.stringify(snippet)}`);
  } else if (snippet && body && typeof body === "object") {
    parts.push(`responsePreview=${JSON.stringify(snippet)}`);
  }

  if (diagnostics) {
    parts.push(`pageUrl=${diagnostics.pageUrl || "(unknown)"}`);
    parts.push(`mfaInputVisible=${diagnostics.mfaInputVisible}`);
    parts.push(`rejectionLanguageLikely=${diagnostics.rejectionLanguageLikely}`);
    parts.push(`dashboardShell=${diagnostics.dashboardShell}`);
  }

  if (typeof opts.authorizationAttached === "boolean") {
    parts.push(`authorizationAttached=${opts.authorizationAttached}`);
  }

  return parts.join(" ");
}

/**
 * Parse authenticated GetSession JSON (no values logged).
 *
 * @param {unknown} body
 * @returns {{ token: string, tokenLength: number, usernamePresent: boolean } | null}
 */
function parsePepcoGetSessionToken(body) {
  if (!body || typeof body !== "object" || body === null) return null;
  const o = /** @type {Record<string, unknown>} */ (body);
  const token = typeof o.token === "string" ? o.token.trim() : "";
  const username = o.username != null ? String(o.username).trim() : "";
  const encryptedUsername =
    o.encryptedUsername != null ? String(o.encryptedUsername).trim() : "";
  const usernamePresent = username.length > 0 || encryptedUsername.length > 0;
  if (!token || !usernamePresent) return null;
  return { token, tokenLength: token.length, usernamePresent: true };
}

/**
 * @param {number} httpStatus
 * @param {string} contentType
 * @param {string} text
 * @param {(msg: string) => void} [logger]
 * @returns {{ token: string, tokenLength: number } | null}
 */
function extractPepcoGetSessionTokenFromResponse(httpStatus, contentType, text, logger) {
  logStep(logger, `GetSession status=${httpStatus} content-type=${contentType || "(none)"}`);

  /** @type {unknown} */
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }

  if (!body || typeof body !== "object") {
    logStep(logger, "GetSession username present: no");
    logStep(logger, "GetSession token found: no");
    return null;
  }

  const o = /** @type {Record<string, unknown>} */ (body);
  const username = o.username != null ? String(o.username).trim() : "";
  const encryptedUsername =
    o.encryptedUsername != null ? String(o.encryptedUsername).trim() : "";
  const usernamePresent = username.length > 0 || encryptedUsername.length > 0;
  logStep(logger, `GetSession username present: ${usernamePresent ? "yes" : "no"}`);

  const parsed = parsePepcoGetSessionToken(body);
  if (parsed) {
    logStep(logger, `GetSession token found: yes length=${parsed.tokenLength}`);
    return { token: parsed.token, tokenLength: parsed.tokenLength };
  }

  logStep(logger, "GetSession token found: no");
  return null;
}

/**
 * Retrieve PEPCO API Bearer token via MyAccountService GetSession (no values logged).
 *
 * @param {import("playwright").Page} page
 * @param {(msg: string) => void} [logger]
 * @returns {Promise<{ token: string, source: string, keyName: string | null } | null>}
 */
async function getPepcoBearerTokenViaSessionApi(page, logger) {
  logStep(logger, "Fetching PEPCO session via GetSession");

  try {
    const res = await page.request.get(PEPCO_GET_SESSION_URL, {
      headers: PEPCO_GET_SESSION_HEADERS,
      timeout: 30_000,
    });
    const contentType = res.headers()["content-type"] || res.headers()["Content-Type"] || "";
    const text = await res.text().catch(() => "");
    const parsed = extractPepcoGetSessionTokenFromResponse(
      res.status(),
      contentType,
      text,
      logger,
    );
    if (parsed) {
      logStep(logger, "PEPCO API bearer token found via GetSession");
      return { token: parsed.token, source: "GetSession", keyName: null };
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200);
    logStep(logger, `GetSession via page.request failed: ${msg}`);
  }

  try {
    const evalResult = await page.evaluate(async (url) => {
      const res = await fetch(url, {
        method: "GET",
        credentials: "include",
        headers: {
          accept: "application/json, text/plain, */*",
          "content-type": "application/json",
          "cache-control": "no-cache",
        },
      });
      return {
        httpStatus: res.status,
        contentType: res.headers.get("content-type") || "",
        text: await res.text(),
      };
    }, PEPCO_GET_SESSION_URL);

    if (evalResult && typeof evalResult === "object") {
      const er = /** @type {{ httpStatus?: number, contentType?: string, text?: string }} */ (
        evalResult
      );
      const parsed = extractPepcoGetSessionTokenFromResponse(
        typeof er.httpStatus === "number" ? er.httpStatus : 0,
        typeof er.contentType === "string" ? er.contentType : "",
        typeof er.text === "string" ? er.text : "",
        logger,
      );
      if (parsed) {
        logStep(logger, "PEPCO API bearer token found via GetSession");
        return { token: parsed.token, source: "GetSession(fetch)", keyName: null };
      }
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200);
    logStep(logger, `GetSession via page fetch failed: ${msg}`);
  }

  logStep(logger, "PEPCO bearer token found: no");
  return null;
}

/**
 * @deprecated Prefer getPepcoBearerTokenViaSessionApi — kept as alias for callers.
 * @param {import("playwright").Page} page
 * @param {(msg: string) => void} [logger]
 */
async function getPepcoBearerTokenFromPage(page, logger) {
  return getPepcoBearerTokenViaSessionApi(page, logger);
}

/**
 * @param {import("playwright").APIRequestContext} requestCtx
 * @param {string} apiPath path after /.euapi/nbp e.g. /applications/{uuid}?includeOverview=true
 * @param {{ page?: import("playwright").Page | null, bearerToken?: string | null }} [opts]
 */
async function pepcoApiGetJson(requestCtx, apiPath, opts = {}) {
  const page = opts.page;
  const bearerToken = opts.bearerToken != null ? String(opts.bearerToken).trim() : "";
  const headers = buildPepcoApiHeaders({ bearerToken });
  const url = `${PEPCO_EUAPI_BASE}${apiPath.startsWith("/") ? apiPath : `/${apiPath}`}`;
  const res = await requestCtx.get(url, {
    headers,
    timeout: 90_000,
  });
  const contentType = res.headers()["content-type"] || res.headers()["Content-Type"] || "";
  const text = await res.text().catch(() => "");
  /** @type {unknown} */
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }

  const diagnostics = page ? await collectPepcoPageDiagnostics(page) : undefined;
  const httpStatus = res.status();
  const apiFailed =
    !res.ok() ||
    (body &&
      typeof body === "object" &&
      /** @type {{ isSuccess?: boolean }} */ (body).isSuccess === false);

  if (apiFailed) {
    const detail = buildPepcoApiErrorMessage({
      endpoint: url,
      httpStatus,
      contentType,
      responseText: text,
      body,
      diagnostics,
      authorizationAttached: Boolean(bearerToken),
    });
    console.error(`[PEPCO][application-detail] API GET failed: ${detail}`);
    const err = new Error(apiFailureMessage(body, httpStatus));
    err.statusCode = 502;
    err.code = "PEPCO_API_ERROR";
    /** @type {Error & { detail?: string }} */ (err).detail = detail;
    throw err;
  }

  return body;
}

/**
 * @param {import("playwright").APIRequestContext} requestCtx
 * @param {string} apiPath
 * @param {Record<string, unknown>} payload
 * @param {{ bearerToken?: string | null }} [opts]
 */
async function pepcoApiPostRaw(requestCtx, apiPath, payload, opts = {}) {
  const bearerToken = opts.bearerToken != null ? String(opts.bearerToken).trim() : "";
  const url = `${PEPCO_EUAPI_BASE}${apiPath.startsWith("/") ? apiPath : `/${apiPath}`}`;
  const res = await requestCtx.post(url, {
    headers: buildPepcoApiHeaders({ bearerToken }),
    data: payload,
    timeout: 120_000,
  });
  return res;
}

/**
 * @param {string | undefined | null} contentDisposition
 */
function filenameFromContentDisposition(contentDisposition) {
  if (!contentDisposition || typeof contentDisposition !== "string") return null;
  const m = /filename\*=UTF-8''([^;]+)|filename="([^"]+)"|filename=([^;\s]+)/i.exec(
    contentDisposition,
  );
  const raw = m ? m[1] || m[2] || m[3] : null;
  if (!raw) return null;
  try {
    return decodeURIComponent(raw.trim());
  } catch {
    return raw.trim();
  }
}

function getPepcoDocStorageRoot() {
  return path.join(SCRAPER_SERVICE_ROOT, "debug", "pepco-docs");
}

function safeLocalDocDir(opts) {
  const parts = ["pepco-docs"];
  if (opts.coordinationId) parts.push(String(opts.coordinationId).replace(/[^a-zA-Z0-9_-]/g, "_"));
  if (opts.applicationUuid)
    parts.push(String(opts.applicationUuid).replace(/[^a-zA-Z0-9_-]/g, "_"));
  const dir = path.join(SCRAPER_SERVICE_ROOT, "debug", ...parts);
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  } catch (_) {}
  return dir;
}

/**
 * Resolve an on-disk PEPCO document path under the configured download root.
 *
 * @param {{ coordinationId: string, applicationUuid: string, fileName: string }} opts
 * @returns {string | null}
 */
function resolvePepcoStoredDocumentPath(opts) {
  const fileName = String(opts.fileName || "").trim();
  if (!fileName) return null;
  const dir = safeLocalDocDir({
    coordinationId: opts.coordinationId,
    applicationUuid: opts.applicationUuid,
  });
  const root = path.resolve(getPepcoDocStorageRoot());
  const safeName = path.basename(fileName.replace(/[/\\?%*:|"<>]/g, "_"));
  const resolved = path.resolve(dir, safeName);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    return null;
  }
  if (resolved.includes(`${path.sep}..${path.sep}`) || resolved.endsWith(`${path.sep}..`)) {
    return null;
  }
  return resolved;
}

/**
 * @param {unknown} overviewBody
 */
function parseOverviewResponse(overviewBody) {
  const value =
    overviewBody &&
    typeof overviewBody === "object" &&
    overviewBody !== null &&
    "value" in overviewBody
      ? /** @type {{ value?: unknown }} */ (overviewBody).value
      : null;

  if (!value || typeof value !== "object" || value === null) {
    return {
      overview: null,
      projectSummary: null,
      projectDetails: null,
      statusTracking: null,
    };
  }

  const v = /** @type {Record<string, unknown>} */ (value);
  const projectOverview =
    v.projectOverview && typeof v.projectOverview === "object" ? v.projectOverview : null;
  const projectSummary =
    v.projectSummary && typeof v.projectSummary === "object" ? v.projectSummary : null;

  const projectDetailsRoot =
    v.projectDetails && typeof v.projectDetails === "object"
      ? /** @type {{ applicationDetails?: unknown }} */ (v.projectDetails)
      : null;
  const applicationDetails =
    projectDetailsRoot &&
    projectDetailsRoot.applicationDetails &&
    typeof projectDetailsRoot.applicationDetails === "object"
      ? projectDetailsRoot.applicationDetails
      : null;

  const statusTracking =
    v.projectStatusTrackingDetails && typeof v.projectStatusTrackingDetails === "object"
      ? v.projectStatusTrackingDetails
      : null;

  return {
    overview: projectOverview,
    projectSummary,
    projectDetails: applicationDetails ? { applicationDetails } : null,
    statusTracking,
  };
}

/**
 * @param {unknown} statusBody
 */
function parseStatusChangesResponse(statusBody) {
  const value =
    statusBody &&
    typeof statusBody === "object" &&
    statusBody !== null &&
    "value" in statusBody &&
    Array.isArray(/** @type {{ value?: unknown }} */ (statusBody).value)
      ? /** @type {Array<Record<string, unknown>>} */ (/** @type {{ value: unknown[] }} */ (statusBody).value)
      : [];

  const statusChanges = value.map((row) => ({
    milestoneName:
      typeof row.milestoneName === "string" ? row.milestoneName : row.milestoneName ?? null,
    statusName: typeof row.statusName === "string" ? row.statusName : row.statusName ?? null,
    statusChangeDateTime:
      typeof row.statusChangeDateTime === "string"
        ? row.statusChangeDateTime
        : row.statusChangeDateTime ?? null,
  }));

  const sorted = [...statusChanges].sort((a, b) => {
    const ta = a.statusChangeDateTime ? Date.parse(String(a.statusChangeDateTime)) : 0;
    const tb = b.statusChangeDateTime ? Date.parse(String(b.statusChangeDateTime)) : 0;
    return tb - ta;
  });

  const newest = sorted[0] ?? null;

  return {
    statusChanges,
    currentMilestone: newest?.milestoneName ?? null,
    currentStatus: newest?.statusName ?? null,
    statusLastUpdatedAt: newest?.statusChangeDateTime ?? null,
  };
}

/**
 * @param {unknown} messagesBody
 */
function parseMessagesResponse(messagesBody) {
  const value =
    messagesBody &&
    typeof messagesBody === "object" &&
    messagesBody !== null &&
    "value" in messagesBody
      ? /** @type {{ value?: unknown }} */ (messagesBody).value
      : null;

  const messageDetails =
    value &&
    typeof value === "object" &&
    value !== null &&
    "messageDetails" in value &&
    /** @type {{ messageDetails?: unknown }} */ (value).messageDetails &&
    typeof /** @type {{ messageDetails?: unknown }} */ (value).messageDetails === "object"
      ? /** @type {{ messages?: unknown }} */ (/** @type {{ messageDetails: object }} */ (value).messageDetails)
      : null;

  const rawMessages = messageDetails && Array.isArray(messageDetails.messages) ? messageDetails.messages : [];

  const messages = rawMessages.map((row) => {
    const r = row && typeof row === "object" ? /** @type {Record<string, unknown>} */ (row) : {};
    return {
      statusChangeDisplayName:
        typeof r.statusChangeDisplayName === "string" ? r.statusChangeDisplayName : null,
      senderMessage: typeof r.senderMessage === "string" ? r.senderMessage : null,
      isSPOC: r.isSPOC === true,
      isInternalUser: r.isInternalUser === true,
      receiverName: typeof r.receiverName === "string" ? r.receiverName : null,
      receiverMessage: typeof r.receiverMessage === "string" ? r.receiverMessage : null,
      messageDateTime: typeof r.messageDateTime === "string" ? r.messageDateTime : null,
    };
  });

  let latestMessageAt = null;
  for (const m of messages) {
    if (!m.messageDateTime) continue;
    if (!latestMessageAt || Date.parse(m.messageDateTime) > Date.parse(latestMessageAt)) {
      latestMessageAt = m.messageDateTime;
    }
  }

  return {
    messageCount: messages.length,
    latestMessageAt,
    messages,
  };
}

/**
 * @param {unknown} documentsBody
 */
function parseDocumentsResponse(documentsBody) {
  const value =
    documentsBody &&
    typeof documentsBody === "object" &&
    documentsBody !== null &&
    "value" in documentsBody
      ? /** @type {{ value?: unknown }} */ (documentsBody).value
      : null;

  const rawDocs =
    value &&
    typeof value === "object" &&
    value !== null &&
    "documents" in value &&
    Array.isArray(/** @type {{ documents?: unknown }} */ (value).documents)
      ? /** @type {Array<Record<string, unknown>>} */ (/** @type {{ documents: unknown[] }} */ (value).documents)
      : [];

  const documents = rawDocs.map((row) => ({
    documentName: typeof row.documentName === "string" ? row.documentName : null,
    documentType: typeof row.documentType === "string" ? row.documentType : null,
    documentStatus: typeof row.documentStatus === "string" ? row.documentStatus : null,
    documentUploadDateTime:
      typeof row.documentUploadDateTime === "string" ? row.documentUploadDateTime : null,
  }));

  return {
    documentCount: documents.length,
    documents,
  };
}

/**
 * @param {import("playwright").APIRequestContext} requestCtx
 * @param {string} applicationUuid
 * @param {Array<{ documentName?: string | null }>} documents
 * @param {{ coordinationId?: string, logger?: (m: string) => void, bearerToken?: string | null }} opts
 */
async function downloadPepcoDocuments(requestCtx, applicationUuid, documents, opts = {}) {
  const logger = opts.logger;
  const bearerToken = opts.bearerToken != null ? String(opts.bearerToken).trim() : "";
  /** @type {Array<Record<string, unknown>>} */
  const downloadedFiles = [];
  /** @type {Array<{ documentName: string, error: string }>} */
  const downloadErrors = [];

  if (!Array.isArray(documents) || documents.length === 0) return { downloadedFiles, downloadErrors };

  logStep(logger, "Downloading documents");

  for (const doc of documents) {
    const documentName = doc && typeof doc.documentName === "string" ? doc.documentName.trim() : "";
    if (!documentName) {
      downloadErrors.push({ documentName: "(missing name)", error: "documentName_missing" });
      continue;
    }

    try {
      const res = await pepcoApiPostRaw(
        requestCtx,
        `/applications/${encodeURIComponent(applicationUuid)}/files/download`,
        { fileName: documentName },
        { bearerToken },
      );

      if (!res.ok()) {
        const errText = await res.text().catch(() => "");
        let errBody = null;
        try {
          errBody = errText ? JSON.parse(errText) : null;
        } catch (_) {}
        throw new Error(apiFailureMessage(errBody, res.status()));
      }

      const buffer = await res.body();
      const contentDisposition = res.headers()["content-disposition"] || null;
      const headerFileName = filenameFromContentDisposition(contentDisposition);
      const isPdf = buffer.length >= 5 && buffer.slice(0, 5).toString("utf8") === "%PDF-";
      const extFromName = path.extname(documentName) || (isPdf ? ".pdf" : "");
      const fileName = headerFileName || documentName || `download${extFromName}`;

      const dir = safeLocalDocDir({
        coordinationId: opts.coordinationId,
        applicationUuid,
      });
      const localPath = path.join(dir, fileName.replace(/[/\\?%*:|"<>]/g, "_"));
      await fs.promises.writeFile(localPath, buffer);

      downloadedFiles.push({
        documentName,
        fileName,
        status: "saved",
        sizeBytes: buffer.length,
        localPath,
        contentDisposition,
        detectedPdf: isPdf,
      });
      logStep(logger, `Saved document ${documentName} (${buffer.length} bytes)`);
    } catch (e) {
      const msg = e instanceof Error ? e.message.slice(0, 500) : String(e).slice(0, 500);
      downloadErrors.push({ documentName, error: msg });
      downloadedFiles.push({
        documentName,
        fileName: documentName,
        status: "failed",
        sizeBytes: 0,
        localPath: null,
        contentDisposition: null,
        error: msg,
      });
    }
  }

  return { downloadedFiles, downloadErrors };
}

/**
 * Probe a PEPCO application overview API without throwing (for readiness polling).
 *
 * @param {import("playwright").APIRequestContext} requestCtx
 * @param {import("playwright").Page | null | undefined} page
 * @param {string} applicationUuid
 * @param {(msg: string) => void} [logger]
 * @param {{ bearerToken?: string | null }} [opts]
 */
async function probePepcoOverviewApi(requestCtx, page, applicationUuid, logger, opts = {}) {
  const uuid = String(applicationUuid || "").trim();
  const bearerToken = opts.bearerToken != null ? String(opts.bearerToken).trim() : "";
  if (!uuid) {
    return { ok: false, detail: "applicationUuid missing", retryLog: "Overview API probe skipped (no UUID)" };
  }
  if (!bearerToken) {
    return {
      ok: false,
      detail: "bearerToken missing",
      retryLog: "Overview API probe skipped (no bearer token)",
      missingBearer: true,
    };
  }

  const endpoint = `${PEPCO_EUAPI_BASE}/applications/${encodeURIComponent(uuid)}?includeOverview=true`;
  try {
    const res = await requestCtx.get(endpoint, {
      headers: buildPepcoApiHeaders({ bearerToken }),
      timeout: 20_000,
    });
    const contentType = res.headers()["content-type"] || res.headers()["Content-Type"] || "";
    const text = await res.text().catch(() => "");
    /** @type {unknown} */
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }

    const httpStatus = res.status();
    const diagnostics = page ? await collectPepcoPageDiagnostics(page) : undefined;
    const isSuccess =
      res.ok() &&
      body &&
      typeof body === "object" &&
      /** @type {{ isSuccess?: boolean }} */ (body).isSuccess === true;

    if (isSuccess) {
      return { ok: true, httpStatus, body };
    }

    const detail = buildPepcoApiErrorMessage({
      endpoint,
      httpStatus,
      contentType,
      responseText: text,
      body,
      diagnostics,
      authorizationAttached: true,
    });
    logStep(logger, `Overview API not ready: ${detail}`);
    return {
      ok: false,
      httpStatus,
      detail,
      confirmedUnavailable: httpStatus === 404,
      retryLog: `Overview API not ready (HTTP ${httpStatus}) — retrying`,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message.slice(0, 300) : String(e).slice(0, 300);
    logStep(logger, `Overview API probe error: ${msg}`);
    return {
      ok: false,
      detail: msg,
      retryLog: "Overview API probe error — retrying",
    };
  }
}

/**
 * Wait until PEPCO SIUP dashboard URL is loaded (no API calls).
 *
 * @param {import("playwright").Page} page
 * @param {{ logger?: (m: string) => void, timeoutMs?: number }} [opts]
 */
async function waitForPepcoDashboardLanding(page, opts = {}) {
  const logger = opts.logger;
  const timeoutMs = opts.timeoutMs ?? 45_000;
  const t0 = Date.now();

  while (Date.now() - t0 < timeoutMs) {
    await page.waitForLoadState("domcontentloaded").catch(() => {});
    const url = page.url();
    if (/\/service-installation-upgrades-portal\/(dashboard|app)/i.test(url)) {
      logStep(logger, "Dashboard URL reached");
      return { ok: true, currentUrl: url };
    }
    await page.waitForTimeout(500).catch(() => {});
  }

  logStep(logger, "Dashboard URL not reached within timeout");
  return { ok: false, currentUrl: page.url() };
}

/**
 * After MFA, wait until PEPCO dashboard URL and application overview API are ready.
 *
 * @param {import("playwright").Page} page
 * @param {{ logger?: (m: string) => void, applicationUuid?: string, bearerToken?: string | null, timeoutMs?: number, introLog?: string | false }} [opts]
 */
async function waitForPepcoApplicationApiReady(page, opts = {}) {
  const logger = opts.logger;
  const applicationUuid = opts.applicationUuid != null ? String(opts.applicationUuid).trim() : "";
  const bearerToken = opts.bearerToken != null ? String(opts.bearerToken).trim() : "";
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const pollMs = 1500;
  const t0 = Date.now();
  let dashboardUrlLogged = false;
  let overviewCheckLogged = false;
  let attempt = 0;

  if (opts.introLog !== false) {
    const intro =
      typeof opts.introLog === "string"
        ? opts.introLog
        : "MFA code accepted; waiting for PEPCO application API readiness";
    logStep(logger, intro);
  }

  if (!applicationUuid) {
    logStep(logger, "No application UUID available for overview API readiness check");
    return { ok: false, currentUrl: page.url(), detail: "applicationUuid missing" };
  }

  if (!bearerToken) {
    logStep(logger, "PEPCO API bearer token missing; cannot probe overview API");
    return { ok: false, currentUrl: page.url(), detail: "bearerToken missing", missingBearer: true };
  }

  while (Date.now() - t0 < timeoutMs) {
    attempt += 1;
    await page.waitForLoadState("domcontentloaded").catch(() => {});
    await page.waitForLoadState("networkidle", { timeout: 2500 }).catch(() => {});

    const url = page.url();
    const onDashboardUrl = /\/service-installation-upgrades-portal\/(dashboard|app)/i.test(url);
    const onSiup = /\/service-installation-upgrades-portal/i.test(url);

    if (onDashboardUrl && !dashboardUrlLogged) {
      logStep(logger, "Dashboard URL reached");
      dashboardUrlLogged = true;
    }

    if (!overviewCheckLogged) {
      logStep(logger, `Checking overview API readiness for ${applicationUuid}`);
      overviewCheckLogged = true;
    }

    const probe = await probePepcoOverviewApi(page.request, page, applicationUuid, logger, {
      bearerToken,
    });
    if (probe.ok) {
      logStep(logger, "Overview API ready");
      return {
        ok: true,
        currentUrl: url,
        applicationUuid,
      };
    }

    if (probe.missingBearer) {
      return { ok: false, currentUrl: url, detail: probe.detail, missingBearer: true };
    }

    if (probe.retryLog && attempt % 3 === 1) {
      logStep(logger, `${probe.retryLog} (attempt ${attempt})`);
    }

    const diagnostics = await collectPepcoPageDiagnostics(page);
    if (diagnostics.dashboardShell && onSiup && !probe.ok) {
      logStep(
        logger,
        `Dashboard shell visible but overview API not ready yet (attempt ${attempt}) — waiting`,
      );
    }

    await page.waitForTimeout(pollMs).catch(() => {});
  }

  const diagnostics = await collectPepcoPageDiagnostics(page);
  const detail = buildPepcoApiErrorMessage({
    endpoint: `${PEPCO_EUAPI_BASE}/applications/${encodeURIComponent(applicationUuid)}?includeOverview=true`,
    httpStatus: 0,
    contentType: "",
    responseText: "",
    body: null,
    diagnostics,
    authorizationAttached: true,
  });
  logStep(logger, `PEPCO application API readiness timed out after ${timeoutMs}ms: ${detail}`);
  return {
    ok: false,
    currentUrl: page.url(),
    detail,
  };
}

/** @deprecated Use waitForPepcoApplicationApiReady with a known application UUID instead. */
async function waitForPepcoDashboardReady(page, opts = {}) {
  return waitForPepcoApplicationApiReady(page, opts);
}

/**
 * Normalize one PEPCO applications-list API row into a dashboard card shape.
 *
 * @param {unknown} row
 * @param {number} index
 */
function normalizePepcoDashboardCardFromApiRow(row, index) {
  if (!row || typeof row !== "object") return null;
  const r = /** @type {Record<string, unknown>} */ (row);
  const applicationId =
    typeof r.applicationId === "string"
      ? r.applicationId.trim()
      : typeof r.applicationUuid === "string"
        ? r.applicationUuid.trim()
        : typeof r.id === "string"
          ? r.id.trim()
          : "";
  if (!applicationId) return null;

  const projectName = typeof r.projectName === "string" ? r.projectName.trim() : null;
  const projectAddress = typeof r.projectAddress === "string" ? r.projectAddress.trim() : null;
  const status = typeof r.status === "string" ? r.status.trim() : null;
  const jobId = typeof r.jobId === "string" ? r.jobId.trim() : null;
  const lastUpdatedDateTime =
    typeof r.lastUpdatedDateTime === "string"
      ? r.lastUpdatedDateTime
      : typeof r.lastUpdated === "string"
        ? r.lastUpdated
        : null;
  const submittedDateTime =
    typeof r.submittedDateTime === "string"
      ? r.submittedDateTime
      : typeof r.submitted === "string"
        ? r.submitted
        : null;

  return {
    index,
    applicationId,
    jobId,
    title: projectName,
    address: projectAddress,
    status,
    actionRequired: r.actionRequired === true,
    lastUpdated: lastUpdatedDateTime,
    dateSubmitted: submittedDateTime,
    lastUpdatedDateTime,
    submittedDateTime,
    draft: r.draft === true,
    source: "api",
  };
}

/**
 * Parse authenticated GET /.euapi/nbp/applications list payload.
 *
 * @param {unknown} body
 */
function parsePepcoApplicationsListResponse(body) {
  if (!body || typeof body !== "object" || body === null) {
    return { ok: false, reason: "invalid_body", cards: [], customerFirstName: null };
  }

  const o = /** @type {{ isSuccess?: unknown, value?: unknown }} */ (body);
  if (o.isSuccess !== true) {
    return { ok: false, reason: "isSuccess_false", cards: [], customerFirstName: null };
  }

  const value =
    o.value && typeof o.value === "object" && o.value !== null
      ? /** @type {{ data?: unknown, customerFirstName?: unknown }} */ (o.value)
      : null;
  const data = value && Array.isArray(value.data) ? value.data : null;
  if (!data) {
    return { ok: false, reason: "missing_value_data_array", cards: [], customerFirstName: null };
  }

  /** @type {Array<Record<string, unknown>>} */
  const cards = [];
  data.forEach((row, idx) => {
    const card = normalizePepcoDashboardCardFromApiRow(row, idx);
    if (card) cards.push(card);
  });

  const customerFirstName =
    value && typeof value.customerFirstName === "string" ? value.customerFirstName.trim() : null;

  return { ok: true, reason: null, cards, customerFirstName };
}

/**
 * Fetch all PEPCO dashboard projects via authenticated list API (single attempt).
 *
 * @param {import("playwright").Page} page
 * @param {{ logger?: (m: string) => void, bearerToken?: string | null, skipFetchLog?: boolean }} [opts]
 */
async function fetchPepcoApplicationsListFromApi(page, opts = {}) {
  const logger = opts.logger;
  const bearerToken = opts.bearerToken != null ? String(opts.bearerToken).trim() : "";
  const authorizationAttached = Boolean(bearerToken);

  if (!opts.skipFetchLog) {
    logStep(logger, "Fetching PEPCO applications list");
  }

  if (!bearerToken) {
    logStep(logger, "PEPCO applications list skipped (no bearer token)");
    return {
      ok: false,
      cards: [],
      customerFirstName: null,
      authorizationAttached: false,
      reason: "no_bearer_token",
      httpStatus: 0,
    };
  }

  const url = `${PEPCO_EUAPI_BASE}/applications`;
  try {
    const res = await page.request.get(url, {
      headers: buildPepcoApiHeaders({ bearerToken }),
      timeout: 90_000,
    });
    const contentType = res.headers()["content-type"] || res.headers()["Content-Type"] || "";
    const text = await res.text().catch(() => "");
    const httpStatus = res.status();

    /** @type {unknown} */
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }

    if (!res.ok() || !body || typeof body !== "object") {
      const detail = buildPepcoApiErrorMessage({
        endpoint: url,
        httpStatus,
        contentType,
        responseText: text,
        body,
        diagnostics: await collectPepcoPageDiagnostics(page),
        authorizationAttached,
      });
      logStep(logger, `PEPCO applications list API failed: ${detail}`);
      return {
        ok: false,
        cards: [],
        customerFirstName: null,
        authorizationAttached,
        reason: "http_or_non_json",
        httpStatus,
      };
    }

    const parsed = parsePepcoApplicationsListResponse(body);
    if (!parsed.ok) {
      logStep(logger, `PEPCO applications list API returned invalid payload (${parsed.reason})`);
      return {
        ok: false,
        cards: [],
        customerFirstName: null,
        authorizationAttached,
        reason: parsed.reason,
        httpStatus,
      };
    }

    logStep(
      logger,
      `Discovered ${parsed.cards.length} PEPCO project${parsed.cards.length === 1 ? "" : "s"}`,
    );
    return {
      ok: true,
      cards: parsed.cards,
      customerFirstName: parsed.customerFirstName,
      authorizationAttached,
      reason: null,
      httpStatus,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message.slice(0, 300) : String(e).slice(0, 300);
    logStep(logger, `PEPCO applications list API request failed: ${msg}`);
    return {
      ok: false,
      cards: [],
      customerFirstName: null,
      authorizationAttached,
      reason: "request_error",
      httpStatus: 0,
    };
  }
}

/**
 * @deprecated Prefer fetchPepcoApplicationsListFromApi — kept for legacy callers.
 * @param {import("playwright").Page} page
 * @param {{ logger?: (m: string) => void, skipFetchLog?: boolean, bearerToken?: string | null }} [opts]
 */
async function listPepcoApplicationsFromApi(page, opts = {}) {
  const out = await fetchPepcoApplicationsListFromApi(page, opts);
  if (!out.ok) return [];
  return out.cards.map((row) => ({
    applicationUuid: String(row.applicationId || ""),
    jobId: typeof row.jobId === "string" ? row.jobId : null,
    projectName: typeof row.title === "string" ? row.title : null,
  }));
}

/**
 * Read-only scrape of one PEPCO application via authenticated API calls.
 *
 * @param {import("playwright").Page} page
 * @param {string} applicationUuid
 * @param {{
 *   logger?: (m: string) => void;
 *   downloadDocuments?: boolean;
 *   coordinationId?: string;
 *   bearerToken?: string | null;
 * }} [options]
 */
async function scrapePepcoApplicationDetails(page, applicationUuid, options = {}) {
  const logger = options.logger;
  const downloadDocuments = options.downloadDocuments === true;
  const bearerToken = options.bearerToken != null ? String(options.bearerToken).trim() : "";
  const uuid = String(applicationUuid || "").trim();
  if (!uuid) throw new Error("applicationUuid is required");

  const scrapedAt = new Date().toISOString();
  const label = uuid;

  /** @type {Record<string, string | null>} */
  const errors = {
    overview: null,
    statusChanges: null,
    messages: null,
    documents: null,
  };

  /** @type {Array<{ documentName: string, error: string }>} */
  const downloadSectionErrors = [];

  let overview = null;
  let projectSummary = null;
  let projectDetails = null;
  let statusTracking = null;
  let statusChanges = [];
  let currentMilestone = null;
  let currentStatus = null;
  let statusLastUpdatedAt = null;
  let messageCount = 0;
  let latestMessageAt = null;
  /** @type {unknown[]} */
  let messages = [];
  let documentCount = 0;
  /** @type {unknown[]} */
  let documents = [];
  /** @type {unknown[]} */
  let downloadedFiles = [];

  logStep(logger, `Fetching overview for ${label}`);
  try {
    const overviewBody = await pepcoApiGetJson(
      page.request,
      `/applications/${encodeURIComponent(uuid)}?includeOverview=true`,
      { page, bearerToken },
    );
    const parsed = parseOverviewResponse(overviewBody);
    overview = parsed.overview;
    projectSummary = parsed.projectSummary;
    projectDetails = parsed.projectDetails;
    statusTracking = parsed.statusTracking;
  } catch (e) {
    errors.overview = e instanceof Error ? e.message.slice(0, 500) : String(e).slice(0, 500);
    logStep(logger, `Overview fetch failed: ${errors.overview}`);
  }

  logStep(logger, "Fetching status history");
  try {
    const statusBody = await pepcoApiGetJson(
      page.request,
      `/applications/${encodeURIComponent(uuid)}/status-changes`,
      { page, bearerToken },
    );
    const parsed = parseStatusChangesResponse(statusBody);
    statusChanges = parsed.statusChanges;
    currentMilestone = parsed.currentMilestone;
    currentStatus = parsed.currentStatus;
    statusLastUpdatedAt = parsed.statusLastUpdatedAt;
  } catch (e) {
    errors.statusChanges = e instanceof Error ? e.message.slice(0, 500) : String(e).slice(0, 500);
    logStep(logger, `Status history fetch failed: ${errors.statusChanges}`);
  }

  logStep(logger, "Fetching messages");
  try {
    const messagesBody = await pepcoApiGetJson(
      page.request,
      `/applications/${encodeURIComponent(uuid)}?includeMessages=true`,
      { page, bearerToken },
    );
    const parsed = parseMessagesResponse(messagesBody);
    messageCount = parsed.messageCount;
    latestMessageAt = parsed.latestMessageAt;
    messages = parsed.messages;
  } catch (e) {
    errors.messages = e instanceof Error ? e.message.slice(0, 500) : String(e).slice(0, 500);
    logStep(logger, `Messages fetch failed: ${errors.messages}`);
  }

  logStep(logger, "Fetching documents list");
  try {
    const documentsBody = await pepcoApiGetJson(
      page.request,
      `/applications/${encodeURIComponent(uuid)}?includeDocuments=true`,
      { page, bearerToken },
    );
    const parsed = parseDocumentsResponse(documentsBody);
    documentCount = parsed.documentCount;
    documents = parsed.documents;
  } catch (e) {
    errors.documents = e instanceof Error ? e.message.slice(0, 500) : String(e).slice(0, 500);
    logStep(logger, `Documents list fetch failed: ${errors.documents}`);
  }

  if (downloadDocuments && Array.isArray(documents) && documents.length > 0) {
    try {
      const dl = await downloadPepcoDocuments(page.request, uuid, /** @type {Array<{ documentName?: string | null }>} */ (documents), {
        coordinationId: options.coordinationId,
        logger,
        bearerToken,
      });
      downloadedFiles = dl.downloadedFiles;
      downloadSectionErrors.push(...dl.downloadErrors);
    } catch (e) {
      downloadSectionErrors.push({
        documentName: "*",
        error: e instanceof Error ? e.message.slice(0, 500) : String(e).slice(0, 500),
      });
    }
  }

  const sectionErrorCount = Object.values(errors).filter(Boolean).length;
  const hasAnyData =
    overview != null ||
    projectSummary != null ||
    statusChanges.length > 0 ||
    messages.length > 0 ||
    documents.length > 0;

  return {
    applicationUuid: uuid,
    overview,
    projectSummary,
    projectDetails,
    statusTracking,
    statusChanges,
    currentMilestone,
    currentStatus,
    statusLastUpdatedAt,
    messageCount,
    latestMessageAt,
    messages,
    documentCount,
    documents,
    downloadedFiles,
    scrapedAt,
    errors: {
      ...errors,
      downloads: downloadSectionErrors,
    },
    scrapeStatus:
      sectionErrorCount === 0 && downloadSectionErrors.length === 0
        ? "completed"
        : hasAnyData
          ? "partial"
          : "failed",
  };
}

module.exports = {
  getPepcoDocStorageRoot,
  resolvePepcoStoredDocumentPath,
  PEPCO_EUAPI_BASE,
  PEPCO_GET_SESSION_URL,
  PEPCO_API_HEADERS,
  buildPepcoApiHeaders,
  parsePepcoGetSessionToken,
  getPepcoBearerTokenViaSessionApi,
  getPepcoBearerTokenFromPage,
  isPlausiblePepcoBearerToken,
  findPepcoBearerTokenInValue,
  scrapePepcoApplicationDetails,
  normalizePepcoDashboardCardFromApiRow,
  parsePepcoApplicationsListResponse,
  fetchPepcoApplicationsListFromApi,
  listPepcoApplicationsFromApi,
  waitForPepcoDashboardLanding,
  waitForPepcoApplicationApiReady,
  waitForPepcoDashboardReady,
  probePepcoOverviewApi,
  parseOverviewResponse,
  parseStatusChangesResponse,
  parseMessagesResponse,
  parseDocumentsResponse,
};
