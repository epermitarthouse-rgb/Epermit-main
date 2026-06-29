"use strict";

const { normalizeArlingtonRequestedScope } = require("./arlington-scope-normalize.js");
const {
  arlingtonAttachmentPendingCount,
  arlingtonAttachmentDownloadedCount,
  analyzePlanReviewPendingDocuments,
  readArlingtonSectionStates,
  readCheckpointVersion,
} = require("./arlington-orchestration.js");

const SECTION_OUTCOMES = new Set([
  "not_requested",
  "pending",
  "running",
  "completed",
  "completed_empty",
  "completed_with_warnings",
  "metadata_only",
  "external_blocker",
  "failed_retryable",
  "failed_terminal",
  "rate_limited",
]);

/**
 * Deterministic Arlington completion evaluation from persisted portal_data only.
 * @param {object|null} job scrape_jobs row (optional; used for requested_scope)
 * @param {object|null|undefined} portalData projects.portal_data
 * @param {object|null|undefined} requestedScopeOverride
 */
function evaluateArlingtonJobCompletion(job, portalData, requestedScopeOverride) {
  const pd =
    portalData && typeof portalData === "object" && !Array.isArray(portalData)
      ? portalData
      : {};
  const scope = normalizeArlingtonRequestedScope(
    requestedScopeOverride || job?.requested_scope,
  );
  const tabs = pd.tabs && typeof pd.tabs === "object" ? pd.tabs : {};
  const states = readArlingtonSectionStates(pd);
  const warnings = [];

  const wantsInfo = scope.tabs.includes("info");
  const wantsAttachments = scope.tabs.includes("attachments");
  const wantsPlanReview = scope.tabs.includes("plan_review");

  const sections = {
    info: evaluateInfoSection(tabs, states, wantsInfo),
    attachments: evaluateAttachmentsSection(tabs, states, wantsAttachments),
    plan_set: { outcome: "not_requested", reason: "not_requested" },
    review_results: { outcome: "not_requested", reason: "not_requested" },
    approved_documents: { outcome: "not_requested", reason: "not_requested" },
    project_information: { outcome: "not_requested", reason: "not_requested" },
  };

  if (wantsPlanReview) {
    const prTab = tabs.planReview;
    const prTabs = prTab?.tabs && typeof prTab.tabs === "object" ? prTab.tabs : {};
    sections.project_information = evaluateProjectInformationSection(
      prTabs.projectInformation,
      states,
    );
    sections.plan_set = evaluatePlanReviewDocSection(
      prTabs?.plansAndDocuments?.sections?.planSetDocuments?.documents,
      "plan_set",
    );
    sections.review_results = evaluatePlanReviewDocSection(
      prTabs?.reviewResultsAndMarkups?.documents,
      "review_results",
    );
    sections.approved_documents = evaluatePlanReviewDocSection(
      prTabs?.approvedDocuments?.documents,
      "approved_documents",
    );
  }

  const blockers = [];
  const retryableSections = [];

  for (const [key, section] of Object.entries(sections)) {
    if (section.outcome === "not_requested") continue;
    if (
      section.outcome === "pending" ||
      section.outcome === "running" ||
      section.outcome === "failed_retryable" ||
      section.outcome === "rate_limited"
    ) {
      blockers.push(`${key}_${section.outcome}`);
      retryableSections.push(key);
    }
    if (section.outcome === "failed_terminal") {
      blockers.push(`${key}_failed_terminal`);
    }
    if (section.outcome === "completed_with_warnings") {
      warnings.push(`${key}_warnings`);
    }
  }

  const prAnalysis = wantsPlanReview
    ? analyzePlanReviewPendingDocuments(tabs.planReview)
    : {
        retryable: { total: 0 },
        metadataOnly: { total: 0, names: [] },
      };

  if (wantsPlanReview && prAnalysis.metadataOnly.total > 0) {
    const onlyMetadata =
      prAnalysis.retryable.total === 0 &&
      !retryableSections.some((s) =>
        ["plan_set", "review_results", "approved_documents"].includes(s),
      );
    if (onlyMetadata) {
      warnings.push("plan_review_metadata_only");
    }
  }

  const retryableWorkRemaining = retryableSections.length > 0;
  const complete = blockers.length === 0;

  let terminalStatus = null;
  if (complete) {
    terminalStatus =
      warnings.length > 0 ? "completed_with_warnings" : "completed";
  } else if (!retryableWorkRemaining) {
    terminalStatus = "partial_external_blocker";
  } else if (
    sections.attachments.outcome === "rate_limited" ||
    blockers.some((b) => b.includes("rate_limited"))
  ) {
    terminalStatus = null;
  }

  const attachmentRows = tabs.attachments?.tables?.[0]?.rows || [];

  return {
    complete,
    terminalStatus,
    reason: complete
      ? terminalStatus || "completed"
      : blockers[0] || "incomplete",
    sections,
    sectionOutcomes: Object.fromEntries(
      Object.entries(sections).map(([k, v]) => [k, v.outcome]),
    ),
    retryableWorkRemaining,
    warnings,
    blockers,
    retryPhase: retryableWorkRemaining
      ? resolveRetryPhaseFromSections(sections, scope)
      : null,
    counts: {
      attachmentsDownloaded: arlingtonAttachmentDownloadedCount(attachmentRows),
      attachmentsPending: arlingtonAttachmentPendingCount(attachmentRows),
      planReviewPending: prAnalysis.retryable.total,
      planReviewMetadataOnly: prAnalysis.metadataOnly.total,
      planReviewMetadataOnlyNames: prAnalysis.metadataOnly.names,
      projectInfoFields: Array.isArray(
        tabs.planReview?.tabs?.projectInformation?.fields,
      )
        ? tabs.planReview.tabs.projectInformation.fields.length
        : 0,
    },
    checkpointVersion: readCheckpointVersion(pd),
    requestedScope: scope,
  };
}

