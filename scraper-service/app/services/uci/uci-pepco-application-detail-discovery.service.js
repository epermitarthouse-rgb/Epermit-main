"use strict";

const { resolveStoredPortalPassword } = require("../portal-credentials/portal-credentials-crypto.js");
const {
  launchChromiumForScraper,
  isBrowserLaunchError,
} = require("../../../shared/playwright-launch-for-scraper.js");
const { runPepcoLoginFlow, assessPepcoPostMfaResumeState, submitPepcoMfaCode, maybePepcoSubmitCodeFailureScreenshot } = require("../../../scrapers/pepco/login-flow.js");
const {
  scrapePepcoApplicationDetails,
  waitForPepcoApplicationApiReady,
  waitForPepcoDashboardLanding,
  getPepcoBearerTokenViaSessionApi,
} = require("../../../scrapers/pepco/application-detail-discovery.js");
const { capturePepcoApplicationIds, extractPepcoDashboardCards } = require("../../../scrapers/pepco/dashboard-discovery.js");
const { getCoordinationRecordById } = require("./uci-records.service.js");
const { requireProjectAccess } = require("./uci-access.service.js");
const {
  registerAwaitingMfaSession,
  disposeSessionsForCoordinationAndUser,
  getAwaitingPepcoSession,
  findAwaitingPepcoSessionForCoordination,
  touchAwaitingPepcoSession,
  revokeAwaitingPepcoSession,
} = require("./uci-pepco-session-store.js");
const {
  pollGraphMailboxForPepcoMfaCode,
  getMailboxStatusForUser,
} = require("../microsoft/microsoft-mailbox.service.js");
const {
  patchCoordinationAfterDiscovery,
  assertPepcoCoordination,
  resolvePepcoPortalCredential,
  pickPepcoMfaCoordinationMeta,
} = require("./uci-pepco-discovery.service.js");

const CONTINUE_ACTION = "discover_application_details";

const DASHBOARD_API_NOT_READY_MSG =
  "PEPCO login succeeded, but application detail scraping could not continue because no valid application UUID/API readiness was available.";

const NO_APPLICATION_UUID_MSG =
  "PEPCO login succeeded, but no application UUID was available. Run Discover + Capture Application IDs first.";

const NO_BEARER_TOKEN_MSG =
  "PEPCO dashboard loaded, but GetSession did not return an API token.";

/**
 * @param {(msg: string) => void} push
 */
function makeProgressLogger(progress, push) {
  return (msg) => {
    const line = String(msg || "").trim();
    if (!line) return;
    push(line);
    console.log(`[uci-pepco-app-detail] ${line}`);
  };
}

/**
 * @param {unknown} bodyUuids
 * @param {unknown} downloadDocumentsOpt
 */
function buildAppDetailRunOptions(bodyUuids, downloadDocumentsOpt) {
  const applicationUuids = Array.isArray(bodyUuids)
    ? [...new Set(bodyUuids.map((u) => String(u).trim()).filter(Boolean))]
    : [];
  const downloadDocuments = downloadDocumentsOpt === true;
  return { applicationUuids, downloadDocuments };
}

/**
 * @param {{ applicationUuids?: string[], downloadDocuments?: boolean } | null | undefined} rec
 * @param {unknown} bodyUuids
 * @param {unknown} bodyDownloadDocumentsOpt
 * @param {(msg: string) => void} log
 */
function resolveAppDetailResumeOptions(rec, bodyUuids, bodyDownloadDocumentsOpt, log) {
  const hasBodyUuids = Array.isArray(bodyUuids);
  const applicationUuids = hasBodyUuids
    ? [...new Set(bodyUuids.map((u) => String(u).trim()).filter(Boolean))]
    : Array.isArray(rec?.applicationUuids)
      ? [...rec.applicationUuids]
      : [];

  /** @type {boolean} */
  let downloadDocuments;
  if (typeof bodyDownloadDocumentsOpt === "boolean") {
    downloadDocuments = bodyDownloadDocumentsOpt;
  } else if (typeof rec?.downloadDocuments === "boolean") {
    downloadDocuments = rec.downloadDocuments;
  } else {
    downloadDocuments = false;
  }

  log(
    `resuming app-detail options: uuidCount=${applicationUuids.length} downloadDocuments=${downloadDocuments}`,
  );
  return { applicationUuids, downloadDocuments };
}

/**
 * @param {{
 *   coordinationId: string;
 *   userId: string;
 *   browser: import("playwright").Browser;
 *   context: import("playwright").BrowserContext;
 *   page: import("playwright").Page;
 *   sessionStatus?: string;
 *   continueAction?: string | null;
 *   captureApplicationIds?: boolean;
 *   bodyUuids?: string[];
 *   downloadDocumentsOpt?: unknown;
 *   log: (msg: string) => void;
 * }} opts
 */
function registerAppDetailAwaitingMfaSession(opts) {
  const runOptions = buildAppDetailRunOptions(opts.bodyUuids, opts.downloadDocumentsOpt);
  opts.log(
    `stored app-detail resume options: uuidCount=${runOptions.applicationUuids.length} downloadDocuments=${runOptions.downloadDocuments}`,
  );
  return registerAwaitingMfaSession({
    coordinationId: opts.coordinationId,
    userId: opts.userId,
    browser: opts.browser,
    context: opts.context,
    page: opts.page,
    sessionStatus: opts.sessionStatus,
    continueAction: opts.continueAction,
    captureApplicationIds: opts.captureApplicationIds,
    applicationUuids: runOptions.applicationUuids,
    downloadDocuments: runOptions.downloadDocuments,
  });
}

