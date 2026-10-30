/**
 * Deterministic technical-check framework (eval / local prototype).
 *
 * Runs alongside open-ended GPT issue discovery. Does not replace the PDF→GPT-4o
 * path. Missing evidence → unresolved (never auto-violation). OCR quotes never
 * establish compliance and never auto-clear Critical findings.
 *
 * independentlyVerified is always false until qualified professional review.
 */

export const TECHNICAL_CHECKS_VERSION = "technical-checks.v1";

export type TechnicalCheckOutcome =
  | "supported_issue"
  | "no_issue_evidenced"
  | "unresolved"
  | "not_applicable";

export type TechnicalCheckSourceKind =
  | "stage3_pack"
  | "stage12_pack"
  | "layout"
  | "finding"
  | "text_layer"
  | "fixture";

export interface TechnicalCheckSourceRef {
  kind: TechnicalCheckSourceKind;
  path?: string;
  packId?: string;
}

export interface TechnicalCheckResult {
  checkId: string;
  sheetId: string;
  family: "guardrail" | "door_schedule" | "hydraulic";
  outcome: TechnicalCheckOutcome;
  evidenceQuotes: string[];
  sourceRefs: TechnicalCheckSourceRef[];
  codeBasis: string | null;
  uncertainty: string;
  independentlyVerified: false;
  reason: string;
}

export interface TechnicalEvidencePack {
  id?: string;
  sheetId?: string;
  topic?: string;
  status?: string;
  extractedTexts?: string[];
  detailIdentifier?: string | null;
  assessment?: Record<string, unknown> | null;
  promptBlock?: string;
  independentlyVerified?: boolean;
  criticalControls?: unknown;
  source?: TechnicalCheckSourceKind;
  path?: string;
}

export interface TechnicalCheckSheetInput {
  sheetId: string;
  /** Optional analyzer finding drafts for the sheet (not required). */
  findings?: Array<{
    title?: string;
    observation?: string;
    drawing_evidence?: string;
    severity?: string;
    recommendation?: string;
  }>;
  packs?: TechnicalEvidencePack[];
  /** Hydraulic numeric context when known from layout/OCR fixtures. */
  hydraulicFacts?: {
    densityGpmPerSqFt?: number | null;
    areaSqFt?: number | null;
    flowDemandGpm?: number | null;
    hoseAllowanceGpm?: number | null;
    quotedNotes?: string[];
  };
  crossSheetRetrieved?: boolean;
}

export interface TechnicalCheckRunInput {
  sheets: TechnicalCheckSheetInput[];
}

export interface TechnicalCheckRunReport {
  version: typeof TECHNICAL_CHECKS_VERSION;
  independentlyVerified: false;
  results: TechnicalCheckResult[];
  summary: Record<TechnicalCheckOutcome, number>;
}

const GUARD_HEIGHT_RE =
  /\d+\s*['′]\s*-?\s*\d+\s*"?\s*(?:MIN\.?\s*)?HEIGHT\b|\b3\s*['′]\s*-?\s*6\s*"?\s*(?:MIN\.?\s*)?HEIGHT(?:\s+FROM)?\b/i;
const GUARD_DETAIL_RE = /\bGUARD\s*RAIL(?:\s+ELEVATION)?\s+DETAIL\b/i;
const GUARD_NOTE_RE = /\bGUARD(?:\s*-?\s*rail)?\b/i;
const PANIC_OR_LOCK_RE = /\b(?:PANIC|LOCK|CLOSER|EXIT\s+DEVICE|ALARM\s+LOCK)\b/i;
const FIRE_RATING_RE = /\b(?:FIRE[- ]?RAT(?:ED|ING)|MIN\.?\s*FIRE|HOUR\s+RATED|label\s*[A-Z]?)\b/i;
const DOOR_SCHEDULE_RE = /\bDOOR\s+SCHEDULE\b/i;

function alwaysUnverified(): false {
  return false;
}

function packTexts(pack: TechnicalEvidencePack): string[] {
  const fromExtracted = Array.isArray(pack.extractedTexts) ? pack.extractedTexts : [];
  const assessment = pack.assessment || {};
  const extras = [
    String(pack.detailIdentifier || ""),
    String((assessment as { heightText?: string }).heightText || ""),
    String((assessment as { guardText?: string }).guardText || ""),
    String(pack.promptBlock || ""),
  ].filter(Boolean);
  return [...fromExtracted, ...extras];
}

function joinedPackText(packs: TechnicalEvidencePack[]): string {
  return packs.flatMap(packTexts).join("\n");
}

