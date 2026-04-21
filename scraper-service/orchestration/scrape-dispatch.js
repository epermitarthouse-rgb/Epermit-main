"use strict";

/**
 * Planning-only scrape dispatch — mirrors key API guards from server.js POST /api/scrape
 * without executing scrapers (server.js cannot be required safely).
 *
 * Baltimore projectId guard source: server.js (~1196–1211).
 */

/**
 * @param {object} session — minimal fields used by planning
 * @param {{ permitNumber?: string, projectId?: string }} body
 */
function planScrapeRequest(session, body) {
  const permitNumber = body?.permitNumber;
  const projectId = body?.projectId;

  if (!session) {
    return {
      kind: "scrape-plan",
      ok: false,
      error: "Session not found",
      httpStatus: 404,
    };
  }

  if (!session.browser) {
    return {
      kind: "scrape-plan",
      ok: false,
      error: "Session expired.",
      httpStatus: 400,
    };
  }

  const portalType = session.portalType;
  const portalSubtype = session.portalSubtype || null;
  const portalUrlStr = String(session.portalUrl || "");
  const accelaIsBaltimore = portalUrlStr.toUpperCase().includes("BALTIMORE");
  const accelaIsFairfax = portalUrlStr.toUpperCase().includes("FAIRFAX");

  if (portalType === "accela") {
    if (!permitNumber || String(permitNumber).trim() === "") {
      return {
        kind: "scrape-plan",
        ok: false,
        error: "Accela scraping requires a permitNumber",
        httpStatus: 400,
      };
    }
    if (
      accelaIsBaltimore &&
      (!projectId || String(projectId).trim() === "")
    ) {
      return {
        kind: "scrape-plan",
        ok: false,
        error:
          "Baltimore Accela scraping requires projectId (projects.id) for permit integrity and DB write",
        httpStatus: 400,
        baltimore: true,
      };
    }
    if (
      accelaIsFairfax &&
      (!projectId || String(projectId).trim() === "")
    ) {
      return {
        kind: "scrape-plan",
        ok: false,
        error:
          "Fairfax Accela scraping requires projectId (projects.id) for permit integrity and DB write",
        httpStatus: 400,
        fairfax: true,
      };
    }
    return {
      kind: "scrape-plan",
      ok: true,
      portalType,
      portalSubtype,
      handlerKey: "baltimore-or-accela",
      moduleHint: "scrapers/baltimore/scrape.js → accela-scraper.scrapeAccelaRecord",
      baltimore: accelaIsBaltimore,
      execution: {
        status: "blocked-on-server-js",
        reason:
          "Scrape orchestration and Supabase sync remain in server.js until migration.",
      },
    };
  }

  if (portalSubtype === "pgc-eplan") {
    return {
      kind: "scrape-plan",
      ok: true,
      portalType,
      portalSubtype,
      handlerKey: "pgc",
      moduleHint: "scrapers/pgc/scrape.js",
      execution: {
        status: "blocked-on-server-js",
        reason: "scrapePgcAll and mappers remain in server.js.",
      },
    };
  }

  if (portalSubtype === "montgomery-projectdox") {
    return {
      kind: "scrape-plan",
      ok: true,
      portalType,
      portalSubtype,
      handlerKey: "montgomery",
      moduleHint: "scrapers/montgomery/scrape.js",
      execution: {
        status: "blocked-on-server-js",
        reason: "scrapeMontgomeryAll remains in server.js.",
      },
    };
  }

  if (portalSubtype === "howard-projectdox") {
    return {
      kind: "scrape-plan",
      ok: true,
      portalType,
      portalSubtype,
      handlerKey: "howard",
      moduleHint: "scrapers/howard/scrape.js",
      execution: {
        status: "blocked-on-server-js",
        reason: "scrapeHowardAll remains in server.js.",
      },
    };
  }

  if (portalType === "projectdox") {
    return {
      kind: "scrape-plan",
      ok: true,
      portalType,
      portalSubtype: null,
      handlerKey: "washington-projectdox",
      moduleHint: "scrapers/washington/scrape.js (logic still in server.js scrapeAll)",
      execution: {
        status: "blocked-on-server-js",
        reason: "Default ProjectDox scrapeAll/TAB_DEFS remain in server.js.",
      },
    };
  }

  return {
    kind: "scrape-plan",
    ok: false,
    error: "Unknown portal session type",
    httpStatus: 400,
  };
}

module.exports = {
  planScrapeRequest,
};
