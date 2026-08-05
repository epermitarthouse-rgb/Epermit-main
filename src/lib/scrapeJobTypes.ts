export const SCRAPE_JOB_TERMINAL_STATUSES = [
  "completed",
  "completed_with_warnings",
  "partial_external_blocker",
  "failed",
  "failed_unrecoverable",
  "cancelled",
] as const;

export type ScrapeJobStatus =
  | "queued"
  | "running"
  | "resuming"
  | "partial"
  | "rate_limited"
  | "waiting_user"
  | "cancelling"
  | "completed"
  | "completed_with_warnings"
  | "partial_external_blocker"
  | "failed"
  | "failed_unrecoverable"
  | "cancelled";

export interface ScrapeJob {
  id: string;
  project_id: string;
  user_id?: string | null;
  tenant_id?: string | null;
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
    case "resuming":
    case "partial":
      return "Running";
    case "rate_limited":
      return "Waiting to retry";
    case "waiting_user":
      return "Waiting for User";
    case "cancelling":
      return "Cancelling";
    case "completed":
      return "Completed";
    case "completed_with_warnings":
      return "Completed with Warnings";
    case "partial_external_blocker":
      return "Stopped (External Blocker)";
    case "failed":
    case "failed_unrecoverable":
      return "Failed";
    case "cancelled":
      return "Cancelled";
    case "loading":
      return "Loading";
    case "unavailable":
      return "Unavailable";
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
    case "partial_external_blocker":
      return "bg-orange-500/15 text-orange-200 border-orange-500/35";
    case "failed":
    case "failed_unrecoverable":
      return "bg-red-500/15 text-red-200 border-red-500/35";
    case "cancelled":
    case "cancelling":
      return "bg-slate-500/15 text-slate-200 border-slate-500/35";
    case "loading":
    case "unavailable":
      return "bg-slate-500/15 text-slate-200 border-slate-500/35";
    case "waiting_user":
      return "bg-sky-500/15 text-sky-200 border-sky-500/35";
    case "queued":
      return "bg-violet-500/15 text-violet-200 border-violet-500/35";
    default:
      return "bg-teal/15 text-teal border-teal/35";
  }
}

/** Map durable scrape_jobs.status to agent workflow portal step label. */
export function durableScrapePortalLabel(
  status: string | null | undefined,
  liveMessage?: string | null,
): string {
  switch (status) {
    case "queued":
      return liveMessage?.trim() || "Queued";
    case "running":
    case "resuming":
    case "partial":
      return liveMessage?.trim() || "Running";
    case "rate_limited":
      return "Waiting to retry";
    case "cancelling":
      return "Cancelling";
    case "cancelled":
      return "Cancelled";
    case "completed":
      return "Completed";
    case "completed_with_warnings":
    case "partial_external_blocker":
      return "Completed with warnings";
    case "failed":
    case "failed_unrecoverable":
      return "Failed";
    default:
      return liveMessage?.trim() || "Idle";
  }
}

/** Map durable scrape_jobs.status to agent workflow step state. */
export function durableScrapePortalStepStatus(
  status: string | null | undefined,
  isActiveJob: boolean,
): "idle" | "checking" | "done" {
  if (!status || !isActiveJob) return "idle";
  if (status === "cancelled") return "idle";
  if (
    status === "completed" ||
    status === "completed_with_warnings" ||
    status === "partial_external_blocker"
  ) {
    return "done";
  }
  if (
    status === "queued" ||
    status === "running" ||
    status === "resuming" ||
    status === "partial" ||
    status === "rate_limited" ||
    status === "waiting_user" ||
    status === "cancelling"
  ) {
    return "checking";
  }
  return "idle";
}

/** Map durable job status to legacy scrape outcome for intake chain. */
export function scrapeOutcomeFromJobStatus(
  status: string | null | undefined,
): "done" | "cancelled" | "error" | null {
  if (
    status === "completed" ||
    status === "completed_with_warnings" ||
    status === "partial_external_blocker"
  ) {
    return "done";
  }
  if (status === "cancelled") return "cancelled";
  if (status === "failed" || status === "failed_unrecoverable") return "error";
  return null;
}
