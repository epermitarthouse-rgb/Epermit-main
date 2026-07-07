"use strict";

const crypto = require("crypto");
const { SESSION_IDLE_TIMEOUT_MS } = require("../../../sessions/session-ttl.js");

/** @typedef {{ sessionId: string, coordinationId: string, userId: string, browser: import('playwright').Browser, context: import('playwright').BrowserContext, page: import('playwright').Page, createdAt: number, updatedAt: number, status: string, continueAction: string | null, captureApplicationIds: boolean, applicationUuids?: string[], downloadDocuments?: boolean, ttlHandle?: ReturnType<typeof setTimeout> }} PepcoAwaitingSession */

/** @type {Map<string, PepcoAwaitingSession>} */
const sessions = new Map();

function generateSessionId() {
  return `pepco_${crypto.randomBytes(24).toString("base64url")}`;
}

/**
 * Close browser/context and drop from registry.
 * @param {PepcoAwaitingSession | null | undefined} record
 * @param {string} [reason]
 */
async function disposePepcoSessionRecord(record, reason = "dispose") {
  if (!record) return;
  if (record.ttlHandle) {
    clearTimeout(record.ttlHandle);
    record.ttlHandle = undefined;
  }
  try {
    if (record.context) await record.context.close().catch(() => {});
    if (record.browser) await record.browser.close().catch(() => {});
  } catch (_) {}
  record.browser = /** @type {null} */ (null);
  record.context = /** @type {null} */ (null);
  record.page = /** @type {null} */ (null);
  sessions.delete(record.sessionId);
  console.log("[uci-pepco-session]", "closed session", `(reason=${reason})`);
}

/**
 * Sliding TTL — clear session if inactive for SESSION_IDLE_TIMEOUT_MS.
 * @param {PepcoAwaitingSession} record
 */
function armTtl(record) {
  if (record.ttlHandle) clearTimeout(record.ttlHandle);
  const inactiveFor = Date.now() - record.updatedAt;
  const remaining = SESSION_IDLE_TIMEOUT_MS - inactiveFor;
  if (remaining <= 0) {
    void disposePepcoSessionRecord(record, "ttl_idle");
    return;
  }
  record.ttlHandle = setTimeout(() => {
    void disposePepcoSessionRecord(record, "ttl_timeout");
  }, remaining);
}

function pruneStaleSessions(now = Date.now()) {
  for (const [, rec] of [...sessions.entries()]) {
    if (now - rec.updatedAt > SESSION_IDLE_TIMEOUT_MS) {
      void disposePepcoSessionRecord(rec, "stale");
    }
  }
}

/**
 * @param {{
 *   coordinationId: string;
 *   userId: string;
 *   browser: import('playwright').Browser;
 *   context: import('playwright').BrowserContext;
 *   page: import('playwright').Page;
 *   sessionStatus?: string;
 *   continueAction?: string | null;
 *   captureApplicationIds?: boolean;
 *   applicationUuids?: string[];
 *   downloadDocuments?: boolean;
 * }} opts
 */
function registerAwaitingMfaSession(opts) {
  pruneStaleSessions();
  const sessionId = generateSessionId();
  const applicationUuids = Array.isArray(opts.applicationUuids)
    ? [...new Set(opts.applicationUuids.map((u) => String(u).trim()).filter(Boolean))]
    : undefined;
  /** @type {PepcoAwaitingSession} */
  const record = {
    sessionId,
    coordinationId: String(opts.coordinationId),
    userId: String(opts.userId),
    browser: opts.browser,
    context: opts.context,
    page: opts.page,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    status: opts.sessionStatus != null ? String(opts.sessionStatus) : "awaiting_mfa",
    continueAction: opts.continueAction != null ? String(opts.continueAction) : null,
    captureApplicationIds: opts.captureApplicationIds === true,
    applicationUuids,
    downloadDocuments:
      typeof opts.downloadDocuments === "boolean" ? opts.downloadDocuments : undefined,
    ttlHandle: undefined,
  };
  sessions.set(sessionId, record);
  armTtl(record);
  return record;
}

/** @returns {PepcoAwaitingSession | null} */
function getAwaitingPepcoSession(sessionId) {
  pruneStaleSessions();
  const id = sessionId != null ? String(sessionId).trim() : "";
  if (!id) return null;
  const rec = sessions.get(id);
  return rec ?? null;
}

/** @returns {PepcoAwaitingSession | null} */
function touchAwaitingPepcoSession(sessionId) {
  const rec = getAwaitingPepcoSession(sessionId);
  if (!rec) return null;
  rec.updatedAt = Date.now();
  armTtl(rec);
  return rec;
}

/**
 * @param {string} sessionId
 * @param {string} reason
 */
async function revokeAwaitingPepcoSession(sessionId, reason = "explicit") {
  const id = sessionId != null ? String(sessionId).trim() : "";
  const rec = id ? sessions.get(id) : null;
  if (rec) await disposePepcoSessionRecord(rec, reason);
}

/** @returns {PepcoAwaitingSession | null} */
function findAwaitingPepcoSessionForCoordination(coordinationId, userId, continueAction) {
  pruneStaleSessions();
  const cid = String(coordinationId);
  const uid = String(userId);
  const action = continueAction != null ? String(continueAction) : "";
  for (const [, rec] of sessions.entries()) {
    if (
      rec.coordinationId === cid &&
      rec.userId === uid &&
      rec.page &&
      rec.browser &&
      String(rec.continueAction || "") === action
    ) {
      return rec;
    }
  }
  return null;
}

/**
 * Dispose any in-memory PEP CO MFA sessions tied to this coordination + user (e.g. new login run).
 * @param {string} coordinationId
 * @param {string} userId
 */
async function disposeSessionsForCoordinationAndUser(coordinationId, userId) {
  pruneStaleSessions();
  const cid = String(coordinationId);
  const uid = String(userId);
  for (const [, rec] of [...sessions.entries()]) {
    if (rec.coordinationId === cid && rec.userId === uid) {
      await disposePepcoSessionRecord(rec, "superseded");
    }
  }
}

module.exports = {
  registerAwaitingMfaSession,
  getAwaitingPepcoSession,
  findAwaitingPepcoSessionForCoordination,
  touchAwaitingPepcoSession,
  revokeAwaitingPepcoSession,
  disposeSessionsForCoordinationAndUser,
  SESSION_PEPCO_IDLE_MS: SESSION_IDLE_TIMEOUT_MS,
};
