import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  batchLine,
  describeSchedule,
  isPermitBusy,
  jobStateLabel,
  permitCountsLine,
  phaseLabel,
  phaseTone,
  refreshAllConfirmation,
  refreshResultMessage,
  sourceOpenJob,
  type PermitProgress,
  type SyncJobSummary,
  type SyncSourceOverview,
} from './permitSync';

const job = (over: Partial<SyncJobSummary> = {}): SyncJobSummary => ({
  id: 'j1', status: 'running', phase: 'processing', trigger: 'manual', attempt_count: 1, max_attempts: 5,
  created_at: '2026-11-13T10:00:00Z', started_at: null, completed_at: null, next_attempt_at: null, error_code: null,
  scope: 'all', current_portal_record_id: null, current_permit_number: null,
  permits_total: 72, permits_done: 12, permits_with_warnings: 0, permits_failed: 0,
  files_captured: 0, files_total: 0, reports_captured: 0, reports_total: 0, ...over,
});

const source = (over: Partial<SyncSourceOverview> = {}): SyncSourceOverview => ({
  credential_id: 'c1', adapter_key: 'dc-projectdox', jurisdiction: 'Washington DC', status: 'active',
  automation_enabled: false, can_refresh: true, permit_count: 72, schedule: null, next_run_at: null,
  last_scheduled_at: null, last_success_at: null, active_job: null, queued_job: null, last_job: null, ...over,
});

const progress = (over: Partial<PermitProgress> = {}): PermitProgress => ({
  permit_id: 'p1', job_id: 'j1', job_status: 'running', job_trigger: 'manual', phase: 'downloading_files',
  files_total: 72, files_captured: 12, files_pending: 60, files_failed: 0, reports_total: null, reports_captured: null,
  reports_failed: null, error_code: null, message: null, started_at: null, finished_at: null, updated_at: null,
  next_attempt_at: null, last_success_at: null, ...over,
});

describe('permitSync labels', () => {
  it('labels every phase in plain words and never shows a percentage', () => {
    assert.equal(phaseLabel('completed_with_warnings'), 'Completed with outstanding items');
    assert.equal(phaseLabel(null), 'Not refreshed yet');
    assert.equal(phaseTone('failed'), 'bad');
    assert.equal(phaseTone('downloading_files'), 'info');
    const line = permitCountsLine(progress()) ?? '';
    assert.equal(line, '12 of 72 files · 60 pending');
    assert.doesNotMatch(line, /%/);
    assert.doesNotMatch(batchLine(job({ files_total: 100, files_captured: 40 })), /%/);
  });

  it('counts reports and failures, and returns null when nothing is recorded', () => {
    assert.equal(permitCountsLine(progress({ files_pending: 0, files_failed: 1, reports_total: 3, reports_captured: 2, reports_failed: 1 })),
      '12 of 72 files · 2 of 3 reports · 2 failed');
    assert.equal(permitCountsLine(progress({ files_total: null, files_captured: null, files_pending: null })), null);
  });

  it('batch line reports permits done, outstanding and not completed', () => {
    assert.equal(batchLine(job({ permits_with_warnings: 2, permits_failed: 1, files_total: 9, files_captured: 4 })),
      '12 of 72 permits · 2 with outstanding items · 1 not completed · 4 of 9 files');
  });

  it('job state follows the running phase and explains a released job', () => {
    assert.equal(jobStateLabel(job({ phase: 'discovering' })), 'Reading the portal dashboard');
    assert.equal(jobStateLabel(job({ status: 'retry_wait', phase: 'released' })), 'Paused (worker restart); resumes automatically');
    assert.equal(jobStateLabel(job({ status: 'completed_with_warnings', phase: 'finishing' })), 'Completed with outstanding items');
    assert.equal(jobStateLabel(null), 'Idle');
  });

  it('a permit is busy only while its phase and its job are open', () => {
    assert.equal(isPermitBusy(progress()), true);
    assert.equal(isPermitBusy(progress({ phase: 'completed' })), false);
    assert.equal(isPermitBusy(progress({ job_status: 'cancelled' })), false);
    assert.equal(isPermitBusy(null), false);
  });

  it('explains every request result', () => {
    for (const result of ['created', 'merged', 'already_covered', 'queued_follow_up', 'skipped_busy'] as const) {
      assert.ok(refreshResultMessage({ job_id: 'j', result, status: 'queued' }).title);
    }
    assert.equal(refreshResultMessage({ job_id: 'j', result: 'already_covered', status: 'running' }).title, 'Already refreshing');
  });

  it('describes schedules with an explicit timezone', () => {
    assert.equal(describeSchedule({ frequency: 'weekly', weekday: 1, time: '02:00', timezone: 'America/New_York' }), 'Every Monday at 02:00 (America/New_York)');
    assert.equal(describeSchedule(null), 'No schedule');
  });
});

describe('Refresh All confirmation', () => {
  it('names the jurisdiction and the discovered permit count', () => {
    const c = refreshAllConfirmation(source());
    assert.equal(c.title, 'Refresh every Washington DC permit?');
    assert.match(c.body[0], /^72 permits discovered on this portal/);
    assert.equal(c.confirm, 'Refresh 72 permits');
    assert.equal(c.joins, null);
    assert.equal(refreshAllConfirmation(source({ permit_count: 1 })).confirm, 'Refresh 1 permit');
  });

  it('says the request joins an open refresh, preferring the running one', () => {
    const s = source({ active_job: job(), queued_job: job({ id: 'j2', status: 'queued', phase: 'queued' }) });
    assert.equal(sourceOpenJob(s)?.id, 'j1');
    assert.equal(refreshAllConfirmation(s).joins, 'A refresh is already in progress (12 of 72 permits). This request joins it.');
    assert.match(refreshAllConfirmation(source({ queued_job: job({ status: 'queued' }) })).joins ?? '', /already queued/);
  });
});
