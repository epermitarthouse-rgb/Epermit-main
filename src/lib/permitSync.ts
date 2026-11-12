/**
 * Refresh state for the Permit Queue (D-096): shapes returned by get_permit_sync_overview /
 * get_permit_sync_progress / get_permit_sync_job_progress, and the labels shown for them. Progress is shown
 * as recorded counts ("12 of 72 files"), never as an estimated percentage.
 */

export type PermitPhase =
  | 'queued' | 'authenticating' | 'reading_info' | 'capturing_reviews' | 'downloading_files' | 'exporting_reports'
  | 'retrying' | 'completed' | 'completed_with_warnings' | 'failed' | 'cancelled' | 'skipped';

export type JobStatus =
  | 'queued' | 'running' | 'retry_wait' | 'waiting_user' | 'completed' | 'completed_with_warnings'
  | 'failed' | 'failed_unrecoverable' | 'cancelled';

export type JobPhase = 'queued' | 'authenticating' | 'discovering' | 'processing' | 'finishing' | 'released' | null;

export interface PermitProgress {
  permit_id: string;
  job_id: string | null;
  job_status: JobStatus | null;
  job_trigger: 'manual' | 'scheduled' | null;
  phase: PermitPhase | null;
  files_total: number | null;
  files_captured: number | null;
  files_pending: number | null;
  files_failed: number | null;
  reports_total: number | null;
  reports_captured: number | null;
  reports_failed: number | null;
  error_code: string | null;
  message: string | null;
  started_at: string | null;
  finished_at: string | null;
  updated_at: string | null;
  next_attempt_at: string | null;
  last_success_at: string | null;
}

export interface SyncJobSummary {
  id: string;
  status: JobStatus;
  phase: JobPhase;
  trigger: 'manual' | 'scheduled';
  attempt_count: number;
  max_attempts: number;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  next_attempt_at: string | null;
  error_code: string | null;
  scope: 'all' | 'permits';
  current_portal_record_id: string | null;
  current_permit_number: string | null;
  permits_total: number;
  permits_done: number;
  permits_with_warnings: number;
  permits_failed: number;
  files_captured: number;
  files_total: number;
  reports_captured: number;
  reports_total: number;
}

export interface SyncJobProgress extends SyncJobSummary {
  permits: Array<{
    portal_record_id: string;
    permit_id: string | null;
    permit_number: string | null;
    phase: PermitPhase;
    files_total: number | null;
    files_captured: number | null;
    files_pending: number | null;
    files_failed: number | null;
    reports_total: number | null;
    reports_captured: number | null;
    reports_failed: number | null;
    error_code: string | null;
    message: string | null;
    started_at: string | null;
    finished_at: string | null;
    updated_at: string | null;
  }>;
}

export interface SyncSchedule {
  frequency: 'daily' | 'weekdays' | 'weekly';
  time: string;
  timezone: string;
  weekday?: number;
}

export interface SyncSourceOverview {
  credential_id: string;
  adapter_key: string;
  jurisdiction: string;
  status: string;
  automation_enabled: boolean;
  can_refresh: boolean;
  permit_count: number;
  schedule: SyncSchedule | null;
  next_run_at: string | null;
  last_scheduled_at: string | null;
  last_success_at: string | null;
  active_job: SyncJobSummary | null;
  queued_job: SyncJobSummary | null;
  last_job: SyncJobSummary | null;
}

export interface RefreshResult {
  job_id: string;
  result: 'created' | 'merged' | 'already_covered' | 'queued_follow_up' | 'skipped_busy';
  status: JobStatus;
  credential_id?: string;
}

export const ACTIVE_PERMIT_PHASES: ReadonlySet<PermitPhase> = new Set([
  'authenticating', 'reading_info', 'capturing_reviews', 'downloading_files', 'exporting_reports',
]);

export const OPEN_PERMIT_PHASES: ReadonlySet<PermitPhase> = new Set([...ACTIVE_PERMIT_PHASES, 'queued', 'retrying']);

export const OPEN_JOB_STATUSES: ReadonlySet<JobStatus> = new Set(['queued', 'running', 'retry_wait', 'waiting_user']);

const PHASE_LABEL: Record<PermitPhase, string> = {
  queued: 'Queued',
  authenticating: 'Signing in',
  reading_info: 'Reading permit info',
  capturing_reviews: 'Capturing reviews',
  downloading_files: 'Downloading files',
  exporting_reports: 'Exporting reports',
  retrying: 'Waiting to retry',
  completed: 'Completed',
  completed_with_warnings: 'Completed with outstanding items',
  failed: 'Failed',
  cancelled: 'Cancelled',
  skipped: 'Not processed',
};

export type ProgressTone = 'good' | 'warn' | 'bad' | 'info' | 'default';

export function phaseLabel(phase: PermitPhase | null | undefined): string {
  return phase ? PHASE_LABEL[phase] ?? phase : 'Not refreshed yet';
}

export function phaseTone(phase: PermitPhase | null | undefined): ProgressTone {
  if (!phase) return 'default';
  if (phase === 'completed') return 'good';
  if (phase === 'completed_with_warnings' || phase === 'retrying') return 'warn';
  if (phase === 'failed') return 'bad';
  if (phase === 'cancelled' || phase === 'skipped') return 'default';
  return 'info';
}

const JOB_PHASE_LABEL: Record<Exclude<JobPhase, null>, string> = {
  queued: 'Queued',
  authenticating: 'Signing in to the portal',
  discovering: 'Reading the portal dashboard',
  processing: 'Refreshing permits',
  finishing: 'Finishing',
  released: 'Paused (worker restart); resumes automatically',
};

