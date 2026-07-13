"use strict";

/**
 * Canonical Agent 5 communication categories per CET / UCI_All_Implementation_Phases §7.3.
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

const CLASSIFIER_VERSION = "d5-v1-keyword";
const LOW_CONFIDENCE_THRESHOLD = 0.7;

/**
 * Ordered rules — first strong match wins (most specific categories first).
 * Keywords derived from category names and existing PEPCO attention heuristics only.
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
      "acknowledged",
      "application received",
      "received your application",
      "initiated",
    ],
    confidence: 0.75,
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
 * @param {string | null | undefined} subject
 * @param {string | null | undefined} body
 */
function classifyCommunicationText(subject, body) {
  const haystack = `${subject ?? ""} ${body ?? ""}`.toLowerCase().replace(/\s+/g, " ").trim();

  if (!haystack) {
    return {
      classification: "unclassified",
      classification_confidence: 0,
      parsed_summary: "Empty communication content",
      parsed_action_items: [],
      needs_human_attention: true,
      classifier_method: "keyword",
      classifier_version: CLASSIFIER_VERSION,
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
      parsed_action_items: [],
      needs_human_attention: true,
      classifier_method: "keyword",
      classifier_version: CLASSIFIER_VERSION,
    };
  }

  const needsHumanAttention = best.confidence < LOW_CONFIDENCE_THRESHOLD;

  return {
    classification: best.category,
    classification_confidence: best.confidence,
    parsed_summary: `Keyword match: "${best.matched}" → ${best.category}`,
    parsed_action_items: needsHumanAttention
      ? [{ type: "human_review", reason: "low_confidence_keyword_match" }]
      : [],
    needs_human_attention: needsHumanAttention,
    classifier_method: "keyword",
    classifier_version: CLASSIFIER_VERSION,
    matched_keyword: best.matched,
  };
}

module.exports = {
  UCI_COMMUNICATION_CATEGORIES,
  CLASSIFIER_VERSION,
  LOW_CONFIDENCE_THRESHOLD,
  KEYWORD_RULES,
  isValidCategory,
  classifyCommunicationText,
};
