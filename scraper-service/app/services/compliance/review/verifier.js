"use strict";

const { assessApplicability, finalizeMissingQuestion, claimsMissing, composePublication } = require("./applicability.js");
const { verifyAuthoritativeCitation } = require("./codeCitationVerification.js");

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

function sheetRoles(ctx) {
  const name = `${ctx.sheetTitle || ""} ${ctx.fileName || ""} ${ctx.contentClass || ""}`.toLowerCase();
  const head = String(ctx.pageText || "").slice(0, 2500).toLowerCase();
  const hay = `${name} ${head}`;
  const prefix = (letter) => new RegExp(`(?:^|[\\s/])${letter}[-.]?\\d`, "i").test(name);
  const roles = new Set();
  if (prefix("eq") || /\bequipment\s+plan\b/.test(hay)) roles.add("equipment");
  if (/\bwall\s+sections?\b/.test(hay) || /\bsection\s+details?\b/.test(name) || ctx.contentClass === "section") {
    roles.add("wall_section");
  }
  if (prefix("e") || /\belectrical\b|\blighting plan\b/.test(hay)) roles.add("electrical");
  if (prefix("p") || /\bplumbing\b/.test(hay)) roles.add("plumbing");
  if (prefix("m") || /\bmechanical\b/.test(hay)) roles.add("mechanical");
  if (prefix("s") || /\bspecial\s+inspection/.test(hay)) roles.add("structural");
  if (ctx.contentClass === "schedule" || /\bschedule\b/.test(name)) roles.add("schedule");
  if (ctx.contentClass === "form") roles.add("document");
  if (/\b(floor plan|life safety|egress plan)\b/.test(hay) || roles.size === 0) roles.add("plan");
  return roles;
}

