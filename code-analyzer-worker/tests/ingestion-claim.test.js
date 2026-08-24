"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

/**
 * In-memory simulation of claim_code_analyzer_ingestion_job semantics.
 */
function createIngestionClaimStore(initialJobs) {
  const jobs = new Map(initialJobs.map((j) => [j.id, { ...j }]));
  const rowLocks = new Set();
  let claimMutex = false;

  function eligiblePending(job) {
    return (
      job.status === "pending" &&
      !job.cancelled_at &&
      job.attempt_count < job.max_attempts &&
      new Date(job.available_at) <= new Date() &&
      (!job.lease_expires_at || new Date(job.lease_expires_at) < new Date())
    );
  }

  async function claim(workerId, leaseTtlSeconds = 180) {
    while (claimMutex) await new Promise((r) => setTimeout(r, 1));
    claimMutex = true;
    try {
      const ordered = [...jobs.values()].sort(
        (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
      );

      for (const candidate of ordered) {
        if (!eligiblePending(candidate)) continue;
        if (rowLocks.has(candidate.id)) continue;
        rowLocks.add(candidate.id);
        try {
          const live = jobs.get(candidate.id);
          if (!live || !eligiblePending(live)) continue;
          live.status = "processing";
          live.lease_owner = workerId;
          live.lease_expires_at = new Date(Date.now() + leaseTtlSeconds * 1000).toISOString();
          live.attempt_count += 1;
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

  return { claim, get, jobs };
}

describe("code analyzer ingestion claim", () => {
  it("two workers cannot claim the same pending job", async () => {
    const store = createIngestionClaimStore([
      {
        id: "job-1",
        status: "pending",
        cancelled_at: null,
        attempt_count: 0,
        max_attempts: 5,
        available_at: new Date().toISOString(),
        lease_expires_at: null,
        created_at: new Date().toISOString(),
      },
    ]);

    const [a, b] = await Promise.all([store.claim("w-a"), store.claim("w-b")]);
    const claimed = [a, b].filter(Boolean);
    assert.equal(claimed.length, 1);
  });

  it("completed jobs are not re-claimed", async () => {
    const store = createIngestionClaimStore([
      {
        id: "job-done",
        status: "completed",
        cancelled_at: null,
        attempt_count: 1,
        max_attempts: 5,
        available_at: new Date().toISOString(),
        lease_expires_at: null,
        created_at: new Date().toISOString(),
      },
    ]);
    const claimed = await store.claim("w-a");
    assert.equal(claimed, null);
  });
});
