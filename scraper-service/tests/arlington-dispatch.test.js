"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const {
  applyPostReleaseDispatchPolicy,
  TERMINAL_STATUSES,
} = require("../lib/arlington-job-store.js");

const RECOVERY_WINDOW_MS = 30 * 60 * 1000;

function claimTier(job, now = Date.now()) {
  if (job.run_intent === "dormant") return 99;
  const recent = (ts) => ts && now - Date.parse(ts) < RECOVERY_WINDOW_MS;
  const lastActivity = Math.max(
    job.last_worker_started_at ? Date.parse(job.last_worker_started_at) : 0,
    job.lease_heartbeat_at ? Date.parse(job.lease_heartbeat_at) : 0,
    job.last_heartbeat_at ? Date.parse(job.last_heartbeat_at) : 0,
  );
  if (job.run_intent === "foreground") return 0;
  if (job.run_intent === "recovery" && job.explicitly_resumed_at) return 1;
  if (
    ["foreground", "recovery", "retry"].includes(job.run_intent) &&
    ["running", "resuming", "partial"].includes(job.status) &&
    recent(new Date(lastActivity).toISOString())
  ) {
    return 2;
  }
  if (
    job.run_intent === "retry" &&
    ["rate_limited", "partial"].includes(job.status) &&
    (!job.next_attempt_at || Date.parse(job.next_attempt_at) <= now)
  ) {
    return 3;
  }
  return 99;
}

function isClaimEligible(job, now = Date.now()) {
  if (job.run_intent === "dormant") return false;
  if (TERMINAL_STATUSES.has(job.status)) return false;
  if (job.completed_at) return false;
  if (job.phase === "complete") return false;
  if (job.lease_expires_at && Date.parse(job.lease_expires_at) > now) return false;
  if (job.run_intent === "retry" && job.next_attempt_at && Date.parse(job.next_attempt_at) > now) {
    return false;
  }
  return claimTier(job, now) < 99;
}

function pickClaimable(jobs, now = Date.now()) {
  return [...jobs]
    .filter((j) => isClaimEligible(j, now))
    .sort((a, b) => {
      const ta = claimTier(a, now);
      const tb = claimTier(b, now);
      if (ta !== tb) return ta - tb;
      if (b.dispatch_priority !== a.dispatch_priority) {
        return b.dispatch_priority - a.dispatch_priority;
      }
      const ra = a.requested_at ? Date.parse(a.requested_at) : 0;
      const rb = b.requested_at ? Date.parse(b.requested_at) : 0;
      if (rb !== ra) return rb - ra;
      return Date.parse(a.created_at) - Date.parse(b.created_at);
    })[0] || null;
}

function baseJob(overrides = {}) {
  return {
    id: "job-base",
    jurisdiction: "Arlington County",
    status: "partial",
    phase: "attachments",
    completed_at: null,
    lease_expires_at: null,
    lease_worker_id: null,
    next_attempt_at: null,
    created_at: new Date(Date.now() - 3600_000).toISOString(),
    requested_at: new Date(Date.now() - 3600_000).toISOString(),
    explicitly_resumed_at: null,
    last_worker_started_at: null,
    last_heartbeat_at: null,
    lease_heartbeat_at: null,
    dispatch_priority: 0,
    run_intent: "dormant",
    ...overrides,
  };
}