/**
 * Resolve application UUIDs from request body or stored dashboard metadata (no network).
 *
 * @param {Record<string, unknown>} coordRecord
 * @param {string[] | undefined} bodyUuids
 * @param {(msg: string) => void} log
 */
function resolveApplicationUuidsFromSources(coordRecord, bodyUuids, log) {
  if (Array.isArray(bodyUuids)) {
    const explicit = bodyUuids.map((u) => String(u).trim()).filter(Boolean);
    log(
      `Using ${explicit.length} application UUID${explicit.length === 1 ? "" : "s"} from request body/session`,
    );
    return [...new Set(explicit)];
  }

  const meta =
    coordRecord.metadata &&
    typeof coordRecord.metadata === "object" &&
    coordRecord.metadata !== null &&
    !Array.isArray(coordRecord.metadata)
      ? /** @type {Record<string, unknown>} */ (coordRecord.metadata)
      : {};

  const dash = meta.pepco_dashboard_discovery;
  const dashObj =
    dash && typeof dash === "object" && !Array.isArray(dash)
      ? /** @type {{ cards?: unknown }} */ (dash)
      : null;
  const cards = Array.isArray(dashObj?.cards) ? dashObj.cards : [];
  const fromMeta = cards
    .map((c) => {
      if (!c || typeof c !== "object") return null;
      const id = /** @type {{ applicationId?: unknown }} */ (c).applicationId;
      return typeof id === "string" && id.trim() ? id.trim() : null;
    })
    .filter(Boolean);

  if (fromMeta.length > 0) {
    log(
      `Using ${fromMeta.length} application UUID${fromMeta.length === 1 ? "" : "s"} from dashboard discovery metadata`,
    );
    return [...new Set(/** @type {string[]} */ (fromMeta))];
  }

  return [];
}

/**
 * Resolve application UUIDs from request body, stored dashboard metadata, or dashboard DOM capture.
 *
 * @param {Record<string, unknown>} coordRecord
 * @param {string[] | undefined} bodyUuids
 * @param {import("playwright").Page} page
 * @param {(msg: string) => void} log
 */
async function resolveApplicationUuids(coordRecord, bodyUuids, page, log) {
  const fromSources = resolveApplicationUuidsFromSources(coordRecord, bodyUuids, log);
  if (fromSources.length > 0) return fromSources;

  log("No UUIDs found; falling back to dashboard discovery/API");
  const extracted = await extractPepcoDashboardCards(page, { logger: log });
  const cards = Array.isArray(extracted?.cards) ? extracted.cards : [];
  const envelope = await capturePepcoApplicationIds(page, cards, { logger: log });
  const capturedCards = Array.isArray(envelope?.cards) ? envelope.cards : [];
  const fromCapture = capturedCards
    .map((c) => {
      if (!c || typeof c !== "object") return null;
      const id = /** @type {{ applicationId?: unknown }} */ (c).applicationId;
      return typeof id === "string" && id.trim() ? id.trim() : null;
    })
    .filter(Boolean);

  if (fromCapture.length > 0) {
    log(`Found ${fromCapture.length} application UUID${fromCapture.length === 1 ? "" : "s"} from dashboard capture`);
    return [...new Set(/** @type {string[]} */ (fromCapture))];
  }

  log("No application UUIDs found after dashboard capture fallback");
  return [];
}

/**
 * @param {unknown} overview
 */
function pickOverviewJobId(overview) {
  if (!overview || typeof overview !== "object") return null;
  const jobId = /** @type {{ jobId?: unknown }} */ (overview).jobId;
  return typeof jobId === "string" ? jobId : null;
}

/**
 * @param {unknown} overview
 */
function pickOverviewProjectName(overview) {
  if (!overview || typeof overview !== "object") return null;
  const name = /** @type {{ projectName?: unknown }} */ (overview).projectName;
  return typeof name === "string" ? name : null;
}

/**
 * @param {Array<Record<string, unknown>>} existingApps
 * @param {Array<Record<string, unknown>>} incomingApps
 */
function mergeApplicationDetailsByUuid(existingApps, incomingApps) {
  /** @type {Map<string, Record<string, unknown>>} */
  const map = new Map();

  for (const app of existingApps) {
    if (!app || typeof app !== "object") continue;
    const id = String(app.applicationUuid || "").trim();
    if (id) map.set(id, app);
  }

  for (const app of incomingApps) {
    if (!app || typeof app !== "object") continue;
    const id = String(app.applicationUuid || "").trim();
    if (id) map.set(id, app);
  }

  return Array.from(map.values());
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} coordinationId
 * @param {string} projectId
 * @param {Array<Record<string, unknown>>} applications
 * @param {string} lastStatus
 */
