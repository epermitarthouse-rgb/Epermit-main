"use strict";

const { planPortalRoute } = require("./portal-dispatch.js");

/**
 * Planning-only login dispatch — describes which scraper package should handle login.
 * Actual Playwright login remains in scraper-service/server.js until migration.
 */

/**
 * @param {{ username?: string, password?: string, portalUrl?: string | null }} body
 */
function planLoginRequest(body) {
  const username = body?.username;
  const password = body?.password;
  const route = planPortalRoute({ portalUrl: body?.portalUrl });

  const missingCreds = !username || password == null || String(password) === "";

  return {
    kind: "login-plan",
    route,
    credentialStatus: {
      usernamePresent: !!username,
      passwordPresent: password != null && String(password) !== "",
      missingForExecution: missingCreds,
    },
    execution: {
      status: "blocked-on-server-js",
      reason:
        "POST /api/login implementation and session creation remain in server.js (cannot require server.js without starting legacy listener).",
      nextModuleHint: route.handlerKey
        ? `scrapers/${route.handlerKey}/login.js`
        : null,
    },
  };
}

module.exports = {
  planLoginRequest,
};
