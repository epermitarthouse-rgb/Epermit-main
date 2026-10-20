"use strict";

const {
  assessApplicability,
  finalizeMissingQuestion,
  claimsMissing,
  composePublication,
  requirementReminderDecision,
  tracesValueComparison,
} = require("./applicability.js");
const { verifyAuthoritativeCitation } = require("./codeCitationVerification.js");
const {
  ELEMENTS,
  parseClaim,
  elementSpans,
  attributeEvidence,
  evidenceState,
  ownsElement,
  relatedSources,
  reconcileCalculation,
  onlyRequirementNotes,
  graphicUnread,
  graphicReadComplete,
  NOT_TEXT_ATTRIBUTES,
  outcomeForReason,
} = require("./evaluation.js");
const { gateMeasuredFact, unboundMeasurement } = require("../rag/drawingStructureV2.js");

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
  if (tracesValueComparison(issue, corpus)) return false;
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
  if (tracesValueComparison(issue, corpus)) return false;
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

const CODE_FAMILY_SOURCE =
  "(?:IECC|IBC|IRC|IMC|IPC|IFC|IFGC|IEBC|NEC|NFPA\\s*\\d+|ASHRAE\\s*90\\.1|ICC\\s*A117\\.1|(?:[A-Z]{2,4}\\s+)?(?:Energy(?:\\s+Conservation)?|Building|Construction|Mechanical|Plumbing|Fire|Electrical)\\s+Codes?)";
const EDITION_RE = new RegExp(`\\b(?:((?:19|20)\\d{2})\\s+${CODE_FAMILY_SOURCE}|${CODE_FAMILY_SOURCE}\\s*[,(]?\\s*((?:19|20)\\d{2}))\\b`, "gi");
const SHEET_CITES_RE =
  /\b(?:sheet|drawing|certificate|plan|notes?|document|title block|form|comcheck)\b[^.]{0,80}\b(?:references?|referenced|cites?|cited|lists?|listed|states?|stated|shows?|indicates?|uses?|based on|complies with)\b|\b(?:references?|referenced|cites?|cited|lists?|listed)\s+(?:the\s+|an?\s+)?(?:19|20)\d{2}\b/i;

function editionFamily(text) {
  return String(text || "")
    .replace(/(?:19|20)\d{2}/g, "")
    .replace(/\b(?:energy\s+conservation\s+codes?|energy\s+codes?|iecc)\b/i, "energy")
    .replace(/[^a-z0-9.]+/gi, " ")
    .trim()
    .toLowerCase()
    .split(" ")
    .filter((word) => !["code", "codes", "dc", "the"].includes(word))
    .pop() || "";
}

function editionsIn(text) {
  return [...String(text || "").matchAll(EDITION_RE)].map((match) => ({
    label: match[0].replace(/\s+/g, " ").trim(),
    year: match[1] || match[2],
    family: editionFamily(match[0]),
  }));
}

/**
 * A finding that says the sheet cites a code edition must find that edition in the
 * readable sheet evidence. A model reading of an unreadable certificate is not a quote.
 */
