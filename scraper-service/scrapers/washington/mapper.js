"use strict";

/**
 * Future home: portal_data mapping for default ProjectDox.
 *
 * BLOCKED: mapping currently inlined in server.js scrape path and helpers.
 */

function describeWashingtonMapper() {
  return {
    jurisdiction: "washington-projectdox",
    trappedIn: "scraper-service/server.js",
    note: "Do not change portal_data keys consumed by src/pages/PortalDataViewer.tsx during migration.",
  };
}

module.exports = {
  describeWashingtonMapper,
};