function evaluateInfoSection(tabs, states, wantsInfo) {
  if (!wantsInfo) {
    return { outcome: "not_requested", reason: "not_requested" };
  }
  const infoTab = tabs.info;
  const recordComplete = states.recordInfo === "complete";
  const hasFields =
    Array.isArray(infoTab?.fields) && infoTab.fields.length > 0;
  const hasTables =
    Array.isArray(infoTab?.tables) && infoTab.tables.length > 0;
  if (recordComplete || hasFields || hasTables) {
    return { outcome: "completed", reason: "persisted_info" };
  }
  return { outcome: "pending", reason: "info_missing" };
}

function evaluateAttachmentsSection(tabs, states, wantsAttachments) {
  if (!wantsAttachments) {
    return { outcome: "not_requested", reason: "not_requested" };
  }
  const rows = tabs.attachments?.tables?.[0]?.rows || [];
  const pending = arlingtonAttachmentPendingCount(rows);
  const downloaded = arlingtonAttachmentDownloadedCount(rows);
  const rawState = `${states.attachments || tabs.attachments?.sectionState || ""}`;

  if (rawState === "rate_limited") {
    return { outcome: "rate_limited", reason: "attachments_rate_limited" };
  }
  if (rawState === "failed") {
    return { outcome: "failed_terminal", reason: "attachments_failed" };
  }
  if (pending > 0) {
    return {
      outcome: "failed_retryable",
      reason: "attachments_pending",
      pending,
      downloaded,
    };
  }
  if (downloaded > 0 || rows.length === 0) {
    return {
      outcome: rows.length === 0 ? "completed_empty" : "completed",
      reason:
        rows.length === 0
          ? "attachments_empty_valid"
          : "attachments_all_uploaded",
      pending: 0,
      downloaded,
    };
  }
  if (
    rawState === "downloading" ||
    rawState === "loading_metadata" ||
    rawState === "partial"
  ) {
    return { outcome: "pending", reason: "attachments_in_progress" };
  }
  if (rawState === "complete") {
    return { outcome: "completed", reason: "attachments_complete_state" };
  }
  return { outcome: "pending", reason: "attachments_not_started" };
}

function evaluateProjectInformationSection(piSection, states) {
  const rawState = `${states.projectInformation || piSection?.sectionState || ""}`;
  const fields = Array.isArray(piSection?.fields) ? piSection.fields : [];
  const extractionStatus = `${piSection?.extractionStatus || ""}`.trim();

  if (rawState === "weak_extraction") {
    return {
      outcome: "completed_with_warnings",
      reason: "project_info_weak",
      fieldCount: fields.length,
    };
  }
  if (rawState === "failed") {
    return { outcome: "failed_terminal", reason: "project_info_failed" };
  }
  if (fields.length > 0 || extractionStatus === "ok") {
    return {
      outcome: "completed",
      reason: "project_info_persisted",
      fieldCount: fields.length,
    };
  }
  if (rawState === "loading") {
    return { outcome: "running", reason: "project_info_loading" };
  }
  return { outcome: "pending", reason: "project_info_missing" };
}

