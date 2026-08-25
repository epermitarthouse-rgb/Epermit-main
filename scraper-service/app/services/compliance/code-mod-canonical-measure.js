"use strict";

const ARTICLE_PATTERN = /\b(a|an|the)\b/gi;

function normalizeMeasureText(text) {
  return String(text ?? "")
    .trim()
    .toLowerCase()
    .replace(/[''`]/g, "'")
    .replace(/[""]/g, '"')
    .replace(/[.,;:!?]+$/g, "")
    .replace(/\s+/g, " ")
    .replace(ARTICLE_PATTERN, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function measureTokens(text) {
  const normalized = normalizeMeasureText(text);
  if (!normalized) return [];
  return normalized
    .split(/\s+/)
    .filter((token) => token.length > 2 || /^\d+$/.test(token));
}

function measuresAreCanonicallyEquivalent(left, right) {
  const a = normalizeMeasureText(left);
  const b = normalizeMeasureText(right);
  if (!a || !b) return a === b;
  if (a === b) return true;

  const leftTokens = measureTokens(a);
  const rightTokens = measureTokens(b);
  if (leftTokens.length === 0 || rightTokens.length === 0) return false;
  if (leftTokens[0] !== rightTokens[0]) return false;

  const leftSet = new Set(leftTokens);
  const rightSet = new Set(rightTokens);
  const intersection = leftTokens.filter((token) => rightSet.has(token)).length;
  const union = new Set([...leftSet, ...rightSet]).size;
  const jaccard = union > 0 ? intersection / union : 0;
  return jaccard >= 0.85 && Math.abs(leftTokens.length - rightTokens.length) <= 1;
}

function canonicalMeasureKey(finding) {
  const normalizedMeasure = normalizeMeasureText(finding.measure);
  if (normalizedMeasure) return normalizedMeasure;
  const normalizedId = normalizeMeasureText(finding.measureId);
  if (normalizedId && !/^measure-\d+$/.test(normalizedId)) return normalizedId;
  return normalizeMeasureText(finding.id) || "unknown-measure";
}

function preferCanonicalMeasureLabel(left, right) {
  const a = String(left ?? "").trim();
  const b = String(right ?? "").trim();
  if (!a) return b;
  if (!b) return a;
  return a.length >= b.length ? a : b;
}

function preferCanonicalMeasureId(left, right) {
  const a = left?.trim() || null;
  const b = right?.trim() || null;
  if (a && b && a === b) return a;
  if (a && /^measure-\d+$/i.test(a)) return a;
  if (b && /^measure-\d+$/i.test(b)) return b;
  return a ?? b;
}

module.exports = {
  normalizeMeasureText,
  measuresAreCanonicallyEquivalent,
  canonicalMeasureKey,
  preferCanonicalMeasureLabel,
  preferCanonicalMeasureId,
};
