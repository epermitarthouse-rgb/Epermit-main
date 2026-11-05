/**
 * v1 excerpt selection: one printed place read twice by OCR (overlapping tiles) must not be quoted
 * as two different identifiers. A later hit is merged into an earlier kept hit only when their boxes
 * overlap (>= half of the smaller box) and one reading contains the other only after folding the
 * glyphs Vision confuses (O/0, I/l/|/1); spacing, quote-mark and truncation duplicates are left as
 * v1 always quoted them. Identical identifiers printed at
 * different places stay separate. The first reading in the extractor's order is kept as printed,
 * unless the later one contains it (the first was truncated): the longer reading then takes the
 * first one's position. The merged reading is returned for provenance.
 */
const plain = (t) => String(t ?? "").toUpperCase().replace(/["'″“”’‘\s]/g, "");
const fold = (t) => plain(t).replace(/[OI|L]/g, (c) => (c === "O" ? "0" : "1"));
const contains = (a, b) => a.includes(b) || b.includes(a);
/** Same text only once glyphs are folded: spacing or truncation alone does not qualify. */
const glyphVariant = (a, b) => contains(fold(a), fold(b)) && !contains(plain(a), plain(b));

function overlapSmaller(a, b) {
  if (!a || !b) return 0;
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  if (w <= 0 || h <= 0) return 0;
  return (w * h) / Math.max(1e-6, Math.min(a.width * a.height, b.width * b.height));
}

export const SAME_PLACE_OVERLAP = 0.5;

/**
 * Hits in order with same-place readings merged; returns { hits, merged: [{ kept, variant }] }.
 * dropExactRepeats (default true) also drops repeats of an identical text anywhere, as the pilot
 * extractors' Set de-duplication did.
 */
export function mergeSamePlaceReadings(hits, { dropExactRepeats = true } = {}) {
  const kept = [];
  const merged = [];
  const seenText = new Set();
  for (const hit of hits) {
    if (dropExactRepeats && seenText.has(hit.text)) continue;
    const f = fold(hit.text);
    const at = f ? kept.findIndex((k) => overlapSmaller(k.bbox, hit.bbox) >= SAME_PLACE_OVERLAP && glyphVariant(k.text, hit.text)) : -1;
    if (at >= 0) {
      const prior = kept[at];
      if (f.length > fold(prior.text).length) {
        kept[at] = hit;
        seenText.add(hit.text);
        merged.push({ kept: hit.text, variant: prior.text });
      } else {
        merged.push({ kept: prior.text, variant: hit.text });
      }
      continue;
    }
    seenText.add(hit.text);
    kept.push(hit);
  }
  return { hits: kept, merged };
}