async function persistPepcoApplicationDetailDiscovery(
  supabase,
  coordinationId,
  projectId,
  applications,
  lastStatus,
) {
  const now = new Date().toISOString();

  const { data: row, error: fetchErr } = await supabase
    .from("coordination_records")
    .select("metadata")
    .eq("id", coordinationId)
    .eq("project_id", projectId)
    .maybeSingle();

  if (fetchErr) {
    console.error("[uci-pepco-app-detail] metadata fetch failed:", fetchErr.message);
    return;
  }

  const prev =
    row && typeof row.metadata === "object" && row.metadata !== null && !Array.isArray(row.metadata)
      ? /** @type {Record<string, unknown>} */ (row.metadata)
      : {};

  const prevDiscovery = prev.pepco_application_detail_discovery;
  const prevDiscoveryObj =
    prevDiscovery && typeof prevDiscovery === "object" && !Array.isArray(prevDiscovery)
      ? /** @type {{ applications?: unknown }} */ (prevDiscovery)
      : null;
  const prevApps = Array.isArray(prevDiscoveryObj?.applications)
    ? /** @type {Array<Record<string, unknown>>} */ (prevDiscoveryObj.applications)
    : [];

  const mergedApplications = mergeApplicationDetailsByUuid(prevApps, applications);

  const metadata = { ...prev };
  metadata.pepco_application_detail_discovery = {
    lastStatus,
    lastScrapedAt: now,
    applications: mergedApplications,
  };

  const primary =
    applications.find((a) => String(a.scrapeStatus || "") === "completed") ||
    applications.find((a) => String(a.scrapeStatus || "") === "partial") ||
    applications[applications.length - 1] ||
    mergedApplications.find((a) => String(a.scrapeStatus || "") === "completed") ||
    mergedApplications.find((a) => String(a.scrapeStatus || "") === "partial") ||
    mergedApplications[0] ||
    null;

  if (primary) {
    metadata.pepco_current_status =
      typeof primary.currentStatus === "string" ? primary.currentStatus : null;
    metadata.pepco_current_milestone =
      typeof primary.currentMilestone === "string" ? primary.currentMilestone : null;
    metadata.pepco_status_last_updated_at =
      typeof primary.statusLastUpdatedAt === "string" ? primary.statusLastUpdatedAt : null;
    metadata.pepco_message_count =
      typeof primary.messageCount === "number" ? primary.messageCount : null;
    metadata.pepco_latest_message_at =
      typeof primary.latestMessageAt === "string" ? primary.latestMessageAt : null;
    metadata.pepco_document_count =
      typeof primary.documentCount === "number" ? primary.documentCount : null;
    metadata.pepco_overview_project_name = pickOverviewProjectName(primary.overview);
    metadata.pepco_overview_job_id = pickOverviewJobId(primary.overview);
  }

  const { error: upErr } = await supabase
    .from("coordination_records")
    .update({ metadata })
    .eq("id", coordinationId)
    .eq("project_id", projectId);

  if (upErr) console.error("[uci-pepco-app-detail] coordination update failed:", upErr.message);
}

/**
 * @param {import("playwright").Page} page
 * @param {string[]} uuids
 * @param {{ downloadDocuments?: boolean, coordinationId?: string, log: (m: string) => void }} opts
 */
async function scrapeAllApplicationDetails(page, uuids, opts) {
  /** @type {Array<Record<string, unknown>>} */
  const applications = [];

  for (let i = 0; i < uuids.length; i++) {
    const uuid = uuids[i];
    const jobHint = uuid;
    opts.log(`Fetching overview for ${jobHint} (${i + 1}/${uuids.length})`);
    const detail = await scrapePepcoApplicationDetails(page, uuid, {
      logger: opts.log,
      downloadDocuments: opts.downloadDocuments === true,
      coordinationId: opts.coordinationId,
      bearerToken: opts.bearerToken,
    });
    applications.push(detail);
  }

  return applications;
}

/**
 * @param {Array<Record<string, unknown>>} applications
 */
function summarizeScrapeStatus(applications) {
  if (!applications.length) return "failed";
  const allCompleted = applications.every((a) => String(a.scrapeStatus || "") === "completed");
  if (allCompleted) return "completed";
  const anyData = applications.some(
    (a) => String(a.scrapeStatus || "") === "completed" || String(a.scrapeStatus || "") === "partial",
  );
  return anyData ? "partial" : "failed";
}

async function runApplicationDetailScrapeOnPage(opts) {
  const {
    supabase,
    coordinationIdTrim,
    projectId,
    coordRecord,
    page,
    applicationUuidsBody,
    preResolvedUuids,
    downloadDocuments,
    bearerToken: bearerTokenOpt,
    log,
    progress,
  } = opts;

  const uuids =
    Array.isArray(preResolvedUuids) && preResolvedUuids.length > 0
      ? [...new Set(preResolvedUuids.map((u) => String(u).trim()).filter(Boolean))]
      : await resolveApplicationUuids(
          /** @type {Record<string, unknown>} */ (coordRecord),
          applicationUuidsBody,
          page,
          log,
        );

  if (uuids.length === 0) {
    log("No application UUIDs found to scrape");
    return {
      status: "failed",
      error_code: "NO_APPLICATION_UUIDS",
      message:
        "No PEPCO application UUIDs found. Run dashboard discovery with Capture Application IDs or pass application_uuids.",
      progress,
      applications: [],
    };
  }

  let bearerToken = bearerTokenOpt != null ? String(bearerTokenOpt).trim() : "";
  if (!bearerToken) {
    const tokenOut = await getPepcoBearerTokenViaSessionApi(page, log);
    if (tokenOut?.token) {
      bearerToken = tokenOut.token;
    }
  }

  if (!bearerToken) {
    log(NO_BEARER_TOKEN_MSG);
    return {
      status: "failed",
      error_code: "PEPCO_BEARER_TOKEN_NOT_FOUND",
      message: NO_BEARER_TOKEN_MSG,
      progress,
      applications: [],
    };
  }

  log(`Found ${uuids.length} application(s) to scrape`);

  if (downloadDocuments) {
    log("Document downloads enabled for this run");
  } else {
    log("Documents will be listed only");
  }

  const applications = await scrapeAllApplicationDetails(page, uuids, {
    downloadDocuments,
    coordinationId: coordinationIdTrim,
    log,
    bearerToken,
  });

  const lastStatus = summarizeScrapeStatus(applications);
  log("Saving PEPCO application detail snapshot");
  await persistPepcoApplicationDetailDiscovery(
    supabase,
    coordinationIdTrim,
    projectId,
    applications,
    lastStatus,
  );

  log(`Completed (${lastStatus}) — scraped ${applications.length} application(s)`);

  return {
    status: lastStatus,
    checkpoint: "application_details_scraped",
    applications_scraped: applications.length,
    applications,
    progress,
  };
}

