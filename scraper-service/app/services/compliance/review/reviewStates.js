"use strict";

const REVIEW_STATES = Object.freeze({
  reviewedClear: "reviewed_clear",
  reviewedFindings: "reviewed_findings",
  reviewedPartial: "reviewed_partial",
  failed: "failed",
  notReviewed: "not_reviewed",
});

/**
 * Historical rows used "passed" for an evidence-backed clear review.
 * New writes use reviewed_clear. Readers accept both.
 * @param {string | null | undefined} state
 */
function hydrateStoredReviewState(state) {
  if (state === "passed" || state === REVIEW_STATES.reviewedClear) {
    return {
      reviewState: state === "passed" ? "passed" : REVIEW_STATES.reviewedClear,
      canonical: REVIEW_STATES.reviewedClear,
      legacy: state === "passed",
      scoredClear: true,
    };
  }
  if (state === REVIEW_STATES.notReviewed) {
    return { reviewState: REVIEW_STATES.notReviewed, canonical: REVIEW_STATES.notReviewed, legacy: true, scoredClear: false };
  }
  if (state === REVIEW_STATES.failed) {
    return { reviewState: REVIEW_STATES.failed, canonical: REVIEW_STATES.failed, legacy: false, scoredClear: false };
  }
  if (state === REVIEW_STATES.reviewedPartial) {
    return { reviewState: REVIEW_STATES.reviewedPartial, canonical: REVIEW_STATES.reviewedPartial, legacy: false, scoredClear: false };
  }
  if (state === REVIEW_STATES.reviewedFindings) {
    return { reviewState: REVIEW_STATES.reviewedFindings, canonical: REVIEW_STATES.reviewedFindings, legacy: false, scoredClear: false };
  }
  return { reviewState: state || null, canonical: state || null, legacy: false, scoredClear: false };
}

/**
 * @param {{
 *   callStatus?: "completed" | "failed" | "not_run";
 *   confirmedCount: number;
 *   openQuestionCount: number;
 *   evidenceBacked: boolean;
 *   codeCoverageVerified?: boolean;
 *   unresolvedLimitationCount?: number;
 * }} input
 */
function resolveReviewState(input) {
  const callStatus = input.callStatus || "completed";
  if (callStatus === "not_run") {
    return { reviewState: REVIEW_STATES.notReviewed, overallScore: null, scored: false };
  }
  if (callStatus === "failed") {
    return { reviewState: REVIEW_STATES.failed, overallScore: null, scored: false };
  }
  if (input.confirmedCount > 0) {
    return { reviewState: REVIEW_STATES.reviewedFindings, overallScore: null, scored: true };
  }
  // Clear means every completed check was evidence-backed and no substantive check
  // was left open. It is scored (a verified pass) only when an authoritative
  // requirement was matched; otherwise the score stays null.
  if (input.evidenceBacked && input.openQuestionCount === 0 && !input.unresolvedLimitationCount) {
    return input.codeCoverageVerified
      ? { reviewState: REVIEW_STATES.reviewedClear, overallScore: 100, scored: true }
      : { reviewState: REVIEW_STATES.reviewedClear, overallScore: null, scored: false };
  }
  return { reviewState: REVIEW_STATES.reviewedPartial, overallScore: null, scored: false };
}

/**
 * Presentation outcome. Stored review states stay unchanged for compatibility.
 * @param {{ reviewState?: string | null; totalIssues?: number; codeCoverageVerified?: boolean; notApplicable?: boolean; limitations?: Array<{ code?: string }> }} summary
 */
function reviewOutcome(summary) {
  const state = summary?.reviewState || null;
  if (state === REVIEW_STATES.failed) return "failed";
  if ((summary?.totalIssues || 0) > 0) return "potential_issue";
  if (summary?.notApplicable === true) return "not_applicable";
  if (!state || state === REVIEW_STATES.notReviewed) return "not_reviewed";
  if ((summary?.limitations || []).some((item) => item?.code === "open_check")) return "verification_incomplete";
  if ((state === REVIEW_STATES.reviewedClear || state === "passed") && summary?.codeCoverageVerified === true) {
    return "verified_compliant";
  }
  return "no_findings_unverified";
}

/**
 * Four separate dimensions of one sheet review.
 * @param {{ reviewState?: string | null; totalIssues?: number; codeCoverageVerified?: boolean; limitations?: Array<{ code?: string }> }} summary
 */
function reviewAssessment(summary) {
  const codes = new Set((summary?.limitations || []).map((item) => item?.code));
  const state = summary?.reviewState || null;
  const ran = Boolean(state) && state !== REVIEW_STATES.notReviewed && state !== REVIEW_STATES.failed;
  return {
    drawingEvidence: !ran
      ? "not_assessed"
      : codes.has("no_checks_returned")
        ? "no_checks"
        : codes.has("checks_not_evidence_backed")
          ? "partly_evidence_backed"
          : "evidence_backed",
    technicalRequirements: !ran
      ? "not_assessed"
      : (summary?.totalIssues || 0) > 0
        ? "concerns_identified"
        : codes.has("open_check")
          ? "checks_unresolved"
          : "no_concerns_identified",
    codeVerification: summary?.codeCoverageVerified === true ? "verified" : "unverified",
    applicability: codes.has("reference_only_scope") ? "reference_only" : "permit_compliance",
  };
}

module.exports = {
  REVIEW_STATES,
  hydrateStoredReviewState,
  resolveReviewState,
  reviewOutcome,
  reviewAssessment,
};
