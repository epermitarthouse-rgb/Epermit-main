"use strict";

const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const scrapeEvents = require("../lib/scrape-events.js");
const { mirrorSessionProgress } = require("../lib/session-progress.js");
const {
  computeArlingtonDurableProgress,
  phaseUserMessage,
} = require("../lib/arlington-durable-progress.js");
const {
  attachArlingtonWorkerProgressBridge,
  emitWorkerClaimedProgress,
  emitWorkerPhaseCheckpointProgress,
  emitWorkerTerminalProgress,
} = require("../lib/arlington-worker-progress.js");

function isScrapeHeartbeatEvent(eventType) {
  return `${eventType || ""}`.trim() === "heartbeat";
}

function mockSupabase() {
  const jobPatches = [];
  const events = [];
  const api = {
    jobPatches,
    events,
    from(table) {
      const chain = {
        _table: table,
        _filters: {},
        select() {
          return chain;
        },
        eq(col, val) {
          chain._filters[col] = val;
          return chain;
        },
        order() {
          return chain;
        },
        limit() {
          return chain;
        },
        maybeSingle: async () => {
          if (chain._table === "projects") {
            return { data: { portal_data: mockSupabase.portalData || {} }, error: null };
          }
          if (chain._table === "scrape_events") {
            const last = events.length > 0 ? events[events.length - 1] : null;
            return { data: last ? { sequence: last.sequence } : null, error: null };
          }
          return { data: null, error: null };
        },
        update(patch) {
          if (chain._table === "scrape_jobs") jobPatches.push(patch);
          return {
            eq() {
              return {
                neq: () => ({
                  is: () => Promise.resolve({ error: null }),
                }),
              };
            },
          };
        },
        insert(row) {
          return {
            select() {
              return {
                single: async () => {
                  const inserted = {
                    id: `evt-${events.length + 1}`,
                    sequence: events.length + 1,
                    created_at: new Date().toISOString(),
                    ...row,
                  };
                  events.push(inserted);
                  return { data: inserted, error: null };
                },
              };
            },
          };
        },
      };
      return chain;
    },
    rpc(name) {
      if (name === "publish_scrape_event") {
        return Promise.resolve({
          data: null,
          error: { message: "function does not exist" },
        });
      }
      return Promise.resolve({ data: null, error: null });
    },
  };
  return api;
}
mockSupabase.portalData = {};

