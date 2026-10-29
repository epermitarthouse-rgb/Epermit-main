export {
  ANALYSIS_MODES,
  DC_2017_REGISTRY_SNAPSHOT,
  analysisModeShortLabel,
  displayAnalysisMode,
  formatAnalysisDateLabel,
  isStoredAnalysisMode,
  legacySupabaseAnalyzerPrompt,
  normalizeNewRunAnalysisMode,
  processorReviewPrompt,
  resolveAnalyzerReviewScope,
  type PersistedAnalysisScope,
  type StoredAnalysisMode,
} from "../../../supabase/functions/_shared/analyzerReviewScope.ts";

/** Labels copied from Code Analyzer V2's Dual Code Analysis control. Stored values stay Supabase modes. */
export const analysisModeControlOptions = [
  { value: "both", label: "Both (Recommended)" },
  { value: "ibc_only", label: "IBC Only" },
  { value: "local_only", label: "Local Only" },
] as const;