/**
 * @param {string} sid
 * @param {string[]} progress
 * @param {string} [message]
 */
function recoverableAppDetailFailure(sid, progress, message) {
  touchAwaitingPepcoSession(sid);
  return {
    status: "failed",
    error_code: "DASHBOARD_API_NOT_READY",
    message: message || DASHBOARD_API_NOT_READY_MSG,
    session_id: sid,
    continue_action: CONTINUE_ACTION,
    progress,
  };
}

/**
 * @param {string} sid
 * @param {unknown} error
 * @param {string[]} progress
 * @param {(m: string) => void} log
 */
function scrapeFailureFromError(sid, error, progress, log) {
  const err = error instanceof Error ? error : new Error(String(error));
  const detail =
    err && typeof /** @type {Error & { detail?: string }} */ (err).detail === "string"
      ? /** @type {Error & { detail?: string }} */ (err).detail
      : err.message;
  log(`Application detail scrape failed: ${String(detail).slice(0, 500)}`);
  touchAwaitingPepcoSession(sid);
  return {
    status: "failed",
    error_code:
      typeof /** @type {Error & { code?: string }} */ (err).code === "string"
        ? /** @type {Error & { code?: string }} */ (err).code
        : "SCRAPE_FAILED",
    message: String(detail).slice(0, 2000),
    session_id: sid,
    continue_action: CONTINUE_ACTION,
    progress,
  };
}

/**
 * Resolve UUIDs, wait for overview API readiness, then scrape on an open MFA session page.
 *
 * @param {{
 *   supabase: import("@supabase/supabase-js").SupabaseClient;
 *   coordinationIdTrim: string;
 *   projectId: string;
 *   coordRecord: Record<string, unknown>;
 *   page: import("playwright").Page;
 *   sid: string;
 *   applicationUuidsBody?: string[];
 *   downloadDocuments?: boolean;
 *   log: (m: string) => void;
 *   progress: string[];
 *   introReadinessLog?: string | false;
 * }} opts
 */
async function continueAppDetailAfterMfa(opts) {
  const {
    supabase,
    coordinationIdTrim,
    projectId,
    coordRecord,
    page,
    sid,
    applicationUuidsBody,
    downloadDocuments,
    log,
    progress,
    introReadinessLog,
  } = opts;

  let uuids = resolveApplicationUuidsFromSources(
    /** @type {Record<string, unknown>} */ (coordRecord),
    applicationUuidsBody,
    log,
  );

  if (uuids.length === 0) {
    uuids = await resolveApplicationUuids(
      /** @type {Record<string, unknown>} */ (coordRecord),
      applicationUuidsBody,
      page,
      log,
    );
  }

  if (uuids.length === 0) {
    touchAwaitingPepcoSession(sid);
    return {
      status: "failed",
      error_code: "NO_APPLICATION_UUIDS",
      message: NO_APPLICATION_UUID_MSG,
      session_id: sid,
      continue_action: CONTINUE_ACTION,
      progress,
    };
  }

  if (introReadinessLog !== false) {
    log(typeof introReadinessLog === "string" ? introReadinessLog : "MFA code accepted");
  }

  await waitForPepcoDashboardLanding(page, { logger: log });

  const tokenOut = await getPepcoBearerTokenViaSessionApi(page, log);
  if (!tokenOut?.token) {
    touchAwaitingPepcoSession(sid);
    return {
      status: "failed",
      error_code: "PEPCO_BEARER_TOKEN_NOT_FOUND",
      message: NO_BEARER_TOKEN_MSG,
      session_id: sid,
      continue_action: CONTINUE_ACTION,
      progress,
    };
  }

  const ready = await waitForPepcoApplicationApiReady(page, {
    applicationUuid: uuids[0],
    bearerToken: tokenOut.token,
    logger: log,
    introLog: false,
  });

  if (!ready.ok) {
    if (ready.missingBearer) {
      touchAwaitingPepcoSession(sid);
      return {
        status: "failed",
        error_code: "PEPCO_BEARER_TOKEN_NOT_FOUND",
        message: NO_BEARER_TOKEN_MSG,
        session_id: sid,
        continue_action: CONTINUE_ACTION,
        progress,
      };
    }
    return recoverableAppDetailFailure(sid, progress);
  }

  log("Resuming PEPCO application detail scrape…");

  try {
    const scrapeOut = await runApplicationDetailScrapeOnPage({
      supabase,
      coordinationIdTrim,
      projectId,
      coordRecord,
      page,
      applicationUuidsBody,
      preResolvedUuids: uuids,
      bearerToken: tokenOut.token,
      downloadDocuments: downloadDocuments === true,
      log,
      progress,
    });

    await revokeAwaitingPepcoSession(sid, "application_detail_done");

    await patchCoordinationAfterDiscovery(supabase, coordinationIdTrim, projectId, "completed", null, {
      pepco_discovery_session_status: "completed",
    });

    return scrapeOut;
  } catch (e) {
    return scrapeFailureFromError(sid, e, progress, log);
  }
}

