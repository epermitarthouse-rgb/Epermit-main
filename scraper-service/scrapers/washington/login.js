"use strict";

const { planPortalRoute } = require("../../orchestration/portal-dispatch.js");

/**
 * Future home: Washington / default Avolve ProjectDox login.
 *
 * BLOCKED: performLogin and /api/login branch for generic ProjectDox remain inside
 * scraper-service/server.js. Requiring server.js would start the legacy HTTP server.
 */

function describeWashingtonLogin() {
  return {
    jurisdiction: "washington-projectdox",
    trappedIn: "scraper-service/server.js",
    symbols: ["performLogin", "POST /api/login (non-PGC, non-Montgomery branch)"],
    routePreview: (portalUrl) => planPortalRoute({ portalUrl }),
  };
}

module.exports = {
  describeWashingtonLogin,
};