function sourceRefsFor(packs: TechnicalEvidencePack[]): TechnicalCheckSourceRef[] {
  return packs.map((pack) => ({
    kind: pack.source || "stage3_pack",
    path: pack.path,
    packId: pack.id,
  }));
}

function baseResult(
  partial: Omit<TechnicalCheckResult, "independentlyVerified" | "codeBasis"> & {
    codeBasis?: string | null;
  },
): TechnicalCheckResult {
  return {
    ...partial,
    codeBasis: partial.codeBasis ?? null,
    independentlyVerified: alwaysUnverified(),
  };
}

function applicableSheet(sheetId: string, family: TechnicalCheckResult["family"]): boolean {
  const id = sheetId.toUpperCase().replace(/\s+/g, "");
  if (family === "guardrail") return /A-3\.06|A306/.test(id);
  if (family === "door_schedule") return /A-6\.00|A600|A-6\.0/.test(id);
  if (family === "hydraulic") return /FP200|FP-200/.test(id);
  return false;
}

/** Guardrail family */
export function evaluateGuardrailChecks(sheet: TechnicalCheckSheetInput): TechnicalCheckResult[] {
  const sheetId = sheet.sheetId;
  if (!applicableSheet(sheetId, "guardrail")) {
    return [
      baseResult({
        checkId: "guardrail.height_specified",
        sheetId,
        family: "guardrail",
        outcome: "not_applicable",
        evidenceQuotes: [],
        sourceRefs: [],
        uncertainty: "Sheet is outside the A-3.06 guardrail pilot family.",
        reason: "Check family not applicable to this sheet id.",
      }),
    ];
  }

  const packs = sheet.packs || [];
  const blob = joinedPackText(packs);
  const refs = sourceRefsFor(packs);
  const heightHits = packs.flatMap(packTexts).filter((t) => GUARD_HEIGHT_RE.test(t));
  const detailHits = packs.flatMap(packTexts).filter((t) => GUARD_DETAIL_RE.test(t) || GUARD_NOTE_RE.test(t));
  const associated =
    Boolean(blob) &&
    GUARD_HEIGHT_RE.test(blob) &&
    (GUARD_DETAIL_RE.test(blob) || /associated_to_guardrail_detail|likely_same_detail/i.test(blob));

  const heightCheck = baseResult({
    checkId: "guardrail.height_specified",
    sheetId,
    family: "guardrail",
    outcome: !packs.length
      ? "unresolved"
      : heightHits.length
        ? "no_issue_evidenced"
        : "unresolved",
    evidenceQuotes: heightHits.slice(0, 4),
    sourceRefs: refs,
    uncertainty:
      "Machine-extracted height tokens are not professionally verified and do not prove code compliance.",
    reason: !packs.length
      ? "No evidence packs supplied; missing evidence must not become a violation."
      : heightHits.length
        ? "A minimum-height dimension string was recovered in pack text."
        : "Packs present but no guardrail height dimension token recovered.",
  });

  const associationCheck = baseResult({
    checkId: "guardrail.height_associated_to_detail",
    sheetId,
    family: "guardrail",
    outcome: !packs.length
      ? "unresolved"
      : associated
        ? "no_issue_evidenced"
        : heightHits.length
          ? "unresolved"
          : "unresolved",
    evidenceQuotes: [...heightHits, ...detailHits].slice(0, 6),
    sourceRefs: refs,
    uncertainty: "Geometric/OCR association is a candidate only.",
    reason: !packs.length
      ? "No packs; association unresolved."
      : associated
        ? "Height token co-occurs with guardrail elevation/detail language in pack assessment."
        : "Height and guardrail detail association not established from supplied packs.",
  });

  const crossSheet = baseResult({
    checkId: "guardrail.cross_sheet_refs",
    sheetId,
    family: "guardrail",
    outcome: sheet.crossSheetRetrieved === true
      ? "no_issue_evidenced"
      : /SEE\s+SHEET|SEE\s+DETAIL/i.test(blob)
        ? "unresolved"
        : "not_applicable",
    evidenceQuotes: packs.flatMap(packTexts).filter((t) => /SEE\s+SHEET|SEE\s+DETAIL/i.test(t)).slice(0, 3),
    sourceRefs: refs,
    uncertainty: "Cross-sheet retrieval may be disabled; absence of retrieval is not a violation.",
    reason: sheet.crossSheetRetrieved === true
      ? "Cross-sheet excerpts were marked retrieved for this sheet."
      : /SEE\s+SHEET|SEE\s+DETAIL/i.test(blob)
        ? "Pack text references another sheet/detail but retrieval was not confirmed."
        : "No cross-sheet pointer observed in supplied packs.",
  });

  // Optional: if a finding alleges missing height while packs quote associated height → supported_issue against the *finding quality*, not a code violation.
  const absenceFinding = (sheet.findings || []).find((f) => {
    const claim = `${f.title || ""} ${f.observation || ""}`;
    return GUARD_NOTE_RE.test(claim) && /\bheight\b/i.test(claim) &&
      /\bdoes not|missing|not (?:visibly )?specify|cannot confirm|look-for did not\b/i.test(claim);
  });
  const findingContradiction = absenceFinding && associated
    ? [
      baseResult({
        checkId: "guardrail.absence_claim_vs_quoted_height",
        sheetId,
        family: "guardrail",
        outcome: "supported_issue",
        evidenceQuotes: heightHits.slice(0, 3),
        sourceRefs: [...refs, { kind: "finding" }],
        uncertainty:
          "Flags an unsupported absence narrative when packs quote associated height. Does not clear Criticals automatically and does not certify compliance.",
        reason:
          "Analyzer absence/missing-height claim coexists with pack-quoted height associated to a guardrail detail.",
        codeBasis: null,
      }),
    ]
    : [];

  return [heightCheck, associationCheck, crossSheet, ...findingContradiction];
}

