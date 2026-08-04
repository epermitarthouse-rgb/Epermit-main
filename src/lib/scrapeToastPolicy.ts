/**
 * Toast policy when the scrape progress widget is the primary UX.
 * Progress / success / restore toasts are suppressed; start-request failures stay.
 */

export type ScrapeToastCategory =
  | "start_progress"
  | "start_success"
  | "restore"
  | "completion"
  | "cancel_info"
  | "start_error"
  | "action_error"
  | "pipeline"
  | "other";

/** Messages that must not toast when the widget is active / will be active. */
const SUPPRESSED_EXACT = new Set([
  "Chain Step 1/5: Portal Scraping...",
  "Logging into portal...",
  "Reconnecting to portal...",
  "Reconnecting to Arlington Accela...",
  "Using active portal session...",
  "Scraping started — you can continue using the app.",
  "Your scrape is queued — finishing the current worker cycle first.",
  "Your scrape is queued — it will run next.",
  "Scrape already running — attached to existing job.",
  "Restoring scrape progress…",
  "Re-attaching to active scrape session…",
  "Scraping complete. Data saved to your project.",
  "Scrape cancelled",
]);

const SUPPRESSED_PREFIXES = [
  "Retry started for ",
  "Scraping complete",
];

export function classifyScrapeToastMessage(message: string): ScrapeToastCategory {
  const msg = `${message || ""}`.trim();
  if (!msg) return "other";

  if (SUPPRESSED_EXACT.has(msg)) {
    if (msg.startsWith("Restoring") || msg.startsWith("Re-attaching")) return "restore";
    if (msg.startsWith("Scraping complete") || msg === "Scrape cancelled") {
      return msg === "Scrape cancelled" ? "cancel_info" : "completion";
    }
    if (
      msg.includes("queued") ||
      msg.includes("attached") ||
      msg.includes("Scraping started")
    ) {
      return "start_success";
    }
    return "start_progress";
  }

  for (const prefix of SUPPRESSED_PREFIXES) {
    if (msg.startsWith(prefix)) {
      return prefix.startsWith("Retry") ? "start_success" : "completion";
    }
  }

  if (
    msg.includes("Scraper is not running") ||
    msg.includes("must be logged in") ||
    msg.includes("login failed") ||
    msg.includes("Failed to start scrape") ||
    msg.includes("SCRAPER_OFFLINE") ||
    msg.includes("No project found") ||
    msg.includes("Permit / Application") ||
    msg.includes("portal credential") ||
    msg.includes("already in progress") ||
    msg.includes("already running for this project")
  ) {
    return "start_error";
  }

  if (
    msg.includes("Failed to cancel") ||
    msg.includes("Could not reach scraper") ||
    msg.includes("No active scrape to cancel")
  ) {
    return "action_error";
  }

  if (
    msg.includes("post-scrape pipeline") ||
    msg.includes("View scraped data") ||
    msg.includes("Portal data updated")
  ) {
    return "pipeline";
  }

  return "other";
}

/**
 * When the floating widget owns scrape UX, suppress progress/success/restore/completion.
 * Keep start-request errors and cancel/action failures.
 */
export function shouldShowScrapeToast(
  message: string,
  opts?: { widgetActive?: boolean },
): boolean {
  const category = classifyScrapeToastMessage(message);
  const widgetActive = opts?.widgetActive !== false;

  if (!widgetActive) return true;

  switch (category) {
    case "start_progress":
    case "start_success":
    case "restore":
    case "completion":
    case "cancel_info":
      return false;
    case "start_error":
    case "action_error":
    case "pipeline":
    case "other":
      return true;
    default:
      return true;
  }
}
