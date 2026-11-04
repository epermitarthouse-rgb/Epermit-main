/**
 * Stage 3 v2 pack builder: recovery page -> rows -> evidence model -> technical digest.
 * Pure function of its inputs; the worker adds job identity and writes the pack next to v1.
 */
import { associateBlocksToRegions } from "./layoutAssociate.mjs";
import { buildEvidenceModel } from "./stage3AnnotationModel.mjs";
import { rowsFromRecoveryPage } from "./stage3RowReconstruct.mjs";
import { buildStage3V2Pack } from "./stage3TechnicalDigest.mjs";

/** Layout region kind for each row, by the production association rule. */
export function rowRegions(rows, regions) {
  if (!regions?.length || !rows.length) return new Map();
  const assoc = associateBlocksToRegions(rows.map((r) => ({
    kind: "ocr_line", text: r.text, bbox: { ...r.box, unit: "pdf-point", origin: "bottom-left" },
  })), regions);
  return new Map(rows.map((r, i) => [r.rid, assoc[i]?.regionKind || null]));
}

export function buildStage3V2PackFromRecovery({ sheetId, layout, recovery, source = "4x3", maxChars, rows: givenRows }) {
  const page = recovery?.pages?.[0] || { words: [], lines: [] };
  const rows = givenRows || rowsFromRecoveryPage(page);
  const regions = rowRegions(rows, layout?.regions || []);
  const model = buildEvidenceModel(rows, { regionOf: (r) => regions.get(r.rid) || null });
  return buildStage3V2Pack({ sheetId, model, source, maxChars });
}
