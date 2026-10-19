export type ReviewStateName =
  | "not_reviewed"
  | "passed"
  | "reviewed_clear"
  | "reviewed_findings"
  | "reviewed_partial"
  | "failed"
  | null;

export type ReviewIssueLike = {
  title?: string;
  findingType?: string | null;
  validationDisposition?: string | null;
  validationReason?: string | null;
  sheetFileName?: string | null;
  location?: string | null;
  codeReference?: string | null;
};

export type ReviewLimitation = { code: string; detail: string };

export type ReviewMetadataLike = {
  summary?: {
    reviewState?: string | null;
    overallScore?: number | null;
    checklist?: string[];
    cleanChecks?: string[];
    codeCoverageVerified?: boolean;
    limitations?: ReviewLimitation[] | null;
    notApplicable?: boolean;
  } | null;
  jurisdictionScope?: {
    selectedScope?: string | null;
    detectedLocation?: string | null;
    enforcedJurisdiction?: string | null;
    amendmentsEnforced?: boolean;
    selectionSource?: string | null;
    disclosed?: boolean;
  } | null;
  jurisdictionDiagnostics?: {
    message?: string | null;
    detectedLocation?: string | null;
    selectedScope?: string | null;
    amendmentsEnforced?: boolean;
  } | null;
  userEmphasis?: string | null;
  sheet_file_name?: string | null;
  file_name?: string | null;
  disciplines?: string[] | null;
  observations?: Array<{ element?: string; quote?: string; fileName?: string | null; region?: unknown }>;
  retrievalHits?: Array<{
    questionId?: string;
    drawing?: Array<{ fileName?: string | null; quote?: string | null; pageNumber?: number | null; region?: unknown }>;
  }>;
  rejectedCandidates?: Array<{ validationReason?: string; validationDetail?: string; title?: string }>;
  legalApplicability?: {
    status?: string | null;
    reviewScope?: string | null;
    selectedEdition?: string | null;
    adoptedEdition?: string | null;
    adoptedBaseCode?: string | null;
    officialSourceUrl?: string | null;
    verificationDate?: string | null;
    sourceStatus?: string | null;
    warning?: string | null;
    unresolvedReasons?: string[] | null;
  } | null;
  codeCoverage?: {
    status?: string | null;
    authoritativeProvisionCount?: number | null;
    enforceableProvisionCount?: number | null;
    registrySource?: string | null;
  } | null;
};

export type ReviewReportView = {
  selectedScope: string;
  detectedLocation: string;
  amendmentsEnforced: boolean;
  disclosure: string | null;
  userEmphasis: string | null;
  documentsReviewed: string[];
  disciplines: string[];
  confirmedFindings: ReviewIssueLike[];
  verificationQuestions: ReviewIssueLike[];
  cleanChecks: string[];
  /** Why code compliance is unverified (scope, code source, evidence coverage). */
  unreviewable: string[];
  /** Specific substantive checks the review could not resolve. */
  unresolvedChecks: string[];
  /** Why the review is not a verified pass. Empty only for a verified compliant review. */
  limitations: ReviewLimitation[];
  evidence: Array<{ where: string; quote: string; hasRegion: boolean }>;
  withheldReasons: string[];
  legalApplicability: NonNullable<ReviewMetadataLike["legalApplicability"]> | null;
  codeCoverage: NonNullable<ReviewMetadataLike["codeCoverage"]> | null;
};

export type ReviewEvidenceStripSummary = {
  sourceFileName: string;
  codeLabel: string;
  jurisdictionLabel: string;
  reviewStateLabel: string;
  countLabel: string;
};

const CONFIRMED = new Set(["confirmed_violation"]);
const QUESTION = new Set(["missing_information", "unverified", "potential_concern"]);

export function reviewStateLabel(state: string | null | undefined, score: number | null | undefined): string {
  if (state === "failed") return "Failed";
  if (state === "reviewed_partial") return "Partial";
  if (state === "not_reviewed") return "Not reviewed";
  if (state === "reviewed_clear") return typeof score === "number" ? `${score}%` : "Clear";
  if (state === "passed") return typeof score === "number" ? `${score}%` : "Passed";
  if (state === "reviewed_findings") return typeof score === "number" ? `${score}%` : "Findings";
  if (typeof score === "number") return `${score}%`;
  return "Not reviewed";
}