function sheetRole(ctx) {
  const roles = sheetRoles(ctx);
  if (roles.has("equipment")) return "equipment";
  if (roles.has("plan") && roles.size > 1) return "plan";
  return [...roles][0] || "plan";
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

const PROVISION_RE = /\b(shall|must|required|designed|comply|compliance|maintain|provide[sd]?|in accordance)\b/i;
const DEFICIENCY_RE =
  /\b(does not meet|do not meet|non-?compliant|insufficient|too narrow|below minimum|not shown|not provided|not indicated|not labeled|missing|fails to|narrower than|less than)\b/i;
const PROVISION_STOP = new Set([
  "this", "that", "with", "from", "have", "been", "sheet", "indicate", "indicates", "indicated",
  "required", "requirement", "compliance", "comply", "design", "designed", "provide", "provided",
  "maintain", "maintaining", "section", "code", "note", "notes", "which", "shall", "must", "will",
  "only", "also", "into", "over", "under", "than", "then", "them", "they", "their", "there",
  "where", "when", "what", "your", "about", "after", "before", "while", "specific",
]);

function distinctiveTokens(text) {
  return [...new Set((String(text || "").toLowerCase().match(/[a-z][a-z0-9-]{3,}/g) || []).filter((token) => !PROVISION_STOP.has(token) && token.length >= 4))];
}

function tokenInWindow(window, token) {
  if (window.includes(token)) return true;
  const stem = token.endsWith("s") ? token.slice(0, -1) : token;
  return stem.length >= 4 && (window.includes(stem) || window.includes(`${stem}s`));
}

/**
 * The sheet already states this requirement in its own note.
 * A paraphrased "shall / designed / comply" sentence is not a deficiency.
 */
function isDocumentedProvision(issue, corpus) {
  const claim = claimText(issue);
  const element = elementClaim(issue);
  const tokens = measureTokens(claim);
  const linked = Boolean(element && tokens.some((token) => linkedSpan(corpus, element.re, token)));
  if (/\b(not shown|not provided|not indicated|not labeled|missing|fails to)\b/i.test(claim)) return false;
  if (DEFICIENCY_RE.test(claim) && linked) return false;
  const words = distinctiveTokens(claim);
  if (words.length < 2) return false;
  const hay = String(corpus || "").toLowerCase();
  if (!hay || (!PROVISION_RE.test(claim) && !PROVISION_RE.test(hay))) return false;
  let best = 0;
  let bestWindow = "";
  for (const word of words) {
    const stem = word.endsWith("s") ? word.slice(0, -1) : word;
    let from = 0;
    while (from < hay.length) {
      const at = hay.indexOf(stem, from);
      if (at < 0) break;
      const window = hay.slice(Math.max(0, at - 90), at + stem.length + 120);
      const hits = words.filter((token) => tokenInWindow(window, token)).length;
      if (hits > best) {
        best = hits;
        bestWindow = window;
      }
      from = at + stem.length;
    }
  }
  if (best < 2 || !PROVISION_RE.test(bestWindow)) return false;
  return PROVISION_RE.test(claim) || PROVISION_RE.test(bestWindow);
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

const ELEMENT_CLAIMS = [
  { id: "corridor", re: /\bcorridor\b/i, roles: ["plan"] },
  { id: "door", re: /\bdoor\b/i, roles: ["plan", "schedule", "wall_section"] },
  { id: "stair", re: /\bstair/i, roles: ["plan"] },
  { id: "emergency-lighting", re: /\bemergency\s+light/i, roles: ["electrical"] },
  { id: "backflow", re: /\b(backflow|rpz)\b/i, roles: ["plumbing"] },
  { id: "fire-rating", re: /\b(fire[\s-]*(?:rating|resistance)|rated\s+(?:wall|partition))\b/i, roles: ["plan", "wall_section"] },
  { id: "connection", re: /\b(connection|structural)\b/i, roles: ["wall_section", "structural"] },
];

function elementClaim(issue) {
  const text = claimText(issue);
  return ELEMENT_CLAIMS.find((element) => element.re.test(text)) || null;
}

function sheetAllows(roles, element) {
  const set = roles instanceof Set ? roles : new Set([roles]);
  return !element?.roles || [...set].some((role) => element.roles.includes(role));
}

function linkedSpan(text, elementRe, token) {
  const source = String(text || "");
  const number = String(token || "").match(/\d+(?:\.\d+)?/)?.[0];
  if (!number || !elementRe) return false;
  const re = new RegExp(elementRe.source, "ig");
  let match;
  while ((match = re.exec(source))) {
    const window = source.slice(Math.max(0, match.index - 48), match.index + match[0].length + 64);
    if (window.includes(number)) return true;
  }
  return false;
}

function recordText(record) {
  return [record?.text, ...(record?.observations || []).map((item) => item?.quote || "")].filter(Boolean).join("\n");
}

function supplyingRecord(records, currentFile, element, token) {
  for (const record of records || []) {
    if (!record || record.fileName === currentFile) continue;
    const roles = sheetRoles({
      fileName: record.fileName,
      sheetTitle: record.title,
      contentClass: record.contentClass,
      pageText: record.text,
    });
    if (!sheetAllows(roles, element)) continue;
    const text = recordText(record);
    if (token ? linkedSpan(text, element.re, token) : element.re.test(text)) return record;
  }
  return null;
}

function authoritativeThreshold(ctx, issue) {
  return verifyAuthoritativeCitation(issue, ctx, measureTokens);
}

function cleanTopic(title) {
  const cleaned = String(title || "This condition")
    .replace(/\s*[—-]\s*verification required/ig, "")
    .replace(/\b(non-?compliance|non-?compliant|does not meet|insufficient|too narrow|below minimum|violation)\b/gi, "")
    .replace(/\d+(?:\.\d+)?(?:\s*(?:["″]|in(?:ch(?:es)?)?|ft|feet|'))?/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || "This condition";
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
function isVagueUnsupported(issue) {
  if (claimsMissing(issue) && String(issue.location || "").trim().length >= 3) return false;
  const claim = `${issue.title || ""} ${issue.description || ""}`;
  if (/\b(door|stair|corridor|compartment|clearance|riser|width|rating)\b/i.test(claim)) return false;
  return true;
}

function unsupportedCodeAssertion(issue) {
  const original = `${issue.diagnostics?.originalTitle || issue.title || ""} ${issue.diagnostics?.originalDescription || issue.description || ""}`;
  const asserts = /\b(does not meet|non-?compliant|insufficient|violation|below minimum)\b/i.test(original);
  if (!asserts) return false;
  if (measureTokens(original).length) return false;
  if (/\b(door|stair|corridor|compartment|clearance|riser|width|parking|route|separation|rating|egress|exit|ramp|handrail|guard)\b/i.test(original)) return false;
  if (String(issue.location || "").trim().length >= 3) return false;
  return true;
}

function asPublishedQuestion(decision, issue, ctx) {
  if (!decision || (decision.disposition !== "downgrade" && decision.disposition !== "accept_question")) {
    return decision;
  }
  const publication = composePublication(issue, ctx, decision);
  if (publication.tiedToEvidence === false) {
    return {
      disposition: "reject",
      reason: "claim_not_tied_to_evidence",
      detail: "The sheet text does not mention the element this question is about, so the quoted drawing evidence does not support it. The check stays open.",
      provenance: decision.provenance,
    };
  }
  if (!publication.complete) {
    return {
      disposition: "reject",
      reason: "incomplete_question",
      detail: "The candidate is missing an applicable objective, relevant drawing evidence, the unresolved condition, or an explanation of why retrieved sheets do not resolve it.",
      provenance: decision.provenance,
    };
  }
  return { ...decision, detail: publication.text };
}

function withProjectContext(decision, projectContext) {
  if (!projectContext) return decision;
  return {
    ...decision,
    provenance: { ...(decision.provenance || {}), projectContext },
  };
}

function decideCandidate(issue, ctx) {
  const corpus = String(ctx.corpus || "");
  const roles = sheetRoles(ctx);
  const applicability = assessApplicability(issue, ctx);
  const provenance = {
    verifier: "deterministic-evidence",
    sheetRole: [...roles].join(","),
    regionCount: Array.isArray(ctx.regions) ? ctx.regions.length : 0,
    codeAuthoritative: false,
    projectContext: applicability.projectContext || null,
  };

  if (applicability.disposition === "reject" || applicability.disposition === "retain_limitation") {
    return withProjectContext({ ...applicability, provenance }, applicability.projectContext);
  }

  if (unsupportedCodeAssertion(issue)) {
    return {
      disposition: "reject",
      reason: "unsupported_allegation",
      detail: "An unsupported code assertion is not published as a confirmed violation or as a question.",
      provenance,
    };
  }

  if (isExitSign(issue) && roles.has("wall_section") && !roles.has("plan")) {
    return {
      disposition: "reject",
      reason: "exit_sign_on_wall_section",
      detail: "Exit-sign findings are not published on wall-section sheets.",
      provenance,
    };
  }

  if (isCorridorWidth(issue) && roles.has("equipment")) {
    const traced = traceMeasures(issue, corpus);
    if (!traced.ok) {
      return {
        disposition: "reject",
        reason: "corridor_width_not_on_equipment_plan",
        detail: "This equipment plan does not show the claimed corridor width.",
        provenance,
      };
    }
    const other = supplyingRecord(ctx.drawingRecords, ctx.fileName || ctx.sheetTitle, { id: "corridor", re: /\bcorridor\b/i, roles: ["plan"] }, traced.matched[0]);
    if (other) {
      return {
        disposition: "reject",
        reason: "dimension_answered_on_other_sheet",
        detail: `${other.fileName} already shows the corridor dimension.`,
        redirectFile: other.fileName,
        provenance,
      };
    }
    return {
      disposition: "reject",
      reason: "dimension_not_tied_to_element",
      detail: "An equipment-plan dimension is not a corridor width unless the corridor label and the number are the same note.",
      provenance,
    };
  }

  if (/\begress\b/i.test(claimText(issue)) && /\bwidth\b/i.test(claimText(issue)) && roles.has("equipment")) {
    return {
      disposition: "reject",
      reason: "egress_width_outside_sheet",
      detail: "An equipment plan does not establish an egress width.",
      provenance,
    };
  }

  if (isDocumentedProvision(issue, corpus)) {
    return {
      disposition: "reject",
      reason: "documented_design_provision",
      detail: "The sheet already states this design provision. That note is not a deficiency and it is not a violation.",
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

  const element = elementClaim(issue);
  const tokens = measureTokens(claimText(issue));
  const assertsDefect =
    String(issue.findingType || "") === "confirmed_violation" ||
    /\b(does not meet|non-?compliant|insufficient|too narrow|below)\b/i.test(claimText(issue));
  const currentFile = ctx.fileName || ctx.sheetTitle || null;
  const codeVerification = authoritativeThreshold(ctx, issue);
  const authoritative = codeVerification.verified;
  provenance.codeSourceStatus = authoritative ? "authoritative" : "unverified";
  provenance.codeVerificationReason = codeVerification.reason;
  provenance.codeProvisionId = codeVerification.provision?.id || null;
  provenance.codeSourceUrl = codeVerification.provision?.sourceUrl || null;
  provenance.codeSourceLocator = codeVerification.provision?.sourceLocator || null;

  if (element && !sheetAllows(roles, element)) {
    const other = supplyingRecord(ctx.drawingRecords, currentFile, element, tokens[0]);
    if (other) {
      return {
        disposition: "reject",
        reason: "dimension_answered_on_other_sheet",
        detail: `${other.fileName || "Another sheet"} already has this element.`,
        redirectFile: other.fileName || null,
        provenance,
      };
    }
    return {
      disposition: "reject",
      reason: "wrong_sheet_for_element",
      detail: "This sheet is not the place to measure that element.",
      provenance,
    };
  }

  if (assertsDefect && tokens.length) {
    const linked = element
      ? tokens.some((token) => linkedSpan(corpus, element.re, token))
      : false;
    if (!linked) {
      return {
        disposition: "reject",
        reason: "dimension_not_tied_to_element",
        detail: "The number is not tied to the claimed element in the sheet evidence.",
        provenance,
      };
    }
    if (!authoritative) {
      return asPublishedQuestion({
        disposition: "downgrade",
        reason: "unverified_threshold",
        detail: `${cleanTopic(issue.title)} remains unresolved against a verified code threshold. It matters because the number on this sheet is not itself a violation. Look at the dimension note on this sheet and the code edition selected for the run.`,
        provenance,
      }, issue, ctx);
    }
  }

  if (!assertsDefect && element && !element.re.test(corpus) && !sheetAllows(roles, element)) {
    return {
      disposition: "reject",
      reason: "element_not_on_sheet",
      detail: "The sheet evidence does not show this element, so the question is not actionable.",
      provenance,
    };
  }

  if (!assertsDefect && element && element.re.test(corpus) && MISSING_RE.test(claimText(issue)) && !tokens.length) {
    return {
      disposition: "reject",
      reason: "already_noted",
      detail: "The sheet already states this element. That note is not a violation.",
      provenance,
    };
  }

  if (assertsDefect && !tokens.length) {
    const traced = traceMeasures(issue, corpus);
    if (!traced.ok) {
      return {
        disposition: "reject",
        reason: "untraced_measure",
        detail: traced.reason,
        provenance,
      };
    }
  }

  const wantsConfirmation = String(issue.findingType || "") === "confirmed_violation" || assertsDefect;
  if (wantsConfirmation) {
    const linked = Boolean(element && tokens.some((token) => linkedSpan(corpus, element.re, token)));
    if (!linked || !authoritative) {
      const missingQuestion = finalizeMissingQuestion(issue, ctx);
      if (!linked && isVagueUnsupported(issue)) {
        return {
          disposition: "reject",
          reason: "unsupported_allegation",
          detail: "The allegation does not name the element, the measured value, and where it was read, so it is not published.",
          provenance,
        };
      }
      if (!linked) {
        return asPublishedQuestion({
          disposition: "downgrade",
          reason: "unsupported_confirmed_finding",
          detail: `${cleanTopic(issue.title)} remains unresolved. It matters because a confirmed violation needs the element and a number read from the sheet. Look at the sheet note for that element and the selected code edition.`,
          provenance,
        }, issue, ctx);
      }
      return asPublishedQuestion({
        disposition: "downgrade",
        reason: "unverified_threshold",
        detail: `${cleanTopic(issue.title)} remains unresolved against a verified code threshold. It matters because the number on this sheet is not itself a violation. Look at the dimension note on this sheet and the code edition selected for the run.`,
        provenance,
      }, issue, ctx);
    }
  }

  const missingQuestion = finalizeMissingQuestion(issue, ctx);
  if (missingQuestion) {
    return asPublishedQuestion(
      { ...missingQuestion, provenance: { ...provenance, ...(missingQuestion.provenance || {}) } },
      issue,
      ctx,
    );
  }

  return {
    disposition: "accept",
    reason: "evidence_chain",
    detail: authoritative
      ? "The element, number, and authoritative threshold agree."
      : "The candidate matches the sheet evidence. The code citation is unverified.",
    provenance,
  };
}

function originalDiagnostics(issue) {
  return {
    originalTitle: issue.title || null,
    originalDescription: issue.description || null,
    originalCodeReference: issue.codeReference || null,
    originalFindingType: issue.findingType || null,
    originalSeverity: issue.severity || null,
  };
}

function applyDecision(issue, decision) {
  const codeSourceStatus = decision.provenance?.codeSourceStatus || "unverified";
  if (decision.disposition === "reject") {
    return {
      ...issue,
      validationDisposition: "reject",
      validationReason: decision.reason,
      validationDetail: decision.detail,
      provenance: decision.provenance,
      diagnostics: originalDiagnostics(issue),
      userVisible: false,
    };
  }
  if (decision.disposition === "retain_limitation" || decision.disposition === "accept_question") {
    const topic = cleanTopic(issue.title);
    return {
      ...issue,
      validationDisposition: decision.disposition === "retain_limitation" ? "limitation" : "accept",
      validationReason: decision.reason,
      validationDetail: decision.detail,
      provenance: { ...decision.provenance, codeSourceStatus },
      codeSourceStatus,
      diagnostics: originalDiagnostics(issue),
      title: decision.disposition === "accept_question" ? issue.title : `${topic} — verification required`,
      description: decision.detail,
      findingType: issue.findingType === "unverified" ? "unverified" : "missing_information",
      evidenceTier: "verification",
      severity: "advisory",
      measurableEvidence: false,
      userVisible: true,
    };
  }
  if (decision.disposition === "downgrade") {
    const redirect = decision.redirectFile ? ` See ${decision.redirectFile}.` : "";
    return {
      ...issue,
      validationDisposition: "downgrade",
      validationReason: decision.reason,
      validationDetail: decision.detail,
      provenance: { ...decision.provenance, codeSourceStatus },
      codeSourceStatus,
      diagnostics: originalDiagnostics(issue),
      title: `${cleanTopic(issue.title)} — verification required`,
      description: `${decision.detail || "This is not a confirmed violation."}${redirect} The code citation is not a verified excerpt.`,
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
    provenance: { ...decision.provenance, codeSourceStatus },
    codeSourceStatus,
    userVisible: true,
  };
}

module.exports = {
  decideCandidate,
  applyDecision,
  traceMeasures,
  sheetRole,
  sheetRoles,
  corpusHasToken,
  linkedSpan,
  cleanTopic,
  isDocumentedProvision,
};
