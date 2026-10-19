"use strict";

const { decideCandidate, applyDecision, sheetRoles, cleanTopic } = require("./review/verifier.js");
const { resolveReviewState } = require("./review/reviewStates.js");
const {
  isUnselectedJurisdiction,
  resolveJurisdictionDecision,
  jurisdictionDisclosure,
} = require("./review/jurisdictionScope.js");

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

const HOUR_RATING_RE = /\bone\s+hours?\b|\b[1I]\s*h(?:r)?\b|\b\d+(?:\.\d+)?\s*-?\s*(?:hours?|hrs?)\b/i;
const MINUTE_RATING_RE = /\b\d+\s*-?\s*minutes?\b/i;
const CLEARANCE_PAIR_RE = /\b\d{2}\s*[x×]\s*\d{2}\b/i;
const INCH_MARK_RE = /\b\d{2}\s*(?:(?:\"|″)|in(?:ch(?:es)?)?\b)/i;
const AFF_HEIGHT_RE = /\b\d{2}\s*(?:(?:\"|″)|in(?:ch(?:es)?)?\b)?\s*(?:a\.?\s*f\.?\s*f\.?|aff)\b/i;

/**
 * Text the filter may treat as already visible: the PDF text layer plus graphic
 * quotes from image understanding (observedEvidence) and checklist quotes.
 * @param {{ pageText?: string | null; observedEvidence?: unknown; checklist?: unknown } | null | undefined} ctx
 */
function sheetEvidenceText(ctx) {
  const parts = [ctx?.pageText];
  if (Array.isArray(ctx?.observations)) {
    parts.push(
      ctx.observations
        .map((item) => (item && typeof item === "object" ? item.quote || item.observedValue || "" : ""))
        .filter(Boolean)
        .join("\n"),
    );
  }
  return parts.filter(Boolean).join("\n");
}

function corroboratedObservedEvidence(ctx) {
  const observed = ctx?.observedEvidence;
  const quotes = Array.isArray(observed)
    ? observed.filter((item) => typeof item === "string" && item.trim())
    : typeof observed === "string" && observed.trim()
      ? [observed.trim()]
      : [];
  const hay = sheetEvidenceText(ctx).toLowerCase().replace(/\s+/g, " ");
  if (!hay) return [];
  return quotes.filter((quote) => hay.includes(String(quote).toLowerCase().replace(/\s+/g, " ")));
}

function evidenceCorpus(ctx) {
  const parts = [sheetEvidenceText(ctx)];
  const observed = corroboratedObservedEvidence(ctx);
  if (observed.length) parts.push(observed.join("\n"));
  return parts.filter(Boolean).join("\n");
}

/**
 * @param {Record<string, unknown>} issue
 */
function claimText(issue) {
  return `${issue.title || ""} ${issue.description || ""}`;
}

/**
 * @param {Record<string, unknown>} issue
 */
function claimsMissingFact(issue) {
  const claim = claimText(issue);
  if (MEASURED_DEFECT_RE.test(claim) && /\d/.test(claim) && !MISSING_FACT_RE.test(claim)) return false;
  const findingType = String(issue.findingType || "").toLowerCase();
  if (findingType === "confirmed_violation" && !MISSING_FACT_RE.test(claim)) return false;
  return findingType === "missing_information" || findingType === "unverified" || MISSING_FACT_RE.test(claim);
}

/**
 * Drop a missing-information note when the sheet text or graphic quotes already state the fact.
 * Measured defects stay.
 * @param {Record<string, unknown>} issue
 * @param {string | null | undefined} pageText
 */
function pageTextSuppliesMissingFact(issue, pageText) {
  const body = String(pageText || "");
  if (!body.trim()) return false;
  const claim = claimText(issue);
  if (!claimsMissingFact(issue)) return false;
  if (MEASURED_DEFECT_RE.test(claim) && /\d/.test(claim) && !/\bnot shown\b/i.test(claim)) return false;

  const fireOrRatedMissing =
    /\b(fire[\s-]*(rating|resistance|resist)|fire[\s-]*rated|hour\s+rating|rated\s+(?:wall|partition|door)|minute\s+door|door\s+rating|hour\s+(?:wall|partition))\b/i.test(
      claim,
    );
  if (fireOrRatedMissing && (HOUR_RATING_RE.test(body) || MINUTE_RATING_RE.test(body))) {
    return true;
  }

  const seatingMissing = /\b(accessible\s+seating|ada\s+seats?|accessible\s+seats?|seat\s+counts?)\b/i.test(claim);
  if (seatingMissing && (/\bada\b/i.test(body) || /\baccessible\b/i.test(body)) && /\bseats?\b/i.test(body)) {
    return true;
  }

  const clearanceMissing =
    /\b(clear[\s-]*floor(?:\s+space)?|turning\s+space|clearance|wheelchair\s+space|maneuvering)\b/i.test(claim);
  if (
    clearanceMissing &&
    (CLEARANCE_PAIR_RE.test(body) ||
      /\b\d+\s*(?:'|ft|\"|″|in(?:ch(?:es)?)?)\b/i.test(body) ||
      /\d+\s*['′]\s*-?\s*\d+/.test(body))
  ) {
    return true;
  }

  const counterMissing = /\b(counter(?:\s+height)?|work\s*surface|a\.?\s*f\.?\s*f\.?|above\s+finished\s+floor)\b/i.test(
    claim,
  );
  if (counterMissing && (AFF_HEIGHT_RE.test(body) || (/\b(?:34|36)\s*(?:\"|″)/.test(body) && /\b(counter|aff|a\.?\s*f\.?\s*f)\b/i.test(body)))) {
    return true;
  }

  const accessoryMissing = /\b(accessory|accessories|grab\s*bars?|mirror|coat\s*hooks?|dispenser)s?\s+heights?\b/i.test(
    claim,
  );
  if (
    accessoryMissing &&
    INCH_MARK_RE.test(body) &&
    /\b(aff|a\.?\s*f\.?\s*f|height|mirror|grab|dispenser|hook|accessory)\b/i.test(body)
  ) {
    return true;
  }

  const doorWidthMissing = /\bdoor\s+widths?\b/i.test(claim);
  if (doorWidthMissing && INCH_MARK_RE.test(body)) return true;

  if (/\bemergency\s+light/i.test(claim) && /\bemergency\s+light/i.test(body)) return true;
  if (/water[\s-]*hammer/i.test(claim) && /water[\s-]*hammer/i.test(body)) return true;
  if (/\bgfci\b/i.test(claim) && /\bgfci\b/i.test(body)) return true;
  if (/draft[\s-]*stop/i.test(claim) && /draft[\s-]*stop/i.test(body)) return true;
  if (/\binsulation\b/i.test(claim) && /\binsulation\b/i.test(body) && /\b(shall|must|provide[ds]?|specified|r-\d+|thick|inches?)\b/i.test(body)) {
    return true;
  }
  if (/\b(energy|comcheck)\b/i.test(claim) && /\b(energy code certificate|comcheck|certificate of energy compliance)\b/i.test(body)) {
    return true;
  }

  return false;
}

const SHOWN_ON_SHEET_RE = /\bshown\s+on\s+sheet\s+[A-Z]{1,4}(?:\s*[-.]?\s*\d|\d)/i;
const CHECKLIST_DIMENSION_RE =
  /\d+\s*(?:'|′|ft\b|\"|″|in(?:ch(?:es)?)?\b)|\b\d+\s*[x×]\s*\d+\b|\b\d+(?:\.\d+)?\s*-?\s*(?:hours?|hrs?|minutes?|mins?)\b/i;
const QUOTED_NOTE_RE = /[“"][^"”\n]{2,160}[”"]/;
const NEGATED_LABEL_BEFORE_RE = /(?:n't|\b(?:not|no|without|missing|absent|never|un))[\s-]*$/i;

/**
 * "labeled HW-3" can be a quote. "not labeled" and "not labeled E-1.2" cannot.
 * @param {string} value
 */
function hasAffirmativeLabelQuote(value) {
  const pattern = /\b(?:label(?:ed|ling)?|annotation|note)\b\s*[:\-]?\s*[A-Z0-9"“][^.]{1,80}/gi;
  for (const match of value.matchAll(pattern)) {
    const before = value.slice(Math.max(0, match.index - 48), match.index);
    if (NEGATED_LABEL_BEFORE_RE.test(before)) continue;
    return true;
  }
  return false;
}

/**
 * A checklist line is evidence only when it quotes something read from the sheet.
 * A sentence whose claim is that an item is not labeled is not that quote.
 * @param {string} text
 */
function checklistItemHasEvidenceQuote(text) {
  const value = String(text || "");
  if (!value.trim()) return false;
  if (SHOWN_ON_SHEET_RE.test(value)) return true;
  if (CHECKLIST_DIMENSION_RE.test(value)) return true;
  if (QUOTED_NOTE_RE.test(value)) return true;
  if (hasAffirmativeLabelQuote(value)) return true;
  return false;
}

/**
 * @param {Record<string, unknown>} issue
 */
function namesConditionDrawnOnThisSheet(issue) {
  const claim = `${claimText(issue)} ${issue.location || ""}`;
  if (/\b(?:shown|drawn|dimensioned|labeled)\s+(?:on this sheet|here)\b/i.test(claim)) return true;
  if (/\bthis sheet shows\b/i.test(claim)) return true;
  if (MEASURED_DEFECT_RE.test(claim) && /\d/.test(claim) && !MISSING_FACT_RE.test(claim)) return true;
  return false;
}

/**
 * @param {Record<string, unknown>} issue
 */
function namesWhereOnSheet(issue) {
  const loc = String(issue.location || "").trim();
  const blob = `${loc}\n${claimText(issue)}`;
  if (
    /\b(grid\s*[A-Z0-9]|room\s+[A-Z0-9]|door\s*(?:mark|no\.?|#)?\s*[A-Z]?\d+|detail\s+\d+|between\s+(?:col|grid)|stair\s*[A-Z0-9]|corridor\s+[A-Z0-9]|at\s+(?:the\s+)?(?:entry|lobby|kitchen|restroom|stair|corridor|counter))\b/i.test(
      blob,
    )
  ) {
    return true;
  }
  if (/\b(north|south|east|west)\b/i.test(loc)) return true;
  if (loc && !/^(sheet|this sheet|the sheet|drawing|plan|the plan|the drawing|page|n\/a|na|unknown|not specified|general|overall)$/i.test(loc)) {
    return loc.length >= 3;
  }
  return false;
}

const FACT_OWNED_BY_CLASS = [
  {
    claim:
      /\b(restroom|toilet(?:\s+room)?|bath(?:room)?|lavator(?:y|ies))\b[\s\S]{0,80}\b(dimension|size|clearance|width|depth)s?\b|\b(restroom|toilet)\s+(?:room\s+)?(?:dimension|clearance|size)s?\b/i,
    classes: new Set(["enlarged_plan"]),
  },
  {
    claim: /\b(door\s+(?:size|width|hardware)|hardware\s+(?:set|group)|door\s+schedule)\b/i,
    classes: new Set(["schedule"]),
  },
  {
    claim: /\b(egress\s+(?:width|capacity)|exit\s+(?:width|capacity)|occupant\s+load)\b/i,
    classes: new Set(["egress_plan"]),
  },
];

/**
 * @param {{ fileName?: string | null; sheetId?: string | null; title?: string | null }} entry
 * @param {{ sheetTitle?: string | null; sheetId?: string | null }} ctx
 */
function isCurrentSheetEntry(entry, ctx) {
  if (ctx.sheetId && entry.sheetId && String(ctx.sheetId) === String(entry.sheetId)) return true;
  const current = String(ctx.sheetTitle || "").trim().toLowerCase();
  const name = String(entry.fileName || "").trim().toLowerCase();
  if (current && name && current === name) return true;
  return false;
}

/**
 * Drop "missing / not shown" when another included sheet of the owning class is in the set.
 * A condition the finding says is drawn on this sheet stays.
 * @param {Record<string, unknown>} issue
 * @param {{ sheetIndex?: Array<{ fileName?: string | null; contentClass?: string | null; sheetId?: string | null }>; sheetTitle?: string | null; sheetId?: string | null }} ctx
 */
function otherSheetOwnsMissingFact(issue, ctx) {
  if (!claimsMissingFact(issue)) return false;
  if (namesConditionDrawnOnThisSheet(issue)) return false;
  const index = Array.isArray(ctx.sheetIndex) ? ctx.sheetIndex : [];
  if (!index.length) return false;
  const claim = claimText(issue);
  return FACT_OWNED_BY_CLASS.some((rule) => {
    if (!rule.claim.test(claim)) return false;
    return index.some(
      (sheet) => rule.classes.has(String(sheet.contentClass || "")) && !isCurrentSheetEntry(sheet, ctx),
    );
  });
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
  if (/\b12A\s*DCMR\b/i.test(ref) || /\bD\.?C\.?\s+Building Code\b/i.test(ref)) return "12A DCMR";
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
  if ((book === "ICC A117.1" || book === "ADA" || book === "12A DCMR") && labeledIbc) {
    let nextRef = ref.replace(/\bIBC\b\s*/gi, "").trim();
    const alreadyNamed =
      book === "12A DCMR"
        ? /\b(?:12A\s*DCMR|D\.?C\.?\s+Building Code)\b/i.test(nextRef)
        : /\b(?:A117\.1|ADA)\b/i.test(nextRef);
    if (!alreadyNamed) {
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
      const evidence = entry.evidence != null ? String(entry.evidence).trim() : "";
      const parts = [label, result, evidence].filter(Boolean);
      items.push(parts.join(": "));
    }
  }
  return items;
}

/**
 * @param {Record<string, unknown>} issue
 * @param {{ sheetTitle?: string | null; specChunks?: unknown[]; pageText?: string | null; contentClass?: string | null }} ctx
 */
function applyEvidenceGate(issue, ctx) {
  if (pageTextSuppliesMissingFact(issue, evidenceCorpus(ctx))) return null;
  if (otherSheetOwnsMissingFact(issue, ctx)) return null;
  if (isScheduleRequirementRestatement(issue, ctx)) return null;

  const strength = classifyEvidenceStrength(issue);
  const text = `${issue.title || ""} ${issue.description || ""}`;
  const originallyMissing =
    String(issue.findingType || "").toLowerCase() === "missing_information" || MISSING_FACT_RE.test(text);
  const needsMeasure = MEASURABLE_TOPIC_RE.test(text);
  const next = { ...issue, evidenceStrength: strength };

  if (OPERATIONAL_FALSE_POSITIVE_RE.test(text)) {
    return null;
  }

  if (issue.measurableEvidence === true && /\d/.test(text)) {
    if (strength === "strong") next.findingType = "confirmed_violation";
    return next;
  }

  if (strength === "inference" || (needsMeasure && strength !== "strong")) {
    next.findingType = "missing_information";
    next.evidenceTier = "verification";
    next.severity = "advisory";
    const topic = cleanTopic(issue.title || issue.category || "This item");
    next.title = `${topic} — verification required`;
    next.diagnostics = {
      ...(issue.diagnostics || {}),
      originalTitle: issue.title || null,
      originalDescription: issue.description || null,
      originalCodeReference: issue.codeReference || null,
    };
    const question = cleanTopic(issue.description || "")
      .replace(/\b(?:appears|seems)\s+to\s+meet\s+requirements?\b/gi, "")
      .replace(/\bto\s+confirm\s+compliance\b/gi, "")
      .replace(/\b(?:compliance|compliant)\b/gi, "")
      .replace(/\s+but\s+/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
    next.description = question
      ? `${question} This is a question, not a violation. The code citation is unverified.`
      : "This sheet does not show enough to confirm this condition. This is a question, not a violation. The code citation is unverified.";
    next.codeSourceStatus = "unverified";
    next.suggestedFix =
      issue.suggestedFix && !VIOLATION_ASSERT_RE.test(String(issue.suggestedFix))
        ? issue.suggestedFix
        : "Confirm against dimensioned plans, schedules, or specifications; update drawings if a gap is confirmed.";
    next.measurableEvidence = false;
    return markUnlocatedMissingAsUnverified(next, issue, originallyMissing);
  }

  if (strength === "weak") {
    next.findingType = "potential_concern";
    if (next.severity === "critical") next.severity = "warning";
    return markUnlocatedMissingAsUnverified(next, issue, originallyMissing);
  }

  next.findingType = "confirmed_violation";
  if (next.severity === "critical" && strength !== "strong") {
    next.severity = "warning";
  }
  return next;
}

/**
 * A missing-information finding that never says where on the sheet it looked
 * is unverified. It is not a confirmed defect.
 * @param {Record<string, unknown>} next
 * @param {Record<string, unknown>} issue
 * @param {boolean} originallyMissing
 */
function markUnlocatedMissingAsUnverified(next, issue, originallyMissing) {
  if (!originallyMissing || namesWhereOnSheet(issue) || next.findingType === "confirmed_violation") {
    return next;
  }
  next.findingType = "unverified";
  next.severity = "advisory";
  next.evidenceTier = "verification";
  next.measurableEvidence = false;
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
  if (sheetCtx.role === "site_plan" && /\b(stair|riser|tread)\b/i.test(`${issue.title} ${issue.description}`)) {
    return false;
  }
  return (
    sheetCtx.allowedCategories.has(cat) ||
    issue.findingType === "missing_information" ||
    issue.findingType === "unverified"
  );
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
function otherRecordSuppliesFact(issue, ctx) {
  const records = Array.isArray(ctx.drawingRecords) ? ctx.drawingRecords : [];
  for (const record of records) {
    if (isCurrentSheetEntry({ fileName: record.fileName, sheetId: record.sheetId }, ctx)) continue;
    const text = `${record.text || ""}\n${(record.observations || []).map((item) => item.quote || "").join("\n")}`;
    if (pageTextSuppliesMissingFact(issue, text)) return record;
  }
  return null;
}

function hardenIssues(issues, ctx) {
  const sheetCtx = inferSheetReviewContext(ctx.sheetTitle);
  const seen = new Set();
  const out = [];
  const rejectedCandidates = [];

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

    const supplied = otherRecordSuppliesFact(issue, ctx);
    if (supplied) {
      rejectedCandidates.push({
        ...issue,
        validationDisposition: "reject",
        validationReason: "cross_sheet_supplies_fact",
        validationDetail: `Related sheet ${supplied.fileName || supplied.sheetNumber || "in the set"} already states this fact.`,
        userVisible: false,
        provenance: {
          verifier: "cross-sheet",
          fileName: supplied.fileName || null,
          sheetId: supplied.sheetId || null,
          pageNumber: supplied.pageNumber || null,
        },
      });
      continue;
    }

    const decision = decideCandidate(issue, {
      corpus: evidenceCorpus(ctx),
      pageText: ctx.pageText,
      sheetTitle: ctx.sheetTitle,
      fileName: ctx.fileName || ctx.sheetTitle,
      contentClass: ctx.contentClass,
      discipline: ctx.discipline || null,
      projectType: ctx.projectType || null,
      jurisdictionScope: ctx.jurisdictionScope || null,
      regions: ctx.regions || [],
      ruleResults: ctx.ruleResults || [],
      drawingRecords: ctx.drawingRecords || [],
      drawingRetrieval: ctx.drawingRetrieval || null,
      sheetIndex: ctx.sheetIndex || [],
      observations: ctx.observations || [],
      authoritativeCode: ctx.authoritativeCode || [],
    });
    issue = applyDecision(issue, decision);
    if (issue.validationDisposition === "reject") {
      rejectedCandidates.push(issue);
      continue;
    }
    if (!sheetContextAllowsIssue(issue, sheetCtx)) continue;

    const key = dedupKey(issue, ctx.sheetTitle);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(issue);
  }

  return { issues: out, sheetReviewContext: sheetCtx, rejectedCandidates };
}

/**
 * @param {{ issues?: unknown[]; summary?: Record<string, unknown>; jurisdictionNotes?: string }} bundle
 * @param {{ sheetTitle?: string | null; specChunks?: unknown[] }} ctx
 */
function checklistForSheet(checklist, ctx) {
  if (!sheetRoles(ctx || {}).has("equipment") || !Array.isArray(checklist)) return checklist;
  return checklist.filter((item) => {
    const text = typeof item === "string" ? item : `${item?.item || ""} ${item?.result || ""} ${item?.evidence || ""}`;
    return !/corridor/i.test(text);
  });
}

function hardenIssueBundle(bundle, ctx) {
  const checklist = checklistForSheet(bundle.checklist ?? bundle.summary?.checklist, ctx);
  const { issues, sheetReviewContext, rejectedCandidates } = hardenIssues(
    /** @type {Array<Record<string, unknown>>} */ (bundle.issues || []),
    { ...ctx, checklist },
  );
  const summary = buildSummaryFromIssues(issues, bundle.summary?.overallScore, checklist, {
    callStatus: ctx.callStatus || "completed",
    corpusCtx: ctx,
  });
  summary.rejectedCount = rejectedCandidates.length;
  return {
    issues,
    summary,
    rejectedCandidates,
    jurisdictionNotes: bundle.jurisdictionNotes || "",
    sheetReviewContext,
  };
}

/**
 * @param {Array<Record<string, unknown>>} issues
 * @param {number | undefined | null} overallScore
 * @param {unknown} checklist
 */
function codeCoverageVerified(checklistItems, authoritativeCode) {
  const chunks = (Array.isArray(authoritativeCode) ? authoritativeCode : []).filter(
    (chunk) => chunk && chunk.authoritative === true && String(chunk.text || "").trim().length >= 12,
  );
  if (!chunks.length || !checklistItems.length) return false;
  return checklistItems.every((item) => {
    const words = String(item).toLowerCase().match(/[a-z][a-z0-9-]{4,}/g) || [];
    if (!words.length) return false;
    return chunks.some((chunk) => {
      const text = String(chunk.text).toLowerCase();
      return words.some((word) => text.includes(word));
    });
  });
}

function buildSummaryFromIssues(issues, overallScore, checklist, options = {}) {
  const stored = issues || [];
  const corpus = sheetEvidenceText(options.corpusCtx || {}).toLowerCase().replace(/\s+/g, " ");
  const quoteBacked = (item) => {
    const quotes = String(item)
      .split(":")
      .slice(1)
      .map((part) => part.trim().toLowerCase().replace(/\s+/g, " "))
      .filter((part) => part.length >= 8);
    return quotes.some((quote) => corpus.includes(quote));
  };
  const passItems = normalizeChecklist(checklist).filter((item) => checklistItemHasEvidenceQuote(item) || (corpus && quoteBacked(item)));
  const confirmed = stored.filter(
    (issue) => issue.findingType === "confirmed_violation" && issue.validationDisposition !== "reject",
  );
  const openQuestions = stored.filter((issue) => issue.findingType !== "confirmed_violation");
  const critical = confirmed.filter((i) => i.severity === "critical").length;
  const warnings = confirmed.filter((i) => i.severity === "warning").length;
  const advisory = stored.filter((i) => i.severity === "advisory").length;
  const computed = Math.max(0, 100 - critical * 20 - warnings * 10 - advisory * 3);
  const backedItems = corpus ? passItems.filter(quoteBacked) : [];
  const evidenceBacked = passItems.length > 0 && backedItems.length === passItems.length;
  const coverageVerified = evidenceBacked && codeCoverageVerified(backedItems, options.corpusCtx?.authoritativeCode);
  const decision = resolveReviewState({
    callStatus: options.callStatus || "completed",
    confirmedCount: confirmed.length,
    openQuestionCount: openQuestions.length,
    evidenceBacked,
    codeCoverageVerified: coverageVerified,
  });
  let score = decision.overallScore;
  if (decision.reviewState === "reviewed_findings") {
    const modelScore =
      typeof overallScore === "number" && Number.isFinite(overallScore) ? overallScore : computed;
    const capped = modelScore >= 100 ? (computed >= 100 ? 99 : computed) : modelScore;
    score = capped >= 100 ? 99 : capped;
  }
  return {
    totalIssues: stored.length,
    critical,
    warnings,
    advisory,
    confirmedViolations: confirmed.length,
    verificationRequired: stored.filter((i) => i.findingType === "missing_information").length,
    unverified: stored.filter((i) => i.findingType === "unverified").length,
    checklist: passItems,
    cleanChecks: evidenceBacked ? passItems : [],
    reviewState: decision.reviewState,
    overallScore: score,
    codeCoverageVerified: coverageVerified,
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
    rejectedCandidates: single.rejectedCandidates || [],
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
 * Jurisdiction named in title-block or code notes. Does not invent a code book
 * from a bare city name other than the jurisdictions this service already reviews.
 * Washington State is not Washington, D.C.
 * @param {string | null | undefined} text
 * @returns {string | null}
 */
function jurisdictionFromDrawingText(text) {
  const body = String(text || "");
  if (!body.trim()) return null;
  const dcNamed =
    /\bwashington,?\s*d\.?\s*c\.?\b/i.test(body) ||
    /\bdistrict of columbia\b/i.test(body) ||
    /\bd\.?\s*c\.?\s+building code\b/i.test(body) ||
    /\bdc building code\b/i.test(body) ||
    /\b12a\s*dcmr\b/i.test(body);
  if (dcNamed) return "dc";
  if (/\bnew york city\b|\bnyc building code\b|\bnyc\s*bc\b/i.test(body)) return "new-york";
  if (/\bcalifornia building code\b/i.test(body)) return "california";
  if (/\bflorida building code\b/i.test(body)) return "florida";
  if (/\bchicago building code\b/i.test(body)) return "chicago";
  return null;
}

/**
 * Run jurisdiction wins when it is specific. A "general" or empty run uses the
 * project record, then title-block / code notes on the drawings.
 * @param {{ runJurisdiction?: string | null; projectJurisdiction?: string | null; projectCity?: string | null; projectState?: string | null; drawingText?: string | null; pageText?: string | null }} input
 */
function projectLocationKey(input) {
  const city = String(input.projectCity || "").trim().toLowerCase();
  const state = String(input.projectState || "").trim().toLowerCase().replace(/\./g, "");
  const stateIsDc = state === "dc" || state === "district of columbia";
  const cityIsWashington = !city || city === "washington" || city === "washington dc";
  if (stateIsDc && cityIsWashington) return "dc";
  return null;
}

function resolveJurisdictionDecisionFromInput(input = {}) {
  return resolveJurisdictionDecision({
    runJurisdiction: input.runJurisdiction,
    runKey: isUnselectedJurisdiction(input.runJurisdiction)
      ? "general"
      : canonicalJurisdictionKey(input.runJurisdiction),
    projectKey: canonicalJurisdictionKey(input.projectJurisdiction),
    projectLocationKey: projectLocationKey(input),
    detectedFromDrawing: jurisdictionFromDrawingText(input.drawingText || input.pageText),
  });
}

function resolveAnalysisJurisdiction(input = {}) {
  return resolveJurisdictionDecisionFromInput(input).enforcedJurisdiction;
}

function buildJurisdictionDiagnostics(runJurisdiction, documentNameHints, decision) {
  const hints = (documentNameHints || []).join(" ").toLowerCase();
  const detected = [];
  if (/\bwashington,?\s*d\.?c\.?\b|\bdistrict of columbia\b|\b12a dcmr\b|\b4th street sw\b/.test(hints)) {
    detected.push("dc");
  }
  const resolved =
    decision ||
    (String(runJurisdiction || "general").toLowerCase() === "general"
      ? {
          selectionSource: "explicit",
          selectedScope: "general-ibc",
          enforcedJurisdiction: "general",
          detectedLocation: detected[0] || null,
          amendmentsEnforced: false,
          disclosed: detected.length > 0,
        }
      : null);
  const disclosure = jurisdictionDisclosure(resolved, detected);
  return {
    runJurisdiction: runJurisdiction || "general",
    selectedScope: disclosure.selectedScope,
    detectedLocation: disclosure.detectedLocation,
    amendmentsEnforced: disclosure.amendmentsEnforced,
    selectionSource: disclosure.selectionSource,
    detectedJurisdictionHints: detected,
    mismatch: disclosure.mismatch,
    message: disclosure.message,
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
  resolveJurisdictionDecisionFromInput,
  jurisdictionFromDrawingText,
  correctCitationBook,
  pageTextSuppliesMissingFact,
  checklistItemHasEvidenceQuote,
  evidenceCorpus,
  isScheduleRequirementRestatement,
  normalizeChecklist,
  dedupKey,
  semanticDedupKey,
  dedupAgainstRun,
  MEASURABLE_TOPIC_RE,
  INFERENCE_ONLY_RE,
};
