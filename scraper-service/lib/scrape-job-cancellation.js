"use strict";

/**
 * Shared durable scrape cancellation contract.
 *
 * Flow: requestCancel → status=cancelling + session signal → workers abort at
 * unit boundaries → finalizeCancelled → status=cancelled → no further progress.
 */

const CANCEL_POLL_TTL_MS = 1500;

/** @type {Map<string, { value: boolean, at: number, inflight?: Promise<boolean> }>} */
const cancelPollCache = new Map();

const CANCEL_SIGNAL_STATUSES = new Set(["cancelling", "cancelled"]);
const TERMINAL_NON_CANCEL = new Set([
  "completed",
  "completed_with_warnings",
  "partial_external_blocker",
  "failed",
  "failed_unrecoverable",
]);

function normalizeStatus(status) {
  return `${status || ""}`.trim().toLowerCase();
}

function isCancelSignalStatus(status) {
  return CANCEL_SIGNAL_STATUSES.has(normalizeStatus(status));
}

function isTerminalNonCancelStatus(status) {
  return TERMINAL_NON_CANCEL.has(normalizeStatus(status));
}

function clearCancelPollCache(jobId) {
  if (jobId) cancelPollCache.delete(String(jobId));
}

/**
 * Resolve a cancel checker that may return boolean | Promise<boolean>.
 * @param {unknown} value
 * @returns {Promise<boolean>}
 */
async function resolveCancelFlag(value) {
  if (!value) return false;
  if (typeof value.then === "function") return !!(await value);
  return !!value;
}

/**
 * @param {unknown} fn
 * @returns {Promise<boolean>}
 */
async function invokeCancelChecker(fn) {
  if (typeof fn !== "function") return false;
  try {
    return resolveCancelFlag(fn());
  } catch (_) {
    return false;
  }
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} jobId
 * @param {{ bypassCache?: boolean }} [opts]
 * @returns {Promise<boolean>}
 */
async function isJobCancelled(supabase, jobId, opts = {}) {
  const id = `${jobId || ""}`.trim();
  if (!id || !supabase) return false;

  const now = Date.now();
  const cached = cancelPollCache.get(id);
  if (!opts.bypassCache && cached && now - cached.at < CANCEL_POLL_TTL_MS) {
    return cached.value;
  }
  if (!opts.bypassCache && cached?.inflight) {
    return cached.inflight;
  }

  const inflight = (async () => {
    try {
      const { data, error } = await supabase
        .from("scrape_jobs")
        .select("id, status, completed_at, cancellation_reason, metadata")
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      const status = normalizeStatus(data?.status);
      let cancelled = isCancelSignalStatus(status);
      if (!cancelled && data?.metadata && typeof data.metadata === "object") {
        const arlington = data.metadata.arlington;
        const uci = data.metadata.uci;
        if (
          arlington &&
          typeof arlington === "object" &&
          `${arlington.terminalReason || ""}` === "user_cancelled"
        ) {
          cancelled = true;
        }
        if (
          uci &&
          typeof uci === "object" &&
          `${uci.terminal_reason || ""}` === "user_cancelled"
        ) {
          cancelled = true;
        }
      }
      cancelPollCache.set(id, { value: cancelled, at: Date.now() });
      return cancelled;
    } catch (err) {
      cancelPollCache.set(id, {
        value: cached?.value || false,
        at: Date.now(),
      });
      throw err;
    }
  })();

  cancelPollCache.set(id, {
    value: cached?.value || false,
    at: cached?.at || 0,
    inflight,
  });

  try {
    return await inflight;
  } finally {
    const entry = cancelPollCache.get(id);
    if (entry?.inflight === inflight) {
      cancelPollCache.set(id, {
        value: entry.value,
        at: entry.at || Date.now(),
      });
    }
  }
}

/**
 * Memory flag OR durable DB cancel/cancelling.
 * @param {object|null|undefined} sessionOrJob
 * @param {import("@supabase/supabase-js").SupabaseClient|null} [supabase]
 * @param {{ jobId?: string|null, bypassCache?: boolean }} [opts]
 */
