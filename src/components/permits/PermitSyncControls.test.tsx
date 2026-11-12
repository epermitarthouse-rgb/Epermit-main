import assert from "node:assert/strict";
import { describe, it } from "node:test";
import React, { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PermitSyncCell, PermitSyncPanel, RefreshAllButton, RefreshPermitButton, SyncBatchBanner } from "./PermitSyncControls";
import { WorkerHealthPanel, workerHealth, workerLimitsLabel } from "@/components/admin/PermitSyncOperations";
import type { PermitProgress, SyncJobSummary, SyncSourceOverview } from "@/lib/permitSync";

(globalThis as { React?: typeof React }).React = React;

const render = (el: ReactElement) =>
  renderToStaticMarkup(createElement(QueryClientProvider, { client: new QueryClient() }, createElement(MemoryRouter, null, el)));

const job = (over: Partial<SyncJobSummary> = {}): SyncJobSummary => ({
  id: "j1", status: "running", phase: "processing", trigger: "manual", attempt_count: 1, max_attempts: 5,
  created_at: "2026-11-13T10:00:00Z", started_at: null, completed_at: null, next_attempt_at: null, error_code: null,
  scope: "all", current_portal_record_id: "R1", current_permit_number: "B2500001",
  permits_total: 72, permits_done: 12, permits_with_warnings: 1, permits_failed: 0,
  files_captured: 40, files_total: 90, reports_captured: 0, reports_total: 0, ...over,
});

const source = (over: Partial<SyncSourceOverview> = {}): SyncSourceOverview => ({
  credential_id: "c1", adapter_key: "dc-projectdox", jurisdiction: "Washington DC", status: "active",
  automation_enabled: false, can_refresh: true, permit_count: 72, schedule: null, next_run_at: null,
  last_scheduled_at: null, last_success_at: null, active_job: null, queued_job: null, last_job: null, ...over,
});

const progress = (over: Partial<PermitProgress> = {}): PermitProgress => ({
  permit_id: "p1", job_id: "j1", job_status: "running", job_trigger: "manual", phase: "capturing_reviews",
  files_total: null, files_captured: null, files_pending: null, files_failed: null, reports_total: null,
  reports_captured: null, reports_failed: null, error_code: null, message: null, started_at: null, finished_at: null,
  updated_at: null, next_attempt_at: null, last_success_at: null, ...over,
});

describe("Permit Queue refresh controls", () => {
  it("Refresh all is offered only for sources the caller can refresh that have permits", () => {
    assert.match(render(createElement(RefreshAllButton, { sources: [source()] })), /Refresh all/);
    assert.equal(render(createElement(RefreshAllButton, { sources: [source({ can_refresh: false })] })), "");
    assert.equal(render(createElement(RefreshAllButton, { sources: [source({ permit_count: 0 })] })), "");
  });

  it("the batch banner shows recorded counts, the current permit and Cancel for managers only", () => {
    const html = render(createElement(SyncBatchBanner, { sources: [source({ active_job: job() })] }));
    assert.match(html, /Washington DC/);
    assert.match(html, /Refreshing permits/);
    assert.match(html, /12 of 72 permits · 1 with outstanding items · 40 of 90 files/);
    assert.match(html, /Now: B2500001/);
    assert.match(html, /Cancel refresh/);
    assert.doesNotMatch(html, /%/);
    const viewer = render(createElement(SyncBatchBanner, { sources: [source({ can_refresh: false, active_job: job() })] }));
    assert.doesNotMatch(viewer, /Cancel refresh/);
    assert.equal(render(createElement(SyncBatchBanner, { sources: [source()] })), "");
  });

  it("the batch banner explains a back-off wait", () => {
    const html = render(createElement(SyncBatchBanner, {
      sources: [source({ active_job: job({ status: "retry_wait", phase: "processing", attempt_count: 2, next_attempt_at: "2026-11-13T11:00:00Z" }) })],
    }));
    assert.match(html, /Waiting to retry/);
    assert.match(html, /attempt 2 of 5 used/);
  });

  it("row cell and button reflect the persisted phase", () => {
    assert.match(render(createElement(PermitSyncCell, { progress: null })), /Not refreshed yet/);
    const cell = render(createElement(PermitSyncCell, { progress: progress({ phase: "completed", job_status: "completed", files_total: 3, files_captured: 3, last_success_at: "2026-11-13T10:00:00Z" }) }));
    assert.match(cell, /Completed/);
    assert.match(cell, /3 of 3 files/);
    assert.match(cell, /Last refreshed/);
    const busy = render(createElement(RefreshPermitButton, { permitId: "p1", progress: progress() }));
    assert.match(busy, /Capturing reviews/);
    assert.match(busy, /disabled/);
    const idle = render(createElement(RefreshPermitButton, { permitId: "p1", progress: progress({ phase: "completed", job_status: "completed" }) }));
    assert.match(idle, />Refresh</);
    assert.doesNotMatch(idle, /disabled=""/);
  });

  it("detail panel shows outstanding items and the last successful refresh", () => {
    const html = render(createElement(PermitSyncPanel, {
      progress: progress({ phase: "completed_with_warnings", job_status: "completed_with_warnings", files_total: 10, files_captured: 7, files_pending: 3, message: "3 files left for the next refresh" }),
    }));
    assert.match(html, /Portal refresh: Completed with outstanding items/);
    assert.match(html, /7 of 10 files · 3 pending/);
    assert.match(html, /Last successful refresh: never/);
    assert.match(html, /3 files left for the next refresh/);
  });
});

describe("worker health", () => {
  const now = Date.parse("2026-11-13T12:00:00Z");
  const w = (status: string, ageS: number) => ({
    worker_id: "w1", mode: "deep", status, current_job_id: null, started_at: "2026-11-13T09:00:00Z",
    last_seen_at: new Date(now - ageS * 1000).toISOString(), details: {},
  });
  it("is judged from the heartbeat age", () => {
    assert.equal(workerHealth(w("idle", 20), now).label, "Idle");
    assert.equal(workerHealth(w("busy", 20), now).label, "Working");
    assert.equal(workerHealth(w("busy", 180), now).tone, "warn");
    assert.equal(workerHealth(w("busy", 600), now).label, "Offline");
    assert.equal(workerHealth(w("stopped", 600), now).label, "Stopped");
  });
});

describe("worker panel", () => {
  const worker = (details: Record<string, unknown>) => ({
    worker_id: "w1", mode: "deep", status: "idle", current_job_id: null, started_at: "2026-11-13T09:00:00Z",
    last_seen_at: new Date().toISOString(), details,
  });
  it("shows scope and per-run limits, and warns when the worker is narrowed to specific permits", () => {
    const all = render(createElement(WorkerHealthPanel, { loading: false, status: { cron_available: true, cron_jobs: [], open_alerts: 0, workers: [worker({ scope: "all", limits: { max_files: 5000, max_bytes: 20 * 1024 * 1024 * 1024 }, version: "abc123" })] } }));
    assert.match(all, /All permits/);
    assert.match(all, /5000 files · 20480 MiB per run/);
    assert.doesNotMatch(all, /limited to specific permits/);
    const narrow = render(createElement(WorkerHealthPanel, { loading: false, status: { cron_available: true, cron_jobs: [], open_alerts: 0, workers: [worker({ scope: 2 })] } }));
    assert.match(narrow, /limited to specific permits/);
    assert.match(narrow, /2 permit\(s\) only/);
    assert.equal(workerLimitsLabel(null), "—");
  });
});
