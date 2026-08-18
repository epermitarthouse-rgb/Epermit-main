"use strict";

/**
 * Canonical Agent 5 communication categories per CET / UCI_All_Implementation_Phases §7.3.
 * Confidence threshold A5.11: <0.75 → human attention.
 * @type {readonly string[]}
 */
const UCI_COMMUNICATION_CATEGORIES = Object.freeze([
  "acknowledgment",
  "class_of_service",
  "design_review_response",
  "ciac_invoice",
  "equipment_eta_update",
  "inspection_release_request",
  "meter_set_scheduling",
  "energization_confirmation",
  "escalation_or_problem",
  "request_for_information",
  "unclassified",
]);

const CLASSIFIER_VERSION = "stage5-v3-llm-keyword";
const KEYWORD_CLASSIFIER_VERSION = "stage5-v2-keyword";
/** A5.11 — confidence below this requires human attention */
const LOW_CONFIDENCE_THRESHOLD = 0.75;

/**
 * Ordered rules — first strong match wins (most specific categories first).
 * @type {readonly { category: string, keywords: readonly string[], confidence: number }[]}
 */
const KEYWORD_RULES = Object.freeze([
  {
    category: "meter_set_scheduling",
    keywords: ["meter set", "meter installation", "set meter", "meter schedule"],
    confidence: 0.82,
  },
  {
    category: "energization_confirmation",
    keywords: ["energiz", "power on", "service connected", "energization"],
    confidence: 0.82,
  },
  {
    category: "class_of_service",
    keywords: ["class of service", "cos issued", "class_of_service"],
    confidence: 0.8,
  },
  {
    category: "design_review_response",
    keywords: ["design review", "technical review", "in design", "in technical review"],
    confidence: 0.78,
  },
  {
    category: "ciac_invoice",
    keywords: [
      "ciac",
      "contribution in aid",
      "construction cost",
      "contract sent",
      "payment due",
      "invoice",
    ],
    confidence: 0.78,
  },
  {
    category: "equipment_eta_update",
    keywords: ["equipment eta", "delivery date", "long lead", "equipment delivery"],
    confidence: 0.76,
  },
  {
    category: "inspection_release_request",
    keywords: ["inspection release", "release inspection", "inspection request"],
    confidence: 0.76,
  },
  {
    category: "acknowledgment",
    keywords: [
      "acknowledgment",
      "acknowledgement",
      "acknowledged",
      "application received",
      "received your application",
      "we have received",
      "ticket assigned",
      "project number assigned",
      "initiated",
    ],
    confidence: 0.78,
  },
  {
    category: "request_for_information",
    keywords: [
      "information required",
      "information needed",
      "please provide",
      "missing document",
      "missing documents",
      "request for information",
      "rfi",
    ],
    confidence: 0.77,
  },
  {
    category: "escalation_or_problem",
    keywords: [
      "rejected",
      "escalat",
      "problem",
      "failed",
      "action required",
      "urgent",
      "expiration",
      "deadline",
    ],
    confidence: 0.74,
  },
]);

/**
 * @param {unknown} value
 * @returns {value is string}
 */
function isValidCategory(value) {
  return typeof value === "string" && UCI_COMMUNICATION_CATEGORIES.includes(value);
}

/**
 * Extract common acknowledgment fields from free text (best-effort).
 * @param {string} haystack
 */
