"use strict";

const { SESSION_IDLE_TIMEOUT_MS } = require("./session-ttl.js");

/**
 * Session idle cleanup — mirror of server.js rearmSessionIdleTimeout / cleanupSession.
 * Source mirror: scraper-service/server.js (~1143–1172).
 *
 * Pass the same `sessions` object reference server.js uses once migrated.
 *
 * @param {Record<string, any>} sessions
 */
function createSessionLifecycle(sessions) {
  function rearmSessionIdleTimeout(sid) {
    const s = sessions[sid];
    if (!s) return;
    if (s._timeout) clearTimeout(s._timeout);
    s._timeout = setTimeout(
      () => cleanupSession(sid, "idle_timeout"),
      SESSION_IDLE_TIMEOUT_MS,
    );
    console.log(`[Session][cleanup] rearmed sid=${sid} minutes=15`);
  }

  function cleanupSession(sid, reason = "unknown") {
    const s = sessions[sid];
    if (!s) return;
    if (reason === "idle_timeout" && s._scrapeActive === true) {
      console.log(
        `[Session][cleanup] skipped sid=${sid} reason=idle_timeout scrapeActive=true`,
      );
      rearmSessionIdleTimeout(sid);
      return;
    }
    console.log(
      `[Session][cleanup] sid=${sid} at=${new Date().toISOString()} browser=${!!s.browser} context=${!!s.context} reason=${reason}`,
    );
    if (s._timeout) clearTimeout(s._timeout);
    if (s.browser) s.browser.close().catch(() => {});
    s.browser = null;
    s.context = null;
    s.page = null;
  }

  return {
    rearmSessionIdleTimeout,
    cleanupSession,
    SESSION_IDLE_TIMEOUT_MS,
  };
}

module.exports = {
  createSessionLifecycle,
};
