"use strict";

const TERMINAL_JOB_STATUSES = new Set([
  "completed",
  "completed_with_warnings",
  "partial_external_blocker",
  "failed",
  "failed_unrecoverable",
  "cancelled",
]);

const TERMINAL_EVENT_TYPES = new Set([
  "scrape_completed",
  "scrape_failed",
  "scrape_cancelled",
]);

const SENSITIVE_PATTERNS = [
  /password/i,
  /cookie/i,
  /authorization/i,
  /bearer\s+/i,
  /token/i,
  /set-cookie/i,
  /sessionstorage/i,
  /localstorage/i,
  /<html[\s>]/i,
  /supabase\.co\/storage\/v1\/object\/sign/i,
];

function safeStr(value, maxLen = 2000) {
  if (value == null) return "";
  const text = String(value).trim();
  if (!text) return "";
  return text.length > maxLen ? `${text.slice(0, maxLen)}…` : text;
}

function sanitizeTechnicalMessage(message) {
  const text = safeStr(message, 4000);
  if (!text) return null;
  for (const pattern of SENSITIVE_PATTERNS) {
    if (pattern.test(text)) {
      return "Technical details redacted for security.";
    }
  }
  return text;
}

function sanitizeMetadata(metadata) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return {};
  }
  const out = {};
  for (const [key, value] of Object.entries(metadata)) {
    const k = String(key);
    if (/password|cookie|token|authorization|html|payload/i.test(k)) continue;
    if (typeof value === "string") {
      const sanitized = sanitizeTechnicalMessage(value);
      if (sanitized) out[k] = sanitized;
    } else if (
      typeof value === "number" ||
      typeof value === "boolean" ||
      value === null
    ) {
      out[k] = value;
    } else if (Array.isArray(value)) {
      out[k] = value
        .slice(0, 20)
        .map((item) => (typeof item === "string" ? safeStr(item, 200) : item));
    }
  }
  return out;
}

function logPersistenceError(scope, err) {
  const msg = err && err.message ? err.message : String(err);
  console.warn(`[scrape-events] ${scope}: ${msg}`);
}

function mapSessionStatusToJobStatus(sessionStatus) {
  const s = `${sessionStatus || ""}`.trim().toLowerCase();
  if (s === "done") return "completed";
  if (s === "cancelled") return "cancelled";
  if (s === "error") return "failed";
  if (s.startsWith("partial_success")) return "completed_with_warnings";
  if (s === "waiting_user" || s === "mfa_required") return "waiting_user";
  if (s === "scraping" || s === "running") return "running";
  if (s === "queued") return "queued";
  return "running";
}

/** Legacy in-memory session.status values that must not be regressed by progress mirrors. */
function isLegacySessionTerminalStatus(sessionStatus) {
  const s = `${sessionStatus || ""}`.trim().toLowerCase();
  return (
    s === "done" ||
    s === "error" ||
    s === "cancelled" ||
    s.startsWith("partial_success")
  );
}

/**
 * Map durable scrape_jobs.status onto legacy session.status without regressing terminal states.
 * e.g. job "completed" → session "done" (not "completed", which legacy clients do not recognize).
 */
function applySessionStatusFromScrapeEvent(session, scrapeJobStatus) {
  if (isLegacySessionTerminalStatus(session.status)) return;

  const s = `${scrapeJobStatus || ""}`.trim().toLowerCase();
  if (s === "completed" || s === "completed_with_warnings") {
    session.status = "done";
    return;
  }
  if (s === "failed") {
    session.status = "error";
    return;
  }
  if (s === "cancelled" || s === "cancelling") {
    session.status = s === "cancelling" ? "cancelled" : "cancelled";
    if (s === "cancelling") session._cancelRequested = true;
    return;
  }
  if (s === "waiting_user" || s === "mfa_required") {
    session.status = "waiting_user";
    return;
  }
  if (s === "queued") {
    session.status = "queued";
    return;
  }
  if (s === "scraping" || s === "running") {
    session.status = s === "scraping" ? "scraping" : "running";
  }
}