/**
 * @param {{
 *   supabase: import("@supabase/supabase-js").SupabaseClient;
 *   user: { id: string };
 *   coordinationId: string;
 *   credentialId?: string;
 *   headed?: boolean;
 *   autoEmailMfa?: boolean;
 *   application_uuids?: string[];
 *   download_documents?: boolean;
 * }} opts
 */
async function runPepcoApplicationDetailDiscovery(opts) {
  /** @type {string[]} */
  const progress = [];
  const log = makeProgressLogger(progress, (line) => progress.push(line));

  log("Starting PEPCO application detail scrape");

  const {
    supabase,
    user,
    coordinationId,
    credentialId: credentialIdOpt,
    headed,
    autoEmailMfa,
    application_uuids: bodyUuids,
    download_documents: downloadDocumentsOpt,
  } = opts;

  const downloadDocuments = downloadDocumentsOpt === true;
  const initialRunOptions = buildAppDetailRunOptions(bodyUuids, downloadDocumentsOpt);
  log(
    `app-detail options: uuidCount=${initialRunOptions.applicationUuids.length} downloadDocuments=${initialRunOptions.downloadDocuments}`,
  );

  const coordinationIdTrim = String(coordinationId || "").trim();
  if (!coordinationIdTrim) {
    const err = new Error("coordination id required");
    err.statusCode = 400;
    err.code = "INVALID_COORDINATION_ID";
    throw err;
  }

  const coordRecord = await getCoordinationRecordById(supabase, coordinationIdTrim);
  if (!coordRecord) {
    const err = new Error("Coordination record not found");
    err.statusCode = 404;
    err.code = "NOT_FOUND";
    throw err;
  }

  const projectId = String(coordRecord.project_id);
  await requireProjectAccess({ supabase, userId: user.id, projectId });
  assertPepcoCoordination(coordRecord);

  const existingSession = findAwaitingPepcoSessionForCoordination(
    coordinationIdTrim,
    user.id,
    CONTINUE_ACTION,
  );
  if (existingSession?.sessionId) {
    log("Application detail scrape already awaiting MFA — returning existing session");
    return {
      status: "human_required",
      reason:
        existingSession.status === "awaiting_code_input"
          ? "mfa_email_code_input_required"
          : existingSession.status === "awaiting_contact_method"
            ? "mfa_contact_method_selection_required"
            : "mfa_email_code_input_required",
      message:
        existingSession.status === "awaiting_contact_method"
          ? "Select Email in the PEPCO browser, then click Resume Application Detail Scrape."
          : "Enter the PEPCO verification code sent to your email.",
      session_id: existingSession.sessionId,
      continue_action: CONTINUE_ACTION,
      progress,
    };
  }

  await disposeSessionsForCoordinationAndUser(coordinationIdTrim, user.id);

  const cred = await resolvePepcoPortalCredential(supabase, user.id, credentialIdOpt);
  const loginUrl = cred.login_url && String(cred.login_url).trim();
  if (!loginUrl) {
    const err = new Error(
      "PEPCO portal login URL is missing. Set login_url on your PEPCO portal credential.",
    );
    err.statusCode = 400;
    err.code = "PEPCO_LOGIN_URL_MISSING";
    throw err;
  }

  let password;
  try {
    password = resolveStoredPortalPassword(cred.portal_password);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const err = new Error(msg);
    err.statusCode = 500;
    err.code = "CREDENTIAL_DECRYPT_FAILED";
    throw err;
  }

  const username = String(cred.portal_username || "").trim();
  if (!username || !password) {
    const err = new Error("PEPCO portal username or password is missing.");
    err.statusCode = 400;
    err.code = "PEPCO_CREDENTIALS_INCOMPLETE";
    throw err;
  }

  const autoEmailMfaRequested = autoEmailMfa === true;
  const mailboxSnapshot = await getMailboxStatusForUser(supabase, String(user.id));
  const mailboxConnectedAtStart = mailboxSnapshot.connected === true;

  /** @type {((opts: { requestedAt: Date }) => Promise<object>) | undefined} */
  let fetchEmailCode;
  if (autoEmailMfaRequested && mailboxConnectedAtStart) {
    fetchEmailCode = ({ requestedAt }) =>
      pollGraphMailboxForPepcoMfaCode(supabase, String(user.id), { requestedAt });
  }

  /** @type {import("playwright").Browser | null} */
  let browser = null;

  try {
    browser = await launchChromiumForScraper({
      label: "uci-pepco-app-detail",
      route: "POST /api/uci/coordination/:id/discovery/pepco/application-details",
      file: "uci-pepco-application-detail-discovery.service.js",
      headed: headed === true,
    });

    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 2,
      acceptDownloads: true,
    });
    const page = await context.newPage();

    const loginRaw = await runPepcoLoginFlow({
      page,
      loginUrl,
      username,
      password,
      logger: (m) => log(m),
      fetchEmailCode,
    });

    const automation =
      loginRaw &&
      typeof loginRaw === "object" &&
      "__pepcoAutomation" in loginRaw &&
      /** @type {{ __pepcoAutomation?: unknown }} */ (loginRaw).__pepcoAutomation &&
      typeof /** @type {{ __pepcoAutomation?: unknown }} */ (loginRaw).__pepcoAutomation === "object"
        ? /** @type {{ attempted?: boolean, succeeded?: boolean, reason?: string }} */ (
            /** @type {{ __pepcoAutomation?: object }} */ (loginRaw).__pepcoAutomation
          )
        : undefined;

    const result =
      typeof loginRaw === "object" && loginRaw !== null
        ? { .../** @type {Record<string, unknown>} */ (loginRaw) }
        : {};
    delete result.__pepcoAutomation;

    const flowStatus = String(result.status || "");
    const mfaCoordMetaPatch = pickPepcoMfaCoordinationMeta({
      autoRequested: autoEmailMfaRequested,
      mailboxConnectedAtStart,
      flowStatus,
      automation,
    });

    if (flowStatus === "human_required") {
      const mfaReason = String(result.reason || "");

      if (mfaReason === "mfa_contact_method_selection_required") {
        const sess = registerAppDetailAwaitingMfaSession({
          coordinationId: coordinationIdTrim,
          userId: user.id,
          browser,
          context,
          page,
          sessionStatus: "awaiting_contact_method",
          continueAction: CONTINUE_ACTION,
          captureApplicationIds: false,
          bodyUuids,
          downloadDocumentsOpt,
          log,
        });
        browser = null;

        await patchCoordinationAfterDiscovery(supabase, coordinationIdTrim, projectId, flowStatus, null, {
          pepco_discovery_session_status: "awaiting_mfa",
          ...mfaCoordMetaPatch,
        });

        return {
          status: "human_required",
          reason: "mfa_contact_method_selection_required",
          message:
            typeof result.message === "string" && result.message.trim()
              ? result.message
              : "Select Email in the PEPCO browser, then continue.",
          session_id: sess.sessionId,
          progress,
        };
      }

      const emailCodeMfa =
        mfaReason === "mfa_email_code" || mfaReason === "mfa_email_code_input_required";

      if (emailCodeMfa) {
        const sess = registerAppDetailAwaitingMfaSession({
          coordinationId: coordinationIdTrim,
          userId: user.id,
          browser,
          context,
          page,
          sessionStatus: "awaiting_code_input",
          continueAction: CONTINUE_ACTION,
          captureApplicationIds: false,
          bodyUuids,
          downloadDocumentsOpt,
          log,
        });
        browser = null;

        await patchCoordinationAfterDiscovery(supabase, coordinationIdTrim, projectId, flowStatus, null, {
          pepco_discovery_session_status: "awaiting_mfa",
          ...mfaCoordMetaPatch,
        });

        return {
          status: "human_required",
          reason: "mfa_email_code_input_required",
          message: "Enter the PEPCO verification code sent to your email.",
          session_id: sess.sessionId,
          continue_action: CONTINUE_ACTION,
          progress,
        };
      }

      const sess = registerAppDetailAwaitingMfaSession({
        coordinationId: coordinationIdTrim,
        userId: user.id,
        browser,
        context,
        page,
        sessionStatus: "awaiting_mfa",
        continueAction: CONTINUE_ACTION,
        captureApplicationIds: false,
        bodyUuids,
        downloadDocumentsOpt,
        log,
      });
      browser = null;

      await patchCoordinationAfterDiscovery(supabase, coordinationIdTrim, projectId, flowStatus, null, {
        pepco_discovery_session_status: "awaiting_mfa",
        ...mfaCoordMetaPatch,
      });

      return {
        ...result,
        session_id: sess.sessionId,
        progress,
      };
    }

    if (flowStatus !== "completed") {
      await context.close().catch(() => {});
      await browser.close().catch(() => {});
      browser = null;

      await patchCoordinationAfterDiscovery(
        supabase,
        coordinationIdTrim,
        projectId,
        flowStatus,
        String(result.message || result.error_code || "failed").slice(0, 2000),
        {
          pepco_discovery_session_status: "idle",
          ...mfaCoordMetaPatch,
        },
      );

      return { ...result, progress };
    }

    const uuids = await resolveApplicationUuids(
      /** @type {Record<string, unknown>} */ (coordRecord),
      bodyUuids,
      page,
      log,
    );

    if (uuids.length === 0) {
      await context.close().catch(() => {});
      await browser.close().catch(() => {});
      browser = null;
      log("No application UUIDs found to scrape");
      return {
        status: "failed",
        error_code: "NO_APPLICATION_UUIDS",
        message:
          "No PEPCO application UUIDs found. Run dashboard discovery with Capture Application IDs or pass application_uuids.",
        progress,
        applications: [],
      };
    }

    log(`Found ${uuids.length} application(s) to scrape`);

    if (downloadDocuments) {
      log("Document downloads enabled for this run");
    } else {
      log("Documents will be listed only");
    }

    await waitForPepcoDashboardLanding(page, { logger: log });

    const tokenOut = await getPepcoBearerTokenViaSessionApi(page, log);
    if (!tokenOut?.token) {
      await context.close().catch(() => {});
      await browser.close().catch(() => {});
      browser = null;
      log(NO_BEARER_TOKEN_MSG);
      return {
        status: "failed",
        error_code: "PEPCO_BEARER_TOKEN_NOT_FOUND",
        message: NO_BEARER_TOKEN_MSG,
        progress,
        applications: [],
      };
    }

    const applications = await scrapeAllApplicationDetails(page, uuids, {
      downloadDocuments,
      coordinationId: coordinationIdTrim,
      log,
      bearerToken: tokenOut.token,
    });

    await context.close().catch(() => {});
    await browser.close().catch(() => {});
    browser = null;

    const lastStatus = summarizeScrapeStatus(applications);
    log("Saving PEPCO application detail snapshot");
    await persistPepcoApplicationDetailDiscovery(
      supabase,
      coordinationIdTrim,
      projectId,
      applications,
      lastStatus,
    );

    await patchCoordinationAfterDiscovery(supabase, coordinationIdTrim, projectId, "completed", null, {
      pepco_discovery_session_status: "completed",
      ...mfaCoordMetaPatch,
    });

    log(`Completed (${lastStatus}) — scraped ${applications.length} application(s)`);

    return {
      status: lastStatus,
      checkpoint: "application_details_scraped",
      applications_scraped: applications.length,
      applications,
      progress,
    };
  } catch (e) {
    if (browser) await browser.close().catch(() => {});
    if (isBrowserLaunchError(e)) {
      const err = new Error(
        "Playwright Chromium could not start. Ensure browsers are installed on the scraper host.",
      );
      err.statusCode = 503;
      err.code = "BROWSER_LAUNCH_FAILED";
      throw err;
    }
    throw e;
  }
}

