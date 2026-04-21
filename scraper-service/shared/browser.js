"use strict";

/**
 * Headless policy aligned with server.js scraperRunsHeadless().
 * Source mirror: scraper-service/server.js (~86–94).
 *
 * Full Chromium launch path (launchChromiumForScraper) remains in server.js until extraction —
 * duplicating it here would fork behavior.
 */

function scraperRunsHeadless() {
  const raw = (
    process.env.SCRAPER_HEADLESS ||
    process.env.PLAYWRIGHT_HEADLESS ||
    ""
  )
    .trim()
    .toLowerCase();
  if (raw === "false" || raw === "0") return false;
  if (raw === "true" || raw === "1") return true;
  if (process.env.RAILWAY_ENVIRONMENT) return true;
  if (process.env.NODE_ENV === "production") return true;
  return false;
}

module.exports = {
  scraperRunsHeadless,
};