function userMessageForSessionStatus(session, sessionStatus) {
  const permit = safeStr(session?.permitNumber || session?._scrapePermitNumber, 80);
  const s = `${sessionStatus || ""}`.trim().toLowerCase();
  const msg = safeStr(session?.message, 500);

  if (s === "done") {
    return permit
      ? `Scrape completed for permit ${permit}.`
      : "Scrape completed successfully.";
  }
  if (s === "cancelled") return "Scrape cancelled.";
  if (s.startsWith("partial_success_attachments")) {
    return permit
      ? `Scrape completed with warnings for ${permit}. Some attachment downloads are still pending.`
      : "Scrape completed, but some files could not be downloaded.";
  }
  if (s.startsWith("partial_success_plan_review")) {
    return permit
      ? `Scrape completed with warnings for ${permit}. Plan review downloads may still be pending.`
      : "Scrape completed with warnings. Some plan review downloads are still pending.";
  }
  if (s === "error") {
    return mapTechnicalErrorToUserMessage(msg) || "The scrape could not be completed.";
  }
  if (msg) return msg;
  return "Scrape in progress…";
}

function mapTechnicalErrorToUserMessage(technical) {
  const t = `${technical || ""}`.toLowerCase();
  if (!t) return null;
  if (
    t.includes("invalid") &&
    (t.includes("credential") || t.includes("password") || t.includes("login"))
  ) {
    return "Login failed. Please verify the saved portal credentials.";
  }
  if (t.includes("permit") && t.includes("not found")) {
    return "The permit was not found in the selected portal.";
  }
  if (t.includes("session not found") || t.includes("session expired")) {
    return "The scraper session was interrupted before completion.";
  }
  if (t.includes("timeout") || t.includes("timed out")) {
    return "The portal took too long to respond. You can retry the scrape.";
  }
  if (t.includes("selector") || t.includes("locator")) {
    return "The portal layout appears to have changed. The scrape could not continue.";
  }
  if (t.includes("unavailable") || t.includes("503") || t.includes("502")) {
    return "The portal is temporarily unavailable. Please try again later.";
  }
  return null;
}

function detectJurisdictionFromSession(session) {
  const url = `${session?.portalUrl || ""}`.toUpperCase();
  const subtype = `${session?.portalSubtype || ""}`.toLowerCase();
  if (subtype === "pgc-eplan") return "Prince George's County";
  if (subtype === "montgomery-projectdox") return "Montgomery County";
  if (subtype === "howard-projectdox") return "Howard County";
  if (session?.portalType === "accela") {
    if (url.includes("BALTIMORE")) return "Baltimore";
    if (url.includes("FAIRFAX")) return "Fairfax County";
    if (url.includes("ARLINGTONCO")) return "Arlington County";
    return "Accela";
  }
  if (session?.portalType === "projectdox") return "Washington DC";
  return session?.portalType || "Unknown";
}

function isDuplicateSequenceError(err) {
  const code = err && err.code ? String(err.code) : "";
  const msg = err && err.message ? String(err.message) : "";
  return code === "23505" || /duplicate key.*scrape_events/i.test(msg);
}

function isRpcUnavailableError(err) {
  const msg = err && err.message ? String(err.message) : "";
  return (
    /could not find the function/i.test(msg) ||
    /function.*does not exist/i.test(msg) ||
    /schema cache/i.test(msg)
  );
}