export type ReviewOutcomeName =
  | "verified_compliant"
  | "potential_issue"
  | "verification_incomplete"
  | "no_findings_unverified"
  | "not_applicable"
  | "not_reviewed"
  | "failed";

export type ReviewOutcomeSummary = {
  reviewState?: string | null;
  overallScore?: number | null;
  totalIssues?: number;
  codeCoverageVerified?: boolean;
  notApplicable?: boolean;
  limitations?: ReviewLimitation[] | null;
};

/** Limitations that name a specific substantive check the review could not resolve. */
const UNRESOLVED_CHECK_CODES = new Set(["open_check"]);

export function isUnresolvedCheck(item: ReviewLimitation | null | undefined): boolean {
  return UNRESOLVED_CHECK_CODES.has(String(item?.code || ""));
}

/**
 * Presentation outcome over the stored review state.
 * Zero findings is never a pass: compliance is verified only when an authoritative
 * requirement and the drawing evidence were both confirmed (codeCoverageVerified).
 */
export function reviewOutcome(summary: ReviewOutcomeSummary | null | undefined): ReviewOutcomeName {
  const state = summary?.reviewState ?? null;
  if (state === "failed") return "failed";
  if ((summary?.totalIssues ?? 0) > 0) return "potential_issue";
  if (summary?.notApplicable === true) return "not_applicable";
  if (!state || state === "not_reviewed") return "not_reviewed";
  if ((summary?.limitations ?? []).some(isUnresolvedCheck)) return "verification_incomplete";
  if ((state === "reviewed_clear" || state === "passed") && summary?.codeCoverageVerified === true) {
    return "verified_compliant";
  }
  return "no_findings_unverified";
}

/** Header and export text. Missing scores stay words, never 0% or 100%. */
export function reviewOutcomeLabel(summary: ReviewOutcomeSummary | null | undefined): string {
  const outcome = reviewOutcome(summary);
  if (outcome === "failed") return "Failed";
  if (outcome === "not_reviewed") return "Not reviewed";
  if (outcome === "not_applicable") return "Not applicable";
  if (outcome === "verification_incomplete") return "Verification incomplete";
  if (outcome === "no_findings_unverified") return "No findings identified · Code compliance unverified";
  if (outcome === "verified_compliant") return "Verified compliant";
  return "Potential issue";
}

export type ReviewAssessment = {
  /** Were the completed checks tied to quotes found on the drawings? */
  drawingEvidence: "evidence_backed" | "partly_evidence_backed" | "no_checks" | "not_assessed";
  /** Technical concerns raised, or substantive checks left open. */
  technicalRequirements: "concerns_identified" | "checks_unresolved" | "no_concerns_identified" | "not_assessed";
  /** Was an authoritative code requirement matched to the evidence? */
  codeVerification: "verified" | "unverified";
  /** Is the selected edition the verified adopted permit code? */
  applicability: "permit_compliance" | "reference_only";
};

/** Four separate dimensions. One being unverified does not change the others. */
export function reviewAssessment(input: {
  reviewState?: string | null;
  totalIssues?: number;
  codeCoverageVerified?: boolean;
  limitations?: ReviewLimitation[] | null;
}): ReviewAssessment {
  const codes = new Set((input.limitations ?? []).map((item) => item.code));
  const ran = Boolean(input.reviewState) && input.reviewState !== "not_reviewed" && input.reviewState !== "failed";
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
      : (input.totalIssues ?? 0) > 0
        ? "concerns_identified"
        : (input.limitations ?? []).some(isUnresolvedCheck)
          ? "checks_unresolved"
          : "no_concerns_identified",
    codeVerification: input.codeCoverageVerified === true ? "verified" : "unverified",
    applicability: codes.has("reference_only_scope") ? "reference_only" : "permit_compliance",
  };
}

const OPEN_CHECK_REJECTIONS = new Set([
  "cross_sheet_owner",
  "documented_design_provision",
  "requirement_already_on_sheet",
  "requirement_already_specified",
  "already_noted",
  "special_inspection_retrieval_unavailable",
  "drawing_retrieval_unavailable",
  "claim_not_tied_to_evidence",
  "incomplete_question",
]);

