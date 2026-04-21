"use strict";

/**
 * Optional disk debug screenshots (PNG) under scraper-service.
 * Default: off. Set SCRAPER_DEBUG_ARTIFACTS=1 (or true/yes) to write them.
 * Does not affect scraping logic or API responses.
 */
function isScraperDebugArtifactsEnabled() {
  const v = String(process.env.SCRAPER_DEBUG_ARTIFACTS || "")
    .trim()
    .toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

module.exports = {
  isScraperDebugArtifactsEnabled,
};
