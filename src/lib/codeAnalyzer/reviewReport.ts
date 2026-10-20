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

export type ReviewLimitation = {
  code: string;
  detail: string;
  /** Open checks only: what was checked, what evidence is missing, and where to look. */
  check?: string;
  missingEvidence?: string;
  relatedSheets?: string[];
  /** Why the check is open: evidence_unavailable, fact_not_found, premise_unconfirmed, ... */
  openReason?: string | null;
  outcome?: string | null;
};

/** Per-candidate disposition the verifier recorded. */
export type CandidateEvaluationLike = {
  verification?: {
    outcome?: string | null;
    reason?: string | null;
    detail?: string | null;
    openReason?: string | null;
  } | null;
  related?: Array<{ sheet?: string | null; quote?: string | null }> | null;
};

export type ResolvedCheck = { check: string; detail: string; relatedSheets: string[] };

export type DispositionCounts = {
  published: number;
  open_check: number;
  resolved_by_evidence: number;
  correctly_rejected: number;
  not_applicable: number;
};

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
  rejectedCandidates?: Array<{
    validationReason?: string;
    validationDetail?: string;
    title?: string;
    diagnostics?: { originalTitle?: string | null } | null;
    evaluation?: CandidateEvaluationLike | null;
  }>;
  legalApplicability?: {
    status?: string | null;
    reviewScope?: string | null;
    selectedEdition?: string | null;
    adoptedEdition?: string | null;
    adoptedBaseCode?: string | null;
    adoptedCodes?: Array<{ family?: string | null; edition?: string | null }> | null;
    officialSourceUrl?: string | null;
    verificationDate?: string | null;
    sourceStatus?: string | null;
    warning?: string | null;
    unresolvedReasons?: string[] | null;
    requestedReviewScope?: string | null;
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
  /** The same checks with what is missing and the sheets involved. */
  openChecks: ReviewLimitation[];
  /** Candidates withheld because a named sheet states the fact, with that sheet. */
  resolvedChecks: ResolvedCheck[];
  /** How every withheld candidate was disposed of. Published findings are counted by the caller. */
  dispositions: DispositionCounts;
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

/** Reasons that leave a check open, for rows stored before candidates carried an evaluation. */
const OPEN_CHECK_REJECTIONS = new Set([
  "cross_sheet_owner",
  "requirement_reminder",
  "detail_unreadable",
  "rated_assembly_unconfirmed",
  "documented_design_provision",
  "requirement_already_on_sheet",
  "requirement_already_specified",
  "already_noted",
  "special_inspection_retrieval_unavailable",
  "drawing_retrieval_unavailable",
  "claim_not_tied_to_evidence",
  "incomplete_question",
]);

const OPEN_OUTCOMES = new Set(["open_check", "reconsider"]);

const OPEN_REASON_LABELS: Record<string, string> = {
  evidence_unavailable: "graphic or related-sheet evidence was not available",
  fact_not_found: "the fact was not found on this or a related sheet",
  premise_unconfirmed: "the candidate's premise is not confirmed by the drawings",
  calculation_unresolved: "the printed values are not connected by a stated method",
  requirement_unverified: "a note states the requirement but not that it is met",
  reconsider: "the suppression was not backed by evidence for this element",
};

export function openReasonLabel(reason: string | null | undefined): string | null {
  return reason ? OPEN_REASON_LABELS[reason] || reason.replace(/_/g, " ") : null;
}

type StoredCandidate = NonNullable<ReviewMetadataLike["rejectedCandidates"]>[number];

/** The recorded outcome; older rows fall back to the rejection reason. */
function candidateOutcome(candidate: StoredCandidate): string {
  const recorded = candidate.evaluation?.verification?.outcome;
  if (recorded) return recorded === "reconsider" ? "open_check" : recorded;
  return OPEN_CHECK_REJECTIONS.has(String(candidate.validationReason || "")) ? "open_check" : "closed";
}

function evaluationSheets(candidate: StoredCandidate): string[] {
  return (candidate.evaluation?.related ?? [])
    .map((item) => String(item?.sheet || "").trim())
    .filter(Boolean);
}

type StoredLegal = NonNullable<ReviewMetadataLike["legalApplicability"]>;
type StoredCoverage = NonNullable<ReviewMetadataLike["codeCoverage"]>;

const CORPUS_SENTENCE = "Code compliance unverified — applicable technical provision not available in the verified Code RAG corpus.";

function yearsInLabel(value: string): string[] {
  return [...value.matchAll(/\b((?:19|20)\d{2})\b/g)].map((match) => match[1]);
}

function editionAligned(legal: StoredLegal | null | undefined): boolean {
  const selected = String(legal?.selectedEdition || "").trim();
  if (!selected || !legal) return false;
  const base = String(legal.adoptedBaseCode || "");
  const adopted = String(legal.adoptedEdition || "");
  if (base === selected || base.endsWith(` ${selected}`) || adopted.endsWith(selected)) return true;
  const years = yearsInLabel(selected);
  const baseYear = yearsInLabel(base)[0];
  const adoptedYear = yearsInLabel(adopted)[0];
  const lower = selected.toLowerCase();
  const namesIbc = /\bibc\b|international building code/.test(lower);
  const namesLocal = /\b(?:building|construction)\s+codes?\b/.test(lower) || /\b(?:dc|d\.c\.|district of columbia)\b/.test(lower);
  if (namesIbc && baseYear && years.includes(baseYear)) return true;
  if (namesLocal && adoptedYear && years.includes(adoptedYear) && !namesIbc) return true;
  if (namesLocal && namesIbc && adoptedYear && baseYear && years.includes(adoptedYear) && years.includes(baseYear)) return true;
  if (years.length === 1 && (years[0] === baseYear || years[0] === adoptedYear)) return true;
  const codes = legal.adoptedCodes || [];
  return codes.some((code) => {
    const family = String(code.family || "");
    if (!years.includes(String(code.edition)) || !family) return false;
    return new RegExp(`\\b${family.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(selected)
      || (/\bnec\b|\bnfpa\s*70\b/i.test(selected) && /^(?:NEC|NFPA 70)$/i.test(family));
  });
}

function corpusDetail(legal: StoredLegal | null | undefined, coverage: StoredCoverage | null | undefined): string {
  const named = [legal?.adoptedEdition, legal?.adoptedBaseCode].filter(Boolean).join(" / ")
    || legal?.selectedEdition
    || "the selected code";
  const source = legal?.officialSourceUrl ? ` Source: ${legal.officialSourceUrl}.` : "";
  const coverageNote = coverage?.status ? ` Code source coverage: ${String(coverage.status).replace(/_/g, " ")}.` : "";
  return `${CORPUS_SENTENCE} No authoritative code requirement for the reviewed elements was available for ${named}.${coverageNote}${source} Exact model-code text requires an ICC license, a publisher API, or an authorized excerpt. This is missing code text, not a missing drawing dimension.`;
}

function presentLegal(
  legal: StoredLegal | null | undefined,
): StoredLegal | null {
  if (!legal || legal.status !== "unresolved" || legal.requestedReviewScope === "reference_only" || !editionAligned(legal)) {
    return legal || null;
  }
  const reason = (legal.unresolvedReasons || []).filter(Boolean).join(" ");
  return {
    ...legal,
    reviewScope: "permit_compliance",
    warning: reason || legal.warning,
  };
}

function presentLimitation(
  limitation: ReviewLimitation,
  legal: StoredLegal | null | undefined,
  coverage: StoredCoverage | null | undefined,
): ReviewLimitation {
  if (
    limitation.code === "reference_only_scope"
    && legal?.status === "unresolved"
    && legal.requestedReviewScope !== "reference_only"
    && editionAligned(legal)
  ) {
    return {
      ...limitation,
      code: "permit_applicability_unresolved",
      detail: `${(legal.unresolvedReasons || []).join(" ") || "Permit application or issue date is required."} The selected edition is the verified adoption (${legal.adoptedEdition || "local edition"}${legal.adoptedBaseCode ? `, base ${legal.adoptedBaseCode}` : ""}). A missing permit date is not a different code edition. Permit compliance stays unresolved until that fact is documented.`,
    };
  }
  if (limitation.code === "no_authoritative_requirement" && !String(limitation.detail || "").includes("verified Code RAG corpus")) {
    return { ...limitation, detail: corpusDetail(legal, coverage) };
  }
  return limitation;
}

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
      summary.limitations.forEach((limitation) =>
        add(isUnresolvedCheck(limitation)
          ? withCheckDetail(limitation, item)
          : presentLimitation(limitation, item.legalApplicability, item.codeCoverage)),
      );
      if (!summary.limitations.some(isUnresolvedCheck)) addOpenChecks(item, add);
      continue;
    }
    if (summary.reviewState === "failed" || summary.reviewState === "not_reviewed") continue;
    const legal = item.legalApplicability;
    const unresolvedMatch = legal?.status === "unresolved"
      && legal.requestedReviewScope !== "reference_only"
      && editionAligned(legal);
    if (unresolvedMatch) {
      add({
        code: "permit_applicability_unresolved",
        detail: `${(legal?.unresolvedReasons || []).join(" ") || "Permit application or issue date is required."} The selected edition is the verified adoption (${legal?.adoptedEdition || "local edition"}${legal?.adoptedBaseCode ? `, base ${legal.adoptedBaseCode}` : ""}). A missing permit date is not a different code edition. Permit compliance stays unresolved until that fact is documented.`,
      });
    } else if (!legal || legal.reviewScope !== "permit_compliance" || legal.status !== "verified") {
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
        detail: corpusDetail(legal, item.codeCoverage),
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
    addOpenChecks(item, add);
  }
  return out;
}

const SHEET_FILE_RE = /\b[A-Z]{1,3}[- ]?\d[\w.\- ]*?\.pdf\b/g;

function cleanCheckTitle(value: string | null | undefined): string {
  return String(value || "A candidate check")
    .replace(/\s*[—-]\s*verification required/gi, "")
    .replace(/\s+/g, " ")
    .trim() || "A candidate check";
}

function sheetsFor(text: string, item: ReviewMetadataLike): string[] {
  const own = item.sheet_file_name || item.file_name || "";
  const named = String(text || "").match(SHEET_FILE_RE) ?? [];
  return [...new Set([own, ...named].map((name) => name.trim()).filter(Boolean))];
}

/** Older open-check rows carry one sentence. Split it into the check and the missing evidence. */
function withCheckDetail(limitation: ReviewLimitation, item: ReviewMetadataLike): ReviewLimitation {
  if (limitation.check && limitation.missingEvidence) return limitation;
  const text = limitation.detail.replace(/\s*Withholding it is not proof of compliance\.?$/, "");
  const split = text.indexOf(": ");
  return {
    ...limitation,
    check: limitation.check || (split > 0 ? text.slice(0, split) : "Unresolved check"),
    missingEvidence: limitation.missingEvidence || (split > 0 ? text.slice(split + 2) : text),
    relatedSheets: limitation.relatedSheets?.length ? limitation.relatedSheets : sheetsFor(text, item),
  };
}

function addOpenChecks(item: ReviewMetadataLike, add: (limitation: ReviewLimitation) => void): void {
  const open = (item.rejectedCandidates ?? []).filter((candidate) => candidateOutcome(candidate) === "open_check");
  for (const candidate of open) {
    const check = cleanCheckTitle(candidate.diagnostics?.originalTitle || candidate.title);
    const missingEvidence = String(candidate.validationDetail || "Withheld, not verified.").trim();
    add({
      code: "open_check",
      detail: `${check}: ${missingEvidence} Withholding it is not proof of compliance.`,
      check,
      missingEvidence,
      relatedSheets: [...new Set([...sheetsFor(missingEvidence, item), ...evaluationSheets(candidate)])],
      openReason: candidate.evaluation?.verification?.openReason ?? null,
      outcome: "open_check",
    });
  }
}

function emptyDispositions(): DispositionCounts {
  return { published: 0, open_check: 0, resolved_by_evidence: 0, correctly_rejected: 0, not_applicable: 0 };
}

/** Withheld candidates by recorded outcome; rows without an evaluation count only when open. */
function candidateDispositions(metadata: ReviewMetadataLike[]): { counts: DispositionCounts; resolved: ResolvedCheck[] } {
  const counts = emptyDispositions();
  const resolved: ResolvedCheck[] = [];
  for (const item of metadata) {
    for (const candidate of item.rejectedCandidates ?? []) {
      const outcome = candidateOutcome(candidate);
      if (outcome in counts) counts[outcome as keyof DispositionCounts] += 1;
      if (outcome !== "resolved_by_evidence") continue;
      const detail = String(candidate.evaluation?.verification?.detail || candidate.validationDetail || "").trim();
      resolved.push({
        check: cleanCheckTitle(candidate.diagnostics?.originalTitle || candidate.title),
        detail,
        relatedSheets: [...new Set([...evaluationSheets(candidate), ...(detail.match(SHEET_FILE_RE) ?? []).map((name) => name.trim())])],
      });
    }
  }
  return { counts, resolved };
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
  const legalApplicability = presentLegal(metadata.map((item) => item.legalApplicability).find(Boolean) || null);
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
  const openChecks = limitations.filter(isUnresolvedCheck);
  const unresolvedChecks = openChecks.map((item) => item.detail);
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
  const disposed = candidateDispositions(metadata);

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
    openChecks,
    resolvedChecks: disposed.resolved,
    dispositions: { ...disposed.counts, open_check: openChecks.length },
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
  const findings = context?.totalIssues ?? view.confirmedFindings.length + view.verificationQuestions.length;
  const openCount = (view.openChecks ?? []).length;
  const countLabel = findings === 0 && openCount > 0
    ? `${openCount} unresolved ${openCount === 1 ? "check" : "checks"}`
    : view.evidence.length > 0
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

function uniqueBy<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const k = key(item);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * One sheet-level view over the IBC and Local reviews. Findings from both scopes are kept,
 * including two findings about the same physical condition.
 */
export function mergeReviewReportViews(
  views: Array<ReviewReportView | null | undefined>,
): ReviewReportView | null {
  const present = views.filter((view): view is ReviewReportView => Boolean(view));
  if (present.length === 0) return null;
  if (present.length === 1) return present[0];
  const [first] = present;
  const strings = (pick: (view: ReviewReportView) => string[]) => [...new Set(present.flatMap(pick))];
  const limitations = uniqueBy(present.flatMap((view) => view.limitations), (item) => `${item.code}|${item.detail}`);
  const openChecks = limitations.filter(isUnresolvedCheck);
  return {
    ...first,
    selectedScope: strings((view) => [view.selectedScope]).join(" + "),
    amendmentsEnforced: present.some((view) => view.amendmentsEnforced),
    disclosure: present.map((view) => view.disclosure).find(Boolean) ?? null,
    userEmphasis: present.map((view) => view.userEmphasis).find(Boolean) ?? null,
    documentsReviewed: strings((view) => view.documentsReviewed),
    disciplines: strings((view) => view.disciplines),
    confirmedFindings: present.flatMap((view) => view.confirmedFindings),
    verificationQuestions: present.flatMap((view) => view.verificationQuestions),
    cleanChecks: strings((view) => view.cleanChecks),
    unreviewable: strings((view) => view.unreviewable),
    unresolvedChecks: openChecks.map((item) => item.detail),
    openChecks,
    resolvedChecks: uniqueBy(present.flatMap((view) => view.resolvedChecks ?? []), (item) => `${item.check}|${item.detail}`),
    dispositions: {
      ...present.reduce((sum, view) => {
        const counts = view.dispositions ?? emptyDispositions();
        (Object.keys(sum) as Array<keyof DispositionCounts>).forEach((key) => { sum[key] += counts[key]; });
        return sum;
      }, emptyDispositions()),
      open_check: openChecks.length,
    },
    limitations,
    evidence: uniqueBy(present.flatMap((view) => view.evidence), (item) => `${item.where}|${item.quote}`).slice(0, 12),
    withheldReasons: strings((view) => view.withheldReasons).slice(0, 6),
    legalApplicability: present.map((view) => view.legalApplicability).find(Boolean) ?? null,
    codeCoverage: present.map((view) => view.codeCoverage).find(Boolean) ?? null,
  };
}

/**
 * Sheet headline. The count is findings from every scope. Zero findings never reads as a pass:
 * open checks read "Verification incomplete" with their count.
 */
export function sheetFindingsHeadline(summary: ReviewOutcomeSummary | null | undefined): string {
  const total = summary?.totalIssues ?? 0;
  const label = reviewOutcomeLabel(summary);
  if (total > 0) return `${total} ${total === 1 ? "Finding" : "Findings"} · ${label}`;
  const open = (summary?.limitations ?? []).filter(isUnresolvedCheck).length;
  if (open > 0) return `0 Findings · ${label} · ${open} unresolved ${open === 1 ? "check" : "checks"}`;
  if (reviewOutcome(summary) === "no_findings_unverified") {
    const corpusGap = (summary?.limitations ?? []).some((item) =>
      item.code === "no_authoritative_requirement"
      || String(item.detail || "").includes("verified Code RAG corpus"));
    return corpusGap
      ? "0 Findings · Code compliance unverified — applicable technical provision not available in the verified Code RAG corpus."
      : "0 Findings · Code compliance unverified";
  }
  return `0 Findings · ${label}`;
}
