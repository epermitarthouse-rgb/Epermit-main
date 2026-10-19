"use strict";

const { extractIdentifiers, normalizeIdentifier } = require("../rag/identifiers.js");

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

function claimsMissing(issue) {
  const claim = claimText(issue);
  const findingType = String(issue?.findingType || "").toLowerCase();
  if (findingType === "confirmed_violation" && !/\b(not shown|not provided|not indicated|not labeled|missing|absent|does not show)\b/i.test(claim)) {
    return false;
  }
  return findingType === "missing_information"
    || findingType === "unverified"
    || /\b(not shown|not provided|not indicated|not labeled|missing|absent|does not show)\b/i.test(claim);
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
  return /\baccessible route\b/i.test(claimText(issue)) && claimsMissing(issue);
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
  const measures = claim.match(/\d+(?:\.\d+)?/g) || [];
  for (const record of records) {
    if (!record || sameRecord(record, ctx)) continue;
    const text = recordBody(record).toLowerCase();
    if (!text.trim()) continue;
    const hits = tokens.filter((token) => text.includes(token));
    const measureHit = measures.some((number) => text.includes(number));
    const identifierHit = extractIdentifiers(claim).some((ident) => {
      const wanted = normalizeIdentifier(ident);
      const sheetNumber = normalizeIdentifier(record.sheetNumber || "");
      const fileName = normalizeIdentifier(record.fileName || "");
      return wanted && (sheetNumber === wanted || fileName.includes(wanted));
    });
    if ((hits.length >= 2 && (measureHit || identifierHit)) || (identifierHit && hits.length >= 1 && measureHit)) {
      return {
        resolved: true,
        unavailable,
        where: record.fileName || record.sheetNumber || record.title || "another sheet",
        places: [],
      };
    }
  }
  const places = [];
  for (const record of records) {
    if (!record || sameRecord(record, ctx)) continue;
    const label = record.fileName || record.sheetNumber || record.title;
    if (label && places.length < 3) places.push(label);
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

  if ((roles.has("electrical") || roles.has("equipment")) && !roles.has("architectural") && isAccessibleRouteGap(issue)) {
    return {
      disposition: "reject",
      reason: "accessible_route_outside_discipline",
      detail: "An electrical or equipment plan is not independently faulted for architectural accessible-route documentation.",
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

module.exports = {
  establishReviewContext,
  inferOccupancy,
  inferWorkScope,
  documentRoles,
  assessApplicability,
  finalizeMissingQuestion,
  claimsMissing,
  searchProjectEvidence,
};
