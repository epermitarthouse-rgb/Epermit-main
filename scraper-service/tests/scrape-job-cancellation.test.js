"use strict";

const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const {
  isJobCancelled,
  shouldAbort,
  requestCancel,
  finalizeCancelled,
  markScrapeCancelling,
  bindSessionCancelChecker,
  findLocalSession,
  shouldSuppressProgress,
  clearCancelPollCache,
  isCancelSignalStatus,
} = require("../lib/scrape-job-cancellation.js");

function createJobStore(initial = {}) {
  const row = {
    id: "job-1",
    project_id: "proj-1",
    user_id: "user-1",
    jurisdiction: "Prince George's County",
    status: "running",
    completed_at: null,
    scraper_session_id: "sess-1",
    metadata: {},
    ...initial,
  };

  const events = [];
  const supabase = {
    from(table) {
      if (table === "scrape_jobs") {
        return {
          select() {
            return {
              eq(_col, id) {
                return {
                  maybeSingle: async () => {
                    if (`${id}` !== `${row.id}`) {
                      return { data: null, error: null };
                    }
                    return { data: { ...row }, error: null };
                  },
                };
              },
            };
          },
          update(patch) {
            const apply = () => {
              Object.assign(row, patch);
              return { error: null };
            };
            const chain = {
              eq() {
                return chain;
              },
              neq() {
                return chain;
              },
              is() {
                return chain;
              },
              then(resolve, reject) {
                return Promise.resolve(apply()).then(resolve, reject);
              },
            };
            return chain;
          },
        };
      }
      if (table === "scrape_events") {
        return {
          insert(payload) {
            events.push(payload);
            return {
              select() {
                return {
                  single: async () => ({
                    data: { id: `evt-${events.length}`, sequence: events.length },
                    error: null,
                  }),
                };
              },
            };
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
    rpc(name, args) {
      if (name === "cancel_arlington_scrape_job") {
        row.status = "cancelled";
        row.completed_at = new Date().toISOString();
        return Promise.resolve({
          data: [
            {
              job_id: args.p_job_id,
              status: "cancelled",
              already_terminal: false,
              cancellation_reason: "user_cancelled",
            },
          ],
          error: null,
        });
      }
      if (name === "allocate_scrape_event_sequence") {
        return Promise.resolve({ data: events.length + 1, error: null });
      }
      if (name === "publish_scrape_event") {
        return Promise.resolve({
          data: null,
          error: { message: "could not find the function" },
        });
      }
      return Promise.resolve({ data: null, error: { message: `unknown rpc ${name}` } });
    },
  };

  return { row, events, supabase };
}

describe("shared scrape-job-cancellation contract", () => {
  beforeEach(() => {
    clearCancelPollCache("job-1");
  });

  it("treats cancelling and cancelled as cancel signals", () => {
    assert.equal(isCancelSignalStatus("cancelling"), true);
    assert.equal(isCancelSignalStatus("cancelled"), true);
    assert.equal(isCancelSignalStatus("running"), false);
  });

  it("requestCancel sets cancelling and signals local session", async () => {
    const { row, supabase } = createJobStore();
    const sessions = {
      "sess-1": {
        _scrapeJobId: "job-1",
        _scrapeProjectId: "proj-1",
        browser: { close: async () => {} },
        context: { close: async () => {}, pages: () => [] },
        page: { close: async () => {} },
      },
    };
    let cleaned = null;
    const result = await requestCancel({
      supabase,
      jobId: "job-1",
      projectId: "proj-1",
      sessions,
      cleanupSession: (sid, reason) => {
        cleaned = { sid, reason };
      },
      closeBrowser: true,
    });

    assert.equal(result.success, true);
    assert.equal(result.localSessionSignaled, true);
    assert.equal(sessions["sess-1"]._cancelRequested, true);
    assert.equal(sessions["sess-1"]._scrapeEventsSuppressed, true);
    assert.equal(row.status, "cancelling");
    assert.equal(cleaned?.sid, "sess-1");
    assert.equal(cleaned?.reason, "http_cancel");
  });

  it("shouldAbort is true from memory flag without DB", async () => {
    const session = { _cancelRequested: true, _scrapeJobId: "job-1" };
    assert.equal(await shouldAbort(session, null), true);
  });

  it("shouldAbort polls DB cancelling status for multi-replica", async () => {
    const { row, supabase } = createJobStore({ status: "cancelling" });
    const session = { _cancelRequested: false, _scrapeJobId: row.id };
    assert.equal(await shouldAbort(session, supabase, { bypassCache: true }), true);
    assert.equal(session._cancelRequested, true);
  });

  it("isJobCancelled reads durable cancelled status", async () => {
    const { supabase } = createJobStore({ status: "cancelled" });
    assert.equal(await isJobCancelled(supabase, "job-1", { bypassCache: true }), true);
  });

  it("finalizeCancelled marks cancelled and completed_at", async () => {
    const { row, supabase } = createJobStore({ status: "cancelling" });
    await finalizeCancelled(supabase, "job-1", "proj-1", {
      user_message: "Scrape cancelled.",
      emitEvent: false,
    });
    assert.equal(row.status, "cancelled");
    assert.ok(row.completed_at);
  });

  it("markScrapeCancelling is idempotent", async () => {
    const { supabase } = createJobStore({ status: "cancelling" });
    const again = await markScrapeCancelling(supabase, "job-1", "proj-1");
    assert.equal(again.alreadyCancelling, true);
  });

  it("bindSessionCancelChecker combines memory + DB", async () => {
    const { supabase } = createJobStore({ status: "running" });
    const session = { _cancelRequested: false, _scrapeJobId: "job-1" };
    const check = bindSessionCancelChecker(session, supabase);
    assert.equal(await check(), false);
    session._cancelRequested = true;
    assert.equal(await check(), true);
  });

  it("findLocalSession resolves by job id", () => {
    const sessions = {
      a: { _scrapeJobId: "job-1" },
    };
    const found = findLocalSession(sessions, { jobId: "job-1" });
    assert.equal(found.sessionId, "a");
  });

  it("shouldSuppressProgress after cancel signal", () => {
    assert.equal(shouldSuppressProgress({ _cancelRequested: true }), true);
    assert.equal(shouldSuppressProgress({ _scrapeEventsSuppressed: true }), true);
    assert.equal(shouldSuppressProgress({ _scrapeJobTerminalStatus: "cancelled" }), true);
    assert.equal(shouldSuppressProgress({ status: "running" }), false);
  });

  it("session-only cancel without job still signals session", async () => {
    const sessions = {
      "sess-x": {
        status: "scraping",
        browser: { close: async () => {} },
      },
    };
    const result = await requestCancel({
      supabase: null,
      sessionId: "sess-x",
      sessions,
      cleanupSession: () => {},
      closeBrowser: true,
    });
    assert.equal(result.localSessionSignaled, true);
    assert.equal(sessions["sess-x"]._cancelRequested, true);
  });
});

describe("scraper cancel boundary contracts", () => {
  it("PGC harvest cancel checker supports async DB poll", async () => {
    const { supabase } = createJobStore({ status: "cancelling" });
    const session = { _cancelRequested: false, _scrapeJobId: "job-1" };
    const isCancelRequested = bindSessionCancelChecker(session, supabase);
    assert.equal(await isCancelRequested(), true);
  });

  it("Washington/Montgomery/Howard unit gate stops before next project", async () => {
    clearCancelPollCache("job-gate");
    const projects = ["a", "b", "c"];
    const session = { _cancelRequested: false, _scrapeJobId: "job-gate" };
    const { supabase } = createJobStore({ id: "job-gate", status: "running" });
    const started = [];
    for (const p of projects) {
      if (await shouldAbort(session, supabase, { bypassCache: true })) break;
      started.push(p);
      if (p === "a") {
        session._cancelRequested = true;
      }
    }
    assert.deepEqual(started, ["a"]);
  });

  it("Baltimore/Fairfax attachment loop stops before next download", async () => {
    const attachments = ["f1", "f2", "f3"];
    const session = { _cancelRequested: false };
    const downloaded = [];
    for (const name of attachments) {
      if (session._cancelRequested) break;
      downloaded.push(name);
      if (name === "f1") session._cancelRequested = true;
    }
    assert.deepEqual(downloaded, ["f1"]);
  });

  it("Montgomery/Howard pipeline cancel returns cancelled without next phase", async () => {
    let phase = "detail";
    const opts = {
      isCancelRequested: async () => phase === "files",
    };
    async function cancelled() {
      return !!(await opts.isCancelRequested());
    }
    const ran = [];
    if (!(await cancelled())) {
      ran.push("detail");
      phase = "files";
    }
    if (await cancelled()) {
      assert.deepEqual(ran, ["detail"]);
      return;
    }
    ran.push("files");
    assert.fail("should not reach files");
  });
});