function evaluatePlanReviewDocSection(documents, sectionKey) {
  const docs = Array.isArray(documents) ? documents : [];
  if (docs.length === 0) {
    return {
      outcome: "completed_empty",
      reason: `${sectionKey}_empty_valid`,
      total: 0,
      retryable: 0,
      metadataOnly: 0,
    };
  }

  let retryable = 0;
  let metadataOnly = 0;
  let uploaded = 0;
  for (const doc of docs) {
    if (!doc || typeof doc !== "object") continue;
    const ds = `${doc.downloadStatus || ""}`.trim();
    if (ds === "metadata_only") {
      metadataOnly += 1;
      continue;
    }
    if (ds === "failed_non_retryable") continue;
    const url = `${doc.publicUrl || doc.viewUrl || doc.storagePath || ""}`.trim();
    if (
      ds === "uploaded" ||
      ds === "success" ||
      /^https?:\/\//i.test(url) ||
      url.startsWith("projects/") ||
      url.startsWith("drawings/")
    ) {
      uploaded += 1;
      continue;
    }
    retryable += 1;
  }

  if (retryable > 0) {
    return {
      outcome: "failed_retryable",
      reason: `${sectionKey}_pending`,
      total: docs.length,
      retryable,
      metadataOnly,
      uploaded,
    };
  }
  if (metadataOnly > 0 && uploaded === 0 && docs.length === metadataOnly) {
    return {
      outcome: "metadata_only",
      reason: `${sectionKey}_metadata_only`,
      total: docs.length,
      metadataOnly,
    };
  }
  return {
    outcome: uploaded > 0 ? "completed" : "completed_empty",
    reason: `${sectionKey}_done`,
    total: docs.length,
    uploaded,
    metadataOnly,
  };
}

function resolveRetryPhaseFromSections(sections, scope) {
  if (sections.attachments.outcome === "rate_limited") return "attachments";
  if (
    sections.attachments.outcome === "failed_retryable" ||
    sections.attachments.outcome === "pending" ||
    sections.attachments.outcome === "running"
  ) {
    return "attachments";
  }
  if (
    sections.project_information.outcome === "pending" ||
    sections.project_information.outcome === "running"
  ) {
    return "project_information";
  }
  const prRetryable = ["plan_set", "review_results", "approved_documents"].some(
    (k) =>
      sections[k].outcome === "failed_retryable" ||
      sections[k].outcome === "pending" ||
      sections[k].outcome === "running",
  );
  if (prRetryable || scope.tabs.includes("plan_review")) {
    return "plan_review";
  }
  return "attachments";
}

function computeVerifyFingerprint(evaluation) {
  const e = evaluation && typeof evaluation === "object" ? evaluation : {};
  return JSON.stringify({
    scope: e.requestedScope || null,
    sectionOutcomes: e.sectionOutcomes || {},
    attachmentsPending: Number(e.counts?.attachmentsPending) || 0,
    planReviewPending: Number(e.counts?.planReviewPending) || 0,
    planReviewMetadataOnly: Number(e.counts?.planReviewMetadataOnly) || 0,
    complete: Boolean(e.complete),
    retryable: Boolean(e.retryableWorkRemaining),
  });
}

