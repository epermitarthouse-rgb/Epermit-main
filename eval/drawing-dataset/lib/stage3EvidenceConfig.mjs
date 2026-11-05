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
/** Revision of the v2 evidence model inside the v2 pack format; part of the v2 cache key. */
export const STAGE3_V2_MODEL_REVISION = "model.r4-format-tiebreak";

/** v2 pack bound (characters of promptBlock). The analyzer block total stays 3,200. */
export const STAGE3_V2_BUDGET = { maxCharsPerPack: 2600, maxTotalChars: 3200 };

const GRIDS = new Set(["4x3", "12x9"]);
const RESOLUTIONS = new Set(["production", "s4"]);

/**
 * Normalise worker evidence options. Unknown or unsafe values throw, so a bad run scope
 * fails the v2 build (v1 is unaffected) instead of silently running another configuration.
 */
/**
 * Worker CLI arguments for a run's `analysis_scope` (daemon). `stage3EvidenceVersion: "v2"` adds the
 * v2 build and upload; `stage3OcrGrid: "12x9"` makes that build use 12x9 + S4, and only with v2.
 * Any other value is reported in `ignored` and the run continues on v1 / 4x3.
 */
export function stage3ScopeArgs(scope = {}) {
  const ignored = [];
  const blank = (v) => v == null || v === "";
  const version = scope?.stage3EvidenceVersion;
  const v2 = version === "v2";
  if (!v2 && !blank(version) && version !== "v1") ignored.push({ event: "evidence_version_ignored", value: String(version).slice(0, 40) });
  const grid = scope?.stage3OcrGrid;
  const fine = v2 && grid === "12x9";
  if (!fine && !blank(grid) && grid !== "4x3") ignored.push({ event: "ocr_grid_ignored", value: String(grid).slice(0, 40) });
  return {
    evidenceVersion: v2 ? "v2" : "v1",
    ocrGrid: fine ? "12x9" : "4x3",
    syncArgs: v2 ? ["--evidence-version", "v2"] : [],
    buildArgs: fine ? ["--ocr-grid", "12x9"] : [],
    ignored,
  };
}

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