async function getNextSequence(supabase, jobId) {
  const { data, error } = await supabase
    .from("scrape_events")
    .select("sequence")
    .eq("job_id", jobId)
    .order("sequence", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  const last = data?.sequence != null ? Number(data.sequence) : 0;
  return Number.isFinite(last) ? last + 1 : 1;
}

/** Serialize per-job sequence allocation when DB RPC is unavailable. */
const sequenceAllocators = new Map();

async function allocateNextSequence(supabase, jobId) {
  try {
    const { data, error } = await supabase.rpc("allocate_scrape_event_sequence", {
      p_job_id: jobId,
    });
    if (!error && data != null) {
      const seq = Number(data);
      if (Number.isFinite(seq) && seq > 0) return seq;
    }
    if (error && !isRpcUnavailableError(error)) {
      throw error;
    }
  } catch (err) {
    if (!isRpcUnavailableError(err)) throw err;
  }

  let alloc = sequenceAllocators.get(jobId);
  if (!alloc) {
    alloc = { chain: Promise.resolve(), nextSequence: null };
    sequenceAllocators.set(jobId, alloc);
  }

  const result = alloc.chain.then(async () => {
    if (alloc.nextSequence != null) {
      const seq = alloc.nextSequence;
      alloc.nextSequence = seq + 1;
      return seq;
    }
    const seq = await getNextSequence(supabase, jobId);
    alloc.nextSequence = seq + 1;
    return seq;
  });

  alloc.chain = result.then(
    () => {},
    () => {},
  );
  return result;
}

function resetSequenceAllocator(jobId) {
  const alloc = sequenceAllocators.get(jobId);
  if (alloc) alloc.nextSequence = null;
}

async function createScrapeJob(supabase, fields) {
  try {
    const row = {
      project_id: fields.projectId,
      user_id: fields.userId || null,
      credential_id: fields.credentialId || null,
      scraper_session_id: fields.scraperSessionId || null,
      jurisdiction: safeStr(fields.jurisdiction, 120) || "Unknown",
      portal_type: fields.portalType || null,
      permit_number: fields.permitNumber || null,
      scrape_mode: fields.scrapeMode || null,
      status: "queued",
      current_stage: "queued",
      current_user_message: "Queued",
      progress_current: 0,
      progress_total: fields.progressTotal ?? null,
      started_at: new Date().toISOString(),
      last_heartbeat_at: new Date().toISOString(),
      last_activity_at: new Date().toISOString(),
      metadata: sanitizeMetadata(fields.metadata),
    };
    const { data, error } = await supabase
      .from("scrape_jobs")
      .insert(row)
      .select("id")
      .single();
    if (error) throw error;
    return { jobId: data.id, ok: true };
  } catch (err) {
    logPersistenceError("createScrapeJob", err);
    return { jobId: null, ok: false };
  }
}

async function updateScrapeJob(supabase, jobId, patch, opts = {}) {
  if (!jobId) return false;
  try {
    const payload = { ...patch };
    if (payload.metadata) payload.metadata = sanitizeMetadata(payload.metadata);
    let query = supabase.from("scrape_jobs").update(payload).eq("id", jobId);
    if (opts.force) {
      // Used by cancel finalize transitions (cancelling → cancelled).
    } else {
      query = query
        .neq("status", "cancelled")
        .neq("status", "cancelling")
        .is("completed_at", null);
    }
    const { error } = await query;
    if (error) throw error;
    return true;
  } catch (err) {
    logPersistenceError("updateScrapeJob", err);
    return false;
  }
}

async function emitScrapeEvent(supabase, jobId, projectId, event) {
  if (!jobId || !projectId) return null;
  try {
    const eventType = safeStr(event.event_type, 80);
    if (!eventType) return null;
    const isHeartbeat = eventType === "heartbeat";
    const skipJobPatch = Boolean(event.skip_job_patch);

    // Suppress non-cancel events once the job is cancelling/cancelled.
    if (
      eventType !== "scrape_cancelled" &&
      eventType !== "scrape_cancelling" &&
      !isHeartbeat
    ) {
      try {
        const {
          isJobCancelled,
        } = require("./scrape-job-cancellation.js");
        if (await isJobCancelled(supabase, jobId)) {
          return null;
        }
      } catch (_) {}
    }

    const userMessage = safeStr(event.user_message, 500) || "Working…";
    const technicalMessage = sanitizeTechnicalMessage(event.technical_message);
    const metadata = sanitizeMetadata(event.metadata);
    const progressCurrent =
      event.progress_current != null ? Number(event.progress_current) : null;
    const progressTotal =
      event.progress_total != null ? Number(event.progress_total) : null;

    if (!skipJobPatch) {
      try {
        const { data, error } = await supabase.rpc("publish_scrape_event", {
          p_job_id: jobId,
          p_project_id: projectId,
          p_event_type: eventType,
          p_stage: event.stage || null,
          p_status: event.status || null,
          p_user_message: userMessage,
          p_technical_message: technicalMessage,
          p_progress_current: progressCurrent,
          p_progress_total: progressTotal,
          p_metadata: metadata,
          p_is_heartbeat: isHeartbeat,
        });
        if (!error && data) {
          return {
            id: data.id,
            sequence: data.sequence,
            created_at: data.created_at,
          };
        }
        if (error && !isRpcUnavailableError(error)) {
          throw error;
        }
      } catch (err) {
        if (!isRpcUnavailableError(err)) throw err;
      }
    }

    let inserted = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      const sequence = await allocateNextSequence(supabase, jobId);
      const row = {
        job_id: jobId,
        project_id: projectId,
        sequence,
        event_type: eventType,
        stage: event.stage || null,
        status: event.status || null,
        user_message: userMessage,
        technical_message: technicalMessage,
        progress_current: progressCurrent,
        progress_total: progressTotal,
        metadata,
      };

      const { data, error } = await supabase
        .from("scrape_events")
        .insert(row)
        .select("id, sequence, created_at")
        .single();

      if (!error) {
        inserted = data;
        break;
      }
      if (isDuplicateSequenceError(error) && attempt < 3) {
        resetSequenceAllocator(jobId);
        continue;
      }
      throw error;
    }
    if (!inserted) return null;

    if (!skipJobPatch) {
      const now = new Date().toISOString();
      const jobPatch = { last_heartbeat_at: now };
      if (!isHeartbeat) {
        jobPatch.last_activity_at = now;
        jobPatch.current_stage = event.stage || eventType;
        jobPatch.current_user_message = userMessage;
        if (progressCurrent != null) jobPatch.progress_current = progressCurrent;
        if (progressTotal != null) jobPatch.progress_total = progressTotal;
        if (event.status) jobPatch.status = event.status;
      }
      await updateScrapeJob(supabase, jobId, jobPatch);
    }
    return inserted;
  } catch (err) {
    logPersistenceError("emitScrapeEvent", err);
    return null;
  }
}

