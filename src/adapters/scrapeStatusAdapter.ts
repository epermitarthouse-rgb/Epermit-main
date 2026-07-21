import type { StatusTone } from "@/components/design/ProductPrimitives";

/** Exact scrape_jobs / ScrapeContext status → tone. Never collapse failed→success. */
export function scrapeStatusTone(status: string | null | undefined): StatusTone {
  const s = (status || "").toLowerCase();
  if (["completed", "success", "succeeded"].includes(s)) return "good";
  if (["queued", "pending", "running", "in_progress", "scraping"].includes(s)) return "info";
  if (["failed", "error", "cancelled", "canceled", "timeout"].includes(s)) return "bad";
  if (["partial", "warning"].includes(s)) return "warn";
  return "default";
}

export function scrapeStatusLabel(status: string | null | undefined): string {
  if (!status) return "No job";
  return status.replace(/_/g, " ");
}
