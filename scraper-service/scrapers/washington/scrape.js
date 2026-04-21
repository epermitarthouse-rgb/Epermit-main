"use strict";

const { planPortalRoute } = require("../../orchestration/portal-dispatch.js");

/**
 * Future home: default ProjectDox scrape (scrapeAll, TAB_DEFs, tab extraction).
 *
 * BLOCKED: implementation remains in server.js.
 */

function describeWashingtonScrape() {
  return {
    jurisdiction: "washington-projectdox",
    trappedIn: "scraper-service/server.js",
    symbols: ["scrapeAll", "TAB_DEFS", "POST /api/scrape (default branch)"],
    routePreview: (portalUrl) => planPortalRoute({ portalUrl }),
  };
}

module.exports = {
  describeWashingtonScrape,
};
