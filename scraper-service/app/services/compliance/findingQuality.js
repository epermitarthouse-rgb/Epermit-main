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

/**
 * @param {Record<string, unknown>} issue
 * @param {{ sheetTitle?: string | null; specChunks?: unknown[] }} ctx
 */
function applyEvidenceGate(issue, ctx) {
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
 * @param {{ sheetTitle?: string | null; specChunks?: unknown[]; jurisdictionDiagnostics?: Record<string, unknown> | null }} ctx
 */
function hardenIssues(issues, ctx) {
  const sheetCtx = inferSheetReviewContext(ctx.sheetTitle);
  const seen = new Set();
  const out = [];

  for (const raw of issues || []) {
    let issue = { ...raw };
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
  const summary = buildSummaryFromIssues(issues, bundle.summary?.overallScore);
  return {
    issues,
    summary,
    jurisdictionNotes: bundle.jurisdictionNotes || "",
    sheetReviewContext,
  };
}

/**
 * @param {Array<Record<string, unknown>>} issues
 * @param {number | undefined} overallScore
 */
function buildSummaryFromIssues(issues, overallScore) {
  const critical = issues.filter((i) => i.severity === "critical").length;
  const warnings = issues.filter((i) => i.severity === "warning").length;
  const advisory = issues.filter((i) => i.severity === "advisory").length;
  const computed =
    issues.length === 0 ? 100 : Math.max(0, 100 - critical * 20 - warnings * 10 - advisory * 3);
  return {
    totalIssues: issues.length,
    critical,
    warnings,
    advisory,
    confirmedViolations: issues.filter((i) => i.findingType === "confirmed_violation").length,
    verificationRequired: issues.filter((i) => i.findingType === "missing_information").length,
    overallScore: issues.length === 0 ? 100 : typeof overallScore === "number" ? overallScore : computed,
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
    const ibc = hardenIssueBundle(r.ibc, ctx);
    const local = hardenIssueBundle(r.local, ctx);
    return { ibc, local, jurisdictionDiagnostics: ctx.jurisdictionDiagnostics || null };
  }
  const single = hardenIssueBundle(
    /** @type {{ issues: unknown[]; summary: Record<string, unknown>; jurisdictionNotes: string }} */ (result),
    ctx,
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
 * @param {string | null | undefined} runJurisdiction
 * @param {string[]} documentNameHints
 */
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
  buildJurisdictionDiagnostics,
  dedupKey,
  semanticDedupKey,
  dedupAgainstRun,
  MEASURABLE_TOPIC_RE,
  INFERENCE_ONLY_RE,
};