const JOB_STATUS_LABEL: Record<JobStatus, string> = {
  queued: 'Queued',
  running: 'Running',
  retry_wait: 'Waiting to retry',
  waiting_user: 'Needs portal sign-in help',
  completed: 'Completed',
  completed_with_warnings: 'Completed with outstanding items',
  failed: 'Failed',
  failed_unrecoverable: 'Failed (needs attention)',
  cancelled: 'Cancelled',
};

/** One line for a job: the running phase while it runs, its status otherwise. */
export function jobStateLabel(job: Pick<SyncJobSummary, 'status' | 'phase'> | null | undefined): string {
  if (!job) return 'Idle';
  if (job.status === 'running' && job.phase) return JOB_PHASE_LABEL[job.phase] ?? JOB_STATUS_LABEL.running;
  if (job.status === 'retry_wait' && job.phase === 'released') return JOB_PHASE_LABEL.released;
  return JOB_STATUS_LABEL[job.status] ?? job.status;
}

export function jobTone(status: JobStatus | null | undefined): ProgressTone {
  if (!status) return 'default';
  if (status === 'completed') return 'good';
  if (status === 'completed_with_warnings' || status === 'retry_wait' || status === 'waiting_user') return 'warn';
  if (status === 'failed' || status === 'failed_unrecoverable') return 'bad';
  if (status === 'cancelled') return 'default';
  return 'info';
}

/** "12 of 72 files"; null when nothing is known. */
export function countLabel(done: number | null | undefined, total: number | null | undefined, noun: string): string | null {
  if (total === null || total === undefined) return done === null || done === undefined ? null : `${done} ${noun}`;
  return `${done ?? 0} of ${total} ${noun}`;
}

/** Counts line for a permit: files and reports captured, then pending / failed items when there are any. */
export function permitCountsLine(p: Pick<PermitProgress, 'files_total' | 'files_captured' | 'files_pending' | 'files_failed' | 'reports_total' | 'reports_captured' | 'reports_failed'> | null | undefined): string | null {
  if (!p) return null;
  const parts = [countLabel(p.files_captured, p.files_total, 'files'), countLabel(p.reports_captured, p.reports_total, 'reports')].filter(Boolean) as string[];
  const open: string[] = [];
  if (p.files_pending) open.push(`${p.files_pending} pending`);
  if ((p.files_failed ?? 0) + (p.reports_failed ?? 0) > 0) open.push(`${(p.files_failed ?? 0) + (p.reports_failed ?? 0)} failed`);
  if (open.length) parts.push(open.join(', '));
  return parts.length ? parts.join(' · ') : null;
}

/** Batch line: permits done of total, and those with outstanding items or that failed. */
export function batchLine(job: SyncJobSummary): string {
  const parts = [`${job.permits_done} of ${job.permits_total} permits`];
  if (job.permits_with_warnings) parts.push(`${job.permits_with_warnings} with outstanding items`);
  if (job.permits_failed) parts.push(`${job.permits_failed} not completed`);
  if (job.files_total) parts.push(`${job.files_captured} of ${job.files_total} files`);
  if (job.reports_total) parts.push(`${job.reports_captured} of ${job.reports_total} reports`);
  return parts.join(' · ');
}

export function refreshResultMessage(r: RefreshResult): { title: string; detail: string } {
  switch (r.result) {
    case 'created':
      return { title: 'Refresh queued', detail: 'The sync worker will pick it up shortly. Progress appears here as it runs.' };
    case 'merged':
      return { title: 'Added to the pending refresh', detail: 'A refresh that has not started yet now includes this request.' };
    case 'already_covered':
      return { title: 'Already refreshing', detail: 'The refresh in progress will reach this permit; nothing new was queued.' };
    case 'queued_follow_up':
      return { title: 'Queued after the current refresh', detail: 'It runs as soon as the refresh in progress finishes.' };
    default:
      return { title: 'Refresh is busy', detail: 'A refresh is already in progress for this source.' };
  }
}

/** The open (queued or running) job of a source, preferring the one running. */
export function sourceOpenJob(s: SyncSourceOverview): SyncJobSummary | null {
  return s.active_job ?? s.queued_job ?? null;
}

export function isPermitBusy(p: PermitProgress | null | undefined): boolean {
  return !!p && !!p.phase && OPEN_PERMIT_PHASES.has(p.phase) && !!p.job_status && OPEN_JOB_STATUSES.has(p.job_status);
}

export function describeSchedule(s: SyncSchedule | null | undefined): string {
  if (!s) return 'No schedule';
  const days = s.frequency === 'daily' ? 'Every day' : s.frequency === 'weekdays' ? 'Weekdays' : `Every ${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][s.weekday ?? 0]}`;
  return `${days} at ${s.time} (${s.timezone})`;
}

/** Wording of the Refresh All confirmation: jurisdiction, the permit count the source sees, and any open refresh it joins. */
export function refreshAllConfirmation(s: SyncSourceOverview): { title: string; body: string[]; joins: string | null; confirm: string } {
  const open = sourceOpenJob(s);
  const n = s.permit_count;
  return {
    title: `Refresh every ${s.jurisdiction} permit?`,
    body: [
      `${n} permit${n === 1 ? "" : "s"} discovered on this portal will be refreshed from the portal: info, reviews, tasks, files not yet stored and reports. Files already stored are not downloaded again.`,
      "One portal session is used at a time; a full refresh can take a long time. You can follow progress here and cancel it.",
    ],
    joins: open ? `A refresh is already ${open.status === "queued" ? "queued" : "in progress"} (${batchLine(open)}). This request joins it.` : null,
    confirm: `Refresh ${n} permit${n === 1 ? "" : "s"}`,
  };
}