async function shouldAbort(sessionOrJob, supabase = null, opts = {}) {
  if (!sessionOrJob) return false;
  if (sessionOrJob._cancelRequested) return true;
  if (sessionOrJob._scrapeEventsSuppressed) return true;
  const terminal = normalizeStatus(sessionOrJob._scrapeJobTerminalStatus);
  if (terminal === "cancelled") return true;
  const status = normalizeStatus(sessionOrJob.status);
  if (isCancelSignalStatus(status)) return true;

  const jobId =
    `${opts.jobId || sessionOrJob._scrapeJobId || sessionOrJob.id || ""}`.trim() ||
    null;
  if (!jobId || !supabase) return false;

  try {
    const cancelled = await isJobCancelled(supabase, jobId, opts);
    if (cancelled && sessionOrJob && typeof sessionOrJob === "object") {
      sessionOrJob._cancelRequested = true;
    }
    return cancelled;
  } catch (_) {
    return !!sessionOrJob._cancelRequested;
  }
}

/**
 * Bind a cancel checker for a live session (memory + DB poll).
 * @param {object} session
 * @param {import("@supabase/supabase-js").SupabaseClient|null} supabase
 * @param {{ jobId?: string|null }} [opts]
 * @returns {() => Promise<boolean>}
 */
function bindSessionCancelChecker(session, supabase, opts = {}) {
  const jobId = `${opts.jobId || session?._scrapeJobId || ""}`.trim() || null;
  return async () => shouldAbort(session, supabase, { jobId });
}

/**
 * Find a local in-memory session for a job/session id.
 * @param {Record<string, any>} sessions
 * @param {{ sessionId?: string|null, jobId?: string|null, scraperSessionId?: string|null }} keys
 */
function findLocalSession(sessions, keys = {}) {
  if (!sessions || typeof sessions !== "object") return null;
  const sessionId = `${keys.sessionId || ""}`.trim();
  if (sessionId && sessions[sessionId]) {
    return { sessionId, session: sessions[sessionId] };
  }
  const scraperSessionId = `${keys.scraperSessionId || ""}`.trim();
  if (scraperSessionId && sessions[scraperSessionId]) {
    return { sessionId: scraperSessionId, session: sessions[scraperSessionId] };
  }
  const jobId = `${keys.jobId || ""}`.trim();
  if (jobId) {
    for (const [sid, session] of Object.entries(sessions)) {
      if (`${session?._scrapeJobId || ""}` === jobId) {
        return { sessionId: sid, session };
      }
    }
  }
  return null;
}

/**
 * Soft-close Playwright resources on a session without deleting the map entry.
 * Prefer cleanupSession when available (keeps session object for flag).
 */
async function disposeSessionBrowser(session) {
  if (!session) return;
  const pages = [];
  try {
    if (session.page) pages.push(session.page);
    if (session._dcExtractionPage) pages.push(session._dcExtractionPage);
    if (session.context && typeof session.context.pages === "function") {
      pages.push(...(session.context.pages() || []));
    }
  } catch (_) {}
  for (const p of pages) {
    try {
      await p.close?.().catch?.(() => {});
    } catch (_) {}
  }
  try {
    if (session.context) await session.context.close().catch(() => {});
  } catch (_) {}
  try {
    if (session.browser) await session.browser.close().catch(() => {});
  } catch (_) {}
  session.page = null;
  session.context = null;
  session.browser = null;
  session._dcExtractionPage = null;
}

/**
 * Mark job cancelling (in-flight). Does not set completed_at.
 */
async function markScrapeCancelling(supabase, jobId, projectId, opts = {}) {
  if (!jobId || !supabase) return { ok: false, alreadyTerminal: false };
  const now = new Date().toISOString();
  const { data: row, error: readErr } = await supabase
    .from("scrape_jobs")
    .select("id, status, completed_at, project_id")
    .eq("id", jobId)
    .maybeSingle();
  if (readErr) throw readErr;
  if (!row) return { ok: false, alreadyTerminal: false, missing: true };

  if (projectId && `${row.project_id}` !== `${projectId}`) {
    const err = new Error("Job does not belong to project");
    err.code = "PROJECT_MISMATCH";
    throw err;
  }

  const status = normalizeStatus(row.status);
  if (status === "cancelled" || row.completed_at) {
    return { ok: true, alreadyTerminal: status === "cancelled" || !!row.completed_at, status };
  }
  if (status === "cancelling") {
    return { ok: true, alreadyTerminal: false, status: "cancelling", alreadyCancelling: true };
  }
  if (isTerminalNonCancelStatus(status)) {
    return { ok: true, alreadyTerminal: true, status };
  }

  const { error } = await supabase
    .from("scrape_jobs")
    .update({
      status: "cancelling",
      cancelled_at: now,
      last_activity_at: now,
      current_stage: "cancelling",
      current_user_message: opts.user_message || "Cancelling scrape…",
      cancellation_reason: opts.cancellation_reason || "user_cancelled",
    })
    .eq("id", jobId)
    .is("completed_at", null)
    .neq("status", "cancelled");

  if (error) throw error;
  clearCancelPollCache(jobId);
  cancelPollCache.set(String(jobId), { value: true, at: Date.now() });
  return { ok: true, alreadyTerminal: false, status: "cancelling" };
}

