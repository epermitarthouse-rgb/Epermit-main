import assert from "node:assert/strict";
import { describe, it } from "node:test";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SchedulePanel, scheduleSaveLabel, scheduleSavePayload, scheduleSaveToast } from "./PermitSyncOperations";
import type { SyncSourceOverview } from "@/lib/permitSync";

(globalThis as { React?: typeof React }).React = React;

const source = (over: Partial<SyncSourceOverview> = {}): SyncSourceOverview => ({
  credential_id: "de8592f9-0000-4000-8000-000000000001",
  adapter_key: "dc-projectdox",
  jurisdiction: "Washington DC",
  status: "inactive",
  automation_enabled: false,
  can_refresh: true,
  permit_count: 28,
  schedule: { frequency: "daily", time: "04:00", timezone: "America/New_York" },
  next_run_at: null,
  last_scheduled_at: null,
  last_success_at: "2026-11-13T16:11:00Z",
  active_job: null,
  queued_job: null,
  last_job: null,
  ...over,
});

const render = (s: SyncSourceOverview) =>
  renderToStaticMarkup(createElement(QueryClientProvider, { client: new QueryClient() }, createElement(SchedulePanel, { sources: [s] })));

describe("schedule save", () => {
  it("sends the switch as p_enabled with the form's schedule (the body admin_set_permit_sync_schedule receives)", () => {
    const form = { enabled: true, schedule: { frequency: "daily" as const, time: "04:00", timezone: "America/New_York", weekday: 3 }, maxFiles: "", maxMiB: "", maxAttempts: "5" };
    assert.deepEqual(scheduleSavePayload("cred-1", form), {
      credentialId: "cred-1", enabled: true, schedule: { frequency: "daily", time: "04:00", timezone: "America/New_York" }, deepDefaults: null, maxAttempts: 5,
    });
    assert.equal(scheduleSavePayload("cred-1", { ...form, enabled: false }).enabled, false);
    assert.deepEqual(scheduleSavePayload("cred-1", { ...form, maxFiles: "10", maxMiB: "2" }).deepDefaults, { max_files: 10, max_bytes: 2 * 1024 * 1024 });
  });

  it("labels Save with what it does to the stored state", () => {
    assert.equal(scheduleSaveLabel(true, false), "Save and enable");
    assert.equal(scheduleSaveLabel(false, false), "Save (stays disabled)");
    assert.equal(scheduleSaveLabel(true, true), "Save (stays enabled)");
    assert.equal(scheduleSaveLabel(false, true), "Save and disable");
  });

  it("a disabled schedule shows the warning and 'Save (stays disabled)'; an enabled one neither", () => {
    const off = render(source());
    assert.match(off, /Save \(stays disabled\)/);
    assert.match(off, /This schedule is disabled/);
    assert.match(off, /Saving keeps it disabled and nothing runs/);
    const on = render(source({ automation_enabled: true, status: "active", next_run_at: "2026-11-18T09:00:00Z" }));
    assert.match(on, /Save \(stays enabled\)/);
    assert.doesNotMatch(on, /This schedule is disabled|Saving will turn this schedule off/);
  });

  it("the toast follows the stored result, not the switch", () => {
    const next = "2026-11-18T09:00:00Z";
    const ok = scheduleSaveToast(true, { automation_enabled: true, status: "active", next_run_at: next, schedule_enabled_at: "2026-11-18T06:19:31Z" }, true);
    assert.equal(ok.title, "Schedule saved and enabled");
    assert.equal(ok.variant, undefined);
    assert.match(ok.description, /^Stored: enabled \(active\)\. Next run /);

    const off = scheduleSaveToast(false, { automation_enabled: false, next_run_at: null }, true);
    assert.equal(off.title, "Schedule saved (disabled)");
    assert.doesNotMatch(off.description, /Next run/);

    const lied = scheduleSaveToast(true, { automation_enabled: false, next_run_at: null }, true);
    assert.equal(lied.variant, "destructive");
    assert.equal(lied.title, "Saved, but the schedule is not enabled");
    assert.doesNotMatch(lied.title, /saved and enabled/);

    assert.match(scheduleSaveToast(true, { automation_enabled: true, next_run_at: next }, false).description, /once the scheduler is installed\.$/, "pre-read-back result (no status) still works");
  });
});
