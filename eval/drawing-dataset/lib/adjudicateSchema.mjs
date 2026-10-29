/**
 * Phase 2A.6 adjudication schema.
 * Three independent dimensions; reviewer outcomes never auto-filled from AI.
 */

export const ADJUDICATION_VERSION = "phase2a6.adjudication.v1";

/** Finding-level validity outcomes (professional review only). */
export const FINDING_VALIDITY_OUTCOMES = [
  "confirmed_valid",
  "false_positive",
  "needs_more_evidence",
  "not_applicable",
  "deferred",
  "not_reviewed",
];

/** Evidence grounding dimension (separate from technical correctness). */
export const EVIDENCE_GROUNDING_OUTCOMES = [
  "evidence_present",
  "evidence_partial",
  "evidence_absent",
  "evidence_misleading",
  "not_reviewed",
];

/** Technical correctness of the finding conclusion given the drawing. */
export const TECHNICAL_CORRECTNESS_OUTCOMES = [
  "technically_correct",
  "technically_incorrect",
  "technically_uncertain",
  "not_reviewed",
];

export const QUEUE_BANDS = [
  "critical",
  "contradicted_candidate",
  "insufficient_evidence",
  "unresolved",
  "evidence_retrieved",
  "remainder",
];

export const EMPTY_DIMENSIONS = Object.freeze({
  evidenceGrounding: {
    outcome: "not_reviewed",
    justification: null,
    professionallyVerified: false,
  },
  technicalCorrectness: {
    outcome: "not_reviewed",
    justification: null,
    professionallyVerified: false,
    note: "Evidence presence does not imply technical correctness (see C-002).",
  },
  findingValidity: {
    outcome: "not_reviewed",
    justification: null,
    professionallyVerified: false,
  },
});

export function emptyReviewState() {
  return {
    status: "pending",
    reviewerId: null,
    reviewerRole: null,
    reviewedAt: null,
    dimensions: structuredClone(EMPTY_DIMENSIONS),
    overallOutcome: "not_reviewed",
    justification: null,
    codeReferencesChecked: [],
    professionallyVerified: false,
    contributesToMetrics: false,
    audit: [],
  };
}

export function assertOutcome(value, allowed, field) {
  if (!allowed.includes(value)) {
    throw new Error(`Invalid ${field}: ${value}. Allowed: ${allowed.join(", ")}`);
  }
}

/**
 * Apply a human adjudication decision. Never sets professionallyVerified unless requested explicitly
 * by an authorized review payload with reviewerId.
 */
export function applyAdjudicationDecision(record, decision, options = {}) {
  const now = options.now || new Date().toISOString();
  if (!decision?.reviewerId) {
    throw new Error("reviewerId is required for adjudication decisions.");
  }
  assertOutcome(decision.overallOutcome, FINDING_VALIDITY_OUTCOMES.filter((x) => x !== "not_reviewed").concat(["not_reviewed"]), "overallOutcome");
  if (decision.dimensions?.evidenceGrounding?.outcome) {
    assertOutcome(decision.dimensions.evidenceGrounding.outcome, EVIDENCE_GROUNDING_OUTCOMES, "evidenceGrounding.outcome");
  }
  if (decision.dimensions?.technicalCorrectness?.outcome) {
    assertOutcome(decision.dimensions.technicalCorrectness.outcome, TECHNICAL_CORRECTNESS_OUTCOMES, "technicalCorrectness.outcome");
  }
  if (decision.dimensions?.findingValidity?.outcome) {
    assertOutcome(decision.dimensions.findingValidity.outcome, FINDING_VALIDITY_OUTCOMES, "findingValidity.outcome");
  }

  const authorizeMetrics = Boolean(decision.authorizeMetricsContribution)
    && Boolean(decision.professionallyVerified)
    && Boolean(decision.reviewerId)
    && decision.overallOutcome !== "not_reviewed"
    && decision.overallOutcome !== "deferred";

  if (decision.professionallyVerified && !decision.authorizeMetricsContribution) {
    throw new Error("professionallyVerified requires authorizeMetricsContribution: true from an authorized reviewer.");
  }

  const previous = {
    status: record.review?.status || null,
    overallOutcome: record.review?.overallOutcome || null,
    professionallyVerified: record.review?.professionallyVerified || false,
  };

  const nextReview = {
    ...(record.review || emptyReviewState()),
    status: decision.overallOutcome === "deferred" || decision.overallOutcome === "not_reviewed" ? "pending" : "adjudicated",
    reviewerId: decision.reviewerId,
    reviewerRole: decision.reviewerRole || null,
    reviewedAt: now,
    dimensions: {
      evidenceGrounding: {
        ...EMPTY_DIMENSIONS.evidenceGrounding,
        ...(record.review?.dimensions?.evidenceGrounding || {}),
        ...(decision.dimensions?.evidenceGrounding || {}),
        professionallyVerified: authorizeMetrics,
      },
      technicalCorrectness: {
        ...EMPTY_DIMENSIONS.technicalCorrectness,
        ...(record.review?.dimensions?.technicalCorrectness || {}),
        ...(decision.dimensions?.technicalCorrectness || {}),
        professionallyVerified: authorizeMetrics,
      },
      findingValidity: {
        ...EMPTY_DIMENSIONS.findingValidity,
        ...(record.review?.dimensions?.findingValidity || {}),
        ...(decision.dimensions?.findingValidity || { outcome: decision.overallOutcome }),
        professionallyVerified: authorizeMetrics,
      },
    },
    overallOutcome: decision.overallOutcome,
    justification: decision.justification || null,
    codeReferencesChecked: decision.codeReferencesChecked || [],
    professionallyVerified: authorizeMetrics,
    contributesToMetrics: authorizeMetrics,
  };

  nextReview.audit = [
    ...(record.review?.audit || []),
    {
      at: now,
      reviewerId: decision.reviewerId,
      action: "adjudicate",
      previous,
      next: {
        status: nextReview.status,
        overallOutcome: nextReview.overallOutcome,
        professionallyVerified: nextReview.professionallyVerified,
        contributesToMetrics: nextReview.contributesToMetrics,
      },
      justification: decision.justification || null,
    },
  ];

  return {
    ...record,
    review: nextReview,
  };
}

export function metricsFromReviews(records) {
  const verified = (records || []).filter((row) => row.review?.contributesToMetrics && row.review?.professionallyVerified);
  if (!verified.length) {
    return {
      precision: "Not measured",
      recall: "Not measured",
      falsePositiveRate: "Not measured",
      falseNegativeRate: "Not measured",
      verifiedCount: 0,
      pendingCount: (records || []).filter((row) => !row.review?.professionallyVerified).length,
      note: "No authorized professionally verified adjudications yet.",
    };
  }
  const tp = verified.filter((row) => row.review.overallOutcome === "confirmed_valid").length;
  const fp = verified.filter((row) => row.review.overallOutcome === "false_positive").length;
  const denom = tp + fp;
  return {
    precision: denom ? tp / denom : "Not measured",
    recall: "Not measured",
    falsePositiveRate: denom ? fp / denom : "Not measured",
    falseNegativeRate: "Not measured",
    verifiedCount: verified.length,
    pendingCount: (records || []).length - verified.length,
    note: "Recall/FN require independent missed-issue review coverage; not computed from finding adjudications alone.",
  };
}
