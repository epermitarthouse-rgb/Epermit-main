"use strict";

/**
 * Per-scraper cancel boundary contracts (unit-level).
 * Asserts each scraper wires shared cancel checks at the required unit gates.
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

describe("PGC cancel boundaries", () => {
  it("harvest checks cancel before folder/file/retry and uses shared async checker", () => {
    const src = read("pgc-eplan-scraper.js");
    assert.match(src, /async function pgcHarvestIsCancelled/);
    assert.match(src, /await pgcHarvestIsCancelled\(harvestOpts\)/);
    assert.match(src, /cancel during folder/);
    assert.match(src, /Cancel after download failure/);
    const routes = read("app/register-execution-routes.js");
    assert.match(routes, /isCancelRequested:\s*\(\)\s*=>\s*sessionCancelRequested\(session\)/);
    assert.match(routes, /pgc_cancelled_before_relaunch/);
  });
});

describe("Washington / DC ProjectDox cancel boundaries", () => {
  it("checks cancel between projects and tabs and finalizes cancelled", () => {
    const routes = read("app/register-execution-routes.js");
    assert.match(routes, /aborting project loop/);
    assert.match(routes, /aborting tab loop/);
    assert.match(routes, /sessionCancelRequested\(session\)/);
    assert.match(
      routes,
      /result\?\.cancelled \|\| \(await sessionCancelRequested\(session, supabase\)\)/,
    );
  });
});

describe("Baltimore / Fairfax Accela cancel boundaries", () => {
  it("checks cancel before attachments and before each download", () => {
    const src = read("accela-scraper.js");
    assert.match(src, /accelaCancelRequested/);
    assert.match(src, /Attachments download cancelled — leaving remaining pending/);
    assert.match(src, /cancelled — stopping attachment downloads/);
    assert.match(src, /scrape-job-cancellation/);
  });
});

describe("Arlington cancel boundaries", () => {
  it("worker polls durable cancel including cancelling status", () => {
    const store = read("lib/arlington-job-store.js");
    assert.match(store, /status === "cancelled" \|\| status === "cancelling"/);
    const worker = read("lib/arlington-worker-executor.js");
    assert.match(worker, /pollArlingtonJobCancelled/);
    assert.match(worker, /isCancelRequested/);
  });
});

describe("Montgomery cancel boundaries", () => {
  it("pipeline and project loop honor isCancelRequested", () => {
    const pipeline = read("scrapers/montgomery/projectdox-scraper.js");
    assert.match(pipeline, /isCancelRequested/);
    assert.match(pipeline, /cancelled: true/);
    const routes = read("app/register-execution-routes.js");
    assert.match(routes, /Montgomery scrape cancelled/);
    assert.match(routes, /isCancelRequested:\s*\(\)\s*=>\s*sessionCancelRequested\(session\)/);
  });
});

describe("Howard cancel boundaries", () => {
  it("pipeline and project loop honor isCancelRequested", () => {
    const pipeline = read("scrapers/howard/projectdox-scraper.js");
    assert.match(pipeline, /isCancelRequested/);
    assert.match(pipeline, /cancelled: true/);
    const routes = read("app/register-execution-routes.js");
    assert.match(routes, /Howard scrape cancelled/);
  });
});

describe("UCI cancel boundaries", () => {
  it("mid-sync cancel checker wired into durable executor", () => {
    const executor = read("app/services/uci/uci-durable-worker-executor.js");
    assert.match(executor, /isCancelRequested:\s*\(\)\s*=>\s*pollUciPortalSyncJobCancelled/);
    assert.match(executor, /CANCELLED/);
    const store = read("app/services/uci/uci-portal-sync-job-store.js");
    assert.match(store, /cancelling/);
  });
});

describe("shared cancel routing", () => {
  it("both cancel endpoints use requestCancel", () => {
    const routes = read("app/routes/session-api.routes.js");
    assert.match(routes, /\/api\/scrape\/cancel\/:sessionId/);
    assert.match(routes, /\/api\/scrape-jobs\/:jobId\/cancel/);
    assert.equal((routes.match(/requestCancel\(/g) || []).length >= 2, true);
  });

  it("progress publisher suppresses events after cancel", () => {
    const pub = read("lib/scrape-progress-publisher.js");
    assert.match(pub, /shouldSuppressProgress/);
    assert.match(pub, /isJobCancelled/);
  });

  it("migration adds cancelling and guards publish_scrape_event", () => {
    const sql = fs.readFileSync(
      path.join(
        ROOT,
        "..",
        "supabase/migrations/20260730120000_scrape_job_cancelling_status.sql",
      ),
      "utf8",
    );
    assert.match(sql, /'cancelling'/);
    assert.match(sql, /status IS DISTINCT FROM 'cancelled'/);
    assert.match(sql, /scrape_cancelled/);
  });
});
