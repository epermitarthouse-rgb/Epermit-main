"use strict";

const MEASURABLE_RE =
  /\b(width|clearance|slope|ramp|rise|run|dimension|distance|spacing|fire\s*rating|rated|hour)\b/i;
const MEASURE_TOKEN_RE = /\d+(?:\.\d+)?(?:\s*(?:["″])|(?:\s|-)?(?:in(?:ch(?:es)?)?|ft|feet|'))/gi;
const MISSING_RE = /\b(not shown|not indicated|not labeled|not provided|missing|does not show)\b/i;
const SATISFIED = [
  { id: "water-hammer", re: /water[\s-]*hammer/i },
  { id: "gfci", re: /\bgfci\b/i },
  { id: "draft-stop", re: /draft[\s-]*stop/i },
];

function claimText(issue) {
  return `${issue.title || ""} ${issue.description || ""} ${issue.location || ""}`;
}

function sheetRole(ctx) {
  const name = `${ctx.sheetTitle || ""} ${ctx.fileName || ""} ${ctx.contentClass || ""}`.toLowerCase();
  const prefix = (letter) => new RegExp(`(?:^|[\\s/])${letter}[-.]?\\d`, "i").test(name);
  if (prefix("eq") || /\bequipment\s+plan\b/.test(name)) return "equipment";
  if (/\bwall\s+sections?\b/.test(name) || /\bsection\s+details?\b/.test(name) || ctx.contentClass === "section") {
    return "wall_section";
  }
  if (prefix("e") || /\belectrical\b|\blighting plan\b/.test(name)) return "electrical";
  if (prefix("p") || /\bplumbing\b/.test(name)) return "plumbing";
  if (prefix("m") || /\bmechanical\b/.test(name)) return "mechanical";
  if (prefix("s") || /\bspecial\s+inspection/.test(name)) return "structural";
  if (ctx.contentClass === "schedule" || /\bschedule\b/.test(name)) return "schedule";
  if (ctx.contentClass === "form") return "document";
  return "plan";
}

function measureTokens(text) {
  return String(text || "").match(MEASURE_TOKEN_RE) || [];
}

function corpusHasToken(corpus, token) {
  const compact = String(corpus || "").toLowerCase().replace(/\s+/g, "");
  const number = token.match(/\d+(?:\.\d+)?/)?.[0];
  if (!number) return false;
  const normalized = token.toLowerCase().replace(/\s+/g, "").replace(/inches?|inch/, "in").replace(/″/g, '"');
  if (compact.includes(normalized)) return true;
  return [`${number}"`, `${number}″`, `${number}in`].some((variant) => compact.includes(variant.toLowerCase()));
}

function traceMeasures(issue, corpus) {
  const claim = claimText(issue);
  if (!MEASURABLE_RE.test(claim)) return { ok: true, matched: [] };
  const tokens = measureTokens(claim);
  if (!tokens.length) return { ok: false, reason: "Measurable claim has no number to trace." };
  const matched = tokens.filter((token) => corpusHasToken(corpus, token));
  if (!matched.length) return { ok: false, reason: "Claimed dimension or rating is not in the sheet evidence." };
  return { ok: true, matched };
}

function isCorridorWidth(issue) {
  return /\bcorridor\b/i.test(claimText(issue)) && /\bwidth\b/i.test(claimText(issue));
}

function isExitSign(issue) {
  return /\bexit\s*signs?\b/i.test(claimText(issue));
}

function isRestatement(issue, corpus) {
  const claim = claimText(issue);
  const traced = traceMeasures(issue, corpus);
  if (traced.ok && traced.matched.length && /\b(does not meet|below|insufficient|too narrow)\b/i.test(claim)) {
    return false;
  }
  for (const topic of SATISFIED) {
    if (!topic.re.test(claim) || !topic.re.test(corpus)) continue;
    if (MISSING_RE.test(claim) || /\b(required|shall provide|must provide|provide)\b/i.test(claim)) return true;
    if (!/\b(does not meet|below|insufficient)\b/i.test(claim)) return true;
  }
  return false;
}

function citesUnenforcedLocalAmendment(issue, scope) {
  if (!scope || scope.selectionSource !== "explicit" || scope.enforcedJurisdiction !== "general") return false;
  const ref = `${issue.codeReference || ""} ${issue.citationBook || ""}`;
  return /\b12A\s*DCMR\b|\bD\.?C\.?\s+Building Code\b|\bNYC\s*BC\b|\bCBC\b|\bFBC\b/i.test(ref);
}

/**
 * Independent of the model. Uses text, regions, rules, and retrieved records.
 * @param {Record<string, unknown>} issue
 * @param {{
 *   corpus?: string;
 *   sheetTitle?: string | null;
 *   fileName?: string | null;
 *   contentClass?: string | null;
 *   jurisdictionScope?: Record<string, unknown> | null;
 *   ruleResults?: Array<Record<string, unknown>>;
 *   regions?: Array<Record<string, unknown>>;
 * }} ctx
 */
function decideCandidate(issue, ctx) {
  const corpus = String(ctx.corpus || "");
  const role = sheetRole(ctx);
  const provenance = {
    verifier: "deterministic-evidence",
    sheetRole: role,
    regionCount: Array.isArray(ctx.regions) ? ctx.regions.length : 0,
    codeAuthoritative: false,
  };

  if (isExitSign(issue) && role === "wall_section") {
    return {
      disposition: "reject",
      reason: "exit_sign_on_wall_section",
      detail: "Exit-sign findings are not published on wall-section sheets.",
      provenance,
    };
  }

  if (isCorridorWidth(issue) && role === "equipment") {
    const traced = traceMeasures(issue, corpus);
    if (!traced.ok) {
      return {
        disposition: "reject",
        reason: "corridor_width_not_on_equipment_plan",
        detail: "This equipment plan does not show the claimed corridor width.",
        provenance,
      };
    }
    return {
      disposition: "downgrade",
      reason: "corridor_width_needs_architectural_sheet",
      detail: "Retrieve the architectural drawing before treating an equipment-plan dimension as a corridor-width violation.",
      provenance,
    };
  }

  if (isRestatement(issue, corpus)) {
    return {
      disposition: "reject",
      reason: "requirement_already_on_sheet",
      detail: "The sheet already states this requirement. Retrieval is not proof it is satisfied, and it is not a violation.",
      provenance,
    };
  }

  if (citesUnenforcedLocalAmendment(issue, ctx.jurisdictionScope)) {
    return {
      disposition: "reject",
      reason: "explicit_general_ibc",
      detail: "Explicit General IBC does not enforce a local amendment cited only from an unverified summary.",
      provenance,
    };
  }

  if (String(issue.findingType || "") === "confirmed_violation" || /\b(does not meet|non-?compliant|insufficient|too narrow)\b/i.test(claimText(issue))) {
    const traced = traceMeasures(issue, corpus);
    if (!traced.ok) {
      return {
        disposition: "downgrade",
        reason: "untraced_measure",
        detail: traced.reason,
        provenance,
      };
    }
    const citationOnly = !traced.matched?.length && !corpus.trim();
    if (citationOnly) {
      return {
        disposition: "downgrade",
        reason: "citation_alone",
        detail: "A code citation without sheet evidence is not a confirmed violation.",
        provenance,
      };
    }
  }

  return {
    disposition: "accept",
    reason: "evidence_chain",
    detail: "The candidate is consistent with the text, sheet role, and retrieved evidence supplied to the verifier.",
    provenance: {
      ...provenance,
      codeSourceStatus: "unverified_citation_unless_authoritative_hit",
    },
  };
}

function applyDecision(issue, decision) {
  if (decision.disposition === "reject") {
    return {
      ...issue,
      validationDisposition: "reject",
      validationReason: decision.reason,
      validationDetail: decision.detail,
      provenance: decision.provenance,
      userVisible: false,
    };
  }
  if (decision.disposition === "downgrade") {
    return {
      ...issue,
      validationDisposition: "downgrade",
      validationReason: decision.reason,
      validationDetail: decision.detail,
      provenance: decision.provenance,
      findingType: "missing_information",
      evidenceTier: "verification",
      severity: "advisory",
      measurableEvidence: false,
      userVisible: true,
    };
  }
  return {
    ...issue,
    validationDisposition: "accept",
    validationReason: decision.reason,
    validationDetail: decision.detail,
    provenance: decision.provenance,
    userVisible: true,
  };
}

module.exports = {
  decideCandidate,
  applyDecision,
  traceMeasures,
  sheetRole,
  corpusHasToken,
};