/** Door schedule family */
export function evaluateDoorScheduleChecks(sheet: TechnicalCheckSheetInput): TechnicalCheckResult[] {
  const sheetId = sheet.sheetId;
  if (!applicableSheet(sheetId, "door_schedule")) {
    return [
      baseResult({
        checkId: "door.hardware_present",
        sheetId,
        family: "door_schedule",
        outcome: "not_applicable",
        evidenceQuotes: [],
        sourceRefs: [],
        uncertainty: "Sheet outside A-6.00 door-schedule pilot family.",
        reason: "Check family not applicable.",
      }),
    ];
  }

  const packs = sheet.packs || [];
  const blob = joinedPackText(packs);
  const refs = sourceRefsFor(packs);
  const hardware = packs.flatMap(packTexts).filter((t) => PANIC_OR_LOCK_RE.test(t));
  const fire = packs.flatMap(packTexts).filter((t) => FIRE_RATING_RE.test(t));
  const schedule = DOOR_SCHEDULE_RE.test(blob);

  const hardwareCheck = baseResult({
    checkId: "door.hardware_present",
    sheetId,
    family: "door_schedule",
    outcome: !packs.length ? "unresolved" : hardware.length ? "no_issue_evidenced" : "unresolved",
    evidenceQuotes: hardware.slice(0, 6),
    sourceRefs: refs,
    uncertainty: "Quoted hardware does not prove egress compliance or clear lock-vs-egress conflicts.",
    reason: !packs.length
      ? "No packs; hardware presence unresolved (not a violation)."
      : hardware.length
        ? "Hardware strings (panic/lock/closer) recovered from packs."
        : "Packs present but no hardware tokens recovered.",
  });

  const fireCheck = baseResult({
    checkId: "door.fire_rating_info",
    sheetId,
    family: "door_schedule",
    outcome: !packs.length ? "unresolved" : fire.length ? "no_issue_evidenced" : "unresolved",
    evidenceQuotes: fire.slice(0, 4),
    sourceRefs: refs,
    uncertainty: "Missing fire-rating tokens mean unresolved schedule completeness — not automatic noncompliance.",
    reason: !packs.length
      ? "No packs; fire-rating unresolved."
      : fire.length
        ? "Fire-rating related tokens recovered."
        : "No fire-rating tokens in packs; completeness remains unresolved.",
  });

  const scheduleCheck = baseResult({
    checkId: "door.schedule_identified",
    sheetId,
    family: "door_schedule",
    outcome: !packs.length ? "unresolved" : schedule ? "no_issue_evidenced" : "unresolved",
    evidenceQuotes: packs.flatMap(packTexts).filter((t) => DOOR_SCHEDULE_RE.test(t)).slice(0, 2),
    sourceRefs: refs,
    uncertainty: "Schedule title detection is OCR/layout based.",
    reason: schedule ? "DOOR SCHEDULE identifier recovered." : "Door schedule title not recovered from packs.",
  });

  const absenceFinding = (sheet.findings || []).find((f) => {
    const claim = `${f.title || ""} ${f.observation || ""}`;
    return /\b(lock(?:ing)?|fire[- ]rat(?:ed|ing)?|hardware)\b/i.test(claim) &&
      /\bmissing|unclear|does not|not (?:specified|shown)|without\b/i.test(claim);
  });
  const contradiction = absenceFinding && hardware.length
    ? [
      baseResult({
        checkId: "door.absence_claim_vs_quoted_hardware",
        sheetId,
        family: "door_schedule",
        outcome: "supported_issue",
        evidenceQuotes: hardware.slice(0, 4),
        sourceRefs: [...refs, { kind: "finding" }],
        uncertainty:
          "Blanket absence may be contradicted by quoted hardware; genuine lock-vs-egress conflicts must remain eligible for Critical review.",
        reason: "Absence-style door finding coexists with quoted panic/lock/closer evidence.",
      }),
    ]
    : [];

  return [scheduleCheck, hardwareCheck, fireCheck, ...contradiction];
}