function extractAckFieldsFromText(haystack) {
  const text = String(haystack || "");
  const ticketMatch =
    text.match(
      /\b(?:ticket|work\s*order|wo|project\s*(?:#|number|no\.?)|application\s*(?:#|id)|case)\s*[:#]?\s*([A-Z0-9][-A-Z0-9/]{3,})\b/i,
    ) || text.match(/\b(LC[- ]?\d{4,}|\d{6,})\b/);
  const pmMatch = text.match(
    /\b(?:project\s*manager|utility\s*pm|assigned\s*(?:to|pm)|pm)\s*[:\-]?\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i,
  );
  const accountMatch = text.match(
    /\b(?:account|acct|utility\s*account)\s*(?:#|number|no\.?)?\s*[:#]?\s*([A-Z0-9-]{4,})\b/i,
  );

  /** @type {string | null} */
  let nextAction = null;
  if (/missing document|information required|rfi|please provide/i.test(text)) {
    nextAction = "Respond to utility information request";
  } else if (/class of service|design review|technical review/i.test(text)) {
    nextAction = "Monitor class of service / design review";
  } else if (/acknowledgment|received your application|initiated|ticket assigned/i.test(text)) {
    nextAction = "Monitor for class of service / design review";
  }

  return {
    utility_ticket_number: ticketMatch ? String(ticketMatch[1]).trim() : null,
    utility_project_manager: pmMatch ? String(pmMatch[1]).trim() : null,
    utility_account_number: accountMatch ? String(accountMatch[1]).trim() : null,
    next_required_action: nextAction,
  };
}

/**
 * @param {string | null | undefined} subject
 * @param {string | null | undefined} body
 */
function classifyCommunicationText(subject, body) {
  const haystack = `${subject ?? ""} ${body ?? ""}`.toLowerCase().replace(/\s+/g, " ").trim();
  const extracted = extractAckFieldsFromText(`${subject ?? ""}\n${body ?? ""}`);

  if (!haystack) {
    return {
      classification: "unclassified",
      classification_confidence: 0,
      parsed_summary: "Empty communication content",
      parsed_action_items: [],
      needs_human_attention: true,
      classifier_method: "keyword",
      classifier_version: KEYWORD_CLASSIFIER_VERSION,
      extracted_fields: extracted,
    };
  }

  /** @type {{ category: string, confidence: number, matched: string } | null} */
  let best = null;

  for (const rule of KEYWORD_RULES) {
    for (const keyword of rule.keywords) {
      if (haystack.includes(keyword.toLowerCase())) {
        if (!best || rule.confidence > best.confidence) {
          best = { category: rule.category, confidence: rule.confidence, matched: keyword };
        }
        break;
      }
    }
  }

  if (!best) {
    return {
      classification: "unclassified",
      classification_confidence: 0.35,
      parsed_summary: "No keyword rule matched — human triage recommended",
      parsed_action_items: [{ type: "human_review", reason: "unclassified" }],
      needs_human_attention: true,
      classifier_method: "keyword",
      classifier_version: KEYWORD_CLASSIFIER_VERSION,
      extracted_fields: extracted,
    };
  }

  const needsHumanAttention =
    best.confidence < LOW_CONFIDENCE_THRESHOLD ||
    best.category === "unclassified" ||
    best.category === "escalation_or_problem" ||
    best.category === "request_for_information";

  /** @type {Array<Record<string, unknown>>} */
  const actionItems = [];
  if (needsHumanAttention) {
    actionItems.push({ type: "human_review", reason: "low_confidence_or_attention_category" });
  }
  if (extracted.next_required_action) {
    actionItems.push({ type: "next_action", detail: extracted.next_required_action });
  }

  return {
    classification: best.category,
    classification_confidence: best.confidence,
    parsed_summary: `Keyword match: "${best.matched}" → ${best.category}`,
    parsed_action_items: actionItems,
    needs_human_attention: needsHumanAttention,
    classifier_method: "keyword",
    classifier_version: KEYWORD_CLASSIFIER_VERSION,
    matched_keyword: best.matched,
    extracted_fields: extracted,
  };
}

module.exports = {
  UCI_COMMUNICATION_CATEGORIES,
  CLASSIFIER_VERSION,
  KEYWORD_CLASSIFIER_VERSION,
  LOW_CONFIDENCE_THRESHOLD,
  KEYWORD_RULES,
  isValidCategory,
  classifyCommunicationText,
  extractAckFieldsFromText,
};
