"use strict";

/**
 * Portal classification for login/scrape routing.
 *
 * detectPortalType mirrors scraper-service/server.js (~177–189).
 * ProjectDox subtype classification uses existing host helpers (no server.js require —
 * requiring server.js would start the legacy listener).
 */

const pgcEplan = require("../pgc-eplan-scraper.js");
const montgomeryProjectDox = require("../scrapers/montgomery/projectdox-scraper.js");
const howardProjectDox = require("../scrapers/howard/projectdox-scraper.js");
const { normalizeDashboardUrl, DEFAULT_DASHBOARD_URL } = require("../shared/urls.js");

/** @typedef {"projectdox"|"accela"|"unknown"} PortalType */
/** @typedef {"pgc-eplan"|"montgomery-projectdox"|"howard-projectdox"|null} ProjectDoxSubtype */

/**
 * Mirror of server.js detectPortalType — keep in sync on migration.
 * @param {string} [url]
 * @returns {PortalType}
 */
function detectPortalType(url) {
  if (!url) return "projectdox";
  const lower = url.toLowerCase();
  if (
    lower.includes("avolvecloud.com") ||
    lower.includes("projectdox") ||
    lower.includes("eplans.princegeorgescountymd.gov")
  ) {
    return "projectdox";
  }
  /** Accela Citizen Access on agency-hosted domains (e.g. plus.fairfaxcounty.gov/CitizenAccess). */
  if (lower.includes("citizenaccess")) return "accela";
  if (lower.includes("accela.com")) return "accela";
  console.log(`[detectPortalType] no match for url: "${url}" lower: "${lower}"`);
  return "unknown";
}

/**
 * @param {string} dashboardUrl normalized
 * @returns {{ portalSubtype: ProjectDoxSubtype, handlerKey: string }}
 */
function classifyProjectDoxDashboard(dashboardUrl) {
  if (pgcEplan.isPgcEplanHost(dashboardUrl)) {
    return { portalSubtype: "pgc-eplan", handlerKey: "pgc" };
  }
  if (montgomeryProjectDox.isMontgomeryProjectDoxHost(dashboardUrl)) {
    return {
      portalSubtype: "montgomery-projectdox",
      handlerKey: "montgomery",
    };
  }
  if (howardProjectDox.isHowardProjectDoxHost(dashboardUrl)) {
    return {
      portalSubtype: "howard-projectdox",
      handlerKey: "howard",
    };
  }
  return { portalSubtype: null, handlerKey: "washington-projectdox" };
}

/**
 * High-level routing plan for a dashboard URL (no browser, no session).
 * @param {{ portalUrl?: string | null }} input
 */
function planPortalRoute(input) {
  const dashboardUrl = normalizeDashboardUrl(
    input?.portalUrl,
    DEFAULT_DASHBOARD_URL,
  );
  const portalType = detectPortalType(dashboardUrl);
  if (portalType === "projectdox") {
    const { portalSubtype, handlerKey } = classifyProjectDoxDashboard(dashboardUrl);
    return {
      dashboardUrl,
      portalType,
      portalSubtype,
      handlerKey,
      notes:
        portalSubtype === "pgc-eplan"
          ? "PGC flow may require saved portal credentials on linked Supabase project (see server.js login branch)."
          : null,
    };
  }
  if (portalType === "accela") {
    return {
      dashboardUrl,
      portalType,
      portalSubtype: null,
      handlerKey: "accela",
      notes: null,
    };
  }
  return {
    dashboardUrl,
    portalType: "unknown",
    portalSubtype: null,
    handlerKey: null,
    notes: "Unsupported portal type for quick classification.",
  };
}

module.exports = {
  DEFAULT_DASHBOARD_URL,
  detectPortalType,
  classifyProjectDoxDashboard,
  planPortalRoute,
  normalizeDashboardUrl,
};
