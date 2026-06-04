"use strict";

const { resolveStoredPortalPassword } = require("../portal-credentials/portal-credentials-crypto.js");
const {
  launchChromiumForScraper,
  isBrowserLaunchError,
} = require("../../../shared/playwright-launch-for-scraper.js");
const {
  runPepcoLoginFlow,
  assessPepcoPostMfaResumeState,
} = require("../../../scrapers/pepco/login-flow.js");
const { getCoordinationRecordById } = require("./uci-records.service.js");
const { requireProjectAccess } = require("./uci-access.service.js");
const {
  registerAwaitingMfaSession,
  getAwaitingPepcoSession,
  touchAwaitingPepcoSession,
  revokeAwaitingPepcoSession,
  disposeSessionsForCoordinationAndUser,
} = require("./uci-pepco-session-store.js");
const {
  pollGraphMailboxForPepcoMfaCode,
  getMailboxStatusForUser,
} = require("../microsoft/microsoft-mailbox.service.js");

/**
 * @param {unknown} jurisdiction
 * @returns {boolean}
 */
function isPepcoJurisdiction(jurisdiction) {
  const s = String(jurisdiction ?? "").trim().toLowerCase();
  return s === "pepco";
}

/**
 * @param {Record<string, unknown>} record coordination row with embedded utility_providers
 */
function assertPepcoCoordination(record) {
  const u = record.utility_providers;
  const row = Array.isArray(u) ? u[0] : u;
  const slug = row && String((/** @type {{ slug?: string }} */ (row)).slug || "").toLowerCase();
  if (slug !== "pepco") {
    const err = new Error("PEPCO discovery applies only to PEPCO coordination records.");
    err.statusCode = 400;
    err.code = "NOT_PEPCO_COORDINATION";
    throw err;
  }
}

/**
 * Safe coordination metadata additions for PEPCO MFA automation telemetry.
 *
 * @param {{
 *   autoRequested: boolean;
 *   mailboxConnectedAtStart: boolean;
 *   flowStatus: string;
 *   automation?: { attempted?: boolean, succeeded?: boolean, reason?: string };
 * }} p
 */
function pickPepcoMfaCoordinationMeta(p) {
  /** @type {Record<string, string>} */
  const meta = {};
  if (!p.autoRequested) {
    meta.pepco_mfa_mode = "manual";
    return meta;
  }

  meta.pepco_mfa_mode = "email_auto";

  if (!p.mailboxConnectedAtStart) {
    meta.pepco_mfa_auto_status = "not_connected";
    return meta;
  }

  const flow = String(p.flowStatus || "");

  if (flow === "completed") {
    const ok =
      p.automation &&
      typeof p.automation === "object" &&
      p.automation.attempted === true &&
      p.automation.succeeded === true;
    if (ok) meta.pepco_mfa_auto_status = "code_found";
    return meta;
  }

  if (flow === "human_required") {
    const r =
      p.automation && typeof p.automation.reason === "string" ? String(p.automation.reason) : "";
    if (r === "timeout" || r === "not_found_or_invalid") {
      meta.pepco_mfa_auto_status = "timeout";
      return meta;
    }
    meta.pepco_mfa_auto_status = "failed";
    return meta;
  }

  if (flow === "failed") {
    meta.pepco_mfa_auto_status = "failed";
    return meta;
  }

  return meta;
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} userId
 * @param {string | undefined} credentialIdOpt
 */
