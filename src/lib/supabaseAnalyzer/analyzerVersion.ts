export {
  ANALYZER_V2_MODEL_REVISION,
  ANALYZER_V2_OCR_GRID,
  analyzerVersionOf,
  parseAnalyzerVersion,
  type AnalyzerVersion,
} from "../../../supabase/functions/_shared/analyzerVersion.ts";
import { analyzerVersionOf, type AnalyzerVersion } from "../../../supabase/functions/_shared/analyzerVersion.ts";

/**
 * Every new run and rerun from the UI uses V2 (4×3 OCR); there is no version picker.
 * Existing runs keep the version stored on their `analysis_scope`.
 */
export const DEFAULT_ANALYZER_VERSION: AnalyzerVersion = "v2";

export const analyzerVersionOptions = [
  {
    value: "v1",
    label: "V1 — Current Analyzer",
    description: "Production analyzer. Reviews each PDF sheet directly.",
  },
  {
    value: "v2",
    label: "V2 — Enhanced Analyzer (4×3 OCR)",
    description: "Adds annotation-level evidence from 4×3 OCR of every sheet. Analysis starts once OCR is ready.",
  },
] as const satisfies ReadonlyArray<{ value: AnalyzerVersion; label: string; description: string }>;

export function isAnalyzerVersion(value: unknown): value is AnalyzerVersion {
  return value === "v1" || value === "v2";
}

/** Short label for a run, from its persisted scope (runs created before the toggle are V1). */
export function analyzerVersionShortLabel(analysisScope: unknown): string {
  return analyzerVersionOf(analysisScope) === "v2" ? "V2 (4×3 OCR)" : "V1";
}