function mapEvaluationToLegacyVerification(evaluation) {
  const e = evaluation || {};
  const legacyBlockers = [...(e.blockers || [])];

  if ((e.counts?.attachmentsPending || 0) > 0) {
    legacyBlockers.push("attachments_pending");
  }
  if ((e.counts?.planReviewPending || 0) > 0) {
    legacyBlockers.push("plan_review_pending");
  }
  if (e.sections?.attachments?.outcome === "rate_limited") {
    legacyBlockers.push("attachments_rate_limited");
  }

  const metadataOnlyTerminal =
    (e.warnings || []).includes("plan_review_metadata_only") &&
    !e.retryableWorkRemaining;

  if (metadataOnlyTerminal) {
    legacyBlockers.push("plan_review_metadata_only");
    return {
      complete: false,
      finalStatus: "partial_external_blocker",
      blockers: [...new Set(legacyBlockers)],
      hasRetryableWork: false,
      terminalPartial: true,
      retryPhase: null,
      checkpointVersion: e.checkpointVersion || 0,
      counts: e.counts || {},
      states: {
        attachments: mapSectionOutcomeToJobState(e.sections?.attachments),
        projectInformation: mapSectionOutcomeToJobState(e.sections?.project_information),
        planReview: mapPlanReviewAggregateState(e.sections, e.requestedScope),
      },
      evaluation: e,
      sectionOutcomes: e.sectionOutcomes || {},
      warnings: e.warnings || [],
    };
  }

  if (e.warnings?.includes("plan_review_metadata_only") && e.complete) {
    legacyBlockers.push("plan_review_metadata_only");
  }

  let finalStatus = "complete";
  if (e.complete) {
    finalStatus =
      e.terminalStatus === "completed_with_warnings"
        ? "complete_with_warnings"
        : "complete";
  } else if (
    e.sections?.attachments?.outcome === "rate_limited" ||
    legacyBlockers.some((b) => b.includes("rate_limited"))
  ) {
    finalStatus = "partial_rate_limited";
  } else if (e.sections?.project_information?.outcome === "completed_with_warnings") {
    finalStatus = "partial_project_info";
    legacyBlockers.push("project_info_weak");
  } else if (
    e.warnings?.includes("plan_review_metadata_only") &&
    !e.retryableWorkRemaining
  ) {
    finalStatus = "partial_external_blocker";
    legacyBlockers.push("plan_review_metadata_only");
  } else if (!e.retryableWorkRemaining) {
    finalStatus = "partial_external_blocker";
  } else {
    finalStatus = "partial_incomplete";
  }

  const states = {
    attachments: mapSectionOutcomeToJobState(e.sections?.attachments),
    projectInformation: mapSectionOutcomeToJobState(e.sections?.project_information),
    planReview: mapPlanReviewAggregateState(e.sections, e.requestedScope),
  };

  return {
    complete: Boolean(e.complete),
    finalStatus,
    blockers: legacyBlockers,
    hasRetryableWork: Boolean(e.retryableWorkRemaining),
    terminalPartial: Boolean(!e.complete && !e.retryableWorkRemaining),
    retryPhase: e.retryPhase || null,
    checkpointVersion: e.checkpointVersion || 0,
    counts: e.counts || {},
    states,
    evaluation: e,
    sectionOutcomes: e.sectionOutcomes || {},
    warnings: e.warnings || [],
  };
}

function mapSectionOutcomeToJobState(section) {
  const outcome = section?.outcome || "not_requested";
  switch (outcome) {
    case "completed":
    case "completed_empty":
    case "metadata_only":
      return "complete";
    case "completed_with_warnings":
      return "weak_extraction";
    case "rate_limited":
      return "rate_limited";
    case "failed_retryable":
    case "pending":
    case "running":
      return "partial";
    case "failed_terminal":
      return "failed";
    default:
      return "not_started";
  }
}

function mapPlanReviewAggregateState(sections, scope) {
  if (!scope?.tabs?.includes("plan_review")) return "complete";
  const keys = ["plan_set", "review_results", "approved_documents", "project_information"];
  let worst = "complete";
  for (const key of keys) {
    const outcome = sections?.[key]?.outcome || "not_requested";
    if (outcome === "not_requested") continue;
    if (outcome === "failed_retryable" || outcome === "pending" || outcome === "running") {
      return "partial";
    }
    if (outcome === "failed_terminal") return "failed";
    if (outcome === "rate_limited") return "rate_limited";
  }
  return worst;
}

function logVerifyDiagnostics(job, verification, extra = {}) {
  const ev = verification?.evaluation || {};
  console.log(
    JSON.stringify({
      scope: "arlington_verify",
      jobId: job?.id || null,
      permitNumber: job?.permit_number || null,
      requestedTabs: ev.requestedScope?.tabs || job?.requested_scope?.tabs || null,
      requestedPlanReviewScope:
        ev.requestedScope?.planReviewScope ||
        job?.requested_scope?.planReviewScope ||
        null,
      phase: job?.phase || null,
      status: job?.status || null,
      completedAt: job?.completed_at || null,
      terminalReason: job?.metadata?.arlington?.terminalReason || null,
      sections: ev.sections || verification?.sectionOutcomes || null,
      counts: verification?.counts || ev.counts || null,
      complete: verification?.complete,
      completeFalseReason: verification?.complete
        ? null
        : verification?.blockers?.join(",") || verification?.finalStatus,
      requeueReason: extra.requeueReason || null,
      nextAttemptAt: extra.nextAttemptAt || null,
      releaseOutcome: extra.releaseOutcome || null,
      retryPhase: verification?.retryPhase || null,
      verifyFingerprint: extra.verifyFingerprint || null,
      verifyAttemptCount: extra.verifyAttemptCount ?? null,
    }),
  );
}

module.exports = {
  SECTION_OUTCOMES,
  evaluateArlingtonJobCompletion,
  computeVerifyFingerprint,
  mapEvaluationToLegacyVerification,
  resolveRetryPhaseFromSections,
  logVerifyDiagnostics,
};
