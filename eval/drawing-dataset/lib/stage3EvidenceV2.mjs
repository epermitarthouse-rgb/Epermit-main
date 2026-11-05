/**
 * Stage 3 v2 pack builder: recovery page -> rows -> evidence model -> technical digest.
 * Pure function of its inputs; the worker adds job identity and writes the pack next to v1.
 *
 * With page geometry (printed rules from the PDF), the title block comes from the printed border,
 * table cells are split at their rules and reassembled as records. Without it, the cached layout's
 * heuristic bands and gap-only splitting are used, and the pack records why.
 */
import { associateBlocksToRegions } from "./layoutAssociate.mjs";
import { buildEvidenceModel } from "./stage3AnnotationModel.mjs";
import { reconstructRows, textLayerSpans } from "./stage3RowReconstruct.mjs";
import { buildStage3V2Pack } from "./stage3TechnicalDigest.mjs";
import { groundLayoutRegions } from "./stage3TitleBlockDetect.mjs";

/** Layout region kind for each row, by the production association rule. */
export function rowRegions(rows, regions) {
  if (!regions?.length || !rows.length) return new Map();
  const assoc = associateBlocksToRegions(rows.map((r) => ({
    kind: "ocr_line", text: r.text, bbox: { ...r.box, unit: "pdf-point", origin: "bottom-left" },
  })), regions);
  return new Map(rows.map((r, i) => [r.rid, assoc[i]?.regionKind || null]));
}

/** Rows, regions and model for one sheet (exported for the harness). */
export function buildStage3V2Model({ layout, recovery, geometry = null, rows: givenRows }) {
  const page = recovery?.pages?.[0] || { words: [], lines: [] };
  const grounded = groundLayoutRegions(layout?.regions || [], geometry);
  const { rows, echoes } = givenRows ? { rows: givenRows, echoes: [] } : reconstructRows(page, { geometry, textSpans: textLayerSpans(layout) });
  const regions = rowRegions(rows, grounded.regions);
  const model = buildEvidenceModel(rows, { regionOf: (r) => regions.get(r.rid) || null, geometry });
  const layoutProvenance = {
    geometry: geometry ? { version: geometry.version, density: geometry.density } : { status: "unavailable" },
    titleBlock: grounded.titleBlock,
    cellSplits: rows.filter((r) => /rule/.test(r.splitBy || "")).length,
    records: model.annotations.filter((a) => a.layout === "record").length,
    textLayerEchoesExcluded: echoes.length,
  };
  return { rows, echoes, regions: grounded.regions, model, layoutProvenance };
}

export function buildStage3V2PackFromRecovery({ sheetId, layout, recovery, source = "4x3", maxChars, rows, geometry = null }) {
  const { model, layoutProvenance } = buildStage3V2Model({ layout, recovery, geometry, rows });
  return buildStage3V2Pack({ sheetId, model, source, maxChars, layoutProvenance });
}
