"use strict";

const { CODE_PROVISIONS } = require("../rag/codeCorpus.js");

/**
 * Deterministic checks. They suppress false allegations.
 * They do not create a confirmed violation from a citation.
 * @param {{
 *   pageText?: string | null;
 *   fileName?: string | null;
 *   contentClass?: string | null;
 *   drawingRecords?: Array<Record<string, unknown>>;
 * }} ctx
 */
function evaluateRules(ctx) {
  const corpus = [
    ctx.pageText,
    ...(ctx.drawingRecords || []).map((record) => record.text),
  ]
    .filter(Boolean)
    .join("\n");
  const results = [];
  for (const rule of CODE_PROVISIONS) {
    const fired = ruleFires(rule, corpus, ctx);
    results.push({
      ruleId: rule.id,
      version: rule.version,
      sourceStatus: rule.sourceStatus,
      authoritative: rule.authoritative,
      fired,
      effect: fired ? "suppress_missing_or_inapplicable" : "not_applicable",
      requirement: rule.requirement,
    });
  }
  return results;
}

function ruleFires(rule, corpus, ctx) {
  const name = `${ctx.fileName || ""} ${ctx.contentClass || ""}`;
  if (rule.id === "egress-width-sheet-applicability") {
    return /\bEQ[-.\s]?\d/i.test(name) || /\bequipment\s+plan\b/i.test(name);
  }
  if (rule.id === "fire-rating-tag-on-plan") {
    return /\b\d+\s*-?\s*(?:hour|hr)\b|\b1\s*hr\b/i.test(corpus);
  }
  if (rule.id === "emergency-lighting-note") {
    return /\bemergency\s+light/i.test(corpus);
  }
  if (rule.id === "plumbing-note-already-specified") {
    return /\bwater[\s-]*hammer|\bdraft[\s-]*stop\b|\bgfci\b/i.test(corpus);
  }
  return false;
}

module.exports = {
  evaluateRules,
};