async function resolvePepcoPortalCredential(supabase, userId, credentialIdOpt) {
  if (credentialIdOpt != null && String(credentialIdOpt).trim()) {
    const id = String(credentialIdOpt).trim();
    const { data: cred, error } = await supabase
      .from("portal_credentials")
      .select("id, user_id, jurisdiction, portal_username, portal_password, login_url")
      .eq("id", id)
      .eq("user_id", userId)
      .maybeSingle();

    if (error) {
      throw Object.assign(new Error(error.message || "credential_lookup_failed"), {
        statusCode: 500,
        code: "CREDENTIAL_LOOKUP_FAILED",
      });
    }
    if (!cred) {
      const err = new Error("Portal credential not found.");
      err.statusCode = 404;
      err.code = "CREDENTIAL_NOT_FOUND";
      throw err;
    }
    if (!isPepcoJurisdiction(cred.jurisdiction)) {
      const err = new Error("credential_id does not reference a PEPCO portal credential.");
      err.statusCode = 400;
      err.code = "CREDENTIAL_NOT_PEPCO";
      throw err;
    }
    return cred;
  }

  const { data: rows, error } = await supabase
    .from("portal_credentials")
    .select("id, user_id, jurisdiction, portal_username, portal_password, login_url")
    .eq("user_id", userId);

  if (error) {
    throw Object.assign(new Error(error.message || "credential_list_failed"), {
      statusCode: 500,
      code: "CREDENTIAL_LIST_FAILED",
    });
  }

  const matches = (Array.isArray(rows) ? rows : []).filter((r) =>
    isPepcoJurisdiction(r.jurisdiction),
  );

  if (matches.length === 0) {
    const err = new Error(
      "No PEPCO portal credentials found. Add PEPCO credentials in Settings or pass credential_id.",
    );
    err.statusCode = 400;
    err.code = "PEPCO_CREDENTIALS_MISSING";
    throw err;
  }
  if (matches.length > 1) {
    const err = new Error(
      "Multiple PEPCO portal credentials found. Pass credential_id in the request body.",
    );
    err.statusCode = 400;
    err.code = "PEPCO_CREDENTIALS_AMBIGUOUS";
    throw err;
  }

  return matches[0];
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} coordinationId
 * @param {string} projectId
 * @param {string} flowStatus
 * @param {string | null} lastError
 * @param {Record<string, unknown> | null} [extraMetadata]
 */
async function patchCoordinationAfterDiscovery(
  supabase,
  coordinationId,
  projectId,
  flowStatus,
  lastError,
  extraMetadata = null,
) {
  const { data: row, error: fetchErr } = await supabase
    .from("coordination_records")
    .select("metadata")
    .eq("id", coordinationId)
    .eq("project_id", projectId)
    .maybeSingle();

  if (fetchErr) {
    console.error("[uci-pepco-discovery] metadata fetch failed:", fetchErr.message);
    return;
  }

  const prev =
    row &&
    typeof row.metadata === "object" &&
    row.metadata !== null &&
    !Array.isArray(row.metadata)
      ? /** @type {Record<string, unknown>} */ (row.metadata)
      : {};

  const metadata = { ...prev };
  metadata.pepco_discovery_last_attempt_at = new Date().toISOString();
  metadata.pepco_discovery_last_status = flowStatus;

  if (extraMetadata && typeof extraMetadata === "object") {
    Object.assign(metadata, extraMetadata);
  }

  /** @type {Record<string, unknown>} */
  const update = { metadata };
  if (flowStatus === "failed") {
    update.last_error = lastError ?? "PEPCO login discovery failed";
  } else {
    update.last_error = null;
  }

  const { error: upErr } = await supabase
    .from("coordination_records")
    .update(update)
    .eq("id", coordinationId)
    .eq("project_id", projectId);

  if (upErr) console.error("[uci-pepco-discovery] coordination update failed:", upErr.message);
}

/**
 * @param {{ supabase: import("@supabase/supabase-js").SupabaseClient, user: { id: string }, coordinationId: string, credentialId?: string, headed?: boolean, autoEmailMfa?: boolean }} opts
 */
