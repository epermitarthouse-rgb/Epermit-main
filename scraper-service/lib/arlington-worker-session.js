"use strict";

const path = require("path");
const { resolveStoredPortalPassword } = require("../app/services/portal-credentials/portal-credentials-crypto.js");
const {
  accelaLogin,
  detectAccelaHumanLoginRequired,
  arlingtonPlanReviewSessionBrowserUsable,
} = require("../accela-scraper.js");
const { launchChromiumForScraper } = require("../shared/playwright-launch-for-scraper.js");
const { SESSION_IDLE_TIMEOUT_MS } = require("../sessions/session-ttl.js");

const DEFAULT_DASHBOARD_URL =
  "https://aca-prod.accela.com/ARLINGTONCO/Default.aspx";

/**
 * Create a fresh Playwright session for Arlington worker cycles (no original HTTP session).
 * @param {object} opts
 */
async function createArlingtonWorkerSession(opts) {
  const {
    supabase,
    job,
    sessions,
    rearmSessionIdleTimeout,
    cleanupSession,
    preferSessionId,
  } = opts;

  if (
    preferSessionId &&
    sessions[preferSessionId] &&
    arlingtonPlanReviewSessionBrowserUsable(sessions[preferSessionId])
  ) {
    const session = sessions[preferSessionId];
    session._scrapeJobId = job.id;
    session._scrapeProjectId = job.project_id;
    session._scrapePermitNumber = job.permit_number;
    session.userId = job.user_id;
    session.arlingtonDurableMode = true;
    return {
      session,
      sessionId: preferSessionId,
      reused: true,
      async dispose() {},
    };
  }

  const userId = `${job.user_id || ""}`.trim();
  const projectId = `${job.project_id || ""}`.trim();
  let credentialId = `${job.credential_id || ""}`.trim();

  if (!credentialId && projectId) {
    const { data: projRow } = await supabase
      .from("projects")
      .select("credential_id")
      .eq("id", projectId)
      .maybeSingle();
    credentialId = `${projRow?.credential_id || ""}`.trim();
  }
  if (!credentialId) {
    throw new Error("credential_not_linked");
  }

  const { data: cred, error: credErr } = await supabase
    .from("portal_credentials")
    .select("user_id, portal_username, portal_password, login_url")
    .eq("id", credentialId)
    .maybeSingle();
  if (credErr || !cred || (userId && cred.user_id !== userId)) {
    throw new Error("credential_not_found");
  }

  const username = cred.portal_username;
  const password = resolveStoredPortalPassword(cred.portal_password);
  const portalUrlRaw =
    cred.login_url && String(cred.login_url).trim()
      ? String(cred.login_url).trim()
      : DEFAULT_DASHBOARD_URL;
  const dashboardUrl = portalUrlRaw
    .replace(/\/+$/, "")
    .replace(/\/User\/Index$/i, "");
  if (!dashboardUrl.toUpperCase().includes("ARLINGTONCO")) {
    throw new Error("not_arlington_credential");
  }

  const browser = await launchChromiumForScraper({
    label: "arlington-durable-worker",
    route: "worker",
    file: "arlington-worker-session.js",
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    acceptDownloads: true,
  });
  const page = await context.newPage();
  await accelaLogin(page, username, password, dashboardUrl);

  const humanLogin = await detectAccelaHumanLoginRequired(page);
  if (humanLogin) {
    await browser.close().catch(() => {});
    throw new Error("login_requires_manual_intervention");
  }

  const sessionId =
    Date.now().toString(36) + Math.random().toString(36).slice(2);
  const session = {
    status: "logged_in",
    portalType: "accela",
    portalUrl: dashboardUrl,
    dashboardUrl,
    projects: [],
    browser,
    context,
    page,
    username,
    password,
    userId,
    credentialId,
    message: "Arlington durable worker session",
    progress: 0,
    total: 0,
    data: {},
    arlingtonDurableMode: true,
    _scrapeJobId: job.id,
    _scrapeProjectId: job.project_id,
    _scrapePermitNumber: job.permit_number,
  };
  sessions[sessionId] = session;
  if (typeof rearmSessionIdleTimeout === "function") {
    rearmSessionIdleTimeout(sessionId);
  } else if (typeof cleanupSession === "function") {
    session._timeout = setTimeout(
      () => cleanupSession(sessionId, "idle_timeout"),
      SESSION_IDLE_TIMEOUT_MS,
    );
  }

  return {
    session,
    sessionId,
    reused: false,
    async dispose() {
      session._scrapeActive = false;
      if (browser) await browser.close().catch(() => {});
      delete sessions[sessionId];
    },
  };
}

module.exports = {
  createArlingtonWorkerSession,
};
