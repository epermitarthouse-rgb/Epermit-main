"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  listConnectedMailboxesForInboundPoll,
  runGraphInboundPollCycle,
} = require("../app/services/uci/uci-graph-inbound-poller.service.js");

/**
 * Minimal supabase mock for microsoft_mailbox_connections list.
 */
function createListMock(rows) {
  return {
    from(table) {
      assert.equal(table, "microsoft_mailbox_connections");
      const api = {
        select() {
          return api;
        },
        eq() {
          return api;
        },
        order() {
          return api;
        },
        limit() {
          return Promise.resolve({ data: rows, error: null });
        },
      };
      return api;
    },
  };
}

describe("uci-graph-inbound-poller", () => {
  it("lists only connected mailboxes from supabase", async () => {
    const rows = [
      {
        user_id: "u1",
        mailbox_email: "a@example.com",
        status: "connected",
        last_checked_at: null,
        last_error: null,
      },
    ];
    const listed = await listConnectedMailboxesForInboundPoll(createListMock(rows));
    assert.equal(listed.length, 1);
    assert.equal(listed[0].user_id, "u1");
  });

  it("runs poll cycle for each connected mailbox and sums inserts", async () => {
    const calls = [];
    const summary = await runGraphInboundPollCycle(createListMock([
      {
        user_id: "u1",
        mailbox_email: "a@example.com",
        status: "connected",
        last_checked_at: null,
        last_error: null,
      },
      {
        user_id: "u2",
        mailbox_email: "b@example.com",
        status: "connected",
        last_checked_at: null,
        last_error: null,
      },
    ]), {
      pollerId: "test-poller",
      pollGraphInboundForUser: async (_sb, opts) => {
        calls.push(opts.userId);
        return {
          polled: 2,
          matched: 1,
          unmatched: 1,
          ingested: 1,
          results: [{ inserted: true }, { inserted: false }],
        };
      },
    });

    assert.deepEqual(calls, ["u1", "u2"]);
    assert.equal(summary.mailbox_count, 2);
    assert.equal(summary.ok_count, 2);
    assert.equal(summary.error_count, 0);
    assert.equal(summary.inserted_total, 2);
  });

  it("records mailbox errors without aborting the cycle", async () => {
    let markErrorCalled = false;
    // Inject mark failure path via poll throw; markMailboxConnectionError uses real import —
    // use a throw that doesn't need mark to succeed for summary.
    const summary = await runGraphInboundPollCycle(createListMock([
      {
        user_id: "u-bad",
        mailbox_email: "bad@example.com",
        status: "connected",
        last_checked_at: null,
        last_error: null,
      },
      {
        user_id: "u-ok",
        mailbox_email: "ok@example.com",
        status: "connected",
        last_checked_at: null,
        last_error: null,
      },
    ]), {
      pollerId: "test-poller-err",
      pollGraphInboundForUser: async (_sb, opts) => {
        if (opts.userId === "u-bad") {
          markErrorCalled = true;
          throw new Error("token expired");
        }
        return {
          polled: 1,
          matched: 1,
          unmatched: 0,
          ingested: 1,
          results: [{ inserted: true }],
        };
      },
    });

    assert.equal(markErrorCalled, true);
    assert.equal(summary.ok_count, 1);
    assert.equal(summary.error_count, 1);
    assert.equal(summary.inserted_total, 1);
    assert.match(String(summary.results[0].error || ""), /token expired/);
  });
});