async function markScrapeCompleted(supabase, jobId, projectId, opts = {}) {
  if (!jobId) return;
  const warnings = Boolean(opts.withWarnings);
  const status = warnings ? "completed_with_warnings" : "completed";
  const now = new Date().toISOString();
  await updateScrapeJob(supabase, jobId, {
    status,
    completed_at: now,
    last_activity_at: now,
    current_stage: warnings ? "completed_with_warnings" : "completed",
    current_user_message: opts.user_message || "Scrape completed.",
    error_code: null,
    error_user_message: null,
  });
  await emitScrapeEvent(supabase, jobId, projectId, {
    event_type: warnings ? "warning" : "scrape_completed",
    stage: "completed",
    status,
    user_message: opts.user_message || "Scrape completed.",
    technical_message: opts.technical_message,
    progress_current: opts.progress_current,
    progress_total: opts.progress_total,
    metadata: opts.metadata,
  });
}

async function markScrapeFailed(supabase, jobId, projectId, opts = {}) {
  if (!jobId) return;
  const userMessage =
    opts.user_message ||
    mapTechnicalErrorToUserMessage(opts.technical_message) ||
    "The scrape could not be completed.";
  const now = new Date().toISOString();
  await updateScrapeJob(supabase, jobId, {
    status: "failed",
    completed_at: now,
    last_activity_at: now,
    current_stage: "failed",
    current_user_message: userMessage,
    error_code: opts.error_code || "scrape_failed",
    error_user_message: userMessage,
  });
  await emitScrapeEvent(supabase, jobId, projectId, {
    event_type: "scrape_failed",
    stage: "failed",
    status: "failed",
    user_message: userMessage,
    technical_message: opts.technical_message,
    metadata: opts.metadata,
  });
}

async function markScrapeCancelled(supabase, jobId, projectId, opts = {}) {
  if (!jobId) return;
  const {
    finalizeCancelled,
  } = require("./scrape-job-cancellation.js");
  await finalizeCancelled(supabase, jobId, projectId, {
    user_message: opts.user_message || "Scrape cancelled.",
    technical_message: opts.technical_message,
    cancellation_reason: opts.cancellation_reason || "user_cancelled",
    emitEvent: opts.emitEvent !== false,
  });
}

