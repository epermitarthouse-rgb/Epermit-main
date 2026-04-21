"use strict";

/**
 * Session store abstraction — future replacement for `const sessions = {}` in server.js.
 * Uses a plain object by default to match current server semantics (string keys).
 */

function createSessionStore() {
  return Object.create(null);
}

/**
 * @param {Record<string, unknown>} sessions
 */
function getSession(sessions, sessionId) {
  return sessions[sessionId];
}

/**
 * @param {Record<string, unknown>} sessions
 */
function setSession(sessions, sessionId, value) {
  sessions[sessionId] = value;
}

/**
 * @param {Record<string, unknown>} sessions
 */
function deleteSession(sessions, sessionId) {
  delete sessions[sessionId];
}

/**
 * @param {Record<string, unknown>} sessions
 */
function listSessionIds(sessions) {
  return Object.keys(sessions);
}

module.exports = {
  createSessionStore,
  getSession,
  setSession,
  deleteSession,
  listSessionIds,
};
