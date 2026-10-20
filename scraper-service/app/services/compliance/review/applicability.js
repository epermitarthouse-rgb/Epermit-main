"use strict";

const { extractIdentifiers, normalizeIdentifier } = require("../rag/identifiers.js");
const { parseClaim, attributeEvidence, sheetDiscipline, reconcileCalculation, answerRank } = require("./evaluation.js");

const TOKEN_STOP = new Set([
  "this", "that", "with", "from", "have", "been", "sheet", "shown", "show", "indicate",
  "indicated", "required", "requirement", "compliance", "comply", "design", "provide",
  "provided", "missing", "information", "verification", "confirm", "review", "drawing",
  "drawings", "plan", "plans", "note", "notes", "which", "shall", "must", "will", "only",
  "also", "into", "over", "under", "than", "then", "them", "they", "their", "there",
  "where", "when", "what", "about", "after", "before", "while", "does", "doesn",
]);

function claimText(issue) {
  return [
    issue?.title,
    issue?.description,
    issue?.location,
    issue?.diagnostics?.originalTitle,
    issue?.diagnostics?.originalDescription,
  ].filter(Boolean).join(" ");
}

const MISSING_CLAIM_RE =
  /\b(not shown|not provided|not indicated|not labeled|not specified|missing|absent|does not (?:show|specify|provide|indicate|include|identify|define|clearly indicate|clearly show)|lacks?|lacking|incomplete|unclear|unknown|undefined|no (?:details?|information|specification))\b/i;

function claimsMissing(issue) {
  const claim = claimText(issue);
  const findingType = String(issue?.findingType || "").toLowerCase();
  if (findingType === "confirmed_violation" && !MISSING_CLAIM_RE.test(claim)) {
    return false;
  }
  return findingType === "missing_information"
    || findingType === "unverified"
    || MISSING_CLAIM_RE.test(claim);
}

/** Exit, egress, and evacuation routes are owned by architectural or life-safety sheets. */
function isEgressRouteClaim(issue) {
  return /\b(egress|exit(?:\s+(?:path|route|access|discharge))?|means of egress|evacuation)\b/i.test(claimText(issue))
    && !/\bexit\s*signs?\b|\bemergency\s+light/i.test(claimText(issue));
}

/**
 * Text that describes trade coordination, field conditions, contractor means and
 * methods, or a generic "practice" names no code requirement to review against.
 */
function namesNoRequirement(issue) {
  const claim = `${issue?.title || ""} ${issue?.description || ""}`;
  if (/\b(coordinat(?:e|ed|ion)\s+with\s+(?:other\s+)?trades|field\s+conditions?|may\s+vary|routes?\s+(?:as\s+shown\s+)?(?:are\s+)?(?:general|diagrammatic|schematic))\b/i.test(claim)) {
    return "trade_coordination_note";
  }
  if (/\b(standard|best|good|industry)\s+(?:cable\s+management\s+)?practices?\b/i.test(claim)) {
    return "practice_not_requirement";
  }
  if (/\b(means and methods|safety procedures?|procedures? for (?:safe\s+)?removal|safe removal)\b/i.test(claim)) {
    return "contractor_means_and_methods";
  }
  return null;
}

/** The finding says the sheet's own notes already state the item and only asks to verify it. */
function restatesSheetNote(issue) {
  const claim = `${issue?.title || ""} ${issue?.description || ""}`;
  return /\b(notes?|the sheet|this sheet|the plan)\s+(?:on the sheet\s+)?(?:indicate|indicates|specif(?:y|ies)|require|requires|state|states|call(?:s)? for)\s+that\b/i.test(claim)
    && !MISSING_CLAIM_RE.test(claim)
    && !/\b(does not meet|non-?compliant|insufficient|below|less than)\b/i.test(claim);
}

function inferOccupancy(projectType, corpus) {
  const type = String(projectType || "").toLowerCase();
  const text = `${type}\n${String(corpus || "").slice(0, 6000)}`.toLowerCase();
  const commercialType = /\b(commercial|restaurant|retail|mercantile|assembly|business)\b/.test(type);
  const residentialType = /\b(residential|dwelling|single[- ]family|multi[- ]family|apartment house)\b/.test(type);
  const residentialUse = /\b(occupancy group\s*r\b|group r-?[1-4]\b|dwelling units?\b|residential occupancy)\b/.test(text);
  const commercialUse = /\b(occupancy group\s*[abmef]\b|group [abm]\b|restaurant\b|assembly occupancy|mercantile occupancy)\b/.test(text);
  if ((commercialType || commercialUse) && (residentialType || residentialUse)) return "mixed";
  if (commercialType && !residentialUse) return "commercial";
  if (residentialType && !commercialUse) return "residential";
  if (commercialUse && !residentialUse) return "commercial";
  if (residentialUse && !commercialType) return "residential";
  return "unknown";
}

function inferWorkScope(corpus) {
  const text = String(corpus || "").toLowerCase();
  const demolition = /\bdemolition\b/.test(text);
  const alteration = /\b(alteration|renovation|tenant improvement)\b/.test(text);
  const built = /\b(new construction|new building)\b/.test(text);
  if (demolition && !alteration && !built) return "demolition";
  if (alteration) return "alteration";
  if (built) return "new_construction";
  if (demolition) return "demolition";
  return "unknown";
}