async function emitHeartbeat(supabase, jobId, projectId, opts = {}) {
  if (!jobId) return;
  const now = new Date().toISOString();
  await updateScrapeJob(supabase, jobId, { last_heartbeat_at: now });
  if (!opts.visible) return;

  await emitScrapeEvent(supabase, jobId, projectId, {
    event_type: "heartbeat",
    stage: opts.stage || "running",
    status: "running",
    user_message:
      opts.user_message ||
      "Still working. The portal is taking longer than usual.",
    technical_message: opts.technical_message,
  });
}

const heartbeatTimers = new Map();

function stopHeartbeat(jobId) {
  const entry = heartbeatTimers.get(jobId);
  if (!entry) return;
  if (entry.interval) clearInterval(entry.interval);
  heartbeatTimers.delete(jobId);
}

function startHeartbeat(supabase, session) {
  const jobId = session?._scrapeJobId;
  const projectId = session?._scrapeProjectId;
  if (!jobId || !projectId) return;

  stopHeartbeat(jobId);
  const state = {
    lastUserEventAt: Date.now(),
    lastVisibleHeartbeatAt: 0,
    interval: null,
  };

  state.interval = setInterval(async () => {
    if (TERMINAL_JOB_STATUSES.has(session._scrapeJobTerminalStatus)) {
      stopHeartbeat(jobId);
      return;
    }
    const silentMs = Date.now() - state.lastUserEventAt;
    const visible = silentMs >= 2 * 60 * 1000;
    const dedupeVisible =
      visible &&
      (state.lastVisibleHeartbeatAt === 0 ||
        Date.now() - state.lastVisibleHeartbeatAt >= 2 * 60 * 1000);
    try {
      if (dedupeVisible) {
        state.lastVisibleHeartbeatAt = Date.now();
      }
      await emitHeartbeat(supabase, jobId, projectId, {
        visible: dedupeVisible,
        user_message: dedupeVisible
          ? "Still working…"
          : undefined,
      });
    } catch (err) {
      logPersistenceError("heartbeat", err);
    }
  }, 30 * 1000);

  heartbeatTimers.set(jobId, state);

  session._touchScrapeActivity = () => {
    state.lastUserEventAt = Date.now();
  };
}

const {
  attachProgressPublisher,
  publishScrapeProgress,
} = require("./scrape-progress-publisher.js");
const { SCRAPE_STAGES } = require("./scrape-stages.js");

function attachScrapeJobBridge(supabase, session, meta, options = {}) {
  const jobId = meta.jobId;
  const projectId = meta.projectId;
  session._scrapeJobId = jobId;
  session._scrapeProjectId = projectId;
  session._scrapePermitNumber = meta.permitNumber || null;
  session._scrapeJurisdiction = meta.jurisdiction || null;
  session._scrapeMode = meta.scrapeMode || null;
  session._scrapeJobTerminalStatus = null;
  session._terminalScrapeEventEmitted = false;

  attachProgressPublisher(supabase, session);

  session.setScrapeProgress = async (opts = {}) => {
    await publishScrapeProgress(supabase, session, opts);
  };

  session.finalizeScrapeJob = async (sessionStatus, extra = {}) => {
    if (!jobId || !projectId || session._terminalScrapeEventEmitted) return;
    session._terminalScrapeEventEmitted = true;
    const jobStatus = mapSessionStatusToJobStatus(sessionStatus);
    session._scrapeJobTerminalStatus = jobStatus;
    stopHeartbeat(jobId);

    const userMessage =
      extra.user_message || userMessageForSessionStatus(session, sessionStatus);
    const technical = sanitizeTechnicalMessage(extra.technical_message || session.message);

    if (jobStatus === "completed") {
      await markScrapeCompleted(supabase, jobId, projectId, {
        user_message: userMessage,
        technical_message: technical,
        progress_current: session.progress,
        progress_total: session.total,
        metadata: extra.metadata,
      });
      return;
    }
    if (jobStatus === "completed_with_warnings") {
      await markScrapeCompleted(supabase, jobId, projectId, {
        withWarnings: true,
        user_message: userMessage,
        technical_message: technical,
        progress_current: session.progress,
        progress_total: session.total,
        metadata: extra.metadata,
      });
      return;
    }
    if (jobStatus === "cancelled") {
      await markScrapeCancelled(supabase, jobId, projectId, {
        user_message: userMessage,
        technical_message: technical,
      });
      return;
    }
    if (jobStatus === "failed") {
      await markScrapeFailed(supabase, jobId, projectId, {
        user_message: userMessage,
        technical_message: technical,
        error_code: extra.error_code,
        metadata: extra.metadata,
      });
    }
  };

  if (!options.skipUiHeartbeat) {
    startHeartbeat(supabase, session);
  }
}

