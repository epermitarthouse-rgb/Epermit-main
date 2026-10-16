"use strict";

/** Topics that require measurable or cited evidence before a violation claim. */
const MEASURABLE_TOPIC_RE =
  /\b(width|clearance|slope|ramp|rise|run|riser|tread|dimension|distance|spacing|occupant\s*load|fire\s*rating|rated|hour|accessible\s*parking|parking\s*space|44\s*in|48\s*in|1:12|percent|%)\b/i;

const INFERENCE_ONLY_RE =
  /\b(appear(s|ed|ing)?|may\s+not|might\s+not|could\s+not|does\s+not\s+(show|indicate|clearly)|not\s+(shown|indicated|visible|clearly)|potentially|possibly|suggest(s|ing|ed)?|lack(s|ed|ing)?\s+of|without\s+visible|cannot\s+be\s+verified|unclear)\b/i;

const VIOLATION_ASSERT_RE =
  /\b(insufficient|non-?compliant|does\s+not\s+meet|failed\s+to|violation|not\s+comply|obstruct(ed|ion)|missing\s+required)\b/i;

const OPERATIONAL_FALSE_POSITIVE_RE =
  /\b(parked\s+vehicles?|vehicle(s)?\s+obstruct)\b/i;

/**
 * @param {string | null | undefined} sheetTitle
 * @returns {{ role: string; allowedCategories: Set<string> | null; note: string }}
 */
function inferSheetReviewContext(sheetTitle) {
  const name = String(sheetTitle || "").toLowerCase();
  if (!name || /\b(cover|index|g000|001-cover|002-cover)\b/.test(name)) {
    return {
      role: "cover_index",
      allowedCategories: new Set(["Life Safety", "Zoning"]),
      note: "Cover/index — verify sheet list and code metadata only.",
    };
  }
  if (/\b(site)\b/.test(name)) {
    return {
      role: "site_plan",
      allowedCategories: new Set(["Zoning", "Accessibility", "Life Safety", "Fire Safety"]),
      note: "Site plan — site access, routes, parking; not interior stair rise/run.",
    };
  }
  if (/\b(garage|parking)\b/.test(name)) {
    return {
      role: "garage_plan",
      allowedCategories: new Set(["Fire Safety", "Egress", "Accessibility", "Life Safety"]),
      note: "Garage plan — separation, egress, accessible parking symbols.",
    };
  }
  if (/\b(plaza|floor|level|plan)\b/.test(name) && !/\b(site)\b/.test(name)) {
    return {
      role: "floor_plan",
      allowedCategories: null,
      note: "Floor/plaza plan — egress, accessibility, fire separation where shown.",
    };
  }
  if (/\b(waterproof|detail)\b/.test(name)) {
    return {
      role: "detail",
      allowedCategories: new Set(["Structural", "MEP", "Life Safety"]),
      note: "Detail sheet — assembly/detail compliance only.",
    };
  }
  if (/\b(concrete|structural|repair|\bs\d{3})\b/.test(name)) {
    return {
      role: "structural_detail",
      allowedCategories: new Set(["Structural", "Life Safety"]),
      note: "Structural/repair details — structural checks only.",
    };
  }
  if (/\b(spec|manual|division)\b/.test(name)) {
    return {
      role: "specification",
      allowedCategories: new Set(["Life Safety"]),
      note: "Specification — not a vision-analyzed plan sheet.",
    };
  }
  return { role: "general_plan", allowedCategories: null, note: "General plan sheet." };
}

/**
 * @param {Record<string, unknown>} issue
 * @param {Array<{ sectionNumber?: string; sectionTitle?: string; pageStart?: number; pageEnd?: number }>} specChunks
 */