function documentRoles(ctx) {
  const name = `${ctx?.fileName || ""} ${ctx?.sheetTitle || ""} ${ctx?.title || ""}`;
  const head = String(ctx?.pageText || ctx?.corpus || "").slice(0, 2500);
  const blob = `${name} ${ctx?.contentClass || ""} ${ctx?.discipline || ""} ${head}`.toLowerCase();
  const prefix = ((name.match(/(?:^|[\s/])([A-Za-z]{1,3})[-.]?\d/) || [])[1] || "").toUpperCase();
  const roles = new Set();
  if (prefix === "E" || /\belectrical\b|\blighting plan\b|\bpower plan\b/.test(blob)) roles.add("electrical");
  if (prefix === "EQ" || /\bequipment plan\b|\bkitchen equipment\b|\bfoodservice equipment\b/.test(blob)) roles.add("equipment");
  if (prefix === "S" || /\bstructural\b|\bfoundation plan\b|\bframing plan\b/.test(blob)) roles.add("structural");
  if (prefix === "P" || /\bplumbing\b/.test(blob)) roles.add("plumbing");
  if (prefix === "M" || /\bmechanical\b|\bhvac\b/.test(blob)) roles.add("mechanical");
  if (/\b(comcheck|energy code certificate|energy compliance certificate|certificate of energy compliance)\b/.test(blob)) {
    roles.add("energy_certificate");
  }
  if (/\bspecial inspection/.test(blob)) roles.add("special_inspection");
  if (prefix === "A" || prefix === "LS" || /\b(floor plan|egress plan|life safety plan|architectural plan)\b/.test(blob)) {
    roles.add("architectural");
  }
  return roles;
}

/** Disciplines whose sheets normally state a topic. Empty when the topic is not recognized. */
const TOPIC_OWNERS = [
  [/\b(emergency\s+light\w*|exit\s+signs?|grounding|conductors?|panel(?:board)?s?|circuits?|receptacles?|gfci)\b/i, ["E"]],
  [/\b(sprinklers?|standpipes?|fire\s+alarm|fire\s+pumps?|hydraulic)\b/i, ["FP"]],
  [/\b(insulation)\b/i, ["M", "P"]],
  [/\b(grease\s+interceptors?|backflow|water\s+hammer|fixtures?|drains?|water\s+service|expansion\s+tank|valves?)\b/i, ["P"]],
  [/\b(duct(?:work)?|dampers?|ventilation|exhaust|hoods?|hvac|diffusers?)\b/i, ["M"]],
  [/\b(structural|connections?|beams?|joists?|truss(?:es)?|footings?|anchorage|special\s+inspections?|shoring|temporary\s+support|fasteners?)\b/i, ["S"]],
  [/\b(fire[\s-]*(?:rat(?:ed|ing)|separation|resist\w*|barriers?|partitions?)|rated\s+(?:assembl|partition|wall)\w*|egress|corridors?|exits?|stairs?|ramps?|accessib\w*|guard(?:rail)?s?|handrails?|counters?|clearances?|doors?|restrooms?|toilet)\b/i, ["A"]],
  [/\b(energy|comcheck)\b/i, ["EN", "A", "M", "E"]],
];

/**
 * Another sheet answers a claim only when it states the fact next to the claim's
 * subject, and the sheet is the same discipline, a general/notes sheet, or a
 * discipline that owns the topic. A fact elsewhere on an unrelated sheet is not an answer.
 * @param {Record<string, unknown>} issue
 * @param {Record<string, unknown>} record
 * @param {Record<string, unknown>} ctx
 * A recognized element is answered only by a passage about that element that states every
 * attribute the claim names.
 * @param {(passage: string) => boolean} statesFact
 */
function recordCanAnswer(issue, record, ctx, statesFact) {
  const parsed = parseClaim(issue);
  const titleObjective = objectiveTokens({ title: issue?.diagnostics?.originalTitle || issue?.title || "" }).tokens;
  const subject = titleObjective.length ? titleObjective : subjectTokens(issue);
  if (!subject.length && !parsed.element) return false;
  const own = sheetDiscipline({ fileName: ctx?.fileName || ctx?.sheetTitle, sheetNumber: ctx?.sheetNumber });
  const theirs = sheetDiscipline(record);
  const claim = `${issue?.diagnostics?.originalTitle || issue?.title || ""} ${issue?.description || ""}`;
  const owners = new Set(parsed.element
    ? parsed.element.owners
    : TOPIC_OWNERS.filter(([pattern]) => pattern.test(claim)).flatMap(([, list]) => list));
  const general = theirs === "G" || isGeneralNotesSheet({ fileName: record?.fileName, sheetTitle: record?.title, contentClass: record?.contentClass });
  const sameDiscipline = Boolean(own) && theirs === own;
  if (!general && !sameDiscipline && !owners.has(theirs)) return false;
  const body = recordBody(record);
  if (parsed.element) {
    return answerRank(parsed, own, record) >= 0
      && attributeEvidence([{ text: body }], parsed).answered && statesFact(body);
  }
  const lower = body.toLowerCase();
  for (const token of subject) {
    let from = 0;
    while (from < lower.length) {
      const at = lower.indexOf(token, from);
      if (at < 0) break;
      if (statesFact(body.slice(Math.max(0, at - 200), at + token.length + 200))) return true;
      from = at + token.length;
    }
  }
  return false;
}

