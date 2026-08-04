"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const {
  TERMINAL_STATUSES,
  isArlingtonJobCancelled,
  pollArlingtonJobCancelled,
  cancelArlingtonScrapeJob,
} = require("../lib/arlington-job-store.js");
const { executeArlingtonWorkerCycle } = require("../lib/arlington-worker-executor.js");

function createJobStore(initial = {}) {
  const row = {
    id: "job-1",
    project_id: "proj-1",
    user_id: "user-1",
    jurisdiction: "Arlington County",
    status: "queued",
    phase: "record_info",
    completed_at: null,
    metadata: {},
    lease_worker_id: null,
    lease_expires_at: null,
    run_intent: "foreground",
    ...initial,
  };

  const supabase = {
    from(table) {
      assert.equal(table, "scrape_jobs");
      return {
        select() {
          return {
            eq(_col, id) {
              return {
                maybeSingle: async () => ({ data: { ...row }, error: null }),
              };
            },
          };
        },
        update(patch) {
          return {
            eq() {
              return {
                neq() {
                  return {
                    is() {
                      Object.assign(row, patch);
                      return Promise.resolve({ error: null });
                    },
                  };
                },
              };
            },
          };
        },
      };
    },
    rpc(name, args) {
      if (name === "cancel_arlington_scrape_job") {
        if (args.p_job_id !== row.id) {
          return Promise.resolve({ data: null, error: { message: "not found" } });
        }
        if (isArlingtonJobCancelled(row)) {
          return Promise.resolve({
            data: [
              {
                job_id: row.id,
                status: "cancelled",
                already_terminal: false,
                cancellation_reason: "user_cancelled",
              },
            ],
            error: null,
          });
        }
        if (TERMINAL_STATUSES.has(row.status)) {
          return Promise.resolve({
            data: [
              {
                job_id: row.id,
                status: row.status,
                already_terminal: true,
                cancellation_reason: row.cancellation_reason || null,
              },
            ],
            error: null,
          });
        }
        row.status = "cancelled";
        row.completed_at = new Date().toISOString();
        row.cancellation_reason = "user_cancelled";
        row.run_intent = "dormant";
        row.lease_worker_id = null;
        row.lease_expires_at = null;
        row.metadata = {
          arlington: {
            terminalReason: "user_cancelled",
            cancelledAt: new Date().toISOString(),
            cancelledBy: args.p_user_id || "user-1",
          },
        };
        return Promise.resolve({
          data: [
            {
              job_id: row.id,
              status: "cancelled",
              already_terminal: false,
              cancellation_reason: "user_cancelled",
            },
          ],
          error: null,
        });
      }
      if (name === "release_arlington_scrape_job_lease") {
        if (row.status === "cancelled") {
          return Promise.resolve({ data: null, error: null });
        }
        Object.assign(row, {
          lease_worker_id: null,
          lease_expires_at: null,
          ...(args.p_status ? { status: args.p_status } : {}),
        });
        return Promise.resolve({ data: { ...row }, error: null });
      }
      return Promise.resolve({ data: null, error: { message: `unknown rpc ${name}` } });
    },
  };

  return { supabase, row };
}

