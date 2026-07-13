"use strict";

/** In-memory ring buffer for D12 foundation — no external bus wired yet. */
const MAX_EVENTS = 200;
/** @type {Array<{ name: string, payload: Record<string, unknown>, emitted_at: string }>} */
const recentEvents = [];

/**
 * @param {string} name
 * @param {Record<string, unknown>} [payload]
 */
function emitUciEvent(name, payload = {}) {
  const entry = {
    name: String(name),
    payload,
    emitted_at: new Date().toISOString(),
  };
  recentEvents.unshift(entry);
  if (recentEvents.length > MAX_EVENTS) {
    recentEvents.length = MAX_EVENTS;
  }
  return entry;
}

function listRecentUciEvents(limit = 50) {
  const n = Math.min(Math.max(Number(limit) || 50, 1), MAX_EVENTS);
  return recentEvents.slice(0, n);
}

function clearRecentUciEventsForTests() {
  recentEvents.length = 0;
}

module.exports = {
  emitUciEvent,
  listRecentUciEvents,
  clearRecentUciEventsForTests,
};