function validateSpecReferences(issue, specChunks) {
  const refs = issue.specReferences;
  if (!Array.isArray(refs) || refs.length === 0) return [];
  if (!Array.isArray(specChunks) || specChunks.length === 0) return [];
  const allowed = new Set(
    specChunks.map((c) =>
      `${c.sectionNumber || ""}|${c.sectionTitle || ""}|${c.pageStart || ""}`.toLowerCase(),
    ),
  );
  return refs.filter((ref) => {
    const key = `${ref.sectionNumber || ""}|${ref.sectionTitle || ""}|${ref.pageStart || ""}`.toLowerCase();
    if (allowed.has(key)) return true;
    const sn = String(ref.sectionNumber || "")
      .toLowerCase()
      .trim();
    if (!sn) return false;
    return specChunks.some(
      (c) =>
        String(c.sectionNumber || "")
          .toLowerCase()
          .trim() === sn,
    );
  });
}

/**
 * @param {Record<string, unknown>} issue
 * @returns {"strong"|"weak"|"inference"}
 */
function classifyEvidenceStrength(issue) {
  const tier = String(issue.evidenceTier || "").toLowerCase();
  if (tier === "specification" && Array.isArray(issue.specReferences) && issue.specReferences.length > 0) {
    return "strong";
  }
  if (tier === "drawing" && issue.measurableEvidence === true) return "strong";
  if (tier === "verification") return "inference";

  const text = `${issue.title || ""} ${issue.description || ""}`;
  const needsMeasure = MEASURABLE_TOPIC_RE.test(text);
  const hasInference = INFERENCE_ONLY_RE.test(text);
  const assertsViolation = VIOLATION_ASSERT_RE.test(text);

  if (OPERATIONAL_FALSE_POSITIVE_RE.test(text)) return "inference";
  if (needsMeasure && (hasInference || !issue.measurableEvidence)) return "inference";
  if (assertsViolation && hasInference) return "inference";
  if (!needsMeasure && hasInference && !assertsViolation) return "weak";
  if (assertsViolation && !hasInference && !needsMeasure) return "strong";
  if (assertsViolation) return "inference";
  return "weak";
}

const MISSING_FACT_RE =
  /\b(not shown|not indicated|not labeled|not provided|not visible|does not show|cannot be verified|missing)\b/i;
const MEASURED_DEFECT_RE =
  /\b(does not meet|non-?compliant|below|exceeds|less than|greater than|insufficient|too narrow|obstruct)\b/i;

/**
 * Drop a missing-information note when the sheet text already states the fact.
 * Measured defects stay.
 * @param {Record<string, unknown>} issue
 * @param {string | null | undefined} pageText
 */