/**
 * Finalize durable cancel after worker stops. Suppresses further progress.
 */
async function finalizeCancelled(supabase, jobId, projectId, opts = {}) {
  if (!jobId || !supabase) return false;
  const now = new Date().toISOString();
  clearCancelPollCache(jobId);
  cancelPollCache.set(String(jobId), { value: true, at: Date.now() });

  const { error } = await supabase
    .from("scrape_jobs")
    .update({
      status: "cancelled",
      cancelled_at: now,
      completed_at: now,
      last_activity_at: now,
      current_stage: "cancelled",
      current_user_message: opts.user_message || "Scrape cancelled.",
      cancellation_reason: opts.cancellation_reason || "user_cancelled",
    })
    .eq("id", jobId)
    .is("completed_at", null);

  if (error) throw error;

  if (projectId && opts.emitEvent !== false) {
    try {
      const scrapeEvents = require("./scrape-events.js");
      await scrapeEvents.emitScrapeEvent(supabase, jobId, projectId, {
        event_type: "scrape_cancelled",
        stage: "cancelled",
        status: "cancelled",
        user_message: opts.user_message || "Scrape cancelled.",
        technical_message: opts.technical_message,
        skip_job_patch: true,
      });
    } catch (_) {}
  }

  try {
    const scrapeEvents = require("./scrape-events.js");
    scrapeEvents.stopHeartbeat(jobId);
  } catch (_) {}

  return true;
}

/**
 * Unified cancel entrypoint for jobId and sessionId paths.
 */
