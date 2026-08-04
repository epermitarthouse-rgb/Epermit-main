import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveScrapeCurrentMessage } from "./scrapeJobMessage";
import type { ScrapeEvent, ScrapeJob } from "./scrapeJobTypes";

function job(partial: Partial<ScrapeJob>): ScrapeJob {
  return {
    id: "job-1",
    project_id: "proj-1",
    jurisdiction: "Arlington County",
    portal_type: "accela",
    permit_number: "CTBO24-02589-RA1",
    scrape_mode: null,
    status: "running",
    current_stage: "attachments",
    current_user_message: "Downloading attachments from the portal.",
    progress_current: 5,
    progress_total: 20,
    started_at: null,
    updated_at: "2026-06-30T01:00:00.000Z",
    completed_at: null,
    last_heartbeat_at: null,
    last_activity_at: "2026-06-30T01:05:00.000Z",
    error_user_message: null,
    cancelled_at: null,
    ...partial,
  };
}

function event(partial: Partial<ScrapeEvent>): ScrapeEvent {
  return {
    id: "evt-1",
    job_id: "job-1",
    project_id: "proj-1",
    sequence: 1,
    event_type: "job_queued",
    stage: "queued",
    status: "running",
    user_message: "Arlington scrape queued for durable worker.",
    technical_message: null,
    progress_current: 0,
    progress_total: 1,
    created_at: "2026-06-30T01:00:00.000Z",
    ...partial,
  };
}

describe("resolveScrapeCurrentMessage", () => {
  it("prefers newer job-row message over stale queued event", () => {
    const message = resolveScrapeCurrentMessage({
      job: job({
        current_user_message: "Downloading attachments from the portal.",
        last_activity_at: "2026-06-30T01:05:00.000Z",
      }),
      latestMeaningfulEvent: event({
        user_message: "Arlington scrape queued for durable worker.",
        created_at: "2026-06-30T01:00:00.000Z",
      }),
      loading: false,
      isStale: false,
      isTerminal: false,
    });
    assert.equal(message, "Downloading attachments from the portal.");
  });

  it("prefers newer meaningful event when it is fresher than job row", () => {
    const message = resolveScrapeCurrentMessage({
      job: job({
        current_user_message: "Arlington scrape queued for durable worker.",
        last_activity_at: "2026-06-30T01:00:00.000Z",
      }),
      latestMeaningfulEvent: event({
        user_message: "Worker started scraping permit CTBO24-02589-RA1.",
        created_at: "2026-06-30T01:06:00.000Z",
      }),
      loading: false,
      isStale: false,
      isTerminal: false,
    });
    assert.equal(message, "Worker started scraping permit CTBO24-02589-RA1.");
  });

  it("shows stale working copy only while job is stale and non-terminal", () => {
    const message = resolveScrapeCurrentMessage({
      job: job({
        current_user_message: "Opening record information.",
        last_activity_at: "2026-06-30T00:00:00.000Z",
      }),
      latestMeaningfulEvent: null,
      loading: false,
      isStale: true,
      isTerminal: false,
    });
    assert.equal(message, "Still working…");
  });
});