function untracedCodeEdition(issue, ctx) {
  const original = issue?.diagnostics || {};
  const claim = `${original.originalTitle || issue.title || ""}. ${original.originalDescription || issue.description || ""}`;
  const sentences = claim.split(/(?<=[.;])\s+/).filter((sentence) => SHEET_CITES_RE.test(sentence));
  const claimed = sentences.flatMap(editionsIn);
  if (!claimed.length) return null;
  const evidence = editionsIn(String(ctx.corpus || ""));
  for (const edition of claimed) {
    if (evidence.some((found) => found.year === edition.year && found.family === edition.family)) continue;
    const conflicting = evidence.filter((found) => found.family === edition.family && found.year !== edition.year);
    const adopted = ctx.legalApplicability?.adoptedEdition || null;
    const project = adopted ? ` The project record names ${adopted}.` : "";
    if (conflicting.length) {
      return {
        reason: "code_edition_contradicted",
        detail: `The finding says the sheet cites ${edition.label}, but the sheet text names ${conflicting.map((item) => item.label).join(", ")}.${project} It is not published.`,
      };
    }
    return {
      reason: "code_edition_not_in_evidence",
      detail: `The finding says the sheet cites ${edition.label}, but that edition does not appear in the readable sheet text or quoted evidence.${project} It is not published.`,
    };
  }
  return null;
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
  if (publication.evidenceLimit) {
    return { disposition: "reject", ...publication.evidenceLimit, provenance: decision.provenance };
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

  const edition = untracedCodeEdition(issue, ctx);
  if (edition) return { disposition: "reject", ...edition, provenance };

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

  const reminder = requirementReminderDecision(issue, ctx);
  if (reminder) return { ...reminder, provenance };

  return {
    disposition: "accept",
    reason: "evidence_chain",
    detail: authoritative
      ? "The element, number, and authoritative threshold agree."
      : "The candidate matches the sheet evidence. The code citation is unverified.",
    provenance,
  };
}

/** Rejections that claim the set already answers the candidate. */
const ANSWERED_REASONS = new Set([
  "requirement_already_specified", "cross_sheet_answers_question", "cross_sheet_supplies_fact",
  "dimension_answered_on_other_sheet", "already_noted", "requirement_already_on_sheet", "information_present",
]);
/** Rejections about how the candidate was worded, not about the drawings. */
const FORMAT_REASONS = new Set([
  "incomplete_question", "claim_not_tied_to_evidence", "vague_question", "no_specific_condition",
  "requirement_reminder", "evidence_gate", "cross_sheet_owner",
]);
const PUBLISHING = new Set(["accept", "accept_question", "downgrade"]);
/** Rejections that say the sheet already states the requirement. */
const RESTATEMENT_REASONS = new Set(["requirement_already_on_sheet", "documented_design_provision", "requirement_already_specified"]);

function attributePhrase(claim, missing) {
  const names = (missing && missing.length ? missing : claim.attributes).filter((name) => name !== "specification");
  if (names.length) return names.map((name) => name.replace(/_/g, " and ")).join(" and ");
  const typical = (claim.element?.attributes || []).map((name) => name.replace(/_/g, " and "));
  return typical.length ? `specification (${typical.join(", ")})` : "specification";
}

function focusedQuestion(claim, state, ctx, related, issue) {
  const sheet = ctx.fileName || ctx.sheetTitle || "this sheet";
  const what = attributePhrase(claim, state.missing);
  const stated = Object.entries(state.found || {}).map(([attribute, item]) => `${attribute}: "${item.quote}"`);
  const citation = issue?.codeReference ? `The candidate cites ${issue.codeReference}; that text is not verified against the adopted code.` : "No verified provision was supplied.";
  return [
    `${claim.element.label}: the ${what} is not stated on ${sheet}. Its text and graphic text were read.`,
    stated.length ? `It does state ${stated.join("; ")}.` : "",
    related.length
      ? `Related sheets that carry this element (${related.slice(0, 3).join(", ")}) do not state it either.`
      : "No related sheet that carries this element states it.",
    citation,
    "This is a verification question, not a confirmed violation.",
  ].filter(Boolean).join(" ");
}

function evidenceDetail(found, prefix) {
  const quotes = Object.entries(found).map(([attribute, item]) =>
    `${item.sheet ? `${item.sheet} ` : ""}states the ${attribute === "specification" ? "specification" : attribute}: "${item.quote}"`);
  return `${prefix} ${quotes.join("; ")}.`;
}

/**
 * Where the set states each attribute the claim names: this sheet first, then related sheets.
 */
function locateFacts(claim, ctx) {
  const own = { text: String(ctx.pageText || ""), sheet: ctx.fileName || ctx.sheetTitle || null };
  const related = relatedSources(claim, ctx);
  const evidence = attributeEvidence([own, ...related], claim);
  return { evidence, related };
}

/**
 * The calculation a value comparison relies on, resolved before the values are compared.
 * Values a stated method connects are not a discrepancy; the open question is the capacity.
 */
function calculationDecision(issue, claim, ctx, provenance) {
  const calculation = reconcileCalculation(issue, ctx.pageText);
  if (!calculation) return null;
  if (!calculation.explained) {
    return calculation.method
      ? { disposition: "reject", reason: "calculation_unresolved", detail: calculation.summary, provenance }
      : null;
  }
  const governing = calculation.governing;
  const target = claim.element || ELEMENTS.find((element) => element.id === "grease_interceptor") || null;
  const capacityClaim = { element: target, attributes: ["capacity"], kind: "missing" };
  const { evidence } = locateFacts(capacityClaim, ctx);
  if (evidence.answered) {
    return {
      disposition: "reject",
      reason: "calculation_reconciled",
      detail: `${calculation.summary} ${evidenceDetail(evidence.found, "The rated capacity is stated:")} Whether it is at least ${governing.value} ${governing.unit} is the remaining check.`,
      provenance,
    };
  }
  const label = target?.label || "equipment";
  return {
    disposition: "accept_question",
    reason: "calculation_reconciled",
    detail: `${calculation.summary} No sheet states the rated capacity of the ${label}. Confirm the ${label} is rated for at least ${governing.value} ${governing.unit}. This is a verification question, not a confirmed violation.`,
    provenance,
  };
}

/** Words on the sheet that establish an assembly is fire-rated. A firestopping note is not one. */
const RATED_PREMISE_ON_SHEET_RE =
  /\bfire[\s-]*(?:rated|rating|resist\w*|separation)\b|\b\d\s*-?\s*(?:hr|hour)s?\b|\bone[\s-]+hours?\b|\b[1-4]\s*h\b|\brated\b|\bul\s*(?:design\s*)?(?:no\.?\s*)?[a-z]?-?\d{3}\b|\bfire\s+(?:barrier|partition|wall)s?\b/i;
/** Elements whose requirement applies only when the sheet establishes a premise about them. */
const ELEMENT_PREMISES = { fire_rated_assembly: RATED_PREMISE_ON_SHEET_RE };
const MEASURED_ATTRIBUTES = new Set(["width", "clearance", "height", "distance", "opening", "riser_tread", "thickness"]);
/** A stated calculation already carries its own evidence. An evidence-chain accept does not. */
const SELF_EVIDENCED = new Set(["calculation_reconciled"]);
const CORPUS_UNAVAILABLE = "Code compliance unverified — applicable technical provision not available in the verified Code RAG corpus.";

function corpusUnavailableSentence(issue) {
  const citation = String(issue?.codeReference || "").trim();
  return citation
    ? `${CORPUS_UNAVAILABLE} Missing provision: ${citation}.`
    : CORPUS_UNAVAILABLE;
}

function echoesSheetNote(issue, corpus) {
  const words = distinctiveTokens(claimText(issue));
  if (words.length < 3) return false;
  const hay = String(corpus || "").toLowerCase();
  if (!hay) return false;
  const hits = words.filter((word) => hay.includes(word)).length;
  return hits >= Math.min(4, words.length) && hits / words.length >= 0.6;
}

/**
 * An evidence-chain accept with an unverified citation cannot be published as a warning
 * when the observation is empty, graphic evidence is unavailable, or the text restates a note.
 */
function withholdUnsupportedClaim(issue, decision, ctx) {
  if (!decision || decision.disposition !== "accept" || decision.reason !== "evidence_chain") return null;
  if (decision.provenance?.codeSourceStatus === "authoritative") return null;
  const claim = parseClaim(issue);
  const state = evidenceState(claim, ctx);
  const provenance = { ...(decision.provenance || {}), gated: true, priorReason: decision.reason };
  const sentence = corpusUnavailableSentence(issue);
  const page = String(ctx?.pageText || ctx?.corpus || "");
  if (!state.quote || state.state === "absent" || state.state === "unreadable" || state.reason === "graphic_evidence_unavailable") {
    return {
      disposition: "reject",
      reason: state.reason === "value_not_bound_to_element" ? "value_not_bound_to_element" : (state.reason || "graphic_evidence_unavailable"),
      detail: `A published warning cannot rest on an absent observation. ${sentence}`,
      provenance,
    };
  }
  if (isDocumentedProvision(issue, page) || isRestatement(issue, page) || echoesSheetNote(issue, page)) {
    return {
      disposition: "reject",
      reason: "requirement_already_on_sheet",
      detail: `The finding restates a drawing note. That note is not a verified deficiency. ${sentence}`,
      provenance,
    };
  }
  if (issue.severity === "warning" || issue.findingType === "potential_concern" || issue.evidenceStrength === "weak") {
    return {
      disposition: "reject",
      reason: "governing_code_unverified",
      detail: sentence,
      provenance,
    };
  }
  return null;
}

function numbersIn(values) {
  return [...new Set(values.map((value) => (String(value).match(/\d+(?:\.\d+)?/) || [])[0]).filter(Boolean))];
}

/**
 * A published advisory needs an identified element this sheet names, the premise that makes the
 * requirement apply, and, for a measured claim, a value tied to that element. A requirement note
 * ("WITHIN 24 INCHES OF A DOOR") is the requirement, not a measurement. Failing any of these the
 * candidate stays an unresolved check; it is never published as a generic allegation.
 */
function publicationGate(issue, decision, ctx) {
  if (!decision || !PUBLISHING.has(decision.disposition) || SELF_EVIDENCED.has(String(decision.reason || ""))) return decision;
  const unsupported = withholdUnsupportedClaim(issue, decision, ctx);
  if (unsupported) return unsupported;
  if (String(issue?.findingType || "") === "confirmed_violation" && decision.disposition === "accept") return decision;
  const claim = parseClaim(issue);
  const provenance = { ...(decision.provenance || {}), gated: true, priorReason: decision.reason || decision.disposition };
  const pageText = String(ctx?.pageText || "");
  const topic = cleanTopic(issue?.title) || "This check";
  if (!claim.element) {
    return {
      disposition: "reject",
      reason: "element_not_established",
      detail: `${topic} does not name a building element the drawings can be checked against, so it is not published. It stays an unresolved check.`,
      provenance,
    };
  }
  const spans = elementSpans(pageText, claim.element);
  if (!spans.length) {
    const read = graphicReadComplete(ctx);
    return {
      disposition: "reject",
      reason: read ? "element_not_established" : "graphic_evidence_unavailable",
      detail: read
        ? `This sheet's text and graphic text do not show the ${claim.element.label}, so "${topic}" is not established here. It stays an unresolved check.`
        : `The ${claim.element.label} is not named in this sheet's readable text, and its graphic text was not fully read, so absence is not inferred. The check stays open.`,
      provenance,
    };
  }
  const premise = ELEMENT_PREMISES[claim.element.id];
  if (premise && !spans.some((span) => premise.test(span.text))) {
    return {
      disposition: "reject",
      reason: "rated_assembly_not_established",
      detail: `This sheet shows walls or partitions ("${spans[0].text.slice(0, 100)}"), but none is identified here as a fire-rated assembly, so whether a rating is required is not established. Check the wall-type legend and the code basis for a rated separation; the check stays open.`,
      provenance,
    };
  }
  const measured = claim.attributes.filter((id) => MEASURED_ATTRIBUTES.has(id));
  if (claim.kind !== "missing" && measured.length) {
    const own = attributeEvidence([{ text: pageText, sheet: ctx?.fileName || null }], { ...claim, attributes: measured });
    if (!own.answered) {
      return {
        disposition: "reject",
        reason: "value_not_bound_to_element",
        detail: `No ${measured.join(" or ")} on this sheet is tied to the ${claim.element.label}; a dimension of another element does not establish it. "${topic}" stays an unresolved check until the ${claim.element.label} and its measured value are identified.`,
        provenance,
      };
    }
    if (onlyRequirementNotes(own.found)) {
      return {
        disposition: "reject",
        reason: "requirement_note_not_measurement",
        detail: `The ${measured.join(" and ")} printed for the ${claim.element.label} is a requirement note, not a measured condition, so "${topic}" stays an unresolved check.`,
        provenance,
      };
    }
  }
  const numbers = numbersIn(claim.values);
  const structured = gateMeasuredFact(ctx?.structuredDrawing, claim, numbers);
  if (structured) {
    return { disposition: "reject", reason: structured.reason, detail: structured.detail, provenance };
  }
  if (claim.kind === "missing") {
    const unbound = unboundMeasurement(ctx?.structuredDrawing, claim);
    if (unbound) return { disposition: "reject", reason: unbound.reason, detail: unbound.detail, provenance };
  }
  if (claim.kind !== "missing" && numbers.length) {
    const measuredSpans = spans.filter((span) => !NORMATIVE_NOTE_RE.test(span.text));
    const bound = numbers.some((number) => measuredSpans.some((span) => new RegExp(`(?<![\\d.])${number.replace(".", "\\.")}(?![\\d.])`).test(span.text)));
    if (!bound) {
      return {
        disposition: "reject",
        reason: "requirement_note_not_measurement",
        detail: `The values ${numbers.join(" and ")} are not tied to a specific ${claim.element.label} on this sheet${spans.some((span) => NORMATIVE_NOTE_RE.test(span.text)) ? "; they appear in a requirement note" : ""}. "${topic}" stays an unresolved check until the ${claim.element.label} they describe is identified.`,
        provenance,
      };
    }
  }
  return decision;
}

const NORMATIVE_NOTE_RE = /\b(?:shall|provide[ds]?|must|required|install|within)\b/i;

function challengeDecision(issue, decision, ctx) {
  return publicationGate(issue, challengeEvidence(issue, decision, ctx), ctx);
}

/**
 * Challenge a decision in both directions with element-bound evidence. A suppression must show
 * the passage that resolves it; a published "not shown" must survive a read of the full sheet.
 * Graphic content that was not read leaves the check open, never resolved or confirmed.
 */
function challengeEvidence(issue, decision, ctx) {
  if (!decision) return decision;
  const claim = parseClaim(issue);
  const provenance = { ...(decision.provenance || {}), challenged: true };
  const calc = calculationDecision(issue, claim, ctx, provenance);
  if (calc && outcomeForReason(String(decision.reason || ""), false) !== "not_applicable") {
    return { ...calc, provenance: { ...provenance, priorReason: decision.reason || null } };
  }
  if (!claim.element) return decision;
  const reason = String(decision.reason || "");
  const graphicOnly = claim.attributes.filter((id) => NOT_TEXT_ATTRIBUTES.has(id));
  if (graphicOnly.length && decision.disposition === "reject"
    && (ANSWERED_REASONS.has(reason) || reason === "special_inspection_documented")) {
    return {
      disposition: "reject",
      reason: "graphic_evidence_unavailable",
      detail: `The ${attributePhrase(claim, graphicOnly)} of the ${claim.element.label} is shown graphically, so extracted text can neither confirm nor rule it out. Check the drawing; the check stays open.`,
      provenance: { ...provenance, priorReason: reason },
    };
  }
  const restatement = decision.disposition === "reject" && RESTATEMENT_REASONS.has(reason);
  const answeredClaim = decision.disposition === "reject" && ANSWERED_REASONS.has(reason);
  const formatClaim = decision.disposition === "reject" && FORMAT_REASONS.has(reason);
  const publishing = PUBLISHING.has(decision.disposition);
  const published = publishing && claim.kind === "missing";
  const prior = { ...provenance, priorReason: reason || decision.disposition };

  // A published deficiency read from a sheet whose graphic text was not read is not established.
  if (publishing && claim.kind !== "missing" && graphicUnread(ctx) && !attributeEvidence([{ text: String(ctx.pageText || "") }], claim).answered) {
    return {
      disposition: "reject",
      reason: "graphic_evidence_unavailable",
      detail: `The ${claim.element.label} condition this candidate alleges is not stated in the readable sheet text, and the sheet's graphic text was not read. It is not published until the drawing is read.`,
      provenance: prior,
    };
  }
  // A published concern about an element this sheet does not name is not tied to its evidence.
  if (publishing && claim.kind !== "missing" && graphicReadComplete(ctx)
    && !elementSpans(String(ctx.pageText || ""), claim.element).length) {
    const notOwned = !ownsElement(ctx, claim.element);
    return {
      disposition: "reject",
      reason: notOwned ? "element_not_on_this_discipline_sheet" : "claim_not_tied_to_evidence",
      detail: notOwned
        ? `This sheet does not show the ${claim.element.label}, and its discipline does not normally carry it.`
        : `This sheet's text and graphic text do not name the ${claim.element.label}, so the concern is not tied to drawing evidence. It stays an unresolved check.`,
      provenance: prior,
    };
  }
  if (!restatement && !answeredClaim && !formatClaim && !published) return decision;

  const state = evidenceState(claim, ctx);
  const { evidence, related } = locateFacts(claim, ctx);
  // A sheet that states the value, not only the requirement, answers a claim that it is missing.
  // A reminder to comply stays open: a design note is not verification.
  if (restatement && claim.kind === "missing" && state.state === "present" && !state.uncorroborated && !onlyRequirementNotes(state.found)) {
    return { disposition: "reject", reason: "information_present", detail: evidenceDetail(state.found, "This sheet"), provenance: prior };
  }
  if (restatement) return { ...decision, provenance: { ...provenance, boundEvidence: state.found || {} } };
  // A resolution the bound evidence confirms keeps the verifier's own reason and cites the quote.
  if (answeredClaim && evidence.answered) {
    const where = Object.values(evidence.found).map((item) => item.sheet).find((sheet) => sheet && sheet !== (ctx.fileName || ctx.sheetTitle)) || null;
    const notesOnly = onlyRequirementNotes(evidence.found);
    const keepsOpen = outcomeForReason(reason) !== "resolved_by_evidence";
    if (notesOnly && keepsOpen) {
      return {
        ...decision,
        detail: `${evidenceDetail(evidence.found, "The set")} The note states the requirement; it is not evidence the condition is shown or met, so the check stays open.`,
        provenance: { ...provenance, boundEvidence: evidence.found },
      };
    }
    return {
      ...decision,
      reason: keepsOpen ? (where ? "cross_sheet_supplies_fact" : "information_present") : reason,
      detail: evidenceDetail(evidence.found, "Resolved by bound evidence:"),
      redirectFile: where || decision.redirectFile || null,
      provenance: { ...provenance, boundEvidence: evidence.found, fileName: where || provenance.fileName || null },
    };
  }
  if (state.state === "present" && !state.uncorroborated) {
    if (onlyRequirementNotes(state.found)) {
      return {
        disposition: "reject",
        reason: "requirement_already_on_sheet",
        detail: `${evidenceDetail(state.found, "This sheet")} The note states the requirement; it is not evidence the condition is shown or met, so the check stays open.`,
        provenance: prior,
      };
    }
    return { disposition: "reject", reason: "information_present", detail: evidenceDetail(state.found, "This sheet"), provenance: prior };
  }
  if (evidence.answered) {
    const where = Object.values(evidence.found).map((item) => item.sheet).find((sheet) => sheet && sheet !== (ctx.fileName || ctx.sheetTitle)) || null;
    return {
      disposition: "reject",
      reason: "cross_sheet_supplies_fact",
      detail: evidenceDetail(evidence.found, "The set states it:"),
      redirectFile: where,
      provenance: { ...prior, fileName: where },
    };
  }
  if (state.state === "present" && state.uncorroborated) {
    return {
      disposition: "reject",
      reason: "model_reported_present",
      detail: `The model read the ${claim.element.label} ${attributePhrase(claim)} from the drawing image, but no extracted text confirms it. The check stays open until the reading is confirmed.`,
      provenance: prior,
    };
  }
  if (state.state === "unreadable" || state.reason === "graphic_evidence_unavailable") {
    const graphicOnly = state.state !== "unreadable" && graphicReadComplete(ctx);
    return {
      disposition: "reject",
      reason: "graphic_evidence_unavailable",
      detail: graphicOnly
        ? `Whether this sheet shows the ${claim.element.label} ${attributePhrase(claim, state.missing)} is unresolved: that is shown graphically (linework or a stamp), which extracted text can neither confirm nor rule out. Check the drawing.`
        : `Whether this sheet shows the ${claim.element.label} ${attributePhrase(claim, state.missing)} is unresolved: its graphic content was not read, so absence is not inferred. Re-run with graphic text extraction or check the drawing.`,
      provenance: prior,
    };
  }
  if (state.state === "not_relevant") {
    return {
      disposition: "reject",
      reason: "element_not_on_this_discipline_sheet",
      detail: `This sheet does not show the ${claim.element.label}, and its discipline does not normally carry it.`,
      provenance: prior,
    };
  }
  if (state.reason === "existing_element_scope") {
    return {
      disposition: "reject",
      reason: "existing_element_scope",
      detail: `This sheet shows the ${claim.element.label} as existing ("${elementSpans(String(ctx.pageText || ""), claim.element)[0]?.text.slice(0, 120) || ""}"). Whether the work alters it, and so whether its ${attributePhrase(claim, state.missing)} must be documented, is unresolved.`,
      provenance: prior,
    };
  }
  if (state.reason === "value_not_bound_to_element") {
    return {
      disposition: "reject",
      reason: "value_not_bound_to_element",
      detail: `This sheet prints a ${attributePhrase(claim, state.missing)} value that the extracted text does not tie to the ${claim.element.label}; it may be the drawn dimension. Check the drawing; absence is not inferred.`,
      provenance: prior,
    };
  }
  if (state.reason === "schedule_values_not_bound") {
    return {
      disposition: "reject",
      reason: "schedule_values_not_bound",
      detail: `This sheet has a schedule or table for the ${claim.element.label}, but its ${attributePhrase(claim, state.missing)} values could not be tied to it in the extracted text. Check the schedule; absence is not inferred.`,
      provenance: prior,
    };
  }
  // Absent after a full read of this sheet, including its graphic text, and the related sheets,
  // on a sheet that names the element: the question is anchored to drawing evidence.
  if (claim.kind === "missing" && state.adequate && state.named && ownsElement(ctx, claim.element)) {
    const unbound = unboundMeasurement(ctx?.structuredDrawing, claim);
    if (unbound) {
      return { disposition: "reject", reason: unbound.reason, detail: unbound.detail, provenance: prior };
    }
    const relatedNames = related.filter((source) => elementSpans(source.text, claim.element).length).map((source) => source.sheet);
    return {
      disposition: "accept_question",
      reason: "fact_not_stated",
      detail: focusedQuestion(claim, state, ctx, relatedNames, issue),
      provenance: prior,
    };
  }
  if (published) return decision;
  if (answeredClaim) {
    return {
      disposition: "reject",
      reason: "resolution_not_element_bound",
      detail: `${decision.detail || "The candidate was closed as answered."} No passage on this or a related sheet states the ${claim.element.label} ${attributePhrase(claim, state.missing)}, so the check is reconsidered and stays open.`,
      provenance: prior,
    };
  }
  return {
    disposition: "reject",
    reason: "fact_not_found",
    detail: `The ${claim.element.label} ${attributePhrase(claim, state.missing)} is not stated on this sheet or a related sheet. The candidate does not establish a deficiency, so it stays an unresolved check.`,
    provenance: prior,
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

function visibleCopy(issue, decision) {
  const authoritative = decision.provenance?.codeSourceStatus === "authoritative";
  const sentence = corpusUnavailableSentence(issue);
  const detail = String(decision.detail || "");
  const description = authoritative || detail.includes(CORPUS_UNAVAILABLE) ? detail : `${detail} ${sentence}`.trim();
  const fix = String(issue.suggestedFix || "");
  const inventedThreshold = /\d/.test(fix) && /\b(?:inch(?:es)?|mm|gpm|minimum|maximum|between|at least)\b/i.test(fix);
  const suggestedFix = authoritative ? issue.suggestedFix : (inventedThreshold ? sentence : (fix || sentence));
  return { description, suggestedFix };
}

function applyDecision(issue, decision) {
  const codeSourceStatus = decision.provenance?.codeSourceStatus || "unverified";
  const copy = visibleCopy(issue, decision);
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
      description: copy.description,
      suggestedFix: copy.suggestedFix,
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
      description: `${decision.detail || "This is not a confirmed violation."}${redirect} The code citation is not a verified excerpt.${codeSourceStatus === "authoritative" ? "" : ` ${corpusUnavailableSentence(issue)}`}`,
      suggestedFix: copy.suggestedFix,
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
    description: copy.description,
    suggestedFix: copy.suggestedFix,
    userVisible: true,
  };
}

module.exports = {
  decideCandidate,
  challengeDecision,
  applyDecision,
  traceMeasures,
  sheetRole,
  sheetRoles,
  corpusHasToken,
  linkedSpan,
  cleanTopic,
  isDocumentedProvision,
};
