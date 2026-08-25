/**
 * Canonical measure identity for Code Modification synthesis.
 * Collapses semantically identical measure wording without merging distinct requirements.
 */

import type { EvidenceFinding } from "./model";

const ARTICLE_PATTERN = /\b(a|an|the)\b/gi;

/** Normalize measure text for stable identity comparison. */
export function normalizeMeasureText(text: string | null | undefined): string {
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

/** Distinctive tokens that must match for conservative fuzzy equivalence. */
function measureTokens(text: string): string[] {
  const normalized = normalizeMeasureText(text);
  if (!normalized) return [];
  return normalized
    .split(/\s+/)
    .filter((token) => token.length > 2 || /^\d+$/.test(token));
}

/**
 * Conservative fuzzy equivalence: identical normalized text, or high token overlap
 * with the same leading action verb (prevents sprinkler vs fire-alarm collapse).
 */
export function measuresAreCanonicallyEquivalent(
  left: string | null | undefined,
  right: string | null | undefined,
): boolean {
  const a = normalizeMeasureText(left);
  const b = normalizeMeasureText(right);
  if (!a || !b) return a === b;
  if (a === b) return true;

  const leftTokens = measureTokens(a);
  const rightTokens = measureTokens(b);
  if (leftTokens.length === 0 || rightTokens.length === 0) return false;

  const leftVerb = leftTokens[0];
  const rightVerb = rightTokens[0];
  if (leftVerb !== rightVerb) return false;

  const leftSet = new Set(leftTokens);
  const rightSet = new Set(rightTokens);
  const intersection = leftTokens.filter((token) => rightSet.has(token)).length;
  const union = new Set([...leftSet, ...rightSet]).size;
  const jaccard = union > 0 ? intersection / union : 0;

  // Require strong overlap and identical token counts within one article/punctuation delta.
  return jaccard >= 0.85 && Math.abs(leftTokens.length - rightTokens.length) <= 1;
}

/** Stable merge key for evidence findings. Prefers normalized measure text over raw IDs. */
export function canonicalMeasureKey(
  finding: Pick<EvidenceFinding, "measureId" | "measure" | "id">,
): string {
  const normalizedMeasure = normalizeMeasureText(finding.measure);
  if (normalizedMeasure) return normalizedMeasure;

  const normalizedId = normalizeMeasureText(finding.measureId);
  if (normalizedId && !/^measure-\d+$/.test(normalizedId)) return normalizedId;

  return normalizeMeasureText(finding.id) || "unknown-measure";
}

/** Pick the most descriptive measure label when merging equivalent findings. */
export function preferCanonicalMeasureLabel(
  left: string | null | undefined,
  right: string | null | undefined,
): string {
  const a = String(left ?? "").trim();
  const b = String(right ?? "").trim();
  if (!a) return b;
  if (!b) return a;
  return a.length >= b.length ? a : b;
}

/** Prefer a stable measureId when both refer to the same canonical measure. */
export function preferCanonicalMeasureId(
  left: string | null | undefined,
  right: string | null | undefined,
): string | null {
  const a = left?.trim() || null;
  const b = right?.trim() || null;
  if (a && b && a === b) return a;
  if (a && /^measure-\d+$/i.test(a)) return a;
  if (b && /^measure-\d+$/i.test(b)) return b;
  return a ?? b;
}