describe("Arlington durable progress streaming", () => {
  beforeEach(() => {
    mockSupabase.portalData = {
      checkpointVersion: 1,
      tabs: {
        attachments: {
          tables: [
            {
              rows: [
                { downloadStatus: "uploaded", publicUrl: "https://x/a.pdf" },
                { downloadStatus: "pending" },
              ],
            },
          ],
        },
        planReview: {
          tabs: {
            plansAndDocuments: {
              sections: {
                planSetDocuments: {
                  documents: [
                    { downloadStatus: "uploaded", publicUrl: "https://x/p1.pdf" },
                    { downloadStatus: "pending" },
                  ],
                },
              },
            },
            reviewResultsAndMarkups: { documents: [] },
            approvedDocuments: { documents: [] },
          },
        },
      },
      arlingtonSectionStates: { recordInfo: "complete" },
    };
  });

  it("worker session attaches a working progress publisher", async () => {
    const supabase = mockSupabase();
    const session = { progress: 0, total: 0 };
    const job = {
      id: "job-1",
      project_id: "proj-1",
      user_id: "user-1",
      permit_number: "CTBO24-02589-RA1",
      phase: "attachments",
      status: "running",
      requested_scope: { tabs: ["info", "attachments", "plan_review"] },
    };
    attachArlingtonWorkerProgressBridge(supabase, session, job);
    assert.equal(typeof session.publishScrapeProgress, "function");
    assert.equal(typeof session.publishArlingtonPhaseProgress, "function");
    assert.equal(typeof session.setScrapeProgress, "function");
    assert.equal(session._scrapeJobId, "job-1");
  });

  it("mirrorSessionProgress writes message, progress fields, and meaningful event", async () => {
    const supabase = mockSupabase();
    const session = {
      progress: 0,
      total: 0,
      _scrapePermitNumber: "CTBO24-02589-RA1",
    };
    const job = {
      id: "job-1",
      project_id: "proj-1",
      user_id: "user-1",
      permit_number: "CTBO24-02589-RA1",
      phase: "attachments",
      status: "running",
      requested_scope: { tabs: ["attachments"] },
    };
    attachArlingtonWorkerProgressBridge(supabase, session, job);
    mirrorSessionProgress(session, "CTBO24-02589-RA1 → downloading 1 / 2", {
      event_type: "download_progress",
      progress_current: 1,
      progress_total: 2,
      dedupeKey: "file:1",
      forceFeed: true,
    });
    await new Promise((r) => setTimeout(r, 50));
    assert.ok(supabase.jobPatches.length > 0);
    assert.ok(supabase.events.some((e) => e.event_type === "download_progress"));
    const patch = supabase.jobPatches[supabase.jobPatches.length - 1];
    assert.ok(`${patch.current_user_message || ""}`.length > 0);
    assert.ok(Number(patch.progress_total) > 1);
  });

  it("worker claimed emits meaningful event", async () => {
    const supabase = mockSupabase();
    const session = {};
    const job = {
      id: "job-1",
      project_id: "proj-1",
      user_id: "user-1",
      permit_number: "CTBO24-02589-RA1",
      phase: "record_info",
      status: "running",
      requested_scope: { tabs: ["info", "attachments", "plan_review"] },
    };
    attachArlingtonWorkerProgressBridge(supabase, session, job);
    await emitWorkerClaimedProgress(supabase, session, job, "worker-1");
    assert.ok(supabase.events.some((e) => e.event_type === "worker_claimed"));
  });

  it("phase checkpoint emits meaningful event with monotonic progress", async () => {
    const supabase = mockSupabase();
    const session = {};
    const job = {
      id: "job-1",
      project_id: "proj-1",
      user_id: "user-1",
      permit_number: "CTBO24-02589-RA1",
      phase: "attachments",
      status: "running",
      progress_current: 2,
      progress_total: 10,
      requested_scope: { tabs: ["info", "attachments", "plan_review"] },
    };
    attachArlingtonWorkerProgressBridge(supabase, session, job);
    await emitWorkerPhaseCheckpointProgress(supabase, session, job, {
      phase: "attachments",
      nextPhase: "project_information",
      checkpoint_version: 3,
      attachments_state: "partial",
    });
    assert.ok(supabase.events.some((e) => e.event_type === "checkpoint_persisted"));
    const patch = supabase.jobPatches[supabase.jobPatches.length - 1];
    assert.ok(Number(patch.progress_current) >= 2);
    assert.ok(Number(patch.progress_total) >= Number(patch.progress_current));
  });

  it("progress remains monotonic across checkpoints", () => {
    const scope = { tabs: ["info", "attachments", "plan_review"] };
    const job = {
      phase: "attachments",
      status: "running",
      progress_current: 8,
      progress_total: 20,
      project_info_state: "not_started",
      requested_scope: scope,
    };
    const first = computeArlingtonDurableProgress(job, mockSupabase.portalData, scope);
    const second = computeArlingtonDurableProgress(
      {
        ...job,
        progress_current: first.current,
        progress_total: first.total,
        phase: "plan_review",
      },
      mockSupabase.portalData,
      scope,
    );
    assert.ok(second.current >= first.current);
    assert.ok(second.total >= first.total);
  });

  it("completed job ends at 100%", () => {
    const scope = { tabs: ["info"] };
    const progress = computeArlingtonDurableProgress(
      { phase: "complete", status: "completed", requested_scope: scope },
      mockSupabase.portalData,
      scope,
      { terminal: true, status: "completed", phase: "complete" },
    );
    assert.equal(progress.current, progress.total);
    assert.ok(progress.total >= 1);
  });

  it("completed_with_warnings ends at 100%", () => {
    const scope = { tabs: ["info", "attachments"] };
    const progress = computeArlingtonDurableProgress(
      {
        phase: "complete",
        status: "completed_with_warnings",
        requested_scope: scope,
      },
      mockSupabase.portalData,
      scope,
      { terminal: true, status: "completed_with_warnings" },
    );
    assert.equal(progress.current, progress.total);
  });

  it("failed retains partial progress", () => {
    const scope = { tabs: ["attachments"] };
    const progress = computeArlingtonDurableProgress(
      {
        phase: "attachments",
        status: "failed",
        progress_current: 4,
        progress_total: 12,
        requested_scope: scope,
      },
      mockSupabase.portalData,
      scope,
      { status: "failed" },
    );
    assert.equal(progress.current, 4);
    assert.equal(progress.total, 12);
  });

  it("terminal worker progress emits completion event", async () => {
    const supabase = mockSupabase();
    const session = {};
    const job = {
      id: "job-1",
      project_id: "proj-1",
      user_id: "user-1",
      permit_number: "CTBO24-02589-RA1",
      phase: "complete",
      status: "completed_with_warnings",
      requested_scope: { tabs: ["info", "attachments", "plan_review"] },
    };
    attachArlingtonWorkerProgressBridge(supabase, session, job);
    await emitWorkerTerminalProgress(supabase, session, job, {
      status: "completed_with_warnings",
      current_user_message: "Arlington scrape completed with warnings.",
    });
    assert.ok(
      supabase.events.some(
        (e) => e.event_type === "warning" || e.event_type === "scrape_completed",
      ),
    );
    const patch = supabase.jobPatches[supabase.jobPatches.length - 1];
    assert.equal(patch.progress_current, patch.progress_total);
  });

  it("activity feed excludes heartbeats but includes worker events", () => {
    const events = [
      { event_type: "job_queued", user_message: "queued", stage: "queued" },
      { event_type: "heartbeat", user_message: "Still working…", stage: "running" },
      { event_type: "worker_claimed", user_message: "Worker started.", stage: "running" },
    ];
    const meaningful = events.filter((e) => !isScrapeHeartbeatEvent(e.event_type));
    assert.equal(meaningful.length, 2);
    assert.ok(meaningful.some((e) => e.event_type === "worker_claimed"));
  });

  it("durable HTTP bridge skips UI heartbeat timer", () => {
    const src = require("fs").readFileSync(
      require("path").join(__dirname, "../lib/scrape-events.js"),
      "utf8",
    );
    assert.match(src, /skipUiHeartbeat/);
    const routes = require("fs").readFileSync(
      require("path").join(__dirname, "../app/register-execution-routes.js"),
      "utf8",
    );
    assert.match(routes, /skipUiHeartbeat:\s*true/);
    assert.match(routes, /stopHeartbeat\(scrapeJobId\)/);
  });

  it("lease heartbeat remains separate from UI heartbeat in worker executor", () => {
    const src = require("fs").readFileSync(
      require("path").join(__dirname, "../lib/arlington-worker-executor.js"),
      "utf8",
    );
    assert.match(src, /heartbeatLease/);
    assert.match(src, /emitWorkerClaimedProgress/);
  });

  it("phase labels are human readable", () => {
    assert.match(phaseUserMessage("attachments", "start"), /attachment/i);
    assert.match(phaseUserMessage("verify", "start"), /verif/i);
  });
});

