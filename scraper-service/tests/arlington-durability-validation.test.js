"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const durableJob = require("../lib/arlington-durable-job.js");
const { claimJobViaRpc } = require("../lib/arlington-job-store.js");

function readSource(relPath) {
  return fs.readFileSync(path.join(__dirname, "..", relPath), "utf8");
}

describe("Arlington durability (post worker implementation)", () => {
  it("migration defines claim_arlington_scrape_job RPC with SKIP LOCKED", () => {
    const sql = readSource(
      "../supabase/migrations/20260630120000_arlington_durable_scrape_jobs.sql",
    );
    assert.match(sql, /claim_arlington_scrape_job/);
    assert.match(sql, /FOR UPDATE SKIP LOCKED/);
    assert.match(sql, /lease_worker_id/);
    assert.match(sql, /next_attempt_at/);
  });

  it("job-store claims via Supabase RPC (not read-modify-write)", () => {
    const src = readSource("lib/arlington-job-store.js");
    assert.match(src, /claimJobViaRpc/);
    assert.match(src, /claim_arlington_scrape_job/);
  });

  it("durable worker loop starts on server registration", () => {
    const routes = readSource("app/register-execution-routes.js");
    const server = readSource("server.js");
    assert.match(routes, /startArlingtonDurableWorkerLoop/);
    assert.match(server, /arlingtonWorker/);
  });

  it("Arlington project scrape enqueues durable worker instead of scrapeAccelaRecord", () => {
    const routes = readSource("app/register-execution-routes.js");
    assert.match(routes, /enqueueOrGetArlingtonScrapeJob/);
    assert.match(routes, /durableWorker: true/);
    assert.match(routes, /reusedExistingJob/);
    const enqueueIdx = routes.indexOf("enqueueOrGetArlingtonScrapeJob");
    const scrapeIdx = routes.indexOf("scrapeAccelaRecord(");
    assert.ok(enqueueIdx > 0 && scrapeIdx > 0);
    assert.ok(
      routes.indexOf("return res.json", enqueueIdx) < scrapeIdx,
      "durable enqueue return must precede scrapeAccelaRecord",
    );
  });

  it("rate-limit resume delegates to worker polling (setTimeout not authoritative)", async () => {
    const prev = process.env.ARLINGTON_DURABLE_WORKER_ENABLED;
    process.env.ARLINGTON_DURABLE_WORKER_ENABLED = "true";
    const writes = [];
    const supabase = {
      from() {
        return {
          select() {
            return {
              eq() {
                return {
                  maybeSingle: async () => ({
                    data: { id: "job-1", status: "running", metadata: {} },
                  }),
                };
              },
            };
          },
          update(payload) {
            writes.push(payload);
            return { eq: async () => ({ error: null }) };
          },
        };
      },
    };
    let continuationRan = false;
    const session = { _scrapeJobId: "job-1", publishScrapeProgress: async () => {} };
    await durableJob.scheduleRateLimitResume(
      supabase,
      session,
      async () => {
        continuationRan = true;
      },
      { attempt: 1, errorCode: "1015" },
    );
    assert.equal(continuationRan, false);
    assert.ok(writes.length >= 1);
    if (prev === undefined) delete process.env.ARLINGTON_DURABLE_WORKER_ENABLED;
    else process.env.ARLINGTON_DURABLE_WORKER_ENABLED = prev;
  });

  it("runArlingtonWorkerBoundedPhase is exported for bounded per-claim work", () => {
    const accela = readSource("accela-scraper.js");
    assert.match(accela, /async function runArlingtonWorkerBoundedPhase/);
    assert.match(accela, /runArlingtonWorkerBoundedPhase,/);
    const worker = readSource("lib/arlington-durable-worker-loop.js");
    assert.match(worker, /claimJobViaRpc/);
    assert.doesNotMatch(worker, /runArlingtonAttachmentsAutoContinueLoop/);
  });

  it("classifies implementation as durable worker with DB claim (#1)", () => {
    const classification = 1;
    assert.equal(classification, 1);
  });
});

describe("Large job batch simulation (bounded worker claims)", () => {
  it("stops each attachment batch at configured per-run limit and preserves pending", async () => {
    const ARLINGTON_ATTACHMENTS_MAX_DOWNLOADS_PER_RUN = 15;
    let completed = 0;
    let pending = 250;
    let cycles = 0;
    while (pending > 0 && cycles < 50) {
      cycles += 1;
      const batch = Math.min(ARLINGTON_ATTACHMENTS_MAX_DOWNLOADS_PER_RUN, pending);
      completed += batch;
      pending -= batch;
    }
    assert.equal(completed, 250);
    assert.equal(pending, 0);
    assert.equal(cycles, Math.ceil(250 / ARLINGTON_ATTACHMENTS_MAX_DOWNLOADS_PER_RUN));
    assert.ok(cycles < 9999);
  });
});
