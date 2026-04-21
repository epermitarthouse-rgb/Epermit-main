"use strict";

/**
 * Idle timeout aligned with server.js SESSION_IDLE_TIMEOUT_MS.
 * Source mirror: scraper-service/server.js (~1141).
 */

const SESSION_IDLE_TIMEOUT_MS = 15 * 60 * 1000;

module.exports = {
  SESSION_IDLE_TIMEOUT_MS,
};