/**
 * Resume after manual MFA and run application detail scrape on the open session.
 *
 * @param {{
 *   supabase: import("@supabase/supabase-js").SupabaseClient;
 *   user: { id: string };
 *   coordinationId: string;
 *   sessionId: string;
 *   application_uuids?: string[];
 *   download_documents?: boolean;
 * }} opts
 */
async function resumePepcoApplicationDetailDiscovery(opts) {
  /** @type {string[]} */
  const progress = [];
  const log = makeProgressLogger(progress, (line) => progress.push(line));
  log("Resuming PEPCO application detail scrape after MFA");

  const coordinationIdTrim = String(opts.coordinationId || "").trim();
  const sid = String(opts.sessionId || "").trim();
  if (!coordinationIdTrim || !sid) {
    const err = new Error("coordination id and session_id are required");
    err.statusCode = 400;
    err.code = "INVALID_BODY";
    throw err;
  }

  const coordRecord = await getCoordinationRecordById(opts.supabase, coordinationIdTrim);
  if (!coordRecord) {
    const err = new Error("Coordination record not found");
    err.statusCode = 404;
    err.code = "NOT_FOUND";
    throw err;
  }

  const projectId = String(coordRecord.project_id);
  await requireProjectAccess({ supabase: opts.supabase, userId: opts.user.id, projectId });
  assertPepcoCoordination(coordRecord);

  const rec = getAwaitingPepcoSession(sid);
  const sessionExpiredPayload = {
    status: "failed",
    error_code: "SESSION_EXPIRED",
    message: "PEPCO login session expired. Run application detail scrape again.",
    progress,
  };

  if (!rec || !rec.page) return sessionExpiredPayload;
  if (rec.userId !== String(opts.user.id) || rec.coordinationId !== coordinationIdTrim) {
    await revokeAwaitingPepcoSession(sid, "session_mismatch");
    return sessionExpiredPayload;
  }
  if (String(rec.continueAction || "") !== CONTINUE_ACTION) {
    await revokeAwaitingPepcoSession(sid, "bad_continue_action");
    return sessionExpiredPayload;
  }

  touchAwaitingPepcoSession(sid);

  const { phase } = await assessPepcoPostMfaResumeState(rec.page);
  if (phase === "mfa_pending") {
    touchAwaitingPepcoSession(sid);
    return {
      status: "human_required",
      reason: "mfa_email_code_input_required",
      message: "Enter the PEPCO verification code sent to your email.",
      session_id: sid,
      continue_action: CONTINUE_ACTION,
      progress,
    };
  }

  const resolved = resolveAppDetailResumeOptions(
    rec,
    opts.application_uuids,
    opts.download_documents,
    log,
  );

  return continueAppDetailAfterMfa({
    supabase: opts.supabase,
    coordinationIdTrim,
    projectId,
    coordRecord: /** @type {Record<string, unknown>} */ (coordRecord),
    page: rec.page,
    sid,
    applicationUuidsBody: resolved.applicationUuids,
    downloadDocuments: resolved.downloadDocuments,
    log,
    progress,
    introReadinessLog: "Checking PEPCO application API readiness before scrape",
  });
}

