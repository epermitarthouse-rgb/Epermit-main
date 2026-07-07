"use strict";

const { resolveStoredPortalPassword } = require("../portal-credentials/portal-credentials-crypto.js");
const {
  launchChromiumForScraper,
  isBrowserLaunchError,
} = require("../../../shared/playwright-launch-for-scraper.js");
const {
  runPepcoLoginFlow,
  submitPepcoMfaCode,
  maybePepcoSubmitCodeFailureScreenshot,
} = require("../../../scrapers/pepco/login-flow.js");
const {
  extractPepcoDashboardCards,
  capturePepcoApplicationIds,
} = require("../../../scrapers/pepco/dashboard-discovery.js");
const {
  getPepcoBearerTokenViaSessionApi,
  fetchPepcoApplicationsListFromApi,
  waitForPepcoDashboardLanding,
} = require("../../../scrapers/pepco/application-detail-discovery.js");
const { getCoordinationRecordById } = require("./uci-records.service.js");
const { requireProjectAccess } = require("./uci-access.service.js");
const {
  registerAwaitingMfaSession,
  disposeSessionsForCoordinationAndUser,
  getAwaitingPepcoSession,
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

/**
 * Persist compact dashboard discovery (no rawText, no screenshots/HTML).
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} coordinationId
 * @param {string} projectId
 * @param {Record<string, unknown>} envelope dashboard extract envelope
 * @param {{ lastError: string | null }} opts
 */
async function persistPepcoDashboardDiscovery(supabase, coordinationId, projectId, envelope, opts) {
  const lastError = opts.lastError;

  const now = new Date().toISOString();
  const cards = Array.isArray(envelope.cards) ? envelope.cards : [];
  const sanitized = cards.map((row) => {
    if (!row || typeof row !== "object") return row;
    const o = /** @type {Record<string, unknown>} */ ({ .../** @type {Record<string, unknown>} */ (row) });
    delete o.rawText;
    return o;
  });

  const dashStatus = envelope.status === "completed" ? "completed" : "failed";

  const nested = {
    last_discovered_at: now,
    status: dashStatus,
    checkpoint: envelope.checkpoint != null ? String(envelope.checkpoint) : null,
    cards_found: typeof envelope.cards_found === "number" ? envelope.cards_found : sanitized.length,
    application_ids_found:
      typeof envelope.application_ids_found === "number"
        ? envelope.application_ids_found
        : sanitized.filter((c) => {
            if (!c || typeof c !== "object") return false;
            const id = /** @type {{ applicationId?: unknown }} */ (c).applicationId;
            return typeof id === "string" && id.trim().length > 0;
          }).length,
    cards: sanitized,
  };

  const { data: row, error: fetchErr } = await supabase
    .from("coordination_records")
    .select("metadata")
    .eq("id", coordinationId)
    .eq("project_id", projectId)
    .maybeSingle();

  if (fetchErr) {
    console.error("[uci-pepco-dashboard] metadata fetch failed:", fetchErr.message);
    return;
  }

  const prev =
    row && typeof row.metadata === "object" && row.metadata !== null && !Array.isArray(row.metadata)
      ? /** @type {Record<string, unknown>} */ (row.metadata)
      : {};

  const metadata = { ...prev };
  metadata.pepco_dashboard_discovery = nested;
  metadata.pepco_dashboard_last_discovered_at = now;
  metadata.pepco_dashboard_discovery_status = nested.status;
  metadata.pepco_dashboard_cards_found = nested.cards_found;
  metadata.pepco_dashboard_application_ids_found = nested.application_ids_found;
  if (typeof envelope.list_api_warning === "string" && envelope.list_api_warning.trim()) {
    metadata.pepco_dashboard_list_api_warning = String(envelope.list_api_warning).trim();
  }
  if (typeof envelope.source === "string" && envelope.source.trim()) {
    metadata.pepco_dashboard_discovery_source = String(envelope.source).trim();
  }

  /** @type {Record<string, unknown>} */
  const update = { metadata, last_error: lastError };

  const { error: upErr } = await supabase
    .from("coordination_records")
    .update(update)
    .eq("id", coordinationId)
    .eq("project_id", projectId);

  if (upErr) console.error("[uci-pepco-dashboard] coordination update failed:", upErr.message);
}

const LIST_API_DOM_FALLBACK_WARNING =
  "PEPCO project list API was unavailable; dashboard results may be incomplete.";

/**
 * @param {import("playwright").Page} page
 * @param {boolean} captureApplicationIds
 * @returns {Promise<Record<string, unknown>>}
 */
async function runPepcoDashboardExtractionPipeline(page, captureApplicationIds) {
  const log = (m) => console.log(`[uci-pepco-dashboard] ${m}`);

  await waitForPepcoDashboardLanding(page, { logger: log });

  const tokenOut = await getPepcoBearerTokenViaSessionApi(page, log);
  const bearerToken = tokenOut?.token ? String(tokenOut.token).trim() : "";

  if (bearerToken) {
    const apiOut = await fetchPepcoApplicationsListFromApi(page, {
      bearerToken,
      logger: log,
    });

    if (apiOut.ok && Array.isArray(apiOut.cards)) {
      const cards = apiOut.cards;
      const applicationIdsFound = cards.filter((c) => {
        if (!c || typeof c !== "object") return false;
        const id = /** @type {{ applicationId?: unknown }} */ (c).applicationId;
        return typeof id === "string" && id.trim().length > 0;
      }).length;

      return {
        status: "completed",
        checkpoint: "dashboard_applications_list_extracted",
        source: "api",
        currentUrl: page.url(),
        cards_found: cards.length,
        application_ids_found: applicationIdsFound,
        cards,
        customerFirstName:
          typeof apiOut.customerFirstName === "string" ? apiOut.customerFirstName : null,
      };
    }

    log(
      `List API unavailable; using DOM fallback (authorizationAttached=${apiOut.authorizationAttached === true}, httpStatus=${apiOut.httpStatus || 0})`,
    );
  } else {
    log("GetSession token unavailable; using DOM fallback");
  }
  const dashExtract = await extractPepcoDashboardCards(page, { logger: log });

  /** @type {Record<string, unknown>} */
  let envelope =
    typeof dashExtract === "object" && dashExtract !== null
      ? {
          ...dashExtract,
          source: "dom",
          list_api_warning: LIST_API_DOM_FALLBACK_WARNING,
        }
      : {
          status: "failed",
          message: "Extract returned invalid payload",
          cards: [],
          cards_found: 0,
          source: "dom",
          list_api_warning: LIST_API_DOM_FALLBACK_WARNING,
        };

  const cardsNeedingIds =
    Array.isArray(envelope.cards) &&
    envelope.cards.some((c) => {
      if (!c || typeof c !== "object") return true;
      const id = /** @type {{ applicationId?: unknown }} */ (c).applicationId;
      return !(typeof id === "string" && id.trim());
    });

  if (
    envelope.status === "completed" &&
    captureApplicationIds &&
    cardsNeedingIds &&
    Array.isArray(dashExtract.cards)
  ) {
    envelope = await capturePepcoApplicationIds(page, dashExtract.cards, {
      logger: log,
    });
    envelope.source = "dom";
    envelope.list_api_warning = LIST_API_DOM_FALLBACK_WARNING;
  }

  return envelope;
}

/**
 * Phase 4: login+MFA reuse, then dashboard card extraction (+ optional card clicks for IDs only).
 *
 * @param {{
 *   supabase: import("@supabase/supabase-js").SupabaseClient;
 *   user: { id: string };
 *   coordinationId: string;
 *   credentialId?: string;
 *   headed?: boolean;
 *   autoEmailMfa?: boolean;
 *   capture_application_ids?: boolean;
 * }} opts
 */
async function runPepcoDashboardDiscovery(opts) {
  const {
    supabase,
    user,
    coordinationId,
    credentialId: credentialIdOpt,
    headed,
    autoEmailMfa,
    capture_application_ids: captureIdsOpt,
  } = opts;

  const captureApplicationIds = captureIdsOpt === true;

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
      label: "uci-pepco-dashboard",
      route: "POST /api/uci/coordination/:id/discovery/pepco/dashboard",
      file: "uci-pepco-dashboard-discovery.service.js",
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
      logger: (m) => console.log(`[uci-pepco-dashboard] ${m}`),
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

    const lastErrMsg =
      flowStatus === "failed"
        ? String(result.message || result.error_code || "failed").slice(0, 2000)
        : null;

    if (flowStatus === "human_required") {
      const mfaReason = String(result.reason || "");

      if (mfaReason === "mfa_contact_method_selection_required") {
        const sess = registerAwaitingMfaSession({
          coordinationId: coordinationIdTrim,
          userId: user.id,
          browser,
          context,
          page,
          sessionStatus: "awaiting_contact_method",
          continueAction: "discover_dashboard",
          captureApplicationIds,
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
          currentUrl: typeof result.currentUrl === "string" ? result.currentUrl : undefined,
        };
      }

      const emailCodeMfa =
        mfaReason === "mfa_email_code" || mfaReason === "mfa_email_code_input_required";

      if (emailCodeMfa) {
        const sess = registerAwaitingMfaSession({
          coordinationId: coordinationIdTrim,
          userId: user.id,
          browser,
          context,
          page,
          sessionStatus: "awaiting_code_input",
          continueAction: "discover_dashboard",
          captureApplicationIds,
        });
        browser = null;

        await patchCoordinationAfterDiscovery(supabase, coordinationIdTrim, projectId, flowStatus, null, {
          pepco_discovery_session_status: "awaiting_mfa",
          ...mfaCoordMetaPatch,
        });

        return {
          status: "human_required",
          reason: "mfa_email_code_input_required",
          message: "Enter the PEPCO verification code sent to the mailbox.",
          session_id: sess.sessionId,
          continue_action: "discover_dashboard",
          capture_application_ids: captureApplicationIds,
          currentUrl: typeof result.currentUrl === "string" ? result.currentUrl : undefined,
        };
      }

      const sess = registerAwaitingMfaSession({
        coordinationId: coordinationIdTrim,
        userId: user.id,
        browser,
        context,
        page,
      });
      browser = null;

      await patchCoordinationAfterDiscovery(supabase, coordinationIdTrim, projectId, flowStatus, null, {
        pepco_discovery_session_status: "awaiting_mfa",
        ...mfaCoordMetaPatch,
      });

      const friendly =
        typeof result.message === "string" ? result.message.trim() : "";

      const combinedMessage =
        autoEmailMfaRequested && !mailboxConnectedAtStart
          ? "Microsoft mailbox is not connected — cannot auto-fetch the PEPCO verification email. Complete MFA manually in the opened browser, then click Resume."
          : friendly ||
            "PEPCO MFA required. Complete the email code in the opened browser, then click Resume.";

      return {
        ...result,
        session_id: sess.sessionId,
        message: combinedMessage,
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
        lastErrMsg,
        {
          pepco_discovery_session_status: "idle",
          ...mfaCoordMetaPatch,
        },
      );

      return result;
    }

    /** Login completed — 4A/4B against open page before closing browser */
    const envelope = await runPepcoDashboardExtractionPipeline(page, captureApplicationIds);

    await context.close().catch(() => {});
    await browser.close().catch(() => {});
    browser = null;

    await patchCoordinationAfterDiscovery(supabase, coordinationIdTrim, projectId, "completed", null, {
      pepco_discovery_session_status: "completed",
      ...mfaCoordMetaPatch,
    });

    const dashFail = String(envelope.status || "") !== "completed";
    await persistPepcoDashboardDiscovery(supabase, coordinationIdTrim, projectId, envelope, {
      lastError: dashFail
        ? String(
            envelope.message ||
              envelope.error_code ||
              "PEPCO dashboard discovery failed",
          ).slice(0, 2000)
        : null,
    });

    return envelope;
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
 * Phase 4.5 — submit user-entered email MFA code into the open Playwright session, then run dashboard discovery.
 * Does not log or persist the verification code.
 *
 * @param {{
 *   supabase: import("@supabase/supabase-js").SupabaseClient;
 *   user: { id: string };
 *   coordinationId: string;
 *   sessionId?: string;
 *   code?: string;
 *   capture_application_ids?: boolean;
 * }} opts
 */
async function submitPepcoCodeAndContinueDashboardDiscovery(opts) {
  const { supabase, user, coordinationId } = opts;

  const coordinationIdTrim = String(coordinationId || "").trim();
  if (!coordinationIdTrim) {
    const err = new Error("coordination id required");
    err.statusCode = 400;
    err.code = "INVALID_COORDINATION_ID";
    throw err;
  }

  const rawCode = opts.code != null ? String(opts.code) : "";
  const codeTrim = rawCode.trim();
  if (!/^\d{4,8}$/.test(codeTrim)) {
    const err = new Error("Verification code must be 4–8 digits.");
    err.statusCode = 400;
    err.code = "INVALID_CODE";
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
    message: "PEPCO login session expired. Run discovery again.",
  };

  if (!rec || !rec.page) {
    return sessionExpiredPayload;
  }

  if (rec.userId !== String(user.id) || rec.coordinationId !== coordinationIdTrim) {
    await revokeAwaitingPepcoSession(sid, "session_mismatch");
    return sessionExpiredPayload;
  }

  if (String(rec.continueAction || "") !== "discover_dashboard") {
    await revokeAwaitingPepcoSession(sid, "bad_continue_action");
    return sessionExpiredPayload;
  }

  if (opts.continue_action != null && String(opts.continue_action).trim() !== "discover_dashboard") {
    const err = new Error("continue_action must be discover_dashboard.");
    err.statusCode = 400;
    err.code = "INVALID_BODY";
    throw err;
  }

  touchAwaitingPepcoSession(sid);

  const captureApplicationIds =
    opts.capture_application_ids != null
      ? opts.capture_application_ids === true
      : rec.captureApplicationIds === true;

  const mailboxSnapshot = await getMailboxStatusForUser(supabase, String(user.id));
  const mailboxConnectedAtStart = mailboxSnapshot.connected === true;

  /** @type {Record<string, unknown>} */
  const mfaOutcome = await submitPepcoMfaCode(rec.page, codeTrim, {
    logger: (m) => console.log(`[uci-pepco-dashboard] ${m}`),
  });

  const mfaOutcomeStatus = String(mfaOutcome.status || "");

  if (mfaOutcomeStatus === "human_required") {
    touchAwaitingPepcoSession(sid);
    return {
      status: "human_required",
      reason: "mfa_email_code_input_required",
      message:
        typeof mfaOutcome.message === "string"
          ? mfaOutcome.message
          : "The PEPCO verification code was not accepted. Please check the latest code and try again.",
      session_id: sid,
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
      };
    }

    if (errCode === "INVALID_CODE") {
      const err = new Error(String(mfaOutcome.message || "Invalid code"));
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
          "Could not confirm login after the verification code. If the code was wrong, try again; otherwise wait for the page to finish loading.",
        session_id: sid,
        currentUrl: typeof mfaOutcome.currentUrl === "string" ? mfaOutcome.currentUrl : undefined,
      };
    }

    await maybePepcoSubmitCodeFailureScreenshot(rec.page, errCode);
    await revokeAwaitingPepcoSession(sid, "mfa_submit_failed");
    const lastMsg = String(mfaOutcome.message || "MFA verification failed").slice(0, 2000);
    await patchCoordinationAfterDiscovery(supabase, coordinationIdTrim, projectId, "failed", lastMsg, {
      pepco_discovery_session_status: "failed",
    });
    return {
      status: "failed",
      error_code: errCode || "MFA_FAILED",
      message: lastMsg,
      currentUrl: typeof mfaOutcome.currentUrl === "string" ? mfaOutcome.currentUrl : undefined,
    };
  }

  if (mfaOutcomeStatus !== "completed") {
    await revokeAwaitingPepcoSession(sid, "mfa_unexpected");
    return {
      status: "failed",
      error_code: "MFA_UNEXPECTED",
      message: "Unexpected response after submitting verification code.",
    };
  }

  const page = rec.page;

  const mfaCoordMetaPatch = pickPepcoMfaCoordinationMeta({
    autoRequested: false,
    mailboxConnectedAtStart,
    flowStatus: "completed",
    automation: undefined,
  });

  const envelope = await runPepcoDashboardExtractionPipeline(page, captureApplicationIds);

  if (String(envelope.status || "") !== "completed") {
    await maybePepcoSubmitCodeFailureScreenshot(rec.page, "dashboard_extraction");
    await revokeAwaitingPepcoSession(sid, "dashboard_extraction_failed");

    await patchCoordinationAfterDiscovery(supabase, coordinationIdTrim, projectId, "completed", null, {
      pepco_discovery_session_status: "completed",
      ...mfaCoordMetaPatch,
    });

    const extractionMsg = "PEPCO login succeeded, but dashboard cards could not be extracted.";
    await persistPepcoDashboardDiscovery(supabase, coordinationIdTrim, projectId, envelope, {
      lastError: extractionMsg,
    });

    return {
      status: "failed",
      error_code: "DASHBOARD_EXTRACTION_FAILED",
      message: extractionMsg,
      currentUrl: page.url(),
    };
  }

  await revokeAwaitingPepcoSession(sid, "dashboard_discovery_done");

  await patchCoordinationAfterDiscovery(supabase, coordinationIdTrim, projectId, "completed", null, {
    pepco_discovery_session_status: "completed",
    ...mfaCoordMetaPatch,
  });

  await persistPepcoDashboardDiscovery(supabase, coordinationIdTrim, projectId, envelope, {
    lastError: null,
  });

  return envelope;
}

module.exports = {
  runPepcoDashboardDiscovery,
  submitPepcoCodeAndContinueDashboardDiscovery,
};
