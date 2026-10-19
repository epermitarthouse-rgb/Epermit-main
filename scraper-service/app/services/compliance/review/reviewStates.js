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
  // A quoted drawing label shows the element is present. It proves compliance
  // only when an authoritative requirement for that element was verified.
  if (
    input.evidenceBacked &&
    input.openQuestionCount === 0 &&
    input.codeCoverageVerified &&
    !input.unresolvedLimitationCount
  ) {
    return { reviewState: REVIEW_STATES.reviewedClear, overallScore: 100, scored: true };
  }
  return { reviewState: REVIEW_STATES.reviewedPartial, overallScore: null, scored: false };
}

/**
 * Presentation outcome. Stored review states stay unchanged for compatibility.
 * @param {{ reviewState?: string | null; totalIssues?: number; codeCoverageVerified?: boolean; notApplicable?: boolean }} summary
 */
function reviewOutcome(summary) {
  const state = summary?.reviewState || null;
  if (state === REVIEW_STATES.failed) return "failed";
  if ((summary?.totalIssues || 0) > 0) return "potential_issue";
  if (summary?.notApplicable === true) return "not_applicable";
  if (!state || state === REVIEW_STATES.notReviewed) return "not_reviewed";
  if ((state === REVIEW_STATES.reviewedClear || state === "passed") && summary?.codeCoverageVerified === true) {
    return "verified_compliant";
  }
  return "insufficient_evidence";
}

module.exports = {
  REVIEW_STATES,
  hydrateStoredReviewState,
  resolveReviewState,
  reviewOutcome,
};