/**
 * Stored reasons first. Older rows have none, so the same reasons are read from
 * legal applicability, code coverage, checklist evidence, and withheld candidates.
 */
export function reviewLimitations(metadata: ReviewMetadataLike[]): ReviewLimitation[] {
  const out: ReviewLimitation[] = [];
  const add = (item: ReviewLimitation) => {
    if (!out.some((existing) => existing.code === item.code && existing.detail === item.detail)) out.push(item);
  };
  for (const item of metadata) {
    const summary = item.summary;
    if (!summary) continue;
    if (reviewOutcome({ ...summary, totalIssues: 0 }) === "verified_compliant") continue;
    if (Array.isArray(summary.limitations) && summary.limitations.length > 0) {
      summary.limitations.forEach(add);
      continue;
    }
    if (summary.reviewState === "failed" || summary.reviewState === "not_reviewed") continue;
    const legal = item.legalApplicability;
    if (!legal || legal.reviewScope !== "permit_compliance" || legal.status !== "verified") {
      add({
        code: "reference_only_scope",
        detail: legal?.selectedEdition
          ? `${legal.selectedEdition} is not verified as the adopted permit code for this project${legal.adoptedEdition ? ` (verified adopted edition: ${legal.adoptedEdition})` : ""}, so the review is reference-only.`
          : "The selected code edition is not verified as the adopted permit code for this project, so the review is reference-only.",
      });
    }
    if (!item.codeCoverage || (item.codeCoverage.enforceableProvisionCount ?? 0) === 0) {
      add({
        code: "no_authoritative_requirement",
        detail: `No authoritative code requirement for the reviewed elements was available${item.codeCoverage?.status ? ` (code source coverage: ${item.codeCoverage.status.replace(/_/g, " ")})` : ""}, so drawing labels could not be checked against a requirement.`,
      });
    }
    const checklist = summary.checklist ?? [];
    const clean = summary.cleanChecks ?? [];
    if (checklist.length === 0) {
      add({ code: "no_checks_returned", detail: "The review returned no completed checks for this sheet." });
    } else if (clean.length < checklist.length) {
      add({
        code: "checks_not_evidence_backed",
        detail: "One or more completed checks were not tied to a quote found in the sheet text.",
      });
    }
    const open = (item.rejectedCandidates ?? []).filter((candidate) =>
      OPEN_CHECK_REJECTIONS.has(String(candidate.validationReason || "")),
    );
    for (const candidate of open.slice(0, 5)) {
      add({
        code: "open_check",
        detail: `${candidate.title || "A candidate check"}: ${candidate.validationDetail || "withheld, not verified"} Withholding it is not proof of compliance.`,
      });
    }
  }
  return out;
}

/**
 * Read-only report. Historical `passed` and `not_reviewed` stay readable.
 * Rejected candidates are not listed as violations.
 */
