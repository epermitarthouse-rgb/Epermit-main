import assert from "node:assert/strict";
import { describe, it } from "node:test";
import React, { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { OPS_QUERY_KEY } from "@/components/admin/PermitSyncOperations";
import { SYNC_QUERY_KEY } from "@/components/permits/PermitSyncControls";
import type { SchedulerStatus } from "@/lib/centralPermits";
import type { SyncSourceOverview } from "@/lib/permitSync";
import AdminPermitSync, { PERMIT_SYNC_TABS } from "./AdminPermitSync";

(globalThis as { React?: typeof React }).React = React;

const CREDENTIAL = "0610eaa5-1111-1111-1111-111111111111";

const overview: SyncSourceOverview = {
  credential_id: CREDENTIAL,
  adapter_key: "dc-projectdox",
  jurisdiction: "Washington DC",
  status: "active",
  automation_enabled: true,
  can_refresh: true,
  permit_count: 28,
  schedule: { frequency: "daily", time: "04:00", timezone: "America/New_York" },
  next_run_at: "2026-11-18T09:00:00Z",
  last_scheduled_at: null,
  last_success_at: "2026-11-17T09:00:00Z",
  active_job: null,
  queued_job: null,
  last_job: null,
};

const scheduler: SchedulerStatus = {
  cron_available: true,
  cron_jobs: [
    { name: "permit-sync-enqueue", schedule: "0 4 * * *", active: true },
    { name: "permit-sync-monitor", schedule: "*/5 * * * *", active: true },
  ],
  workers: [{
    worker_id: "worker-east-1",
    mode: "deep",
    status: "idle",
    current_job_id: null,
    started_at: "2026-11-17T00:00:00Z",
    last_seen_at: "2026-11-17T12:00:00Z",
    details: { scope: "all", version: "15993f89", rss_mb: 80 },
  }],
  open_alerts: 1,
};

function renderPage(): string {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(["permit-sync", "sources"], [{
    credential_id: CREDENTIAL,
    adapter_key: "dc-projectdox",
    visible_to_all: true,
    status: "paused",
    automation_enabled: true,
    last_login_ok_at: "2026-11-17T02:00:00Z",
    last_error: "login paused",
  }]);
  client.setQueryData(["permit-sync", "jobs"], [{
    id: "job-9f3c2a10-0000-0000-0000-000000000001",
    credential_id: CREDENTIAL,
    trigger: "manual",
    status: "completed",
    attempt_count: 1,
    max_attempts: 5,
    metrics: { permits_ok: 28, permits_failed: 0, changes: 3 },
    created_at: "2026-11-17T03:00:00Z",
    error_code: null,
  }]);
  client.setQueryData(["permit-sync", "grants"], [{
    id: "grant-1",
    scope_type: "adapter",
    adapter_key: "dc-projectdox",
    grantee_user_id: "user-22222222-3333",
    note: "studio reviewer",
    created_at: "2026-11-17T04:00:00Z",
  }]);
  client.setQueryData([...SYNC_QUERY_KEY, "overview"], [overview]);
  client.setQueryData([...OPS_QUERY_KEY, "scheduler"], scheduler);
  client.setQueryData([...OPS_QUERY_KEY, "alerts"], [{
    id: "alert-1",
    severity: "warning",
    title: "Comment pipeline blocked",
    detail: "Two failures",
    occurrences: 2,
    first_seen_at: "2026-11-17T00:00:00Z",
    last_seen_at: "2026-11-17T01:00:00Z",
    resolved_at: null,
    notified_at: null,
  }]);
  const page: ReactElement = createElement(AdminPermitSync);
  return renderToStaticMarkup(
    createElement(QueryClientProvider, { client }, createElement(MemoryRouter, null, page)),
  );
}

function panelTag(html: string, id: string): string {
  const marker = `data-permit-sync-tab="${id}"`;
  const at = html.indexOf(marker);
  assert.ok(at > 0, `missing tab panel ${id}`);
  const start = html.lastIndexOf("<div", at);
  const end = html.indexOf(">", at);
  return html.slice(start, end + 1);
}

function panelBody(html: string, id: string, nextId?: string): string {
  const marker = `data-permit-sync-tab="${id}"`;
  const at = html.indexOf(marker);
  const from = html.indexOf(">", at) + 1;
  const to = nextId ? html.indexOf(`data-permit-sync-tab="${nextId}"`, from) : html.length;
  assert.ok(to > from, id);
  return html.slice(from, to);
}

describe("Permit Sync admin tabs", () => {
  it("renders each section in its own tab, with scheduling selected and the others still mounted", () => {
    const html = renderPage();
    assert.match(html, /<h1[^>]*>Permit Sync<\/h1>/);
    assert.match(html, /aria-label="Permit sync sections"/);

    for (const item of PERMIT_SYNC_TABS) {
      const button = html.match(new RegExp(`<button\\b[^>]*role="tab"[^>]*>${item.label}</button>`));
      assert.ok(button, item.label);
      const selected = item.id === "scheduling";
      assert.match(button[0], new RegExp(`data-state="${selected ? "active" : "inactive"}"`));
      assert.match(button[0], new RegExp(`aria-selected="${selected ? "true" : "false"}"`));
      const tag = panelTag(html, item.id);
      assert.equal(/\shidden(?:=|\s|>)/.test(tag), !selected, `${item.id} hidden attribute`);
    }

    const scheduling = panelBody(html, "scheduling", "sources");
    assert.match(scheduling, /Automatic refreshes/);
    assert.match(scheduling, /Washington DC/);
    assert.match(scheduling, /aria-label="Frequency"/);
    assert.match(scheduling, /aria-label="Time"/);
    assert.match(scheduling, /aria-label="Timezone"/);
    assert.match(scheduling, /value="America\/New_York"/);
    assert.match(scheduling, /Max files/);
    assert.match(scheduling, />Enabled</);
    assert.match(scheduling, />Save \(stays enabled\)</);

    const sources = panelBody(html, "sources", "visibility");
    assert.match(sources, /Portal accounts/);
    assert.match(sources, /dc-projectdox/);
    assert.match(sources, />Resume</);

    const visibility = panelBody(html, "visibility", "jobs");
    assert.match(visibility, /Who sees these permits/);
    assert.match(visibility, /Default access and hidden users/);
    assert.match(visibility, /Visible to all users by default/);
    assert.match(visibility, new RegExp(`data-testid="visible-all-${CREDENTIAL}"`));
    assert.match(visibility, /Every active user, now and in the future/);

    const jobs = panelBody(html, "jobs", "workers");
    assert.match(jobs, /Last 50/);
    assert.match(jobs, /job-9f3c/);
    assert.match(jobs, /Permits ok \/ failed/);
    assert.match(jobs, />Events</);

    const workers = panelBody(html, "workers", "alerts");
    assert.match(workers, /Sync workers/);
    assert.match(workers, /worker-east-1/);

    const alerts = panelBody(html, "alerts", "access");
    assert.match(alerts, /Sync alerts/);
    assert.match(alerts, /Comment pipeline blocked/);

    const access = panelBody(html, "access");
    assert.match(access, /Extra access beyond the default/);
    assert.match(access, /placeholder="Scope reference"/);
    assert.match(access, /studio reviewer/);
    assert.match(access, />Grant</);
    assert.match(access, />Revoke</);
  });
});
