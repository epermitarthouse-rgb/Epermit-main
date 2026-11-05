/**
 * Supabase Analyzer version selected for one run, persisted on `analysis_scope.analyzerVersion`.
 *
 * v1 is the production default and is unchanged. v2 adds annotation-level Stage 3 evidence: the Mac
 * worker builds v2 packs from 4x3 OCR for every sheet before GPT (full-coverage gate), and the
 * analyzer uses the project-level sheet index and reference-only validation verified with it.
 * 12x9 OCR is never part of v2 from this path.
 */
import { mergeStage3FullCoverageRunOptIn } from "./analyzerStage3OcrReadiness.ts";

export type AnalyzerVersion = "v1" | "v2";

export const ANALYZER_V2_OCR_GRID = "4x3";
/** Revision of the v2 evidence model the worker must build (part of its v2 cache key). */
export const ANALYZER_V2_MODEL_REVISION = "model.r6-downstream";

export function parseAnalyzerVersion(value: unknown): AnalyzerVersion | { error: string } {
  if (value == null || value === "" || value === "v1") return "v1";
  if (value === "v2") return "v2";
  return { error: "analyzerVersion must be v1 or v2" };
}

export function analyzerVersionOf(analysisScope: unknown): AnalyzerVersion {
  if (!analysisScope || typeof analysisScope !== "object" || Array.isArray(analysisScope)) return "v1";
  return (analysisScope as Record<string, unknown>).analyzerVersion === "v2" ? "v2" : "v1";
}

/** Why a v2 request cannot run right now, or null. Rollback: SUPABASE_ANALYZER_V2_ENABLED=false. */
export function analyzerV2Unavailable(env: { get(key: string): string | undefined }): string | null {
  if (env.get("SUPABASE_ANALYZER_V2_ENABLED")?.trim().toLowerCase() === "false") {
    return "Supabase Analyzer V2 is temporarily unavailable. Use V1.";
  }
  if (env.get("ANALYZER_STAGE3_VISUAL_EVIDENCE")?.trim().toLowerCase() === "false") {
    return "Supabase Analyzer V2 is unavailable while Stage 3 evidence is switched off. Use V1.";
  }
  return null;
}

/**
 * Scope for a new run. v1 keeps the given scope (including an operator's full-coverage opt-in) and
 * records the version. v2 always opts into the full-coverage gate with v2 evidence on 4x3 OCR.
 */
export function withAnalyzerVersion(
  analysisScope: object,
  version: AnalyzerVersion,
  options: { requiredSheetCount: number },
): Record<string, unknown> {
  if (version === "v1") return { ...analysisScope, analyzerVersion: "v1" };
  return {
    ...mergeStage3FullCoverageRunOptIn({ ...analysisScope }, true, options),
    analyzerVersion: "v2",
    stage3EvidenceVersion: "v2",
    stage3OcrGrid: ANALYZER_V2_OCR_GRID,
    stage3V2ModelRevision: ANALYZER_V2_MODEL_REVISION,
  };
}

/**
 * After drawings are added to a v2 run, the new sheets need OCR before GPT: reopen the gate for the
 * new sheet count. Other runs are returned unchanged.
 */
export function reopenAnalyzerV2Gate(
  analysisScope: unknown,
  totalSheets: number,
  now = new Date().toISOString(),
): Record<string, unknown> | null {
  if (analyzerVersionOf(analysisScope) !== "v2") return null;
  const scope = { ...(analysisScope as Record<string, unknown>) };
  const previous = scope.stage3OcrPreprocess && typeof scope.stage3OcrPreprocess === "object"
    ? scope.stage3OcrPreprocess as Record<string, unknown>
    : {};
  scope.stage3FullCoverageOcr = true;
  scope.stage3VisualEvidence = true;
  scope.stage3OcrPreprocess = {
    ...previous,
    fullCoverage: true,
    gateMode: "blocking",
    terminal: false,
    requiredSheetCount: Math.max(0, totalSheets),
    macWorkerLastHeartbeat: now,
    updatedAt: now,
  };
  return scope;
}