function establishReviewContext(input = {}) {
  const recordText = (input.drawingRecords || []).map((record) => record?.text || "").join("\n");
  const corpus = `${input.projectType || ""}\n${input.pageText || ""}\n${recordText}`;
  return {
    occupancy: inferOccupancy(input.projectType, corpus),
    workScope: inferWorkScope(corpus),
    documentRoles: [...documentRoles(input)],
    discipline: input.discipline || null,
    code: {
      jurisdiction: input.jurisdiction || input.jurisdictionScope?.enforcedJurisdiction || null,
      edition: input.codeYear || null,
      amendmentsEnforced: input.jurisdictionScope ? Boolean(input.jurisdictionScope.amendmentsEnforced) : null,
    },
  };
}

function isTypeADwellingClaim(issue) {
  const claim = claimText(issue);
  return /\btype\s*a\b/i.test(claim) && /\b(dwelling|residential unit|sleeping unit|apartment unit)\b/i.test(claim);
}

function isAccessibleRouteGap(issue) {
  return /\b(accessible route|accessibility|accessible entrance)\b/i.test(claimText(issue)) && claimsMissing(issue);
}

function isEgressWidthClaim(issue) {
  const claim = claimText(issue);
  return /\bwidth\b/i.test(claim) && /\b(egress|corridor|exit access)\b/i.test(claim);
}

function isGeneralNotesSheet(ctx) {
  const name = `${ctx?.fileName || ""} ${ctx?.sheetTitle || ""} ${ctx?.title || ""} ${ctx?.contentClass || ""}`.toLowerCase();
  if (/\bgeneral notes?\b/.test(name) || /\bcover sheet\b/.test(name) || /\bsheet index\b/.test(name) || ctx?.contentClass === "general_notes") {
    return true;
  }
  const prefix = ((name.match(/(?:^|[\s/])([a-z]{1,3})[-.]?\d/) || [])[1] || "");
  return prefix === "g" && !/\b(floor plan|egress plan|life safety)\b/.test(name);
}

function affirmativeNear(body, token) {
  const source = String(body || "");
  const needle = String(token || "").toLowerCase();
  if (needle.length < 4) return false;
  const lower = source.toLowerCase();
  let from = 0;
  while (from < lower.length) {
    const at = lower.indexOf(needle, from);
    if (at < 0) break;
    const window = lower.slice(Math.max(0, at - 90), at + needle.length + 90);
    if (/\b(shall|must|provide[ds]?|specified|specification|required|r-\d+|thick|inches?)\b/.test(window)) return true;
    from = at + needle.length;
  }
  return false;
}

function documentationTokens(issue) {
  return distinctiveTokens(claimText(issue)).filter((token) => ![
    "documentation", "information", "details", "detail", "missing", "required", "compliance", "requirement",
  ].includes(token));
}

function isEgressGap(issue) {
  return /\begress\b/i.test(claimText(issue)) && claimsMissing(issue);
}

function isSpecialInspectionGap(issue) {
  return /\bspecial inspection/i.test(claimText(issue)) && claimsMissing(issue);
}

function recordBody(record) {
  return [record?.text, record?.excerpt, record?.fullText, record?.title, record?.fileName, ...(record?.observations || []).map((item) => item?.quote || "")]
    .filter(Boolean)
    .join("\n");
}

function sameRecord(record, ctx) {
  if (ctx?.sheetId && record?.sheetId && String(ctx.sheetId) === String(record.sheetId)) return true;
  const current = String(ctx?.fileName || ctx?.sheetTitle || "").trim().toLowerCase();
  const name = String(record?.fileName || "").trim().toLowerCase();
  return Boolean(current && name && current === name);
}

function retrievalState(ctx) {
  const records = [];
  if (Array.isArray(ctx?.drawingRecords)) records.push(...ctx.drawingRecords);
  if (Array.isArray(ctx?.sheetIndex)) {
    for (const sheet of ctx.sheetIndex) {
      records.push({
        fileName: sheet.fileName || null,
        sheetNumber: sheet.sheetNumber || null,
        title: sheet.title || null,
        text: sheet.fullText || sheet.excerpt || "",
        contentClass: sheet.contentClass || null,
        sheetId: sheet.sheetId || null,
      });
    }
  }
  const flagged = ctx?.drawingRetrieval && ctx.drawingRetrieval.available === false;
  return { records, unavailable: Boolean(flagged) && records.length === 0 };
}

function specialInspectionSources(records, pageText, ctx) {
  const sources = [];
  const consider = (label, text) => {
    if (/\bspecial inspection/i.test(text) && /\b(statement|required|schedule|chapter\s*17|inspector)\b/i.test(text)) {
      sources.push(label || "project document");
    }
  };
  consider("this sheet", pageText || "");
  for (const record of records || []) {
    if (sameRecord(record, ctx)) continue;
    consider(record.fileName || record.sheetNumber || record.title || "another project document", recordBody(record));
  }
  return sources;
}

function distinctiveTokens(text) {
  return [...new Set((String(text || "").toLowerCase().match(/[a-z][a-z0-9-]{4,}/g) || [])
    .filter((token) => !TOKEN_STOP.has(token)))];
}