function pageTextSuppliesMissingFact(issue, pageText) {
  const body = String(pageText || "");
  if (!body.trim()) return false;
  const claim = `${issue.title || ""} ${issue.description || ""}`;
  const findingType = String(issue.findingType || "").toLowerCase();
  if (findingType === "confirmed_violation") return false;
  const claimsMissing = findingType === "missing_information" || MISSING_FACT_RE.test(claim);
  if (!claimsMissing) return false;
  if (MEASURED_DEFECT_RE.test(claim) && /\d/.test(claim) && !/\bnot shown\b/i.test(claim)) return false;

  const fireMissing =
    /\b(fire\s*(rating|resistance|resist)|fire[\s-]*rated|hour\s+rating)\b/i.test(claim) &&
    MISSING_FACT_RE.test(claim);
  if (
    fireMissing &&
    (/\b\d+(?:\.\d+)?\s*-?\s*(?:h(?:ou)?r|hr)\b/i.test(body) || /\b\d+\s*-?\s*minute\b/i.test(body))
  ) {
    return true;
  }

  const seatingMissing = /\b(accessible\s+seating|ada\s+seats?|accessible\s+seats?)\b/i.test(claim);
  if (seatingMissing && MISSING_FACT_RE.test(claim) && /\bada\b/i.test(body) && /\bseats?\b/i.test(body)) {
    return true;
  }

  const clearFloorMissing = /\b(clear[\s-]*floor(?:\s+space)?|turning\s+space)\b/i.test(claim);
  if (
    clearFloorMissing &&
    MISSING_FACT_RE.test(claim) &&
    (/\b\d+\s*(?:'|ft|\"|in(?:ch(?:es)?)?)\b/i.test(body) ||
      /\d+\s*['′]\s*-?\s*\d+/.test(body) ||
      /\b\d{2}\s*(?:x|×)\s*\d{2}\b/.test(body))
  ) {
    return true;
  }

  return false;
}

/**
 * A schedule that already states a hardware requirement must not emit a note that only repeats it.
 * @param {Record<string, unknown>} issue
 * @param {{ pageText?: string | null; contentClass?: string | null }} ctx
 */
function isScheduleRequirementRestatement(issue, ctx) {
  const body = String(ctx.pageText || "");
  const isSchedule =
    ctx.contentClass === "schedule" || /\b(?:door|hardware)\s+schedules?\b/i.test(body);
  if (!isSchedule || !body.trim()) return false;
  const claim = `${issue.title || ""} ${issue.description || ""}`;
  if (MISSING_FACT_RE.test(claim) || MEASURED_DEFECT_RE.test(claim)) return false;
  if (!/\b(required|shall|must|provide|hardware|closer|lockset)\b/i.test(claim)) return false;

  const lower = body.toLowerCase();
  const hardwareSet = claim.match(/\bhardware\s+set\s*\d+\b/i);
  if (hardwareSet && !lower.includes(hardwareSet[0].toLowerCase())) return false;
  if (/\bcloser\b/i.test(claim) && !/\bcloser\b/i.test(body)) return false;
  if (/\blockset\b/i.test(claim) && !/\blockset\b/i.test(body)) return false;
  if (/\bhardware\b/i.test(claim) && !/\bhardware\b/i.test(body)) return false;
  return true;
}

/**
 * @param {string} ref
 * @returns {string | null}
 */
function referencedCitationBook(ref) {
  if (/\b(?:ICC\s*)?A117\.1\b/i.test(ref)) return "ICC A117.1";
  if (/\bADA(?:AG)?\b|\b2010\s+ADA\b/i.test(ref)) return "ADA";
  if (/\b604\.8\.1\.2\b/.test(ref) || /\b604\.8(?:\.\d+){1,3}\b/.test(ref)) return "ICC A117.1";
  if (/\b12A\s*DCMR\b/i.test(ref)) return "12A DCMR";
  if (/\bIBC\b/i.test(ref)) return "IBC";
  return null;
}

/**
 * Relabel a finding whose code book does not match the section it cites.
 * @param {Record<string, unknown>} issue
 * @param {string | null | undefined} codeType
 */
function correctCitationBook(issue, codeType) {
  const ref = String(issue.codeReference || "");
  const book = referencedCitationBook(ref);
  if (!book) return issue;
  const labeledIbc = codeType === "ibc" || /\bIBC\b/i.test(ref);
  if ((book === "ICC A117.1" || book === "ADA") && labeledIbc) {
    let nextRef = ref.replace(/\bIBC\b\s*/gi, "").trim();
    if (!/\b(?:A117\.1|ADA)\b/i.test(nextRef)) {
      nextRef = `${book} ${nextRef}`.replace(/\s+/g, " ").trim();
    }
    return { ...issue, codeReference: nextRef, citationBook: book };
  }
  return issue;
}

/**
 * @param {unknown} raw
 * @returns {string[]}
 */
function normalizeChecklist(raw) {
  if (!Array.isArray(raw)) return [];
  const items = [];
  for (const entry of raw) {
    if (typeof entry === "string") {
      if (entry.trim()) items.push(entry.trim());
      continue;
    }
    if (entry && typeof entry === "object") {
      const label = String(entry.item || entry.check || entry.title || "").trim();
      if (!label) continue;
      const result = entry.result != null ? String(entry.result).trim() : "";
      items.push(result ? `${label}: ${result}` : label);
    }
  }
  return items;
}

/**
 * @param {Record<string, unknown>} issue
 * @param {{ sheetTitle?: string | null; specChunks?: unknown[]; pageText?: string | null; contentClass?: string | null }} ctx
 */
function applyEvidenceGate(issue, ctx) {
  if (pageTextSuppliesMissingFact(issue, ctx.pageText)) return null;
  if (isScheduleRequirementRestatement(issue, ctx)) return null;

  const strength = classifyEvidenceStrength(issue);
  const text = `${issue.title || ""} ${issue.description || ""}`;
  const needsMeasure = MEASURABLE_TOPIC_RE.test(text);
  const next = { ...issue, evidenceStrength: strength };

  if (OPERATIONAL_FALSE_POSITIVE_RE.test(text)) {
    return null;
  }

  if (strength === "inference" || (needsMeasure && strength !== "strong")) {
    next.findingType = "missing_information";
    next.evidenceTier = "verification";
    next.severity = "advisory";
    const topic = String(issue.title || issue.category || "This item").replace(/\.$/, "");
    next.title = `${topic} — verification required`;
    next.description = `This sheet does not provide enough readable evidence to confirm compliance (dimensions, ratings, or explicit annotations). Verify on the appropriate dimensioned life-safety or code sheet before treating as a violation. Original note: ${String(issue.description || "").slice(0, 280)}`;
    next.suggestedFix =
      issue.suggestedFix && !VIOLATION_ASSERT_RE.test(String(issue.suggestedFix))
        ? issue.suggestedFix
        : "Confirm against dimensioned plans, schedules, or specifications; update drawings if a gap is confirmed.";
    next.measurableEvidence = false;
    return next;
  }

  if (strength === "weak") {
    next.findingType = "potential_concern";
    if (next.severity === "critical") next.severity = "warning";
    return next;
  }

  next.findingType = "confirmed_violation";
  if (next.severity === "critical" && strength !== "strong") {
    next.severity = "warning";
  }
  return next;
}

/**
 * @param {Record<string, unknown>} issue
 * @param {ReturnType<inferSheetReviewContext>} sheetCtx
 */
function sheetContextAllowsIssue(issue, sheetCtx) {
  if (!sheetCtx.allowedCategories) return true;
  const cat = String(issue.category || "Life Safety");
  if (sheetCtx.role === "cover_index") {
    return false;
  }
  if (sheetCtx.role === "site_plan" && /\b(stair|rise|run|riser|tread)\b/i.test(`${issue.title} ${issue.description}`)) {
    return false;
  }
  return sheetCtx.allowedCategories.has(cat) || issue.findingType === "missing_information";
}

/** @param {string} s */
function normalizeDedupKeyPart(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * @param {Record<string, unknown>} issue
 * @param {string | null | undefined} sheetTitle
 */
function dedupKey(issue, sheetTitle) {
  return [
    normalizeDedupKeyPart(issue.category),
    normalizeDedupKeyPart(issue.codeReference),
    normalizeDedupKeyPart(issue.title).slice(0, 80),
    normalizeDedupKeyPart(sheetTitle).slice(0, 40),
  ].join("|");
}

/** Cross-sheet dedup: same category + code + substantive title (ignores sheet). */
function semanticDedupKey(issue) {
  const title = normalizeDedupKeyPart(issue.title)
    .replace(/\s*—\s*verification required$/i, "")
    .slice(0, 80);
  return [
    normalizeDedupKeyPart(issue.category),
    normalizeDedupKeyPart(issue.codeReference),
    title,
  ].join("|");
}

/**
 * @param {Array<Record<string, unknown>>} issues
 * @param {Set<string>} existingSemanticKeys
 */
function dedupAgainstRun(existingSemanticKeys, issues) {
  const out = [];
  for (const issue of issues) {
    const key = semanticDedupKey(issue);
    if (existingSemanticKeys.has(key)) continue;
    existingSemanticKeys.add(key);
    out.push(issue);
  }
  return out;
}

/**
 * @param {Array<Record<string, unknown>>} issues
 * @param {{ sheetTitle?: string | null; specChunks?: unknown[]; jurisdictionDiagnostics?: Record<string, unknown> | null; pageText?: string | null; contentClass?: string | null; codeType?: string | null }} ctx
 */
function hardenIssues(issues, ctx) {
  const sheetCtx = inferSheetReviewContext(ctx.sheetTitle);
  const seen = new Set();
  const out = [];

  for (const raw of issues || []) {
    let issue = correctCitationBook({ ...raw }, ctx.codeType);
    issue.specReferences = validateSpecReferences(issue, /** @type {never} */ (ctx.specChunks || []));
    if (
      Array.isArray(ctx.specChunks) &&
      ctx.specChunks.length > 0 &&
      /\bspec(ification)?\b/i.test(`${issue.description}`) &&
      issue.specReferences.length === 0
    ) {
      issue.evidenceTier = "verification";
    }

    issue = applyEvidenceGate(issue, ctx);
    if (!issue) continue;
    if (!sheetContextAllowsIssue(issue, sheetCtx)) continue;

    const key = dedupKey(issue, ctx.sheetTitle);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(issue);
  }

  return { issues: out, sheetReviewContext: sheetCtx };
}

/**
 * @param {{ issues?: unknown[]; summary?: Record<string, unknown>; jurisdictionNotes?: string }} bundle
 * @param {{ sheetTitle?: string | null; specChunks?: unknown[] }} ctx
 */
function hardenIssueBundle(bundle, ctx) {
  const { issues, sheetReviewContext } = hardenIssues(
    /** @type {Array<Record<string, unknown>>} */ (bundle.issues || []),
    ctx,
  );
  const checklist = bundle.checklist ?? bundle.summary?.checklist;
  const summary = buildSummaryFromIssues(issues, bundle.summary?.overallScore, checklist);
  return {
    issues,
    summary,
    jurisdictionNotes: bundle.jurisdictionNotes || "",
    sheetReviewContext,
  };
}

/**
 * @param {Array<Record<string, unknown>>} issues
 * @param {number | undefined | null} overallScore
 * @param {unknown} checklist
 */
function buildSummaryFromIssues(issues, overallScore, checklist) {
  const items = normalizeChecklist(checklist);
  const critical = issues.filter((i) => i.severity === "critical").length;
  const warnings = issues.filter((i) => i.severity === "warning").length;
  const advisory = issues.filter((i) => i.severity === "advisory").length;
  const computed = Math.max(0, 100 - critical * 20 - warnings * 10 - advisory * 3);
  let reviewState = null;
  let score;
  if (issues.length === 0 && items.length > 0) {
    reviewState = "passed";
    score = 100;
  } else if (issues.length === 0) {
    reviewState = "not_reviewed";
    score = null;
  } else {
    score = typeof overallScore === "number" ? overallScore : computed;
  }
  return {
    totalIssues: issues.length,
    critical,
    warnings,
    advisory,
    confirmedViolations: issues.filter((i) => i.findingType === "confirmed_violation").length,
    verificationRequired: issues.filter((i) => i.findingType === "missing_information").length,
    checklist: items,
    reviewState,
    overallScore: score,
  };
}

/**
 * @param {unknown} result
 * @param {string} codeType
 * @param {{ sheetTitle?: string | null; specChunks?: unknown[]; jurisdictionDiagnostics?: Record<string, unknown> | null }} ctx
 */
function hardenAnalysisResult(result, codeType, ctx) {
  if (codeType === "both") {
    const r = /** @type {{ ibc: { issues: unknown[]; summary: Record<string, unknown>; jurisdictionNotes: string }; local: { issues: unknown[]; summary: Record<string, unknown>; jurisdictionNotes: string } }} */ (
      result
    );
    const ibc = hardenIssueBundle(r.ibc, { ...ctx, codeType: "ibc" });
    const local = hardenIssueBundle(r.local, { ...ctx, codeType: "local" });
    return { ibc, local, jurisdictionDiagnostics: ctx.jurisdictionDiagnostics || null };
  }
  const single = hardenIssueBundle(
    /** @type {{ issues: unknown[]; summary: Record<string, unknown>; jurisdictionNotes: string }} */ (result),
    { ...ctx, codeType: ctx.codeType || codeType },
  );
  return {
    issues: single.issues,
    summary: single.summary,
    jurisdictionNotes: single.jurisdictionNotes,
    sheetReviewContext: single.sheetReviewContext,
    jurisdictionDiagnostics: ctx.jurisdictionDiagnostics || null,
  };
}

/**
 * Map a stored project or run jurisdiction onto the analyzer key.
 * Washington, D.C. is "dc". Washington State stays "washington".
 * @param {string | null | undefined} value
 */
function canonicalJurisdictionKey(value) {
  const original = String(value || "").trim();
  if (!original) return "general";
  const lowered = original.toLowerCase().replace(/[._,]/g, " ").replace(/\s+/g, " ").trim();
  if (lowered === "general" || lowered === "general ibc" || lowered === "ibc") return "general";
  const compact = lowered.replace(/[^a-z0-9]+/g, "");
  if (
    compact === "dc" ||
    compact === "washingtondc" ||
    compact === "districtofcolumbia" ||
    compact === "12adcmr" ||
    (compact.includes("washington") && compact.includes("dc") && !compact.includes("state"))
  ) {
    return "dc";
  }
  return lowered.replace(/\s+/g, "-");
}

/**
 * Run jurisdiction wins when it is specific. A "general" run uses the project
 * jurisdiction (or city/state) already stored on the project.
 * @param {{ runJurisdiction?: string | null; projectJurisdiction?: string | null; projectCity?: string | null; projectState?: string | null }} input
 */
function resolveAnalysisJurisdiction(input = {}) {
  const runKey = canonicalJurisdictionKey(input.runJurisdiction);
  if (runKey !== "general") return runKey;
  const projectKey = canonicalJurisdictionKey(input.projectJurisdiction);
  if (projectKey !== "general") return projectKey;
  const city = String(input.projectCity || "").trim().toLowerCase();
  const state = String(input.projectState || "").trim().toLowerCase().replace(/\./g, "");
  const stateIsDc = state === "dc" || state === "district of columbia";
  const cityIsWashington = !city || city === "washington" || city === "washington dc";
  if (stateIsDc && cityIsWashington) return "dc";
  return "general";
}

function buildJurisdictionDiagnostics(runJurisdiction, documentNameHints) {
  const hints = documentNameHints.join(" ").toLowerCase();
  const detected = [];
  if (/\bwashington,?\s*d\.?c\.?\b|\bdistrict of columbia\b|\b12a dcmr\b|\b4th street sw\b/.test(hints)) {
    detected.push("dc");
  }
  const runKey = String(runJurisdiction || "general")
    .toLowerCase()
    .replace(/\s+/g, "-");
  const mismatch =
    detected.length > 0 && runKey === "general" && !detected.includes(runKey);
  return {
    runJurisdiction: runJurisdiction || "general",
    detectedJurisdictionHints: detected,
    mismatch,
    message: mismatch
      ? "Project documents reference Washington, DC, but this run used jurisdiction 'general'. Local amendment analysis may be incomplete — select DC jurisdiction for local findings."
      : null,
  };
}

module.exports = {
  inferSheetReviewContext,
  classifyEvidenceStrength,
  applyEvidenceGate,
  hardenIssues,
  hardenAnalysisResult,
  buildSummaryFromIssues,
  buildJurisdictionDiagnostics,
  canonicalJurisdictionKey,
  resolveAnalysisJurisdiction,
  correctCitationBook,
  pageTextSuppliesMissingFact,
  isScheduleRequirementRestatement,
  normalizeChecklist,
  dedupKey,
  semanticDedupKey,
  dedupAgainstRun,
  MEASURABLE_TOPIC_RE,
  INFERENCE_ONLY_RE,
};
