"use strict";

/**
 * Dashboard URL normalization aligned with server.js POST /api/login handling.
 * Source mirror: scraper-service/server.js (portalUrl trim / trailing slash / User/Index strip).
 */

const DEFAULT_DASHBOARD_URL = "https://washington-dc-us.avolvecloud.com";

/**
 * @param {string | undefined | null} portalUrl
 * @param {string} [fallback]
 * @returns {string}
 */
function normalizeDashboardUrl(portalUrl, fallback = DEFAULT_DASHBOARD_URL) {
  const trimmed = portalUrl && String(portalUrl).trim();
  if (!trimmed) return fallback;
  return trimmed
    .replace(/\/+$/, "")
    .replace(/\/User\/Index$/i, "");
}

module.exports = {
  DEFAULT_DASHBOARD_URL,
  normalizeDashboardUrl,
};