/**
 * Submit user-entered MFA code into the open application-detail Playwright session, then scrape.
 *
 * @param {{
 *   supabase: import("@supabase/supabase-js").SupabaseClient;
 *   user: { id: string };
 *   coordinationId: string;
 *   sessionId?: string;
 *   code?: string;
 *   application_uuids?: string[];
 *   download_documents?: boolean;
 * }} opts
 */
async function submitPepcoCodeAndContinueApplicationDetailDiscovery(opts) {
  /** @type {string[]} */
  const progress = [];
  const log = makeProgressLogger(progress, (line) => progress.push(line));
  log("Submitting PEPCO verification code…");

  const coordinationIdTrim = String(opts.coordinationId || "").trim();
  if (!coordinationIdTrim) {
    const err = new Error("coordination id required");
    err.statusCode = 400;
    err.code = "INVALID_COORDINATION_ID";
    throw err;
  }

  const rawCode = opts.code != null ? String(opts.code) : "";
  const codeTrim = rawCode.trim().replace(/\s+/g, "");
  if (!/^\d{4,8}$/.test(codeTrim)) {
    const err = new Error("Verification code must be 4–8 digits.");
    err.statusCode = 400;
    err.code = "INVALID_CODE";
    throw err;
  }

  const coordRecord = await getCoordinationRecordById(opts.supabase, coordinationIdTrim);
  if (!coordRecord) {
    const err = new Error("Coordination record not found");
    err.statusCode = 404;
    err.code = "NOT_FOUND";
    throw err;
  }

  const projectId = String(coordRecord.project_id);
  await requireProjectAccess({ supabase: opts.supabase, userId: opts.user.id, projectId });
  assertPepcoCoordination(coordRecord);

  const sid = opts.sessionId != null ? String(opts.sessionId).trim() : "";
  if (!sid) {
    const err = new Error("session_id is required");
    err.statusCode = 400;
    err.code = "INVALID_BODY";
    throw err;
  }

  const rec = getAwaitingPepcoSession(sid);
  const sessionExpiredPayload = {
    status: "failed",
    error_code: "SESSION_EXPIRED",
    message: "PEPCO login session expired. Run application detail scrape again.",
    progress,
  };

  if (!rec || !rec.page) return sessionExpiredPayload;
  if (rec.userId !== String(opts.user.id) || rec.coordinationId !== coordinationIdTrim) {
    await revokeAwaitingPepcoSession(sid, "session_mismatch");
    return sessionExpiredPayload;
  }
  if (String(rec.continueAction || "") !== CONTINUE_ACTION) {
    await revokeAwaitingPepcoSession(sid, "bad_continue_action");
    return sessionExpiredPayload;
  }

  touchAwaitingPepcoSession(sid);

  const mfaOutcome = await submitPepcoMfaCode(rec.page, codeTrim, {
    logger: (m) => log(m),
  });

  const mfaOutcomeStatus = String(mfaOutcome.status || "");

  if (mfaOutcomeStatus === "human_required") {
    touchAwaitingPepcoSession(sid);
    return {
      status: "human_required",
      reason: "mfa_email_code_input_required",
      message:
        "PEPCO verification code was rejected or expired. Request a new code and try again.",
      session_id: sid,
      continue_action: CONTINUE_ACTION,
      progress,
    };
  }

  if (mfaOutcomeStatus === "failed") {
    const errCode = String(mfaOutcome.error_code || "");

    if (errCode === "OTP_FIELD_NOT_FOUND") {
      touchAwaitingPepcoSession(sid);
      return {
        status: "human_required",
        reason: "mfa_email_code_input_required",
        message:
          typeof mfaOutcome.message === "string"
            ? mfaOutcome.message
            : "Could not find the verification code field. Ensure PEPCO is on the code entry step, then try again.",
        session_id: sid,
        continue_action: CONTINUE_ACTION,
        progress,
      };
    }

    if (errCode === "INVALID_CODE") {
      const err = new Error(
        "PEPCO verification code was rejected or expired. Request a new code and try again.",
      );
      err.statusCode = 400;
      err.code = "INVALID_CODE";
      throw err;
    }

    if (errCode === "MFA_POST_SUBMIT_UNKNOWN") {
      await maybePepcoSubmitCodeFailureScreenshot(rec.page, "mfa_post_submit_unknown");
      touchAwaitingPepcoSession(sid);
      return {
        status: "human_required",
        reason: "mfa_email_code_input_required",
        message:
          "PEPCO verification code was rejected or expired. Request a new code and try again.",
        session_id: sid,
        continue_action: CONTINUE_ACTION,
        progress,
      };
    }

    await maybePepcoSubmitCodeFailureScreenshot(rec.page, errCode);
    await revokeAwaitingPepcoSession(sid, "mfa_submit_failed");
    return {
      status: "failed",
      error_code: errCode || "MFA_FAILED",
      message: String(mfaOutcome.message || "MFA verification failed").slice(0, 2000),
      progress,
    };
  }

  if (mfaOutcomeStatus !== "completed") {
    await revokeAwaitingPepcoSession(sid, "mfa_unexpected");
    return {
      status: "failed",
      error_code: "MFA_UNEXPECTED",
      message: "Unexpected response after submitting verification code.",
      progress,
    };
  }

  const resolved = resolveAppDetailResumeOptions(
    rec,
    opts.application_uuids,
    opts.download_documents,
    log,
  );

  return continueAppDetailAfterMfa({
    supabase: opts.supabase,
    coordinationIdTrim,
    projectId,
    coordRecord: /** @type {Record<string, unknown>} */ (coordRecord),
    page: rec.page,
    sid,
    applicationUuidsBody: resolved.applicationUuids,
    downloadDocuments: resolved.downloadDocuments,
    log,
    progress,
  });
}

module.exports = {
  runPepcoApplicationDetailDiscovery,
  resumePepcoApplicationDetailDiscovery,
  submitPepcoCodeAndContinueApplicationDetailDiscovery,
  persistPepcoApplicationDetailDiscovery,
  mergeApplicationDetailsByUuid,
  buildAppDetailRunOptions,
  resolveAppDetailResumeOptions,
};
