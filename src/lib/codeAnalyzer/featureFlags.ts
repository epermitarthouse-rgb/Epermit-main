/**
 * Code Analyzer Async V2 feature gate.
 * V1 behavior remains default until explicitly enabled.
 */
export function isCodeAnalyzerAsyncV2Enabled(): boolean {
  const viteFlag = import.meta.env.VITE_CODE_ANALYZER_ASYNC_V2;
  if (typeof viteFlag === "string") {
    return viteFlag.toLowerCase() === "true" || viteFlag === "1";
  }
  return false;
}