describe("Arlington dispatch priority (claim ordering simulation)", () => {
  it("foreground job is claimed before unrelated old partial job", () => {
    const oldPartial = baseJob({
      id: "old-partial",
      permit_number: "COFO25-00233",
      run_intent: "dormant",
      status: "partial",
      created_at: new Date(Date.now() - 86_400_000).toISOString(),
    });
    const fresh = baseJob({
      id: "fresh",
      permit_number: "COFO26-00417",
      run_intent: "foreground",
      dispatch_priority: 1_700_000_000,
      requested_at: new Date().toISOString(),
      status: "queued",
    });
    const picked = pickClaimable([oldPartial, fresh]);
    assert.equal(picked.id, "fresh");
  });

  it("foreground job is claimed before stale running job", () => {
    const stale = baseJob({
      id: "stale",
      run_intent: "recovery",
      status: "running",
      last_worker_started_at: new Date(Date.now() - 2 * RECOVERY_WINDOW_MS).toISOString(),
    });
    const fresh = baseJob({
      id: "fresh",
      run_intent: "foreground",
      dispatch_priority: 2,
      requested_at: new Date().toISOString(),
    });
    assert.equal(pickClaimable([stale, fresh]).id, "fresh");
  });

  it("foreground job is claimed before due retry job", () => {
    const retry = baseJob({
      id: "retry",
      run_intent: "retry",
      status: "rate_limited",
      next_attempt_at: new Date(Date.now() - 1000).toISOString(),
    });
    const fresh = baseJob({
      id: "fresh",
      run_intent: "foreground",
      dispatch_priority: 9,
      requested_at: new Date().toISOString(),
    });
    assert.equal(pickClaimable([retry, fresh]).id, "fresh");
  });

  it("explicit recovery runs only when no foreground job is waiting", () => {
    const recovery = baseJob({
      id: "recovery",
      run_intent: "recovery",
      explicitly_resumed_at: new Date().toISOString(),
      dispatch_priority: 5,
    });
    const foreground = baseJob({
      id: "fg",
      run_intent: "foreground",
      dispatch_priority: 10,
      requested_at: new Date().toISOString(),
    });
    assert.equal(pickClaimable([recovery, foreground]).id, "fg");
    assert.equal(pickClaimable([recovery]).id, "recovery");
  });

  it("dormant job is never auto-claimed", () => {
    const dormant = baseJob({
      id: "dormant",
      run_intent: "dormant",
      status: "partial",
    });
    assert.equal(pickClaimable([dormant]), null);
    assert.equal(isClaimEligible(dormant), false);
  });

  it("restart resumes the same recently active job within recovery window", () => {
    const recent = baseJob({
      id: "recent",
      run_intent: "foreground",
      status: "running",
      last_worker_started_at: new Date(Date.now() - 60_000).toISOString(),
      lease_expires_at: new Date(Date.now() - 1000).toISOString(),
    });
    assert.equal(pickClaimable([recent])?.id, "recent");
    assert.equal(claimTier(recent), 0);
  });

  it("due partial retry job is claimable after bounded phase checkpoint", () => {
    const partialRetry = baseJob({
      id: "partial-retry",
      run_intent: "retry",
      status: "partial",
      phase: "project_information",
      next_attempt_at: new Date(Date.now() - 1000).toISOString(),
      last_heartbeat_at: new Date(Date.now() - 2 * RECOVERY_WINDOW_MS).toISOString(),
    });
    assert.equal(pickClaimable([partialRetry])?.id, "partial-retry");
    assert.equal(claimTier(partialRetry), 3);
  });

  it("restart resumes partial job within recovery window after worker interruption", () => {
    const recentPartial = baseJob({
      id: "recent-partial",
      run_intent: "foreground",
      status: "partial",
      last_worker_started_at: new Date(Date.now() - 90_000).toISOString(),
      lease_expires_at: new Date(Date.now() - 1000).toISOString(),
    });
    assert.equal(pickClaimable([recentPartial])?.id, "recent-partial");
    assert.equal(claimTier(recentPartial), 0);
  });

  it("restart does not revive unrelated historical jobs outside recovery window", () => {
    const historical = baseJob({
      id: "historical",
      run_intent: "recovery",
      status: "running",
      last_worker_started_at: new Date(Date.now() - 3 * RECOVERY_WINDOW_MS).toISOString(),
    });
    assert.equal(pickClaimable([historical]), null);
  });
});

describe("post-release dispatch policy", () => {
  it("demotes non-foreground job when foreground is waiting", async () => {
    const supabase = {
      from() {
        return {
          select() {
            return {
              ilike() {
                return {
                  eq() {
                    return {
                      is() {
                        return {
                          neq() {
                            return Promise.resolve({
                              data: [{ id: "fg", lease_expires_at: null }],
                              error: null,
                            });
                          },
                        };
                      },
                    };
                  },
                };
              },
            };
          },
        };
      },
    };
    const patch = await applyPostReleaseDispatchPolicy(
      supabase,
      { id: "old", run_intent: "recovery" },
      { status: "partial" },
    );
    assert.equal(patch.run_intent, "dormant");
  });

  it("keeps foreground job intent after checkpoint release", async () => {
    const supabase = {
      from() {
        return {
          select() {
            return {
              ilike() {
                return {
                  eq() {
                    return {
                      is() {
                        return {
                          neq() {
                            return Promise.resolve({ data: [], error: null });
                          },
                        };
                      },
                    };
                  },
                };
              },
            };
          },
        };
      },
    };
    const patch = await applyPostReleaseDispatchPolicy(
      supabase,
      { id: "fg", run_intent: "foreground" },
      { status: "partial" },
    );
    assert.equal(patch.run_intent, undefined);
  });
});

describe("dispatch migration contract", () => {
  it("migration adds run_intent columns and priority-aware claim RPC", () => {
    const sql = fs.readFileSync(
      path.join(__dirname, "..", "..", "supabase/migrations/20260630300000_arlington_job_dispatch_priority.sql"),
      "utf8",
    );
    assert.match(sql, /run_intent/);
    assert.match(sql, /request_arlington_job_dispatch/);
    assert.match(sql, /run_intent <> 'dormant'/);
    assert.match(sql, /dispatch_priority DESC/);
    assert.match(sql, /interval '30 minutes'/);
  });
});

describe("dedup and terminal compatibility", () => {
  it("cancelled jobs remain unclaimable", () => {
    const cancelled = baseJob({
      id: "cancelled",
      status: "cancelled",
      run_intent: "foreground",
    });
    assert.equal(isClaimEligible(cancelled), false);
    assert.ok(TERMINAL_STATUSES.has("cancelled"));
  });

  it("duplicate enqueue identity rules remain separate from dispatch", () => {
    const a = baseJob({ id: "a", permit_number: "P1", run_intent: "foreground" });
    const b = baseJob({ id: "b", permit_number: "P2", run_intent: "dormant" });
    assert.notEqual(a.permit_number, b.permit_number);
    assert.equal(pickClaimable([b, a]).id, "a");
  });
});
