import {
  isScrapeJobTerminal,
  scrapeOutcomeFromJobStatus,
  type ScrapeJobStatus,
} from "@/lib/scrapeJobTypes";

export type TerminalFlashKind =
  | "success"
  | "failed"
  | "cancelled"
  | "blocker"
  | null;

/** Success flash: brief (3–5s). */
export const TERMINAL_AUTO_CLOSE_SUCCESS_MS = 4000;

/** Failed / cancelled / blocker: longer (8–12s) with manual dismiss. */
export const TERMINAL_AUTO_CLOSE_FAILURE_MS = 10000;

export function terminalFlashKindFromStatus(
  status: string | null | undefined,
): TerminalFlashKind {
  if (!isScrapeJobTerminal(status)) return null;
  if (status === "partial_external_blocker") return "blocker";
  if (status === "cancelled") return "cancelled";
  const outcome = scrapeOutcomeFromJobStatus(status);
  if (outcome === "done") return "success";
  if (outcome === "error") return "failed";
  return "failed";
}

export function terminalAutoCloseDelayMs(
  status: string | null | undefined,
): number {
  const kind = terminalFlashKindFromStatus(status);
  if (kind === "success") return TERMINAL_AUTO_CLOSE_SUCCESS_MS;
  if (kind === "failed" || kind === "cancelled" || kind === "blocker") {
    return TERMINAL_AUTO_CLOSE_FAILURE_MS;
  }
  return TERMINAL_AUTO_CLOSE_SUCCESS_MS;
}

/** Display status for the widget when job row is missing. */
export function resolvePanelDisplayStatus(
  jobStatus: ScrapeJobStatus | string | null | undefined,
  opts: { loading: boolean; error?: string | null },
): string {
  if (jobStatus) return `${jobStatus}`;
  if (opts.loading) return "loading";
  if (opts.error) return "unavailable";
  return "loading";
}

export function panelStatusLabel(status: string): string {
  switch (status) {
    case "loading":
      return "Loading";
    case "unavailable":
      return "Unavailable";
    default:
      return status;
  }
}