async function beginScrapeJob(supabase, session, reqBody, sessionId) {
  const projectId = reqBody?.projectId ? String(reqBody.projectId).trim() : null;
  if (!projectId) return { jobId: null };

  const permitNumber = reqBody?.permitNumber
    ? String(reqBody.permitNumber).trim()
    : null;
  const userId = reqBody?.userId ? String(reqBody.userId).trim() : null;
  const scrapeMode = reqBody?.scrapeMode ? String(reqBody.scrapeMode).trim() : null;
  const jurisdiction = detectJurisdictionFromSession(session);

  const created = await createScrapeJob(supabase, {
    projectId,
    userId,
    credentialId: session.credentialId || null,
    scraperSessionId: String(sessionId),
    jurisdiction,
    portalType: session.portalType || null,
    permitNumber,
    scrapeMode,
    progressTotal: session.total ?? null,
    metadata: { portal_subtype: session.portalSubtype || null },
  });

  if (!created.ok || !created.jobId) return { jobId: null };

  attachScrapeJobBridge(supabase, session, {
    jobId: created.jobId,
    projectId,
    permitNumber,
    jurisdiction,
    scrapeMode,
  });

  await updateScrapeJob(supabase, created.jobId, { status: "running" });

  await publishScrapeProgress(supabase, session, {
    event_type: "job_queued",
    stage: SCRAPE_STAGES.QUEUED,
    status: "queued",
    user_message: "Scrape queued.",
    dedupeKey: "queued",
    forceFeed: true,
  });

  await publishScrapeProgress(supabase, session, {
    event_type: "scraper_started",
    stage: SCRAPE_STAGES.LAUNCHING,
    status: "running",
    user_message: permitNumber
      ? `Starting scraper for permit ${permitNumber}.`
      : "Starting scraper.",
    progress_current: 0,
    progress_total: session.total ?? null,
    dedupeKey: "launching",
    forceFeed: true,
  });

  await publishScrapeProgress(supabase, session, {
    event_type: "portal_opening",
    stage: SCRAPE_STAGES.LOGGING_IN,
    status: "running",
    user_message: `Opening ${jurisdiction} portal.`,
    dedupeKey: "logging_in",
    forceFeed: true,
  });

  if (session.browser && session.status !== "error") {
    await publishScrapeProgress(supabase, session, {
      event_type: "login_success",
      stage: SCRAPE_STAGES.PORTAL_READY,
      status: "running",
      user_message: "Portal session ready.",
      dedupeKey: "portal_ready",
      forceFeed: true,
    });
  }

  if (permitNumber) {
    await publishScrapeProgress(supabase, session, {
      event_type: "permit_search_started",
      stage: SCRAPE_STAGES.LOCATING_PROJECT,
      status: "running",
      user_message: `Searching for permit ${permitNumber}.`,
      dedupeKey: "locating_project",
      forceFeed: true,
    });
  }

  return { jobId: created.jobId, projectId, jurisdiction };
}

module.exports = {
  TERMINAL_JOB_STATUSES,
  TERMINAL_EVENT_TYPES,
  SCRAPE_STAGES,
  createScrapeJob,
  emitScrapeEvent,
  updateScrapeJob,
  markScrapeCompleted,
  markScrapeFailed,
  markScrapeCancelled,
  emitHeartbeat,
  startHeartbeat,
  stopHeartbeat,
  attachScrapeJobBridge,
  beginScrapeJob,
  detectJurisdictionFromSession,
  mapTechnicalErrorToUserMessage,
  userMessageForSessionStatus,
  mapSessionStatusToJobStatus,
  applySessionStatusFromScrapeEvent,
  sanitizeTechnicalMessage,
  sanitizeMetadata,
};
