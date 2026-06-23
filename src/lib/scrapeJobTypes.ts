export const SCRAPE_JOB_TERMINAL_STATUSES = [
  "completed",
  "completed_with_warnings",
  "failed",
  "cancelled",
] as const;

export type ScrapeJobStatus =
  | "queued"
  | "running"
  | "waiting_user"
  | "completed"
  | "completed_with_warnings"
  | "failed"
  | "cancelled";

export interface ScrapeJob {
  id: string;
  project_id: string;
  jurisdiction: string;
  portal_type: string | null;
  permit_number: string | null;
  scrape_mode: string | null;
  status: ScrapeJobStatus;
  current_stage: string | null;
  current_user_message: string | null;
  progress_current: number | null;
  progress_total: number | null;
  started_at: string | null;
  updated_at: string;
  completed_at: string | null;
  last_heartbeat_at: string | null;
  last_activity_at: string | null;
  error_user_message: string | null;
  cancelled_at: string | null;
}

export interface ScrapeEvent {
  id: string;
  job_id: string;
  project_id: string;
  sequence: number;
  event_type: string;
  stage: string | null;
  status: string | null;
  user_message: string;
  technical_message: string | null;
  progress_current: number | null;
  progress_total: number | null;
  created_at: string;
  metadata?: Record<string, unknown>;
}

export function isScrapeJobTerminal(status: string | null | undefined): boolean {
  return SCRAPE_JOB_TERMINAL_STATUSES.includes(
    status as (typeof SCRAPE_JOB_TERMINAL_STATUSES)[number],
  );
}

export function isScrapeHeartbeatEvent(
  eventType: string | null | undefined,
): boolean {
  return `${eventType || ""}`.trim() === "heartbeat";
}

export function scrapeJobStatusLabel(status: ScrapeJobStatus | string): string {
  switch (status) {
    case "queued":
      return "Queued";
    case "running":
      return "Running";
    case "waiting_user":
      return "Waiting for User";
    case "completed":
      return "Completed";
    case "completed_with_warnings":
      return "Completed with Warnings";
    case "failed":
      return "Failed";
    case "cancelled":
      return "Cancelled";
    default:
      return status;
  }
}

export function scrapeJobStatusBadgeClass(status: string): string {
  switch (status) {
    case "completed":
      return "bg-emerald-500/15 text-emerald-300 border-emerald-500/35";
    case "completed_with_warnings":
      return "bg-amber-500/15 text-amber-200 border-amber-500/35";
    case "failed":
      return "bg-red-500/15 text-red-200 border-red-500/35";
    case "cancelled":
      return "bg-slate-500/15 text-slate-200 border-slate-500/35";
    case "waiting_user":
      return "bg-sky-500/15 text-sky-200 border-sky-500/35";
    case "queued":
      return "bg-violet-500/15 text-violet-200 border-violet-500/35";
    default:
      return "bg-teal/15 text-teal border-teal/35";
  }
}

/** Map durable job status to legacy scrape outcome for intake chain. */
export function scrapeOutcomeFromJobStatus(
  status: string | null | undefined,
): "done" | "cancelled" | "error" | null {
  if (status === "completed" || status === "completed_with_warnings") return "done";
  if (status === "cancelled") return "cancelled";
  if (status === "failed") return "error";
  return null;
}
