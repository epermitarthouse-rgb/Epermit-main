/**
 * Async V2 run terminal-state helpers (standard General IBC + shared guards).
 */

export function isTerminalStandardRunStatus(status: string): boolean {
  return (
    status === "current" ||
    status === "partial" ||
    status === "failed" ||
    status === "cancelled"
  );
}

/** Terminal states where persisted findings should be loaded into the UI. */
export function shouldHydrateStandardAsyncResults(status: string): boolean {
  return status === "current" || status === "partial";
}

/** One-shot key so polling does not duplicate hydration or toasts. */
export function asyncRunTerminalKey(runId: string, status: string): string {
  return `${runId}:${status}`;
}
