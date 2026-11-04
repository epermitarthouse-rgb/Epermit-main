/**
 * Stage 3 evidence versions and run-scoped options (Mac worker side).
 *
 * v1 is the production pack and stays the default. v2 is the annotation-level
 * technical digest, produced only when a job asks for it. Options are validated
 * so unsafe combinations cannot run: 12x9 tiling requires S4 resolution, because
 * production deduplication on 12x9 delivers contradicted readings.
 */

export const STAGE3_EVIDENCE_V1 = "phase3.stage3-visual-evidence.v1";
export const STAGE3_EVIDENCE_V2 = "phase3.stage3-visual-evidence.v2";
export const STAGE3_EVIDENCE_VERSIONS = { v1: STAGE3_EVIDENCE_V1, v2: STAGE3_EVIDENCE_V2 };

/** v2 pack bound (characters of promptBlock). The analyzer block total stays 3,200. */
export const STAGE3_V2_BUDGET = { maxCharsPerPack: 2600, maxTotalChars: 3200 };

const GRIDS = new Set(["4x3", "12x9"]);
const RESOLUTIONS = new Set(["production", "s4"]);

/**
 * Normalise worker evidence options. Unknown or unsafe values throw, so a bad run scope
 * fails the v2 build (v1 is unaffected) instead of silently running another configuration.
 */
export function resolveStage3EvidenceOptions(input = {}) {
  const evidenceVersion = input.evidenceVersion == null || input.evidenceVersion === "" ? "v1" : String(input.evidenceVersion);
  if (!STAGE3_EVIDENCE_VERSIONS[evidenceVersion]) throw new Error(`stage3_evidence_version_unknown:${evidenceVersion}`);
  const ocrGrid = input.ocrGrid == null || input.ocrGrid === "" ? "4x3" : String(input.ocrGrid);
  if (!GRIDS.has(ocrGrid)) throw new Error(`stage3_ocr_grid_unknown:${ocrGrid}`);
  const resolution = input.resolution == null || input.resolution === "" ? (ocrGrid === "12x9" ? "s4" : "production") : String(input.resolution);
  if (!RESOLUTIONS.has(resolution)) throw new Error(`stage3_resolution_unknown:${resolution}`);
  if (ocrGrid === "12x9" && resolution !== "s4") throw new Error("stage3_ocr_grid_12x9_requires_s4");
  if (ocrGrid !== "4x3" && evidenceVersion !== "v2") throw new Error("stage3_ocr_grid_requires_v2");
  return { evidenceVersion, ocrGrid, resolution, extractionVersion: STAGE3_EVIDENCE_VERSIONS[evidenceVersion] };
}