/** Hydraulic family (FP200) */
export function evaluateHydraulicChecks(sheet: TechnicalCheckSheetInput): TechnicalCheckResult[] {
  const sheetId = sheet.sheetId;
  if (!applicableSheet(sheetId, "hydraulic")) {
    return [
      baseResult({
        checkId: "hydraulic.density_area_vs_flow_demand",
        sheetId,
        family: "hydraulic",
        outcome: "not_applicable",
        evidenceQuotes: [],
        sourceRefs: [],
        uncertainty: "Sheet outside FP200 hydraulic pilot family.",
        reason: "Check family not applicable.",
      }),
    ];
  }

  const facts = sheet.hydraulicFacts || {};
  const packs = sheet.packs || [];
  const refs = sourceRefsFor(packs);
  const notes = [
    ...(facts.quotedNotes || []),
    ...packs.flatMap(packTexts),
  ];

  const density = facts.densityGpmPerSqFt ?? null;
  const area = facts.areaSqFt ?? null;
  const flow = facts.flowDemandGpm ?? null;
  const hose = facts.hoseAllowanceGpm ?? null;

  if (density == null || area == null || flow == null) {
    return [
      baseResult({
        checkId: "hydraulic.density_area_vs_flow_demand",
        sheetId,
        family: "hydraulic",
        outcome: "unresolved",
        evidenceQuotes: notes.slice(0, 4),
        sourceRefs: refs.length ? refs : [{ kind: "fixture" }],
        uncertainty: "Without density, area, and FLOW DEMAND values the check cannot decide.",
        reason: "Missing hydraulic numeric inputs — unresolved, not a violation.",
        codeBasis: null,
      }),
      baseResult({
        checkId: "hydraulic.hose_allowance_noted",
        sheetId,
        family: "hydraulic",
        outcome: hose != null || notes.some((n) => /\bhose\s+allowance\b/i.test(n))
          ? "no_issue_evidenced"
          : "unresolved",
        evidenceQuotes: notes.filter((n) => /\bhose\b/i.test(n)).slice(0, 3),
        sourceRefs: refs.length ? refs : [{ kind: "fixture" }],
        uncertainty: "Hose token presence is not a full hydraulic method review.",
        reason: hose != null || notes.some((n) => /\bhose\s+allowance\b/i.test(n))
          ? "Hose allowance value or note observed."
          : "Hose allowance not observed in supplied facts/packs.",
      }),
    ];
  }

  const product = density * area;
  const productNearFlow = Math.abs(flow - product) <= Math.max(1, product * 0.02);
  const flowMuchLarger = flow > product * 1.05;

  // If a finding treats density×area as proving FLOW DEMAND wrong while flow ≫ product → supported_issue (analyzer FP pattern).
  const findingAllegesInconsistency = (sheet.findings || []).some((f) => {
    const blob = `${f.title || ""} ${f.observation || ""} ${f.drawing_evidence || ""}`;
    return /hydraulic|flow\s+demand|density/i.test(blob) && /inconsist|should be|incorrect|conflict/i.test(blob);
  });

  const densityCheck = baseResult({
    checkId: "hydraulic.density_area_vs_flow_demand",
    sheetId,
    family: "hydraulic",
    outcome: findingAllegesInconsistency && flowMuchLarger && !productNearFlow
      ? "supported_issue"
      : productNearFlow && !findingAllegesInconsistency
        ? "unresolved"
        : flowMuchLarger
          ? "no_issue_evidenced"
          : "unresolved",
    evidenceQuotes: [
      `density=${density}`,
      `area=${area}`,
      `density×area=${Number(product.toFixed(2))}`,
      `flowDemand=${flow}`,
      ...(hose != null ? [`hoseAllowance=${hose}`] : []),
    ],
    sourceRefs: refs.length ? refs : [{ kind: "fixture" }],
    codeBasis: "NFPA 13 density-area method (proxy); edition not verified for this project registry.",
    uncertainty:
      "Numeric comparison is a method check only. OCR/layout values are independentlyVerified=false. Does not certify sprinkler design.",
    reason: findingAllegesInconsistency && flowMuchLarger
      ? "Finding treats density×area as conflicting with a larger FLOW DEMAND; density-area product is not total demand."
      : flowMuchLarger
        ? "FLOW DEMAND exceeds density×area as expected when hose/other demand components apply."
        : "Insufficient pattern to classify beyond unresolved.",
  });

  const hoseCheck = baseResult({
    checkId: "hydraulic.hose_allowance_noted",
    sheetId,
    family: "hydraulic",
    outcome: hose != null || notes.some((n) => /\bhose\s+allowance\b/i.test(n))
      ? "no_issue_evidenced"
      : "unresolved",
    evidenceQuotes: hose != null ? [`hoseAllowance=${hose}`] : notes.filter((n) => /\bhose\b/i.test(n)).slice(0, 3),
    sourceRefs: refs.length ? refs : [{ kind: "fixture" }],
    uncertainty: "Presence of hose allowance text is not full hydraulic verification.",
    reason: hose != null || notes.some((n) => /\bhose\s+allowance\b/i.test(n))
      ? "Hose allowance observed."
      : "Hose allowance not observed.",
  });

  return [densityCheck, hoseCheck];
}

