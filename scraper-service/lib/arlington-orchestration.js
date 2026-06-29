"use strict";

const crypto = require("crypto");

/** @typedef {'not_started'|'loading_metadata'|'downloading'|'partial'|'rate_limited'|'complete'|'failed'} ArlingtonAttachmentsState */
/** @typedef {'not_started'|'loading'|'complete'|'weak_extraction'|'failed'} ArlingtonProjectInfoState */
/** @typedef {'not_started'|'loading_metadata'|'downloading'|'partial'|'complete'|'failed'} ArlingtonPlanReviewState */

const ARLINGTON_ATTACHMENTS_STATES = new Set([
  "not_started",
  "loading_metadata",
  "downloading",
  "partial",
  "rate_limited",
  "complete",
  "failed",
]);

const ARLINGTON_PROJECT_INFO_STATES = new Set([
  "not_started",
  "loading",
  "complete",
  "weak_extraction",
  "failed",
]);

const ARLINGTON_PLAN_REVIEW_STATES = new Set([
  "not_started",
  "loading_metadata",
  "downloading",
  "partial",
  "complete",
  "failed",
]);

const ARLINGTON_DURABLE_AUTO_CONTINUE_MAX_CYCLES = 9999;
const ARLINGTON_JOB_LEASE_TTL_MS = 3 * 60 * 1000;
const ARLINGTON_RATE_LIMIT_BASE_MS = 90 * 1000;
const ARLINGTON_RATE_LIMIT_MAX_MS = 15 * 60 * 1000;

const TERMINAL_JOB_STATUSES = new Set([
  "completed",
  "completed_with_warnings",
  "failed",
  "cancelled",
]);

const ACTIVE_JOB_STATUSES = new Set([
  "queued",
  "running",
  "resuming",
  "rate_limited",
  "partial",
  "waiting_user",
]);

function safeStr(value, maxLen = 500) {
  if (value == null) return "";
  const text = String(value).trim();
  if (!text) return "";
  return text.length > maxLen ? `${text.slice(0, maxLen)}…` : text;
}

function newWorkerId() {
  return crypto.randomBytes(12).toString("hex");
}

function bumpCheckpointVersion(priorPd) {
  const prior =
    priorPd && typeof priorPd === "object" && !Array.isArray(priorPd)
      ? priorPd
      : {};
  const current = Number(prior.checkpointVersion) || 0;
  return current + 1;
}

function readCheckpointVersion(portalData) {
  if (!portalData || typeof portalData !== "object") return 0;
  const v = Number(portalData.checkpointVersion);
  return Number.isFinite(v) && v > 0 ? v : 0;
}

function readArlingtonSectionStates(portalData) {
  const root =
    portalData && typeof portalData === "object" && !Array.isArray(portalData)
      ? portalData
      : {};
  const states = root.arlingtonSectionStates;
  return states && typeof states === "object" && !Array.isArray(states)
    ? { ...states }
    : {};
}

function mergeArlingtonSectionStates(priorPd, patch) {
  const prior = readArlingtonSectionStates(priorPd);
  return { ...prior, ...(patch || {}) };
}

/**
 * Detect Cloudflare / Accela rate-limit page in attachment iframe body.
 * @param {string} bodySnippet
 * @returns {{ rateLimited: boolean; errorCode: string|null }}
 */
function detectCloudflareRateLimit(bodySnippet) {
  const text = `${bodySnippet || ""}`;
  if (!text) return { rateLimited: false, errorCode: null };
  const lower = text.toLowerCase();
  const has1015 = /error\s*1015/i.test(text);
  const hasRateLimitPhrase =
    lower.includes("you are being rate limited") ||
    lower.includes("rate limited") ||
    lower.includes("ray id");
  const hasCloudflareBlock =
    lower.includes("cloudflare") && (has1015 || hasRateLimitPhrase);
  if (has1015 || (hasRateLimitPhrase && hasCloudflareBlock)) {
    return { rateLimited: true, errorCode: "1015" };
  }
  if (hasRateLimitPhrase && lower.includes("aca-prod.accela.com")) {
    return { rateLimited: true, errorCode: "1015" };
  }
  return { rateLimited: false, errorCode: null };
}

function computeRateLimitRetryAfterMs(attempt = 0) {
  const base = ARLINGTON_RATE_LIMIT_BASE_MS;
  const exp = Math.min(attempt, 6);
  const jitter = Math.floor(Math.random() * 15000);
  return Math.min(base * 2 ** exp + jitter, ARLINGTON_RATE_LIMIT_MAX_MS);
}