async function requestCancel(params) {
  const {
    supabase,
    jobId: rawJobId,
    projectId: rawProjectId,
    sessionId: rawSessionId,
    sessions = {},
    cleanupSession = null,
    userId = null,
    closeBrowser = true,
    user_message = "Scrape cancelled.",
  } = params || {};

  const sessionId = `${rawSessionId || ""}`.trim() || null;
  let jobId = `${rawJobId || ""}`.trim() || null;
  let projectId = `${rawProjectId || ""}`.trim() || null;

  let jobRow = null;
  if (supabase && jobId) {
    const { data, error } = await supabase
      .from("scrape_jobs")
      .select(
        "id, jurisdiction, user_id, project_id, status, completed_at, scraper_session_id, portal_type, metadata",
      )
      .eq("id", jobId)
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      const err = new Error("Scrape job not found");
      err.code = "JOB_NOT_FOUND";
      throw err;
    }
    if (projectId && `${data.project_id}` !== projectId) {
      const err = new Error("Job does not belong to project");
      err.code = "PROJECT_MISMATCH";
      throw err;
    }
    jobRow = data;
    projectId = projectId || `${data.project_id}`;
  }

  // Resolve job from session when only session cancel was used.
  const localFromSession = findLocalSession(sessions, {
    sessionId,
    jobId,
    scraperSessionId: jobRow?.scraper_session_id,
  });
  const session = localFromSession?.session || null;
  const resolvedSessionId = localFromSession?.sessionId || sessionId;

  if (!jobId && session?._scrapeJobId) {
    jobId = `${session._scrapeJobId}`.trim();
  }
  if (!projectId && session?._scrapeProjectId) {
    projectId = `${session._scrapeProjectId}`.trim();
  }

  if (session) {
    session._cancelRequested = true;
    session.status = "cancelled";
    session.message = user_message || "Scrape cancelled by user";
    session._scrapeEventsSuppressed = true;
  }

  let cancelPhase = { ok: false, alreadyTerminal: false, status: null };
  if (supabase && jobId) {
    cancelPhase = await markScrapeCancelling(supabase, jobId, projectId, {
      user_message: "Cancelling scrape…",
      cancellation_reason: "user_cancelled",
    });
  }

  const jurisdiction = `${jobRow?.jurisdiction || session?.jurisdiction || session?.portalUrl || ""}`.toLowerCase();
  const isArlington = jurisdiction.includes("arlington");
  const isUci =
    jurisdiction === "uci" ||
    `${jobRow?.metadata?.uci ? "uci" : ""}` === "uci" ||
    `${jobRow?.portal_type || ""}`.toLowerCase() === "uci_portal_sync";

  let arlingtonRow = null;
  if (supabase && jobId && projectId && isArlington && !cancelPhase.alreadyTerminal) {
    try {
      const { data, error } = await supabase.rpc("cancel_arlington_scrape_job", {
        p_job_id: jobId,
        p_project_id: projectId,
        p_user_id: userId || jobRow?.user_id || session?.userId || null,
      });
      if (error) throw error;
      arlingtonRow = Array.isArray(data) ? data[0] : data;
      clearCancelPollCache(jobId);
      cancelPollCache.set(String(jobId), { value: true, at: Date.now() });
    } catch (err) {
      console.warn(
        "[scrape-cancel] arlington RPC failed (continuing with shared cancel):",
        err?.message || err,
      );
    }
  }

  if (supabase && jobId && projectId && isUci && !cancelPhase.alreadyTerminal) {
    try {
      await supabase.rpc("cancel_uci_portal_sync_job", {
        p_job_id: jobId,
        p_project_id: projectId,
        p_user_id: userId || jobRow?.user_id || null,
      });
      clearCancelPollCache(jobId);
      cancelPollCache.set(String(jobId), { value: true, at: Date.now() });
    } catch (err) {
      console.warn(
        "[scrape-cancel] uci RPC failed (continuing with shared cancel):",
        err?.message || err,
      );
    }
  }

  try {
    const scrapeEvents = require("./scrape-events.js");
    if (jobId) scrapeEvents.stopHeartbeat(jobId);
    if (
      supabase &&
      jobId &&
      projectId &&
      !cancelPhase.alreadyTerminal &&
      !arlingtonRow?.already_terminal
    ) {
      await scrapeEvents.emitScrapeEvent(supabase, jobId, projectId, {
        event_type: "scrape_cancelling",
        stage: "cancelling",
        status: "cancelling",
        user_message: "Cancelling scrape…",
        skip_job_patch: true,
      });
    }
  } catch (_) {}

  if (closeBrowser && resolvedSessionId && typeof cleanupSession === "function") {
    try {
      cleanupSession(resolvedSessionId, "http_cancel");
    } catch (_) {
      await disposeSessionBrowser(session);
    }
  } else if (closeBrowser && session) {
    await disposeSessionBrowser(session);
  }

  const status =
    arlingtonRow?.status ||
    (cancelPhase.alreadyTerminal ? cancelPhase.status : "cancelling") ||
    "cancelling";

  return {
    success: true,
    jobId,
    sessionId: resolvedSessionId,
    status,
    alreadyTerminal: Boolean(
      cancelPhase.alreadyTerminal || arlingtonRow?.already_terminal,
    ),
    cancellationReason: "user_cancelled",
    localSessionSignaled: Boolean(session),
  };
}

/**
 * Whether progress publishing should be suppressed for this session/job.
 */
function shouldSuppressProgress(session) {
  if (!session) return false;
  if (session._scrapeEventsSuppressed) return true;
  if (session._cancelRequested) return true;
  const terminal = normalizeStatus(session._scrapeJobTerminalStatus);
  return terminal === "cancelled";
}

module.exports = {
  CANCEL_POLL_TTL_MS,
  CANCEL_SIGNAL_STATUSES,
  isCancelSignalStatus,
  isJobCancelled,
  shouldAbort,
  bindSessionCancelChecker,
  findLocalSession,
  disposeSessionBrowser,
  markScrapeCancelling,
  finalizeCancelled,
  requestCancel,
  shouldSuppressProgress,
  invokeCancelChecker,
  resolveCancelFlag,
  clearCancelPollCache,
};