export function buildReviewReportView(
  metadata: ReviewMetadataLike[],
  issues: ReviewIssueLike[],
): ReviewReportView {
  const scope = metadata.map((item) => item.jurisdictionScope).find(Boolean) || null;
  const diagnostics = metadata.map((item) => item.jurisdictionDiagnostics).find(Boolean) || null;
  const legalApplicability = metadata.map((item) => item.legalApplicability).find(Boolean) || null;
  const codeCoverage = metadata.map((item) => item.codeCoverage).find(Boolean) || null;
  const selectedScope = scope?.selectedScope || diagnostics?.selectedScope || "Unselected";
  const detectedLocation = scope?.detectedLocation || diagnostics?.detectedLocation || "None recorded";
  const amendmentsEnforced = Boolean(scope?.amendmentsEnforced ?? diagnostics?.amendmentsEnforced);
  const documents = [
    ...new Set(
      metadata
        .map((item) => item.sheet_file_name || item.file_name)
        .filter((name): name is string => Boolean(name)),
    ),
  ];
  const disciplines = [...new Set(metadata.flatMap((item) => item.disciplines || []))];
  const cleanChecks = [
    ...new Set(metadata.flatMap((item) => item.summary?.cleanChecks || []).filter(Boolean)),
  ];
  const states = metadata.map((item) => item.summary?.reviewState).filter(Boolean);
  const limitations = reviewLimitations(metadata);
  const unresolvedChecks = limitations.filter(isUnresolvedCheck).map((item) => item.detail);
  const unreviewable: string[] = limitations.filter((item) => !isUnresolvedCheck(item)).map((item) => item.detail);
  if (states.includes("reviewed_partial") && limitations.length === 0) {
    unreviewable.push("The model finished, but the evidence was not complete enough to score this sheet.");
  }
  if (states.includes("failed")) unreviewable.push("The model call failed.");
  if (states.includes("not_reviewed")) unreviewable.push("This stored result did not run a completed review.");

  const evidence: ReviewReportView["evidence"] = [];
  for (const item of metadata) {
    for (const observation of item.observations || []) {
      if (!observation.quote) continue;
      evidence.push({
        where: observation.fileName || item.sheet_file_name || "This sheet",
        quote: observation.quote,
        hasRegion: Boolean(observation.region),
      });
    }
    for (const pack of item.retrievalHits || []) {
      for (const hit of pack.drawing || []) {
        if (!hit.quote) continue;
        evidence.push({
          where: [hit.fileName, hit.pageNumber ? `p. ${hit.pageNumber}` : ""].filter(Boolean).join(" "),
          quote: hit.quote,
          hasRegion: Boolean(hit.region),
        });
      }
    }
  }

  const withheld = [
    ...new Set(
      metadata.flatMap((item) =>
        (item.rejectedCandidates || [])
          .map((candidate) => candidate.validationDetail || candidate.validationReason)
          .filter((reason): reason is string => Boolean(reason)),
      ),
    ),
  ].slice(0, 6);

  return {
    selectedScope,
    detectedLocation,
    amendmentsEnforced,
    disclosure: legalApplicability?.warning || diagnostics?.message || null,
    userEmphasis: metadata.map((item) => item.userEmphasis).find((value) => value && value.trim()) || null,
    documentsReviewed: documents,
    disciplines,
    confirmedFindings: issues.filter(
      (issue) => CONFIRMED.has(String(issue.findingType || "")) && issue.validationDisposition !== "reject",
    ),
    verificationQuestions: issues.filter(
      (issue) =>
        QUESTION.has(String(issue.findingType || "")) || issue.validationDisposition === "downgrade",
    ),
    cleanChecks,
    unreviewable,
    unresolvedChecks,
    limitations,
    evidence: evidence.slice(0, 12),
    withheldReasons: withheld,
    legalApplicability,
    codeCoverage,
  };
}

/** Collapsed Review Evidence strip. Expanded details stay on the full view. */
export function reviewEvidenceStripSummary(
  view: ReviewReportView,
  context?: {
    sourceFileName?: string | null;
    reviewState?: string | null;
    overallScore?: number | null;
    totalIssues?: number;
    codeCoverageVerified?: boolean;
  },
): ReviewEvidenceStripSummary {
  const sourceFileName =
    context?.sourceFileName?.trim() ||
    view.documentsReviewed[0] ||
    "This sheet";
  const jurisdictionLabel = view.amendmentsEnforced
    ? view.detectedLocation
    : `${view.detectedLocation} · amendments not enforced`;
  const countLabel =
    view.evidence.length > 0
      ? `${view.evidence.length} evidence`
      : view.verificationQuestions.length === 1
        ? "1 verification question"
        : `${view.verificationQuestions.length} verification questions`;
  return {
    sourceFileName,
    codeLabel: view.legalApplicability?.selectedEdition
      ? `${view.legalApplicability.selectedEdition} · ${view.legalApplicability.reviewScope || "reference_only"}`
      : view.selectedScope,
    jurisdictionLabel,
    reviewStateLabel: reviewOutcomeLabel({
      reviewState: context?.reviewState,
      overallScore: context?.overallScore,
      totalIssues: context?.totalIssues ?? view.confirmedFindings.length + view.verificationQuestions.length,
      codeCoverageVerified: context?.codeCoverageVerified,
      limitations: view.limitations,
    }),
    countLabel,
  };
}