function formatRetryAfterIso(delayMs) {
  return new Date(Date.now() + Math.max(0, delayMs)).toISOString();
}

/**
 * Classify Arlington permit as building or zoning from record header / type.
 * @param {Record<string, unknown>|null|undefined} header
 * @param {string} permitNumber
 * @returns {'building'|'zoning'|'unknown'}
 */
function detectArlingtonRecordMode(header, permitNumber) {
  const recordType = safeStr(header?.record_type, 200).toLowerCase();
  const permit = safeStr(permitNumber, 80).toUpperCase();
  const haystack = `${recordType} ${permit}`;
  if (/zoning|zpr|zp-|site.?plan.*zoning/i.test(haystack)) return "zoning";
  if (/building|bldg|construction|residential|commercial|ra\d|rb\d/i.test(haystack)) {
    return "building";
  }
  if (/\bZON\b|\bZP\b/.test(permit)) return "zoning";
  if (/\bBLD\b|\bRA\d|\bRB\d|\bCNEW\b/i.test(permit)) return "building";
  return "unknown";
}

function arlingtonAttachmentDownloadedCount(rows) {
  if (!Array.isArray(rows)) return 0;
  return rows.filter((row) => {
    if (!row || typeof row !== "object") return false;
    const viewUrl = `${row.viewUrl || row.publicUrl || ""}`.trim();
    const storagePath = `${row.storagePath || ""}`.trim();
    const ds = `${row.downloadStatus || ""}`.trim();
    return (
      /^https?:\/\//i.test(viewUrl) ||
      storagePath.length > 0 ||
      ds === "uploaded" ||
      ds === "success"
    );
  }).length;
}

function arlingtonAttachmentPendingCount(rows) {
  if (!Array.isArray(rows)) return 0;
  return rows.filter((row) => {
    if (!row || typeof row !== "object") return false;
    const ds = `${row.downloadStatus || ""}`.trim();
    if (ds === "failed_non_retryable") return false;
    const viewUrl = `${row.viewUrl || row.publicUrl || ""}`.trim();
    const storagePath = `${row.storagePath || ""}`.trim();
    return (
      !/^https?:\/\//i.test(viewUrl) &&
      !storagePath &&
      ds !== "uploaded" &&
      ds !== "success"
    );
  }).length;
}

function countPlanReviewPendingDocuments(planReviewTab) {
  if (!planReviewTab || typeof planReviewTab !== "object") {
    return { planSet: 0, reviewResults: 0, approved: 0, total: 0 };
  }
  const tabs =
    planReviewTab.tabs && typeof planReviewTab.tabs === "object"
      ? planReviewTab.tabs
      : planReviewTab;

  const pendingInList = (docs) => {
    if (!Array.isArray(docs)) return 0;
    return docs.filter((d) => {
      if (!d || typeof d !== "object") return false;
      const ds = `${d.downloadStatus || ""}`.trim();
      if (ds === "uploaded" || ds === "success") return false;
      if (ds === "failed_non_retryable") return false;
      const url = `${d.publicUrl || d.viewUrl || d.storagePath || ""}`.trim();
      return !/^https?:\/\//i.test(url) && !url.startsWith("projects/");
    }).length;
  };

  const planSet =
    tabs?.plansAndDocuments?.sections?.planSetDocuments?.documents;
  const reviewResults = tabs?.reviewResultsAndMarkups?.documents;
  const approved = tabs?.approvedDocuments?.documents;

  const planSetPending = pendingInList(planSet);
  const reviewPending = pendingInList(reviewResults);
  const approvedPending = pendingInList(approved);
  return {
    planSet: planSetPending,
    reviewResults: reviewPending,
    approved: approvedPending,
    total: planSetPending + reviewPending + approvedPending,
  };
}

function applyCheckpointVersionAndStates(nextPd, priorPd, sectionStatePatch) {
  const out = { ...nextPd };
  out.checkpointVersion = bumpCheckpointVersion(priorPd);
  out.arlingtonSectionStates = mergeArlingtonSectionStates(
    priorPd,
    sectionStatePatch,
  );
  out.schemaVersion = Math.max(Number(out.schemaVersion) || 0, 2);
  return out;
}

