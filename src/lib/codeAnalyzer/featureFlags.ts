/**
 * Code Analyzer Async V2 feature gate.
 * New analysis runs only when this build-time flag is on. There is no V1 fallback.
 */
export const CODE_ANALYZER_V2_REQUIRED_MESSAGE =
  "Code Analyzer V2 is not active in this build. Set VITE_CODE_ANALYZER_ASYNC_V2=true and redeploy the frontend. New analysis does not run on the legacy browser path.";

export function isCodeAnalyzerAsyncV2Enabled(): boolean {
  // Direct member access is required so Vite inlines the production value.
  // Node tests have no import.meta.env; that is the disabled build, not a V1 path.
  let viteFlag: unknown;
  try {
    viteFlag = import.meta.env.VITE_CODE_ANALYZER_ASYNC_V2;
  } catch {
    viteFlag = undefined;
  }
  if (typeof viteFlag === "string") {
    return viteFlag.toLowerCase() === "true" || viteFlag === "1";
  }
  return false;
}

/** New Code Analyzer attempts are V2 only. A disabled flag throws instead of selecting V1. */
export function assertNewAnalysisUsesV2(): "v2" {
  if (!isCodeAnalyzerAsyncV2Enabled()) {
    throw new Error(CODE_ANALYZER_V2_REQUIRED_MESSAGE);
  }
  return "v2";
}
