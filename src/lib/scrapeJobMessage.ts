import type { ScrapeEvent, ScrapeJob } from "@/lib/scrapeJobTypes";

export interface ResolveScrapeCurrentMessageInput {
  job: ScrapeJob | null;
  latestMeaningfulEvent: ScrapeEvent | null;
  loading: boolean;
  isStale: boolean;
  isTerminal: boolean;
}

export function resolveScrapeCurrentMessage({
  job,
  latestMeaningfulEvent,
  loading,
  isStale,
  isTerminal,
}: ResolveScrapeCurrentMessageInput): string {
  const jobMessage = job?.current_user_message?.trim() || "";
  const jobMessageAt = job?.last_activity_at
    ? Date.parse(job.last_activity_at)
    : job?.updated_at
      ? Date.parse(job.updated_at)
      : 0;

  const eventMessage = latestMeaningfulEvent?.user_message?.trim() || "";
  const eventAt = latestMeaningfulEvent?.created_at
    ? Date.parse(latestMeaningfulEvent.created_at)
    : 0;

  let baseMessage: string;
  if (jobMessage && (!eventMessage || jobMessageAt >= eventAt)) {
    baseMessage = jobMessage;
  } else if (eventMessage) {
    baseMessage = eventMessage;
  } else {
    baseMessage =
      job?.error_user_message?.trim() ||
      (loading ? "Loading scrape progress…" : "Waiting for updates…");
  }

  // Stale activity is shown as a secondary badge in the panel — never replace
  // the canonical backend / event message.
  void isStale;
  void isTerminal;
  return baseMessage;
}