describe("Arlington durable progress attachment counts", () => {
  it("attachment progress increments with downloaded rows", () => {
    const portalData = {
      tabs: {
        attachments: {
          tables: [
            {
              rows: [
                { downloadStatus: "uploaded", publicUrl: "https://x/1.pdf" },
                { downloadStatus: "uploaded", publicUrl: "https://x/2.pdf" },
                { downloadStatus: "pending" },
              ],
            },
          ],
        },
      },
    };
    const scope = { tabs: ["attachments"] };
    const progress = computeArlingtonDurableProgress(
      { phase: "attachments", status: "running", requested_scope: scope },
      portalData,
      scope,
    );
    assert.equal(progress.current, 2);
    assert.equal(progress.total, 4);
  });

  it("plan review document progress increments with downloaded docs", () => {
    const portalData = {
      tabs: {
        planReview: {
          tabs: {
            plansAndDocuments: {
              sections: {
                planSetDocuments: {
                  documents: [
                    { downloadStatus: "uploaded", publicUrl: "https://x/a.pdf" },
                    { downloadStatus: "pending" },
                  ],
                },
              },
            },
            reviewResultsAndMarkups: {
              documents: [{ downloadStatus: "uploaded", publicUrl: "https://x/r.pdf" }],
            },
            approvedDocuments: { documents: [] },
          },
        },
      },
    };
    const scope = { tabs: ["plan_review"], planReviewScope: "all" };
    const progress = computeArlingtonDurableProgress(
      { phase: "plan_review", status: "running", requested_scope: scope },
      portalData,
      scope,
    );
    assert.equal(progress.current, 2);
    assert.ok(progress.total >= 3);
  });
});