describe("Arlington durable scrape cancellation", () => {
  it("detects cancelled status and user_cancelled terminalReason", () => {
    assert.equal(isArlingtonJobCancelled({ status: "cancelled" }), true);
    assert.equal(
      isArlingtonJobCancelled({
        status: "partial",
        metadata: { arlington: { terminalReason: "user_cancelled" } },
      }),
      true,
    );
    assert.equal(isArlingtonJobCancelled({ status: "running" }), false);
  });

  it("cancels queued durable job via RPC helper", async () => {
    const { supabase, row } = createJobStore({ status: "queued" });
    const result = await cancelArlingtonScrapeJob(supabase, {
      jobId: row.id,
      projectId: row.project_id,
      userId: row.user_id,
    });
    assert.equal(result.status, "cancelled");
    assert.equal(row.status, "cancelled");
    assert.equal(row.run_intent, "dormant");
    assert.equal(row.metadata.arlington.terminalReason, "user_cancelled");
  });

  it("cancels running durable job", async () => {
    const { supabase, row } = createJobStore({
      status: "running",
      lease_worker_id: "worker-1",
    });
    await cancelArlingtonScrapeJob(supabase, {
      jobId: row.id,
      projectId: row.project_id,
    });
    assert.equal(row.status, "cancelled");
    assert.equal(row.lease_worker_id, null);
  });

  it("cancels partial and rate_limited jobs", async () => {
    for (const status of ["partial", "rate_limited"]) {
      const { supabase, row } = createJobStore({ status, run_intent: "retry" });
      await cancelArlingtonScrapeJob(supabase, {
        jobId: row.id,
        projectId: row.project_id,
      });
      assert.equal(row.status, "cancelled", status);
    }
  });

  it("cancel is idempotent", async () => {
    const { supabase, row } = createJobStore({ status: "queued" });
    const first = await cancelArlingtonScrapeJob(supabase, {
      jobId: row.id,
      projectId: row.project_id,
    });
    const second = await cancelArlingtonScrapeJob(supabase, {
      jobId: row.id,
      projectId: row.project_id,
    });
    assert.equal(first.status, "cancelled");
    assert.equal(second.status, "cancelled");
  });

  it("already terminal job returns safe success", async () => {
    const { supabase, row } = createJobStore({
      status: "completed",
      completed_at: new Date().toISOString(),
    });
    const result = await cancelArlingtonScrapeJob(supabase, {
      jobId: row.id,
      projectId: row.project_id,
    });
    assert.equal(result.already_terminal, true);
    assert.equal(row.status, "completed");
  });

  it("poll detects persisted cancellation", async () => {
    const { supabase, row } = createJobStore({ status: "running" });
    assert.equal(await pollArlingtonJobCancelled(supabase, row.id), false);
    row.status = "cancelled";
    row.metadata = { arlington: { terminalReason: "user_cancelled" } };
    assert.equal(await pollArlingtonJobCancelled(supabase, row.id), true);
  });

  it("worker stops after persisted cancellation before session work", async () => {
    const accela = require("../accela-scraper.js");
    const original = accela.runArlingtonWorkerBoundedPhase;
    accela.runArlingtonWorkerBoundedPhase = async () => {
      throw new Error("should not run bounded phase");
    };
    try {
      const { supabase, row } = createJobStore({ status: "cancelled" });
      const result = await executeArlingtonWorkerCycle({
        supabase,
        job: row,
        workerId: "worker-1",
        sessions: {},
        rearmSessionIdleTimeout: () => {},
        cleanupSession: () => {},
        hashPortalData: () => "hash",
        uploadToSupabaseStorage: async () => null,
        sanitizeStorageKey: (k) => k,
      });
      assert.equal(result.outcome, "cancelled");
    } finally {
      accela.runArlingtonWorkerBoundedPhase = original;
    }
  });

  it("release lease RPC does not overwrite cancelled status (contract)", () => {
    const sql = fs.readFileSync(
      path.join(
        __dirname,
        "..",
        "..",
        "supabase/migrations/20260630400000_arlington_cancel_scrape_job.sql",
      ),
      "utf8",
    );
    assert.match(sql, /cancel_arlington_scrape_job/);
    assert.match(sql, /status IS DISTINCT FROM 'cancelled'/);
    assert.match(sql, /user_cancelled/);
  });

  it("claim RPC excludes cancelled jobs (contract)", () => {
    const sql = fs.readFileSync(
      path.join(
        __dirname,
        "..",
        "..",
        "supabase/migrations/20260630400000_arlington_cancel_scrape_job.sql",
      ),
      "utf8",
    );
    assert.match(sql, /status IS DISTINCT FROM 'cancelled'/);
    assert.match(sql, /'user_cancelled'/);
  });

  it("frontend cancel route exists", () => {
    const routes = fs.readFileSync(
      path.join(__dirname, "..", "app/routes/session-api.routes.js"),
      "utf8",
    );
    assert.match(routes, /\/api\/scrape-jobs\/:jobId\/cancel/);
    assert.match(routes, /cancel_arlington_scrape_job/);
  });

  it("frontend ScrapeContext uses durable jobId cancel", () => {
    const ctx = fs.readFileSync(
      path.join(__dirname, "..", "..", "src/contexts/ScrapeContext.tsx"),
      "utf8",
    );
    assert.match(ctx, /api\/scrape-jobs\/\$\{jid\}\/cancel/);
    assert.match(ctx, /projectId/);
  });

  it("legacy session cancel route remains", () => {
    const routes = fs.readFileSync(
      path.join(__dirname, "..", "app/routes/session-api.routes.js"),
      "utf8",
    );
    assert.match(routes, /\/api\/scrape\/cancel\/:sessionId/);
  });

  it("durable portal label maps queued vs running consistently", () => {
    const types = fs.readFileSync(
      path.join(__dirname, "..", "..", "src/lib/scrapeJobTypes.ts"),
      "utf8",
    );
    assert.match(types, /durableScrapePortalLabel/);
    assert.match(types, /case "queued":/);
    assert.match(types, /Waiting to retry/);
    assert.match(types, /durableScrapePortalStepStatus/);
  });
});
