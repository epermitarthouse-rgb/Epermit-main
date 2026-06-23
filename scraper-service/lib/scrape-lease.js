"use strict";

/**
 * Active scrape lease: prevents idle session cleanup while a scrape owns the browser.
 * Refresh before/after each folder and file during long PGC harvests.
 */

function acquireScrapeLease(session, sessionId, rearmIdleTimeout) {
  if (!session) return;
  session._scrapeActive = true;
  session._scrapeLeaseActive = true;
  session._scrapeLeaseAcquiredAt = Date.now();
  session._scrapeLeaseLastRefreshAt = Date.now();
  if (typeof rearmIdleTimeout === "function" && sessionId) {
    rearmIdleTimeout(sessionId);
  }
  console.log(
    `[Session][lease] acquired sid=${sessionId || "?"} at=${new Date().toISOString()}`,
  );
}

function refreshScrapeLease(session, sessionId, rearmIdleTimeout) {
  if (!session || !session._scrapeLeaseActive) return;
  session._scrapeActive = true;
  session._scrapeLeaseLastRefreshAt = Date.now();
  if (typeof rearmIdleTimeout === "function" && sessionId) {
    rearmIdleTimeout(sessionId);
  }
}

function releaseScrapeLease(session, sessionId, rearmIdleTimeout, reason) {
  if (!session) return;
  session._scrapeActive = false;
  session._scrapeLeaseActive = false;
  session._scrapeLeaseReleasedAt = Date.now();
  session._scrapeLeaseReleaseReason = reason || "completed";
  if (typeof rearmIdleTimeout === "function" && sessionId) {
    rearmIdleTimeout(sessionId);
  }
  console.log(
    `[Session][lease] released sid=${sessionId || "?"} reason=${reason || "completed"}`,
  );
}

function hasActiveScrapeLease(session) {
  return Boolean(session && (session._scrapeLeaseActive || session._scrapeActive));
}

module.exports = {
  acquireScrapeLease,
  refreshScrapeLease,
  releaseScrapeLease,
  hasActiveScrapeLease,
};
