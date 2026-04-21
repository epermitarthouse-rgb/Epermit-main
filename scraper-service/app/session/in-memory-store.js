"use strict";

/**
 * Single in-memory session map + idle lifecycle for POST /api/login and /api/scrape.
 * Logic delegated to sessions/session-lifecycle.js (same behavior as former server.js block).
 */

const { createSessionLifecycle } = require("../../sessions/session-lifecycle.js");

const sessions = /** @type {Record<string, any>} */ ({});
const { rearmSessionIdleTimeout, cleanupSession, SESSION_IDLE_TIMEOUT_MS } =
  createSessionLifecycle(sessions);

module.exports = {
  sessions,
  rearmSessionIdleTimeout,
  cleanupSession,
  SESSION_IDLE_TIMEOUT_MS,
};
