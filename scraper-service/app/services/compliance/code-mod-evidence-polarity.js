"use strict";

function normalizeText(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

const NEGATIVE_EVIDENCE =
  /\b(not included|not shown|not provided|not indicated|not present|not depicted|absent|omitted|excluded|without|does not include|does not show|does not indicate)\b/;

const POSITIVE_EVIDENCE =
  /\b(included|shown|provided|indicated|present|installed|depicted|noted|provided for|designed for|class i|class 1|class ii|class 2)\b/;

function evidencePolarity(text) {
  const normalized = normalizeText(text);
  if (!normalized) return "neutral";
  const negative = NEGATIVE_EVIDENCE.test(normalized);
  const positive = POSITIVE_EVIDENCE.test(normalized);
  if (negative && !positive) return "negative";
  if (positive && !negative) return "positive";
  if (negative && positive) {
    const negPosPhrases = [
      ["not included", "included"],
      ["not shown", "shown"],
      ["not provided", "provided"],
      ["not indicated", "indicated"],
      ["not present", "present"],
      ["not depicted", "depicted"],
    ];
    for (const [negPhrase, posWord] of negPosPhrases) {
      if (
        new RegExp(`\\b${negPhrase}\\b`).test(normalized) &&
        new RegExp(`\\b${posWord}\\b`).test(normalized)
      ) {
        return "negative";
      }
    }
    return "neutral";
  }
  return "neutral";
}

function excerptsContradict(left, right) {
  const a = normalizeText(left);
  const b = normalizeText(right);
  if (!a || !b || a === b) return false;

  const leftPolarity = evidencePolarity(a);
  const rightPolarity = evidencePolarity(b);
  if (leftPolarity === "negative" && rightPolarity === "positive") return true;
  if (leftPolarity === "positive" && rightPolarity === "negative") return true;

  return (
    (/\bnot included\b/.test(a) && /\bincluded\b/.test(b)) ||
    (/\bincluded\b/.test(a) && /\bnot included\b/.test(b))
  );
}

module.exports = {
  evidencePolarity,
  excerptsContradict,
};
