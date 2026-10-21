/** Independent rollout control for the temporary Supabase analyzer. */
export function isSupabaseAnalyzerEnabled(): boolean {
  const value = import.meta.env.VITE_SUPABASE_CODE_ANALYZER_ENABLED;
  return typeof value !== "string" || value.toLowerCase() !== "false";
}