async function readProjectPortalRow(supabase, projectId, userId, permitNumber) {
  const selectFields = "id, portal_data, portal_data_hash, permit_number, user_id";
  if (projectId) {
    const { data: rows } = await supabase
      .from("projects")
      .select(selectFields)
      .eq("id", projectId)
      .limit(1);
    if (rows?.[0]) return rows[0];
  }
  if (userId && permitNumber) {
    const { data: rows } = await supabase
      .from("projects")
      .select(selectFields)
      .eq("permit_number", `${permitNumber}`.trim())
      .eq("user_id", userId)
      .limit(1);
    if (rows?.[0]) return rows[0];
  }
  return null;
}

async function readScrapeJobMetadata(supabase, jobId) {
  const { data, error } = await supabase
    .from("scrape_jobs")
    .select("id, status, metadata, project_id, permit_number, scraper_session_id")
    .eq("id", jobId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function patchScrapeJobMetadata(supabase, jobId, patchFn) {
  const job = await readScrapeJobMetadata(supabase, jobId);
  if (!job) return { ok: false, reason: "job_not_found" };
  const priorMeta =
    job.metadata && typeof job.metadata === "object" && !Array.isArray(job.metadata)
      ? job.metadata
      : {};
  const nextMeta = patchFn(structuredCloneSafe(priorMeta));
  const { error } = await supabase
    .from("scrape_jobs")
    .update({
      metadata: nextMeta,
      last_activity_at: new Date().toISOString(),
      last_heartbeat_at: new Date().toISOString(),
    })
    .eq("id", jobId);
  if (error) throw error;
  return { ok: true, metadata: nextMeta };
}

function structuredCloneSafe(value) {
  try {
    return structuredClone(value);
  } catch (_) {
    return JSON.parse(JSON.stringify(value));
  }
}

function readArlingtonJobMeta(metadata) {
  const meta =
    metadata && typeof metadata === "object" && !Array.isArray(metadata)
      ? metadata
      : {};
  const arlington =
    meta.arlington && typeof meta.arlington === "object"
      ? meta.arlington
      : {};
  return { meta, arlington };
}

async function claimArlingtonJobLease(supabase, jobId, workerId, ttlMs) {
  const leaseTtl = ttlMs || ARLINGTON_JOB_LEASE_TTL_MS;
  const now = Date.now();
  const job = await readScrapeJobMetadata(supabase, jobId);
  if (!job) return { claimed: false, reason: "job_not_found" };
  if (TERMINAL_JOB_STATUSES.has(`${job.status || ""}`.toLowerCase())) {
    return { claimed: false, reason: "job_terminal" };
  }
  const { arlington } = readArlingtonJobMeta(job.metadata);
  const expiryMs = arlington.leaseExpiresAt
    ? new Date(arlington.leaseExpiresAt).getTime()
    : 0;
  if (
    arlington.leaseWorkerId &&
    arlington.leaseWorkerId !== workerId &&
    expiryMs > now
  ) {
    return {
      claimed: false,
      reason: "lease_held",
      holder: arlington.leaseWorkerId,
      leaseExpiresAt: arlington.leaseExpiresAt,
    };
  }
  const leaseExpiresAt = new Date(now + leaseTtl).toISOString();
  await patchScrapeJobMetadata(supabase, jobId, (meta) => ({
    ...meta,
    arlington: {
      ...(meta.arlington && typeof meta.arlington === "object"
        ? meta.arlington
        : {}),
      leaseWorkerId: workerId,
      leaseExpiresAt,
      leaseAcquiredAt: new Date(now).toISOString(),
    },
  }));
  return { claimed: true, leaseExpiresAt, workerId };
}

async function refreshArlingtonJobLease(supabase, jobId, workerId, ttlMs) {
  const leaseTtl = ttlMs || ARLINGTON_JOB_LEASE_TTL_MS;
  const job = await readScrapeJobMetadata(supabase, jobId);
  if (!job) return false;
  const { arlington } = readArlingtonJobMeta(job.metadata);
  if (arlington.leaseWorkerId !== workerId) return false;
  const leaseExpiresAt = new Date(Date.now() + leaseTtl).toISOString();
  await patchScrapeJobMetadata(supabase, jobId, (meta) => ({
    ...meta,
    arlington: {
      ...(meta.arlington && typeof meta.arlington === "object"
        ? meta.arlington
        : {}),
      leaseWorkerId: workerId,
      leaseExpiresAt,
      leaseLastRefreshAt: new Date().toISOString(),
    },
  }));
  return true;
}

async function releaseArlingtonJobLease(supabase, jobId, workerId, reason) {
  const job = await readScrapeJobMetadata(supabase, jobId);
  if (!job) return;
  const { arlington } = readArlingtonJobMeta(job.metadata);
  if (arlington.leaseWorkerId && arlington.leaseWorkerId !== workerId) return;
  await patchScrapeJobMetadata(supabase, jobId, (meta) => ({
    ...meta,
    arlington: {
      ...(meta.arlington && typeof meta.arlington === "object"
        ? meta.arlington
        : {}),
      leaseWorkerId: null,
      leaseExpiresAt: null,
      leaseReleasedAt: new Date().toISOString(),
      leaseReleaseReason: reason || "completed",
    },
  }));
}

async function updateArlingtonJobPhase(supabase, jobId, phasePatch) {
  await patchScrapeJobMetadata(supabase, jobId, (meta) => ({
    ...meta,
    arlington: {
      ...(meta.arlington && typeof meta.arlington === "object"
        ? meta.arlington
        : {}),
      ...(phasePatch || {}),
      updatedAt: new Date().toISOString(),
    },
  }));
}

async function findActiveArlingtonJobForProject(supabase, projectId) {
  const { data, error } = await supabase
    .from("scrape_jobs")
    .select(
      "id, status, metadata, current_stage, current_user_message, last_activity_at, phase, checkpoint_version",
    )
    .eq("project_id", projectId)
    .in("status", [...ACTIVE_JOB_STATUSES])
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) throw error;
  return data?.[0] || null;
}

/**
 * Database-backed completion verification for Arlington Scrape All.
 * @param {object} opts
 */
async function verifyArlingtonJobCompletion(supabase, opts) {
  const {
    projectId,
    userId,
    permitNumber,
    requestedTabs = ["info", "attachments", "plan_review"],
  } = opts;

  const row = await readProjectPortalRow(supabase, projectId, userId, permitNumber);
  const portalData = row?.portal_data || {};
  const states = readArlingtonSectionStates(portalData);
  const tabs = portalData.tabs || {};

  const wantsAttachments = requestedTabs.includes("attachments");
  const wantsPlanReview = requestedTabs.includes("plan_review");
  const wantsInfo = requestedTabs.includes("info");

  const attachmentRows = tabs.attachments?.tables?.[0]?.rows || [];
  const attachmentsState =
    states.attachments ||
    tabs.attachments?.sectionState ||
    (wantsAttachments ? "not_started" : "complete");
  const attachmentsPending = arlingtonAttachmentPendingCount(attachmentRows);
  const attachmentsDownloaded = arlingtonAttachmentDownloadedCount(attachmentRows);

  const piState =
    states.projectInformation ||
    tabs.planReview?.tabs?.projectInformation?.sectionState ||
    (wantsPlanReview || wantsInfo ? "not_started" : "complete");
  const piFields = tabs.planReview?.tabs?.projectInformation?.fields || [];

  const prPending = countPlanReviewPendingDocuments(tabs.planReview);
  const planReviewState =
    states.planReview ||
    tabs.planReview?.sectionState ||
    (wantsPlanReview ? "not_started" : "complete");

  const blockers = [];
  if (wantsAttachments) {
    if (attachmentsState === "not_started") blockers.push("attachments_not_started");
    if (attachmentsState === "rate_limited") blockers.push("attachments_rate_limited");
    if (attachmentsState === "failed") blockers.push("attachments_failed");
    if (
      attachmentsState === "loading_metadata" ||
      attachmentsState === "downloading" ||
      attachmentsState === "partial"
    ) {
      blockers.push("attachments_in_progress");
    }
    if (attachmentsPending > 0 && attachmentsState !== "rate_limited") {
      blockers.push("attachments_pending");
    }
  }
  if (wantsPlanReview || wantsInfo) {
    if (piState === "weak_extraction") blockers.push("project_info_weak");
    if (piState === "failed") blockers.push("project_info_failed");
    if (piState === "loading") blockers.push("project_info_loading");
  }
  if (wantsPlanReview) {
    if (
      planReviewState === "loading_metadata" ||
      planReviewState === "downloading" ||
      planReviewState === "partial"
    ) {
      blockers.push("plan_review_in_progress");
    }
    if (planReviewState === "failed") blockers.push("plan_review_failed");
    if (prPending.total > 0) blockers.push("plan_review_pending");
  }

  let finalStatus = "complete";
  if (blockers.includes("attachments_rate_limited")) {
    finalStatus = "partial_rate_limited";
  } else if (blockers.includes("project_info_weak")) {
    finalStatus = "partial_project_info";
  } else if (blockers.length > 0) {
    finalStatus = "partial_external_blocker";
  }

  return {
    complete: blockers.length === 0,
    finalStatus,
    blockers,
    checkpointVersion: readCheckpointVersion(portalData),
    counts: {
      attachmentsDownloaded,
      attachmentsPending,
      planReviewPending: prPending.total,
      projectInfoFields: Array.isArray(piFields) ? piFields.length : 0,
    },
    states: {
      attachments: attachmentsState,
      projectInformation: piState,
      planReview: planReviewState,
    },
  };
}

function mapVerificationToSessionStatus(verification) {
  if (!verification || verification.complete) return "done";
  const fs = verification.finalStatus;
  if (fs === "partial_rate_limited") return "partial_success_attachments_pending";
  if (fs === "partial_project_info") return "partial_success_plan_review_pending";
  if (fs === "partial_external_blocker") {
    if (verification.blockers?.some((b) => b.startsWith("attachments"))) {
      return "partial_success_attachments_pending";
    }
    return "partial_success_plan_review_pending";
  }
  return "partial_success_plan_review_pending";
}

function buildProjectInfoDiagnostics({
  mode,
  frameUrl,
  dropdownValue,
  readinessSelectors,
  extractedKeys,
  fieldCount,
  missingRequiredFields,
  qualityScore,
  rejectionReason,
}) {
  return {
    mode: mode || "unknown",
    frameUrl: safeStr(frameUrl, 300) || null,
    dropdownValue: safeStr(dropdownValue, 200) || null,
    readinessSelectors: Array.isArray(readinessSelectors)
      ? readinessSelectors.slice(0, 20)
      : [],
    extractedKeys: Array.isArray(extractedKeys)
      ? extractedKeys.slice(0, 40)
      : [],
    fieldCount: Number(fieldCount) || 0,
    missingRequiredFields: Array.isArray(missingRequiredFields)
      ? missingRequiredFields.slice(0, 20)
      : [],
    qualityScore: Number.isFinite(Number(qualityScore))
      ? Number(qualityScore)
      : null,
    rejectionReason: safeStr(rejectionReason, 500) || null,
    recordedAt: new Date().toISOString(),
  };
}

function resolveDurableAutoContinueMaxCycles(session) {
  if (session?.arlingtonDurableMode === true) {
    return ARLINGTON_DURABLE_AUTO_CONTINUE_MAX_CYCLES;
  }
  const raw = Number(session?.arlingtonAutoContinueMaxCycles);
  if (Number.isFinite(raw) && raw > 0) return Math.min(Math.floor(raw), 32);
  return 8;
}

module.exports = {
  ARLINGTON_ATTACHMENTS_STATES,
  ARLINGTON_PROJECT_INFO_STATES,
  ARLINGTON_PLAN_REVIEW_STATES,
  ARLINGTON_DURABLE_AUTO_CONTINUE_MAX_CYCLES,
  ARLINGTON_JOB_LEASE_TTL_MS,
  ARLINGTON_RATE_LIMIT_BASE_MS,
  ACTIVE_JOB_STATUSES,
  TERMINAL_JOB_STATUSES,
  safeStr,
  newWorkerId,
  bumpCheckpointVersion,
  readCheckpointVersion,
  readArlingtonSectionStates,
  mergeArlingtonSectionStates,
  detectCloudflareRateLimit,
  computeRateLimitRetryAfterMs,
  formatRetryAfterIso,
  detectArlingtonRecordMode,
  arlingtonAttachmentDownloadedCount,
  arlingtonAttachmentPendingCount,
  countPlanReviewPendingDocuments,
  applyCheckpointVersionAndStates,
  readProjectPortalRow,
  claimArlingtonJobLease,
  refreshArlingtonJobLease,
  releaseArlingtonJobLease,
  updateArlingtonJobPhase,
  findActiveArlingtonJobForProject,
  verifyArlingtonJobCompletion,
  mapVerificationToSessionStatus,
  buildProjectInfoDiagnostics,
  resolveDurableAutoContinueMaxCycles,
};
