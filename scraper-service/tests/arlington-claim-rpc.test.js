"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

/**
 * In-memory simulation of claim_arlington_scrape_job (FOR UPDATE SKIP LOCKED semantics).
 */
function createAtomicClaimStore(initialJobs) {
  const jobs = new Map(initialJobs.map((j) => [j.id, { ...j }]));
  const rowLocks = new Set();
  let claimMutex = false;

  function eligible(job) {
    return (
      `${job.jurisdiction || ""}`.toLowerCase().includes("arlington") &&
      !job.completed_at &&
      ["queued", "running", "resuming", "rate_limited", "partial"].includes(
        job.status,
      ) &&
      (!job.next_attempt_at || new Date(job.next_attempt_at) <= new Date()) &&
      (!job.lease_expires_at || new Date(job.lease_expires_at) < new Date()) &&
      job.phase !== "complete"
    );
  }

  async function claim(workerId, leaseTtlSeconds = 180) {
    while (claimMutex) await new Promise((r) => setTimeout(r, 1));
    claimMutex = true;
    try {
      await new Promise((r) => setTimeout(r, Math.random() * 3));
    const ordered = [...jobs.values()].sort((a, b) => {
      const na = a.next_attempt_at ? new Date(a.next_attempt_at).getTime() : 0;
      const nb = b.next_attempt_at ? new Date(b.next_attempt_at).getTime() : 0;
      if (na !== nb) return na - nb;
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    });

    for (const candidate of ordered) {
      if (!eligible(candidate)) continue;
      if (rowLocks.has(candidate.id)) continue;
      rowLocks.add(candidate.id);
      try {
        const live = jobs.get(candidate.id);
        if (!live || !eligible(live)) {
          continue;
        }
        const leaseActive =
          live.lease_worker_id &&
          live.lease_expires_at &&
          new Date(live.lease_expires_at) >= new Date();
        if (leaseActive) {
          continue;
        }
        const expires = new Date(Date.now() + leaseTtlSeconds * 1000).toISOString();
        live.lease_worker_id = workerId;
        live.lease_expires_at = expires;
        live.lease_heartbeat_at = new Date().toISOString();
        if (["queued", "rate_limited", "partial"].includes(live.status)) {
          live.status = "running";
        }
        jobs.set(live.id, live);
        return { ...live };
      } finally {
        rowLocks.delete(candidate.id);
      }
    }
    return null;
    } finally {
      claimMutex = false;
    }
  }

  function get(id) {
    const row = jobs.get(id);
    return row ? { ...row } : null;
  }

  function release(jobId, workerId, patch = {}) {
    const row = jobs.get(jobId);
    if (!row) return null;
    if (row.lease_worker_id && row.lease_worker_id !== workerId) return null;
    Object.assign(row, patch, {
      lease_worker_id: null,
      lease_expires_at: null,
    });
    jobs.set(jobId, row);
    return { ...row };
  }

  return { claim, get, release, jobs };
}

describe("Arlington atomic claim RPC (concurrency)", () => {
  it("two competing workers cannot both claim the same job", async () => {
    const store = createAtomicClaimStore([
      {
        id: "job-race",
        jurisdiction: "Arlington County, VA",
        status: "queued",
        phase: "attachments",
        created_at: new Date().toISOString(),
        completed_at: null,
        next_attempt_at: null,
        lease_expires_at: null,
        lease_worker_id: null,
      },
    ]);

    const [a, b] = await Promise.all([
      store.claim("worker-a"),
      store.claim("worker-b"),
    ]);
    const claimed = [a, b].filter(Boolean);
    assert.equal(claimed.length, 1, "exactly one worker should claim the job");
    const holder = store.get("job-race").lease_worker_id;
    assert.ok(holder === "worker-a" || holder === "worker-b");
  });

  it("expired lease allows a new worker to claim", async () => {
    const store = createAtomicClaimStore([
      {
        id: "job-stale",
        jurisdiction: "arlington",
        status: "partial",
        phase: "attachments",
        created_at: new Date().toISOString(),
        completed_at: null,
        next_attempt_at: null,
        lease_expires_at: new Date(Date.now() - 60_000).toISOString(),
        lease_worker_id: "worker-old",
      },
    ]);
    const claimed = await store.claim("worker-new");
    assert.ok(claimed);
    assert.equal(claimed.lease_worker_id, "worker-new");
  });

  it("rate-limited job is not claimable until next_attempt_at passes", async () => {
    const store = createAtomicClaimStore([
      {
        id: "job-rl",
        jurisdiction: "arlington",
        status: "rate_limited",
        phase: "attachments",
        created_at: new Date().toISOString(),
        completed_at: null,
        next_attempt_at: new Date(Date.now() + 60_000).toISOString(),
        lease_expires_at: null,
        lease_worker_id: null,
      },
    ]);
    const claimed = await store.claim("worker-x");
    assert.equal(claimed, null);
  });

  it("heartbeat extends active lease (mock RPC)", async () => {
    const { heartbeatLease } = require("../lib/arlington-job-store.js");
    const row = {
      lease_expires_at: new Date(Date.now() + 30_000).toISOString(),
    };
    const supabase = {
      rpc(name, args) {
        assert.equal(name, "heartbeat_arlington_scrape_job_lease");
        assert.equal(args.p_worker_id, "w1");
        row.lease_expires_at = new Date(
          Date.now() + args.p_lease_ttl_seconds * 1000,
        ).toISOString();
        return { data: true, error: null };
      },
    };
    const ok = await heartbeatLease(supabase, "j-hb", "w1", 120);
    assert.equal(ok, true);
    assert.ok(new Date(row.lease_expires_at).getTime() > Date.now() + 60_000);
  });

  it("rate-limited job becomes claimable after cooldown (restart recovery)", async () => {
    const store = createAtomicClaimStore([
      {
        id: "job-rl-ready",
        jurisdiction: "arlington",
        status: "rate_limited",
        phase: "attachments",
        created_at: new Date().toISOString(),
        completed_at: null,
        next_attempt_at: new Date(Date.now() - 1000).toISOString(),
        lease_expires_at: null,
        lease_worker_id: null,
        attempt_count: 2,
      },
    ]);
    const claimed = await store.claim("worker-restart");
    assert.ok(claimed);
    assert.equal(claimed.status, "running");
  });
});
