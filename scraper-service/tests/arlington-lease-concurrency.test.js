"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const orchestration = require("../lib/arlington-orchestration.js");

function makeLeaseSupabase(initialJob) {
  let job = structuredClone(initialJob);
  return {
    jobState: () => job,
    client: {
      from() {
        return {
          select() {
            return {
              eq(_col, _val) {
                return {
                  maybeSingle: async () => ({ data: job, error: null }),
                };
              },
            };
          },
          update(payload) {
            job = { ...job, ...payload };
            return { eq: async () => ({ error: null }) };
          },
        };
      },
    },
  };
}

describe("Arlington job lease validation", () => {
  it("documents lease fields in scrape_jobs.metadata.arlington", () => {
    const fields = [
      "leaseWorkerId",
      "leaseExpiresAt",
      "leaseAcquiredAt",
      "leaseLastRefreshAt",
      "leaseReleasedAt",
      "leaseReleaseReason",
    ];
    const src = fs.readFileSync(
      path.join(__dirname, "../lib/arlington-orchestration.js"),
      "utf8",
    );
    for (const field of fields) {
      assert.match(src, new RegExp(field));
    }
  });

  it("uses read-modify-write metadata patch (not an atomic DB claim)", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "../lib/arlington-orchestration.js"),
      "utf8",
    );
    assert.match(src, /async function patchScrapeJobMetadata/);
    assert.match(src, /readScrapeJobMetadata/);
    assert.doesNotMatch(src, /rpc\(/);
    assert.doesNotMatch(src, /FOR UPDATE/i);
  });

  it("withArlingtonJobLease is never invoked by production scrape paths", () => {
    const accela = fs.readFileSync(
      path.join(__dirname, "../accela-scraper.js"),
      "utf8",
    );
    const routes = fs.readFileSync(
      path.join(__dirname, "../app/register-execution-routes.js"),
      "utf8",
    );
    assert.doesNotMatch(accela, /withArlingtonJobLease/);
    assert.doesNotMatch(routes, /withArlingtonJobLease/);
    assert.doesNotMatch(accela, /claimArlingtonJobLease/);
  });

  it("second worker cannot claim while first lease is unexpired", async () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    const { client } = makeLeaseSupabase({
      id: "job-1",
      status: "running",
      metadata: {
        arlington: {
          leaseWorkerId: "worker-a",
          leaseExpiresAt: future,
        },
      },
    });
    const claim = await orchestration.claimArlingtonJobLease(
      client,
      "job-1",
      "worker-b",
    );
    assert.equal(claim.claimed, false);
    assert.equal(claim.reason, "lease_held");
    assert.equal(claim.holder, "worker-a");
  });

  it("stale lease can be claimed by a new worker after expiry", async () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    const store = makeLeaseSupabase({
      id: "job-1",
      status: "running",
      metadata: {
        arlington: {
          leaseWorkerId: "worker-a",
          leaseExpiresAt: past,
        },
      },
    });
    const claim = await orchestration.claimArlingtonJobLease(
      store.client,
      "job-1",
      "worker-b",
    );
    assert.equal(claim.claimed, true);
    assert.equal(store.jobState().metadata.arlington.leaseWorkerId, "worker-b");
  });

  it("concurrent claims can both succeed without atomic compare-and-set (race)", async () => {
    let job = {
      id: "job-race",
      status: "running",
      metadata: { arlington: {} },
    };
    let inFlight = 0;
    const supabase = {
      from() {
        return {
          select() {
            return {
              eq() {
                return {
                  maybeSingle: async () => {
                    inFlight += 1;
                    await new Promise((r) => setTimeout(r, 5));
                    inFlight -= 1;
                    return { data: structuredClone(job), error: null };
                  },
                };
              },
            };
          },
          update(payload) {
            job = { ...job, ...payload };
            return { eq: async () => ({ error: null }) };
          },
        };
      },
    };
    const [a, b] = await Promise.all([
      orchestration.claimArlingtonJobLease(supabase, "job-race", "worker-1"),
      orchestration.claimArlingtonJobLease(supabase, "job-race", "worker-2"),
    ]);
    assert.equal(a.claimed, true);
    assert.equal(b.claimed, true);
    const holder = job.metadata.arlington.leaseWorkerId;
    assert.ok(holder === "worker-1" || holder === "worker-2");
    // Last writer wins — not safe mutual exclusion under true concurrency
  });
});