export function runTechnicalChecks(input: TechnicalCheckRunInput): TechnicalCheckRunReport {
  const results: TechnicalCheckResult[] = [];
  for (const sheet of input.sheets || []) {
    results.push(...evaluateGuardrailChecks(sheet));
    results.push(...evaluateDoorScheduleChecks(sheet));
    results.push(...evaluateHydraulicChecks(sheet));
  }
  const summary: Record<TechnicalCheckOutcome, number> = {
    supported_issue: 0,
    no_issue_evidenced: 0,
    unresolved: 0,
    not_applicable: 0,
  };
  for (const result of results) summary[result.outcome] += 1;
  return {
    version: TECHNICAL_CHECKS_VERSION,
    independentlyVerified: false,
    results,
    summary,
  };
}

/**
 * Map technical-check outcomes to Phase 2A.6 adjudication hints (never auto-verified).
 */
export function mapCheckOutcomeToAdjudicationHints(outcome: TechnicalCheckOutcome): {
  findingValidityHint: string;
  evidenceGroundingHint: string;
  note: string;
} {
  switch (outcome) {
    case "supported_issue":
      return {
        findingValidityHint: "needs_more_evidence",
        evidenceGroundingHint: "evidence_present",
        note: "Check supports investigating an analyzer narrative issue; not a professional confirmation.",
      };
    case "no_issue_evidenced":
      return {
        findingValidityHint: "not_reviewed",
        evidenceGroundingHint: "evidence_present",
        note: "Evidence tokens present for the look-for; compliance still not verified.",
      };
    case "unresolved":
      return {
        findingValidityHint: "needs_more_evidence",
        evidenceGroundingHint: "evidence_absent",
        note: "Missing evidence — do not treat as confirmed violation.",
      };
    case "not_applicable":
      return {
        findingValidityHint: "not_applicable",
        evidenceGroundingHint: "not_reviewed",
        note: "Check family does not apply to this sheet.",
      };
    default:
      return {
        findingValidityHint: "not_reviewed",
        evidenceGroundingHint: "not_reviewed",
        note: "Unknown outcome.",
      };
  }
}

/** Reviewer classification enums for the professional benchmark (overall label). */
export const PROFESSIONAL_REVIEW_OUTCOMES = [
  "confirmed_issue",
  "false_positive",
  "partially_supported",
  "insufficient_evidence",
  "not_applicable",
] as const;

export type ProfessionalReviewOutcome = (typeof PROFESSIONAL_REVIEW_OUTCOMES)[number];

export function mapProfessionalReviewToPhase2A6(outcome: ProfessionalReviewOutcome): {
  findingValidity: string;
  technicalCorrectness: string;
} {
  switch (outcome) {
    case "confirmed_issue":
      return { findingValidity: "confirmed_valid", technicalCorrectness: "technically_correct" };
    case "false_positive":
      return { findingValidity: "false_positive", technicalCorrectness: "technically_incorrect" };
    case "partially_supported":
      return { findingValidity: "needs_more_evidence", technicalCorrectness: "technically_uncertain" };
    case "insufficient_evidence":
      return { findingValidity: "needs_more_evidence", technicalCorrectness: "technically_uncertain" };
    case "not_applicable":
      return { findingValidity: "not_applicable", technicalCorrectness: "not_reviewed" };
    default:
      return { findingValidity: "not_reviewed", technicalCorrectness: "not_reviewed" };
  }
}
