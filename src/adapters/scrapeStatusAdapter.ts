import type { StatusTone } from "@/components/design/ProductPrimitives";

/** Exact scrape_jobs / ScrapeContext status → tone. Never collapse failed→success. */
export function scrapeStatusTone(status: string | null | undefined): StatusTone {
  const s = (status || "").toLowerCase();
  if (["completed", "success", "succeeded"].includes(s)) return "good";
  if (
    ["queued", "pending", "running", "resuming", "in_progress", "scraping", "loading"].includes(
      s,
    )
  ) {
    return "info";
  }
  if (
    [
      "failed",
      "failed_unrecoverable",
      "error",
      "cancelled",
      "canceled",
      "timeout",
      "unavailable",
    ].includes(s)
  ) {
    return "bad";
  }
  if (
    [
      "partial",
      "partial_external_blocker",
      "warning",
      "completed_with_warnings",
      "rate_limited",
      "waiting_user",
    ].includes(s)
  ) {
    return "warn";
  }
  return "default";
}

export function scrapeStatusLabel(status: string | null | undefined): string {
  if (!status) return "No job";
  return status.replace(/_/g, " ");
}
