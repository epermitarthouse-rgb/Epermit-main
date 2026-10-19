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

export type ReviewMetadataLike = {
  summary?: {
    reviewState?: string | null;
    overallScore?: number | null;
    checklist?: string[];
    cleanChecks?: string[];
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
  unreviewable: string[];
  evidence: Array<{ where: string; quote: string; hasRegion: boolean }>;
  withheldReasons: string[];
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
  const unreviewable: string[] = [];
  if (states.includes("reviewed_partial")) {
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
    disclosure: diagnostics?.message || null,
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
    evidence: evidence.slice(0, 12),
    withheldReasons: withheld,
  };
}

/** Collapsed Review Evidence strip. Expanded details stay on the full view. */
export function reviewEvidenceStripSummary(
  view: ReviewReportView,
  context?: {
    sourceFileName?: string | null;
    reviewState?: string | null;
    overallScore?: number | null;
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
    codeLabel: view.selectedScope,
    jurisdictionLabel,
    reviewStateLabel: reviewStateLabel(context?.reviewState, context?.overallScore),
    countLabel,
  };
}
