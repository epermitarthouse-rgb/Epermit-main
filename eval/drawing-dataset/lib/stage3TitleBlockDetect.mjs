/**
 * Stage 3 v2 title-block detection from printed rules (worker path only; layout_reconstruct.py
 * is unchanged).
 *
 * The cached layout labels everything right of 72% of the page width as title block and the
 * bottom 22% as a notes band (sheet-band heuristic). On the evaluated sheets the printed
 * title-block border is a rule running nearly the full page height at about 89% of the width,
 * and there is no notes band. When such a rule is found, the heuristic band regions are replaced
 * by title_block (right of the rule) and drawing_field (left of it); other detected regions
 * (schedule grids, components) are kept. Without a rule the heuristic regions are kept and the
 * method says so.
 */

export const TITLE_BLOCK_MIN_HEIGHT_FRAC = 0.85;
export const TITLE_BLOCK_X_RANGE = [0.6, 0.97];

const BAND_IDS = new Set(["band-title-block", "band-bottom-notes", "band-drawing-field"]);

/** The title-block border: right-most near-full-height rule inside the right part of the page. */
export function detectTitleBlockBorder(geometry) {
  if (!geometry?.vertical?.length || !geometry.pageWidth || !geometry.pageHeight) return null;
  const W = geometry.pageWidth, H = geometry.pageHeight;
  const candidates = geometry.vertical.filter((v) => v.y1 - v.y0 >= TITLE_BLOCK_MIN_HEIGHT_FRAC * H
    && v.x >= TITLE_BLOCK_X_RANGE[0] * W && v.x <= TITLE_BLOCK_X_RANGE[1] * W);
  if (!candidates.length) return null;
  const rule = candidates.reduce((a, b) => (b.x > a.x ? b : a));
  return { x: rule.x, rule, heightFraction: Math.round(((rule.y1 - rule.y0) / H) * 1000) / 1000 };
}

const region = (id, kind, x, y, width, height) => ({
  id, kind,
  bbox: { x, y, width, height, unit: "pdf-point", origin: "bottom-left" },
  method: "stage3-printed-rule",
  confidence: "measured_rule",
  origin: "machine_detected",
  independentlyVerified: false,
});

/**
 * Regions for v2 association. Returns { regions, titleBlock } where titleBlock records the method:
 * "printed_rule" (border x and rule) or "heuristic_band" with the reason.
 */
export function groundLayoutRegions(regions, geometry) {
  const base = regions || [];
  if (!geometry) return { regions: base, titleBlock: { method: "heuristic_band", reason: "page_geometry_unavailable" } };
  const border = detectTitleBlockBorder(geometry);
  if (!border) return { regions: base, titleBlock: { method: "heuristic_band", reason: "no_full_height_rule" } };
  const W = geometry.pageWidth, H = geometry.pageHeight;
  const kept = base.filter((r) => !BAND_IDS.has(r.id));
  return {
    regions: [
      region("rule-title-block", "title_block", border.x, 0, Math.round((W - border.x) * 10) / 10, H),
      region("rule-drawing-field", "drawing_field", 0, 0, border.x, H),
      ...kept,
    ],
    titleBlock: { method: "printed_rule", x: border.x, heightFraction: border.heightFraction },
  };
}
