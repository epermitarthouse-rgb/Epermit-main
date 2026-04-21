"use strict";

/**
 * Session shape documentation (runtime validation optional in a later phase).
 *
 * Production sessions are plain objects assigned in server.js, e.g.:
 * - portalType: "accela" | "projectdox"
 * - portalSubtype: "pgc-eplan" | "montgomery-projectdox" | "howard-projectdox" | undefined
 * - howardWebUiBases?: string[] (Howard ProjectDox web UI origins, optional)
 * - browser, context, page (Playwright)
 * - status, message, progress, total
 * - _timeout, _scrapeActive (internal)
 */

/** @typedef {{ portalType?: string, portalSubtype?: string | null, portalUrl?: string, browser?: unknown, context?: unknown, page?: unknown, status?: string, message?: string, progress?: number, total?: number, _timeout?: ReturnType<typeof setTimeout>, _scrapeActive?: boolean }} ScraperSession */

module.exports = {
  /** @type {null} */
  validateSessionShape: null,
};
