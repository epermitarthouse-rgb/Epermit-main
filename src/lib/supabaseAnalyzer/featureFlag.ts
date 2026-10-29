/** Independent rollout control for the temporary Supabase analyzer. */
export function isSupabaseAnalyzerEnabled(): boolean {
  const value = import.meta.env.VITE_SUPABASE_CODE_ANALYZER_ENABLED;
  return typeof value !== "string" || value.toLowerCase() !== "false";
}

/**
 * Client-visible documentation of Phase 3A cross-sheet retrieval.
 * Server-side gating uses SUPABASE_ANALYZER_CROSS_SHEET_RETRIEVAL on the processor (default off).
 * This Vite flag does not enable retrieval by itself.
 */
export function isSupabaseAnalyzerCrossSheetRetrievalUiEnabled(): boolean {
  const value = import.meta.env.VITE_SUPABASE_ANALYZER_CROSS_SHEET_RETRIEVAL;
  return typeof value === "string" && value.toLowerCase() === "true";
}
