"use strict";

const orchestration = require("./arlington-orchestration.js");

const TERMINAL_STATUSES = new Set([
  "completed",
  "completed_with_warnings",
  "partial_external_blocker",
]);

const TERMINAL_FULL_PROGRESS_STATUSES = new Set([
  "completed",
  "completed_with_warnings",
  "partial_external_blocker",
]);

function attachmentRows(portalData) {
  const tabs = portalData?.tabs;
  const att = tabs?.attachments;
  const rows = att?.tables?.[0]?.rows;
  return Array.isArray(rows) ? rows : [];
}

function planReviewRoot(portalData) {
  const pr = portalData?.tabs?.planReview;
  if (!pr || typeof pr !== "object") return null;
  return pr.tabs && typeof pr.tabs === "object" ? pr.tabs : pr;
}

function planReviewDocuments(portalData, section) {
  const root = planReviewRoot(portalData);
  if (!root) return [];
  if (section === "planSet") {
    return root.plansAndDocuments?.sections?.planSetDocuments?.documents;
  }
  if (section === "reviewResults") {
    return root.reviewResultsAndMarkups?.documents;
  }
  if (section === "approved") {
    return root.approvedDocuments?.documents;
  }
  return [];
}

function countDownloadedPlanReviewDocs(docs) {
  if (!Array.isArray(docs)) return 0;
  return docs.filter((doc) => {
    if (!doc || typeof doc !== "object") return false;
    const url = `${doc.publicUrl || doc.viewUrl || doc.storagePath || ""}`.trim();
    const ds = `${doc.downloadStatus || ""}`.trim();
    return (
      /^https?:\/\//i.test(url) ||
      url.startsWith("projects/") ||
      ds === "uploaded" ||
      ds === "success"
    );
  }).length;
}

function sectionStateComplete(state) {
  const s = `${state || ""}`.trim().toLowerCase();
  return s === "complete" || s === "completed" || s === "completed_with_warnings";
}

function phaseIndex(phase) {
  const order = [
    "record_info",
    "attachments",
    "project_information",
    "plan_review",
    "verify",
    "complete",
  ];
  const idx = order.indexOf(`${phase || ""}`.trim());
  return idx >= 0 ? idx : 0;
}

function isPhasePast(jobPhase, targetPhase) {
  return phaseIndex(jobPhase) > phaseIndex(targetPhase);
}

function isPhaseAtOrPast(jobPhase, targetPhase) {
  return phaseIndex(jobPhase) >= phaseIndex(targetPhase);
}

/**
 * Deterministic durable progress from requested scope + persisted portal_data + job phase.
 * Monotonic: never decreases current/total vs prior job row (or explicit priorProgress).
 */
function computeArlingtonDurableProgress(job, portalData, requestedScope, opts = {}) {
  const scope = requestedScope || job?.requested_scope || {};
  const tabs = Array.isArray(scope.tabs) ? scope.tabs : ["info", "attachments", "plan_review"];
  const tabSet = new Set(tabs);
  const pd = portalData && typeof portalData === "object" ? portalData : {};
  const jobPhase = `${opts.phase || job?.phase || "record_info"}`.trim();
  const jobStatus = `${opts.status || job?.status || "running"}`.trim();
  const sectionStates = orchestration.readArlingtonSectionStates(pd);

  let total = 0;
  let current = 0;

  if (tabSet.has("info")) {
    total += 1;
    if (
      sectionStateComplete(sectionStates.recordInfo) ||
      isPhasePast(jobPhase, "record_info")
    ) {
      current += 1;
    }
  }

  if (tabSet.has("attachments")) {
    const rows = attachmentRows(pd);
    const rowTotal = Math.max(rows.length, isPhaseAtOrPast(jobPhase, "attachments") ? 1 : 0);
    total += rowTotal;
    current += Math.min(
      rowTotal,
      orchestration.arlingtonAttachmentDownloadedCount(rows),
    );
  }

  if (tabSet.has("info")) {
    total += 1;
    if (
      sectionStateComplete(job?.project_info_state) ||
      sectionStateComplete(sectionStates.projectInformation) ||
      isPhasePast(jobPhase, "project_information")
    ) {
      current += 1;
    }
  }

  if (tabSet.has("plan_review")) {
    const prScope = `${scope.planReviewScope || "all"}`.trim();
    const sections =
      prScope === "plan_set"
        ? ["planSet"]
        : prScope === "review_results"
          ? ["reviewResults"]
          : prScope === "approved"
            ? ["approved"]
            : ["planSet", "reviewResults", "approved"];

    for (const section of sections) {
      const docs = planReviewDocuments(pd, section);
      const docTotal = Math.max(
        docs.length,
        isPhaseAtOrPast(jobPhase, "plan_review") ? 1 : 0,
      );
      total += docTotal;
      current += Math.min(docTotal, countDownloadedPlanReviewDocs(docs));
    }
  }

  total += 1;
  if (TERMINAL_STATUSES.has(jobStatus) || jobPhase === "complete") {
    current += 1;
  }

  const priorTotal = Math.max(
    Number(opts.priorTotal ?? job?.progress_total) || 0,
    Number(job?.metadata?.arlington?.progressTotal) || 0,
  );
  const priorCurrent = Math.max(
    Number(opts.priorCurrent ?? job?.progress_current) || 0,
    Number(job?.metadata?.arlington?.progressCurrent) || 0,
  );

  let nextTotal = Math.max(priorTotal, total, 1);
  let nextCurrent = Math.max(priorCurrent, Math.min(current, nextTotal));

  if (
    opts.terminal === true ||
    TERMINAL_FULL_PROGRESS_STATUSES.has(jobStatus)
  ) {
    nextTotal = Math.max(nextTotal, nextCurrent, 1);
    nextCurrent = nextTotal;
  }

  return {
    current: nextCurrent,
    total: nextTotal,
  };
}

const PHASE_USER_MESSAGES = Object.freeze({
  record_info: {
    start: "Opening record information.",
    complete: "Record information saved.",
  },
  attachments: {
    start: "Downloading attachments from the portal.",
    complete: "Attachments checkpoint saved.",
  },
  project_information: {
    start: "Opening Project Information.",
    complete: "Project Information saved.",
  },
  plan_review: {
    start: "Downloading plan review documents.",
    complete: "Plan review checkpoint saved.",
  },
  verify: {
    start: "Verifying scrape completion.",
    complete: "Verification complete.",
  },
});

function phaseUserMessage(phase, kind = "start") {
  const entry = PHASE_USER_MESSAGES[`${phase || ""}`.trim()];
  if (!entry) return kind === "complete" ? "Checkpoint saved." : "Working…";
  return entry[kind] || entry.start;
}

module.exports = {
  TERMINAL_STATUSES,
  computeArlingtonDurableProgress,
  phaseUserMessage,
  attachmentRows,
  planReviewDocuments,
  countDownloadedPlanReviewDocs,
};
