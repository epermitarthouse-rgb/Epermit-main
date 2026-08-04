import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  computeNextSendAt,
  resolveReportsFromEmail,
  zonedWallTimeToUtc,
} from "./scheduledReportNextSend";

describe("zonedWallTimeToUtc", () => {
  it("maps Eastern standard wall time to UTC", () => {
    // 2026-01-12 09:00 America/New_York = 14:00 UTC (EST, UTC-5)
    const utc = zonedWallTimeToUtc(2026, 1, 12, 9, 0, 0, "America/New_York");
    assert.equal(utc.toISOString(), "2026-01-12T14:00:00.000Z");
  });

  it("maps Eastern daylight wall time to UTC", () => {
    // 2026-07-13 09:00 America/New_York = 13:00 UTC (EDT, UTC-4)
    const utc = zonedWallTimeToUtc(2026, 7, 13, 9, 0, 0, "America/New_York");
    assert.equal(utc.toISOString(), "2026-07-13T13:00:00.000Z");
  });
});

describe("computeNextSendAt weekly", () => {
  it("picks later today when target weekday and send_time are still ahead", () => {
    // Monday 2026-03-09 12:00 UTC = 08:00 ET
    const after = new Date("2026-03-09T12:00:00.000Z");
    const next = computeNextSendAt({
      frequency: "weekly",
      dayOfWeek: 1, // Monday
      sendTime: "09:00:00",
      timezone: "America/New_York",
      after,
    });
    assert.equal(next, "2026-03-09T13:00:00.000Z"); // 09:00 EDT
  });

  it("advances to next week when today's send_time already passed", () => {
    // Monday 2026-03-09 15:00 UTC = 11:00 ET (after 09:00)
    const after = new Date("2026-03-09T15:00:00.000Z");
    const next = computeNextSendAt({
      frequency: "weekly",
      dayOfWeek: 1,
      sendTime: "09:00:00",
      timezone: "America/New_York",
      after,
    });
    assert.equal(next, "2026-03-16T13:00:00.000Z");
  });

  it("handles DST spring-forward week (US)", () => {
    // DST starts 2026-03-08 in US. Schedule Monday 09:00 ET.
    // After Friday 2026-03-06 15:00 UTC
    const after = new Date("2026-03-06T15:00:00.000Z");
    const next = computeNextSendAt({
      frequency: "weekly",
      dayOfWeek: 1,
      sendTime: "09:00:00",
      timezone: "America/New_York",
      after,
    });
    // Monday Mar 9 09:00 EDT = 13:00 UTC
    assert.equal(next, "2026-03-09T13:00:00.000Z");
  });

  it("handles DST fall-back week (US)", () => {
    // DST ends 2026-11-01. After Wed 2026-10-28.
    const after = new Date("2026-10-28T15:00:00.000Z");
    const next = computeNextSendAt({
      frequency: "weekly",
      dayOfWeek: 1, // Monday Nov 2
      sendTime: "09:00:00",
      timezone: "America/New_York",
      after,
    });
    // Monday Nov 2 09:00 EST = 14:00 UTC
    assert.equal(next, "2026-11-02T14:00:00.000Z");
  });
});

describe("computeNextSendAt monthly", () => {
  it("uses day_of_month and send_time in timezone", () => {
    const after = new Date("2026-04-05T12:00:00.000Z");
    const next = computeNextSendAt({
      frequency: "monthly",
      dayOfMonth: 15,
      sendTime: "09:30:00",
      timezone: "America/Chicago",
      after,
    });
    // Apr 15 09:30 CDT = 14:30 UTC
    assert.equal(next, "2026-04-15T14:30:00.000Z");
  });

  it("rolls to next month when day already passed", () => {
    const after = new Date("2026-04-20T12:00:00.000Z");
    const next = computeNextSendAt({
      frequency: "monthly",
      dayOfMonth: 15,
      sendTime: "09:00:00",
      timezone: "America/Chicago",
      after,
    });
    // May 15 09:00 CDT = 14:00 UTC
    assert.equal(next, "2026-05-15T14:00:00.000Z");
  });
});

describe("resolveReportsFromEmail", () => {
  it("wraps bare email with display name", () => {
    assert.equal(
      resolveReportsFromEmail("reports@example.com"),
      "Insight|DesignCheck <reports@example.com>",
    );
  });

  it("preserves full From header", () => {
    assert.equal(
      resolveReportsFromEmail("PermitPilot <noreply@example.com>"),
      "PermitPilot <noreply@example.com>",
    );
  });

  it("uses invalid placeholder when unset (forces explicit config)", () => {
    assert.match(resolveReportsFromEmail(""), /reports@localhost\.invalid/);
  });
});