function namesConditionOnThisSheet(issue) {
  return /\b(?:shown|drawn|dimensioned|labeled)\s+(?:on this sheet|here)\b/i.test(claimText(issue))
    || /\bthis sheet shows\b/i.test(claimText(issue));
}

function isVagueMissingClaim(issue) {
  if (!claimsMissing(issue)) return false;
  const claim = claimText(issue);
  if (/\b(grid|room|door|detail|schedule|legend|corridor|stair|partition)\b/i.test(claim)) return false;
  if (String(issue?.location || "").trim().length >= 3) return false;
  if (/\d/.test(claim)) return false;
  return distinctiveTokens(claim).length < 2;
}

function searchProjectEvidence(issue, ctx) {
  const { records, unavailable } = retrievalState(ctx);
  if (!claimsMissing(issue) || namesConditionOnThisSheet(issue)) {
    return { resolved: false, unavailable, places: [] };
  }
  const claim = claimText(issue);
  const tokens = distinctiveTokens(claim).slice(0, 8);
  // Only measured values with a unit count; code years and section numbers are not measures.
  const measures = (claim.match(/\b\d+(?:\.\d+)?\s*(?:"|″|'|′|inch(?:es)?|in\.|ft|feet|hours?|hr|minutes?|psf|lbs?|pounds)/gi) || [])
    .map((value) => value.match(/\d+(?:\.\d+)?/)[0]);
  const measureNear = (passage) => {
    const lower = passage.toLowerCase();
    return measures.some((number) => new RegExp(`(^|[^\\d.])${number.replace(".", "\\.")}(?![\\d])`).test(lower))
      && tokens.filter((token) => lower.includes(token)).length >= 2;
  };
  for (const record of records) {
    if (!record || sameRecord(record, ctx)) continue;
    const text = recordBody(record).toLowerCase();
    if (!text.trim()) continue;
    const hits = tokens.filter((token) => text.includes(token));
    const identifierHit = extractIdentifiers(claim).some((ident) => {
      const wanted = normalizeIdentifier(ident);
      const sheetNumber = normalizeIdentifier(record.sheetNumber || "");
      const fileName = normalizeIdentifier(record.fileName || "");
      return wanted && (sheetNumber === wanted || fileName.includes(wanted));
    });
    const measured = measures.length > 0 && recordCanAnswer(issue, record, ctx, measureNear);
    if ((identifierHit && hits.length >= 2) || measured) {
      return {
        resolved: true,
        unavailable,
        where: record.fileName || record.sheetNumber || record.title || "another sheet",
        places: [],
      };
    }
  }
  const places = [];
  const placeTokens = objectiveTokens(issue).tokens;
  for (const record of records) {
    if (!record || sameRecord(record, ctx)) continue;
    const text = recordBody(record).toLowerCase();
    const shared = placeTokens.filter((token) => text.includes(token));
    if (!shared.length) continue;
    const label = record.fileName || record.sheetNumber || record.title;
    if (label && !places.includes(label) && places.length < 3) places.push(label);
  }
  return { resolved: false, unavailable, places };
}

function questionText(issue, search) {
  const what = String(issue?.title || "This condition").replace(/\s+/g, " ").trim();
  const why = issue?.category
    ? `It matters because this ${String(issue.category).toLowerCase()} item is still open after the indexed sheets were searched.`
    : "It matters because the indexed sheets do not resolve it.";
  const where = search.places?.length
    ? `Look at ${search.places.slice(0, 3).join(", ")} and the related schedules, legends, and details.`
    : "Look at the related schedules, legends, details, specifications, and the discipline sheet that owns this element.";
  return `${what} remains unresolved. ${why} ${where}`;
}

/**
 * Reject a finding the current occupancy, document, or project evidence cannot support.
 * @param {Record<string, unknown>} issue
 * @param {Record<string, unknown>} ctx
 */
function assessApplicability(issue, ctx) {
  const roles = documentRoles({ ...ctx, pageText: ctx.pageText || ctx.corpus });
  const occupancy = inferOccupancy(ctx.projectType, `${ctx.pageText || ""}\n${ctx.corpus || ""}`);
  const context = {
    occupancy,
    workScope: inferWorkScope(`${ctx.pageText || ""}\n${ctx.corpus || ""}`),
    documentRoles: [...roles],
  };

  if (occupancy === "commercial" && isTypeADwellingClaim(issue)) {
    return {
      disposition: "reject",
      reason: "residential_requirement_on_commercial",
      detail: "A commercial occupancy does not take residential Type A dwelling-unit requirements.",
      projectContext: context,
    };
  }

  if ((roles.has("structural") || roles.has("electrical")) && !roles.has("architectural") && isAccessibleRouteGap(issue)) {
    return {
      disposition: "reject",
      reason: "accessible_route_outside_discipline",
      detail: "A structural or electrical drawing is not independently faulted for an architectural accessible route.",
      projectContext: context,
    };
  }

  if ((roles.has("electrical") || roles.has("equipment")) && !roles.has("architectural") && isAccessibleRouteGap(issue)) {
    return {
      disposition: "reject",
      reason: "accessible_route_outside_discipline",
      detail: "An electrical or equipment plan is not independently faulted for architectural accessible-route documentation.",
      projectContext: context,
    };
  }

  const nonRequirement = namesNoRequirement(issue);
  if (nonRequirement) {
    return {
      disposition: "reject",
      reason: nonRequirement,
      detail: "The candidate names no applicable code requirement or review objective, so it is not a compliance finding.",
      projectContext: context,
    };
  }

  if (
    isEgressRouteClaim(issue) &&
    !isEgressWidthClaim(issue) &&
    !roles.has("architectural") &&
    (roles.has("electrical") || roles.has("plumbing") || roles.has("mechanical") || roles.has("structural") || roles.has("equipment"))
  ) {
    return {
      disposition: "reject",
      reason: "egress_outside_discipline",
      detail: "An engineering discipline sheet does not establish exit or egress routes. Egress is reviewed on the architectural and life-safety sheets.",
      projectContext: context,
    };
  }

  if (restatesSheetNote(issue)) {
    return {
      disposition: "reject",
      reason: "documented_design_provision",
      detail: "The sheet's own note states this requirement. The note is not a deficiency, and it is not proof the installed work complies.",
      projectContext: context,
    };
  }

  if (isEgressWidthClaim(issue) && isGeneralNotesSheet(ctx)) {
    return {
      disposition: "reject",
      reason: "egress_width_outside_sheet",
      detail: "Egress width is not established from a general-notes or cover sheet.",
      projectContext: context,
    };
  }

  if (roles.has("energy_certificate") && isEgressGap(issue)) {
    return {
      disposition: "reject",
      reason: "egress_outside_energy_certificate",
      detail: "An energy certificate is not reviewed for an unrelated egress plan.",
      projectContext: context,
    };
  }

  if (claimsMissing(issue) && !isSpecialInspectionGap(issue)) {
    const parsed = parseClaim(issue);
    const tokens = documentationTokens(issue);
    // Documentation-style gaps close on one specified token. Other missing-detail
    // claims need two distinct tokens stated as a requirement before they close.
    const needed = /\b(documentation|information|insulation)\b/i.test(claimText(issue)) ? 1 : 2;
    const specifies = parsed.element
      ? (body) => attributeEvidence([{ text: body }], parsed).answered
      : (body) => tokens.filter((token) => affirmativeNear(body, token)).length >= needed;
    const here = `${ctx.pageText || ""}\n${ctx.corpus || ""}`;
    if (specifies(here)) {
      return {
        disposition: "reject",
        reason: "requirement_already_specified",
        detail: "The sheet already specifies this item. The note is not a missing-information finding.",
        projectContext: context,
      };
    }
    const { records } = retrievalState(ctx);
    for (const record of records) {
      if (!record || sameRecord(record, ctx)) continue;
      if (!recordCanAnswer(issue, record, ctx, specifies)) continue;
      const where = record.fileName || record.sheetNumber || record.title || "another sheet";
      return {
        disposition: "reject",
        reason: "cross_sheet_answers_question",
        detail: `${where} already specifies this item.`,
        redirectFile: where,
        projectContext: context,
      };
    }
  }

  if ((roles.has("structural") || roles.has("special_inspection")) && isSpecialInspectionGap(issue)) {
    const { records, unavailable } = retrievalState(ctx);
    const sources = specialInspectionSources(records, ctx.pageText || ctx.corpus, ctx);
    if (sources.length) {
      return {
        disposition: "reject",
        reason: "special_inspection_documented",
        detail: `Special-inspection documentation is already in the project (${sources[0]}).`,
        projectContext: context,
      };
    }
    if (unavailable) {
      return {
        disposition: "retain_limitation",
        reason: "special_inspection_retrieval_unavailable",
        detail: "Whether the project includes special-inspection documentation is unresolved. Drawing retrieval was unavailable, so this is not a determination that the documentation was checked. Look at the structural notes and the statement of special inspections when retrieval is available.",
        projectContext: context,
      };
    }
  }

  return { disposition: "continue", projectContext: context };
}

const FACT_TERMS = [
  ["travel distance", /\btravel\s+distances?\b/i],
  ["egress capacity", /\begress\s+capacit(?:y|ies)\b/i],
  ["occupant load", /\boccupant\s+loads?\b|\boccupancy\s+calculations?\b/i],
  ["riser and tread dimensions", /\b(?:risers?|treads?)\b/i],
  ["clearance", /\bclearances?\b|\bclear\s+floor\s+space\b|\bturning\s+space\b/i],
  ["fire-resistance rating", /\bfire[\s-]*(?:resistance|resistive)?[\s-]*(?:rating|rated)s?\b|\bhour\s+ratings?\b/i],
  ["width", /\bwidths?\b/i],
  ["slope", /\bslopes?\b/i],
  ["height", /\bheights?\b/i],
  ["dimensions", /\bdimension(?:s|ed)?\b/i],
  ["location", /\blocations?\b|\bplacements?\b/i],
  ["size", /\bsiz(?:e|es|ing)\b/i],
  ["spacing", /\bspacing\b/i],
  ["thickness", /\bthickness(?:es)?\b/i],
  ["flow rate", /\bflow\s+rates?\b/i],
  ["setpoint", /\bset\s*points?\b/i],
  ["illumination level", /\bfoot[\s-]*candles?\b|\billumination\s+levels?\b/i],
];
const HEDGE_RE = /\b(?:if\s+(?:present|any|applicable|provided)|where\s+(?:applicable|present|provided))\b/i;
const QUESTION_BOILERPLATE_RE = /This is a question, not a violation\.|The code citation is unverified\.|\s*[—-]\s*verification required/gi;
const DEFICIENCY_RE = new RegExp(
  `${MISSING_CLAIM_RE.source}|\\b(?:exceeds?|insufficient|inadequate|not\\s+(?:meet|comply|clearly)|below|fails?|conflicts?|discrepanc\\w*|inconsisten\\w*|non-?complian\\w*|may\\s+not|does\\s+not|cannot)\\b`,
  "i",
);
const NORMATIVE_RE = /\b(?:must|should|shall|ensure|needs?\s+to|required\s+to|are\s+required)\b/i;

function originalClaim(issue) {
  return [
    issue?.diagnostics?.originalTitle || issue?.title,
    issue?.diagnostics?.originalDescription || issue?.description,
  ].filter(Boolean).join(". ").replace(QUESTION_BOILERPLATE_RE, " ");
}

/** The specific facts a candidate says are unresolved, without facts named only as "if present". */
function namedFacts(issue) {
  const clauses = originalClaim(issue).split(/[,;.]|\band\b/i).filter((clause) => !HEDGE_RE.test(clause));
  const facts = [];
  for (const [label, pattern] of FACT_TERMS) {
    if (clauses.some((clause) => pattern.test(clause)) && !facts.includes(label)) facts.push(label);
  }
  return facts;
}

/** States what a design must do without saying what this sheet lacks or shows wrong. */
function isRequirementReminder(issue) {
  const claim = originalClaim(issue);
  return NORMATIVE_RE.test(claim) && !DEFICIENCY_RE.test(claim);
}

function factStatedOnSheet(fact, ctx) {
  const entry = FACT_TERMS.find(([label]) => label === fact);
  return Boolean(entry && entry[1].test(String(ctx?.pageText || "")));
}

const COMPARED_VALUE_RE =
  /\b(\d+(?:\.\d+)?)\s*(?:gpm|psi|cfm|°\s*f|degrees?\s*f|gallons?|lbs?|psf|kw|kva|amps?|volts?|inch(?:es)?|in\.|ft|feet|"|″)/gi;

/**
 * Two or more different measured values from the claim, all printed on the sheet, are a
 * discrepancy read from the drawing, unless a calculation printed on the sheet connects them.
 */
function tracesValueComparison(issue, corpus) {
  const claim = `${issue?.diagnostics?.originalDescription || ""} ${issue?.title || ""} ${issue?.description || ""}`;
  const values = [...new Set([...claim.matchAll(COMPARED_VALUE_RE)].map((match) => match[1]))];
  if (values.length < 2) return null;
  if (reconcileCalculation(issue, corpus)?.explained) return null;
  const hay = String(corpus || "");
  const printed = values.filter((value) => new RegExp(`(^|[^\\d.])${value.replace(".", "\\.")}(?![\\d])`).test(hay));
  return printed.length >= 2 ? printed : null;
}

/**
 * A candidate that only restates what a design must do. It is withdrawn when it names no fact,
 * and it stays an unresolved check when the fact it names is not on this sheet.
 */
function requirementReminderDecision(issue, ctx) {
  if (!isRequirementReminder(issue) || tracesValueComparison(issue, ctx?.pageText)) return null;
  const search = searchProjectEvidence(issue, ctx);
  if (search.resolved) return null;
  const open = namedFacts(issue).filter((fact) => !factStatedOnSheet(fact, ctx));
  const what = String(issue?.diagnostics?.originalTitle || issue?.title || "This condition")
    .replace(QUESTION_BOILERPLATE_RE, "").replace(/\s+/g, " ").trim();
  if (!open.length) {
    return {
      disposition: "reject",
      reason: "no_specific_condition",
      detail: `${what} restates a requirement without naming a fact this sheet lacks, so it is not published.`,
    };
  }
  return {
    disposition: "reject",
    reason: "requirement_reminder",
    detail: `${what}: the ${open.join(" and ")} is not stated on this sheet and was not found on a related sheet. The candidate only restated the requirement, so this stays an unresolved check.`,
  };
}

const DRAWING_TITLE_RE = /\bscale\s*:|\bn\.?\s*t\.?\s*s\.?\b|\d+\/\d+"?\s*=\s*1'/i;

/** The element is named only in drawing titles ("5 TYPICAL INTERIOR PARTITION N.T.S."). */
function namedOnlyInDrawingTitles(text, tokens) {
  const lower = String(text || "").toLowerCase();
  let seen = false;
  for (const token of tokens) {
    let from = 0;
    while (from < lower.length) {
      const at = lower.indexOf(token, from);
      if (at < 0) break;
      seen = true;
      const window = lower.slice(Math.max(0, at - 50), at + token.length + 50);
      if (!DRAWING_TITLE_RE.test(window)) return false;
      from = at + token.length;
    }
  }
  return seen;
}

/** The clause where the candidate states what is wrong, lower-cased for a sentence. */
function statedDeficiency(issue) {
  const clause = originalClaim(issue)
    .split(/(?<=[.;])\s+/)
    .map((part) => part.replace(/[.;]+$/, "").trim())
    .find((part) => DEFICIENCY_RE.test(part) && !NORMATIVE_RE.test(part) && !HEDGE_RE.test(part));
  if (!clause || clause.length < 12) return "";
  return clause.charAt(0).toLowerCase() + clause.slice(1);
}

function cleanTitle(issue) {
  return String(issue?.diagnostics?.originalTitle || issue?.title || "this condition")
    .replace(QUESTION_BOILERPLATE_RE, "").replace(/\s+/g, " ").trim();
}

/** CAD and PDF file names in title blocks are not drawing content. */
function withoutFileReferences(text) {
  return String(text || "").replace(/[^\s]*\.(?:dwg|dxf|rvt|pdf)\b/gi, " ");
}

function hasUnreadableRegions(ctx) {
  return (ctx?.regions || []).some((region) =>
    region && (region.readable === false || /unavailable|unreadable|failed/i.test(String(region.status || region.ocrStatus || ""))));
}

const RATED_PREMISE_RE = /\b(?:through|penetrat\w*|in)\s+(?:the\s+)?(?:fire|smoke)[\s-]*(?:resistance[\s-]*)?rated\s+(?:assembl\w*|walls?|barriers?|partitions?|floors?|construction)\b/i;
const RATING_EVIDENCE_RE = /\b\d\s*-?\s*(?:hr|hour)\b|\bfire[\s-]*(?:resistance\s+)?rat(?:ed|ing)\b|\bul\s*(?:design\s*)?(?:no\.?\s*)?[a-z]?-?\d{3}\b|\bfire\s+(?:barrier|partition|wall)\b/i;

function finalizeMissingQuestion(issue, ctx) {
  if (!claimsMissing(issue)) return null;
  const search = searchProjectEvidence(issue, ctx);
  if (search.resolved) {
    return {
      disposition: "reject",
      reason: "cross_sheet_answers_question",
      detail: `${search.where} already addresses this question.`,
      redirectFile: search.where,
    };
  }
  const reminder = requirementReminderDecision(issue, ctx);
  if (reminder) return reminder;
  if (search.unavailable) {
    const what = String(issue.title || "This condition").replace(/\s+/g, " ").trim();
    return {
      disposition: "retain_limitation",
      reason: "drawing_retrieval_unavailable",
      detail: `${what} cannot be confirmed. Drawing retrieval was unavailable, so this is not a determination that the information was checked. It matters because another sheet may already show it. Look again when the project drawing index can be searched.`,
    };
  }
  if (isVagueMissingClaim(issue)) {
    return {
      disposition: "reject",
      reason: "vague_question",
      detail: "The question does not say what is unresolved, why it matters, and where to look.",
    };
  }
  return {
    disposition: "accept_question",
    reason: "unresolved_question",
    detail: questionText(issue, search),
  };
}

function objectiveTokens(issue) {
  const claim = claimText(issue);
  const match = claim.match(/\b(corridor(?:\s+width)?|exit access(?:\s+width)?|egress(?:\s+width)?|stair(?:\s+riser|\s+width)?|riser|door(?:\s+width)?|insulation|accessible(?:\s+route|\s+entrance|\s+parking)?|accessibility|fire dampers?|fire(?:[\s-]*resistance)?(?:\s+rating)?|emergency lighting|special inspections?|grease interceptor|guard(?:rail)?|handrail|clearance|turning space|compartment|restroom|toilet(?:\s+room)?|sprinkler|beam|drain|fixture|parking|connections?|fasteners?|anchorage|pipe material|piping|ductwork|smoke control|grounding|conductor|ventilation|exhaust)\b/i);
  if (!match) return { label: "", tokens: [] };
  const label = match[0];
  const generic = new Set(["width", "note", "plan", "type", "size", "area", "room", "sheet", "rating"]);
  const tokens = label.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length >= 4 && !generic.has(token));
  return { label, tokens };
}

const SUBJECT_STOP = new Set([
  "unknown", "specification", "specifications", "verification", "detail", "details", "detailed",
  "clear", "clearly", "lack", "lacks", "incomplete", "unclear", "concern", "potential", "condition",
  "below", "minimum", "maximum", "width", "height", "length", "depth", "general",
]);

/** Words that name what the finding is about, from its title. */
function subjectTokens(issue) {
  const title = String(issue?.diagnostics?.originalTitle || issue?.title || "")
    .replace(/\s*[—-]\s*verification required/ig, "");
  return distinctiveTokens(title).filter((token) => !SUBJECT_STOP.has(token)).slice(0, 4);
}

function evidenceSnippet(corpus, tokens) {
  const text = String(corpus || "").replace(/(?:[<>\\*|]\s*){2,}/g, " ");
  const lower = text.toLowerCase();
  const ordered = [...tokens].sort((a, b) => b.length - a.length);
  for (const token of ordered) {
    const at = lower.indexOf(token);
    if (at < 0) continue;
    const start = Math.max(0, at - 24);
    const lead = start > 0 ? text.slice(start, at).search(/\s/) + 1 : 0;
    return text.slice(start + Math.max(0, lead), at + token.length + 70).replace(/\s+/g, " ").trim().slice(0, 180);
  }
  return "";
}

/**
 * A published question needs an objective, sheet evidence, the unresolved condition,
 * related sheets only when they share the element, and why those sheets do not resolve it.
 * @param {Record<string, unknown>} issue
 * @param {Record<string, unknown>} ctx
 * @param {Record<string, unknown>} decision
 */
function composePublication(issue, ctx, decision) {
  const objective = objectiveTokens(issue);
  const corpus = withoutFileReferences([
    ctx?.pageText,
    ctx?.corpus,
    ...(ctx?.observations || []).map((item) => item?.quote || ""),
  ].filter(Boolean).join("\n"));
  const lowerCorpus = corpus.toLowerCase();
  const titleObjective = objectiveTokens({ title: issue?.diagnostics?.originalTitle || issue?.title || "" }).tokens;
  const titleSubject = subjectTokens(issue);
  const subject = titleObjective.length ? titleObjective : titleSubject;
  // The word that names the missing quality ("accessible") may not be printed.
  // The element the title names ("counter") is the drawing evidence when it is.
  const subjectHits = [...new Set([...subject, ...titleSubject])].filter((token) => lowerCorpus.includes(token));
  const objectiveEvidence = evidenceSnippet(corpus, objective.tokens);
  const tied = subject.length === 0 || subjectHits.length > 0 || !objectiveEvidence;
  const evidence = subjectHits.length ? evidenceSnippet(corpus, subjectHits) : tied ? objectiveEvidence : "";
  const search = searchProjectEvidence(issue, ctx);
  const refs = search.places || [];
  const sheets = refs.length
    ? `Related sheets: ${refs.slice(0, 3).join(", ")}.`
    : "No indexed sheet that shares this element supplies the missing fact.";
  const why = refs.length
    ? "Those related sheets do not state the missing fact."
    : "Retrieved sheets do not share this element, so they do not resolve it.";
  const code = decision?.provenance?.codeSourceStatus === "authoritative"
    ? "A verified provision was supplied for this element."
    : "No verified edition-specific provision in the authorized sources resolves it.";
  const scope = ctx?.jurisdictionScope;
  const edition = scope?.enforcedJurisdiction || null;
  const year = ctx?.codeYear || null;
  const facts = namedFacts(issue).filter((fact) => !factStatedOnSheet(fact, ctx));
  const presence = /\b(?:not shown|not indicated|not provided|not labeled|missing|absent)\b/i.test(originalClaim(issue));
  const element = objective.label ? objective.label.toLowerCase() : "element";
  const elementWord = element.split(/[\s-]+/)[0];
  const factPhrase = facts.some((fact) => fact.startsWith(elementWord))
    ? facts.join(" and ")
    : `${element} ${facts.join(" and ")}`;
  const compared = tracesValueComparison(issue, ctx?.pageText || corpus);
  const deficiency = statedDeficiency(issue);
  const pageOnly = withoutFileReferences(ctx?.pageText);
  let evidenceLimit = null;
  if (hasUnreadableRegions(ctx) && subjectHits.length
    && namedOnlyInDrawingTitles(pageOnly, subjectHits)) {
    evidenceLimit = {
      reason: "detail_unreadable",
      detail: `This sheet names the detail ("${evidenceSnippet(pageOnly, subjectHits)}"), but the detail body is graphic and could not be read. ${facts.length ? `Whether it states the ${facts.join(" and ")} is unresolved.` : `Whether it resolves "${cleanTitle(issue)}" is unresolved.`}`,
    };
  } else if (RATED_PREMISE_RE.test(originalClaim(issue)) && !RATING_EVIDENCE_RE.test(corpus)) {
    evidenceLimit = {
      reason: "rated_assembly_unconfirmed",
      detail: `The candidate assumes a fire-rated assembly, but no readable sheet states a fire-resistance rating. Whether the ${element} is required is unresolved until the rated assemblies are identified.`,
    };
  }
  const unverified = decision?.reason === "unverified_threshold" || decision?.reason === "unsupported_confirmed_finding";
  const unresolved = unverified && !facts.length && !compared
    ? "The unresolved condition is that no verified edition threshold confirms a violation."
    : compared
      ? `The unresolved condition is that this sheet states ${compared.join(" and ")} for the ${element}, and does not show how the selection reconciles those values.`
    : facts.length
      ? `The unresolved condition is that this sheet does not state the ${factPhrase}.`
      : deficiency
        ? `The unresolved condition is that ${deficiency}.`
        : presence
          ? `The unresolved condition is that this sheet does not show the ${element}.`
          : "";
  const scopeLine = edition
    ? `Selected code scope is ${edition}${year ? ` ${year}` : ""}.`
    : "The run has no selected code edition to verify.";
  const complete = Boolean(objective.label && evidence && unresolved && why);
  return {
    complete,
    evidenceLimit,
    tiedToEvidence: tied,
    text: [
      `${objective.label} is the review objective.`,
      evidence ? `Drawing evidence: ${evidence}` : "",
      unresolved,
      sheets,
      `${why} ${code}`,
      scopeLine,
      "This is not a confirmed violation.",
    ].filter(Boolean).join(" "),
  };
}

module.exports = {
  establishReviewContext,
  inferOccupancy,
  inferWorkScope,
  documentRoles,
  assessApplicability,
  finalizeMissingQuestion,
  claimsMissing,
  searchProjectEvidence,
  composePublication,
  requirementReminderDecision,
  tracesValueComparison,
  recordCanAnswer,
  sheetDiscipline,
};