async function runPepcoDiscoveryLoginOnly(opts) {
  const {
    supabase,
    user,
    coordinationId,
    credentialId: credentialIdOpt,
    headed,
    autoEmailMfa,
  } = opts;

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
      label: "uci-pepco-discovery",
      route: "POST /api/uci/coordination/:id/discovery/pepco",
      file: "uci-pepco-discovery.service.js",
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
      logger: (m) => console.log(`[uci-pepco-discovery] ${m}`),
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

      /** @example never echo portal secrets or email bodies */
      const friendly =
        typeof result.message === "string" ? result.message.trim() : "";

      /** @example clarify when mailbox not connected disables auto-fetch */
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

    await context.close().catch(() => {});
    await browser.close().catch(() => {});
    browser = null;

    const metaExtraCompleted =
      flowStatus === "completed"
        ? { pepco_discovery_session_status: "completed" }
        : flowStatus === "failed"
          ? { pepco_discovery_session_status: "idle" }
          : { pepco_discovery_session_status: "idle" };

    await patchCoordinationAfterDiscovery(
      supabase,
      coordinationIdTrim,
      projectId,
      flowStatus,
      lastErrMsg,
      {
        ...metaExtraCompleted,
        ...mfaCoordMetaPatch,
      },
    );

    return result;
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

const MFA_RESUME_MESSAGE_PROMPT =
  "PEPCO MFA is still required. Complete the verification code in the browser, then resume again.";

/**
 * @param {{
 *   supabase: import("@supabase/supabase-js").SupabaseClient;
 *   user: { id: string };
 *   coordinationId: string;
 *   sessionId?: string;
 * }} opts
 */
async function resumePepcoDiscoveryAfterMfa(opts) {
  const { supabase, user, coordinationId } = opts;
  let sessionToken = opts.sessionId != null ? String(opts.sessionId).trim() : "";

  const coordinationIdTrim = String(coordinationId || "").trim();
  if (!coordinationIdTrim) {
    const err = new Error("coordination id required");
    err.statusCode = 400;
    err.code = "INVALID_COORDINATION_ID";
    throw err;
  }

  if (!sessionToken) {
    const err = new Error("session_id is required");
    err.statusCode = 400;
    err.code = "INVALID_BODY";
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

  const rec = getAwaitingPepcoSession(sessionToken);

  const sessionExpiredPayload = {
    status: "failed",
    error_code: "SESSION_EXPIRED",
    message: "PEPCO login session expired. Run login check again.",
  };

  const markSessionExpiredInDb = async () => {
    await patchCoordinationAfterDiscovery(
      supabase,
      coordinationIdTrim,
      projectId,
      "failed",
      "PEPCO login session expired. Run login check again.",
      {
        pepco_discovery_session_status: "expired",
      },
    );
  };

  if (!rec || !rec.page) {
    await markSessionExpiredInDb();
    return sessionExpiredPayload;
  }

  if (rec.userId !== String(user.id) || rec.coordinationId !== coordinationIdTrim) {
    await revokeAwaitingPepcoSession(sessionToken, "session_mismatch");
    await markSessionExpiredInDb();
    return sessionExpiredPayload;
  }

  sessionToken = rec.sessionId;
  touchAwaitingPepcoSession(sessionToken);

  const { phase, currentUrl } = await assessPepcoPostMfaResumeState(rec.page);

  if (phase === "dashboard_ready") {
    await revokeAwaitingPepcoSession(sessionToken, "dashboard_ready");

    await patchCoordinationAfterDiscovery(supabase, coordinationIdTrim, projectId, "completed", null, {
      pepco_discovery_session_status: "completed",
    });

    return {
      status: "completed",
      checkpoint: "dashboard_ready",
      currentUrl,
    };
  }

  if (phase === "mfa_pending") {
    touchAwaitingPepcoSession(sessionToken);
    return {
      status: "human_required",
      reason: "mfa_email_code",
      message: MFA_RESUME_MESSAGE_PROMPT,
      session_id: sessionToken,
      currentUrl,
    };
  }

  await revokeAwaitingPepcoSession(sessionToken, "unknown_post_mfa");
  await patchCoordinationAfterDiscovery(
    supabase,
    coordinationIdTrim,
    projectId,
    "failed",
    "Could not confirm PEPCO dashboard after MFA.",
    {
      pepco_discovery_session_status: "failed_resume",
    },
  );
  return {
    status: "failed",
    error_code: "LOGIN_FAILED",
    message: "Could not confirm PEPCO dashboard after MFA.",
    currentUrl,
  };
}

module.exports = {
  runPepcoDiscoveryLoginOnly,
  resumePepcoDiscoveryAfterMfa,
  patchCoordinationAfterDiscovery,
  assertPepcoCoordination,
  resolvePepcoPortalCredential,
  pickPepcoMfaCoordinationMeta,
};
